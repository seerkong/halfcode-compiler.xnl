import { copyFile, lstat, mkdir, readdir } from "node:fs/promises"
import { dirname, join, posix, relative, resolve, sep } from "node:path"
import { parseXnl, wordToString, type DataElementNode, type XnlNode } from "xnl-core"

export type ResourceMappingOperationKind = "CopyDirectory" | "CopyFile"

export interface ResourceMappingOperation {
  kind: ResourceMappingOperationKind
  from: string
  to: string
}

export interface NamedResourceMapping {
  id: string
  sourceRoot: string
  operations: readonly ResourceMappingOperation[]
}

export interface ResourceMappings {
  referenceTargets: ReadonlyMap<string, string>
  callableArtifactsTarget: string
  sources: readonly NamedResourceMapping[]
  source: { uri: string }
}

export interface PlannedResourceCopy {
  sourcePath: string
  targetRelativePath: string
  mappingId: string
}

export interface ResourceMappingPlan {
  entries: readonly PlannedResourceCopy[]
}

export interface PlanResourceMappingsOptions {
  moduleRoots: ReadonlyMap<string, string> | Readonly<Record<string, string>>
  defaultSourceRoot?: string
  reservedTargetPaths?: readonly string[]
}

export type SafePathLexicalKind = "segment" | "relative-path" | "relative-directory"

export class ResourceMappingPathError extends Error {
  readonly code = "RESOURCE_MAPPING_PATH_INVALID"

  constructor(
    readonly uri: string,
    readonly attribute: "from" | "to",
    readonly owner: string,
    readonly rawPath: string,
    readonly issue: string,
  ) {
    super(`RESOURCE_MAPPING_PATH_INVALID: ${uri} owner ${owner} raw ${attribute} ${JSON.stringify(rawPath)}: ${issue}`)
    this.name = "ResourceMappingPathError"
  }
}

export function parseResourceMappings(source: string, uri = "vfs://./resource-mappings.xnl"): ResourceMappings {
  let root: DataElementNode
  try {
    const document = parseXnl(source)
    if (document.warnings?.length || document.nodes.length !== 1 || !isDataElement(document.nodes[0])) {
      throw new Error("expected exactly one ResourceMappings data root without warnings")
    }
    root = document.nodes[0]
  } catch (error) {
    throw new Error(`Invalid ResourceMappings at ${uri}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (root.tag !== "ResourceMappings") throw new Error(`Invalid ResourceMappings at ${uri}: root must be ResourceMappings`)

  const referenceTargets = new Map<string, string>()
  for (const entry of bodyElements(extension(root, "ReferenceTargets"), "ReferenceTarget")) {
    const kind = requiredXnlProperty(entry, "kind", uri)
    if (referenceTargets.has(kind)) throw new Error(`Invalid ResourceMappings at ${uri}: duplicate ReferenceTarget kind ${kind}`)
    referenceTargets.set(kind, normalizeOutputDirectory(
      requiredXnlPathProperty(entry, "target", uri),
      uri,
      `generated-reference:${kind}`,
    ))
  }

  const callable = extension(root, "CallableArtifacts")
  const callableArtifactsTarget = normalizeOutputDirectory(
    callable ? requiredXnlPathProperty(callable, "target", uri) : "functions/",
    uri,
    "generated-callable-artifacts",
  )
  const sources = bodyElements(extension(root, "SourceRoots"), "SourceRoot").map((entry) => {
    const id = wordToString(entry.id)
    if (!id || !/^[A-Z][A-Za-z0-9]*$/.test(id)) {
      throw new Error(`Invalid ResourceMappings at ${uri}: SourceRoot #id must be a PascalCase segment`)
    }
    const operations = (entry.body ?? [])
      .filter(isDataElement)
      .filter((operation) => operation.tag === "CopyDirectory" || operation.tag === "CopyFile")
      .map((operation) => {
        const owner = `mapping:${id}:${operation.tag}`
        return {
          kind: operation.tag as ResourceMappingOperationKind,
          from: normalizeRelativePath(requiredXnlPathProperty(operation, "from", uri), uri, "from", owner),
          to: normalizeRelativePath(requiredXnlPathProperty(operation, "to", uri), uri, "to", owner),
        }
      })
    return { id, sourceRoot: requiredXnlProperty(entry, "sourceRoot", uri), operations }
  })
  if (new Set(sources.map((item) => item.id)).size !== sources.length) {
    throw new Error(`Invalid ResourceMappings at ${uri}: SourceRoot ids must be unique`)
  }
  return { referenceTargets, callableArtifactsTarget, sources, source: { uri } }
}

