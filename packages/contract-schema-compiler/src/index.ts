import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import ts from "typescript"

export type JsonSchema = Record<string, unknown>

export interface ContractSideFact {
  source: string
  export: string
  schemaId: string
}

export interface ContractFact {
  kind: string
  fqn: string
  input: ContractSideFact
  output: ContractSideFact
}

export interface ContractSchemaCompilerOptions {
  packageRoot: string
  sourceRoot?: string
  contractFactName?: string
  checkOnly?: boolean
  expectedKind?: string | readonly string[]
  categoryCatalog?: boolean
}

export interface ContractSchemaCompilerReport {
  facts: readonly ContractFactRecord[]
  files: readonly GeneratedFile[]
  checkOnly: boolean
}

export interface ContractFactRecord {
  directory: string
  factPath: string
  category: string
  capabilityName: string
  fact: ContractFact
}

export interface GeneratedFile {
  path: string
  content: string
}

const defaultCompilerOptions: ts.CompilerOptions = {
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  target: ts.ScriptTarget.ES2022,
  strict: true,
  skipLibCheck: true,
}

export async function compileContractSchemas(
  options: ContractSchemaCompilerOptions,
): Promise<ContractSchemaCompilerReport> {
  const packageRoot = resolve(options.packageRoot)
  const sourceRoot = resolve(packageRoot, options.sourceRoot ?? "src")
  const factName = options.contractFactName ?? "contract.json"
  const checkOnly = options.checkOnly ?? false
  const facts = await findContractFacts(sourceRoot, factName, options.expectedKind)
  if (facts.length === 0) {
    throw new Error(`No ${factName} facts found under ${relative(packageRoot, sourceRoot)}`)
  }

  const sourcePaths = facts.flatMap((record) => [
    resolve(dirname(record.factPath), normalizeFactSource(record.fact.input.source)),
    resolve(dirname(record.factPath), normalizeFactSource(record.fact.output.source)),
  ])
  const program = ts.createProgram(sourcePaths, defaultCompilerOptions)
  assertNoProgramDiagnostics(program)
  const checker = program.getTypeChecker()
  const files = buildGeneratedFiles({ packageRoot, sourceRoot, facts, program, checker })
  const obsoletePaths = await findObsoleteGeneratedPaths(sourceRoot, files)
  await reconcileGeneratedFiles({ packageRoot, files, obsoletePaths, checkOnly })
  return { facts, files, checkOnly }
}

async function findContractFacts(
  sourceRoot: string,
  factName: string,
  expectedKind: string | readonly string[] | undefined,
): Promise<ContractFactRecord[]> {
  const records: ContractFactRecord[] = []
  await walk(sourceRoot, async (path, name) => {
    if (name !== factName) return
    const fact = parseContractFact(path, await readFile(path, "utf8"), expectedKind)
    const directory = dirname(path)
    const relativeDir = relative(sourceRoot, directory).split(/[\\/]/).join("/")
    const segments = relativeDir.split("/").filter(Boolean)
    records.push({
      directory,
      factPath: path,
      category: segments[0] ?? "",
      capabilityName: segments.at(-1) ?? "",
      fact,
    })
  })
  return records.sort((left, right) => left.factPath.localeCompare(right.factPath))
}

async function walk(dir: string, visit: (path: string, name: string) => Promise<void>) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(full, visit)
    } else if (entry.isFile()) {
      await visit(full, entry.name)
    }
  }
}

function parseContractFact(
  factPath: string,
  source: string,
  expectedKind: string | readonly string[] | undefined,
): ContractFact {
  const fact = JSON.parse(source) as Partial<ContractFact>
  const kinds = typeof expectedKind === "string" ? [expectedKind] : expectedKind
  if (typeof fact.kind !== "string" || !fact.kind.trim()) {
    throw new Error(`${factPath} must declare a non-empty kind`)
  }
  if (kinds && !kinds.includes(fact.kind)) {
    throw new Error(`${factPath} kind must be one of ${kinds.join(", ")}, received ${fact.kind}`)
  }
  if (typeof fact.fqn !== "string" || !fact.fqn.trim()) {
    throw new Error(`${factPath} must declare a non-empty fqn`)
  }
  for (const direction of ["input", "output"] as const) {
    const side = fact[direction]
    if (!side || typeof side.source !== "string" || typeof side.export !== "string" || typeof side.schemaId !== "string") {
      throw new Error(`${factPath} requires ${direction}.source/export/schemaId`)
    }
    normalizeFactSource(side.source)
  }
  return fact as ContractFact
}

function normalizeFactSource(value: string): string {
  if (!value.trim() || value.includes("\\") || value.startsWith("/") || value.split("/").includes("..")) {
    throw new Error(`Contract source must be a safe relative path: ${value}`)
  }
  return value.replace(/^\.\//, "")
}

function assertNoProgramDiagnostics(program: ts.Program) {
  const diagnostics = ts.getPreEmitDiagnostics(program)
  if (diagnostics.length === 0) return
  const message = ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => "\n",
  })
  throw new Error(`TypeScript contract program has diagnostics:\n${message}`)
}

