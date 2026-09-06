import { createHash } from "node:crypto"
import ts from "typescript"
import { canonicalResourcePackageSourcePath, type ResourcePackageReadPort } from "halfcode-compiler-resource-core"
import type { CodeBinding } from "./index"

/** The complete emit profile is versioned; changing it invalidates old closures. */
export const CODE_CLOSURE_COMPILER_IDENTITY = "typescript@5.9.3/commonjs-es2022-interop/closure-v2"
export interface CodeExecutionEnvironment {
  readonly hostIdentity: string
  readonly ambient: Readonly<Record<string, string>>
}
export interface CodeClosureCaptureRuntime { readonly source: ResourcePackageReadPort }
export interface CaptureCodeClosureInput {
  readonly binding: CodeBinding
  readonly sourceRoot: string
  readonly entryPath: string
  /** Paths relative to sourceRoot; imports of non-code files require a declaration. */
  readonly assets?: Readonly<Record<string, "text" | "json">>
  readonly environment: CodeExecutionEnvironment
}
export interface FrozenCodeDependency {
  readonly specifier: string
  readonly kind: "module" | "asset" | "ambient"
  readonly target: string
}
export interface FrozenCodeModule {
  readonly path: string
  readonly source: string
  readonly sourceDigest: string
  readonly code: string
  readonly codeDigest: string
  readonly dependencies: readonly FrozenCodeDependency[]
}
export interface FrozenCodeAsset {
  readonly path: string
  readonly format: "text" | "json"
  readonly content: string
  readonly contentDigest: string
}
/** Immutable recovery material. Its digest must be pinned by the admitting owner. */
export interface FrozenCodeClosure {
  readonly format: "halfcode-code-closure/v1"
  readonly compilerIdentity: string
  readonly binding: CodeBinding
  readonly entryPath: string
  readonly environment: CodeExecutionEnvironment
  readonly modules: readonly FrozenCodeModule[]
  readonly assets: readonly FrozenCodeAsset[]
  readonly digest: string
}
export class CodeClosureError extends Error {
  constructor(readonly code: string, message: string) { super(`${code}: ${message}`); this.name = "CodeClosureError" }
}
function fail(code: string, message: string): never { throw new CodeClosureError(code, message) }
/** Reject active objects before reading values or invoking JSON serialization. */
function assertJsonData(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return
  if (typeof value !== "object") fail("invalid-closure-data", "Expected closed JSON data")
  if (ancestors.has(value)) fail("invalid-closure-data", "Cyclic closure data is unsupported")
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== (Array.isArray(value) ? Array.prototype : Object.prototype) && prototype !== null) fail("invalid-closure-data", "Exotic closure objects are unsupported")
  ancestors.add(value)
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === "length") continue
    const property = Object.getOwnPropertyDescriptor(value, key)!
    if (typeof key !== "string" || !property.enumerable || !("value" in property)) fail("invalid-closure-data", "Accessors and non-JSON properties are unsupported")
    if (Array.isArray(value) && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) fail("invalid-closure-data", "Array properties must be indexes")
    assertJsonData(property.value, ancestors)
  }
  if (Array.isArray(value) && Object.keys(value).length !== value.length) fail("invalid-closure-data", "Sparse arrays are unsupported")
  ancestors.delete(value)
}
function comparePaths(a: string, b: string): number {
  if (a < b) return -1
  return a > b ? 1 : 0
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`
  return JSON.stringify(value)
}
function digest(value: Omit<FrozenCodeClosure, "digest">): string { return createHash("sha256").update(stable(value)).digest("hex") }
function contentDigest(value: string): string { return createHash("sha256").update(value).digest("hex") }
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}
function relativePath(path: string): string {
  if (!path || path.startsWith("/") || path.includes("\\") || path.includes("\0") || path.includes("?") || path.includes("#") || path.split("/").some((part) => !part || part === "." || part === "..")) fail("invalid-path", `Noncanonical closure path: ${path}`)
  return path
}
function localTarget(from: string, specifier: string): string {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) fail("outside-source-root", `Unsupported local path ${specifier}`)
  if (/[\\\0?#]/.test(specifier)) fail("invalid-path", `Unsupported module specifier ${specifier}`)
  const parts = from.split("/").slice(0, -1)
  for (const part of specifier.split("/")) {
    if (part === ".") continue
    if (part === "..") { if (!parts.length) fail("outside-source-root", `${from} imports outside source root: ${specifier}`); parts.pop() }
    else { if (!part) fail("invalid-path", specifier); parts.push(part) }
  }
  return relativePath(parts.join("/"))
}
const codeExtension = /\.(?:[cm]?[jt]s)$/
function candidates(target: string): string[] {
  if (codeExtension.test(target)) {
    // TypeScript's .js-to-.ts source substitution, without a live module resolver.
    const substituted = target.replace(/\.js$/, ".ts").replace(/\.mjs$/, ".mts").replace(/\.cjs$/, ".cts")
    return [...new Set([substituted, target])]
  }
  if (/\.[^/]+$/.test(target)) return [target]
  return [target, ...[".ts", ".js", ".mts", ".mjs", ".cts", ".cjs", "/index.ts", "/index.js"].map((extension) => target + extension)]
}
function checkEnvironment(environment: CodeExecutionEnvironment): void {
  assertJsonData(environment)
  if (!environment || typeof environment.hostIdentity !== "string" || !environment.hostIdentity || !environment.ambient || Array.isArray(environment.ambient) || typeof environment.ambient !== "object") fail("invalid-environment", "Expected host identity and ambient identities")
  for (const [specifier, identity] of Object.entries(environment.ambient)) {
    if (!specifier || specifier.startsWith(".") || specifier.startsWith("/") || /[\\\0]/.test(specifier) || typeof identity !== "string" || !identity) fail("invalid-environment", `Invalid ambient identity: ${specifier}`)
  }
}
function bindingEntry(binding: CodeBinding): string {
  if (!binding || typeof binding.packageName !== "string" || !binding.packageName || typeof binding.exportName !== "string" || !binding.exportName || typeof binding.module !== "string" || !binding.module.startsWith("./")) fail("invalid-binding", "Closure binding requires a package-owned ./ module and export")
  const entry = relativePath(binding.module.slice(2))
  if (binding.moduleSpecifier !== `${binding.packageName}/${entry}`) fail("invalid-binding", "CodeBinding moduleSpecifier does not match package/module")
  return entry
}
function compile(path: string, source: string): { code: string; specifiers: string[] } {
  if (ts.version !== "5.9.3") fail("compiler-mismatch", `Expected TypeScript 5.9.3; found ${ts.version}`)
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.ES2022, true, /\.[cm]?js$/.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS)
  const specifiers = new Set<string>()
  const walk = (node: ts.Node, functionDepth: number): void => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) fail("unsupported-dynamic-import", `${path}: dynamic import cannot be frozen`)
    if (ts.isIdentifier(node) && node.text === "require") fail("unsupported-require", `${path}: require and aliases are unsupported; use static imports`)
    if (ts.isImportEqualsDeclaration(node)) fail("unsupported-require", `${path}: import-equals is unsupported`)
    if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) fail("unsupported-import-meta", `${path}: import.meta is unsupported`)
    if (!functionDepth && (ts.isAwaitExpression(node) || (ts.isForOfStatement(node) && node.awaitModifier))) fail("unsupported-top-level-await", `${path}: top-level await is unsupported`)
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      if (ts.isImportDeclaration(node) && node.importClause) {
        const clause = node.importClause
        if (clause.isTypeOnly || (!clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every((element) => element.isTypeOnly))) return
      }
      if (ts.isExportDeclaration(node) && (node.isTypeOnly || (node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length > 0 && node.exportClause.elements.every((element) => element.isTypeOnly)))) return
      if (!ts.isStringLiteral(node.moduleSpecifier)) fail("unsupported-import", `${path}: module specifier must be a string literal`)
      if (node.attributes) fail("unsupported-import-attributes", `${path}: use declared closure assets without import attributes`)
      specifiers.add(node.moduleSpecifier.text)
    }
    ts.forEachChild(node, (child) => walk(child, functionDepth + (ts.isFunctionLike(node) ? 1 : 0)))
  }
  walk(tree, 0)
  // TypeScript preserves ESM for .mts/.mjs regardless of ModuleKind.CommonJS.
  // Normalize only the compiler's virtual filename; closure paths retain their identity.
  const emitPath = path.replace(/\.mts$/, ".ts").replace(/\.mjs$/, ".js")
  const emitted = ts.transpileModule(source, { fileName: emitPath, reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, sourceMap: false, inlineSourceMap: false, removeComments: false } })
  const errors = emitted.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error) ?? []
  if (errors.length) fail("invalid-source", `${path}: ${errors.map((item) => ts.flattenDiagnosticMessageText(item.messageText, " ")).join("; ")}`)
  return { code: emitted.outputText, specifiers: [...specifiers].sort() }
}

export async function captureCodeClosure(runtime: CodeClosureCaptureRuntime, input: CaptureCodeClosureInput): Promise<FrozenCodeClosure> {
  checkEnvironment(input.environment)
  const root = canonicalResourcePackageSourcePath(input.sourceRoot)
  const sourcePath = canonicalResourcePackageSourcePath(input.entryPath)
  const bindingPath = bindingEntry(input.binding)
  const absolute = (path: string) => root === "/" ? `/${path}` : `${root}/${path}`
  const entryPath = candidates(bindingPath).find((candidate) => absolute(candidate) === sourcePath)
  if (!entryPath) fail("invalid-binding", "entryPath must resolve CodeBinding.module within sourceRoot")
  const declarations = { ...input.assets }
  for (const [path, format] of Object.entries(declarations)) {
    relativePath(path)
    if (format !== "text" && format !== "json") fail("invalid-asset", `Unsupported asset format: ${format}`)
    if (codeExtension.test(path)) fail("invalid-asset", `Code cannot be declared as an asset: ${path}`)
  }
  const modules = new Map<string, FrozenCodeModule>()
  const assets = new Map<string, FrozenCodeAsset>()
  const hasFile = async (path: string): Promise<boolean> => {
    const full = absolute(path)
    const segments = full.slice(1).split("/")
    for (let i = 1; i <= segments.length; i++) {
      const prefix = `/${segments.slice(0, i).join("/")}`
      const info = await runtime.source.stat(prefix)
      if (info?.kind === "symlink") fail("symlink-source", `Symlink source is unsupported: ${prefix}`)
      if (i === segments.length) return info?.kind === "file"
    }
    return false
  }
  const read = async (path: string): Promise<string> => {
    if (!await hasFile(path)) fail("missing-source", `Missing source file: ${path}`)
    const bytes = await runtime.source.readBytes(absolute(path))
    if (!bytes) fail("missing-source", `Unreadable source file: ${path}`)
    // Preserve a leading BOM as content so frozen text and digests retain source bytes.
    try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) } catch { return fail("invalid-source", `Expected UTF-8: ${path}`) }
  }
  const visit = async (path: string): Promise<void> => {
    if (modules.has(path)) return
    if (!codeExtension.test(path) || /\.d\.[cm]?ts$/.test(path)) fail("unsupported-module", `Expected executable TS/JS module: ${path}`)
    const source = await read(path)
    const result = compile(path, source)
    const dependencies: FrozenCodeDependency[] = []
    modules.set(path, { path, source, sourceDigest: contentDigest(source), code: result.code, codeDigest: contentDigest(result.code), dependencies })
    for (const specifier of result.specifiers) {
      if (specifier.startsWith(".")) {
        const target = localTarget(path, specifier)
        if (Object.hasOwn(declarations, target)) {
          dependencies.push({ specifier, kind: "asset", target })
        } else {
          if (!codeExtension.test(target) && /\.[^/]+$/.test(target)) fail("undeclared-asset", `${path}: asset must be declared: ${specifier}`)
          let resolved: string | undefined
          for (const candidate of candidates(target)) if (await hasFile(candidate)) { resolved = candidate; break }
          if (!resolved) fail("missing-module", `${path}: cannot freeze ${specifier}`)
          dependencies.push({ specifier, kind: "module", target: resolved })
          await visit(resolved)
        }
      } else {
        if (specifier.startsWith("/") || specifier.startsWith("file:") || specifier.includes("\\")) fail("outside-source-root", `${path}: ${specifier}`)
        if (!Object.hasOwn(input.environment.ambient, specifier)) fail("undeclared-ambient", `${path}: ambient dependency not declared: ${specifier}`)
        dependencies.push({ specifier, kind: "ambient", target: specifier })
      }
    }
  }
  await visit(entryPath)
  for (const [path, format] of Object.entries(declarations).sort(([a], [b]) => comparePaths(a, b))) {
    const content = await read(path)
    if (format === "json") { try { JSON.parse(content) } catch { fail("invalid-asset", `Invalid JSON asset: ${path}`) } }
    assets.set(path, { path, format, content, contentDigest: contentDigest(content) })
  }
  const payload: Omit<FrozenCodeClosure, "digest"> = { format: "halfcode-code-closure/v1", compilerIdentity: CODE_CLOSURE_COMPILER_IDENTITY, binding: { ...input.binding }, entryPath, environment: { hostIdentity: input.environment.hostIdentity, ambient: { ...input.environment.ambient } }, modules: [...modules.values()].sort((a, b) => comparePaths(a.path, b.path)), assets: [...assets.values()] }
  const closure = { ...payload, digest: digest(payload) }
  validateCodeClosure(closure, input.environment, closure.digest)
  return freeze(closure)
}

/** Pure validation: no source reader, live imports, or module execution. */
export function validateCodeClosure(closure: FrozenCodeClosure, environment: CodeExecutionEnvironment, expectedDigest: string): void {
  if (typeof expectedDigest !== "string" || !/^[a-f0-9]{64}$/.test(expectedDigest)) fail("invalid-digest", "A trusted expected digest is required")
  assertJsonData(closure)
  if (!closure || typeof closure !== "object" || closure.digest !== expectedDigest) fail("digest-mismatch", "Closure differs from the trusted expected digest")
  const { digest: actualDigest, ...payload } = closure
  if (digest(payload) !== actualDigest) fail("digest-mismatch", "Closure contents do not match digest")
  if (closure.format !== "halfcode-code-closure/v1") fail("unsupported-format", "Unsupported code closure format")
  if (closure.compilerIdentity !== CODE_CLOSURE_COMPILER_IDENTITY || ts.version !== "5.9.3") fail("compiler-mismatch", "Closure compiler identity mismatch")
  checkEnvironment(environment); checkEnvironment(closure.environment)
  if (stable(environment) !== stable(closure.environment)) fail("environment-mismatch", "Execution environment identity mismatch")
  if (!candidates(bindingEntry(closure.binding)).includes(closure.entryPath)) fail("invalid-binding", "Closure entry does not match binding")
  if (!Array.isArray(closure.modules) || !Array.isArray(closure.assets)) fail("invalid-closure", "Expected modules and assets")
  const modules = new Map<string, FrozenCodeModule>()
  const assets = new Map<string, FrozenCodeAsset>()
  for (const module of closure.modules) {
    relativePath(module.path)
    if (!codeExtension.test(module.path) || /\.d\.[cm]?ts$/.test(module.path) || modules.has(module.path) || typeof module.source !== "string" || typeof module.code !== "string" || !Array.isArray(module.dependencies)) fail("invalid-module", `Invalid module: ${module.path}`)
    if (module.sourceDigest !== contentDigest(module.source) || module.codeDigest !== contentDigest(module.code)) fail("file-digest-mismatch", `Module content digest mismatch: ${module.path}`)
    modules.set(module.path, module)
  }
  for (const asset of closure.assets) {
    relativePath(asset.path)
    if (assets.has(asset.path) || modules.has(asset.path) || codeExtension.test(asset.path) || typeof asset.content !== "string" || !["text", "json"].includes(asset.format)) fail("invalid-asset", `Invalid asset: ${asset.path}`)
    if (asset.contentDigest !== contentDigest(asset.content)) fail("file-digest-mismatch", `Asset content digest mismatch: ${asset.path}`)
    if (asset.format === "json") { try { JSON.parse(asset.content) } catch { fail("invalid-asset", `Invalid JSON asset: ${asset.path}`) } }
    assets.set(asset.path, asset)
  }
  if (!modules.has(closure.entryPath)) fail("missing-entry", "Closure entry module is absent")
  for (const module of modules.values()) {
    const compiled = compile(module.path, module.source)
    if (compiled.code !== module.code) fail("invalid-emit", `Compiled code differs from frozen source: ${module.path}`)
    if (stable(compiled.specifiers) !== stable(module.dependencies.map((edge) => edge.specifier).sort())) fail("invalid-edge", `Dependency set differs from source: ${module.path}`)
    for (const edge of module.dependencies) {
      if (edge.specifier.startsWith(".")) {
        const target = localTarget(module.path, edge.specifier)
        if (edge.kind === "asset" && edge.target === target && assets.has(edge.target)) continue
        if (edge.kind === "module" && candidates(target).includes(edge.target) && modules.has(edge.target)) continue
      } else if (edge.kind === "ambient" && edge.target === edge.specifier && Object.hasOwn(environment.ambient, edge.target) && !edge.target.startsWith("/") && !edge.target.startsWith("file:")) continue
      fail("invalid-edge", `Invalid dependency target: ${module.path} -> ${edge.specifier}`)
    }
  }
  const reachable = new Set<string>()
  const visit = (path: string): void => {
    if (reachable.has(path)) return
    reachable.add(path)
    for (const edge of modules.get(path)!.dependencies) {
      if (edge.kind === "module") visit(edge.target)
    }
  }
  visit(closure.entryPath)
  if (reachable.size !== modules.size) fail("invalid-closure", "Closure contains unreachable modules")
}