function extension(node: DataElementNode, name: string): DataElementNode | undefined {
  const child = node.extend?.children[name]
  return child?.kind === "DataElement" ? child : undefined
}

function bodyElements(node: DataElementNode | undefined, tag: string): DataElementNode[] {
  return (node?.body ?? []).filter(isDataElement).filter((entry) => entry.tag === tag)
}

function requiredXnlProperty(node: DataElementNode, name: string, uri: string): string {
  const value = node.attributes?.[name]
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid ResourceMappings at ${uri}: <${node.tag}> requires ${name}`)
  }
  return value
}

function requiredXnlPathProperty(node: DataElementNode, name: "from" | "target" | "to", uri: string): string {
  const value = node.attributes?.[name]
  if (typeof value !== "string") {
    throw new Error(`Invalid ResourceMappings at ${uri}: <${node.tag}> requires ${name}`)
  }
  return value
}

function isDataElement(value: XnlNode | undefined): value is DataElementNode {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "kind" in value && value.kind === "DataElement"
}

export async function planResourceMappings(
  mappings: ResourceMappings,
  options: PlanResourceMappingsOptions,
): Promise<ResourceMappingPlan> {
  const roots = asRootMap(options.moduleRoots)
  const claims: { target: string; mappingId: string; from: string }[] = []
  const entries: PlannedResourceCopy[] = []
  const reserved = (options.reservedTargetPaths ?? []).map((path) =>
    normalizeRelativePath(path, mappings.source.uri, "to", `generated-reserved:${path}`))
  const normalizedSources = mappings.sources.map((mapping) => ({
    ...mapping,
    operations: mapping.operations.map((operation) => {
      const owner = `mapping:${mapping.id}:${operation.kind}`
      return {
        ...operation,
        from: normalizeRelativePath(operation.from, mappings.source.uri, "from", owner),
        to: normalizeRelativePath(operation.to, mappings.source.uri, "to", owner),
      }
    }),
  }))

  for (const mapping of normalizedSources) {
    const sourceRootPath = resolveSourceRoot(mapping.sourceRoot, roots, options.defaultSourceRoot, mappings.source.uri)
    await assertDirectory(sourceRootPath, mappings.source.uri, mapping.sourceRoot)
    for (const operation of mapping.operations) {
      const owner = `mapping:${mapping.id}:${operation.kind}`
      const from = operation.from
      const to = operation.to
      for (const prior of claims) {
        if (pathsOverlap(prior.target, to)) {
          throw new Error(`ResourceMappings target collision between ${prior.mappingId}:${prior.from} -> ${prior.target} and ${mapping.id}:${from} -> ${to}`)
        }
      }
      claims.push({ target: to, mappingId: mapping.id, from })
      const sourcePath = safeResolve(sourceRootPath, from, mappings.source.uri)
      if (operation.kind === "CopyFile") {
        await assertFile(sourcePath, mappings.source.uri, from)
        assertNotReserved(to, reserved, mappings.source.uri)
        entries.push({ sourcePath, targetRelativePath: to, mappingId: mapping.id })
        continue
      }
      await assertDirectory(sourcePath, mappings.source.uri, from)
      for (const filePath of await listFiles(sourcePath, mappings.source.uri)) {
        const child = normalizeRelativePath(
          relative(sourcePath, filePath).split(sep).join("/"),
          mappings.source.uri,
          "from",
          `${owner}:source-child`,
        )
        const targetRelativePath = posix.join(to, child)
        assertSafeResourceMappingPath(targetRelativePath, mappings.source.uri, "to", owner, "relative-path")
        assertNotReserved(targetRelativePath, reserved, mappings.source.uri)
        entries.push({ sourcePath: filePath, targetRelativePath, mappingId: mapping.id })
      }
    }
  }

  const seenTargets = new Map<string, PlannedResourceCopy>()
  for (const entry of entries) {
    const prior = seenTargets.get(entry.targetRelativePath)
    if (prior) throw new Error(`ResourceMappings duplicate target ${entry.targetRelativePath} from ${prior.sourcePath} and ${entry.sourcePath}`)
    seenTargets.set(entry.targetRelativePath, entry)
  }
  return { entries: entries.sort((a, b) => compareCodeUnits(a.targetRelativePath, b.targetRelativePath)) }
}

export async function applyResourceMappingPlan(plan: ResourceMappingPlan, outputRoot: string): Promise<string[]> {
  for (const entry of plan.entries) {
    assertSafeResourceMappingPath(
      entry.targetRelativePath,
      "resource-mapping-plan",
      "to",
      `mapping:${entry.mappingId}:planned-copy`,
      "relative-path",
    )
  }
  const resolvedOutputRoot = resolve(outputRoot)
  const files: string[] = []
  for (const entry of plan.entries) {
    const target = resolve(resolvedOutputRoot, entry.targetRelativePath)
    if (!isWithinRoot(resolvedOutputRoot, target)) throw new Error(`ResourceMappings output escapes target root: ${entry.targetRelativePath}`)
    await mkdir(dirname(target), { recursive: true })
    await copyFile(entry.sourcePath, target)
    files.push(entry.targetRelativePath)
  }
  return files
}

function resolveSourceRoot(
  uri: string,
  roots: ReadonlyMap<string, string>,
  defaultSourceRoot: string | undefined,
  mappingUri: string,
): string {
  const moduleMatch = /^vfs:\/\/module\/([A-Z][A-Za-z0-9]*)\/(.*)$/.exec(uri)
  if (moduleMatch) {
    const base = roots.get(moduleMatch[1])
    if (!base) throw new Error(`Invalid ResourceMappings at ${mappingUri}: unknown module root ${moduleMatch[1]}`)
    return safeResolve(resolve(base), moduleMatch[2], mappingUri)
  }
  const localMatch = /^vfs:\/\/@\/(.*)$/.exec(uri)
  if (localMatch && defaultSourceRoot) return safeResolve(resolve(defaultSourceRoot), localMatch[1], mappingUri)
  throw new Error(`Invalid ResourceMappings at ${mappingUri}: unsupported sourceRoot ${uri}`)
}

async function listFiles(root: string, uri: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) => compareCodeUnits(a.name, b.name))) {
    const path = join(root, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Invalid ResourceMappings at ${uri}: symbolic links are not supported: ${path}`)
    if (entry.isDirectory()) files.push(...await listFiles(path, uri))
    else if (entry.isFile()) files.push(path)
    else throw new Error(`Invalid ResourceMappings at ${uri}: unsupported source entry ${path}`)
  }
  return files
}