function buildGeneratedFiles(input: {
  packageRoot: string
  sourceRoot: string
  facts: readonly ContractFactRecord[]
  program: ts.Program
  checker: ts.TypeChecker
}): GeneratedFile[] {
  const files: GeneratedFile[] = []
  for (const record of input.facts) {
    const inputSchema = schemaForContractSide(input.program, input.checker, record, record.fact.input)
    const outputSchema = schemaForContractSide(input.program, input.checker, record, record.fact.output)
    files.push({
      path: join(record.directory, "input.schema.generated.ts"),
      content: schemaModule("inputSchema", inputSchema),
    })
    files.push({
      path: join(record.directory, "output.schema.generated.ts"),
      content: schemaModule("outputSchema", outputSchema),
    })
    files.push({
      path: join(record.directory, "index.ts"),
      content: capabilityIndex(record.fact),
    })
  }

  const byCategory = new Map<string, ContractFactRecord[]>()
  for (const record of input.facts) {
    const bucket = byCategory.get(record.category) ?? []
    bucket.push(record)
    byCategory.set(record.category, bucket)
  }
  for (const [category, records] of [...byCategory.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (!category) continue
    files.push({
      path: join(input.sourceRoot, category, "schema-catalog.generated.ts"),
      content: schemaCatalog(category, records, input.sourceRoot),
    })
  }
  return files.sort((left, right) => left.path.localeCompare(right.path))
}

function schemaForContractSide(
  program: ts.Program,
  checker: ts.TypeChecker,
  record: ContractFactRecord,
  side: ContractSideFact,
): JsonSchema {
  const sourcePath = resolve(record.directory, normalizeFactSource(side.source))
  const sourceFile = program.getSourceFile(sourcePath)
  if (!sourceFile) {
    throw new Error(`Unable to read contract source ${sourcePath}`)
  }
  const declaration = exportedType(sourceFile, side.export)
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: side.schemaId,
    title: side.export,
    ...schemaForType(checker, checker.getTypeAtLocation(declaration), new Set()),
  }
}

function exportedType(sourceFile: ts.SourceFile, name: string): ts.InterfaceDeclaration | ts.TypeAliasDeclaration {
  for (const statement of sourceFile.statements) {
    if (
      (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement))
      && statement.name.text === name
      && statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      return statement
    }
  }
  throw new Error(`Exported TypeScript type ${name} not found in ${sourceFile.fileName}`)
}

function schemaForType(checker: ts.TypeChecker, type: ts.Type, seen: Set<ts.Type>): JsonSchema {
  const primitive = primitiveSchema(checker, type)
  if (primitive) return primitive
  if (seen.has(type)) return {}

  if (checker.isTupleType(type)) {
    const elements = checker.getTypeArguments(type as ts.TypeReference)
    return {
      type: "array",
      prefixItems: elements.map((element) => schemaForType(checker, element, seen)),
      minItems: elements.length,
      maxItems: elements.length,
    }
  }
  if (checker.isArrayType(type)) {
    const element = checker.getTypeArguments(type as ts.TypeReference)[0]
    return { type: "array", items: element ? schemaForType(checker, element, seen) : {} }
  }
  if (type.isUnion()) {
    const members = type.types.filter((member) => !(member.flags & ts.TypeFlags.Undefined))
    const schemas = members.map((member) => schemaForType(checker, member, seen))
    if (schemas.length === 1) return schemas[0] ?? {}
    if (schemas.every((schema) => schema.type === "string" && typeof schema.const === "string")) {
      return { type: "string", enum: schemas.map((schema) => schema.const) }
    }
    return { anyOf: schemas }
  }
  if (type.isIntersection()) {
    const schemas = type.types.map((member) => schemaForType(checker, member, seen))
    const objectSchemas = schemas.filter((schema) => schema.type === "object")
    if (objectSchemas.length === schemas.length) {
      return mergeObjectSchemas(objectSchemas)
    }
    return { allOf: schemas }
  }
  if (type.flags & ts.TypeFlags.Object) {
    seen.add(type)
    const properties: Record<string, JsonSchema> = {}
    const required: string[] = []
    for (const property of checker.getPropertiesOfType(type)) {
      const declaration = property.valueDeclaration ?? property.declarations?.[0]
      if (!declaration) continue
      properties[property.name] = schemaForType(checker, checker.getTypeOfSymbolAtLocation(property, declaration), seen)
      if (!(property.flags & ts.SymbolFlags.Optional)) {
        required.push(property.name)
      }
    }
    seen.delete(type)
    const stringIndex = checker.getIndexInfoOfType(type, ts.IndexKind.String)
    return {
      type: "object",
      additionalProperties: stringIndex
        ? schemaForType(checker, stringIndex.type, seen)
        : false,
      ...(Object.keys(properties).length > 0 ? { properties, required } : {}),
    }
  }
  return {}
}

