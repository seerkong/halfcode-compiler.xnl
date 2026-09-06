import { lstat, readFile, realpath } from "node:fs/promises"
import { dirname, isAbsolute, relative, resolve, sep } from "node:path"
import { compareCodeUnits } from "./canonical"
import { sha256Digest, type ResourceDigestContribution } from "./dependency-snapshot"
import { isAuthoredResourceTreeAuthentic } from "./authored-resource-tree-brand"
import type { AuthoredResourceTree, ResourceDiagnostic, ResourceRecord } from "./index"

export interface ReadResourceMaterialInput {
  readonly tree: AuthoredResourceTree
  readonly rootDir: string
  readonly resourceId: string
  readonly uri: string
}

export interface ResourceMaterial {
  readonly resourceId: string
  readonly uri: string
  readonly sourceUri: string
  readonly digest: string
  readonly contribution: ResourceDigestContribution
  bytes(): Uint8Array
}

export class ResourceMaterialError extends Error {
  readonly diagnostics: readonly ResourceDiagnostic[]

  constructor(diagnostics: readonly ResourceDiagnostic[]) {
    super(`Resource material read failed with ${diagnostics.length} diagnostic(s)`)
    this.name = "ResourceMaterialError"
    this.diagnostics = Object.freeze([...diagnostics].sort((left, right) =>
      compareCodeUnits(left.location, right.location) || compareCodeUnits(left.code, right.code),
    ))
  }
}

export async function readResourceMaterial(input: ReadResourceMaterialInput): Promise<ResourceMaterial> {
  if (!isAuthoredResourceTreeAuthentic(input.tree)) {
    throw materialError("RESOURCE_MATERIAL_TREE_UNTRUSTED", input.resourceId, "Resource materials require an authentic AuthoredResourceTree.")
  }
  const record = findResource(input.tree, input.resourceId)
  const identity = input.tree.contentIdentities.get(input.resourceId)
  if (!record || record.sourceShape !== "directory" || !identity) {
    throw materialError("RESOURCE_MATERIAL_RESOURCE_INVALID", input.resourceId, `Resource '${input.resourceId}' is not an authentic directory resource.`)
  }
  const materialPath = materialRelativePath(input.uri)
  if (!materialPath) {
    throw materialError("RESOURCE_MATERIAL_URI_INVALID", input.resourceId, "Resource material URI must be a non-empty lexical-safe vfs://./ reference.")
  }

  const requestedRoot = resolve(input.rootDir)
  const root = await realpath(requestedRoot).catch(() => requestedRoot)
  const authorityCandidate = resolve(root, record.logicalPath)
  const authorityPath = await realpath(authorityCandidate).catch(() => authorityCandidate)
  if (!contains(root, authorityPath)
    || record.documentUri !== documentUri(root, authorityPath)
    || sha256Digest(await readFile(authorityPath).catch(() => new Uint8Array())) !== identity.authorityDigest) {
    throw materialError("RESOURCE_MATERIAL_AUTHORITY_MISMATCH", input.resourceId, "Directory resource authority does not match the loaded tree provenance.")
  }

  const ownerDirectory = dirname(authorityPath)
  const candidate = resolve(ownerDirectory, materialPath)
  if (!contains(ownerDirectory, candidate)) {
    throw materialError("RESOURCE_MATERIAL_URI_INVALID", input.resourceId, "Resource material URI escapes its owning directory resource.")
  }
  const before = await lstat(candidate).catch(() => undefined)
  if (!before) {
    throw materialError("RESOURCE_MATERIAL_MISSING", input.resourceId, `Resource material '${input.uri}' does not exist.`)
  }
  if (before.isSymbolicLink()) {
    throw materialError("RESOURCE_MATERIAL_SYMLINK_UNSUPPORTED", input.resourceId, `Resource material '${input.uri}' must not be a symbolic link.`)
  }
  if (!before.isFile()) {
    throw materialError("RESOURCE_MATERIAL_NOT_FILE", input.resourceId, `Resource material '${input.uri}' must be a regular file.`)
  }
  const canonicalPath = await realpath(candidate).catch(() => candidate)
  if (!contains(ownerDirectory, canonicalPath)) {
    throw materialError("RESOURCE_MATERIAL_CONTAINMENT", input.resourceId, `Resource material '${input.uri}' resolves outside its owning directory resource.`)
  }
  const source = await readFile(canonicalPath).catch(() => undefined)
  const after = await lstat(candidate).catch(() => undefined)
  const afterCanonical = await realpath(candidate).catch(() => undefined)
  if (!source || !after || after.isSymbolicLink() || !after.isFile() || afterCanonical !== canonicalPath) {
    throw materialError("RESOURCE_MATERIAL_CHANGED", input.resourceId, `Resource material '${input.uri}' changed while it was being read.`)
  }

  const bytes = new Uint8Array(source)
  const digest = sha256Digest(bytes)
  const sourceUri = documentUri(root, canonicalPath)
  const contribution = Object.freeze({
    key: `material:${input.uri}`,
    digest,
    sourceUri,
  })
  return Object.freeze({
    resourceId: input.resourceId,
    uri: input.uri,
    sourceUri,
    digest,
    contribution,
    bytes: () => new Uint8Array(bytes),
  })
}

function materialRelativePath(uri: string): string | undefined {
  const match = /^vfs:\/\/\.\/(.+)$/u.exec(uri)
  if (!match || /%2f|%5c/i.test(uri)) return undefined
  let decoded: string
  try {
    decoded = decodeURIComponent(match[1]!)
  } catch {
    return undefined
  }
  const segments = decoded.split(/[\\/]+/u)
  if (isAbsolute(decoded)
    || decoded.includes("\\")
    || segments.some((segment) => !segment || segment === "." || segment === "..")) return undefined
  return segments.join(sep)
}

function findResource(tree: AuthoredResourceTree, resourceId: string): ResourceRecord | undefined {
  for (const records of tree.registry.byKind.values()) {
    const record = records.find((item) => item.resourceId === resourceId)
    if (record) return record
  }
  return undefined
}

function contains(boundary: string, candidate: string): boolean {
  return candidate === boundary || candidate.startsWith(`${boundary}${sep}`)
}

function documentUri(root: string, filePath: string): string {
  return `vfs://@/${relative(root, filePath).split(sep).join("/")}`
}

function materialError(code: string, resourceId: string, message: string): ResourceMaterialError {
  return new ResourceMaterialError([Object.freeze({ code, location: `resource-material:${resourceId || "unknown"}`, message })])
}