async function assertDirectory(path: string, uri: string, label: string) {
  const info = await lstat(path).catch(() => undefined)
  if (!info || info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Invalid ResourceMappings at ${uri}: directory source does not exist: ${label}`)
}

async function assertFile(path: string, uri: string, label: string) {
  const info = await lstat(path).catch(() => undefined)
  if (!info || info.isSymbolicLink() || !info.isFile()) throw new Error(`Invalid ResourceMappings at ${uri}: file source does not exist: ${label}`)
}

function safeResolve(root: string, path: string, uri: string): string {
  const target = resolve(root, path)
  if (!isWithinRoot(root, target)) throw new Error(`Invalid ResourceMappings at ${uri}: path escapes source root: ${path}`)
  return target
}

function isWithinRoot(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}${sep}`)
}

function assertNotReserved(path: string, reserved: readonly string[], uri: string) {
  for (const item of reserved) {
    if (pathsOverlap(path, item)) throw new Error(`Invalid ResourceMappings at ${uri}: target ${path} conflicts with generated target ${item}`)
  }
}

function pathsOverlap(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)
}

function normalizeRelativePath(
  value: string,
  uri: string,
  attribute: "from" | "to",
  owner: string,
): string {
  assertSafeResourceMappingPath(value, uri, attribute, owner, "relative-directory")
  return value.endsWith("/") ? value.slice(0, -1) : value
}

function normalizeOutputDirectory(value: string, uri: string, owner: string): string {
  return `${normalizeRelativePath(value, uri, "to", owner)}/`
}

function assertSafeResourceMappingPath(
  value: string,
  uri: string,
  attribute: "from" | "to",
  owner: string,
  kind: SafePathLexicalKind,
): void {
  const issue = safePathLexicalIssue(value, kind)
  if (issue) throw new ResourceMappingPathError(uri, attribute, owner, value, issue)
}