function primitiveSchema(checker: ts.TypeChecker, type: ts.Type): JsonSchema | undefined {
  if (type.flags & ts.TypeFlags.StringLiteral) return { type: "string", const: (type as ts.StringLiteralType).value }
  if (type.flags & ts.TypeFlags.NumberLiteral) return { type: "number", const: (type as ts.NumberLiteralType).value }
  if (type.flags & ts.TypeFlags.BooleanLiteral) return { type: "boolean", const: checker.typeToString(type) === "true" }
  if (type.flags & ts.TypeFlags.StringLike) return { type: "string" }
  if (type.flags & ts.TypeFlags.NumberLike) return { type: "number" }
  if (type.flags & ts.TypeFlags.BooleanLike) return { type: "boolean" }
  if (type.flags & ts.TypeFlags.Null) return { type: "null" }
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return {}
  return undefined
}

function mergeObjectSchemas(schemas: readonly JsonSchema[]): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    properties: Object.assign({}, ...schemas.map((schema) => schema.properties as Record<string, unknown> | undefined)),
    required: [...new Set(schemas.flatMap((schema) => Array.isArray(schema.required) ? schema.required as string[] : []))],
  }
}

function schemaModule(exportName: string, schema: JsonSchema): string {
  return [
    "/* eslint-disable */",
    "// This file is generated by contract facts. Do not edit by hand.",
    "",
    `export const ${exportName} = ${JSON.stringify(schema, null, 2)} as const`,
    "",
  ].join("\n")
}

function capabilityIndex(fact: ContractFact): string {
  return [
    "/* eslint-disable */",
    "// This file is generated by contract facts. Do not edit by hand.",
    "",
    `export type { ${fact.input.export} } from ${JSON.stringify(`./${stripTsExtension(normalizeFactSource(fact.input.source))}`)}`,
    `export type { ${fact.output.export} } from ${JSON.stringify(`./${stripTsExtension(normalizeFactSource(fact.output.source))}`)}`,
    'export { inputSchema } from "./input.schema.generated"',
    'export { outputSchema } from "./output.schema.generated"',
    "",
  ].join("\n")
}

function schemaCatalog(category: string, records: readonly ContractFactRecord[], sourceRoot: string): string {
  const imports = records.map((record, index) => {
    const dir = relative(join(sourceRoot, category), record.directory).split(/[\\/]/).join("/")
    return `import { inputSchema as input${index}, outputSchema as output${index} } from ${JSON.stringify(`./${dir}`)}`
  })
  return [
    "/* eslint-disable */",
    "// This file is generated by contract facts. Do not edit by hand.",
    "",
    ...imports,
    "",
    `export const schemaCatalog = [${records.flatMap((_, index) => [`input${index}`, `output${index}`]).join(", ")}] as const`,
    "",
  ].join("\n")
}

function stripTsExtension(source: string): string {
  return source.replace(/\.ts$/, "")
}

async function findObsoleteGeneratedPaths(
  sourceRoot: string,
  expectedFiles: readonly GeneratedFile[],
): Promise<string[]> {
  const expected = new Set(expectedFiles.map((file) => resolve(file.path)))
  const obsolete: string[] = []
  await walk(sourceRoot, async (path, name) => {
    if (
      name === "input.schema.generated.ts"
      || name === "output.schema.generated.ts"
      || name === "schema-catalog.generated.ts"
    ) {
      if (!expected.has(resolve(path))) obsolete.push(path)
      return
    }
    if (name !== "index.ts" || expected.has(resolve(path))) return
    const content = await readFile(path, "utf8")
    if (content.includes("This file is generated by contract facts. Do not edit by hand.")) {
      obsolete.push(path)
    }
  })
  return obsolete.sort()
}

async function reconcileGeneratedFiles(input: {
  packageRoot: string
  files: readonly GeneratedFile[]
  obsoletePaths: readonly string[]
  checkOnly: boolean
}) {
  if (input.checkOnly) {
    const stale: string[] = []
    for (const file of input.files) {
      const current = await readFile(file.path, "utf8").catch(() => undefined)
      if (current !== file.content) stale.push(relative(input.packageRoot, file.path))
    }
    for (const obsoletePath of input.obsoletePaths) {
      if (await readFile(obsoletePath, "utf8").then(() => true).catch(() => false)) {
        stale.push(relative(input.packageRoot, obsoletePath))
      }
    }
    if (stale.length > 0) {
      throw new Error(`Generated contract schema files are stale:\n${stale.join("\n")}`)
    }
    return
  }

  for (const file of input.files) {
    await mkdir(dirname(file.path), { recursive: true })
    await writeFile(file.path, file.content, "utf8")
  }
  await Promise.all(input.obsoletePaths.map((path) => rm(path, { force: true })))
}

export const contractSchemaCompilerPackage = {
  role: "framework",
  area: "contract-schema-compiler",
  owns: "TypeScript type-system driven contract schema projections",
} as const