export function safePathLexicalIssue(value: string, kind: SafePathLexicalKind): string | undefined {
  if (value.length === 0) return "path must be non-empty"
  const unicode = unsafeUnicodeCodeUnitIssue(value)
  if (unicode) return unicode
  if (value.includes("\\")) return "backslash separators are not allowed"
  if (value.startsWith("/")) return "absolute paths are not allowed"
  if (isWindowsDriveAbsolute(value)) return "Windows drive-absolute paths are not allowed"
  if (kind === "segment" && value.includes("/")) return "path segment must not contain a separator"

  const segments = kind === "segment" ? [value] : value.split("/")
  for (const [index, segment] of segments.entries()) {
    const isAllowedDirectoryMarker = kind === "relative-directory"
      && index === segments.length - 1
      && segment.length === 0
      && segments.length > 1
    if (segment.length === 0 && !isAllowedDirectoryMarker) return `path segment ${index} must be non-empty`
    if (isAllowedDirectoryMarker) continue
    if (segment.trim() !== segment) return `path segment ${index} has leading or trailing whitespace`
    if (segment === "." || segment === ".." || decodedDotSegment(segment)) {
      return `path segment ${index} must not be dot or parent traversal`
    }
    const encoded = unsafePercentEncodingIssue(segment)
    if (encoded) return `path segment ${index} ${encoded}`
  }
  return undefined
}

export function unsafeUnicodeCodeUnitIssue(value: string): string | undefined {
  for (let index = 0; index < value.length;) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit >= 0xD800 && codeUnit <= 0xDBFF) {
      const next = index + 1 < value.length ? value.charCodeAt(index + 1) : undefined
      if (next === undefined || next < 0xDC00 || next > 0xDFFF) {
        return `contains unpaired high surrogate ${formatCodePoint(codeUnit)} at UTF-16 index ${index}`
      }
      index += 2
      continue
    }
    if (codeUnit >= 0xDC00 && codeUnit <= 0xDFFF) {
      return `contains unpaired low surrogate ${formatCodePoint(codeUnit)} at UTF-16 index ${index}`
    }
    if (isUnsafeControlCodePoint(codeUnit)) {
      return `contains control code point ${formatCodePoint(codeUnit)} at UTF-16 index ${index}`
    }
    index += 1
  }
  return undefined
}

export function unsafeControlCodePointIssue(value: string): string | undefined {
  return unsafeUnicodeCodeUnitIssue(value)
}

function isUnsafeControlCodePoint(codePoint: number): boolean {
  return codePoint <= 0x1F || (codePoint >= 0x7F && codePoint <= 0x9F)
}

function formatCodePoint(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`
}

function isWindowsDriveAbsolute(value: string): boolean {
  if (value.length < 3 || value[1] !== ":" || value[2] !== "/") return false
  const first = value.charCodeAt(0)
  return (first >= 0x41 && first <= 0x5A) || (first >= 0x61 && first <= 0x7A)
}

function decodedDotSegment(segment: string): boolean {
  let decoded = ""
  for (let index = 0; index < segment.length;) {
    const byte = percentEncodedByteAt(segment, index)
    if (byte === 0x2E) {
      decoded += "."
      index += 3
    } else {
      decoded += segment[index]
      index += 1
    }
  }
  return decoded === "." || decoded === ".."
}

function unsafePercentEncodingIssue(segment: string): string | undefined {
  for (let index = 0; index < segment.length; index += 1) {
    const byte = percentEncodedByteAt(segment, index)
    if (byte === undefined) continue
    if (byte === 0x2F || byte === 0x5C) {
      return `contains encoded separator %${byte.toString(16).toUpperCase().padStart(2, "0")}`
    }
    if (isUnsafeControlCodePoint(byte)) {
      return `contains encoded control byte %${byte.toString(16).toUpperCase().padStart(2, "0")}`
    }
    index += 2
  }
  return undefined
}

function percentEncodedByteAt(value: string, index: number): number | undefined {
  if (value[index] !== "%" || index + 2 >= value.length) return undefined
  const high = asciiHexValue(value.charCodeAt(index + 1))
  const low = asciiHexValue(value.charCodeAt(index + 2))
  return high === undefined || low === undefined ? undefined : high * 16 + low
}

function asciiHexValue(code: number): number | undefined {
  if (code >= 0x30 && code <= 0x39) return code - 0x30
  if (code >= 0x41 && code <= 0x46) return code - 0x41 + 10
  if (code >= 0x61 && code <= 0x66) return code - 0x61 + 10
  return undefined
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function asRootMap(value: PlanResourceMappingsOptions["moduleRoots"]): ReadonlyMap<string, string> {
  return typeof (value as ReadonlyMap<string, string>).get === "function"
    ? value as ReadonlyMap<string, string>
    : new Map(Object.entries(value as Readonly<Record<string, string>>))
}

export const resourceMappingPackage = {
  role: "framework",
  area: "resource-mapping",
  owns: "declarative multi-root resource copy planning and collision preflight",
} as const
