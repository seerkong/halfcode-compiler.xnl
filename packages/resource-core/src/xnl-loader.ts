import { readdir, readFile, realpath, stat } from "node:fs/promises"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import {
  parseXnl,
  wordToString,
  type AttributeMap,
  type DataElementNode,
  type TextElementNode,
  type XnlNode,
} from "xnl-core"
import { compareCodeUnits } from "./canonical"
import { createResourceContentIdentity, sha256Digest, type ResourceContentIdentity } from "./dependency-snapshot"
import { markLoadedResourceTreeAuthentic } from "./loaded-resource-tree-brand"
import { readonlyMap } from "./readonly-map"
import type {
  LoadedResourceTree,
  LoadedResourceTreeBuildResult,
  LoadResourceTreeOptions,
  ResourceDiagnostic,
  ResourceMetadata,
  ResourceNode,
  ResourceRecord,
  RegisteredKindDefinition,
  ResourceValue,
  SourceShape,
} from "./index"

interface XnlCatalog {
  id: string
  kind: string
  shape: SourceShape
  root: string
  entry?: string
  location: string
}

interface LoaderContext {
  rootDir: string
  diagnostics: ResourceDiagnostic[]
  kindDefinitions: Map<string, RegisteredKindDefinition>
  resources: ResourceRecord[]
  seenIdentities: Map<string, string>
  authorityFiles: Map<string, Promise<AuthorityFileRead | undefined>>
  recordAuthorityDigests: WeakMap<ResourceRecord, string>
}

interface AuthorityFileRead {
  readonly source: string
  readonly authorityDigest: string
}

export async function buildXnlResourceTree(
  options: LoadResourceTreeOptions & { manifestPath: string },
): Promise<LoadedResourceTreeBuildResult> {
  const requestedRoot = resolve(options.rootDir)
  const context: LoaderContext = {
    rootDir: await realpath(requestedRoot).catch(() => requestedRoot),
    diagnostics: [],
    kindDefinitions: new Map(),
    resources: [],
    seenIdentities: new Map(),
    authorityFiles: new Map(),
    recordAuthorityDigests: new WeakMap(),
  }
  const manifestFile = resolve(context.rootDir, options.manifestPath)
  const manifest = await loadManifest(manifestFile, "manifest", context, true)
  if (!manifest || context.diagnostics.length > 0) {
    return { diagnostics: context.diagnostics }
  }

  const byKind = new Map<string, ResourceRecord[]>()
  for (const resource of context.resources) {
    const records = byKind.get(resource.kind) ?? []
    records.push(resource)
    byKind.set(resource.kind, records)
  }
  const frozenByKind = readonlyMap([...byKind.entries()]
    .sort(([left], [right]) => compareCodeUnits(left, right))
    .map(([kind, records]) => [kind, Object.freeze([...records]
      .sort((left, right) => compareCodeUnits(left.resourceId, right.resourceId)))] as const))
  const frozenKindDefinitions = readonlyMap([...context.kindDefinitions.entries()]
    .sort(([left], [right]) => compareCodeUnits(left, right)))
  const contentIdentities = readonlyMap(context.resources
    .map((resource) => [resource.resourceId, loadedContentIdentity(resource, context)] as const)
    .sort(([left], [right]) => compareCodeUnits(left, right)))
  const tree: LoadedResourceTree = Object.freeze({
    manifest,
    registry: Object.freeze({ byKind: frozenByKind, kindDefinitions: frozenKindDefinitions }),
    diagnostics: Object.freeze([]),
    contentIdentities,
  })
  return { diagnostics: [], tree: markLoadedResourceTreeAuthentic(tree) }
}

async function loadManifest(
  filePath: string,
  sourceShape: "manifest",
  context: LoaderContext,
  isRoot: boolean,
): Promise<ResourceRecord | undefined> {
  const record = await loadXnlRecord(filePath, sourceShape, context)
  if (!record) return undefined
  if (isRoot && record.kind !== "ResourcePackage") {
    context.diagnostics.push({
      code: "RESOURCE_XNL_ROOT_INVALID",
      location: record.documentUri,
      message: "The root manifest.xnl must contain one ResourcePackage root.",
    })
    return undefined
  }

  const catalogs = readCatalogs(record, context.diagnostics)
  for (const catalog of catalogs.filter((item) => item.kind === "KindDefinition")) {
    await loadKindDefinitions(catalog, dirname(filePath), context)
  }
  for (const catalog of catalogs.filter((item) => item.kind !== "KindDefinition")) {
    await loadCatalog(catalog, dirname(filePath), context)
  }

  if (!isRoot) {
    validateIdentity(record, context)
    context.resources.push(record)
  }
  return record
}

async function loadKindDefinitions(
  catalog: XnlCatalog,
  manifestDir: string,
  context: LoaderContext,
): Promise<void> {
  const files = await catalogFiles(catalog, manifestDir, context)
  for (const file of files) {
    const record = await loadXnlRecord(file, catalog.shape, context)
    if (!record) continue
    if (record.kind !== "KindDefinition") {
      context.diagnostics.push(kindMismatch(record.kind, "KindDefinition", record.documentUri))
      continue
    }
    const definition = normalizeKindDefinition(record, context.diagnostics)
    if (!definition) continue
    context.kindDefinitions.set(definition.resourceKind, definition)
  }
}

async function loadCatalog(
  catalog: XnlCatalog,
  manifestDir: string,
  context: LoaderContext,
): Promise<void> {
  const definition = context.kindDefinitions.get(catalog.kind)
  if (!definition) {
    context.diagnostics.push({
      code: "KIND_DEFINITION_MISSING",
      location: catalog.location,
      message: `No KindDefinition is registered for catalog kind '${catalog.kind}'.`,
    })
    return
  }
  if (!definition.sourceShapes.includes(catalog.shape)) {
    context.diagnostics.push({
      code: "RESOURCE_SOURCE_SHAPE_NOT_ALLOWED",
      location: catalog.location,
      message: `Kind '${catalog.kind}' does not allow source shape '${catalog.shape}'.`,
    })
    return
  }

  const files = await catalogFiles(catalog, manifestDir, context)
  for (const file of files) {
    if (catalog.shape === "manifest") {
      const record = await loadXnlRecord(file, "manifest", context)
      if (!record) continue
      if (record.kind !== catalog.kind) {
        context.diagnostics.push(kindMismatch(record.kind, catalog.kind, record.documentUri))
        continue
      }
      validateResourceApiVersion(record, definition, context.diagnostics)
      await validateRequiredFiles(dirname(file), record, definition, context.diagnostics)
      validateIdentity(record, context)
      context.resources.push(record)
      const catalogs = readCatalogs(record, context.diagnostics)
      for (const nested of catalogs.filter((item) => item.kind !== "KindDefinition")) {
        await loadCatalog(nested, dirname(file), context)
      }
      continue
    }

    if (definition.documentCardinality === "many" && catalog.shape !== "single-file") {
      context.diagnostics.push({
        code: "RESOURCE_DOCUMENT_CARDINALITY_UNSUPPORTED",
        location: catalog.location,
        message: `Kind '${catalog.kind}' allows multiple document roots only in a single-file catalog.`,
      })
      continue
    }
    const records = await loadXnlRecords(file, catalog.shape, context, definition.documentCardinality)
    for (const record of records) {
      if (record.kind !== catalog.kind) {
        context.diagnostics.push(kindMismatch(record.kind, catalog.kind, record.documentUri))
        continue
      }
      validateResourceApiVersion(record, definition, context.diagnostics)
      await validateRequiredFiles(dirname(file), record, definition, context.diagnostics)
      validateIdentity(record, context)
      context.resources.push(record)
    }
  }
}

async function catalogFiles(
  catalog: XnlCatalog,
  manifestDir: string,
  context: LoaderContext,
): Promise<string[]> {
  const root = await resolveCatalogDirectory(catalog.root, manifestDir, catalog.location, context)
  if (!root) return []
  const entries = await readdir(root, { withFileTypes: true }).catch(() => undefined)
  if (!entries) {
    context.diagnostics.push({
      code: "RESOURCE_CATALOG_ROOT_MISSING",
      location: catalog.location,
      message: "Catalog root does not exist or is not readable.",
    })
    return []
  }

  if (catalog.shape === "single-file") {
    if (catalog.entry) {
      if (!isPlainEntry(catalog.entry) || !catalog.entry.toLowerCase().endsWith(".xnl")) {
        context.diagnostics.push({
          code: "RESOURCE_CATALOG_ENTRY_INVALID",
          location: catalog.location,
          message: "A single-file catalog entry must be a plain XNL filename.",
        })
        return []
      }
      return [join(root, catalog.entry)]
    }
    return entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".xnl"))
      .sort((left, right) => compareCodeUnits(left.name, right.name))
      .map((entry) => join(root, entry.name))
  }

  if (!catalog.entry || !isPlainEntry(catalog.entry)) {
    context.diagnostics.push({
      code: "RESOURCE_CATALOG_ENTRY_INVALID",
      location: catalog.location,
        message: "Directory and manifest catalogs require a plain XNL entry filename.",
    })
    return []
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => compareCodeUnits(left.name, right.name))
    .map((entry) => join(root, entry.name, catalog.entry!))
}

async function loadXnlRecord(
  filePath: string,
  sourceShape: SourceShape,
  context: LoaderContext,
): Promise<ResourceRecord | undefined> {
  return (await loadXnlRecords(filePath, sourceShape, context, "one"))[0]
}

async function loadXnlRecords(
  filePath: string,
  sourceShape: SourceShape,
  context: LoaderContext,
  documentCardinality: "one" | "many",
): Promise<ResourceRecord[]> {
  const documentUri = documentUriFor(context.rootDir, filePath)
  const authority = await readAuthorityFile(filePath, documentUri, context)
  if (!authority) return []
  let roots: DataElementNode[]
  try {
    const parsed = parseXnl(authority.source, { textBlockStyle: true })
    if (parsed.warnings?.length) {
      context.diagnostics.push({
        code: "RESOURCE_XNL_WARNING",
        location: documentUri,
        message: parsed.warnings.map((warning) => warning.message).join("; "),
      })
      return []
    }
    if (parsed.nodes.length === 0 || parsed.nodes.some((node) => !isDataElement(node)) || (documentCardinality === "one" && parsed.nodes.length !== 1)) {
      context.diagnostics.push({
        code: "RESOURCE_XNL_ROOT_INVALID",
        location: documentUri,
        message: documentCardinality === "one"
          ? "XNL resource documents must contain exactly one data-element root."
          : "XNL resource forests must contain one or more data-element roots.",
      })
      return []
    }
    roots = parsed.nodes as DataElementNode[]
  } catch (error) {
    context.diagnostics.push({
      code: "RESOURCE_XNL_SYNTAX",
      location: documentUri,
      message: `Invalid XNL resource document: ${error instanceof Error ? error.message : String(error)}`,
    })
    return []
  }

  return roots.flatMap((root) => {
    const record = resourceRecordFromRoot(root, filePath, sourceShape, context)
    if (record) context.recordAuthorityDigests.set(record, authority.authorityDigest)
    return record ? [record] : []
  })
}

async function readAuthorityFile(
  filePath: string,
  documentUri: string,
  context: LoaderContext,
): Promise<AuthorityFileRead | undefined> {
  const canonicalPath = resolve(filePath)
  let pending = context.authorityFiles.get(canonicalPath)
  if (!pending) {
    pending = readFile(canonicalPath).then((bytes) => {
      try {
        return Object.freeze({
          source: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
          authorityDigest: sha256Digest(bytes),
        })
      } catch {
        context.diagnostics.push({
          code: "RESOURCE_XNL_UTF8_INVALID",
          location: documentUri,
          message: "XNL resource authority must be valid UTF-8.",
        })
        return undefined
      }
    }).catch(() => {
      context.diagnostics.push({
        code: "RESOURCE_FILE_MISSING",
        location: documentUri,
        message: "Resource file does not exist.",
      })
      return undefined
    })
    context.authorityFiles.set(canonicalPath, pending)
  }
  return pending
}

function loadedContentIdentity(resource: ResourceRecord, context: LoaderContext): ResourceContentIdentity {
  const authorityDigest = context.recordAuthorityDigests.get(resource)
  if (!authorityDigest) throw new Error(`Loader authority digest is missing for ${resource.resourceId}`)
  return createResourceContentIdentity({ resourceId: resource.resourceId, authorityDigest })
}

function resourceRecordFromRoot(
  root: DataElementNode,
  filePath: string,
  sourceShape: SourceShape,
  context: LoaderContext,
): ResourceRecord | undefined {
  const documentUri = documentUriFor(context.rootDir, filePath)
  const node = normalizeNode(root)
  const resourceId = node.resourceId
  const apiVersion = asString(node.metadata.apiVersion)
  const lifecycle = asString(node.properties.lifecycle)
  const description = asString(node.properties.description) ?? node.subdomains.Description?.text
  if (!resourceId) {
    context.diagnostics.push({ code: "RESOURCE_IDENTITY_MISSING", location: documentUri, message: "XNL resource roots must declare a #id." })
  }
  if (!apiVersion) {
    context.diagnostics.push({
      code: "RESOURCE_METADATA_FIELD_MISSING",
      location: documentUri,
      message: "XNL resources require metadata apiVersion.",
    })
  }
  if (!resourceId || !apiVersion) return undefined

  const metadata: ResourceMetadata = Object.freeze({
    apiVersion,
    ...(lifecycle ? { lifecycle } : {}),
    version: asString(node.metadata.version),
  })
  const logicalPath = relative(context.rootDir, filePath).split(sep).join("/")
  return Object.freeze({
    kind: node.tag,
    resourceId,
    fqn: resourceId,
    ...(description ? { description } : {}),
    metadata,
    sourceShape,
    logicalPath,
    documentUri,
    format: "xnl",
    node,
  })
}

function normalizeNode(node: DataElementNode | TextElementNode): ResourceNode {
  const subdomains: Record<string, ResourceNode> = {}
  if (node.kind === "DataElement" && node.extend) {
    for (const name of node.extend.order) {
      const child = node.extend.children[name]
      if (child) subdomains[name] = normalizeNode(child)
    }
  }
  const resourceId = wordToString(node.id)
  return Object.freeze({
    tag: node.tag,
    ...(resourceId === undefined ? {} : { resourceId }),
    metadata: Object.freeze(normalizeMap(node.metadata)),
    properties: Object.freeze(normalizeMap(node.attributes)),
    body: Object.freeze(node.kind === "DataElement" ? (node.body ?? []).map(normalizeValue) : []),
    subdomains: Object.freeze(subdomains),
    ...(node.kind === "TextElement" ? { text: node.text ?? "" } : {}),
  })
}

function normalizeMap(map: AttributeMap | undefined): Record<string, ResourceValue> {
  return Object.fromEntries(Object.entries(map ?? {}).map(([key, value]) => [key, normalizeValue(value)]))
}

function normalizeValue(value: XnlNode): ResourceValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value
  if (Array.isArray(value)) return Object.freeze(value.map(normalizeValue))
  if (isElement(value)) return normalizeNode(value)
  if (isWord(value)) return wordToString(value) ?? ""
  if (isComment(value)) return value.value
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalizeValue(child)])))
}

function readCatalogs(record: ResourceRecord, diagnostics: ResourceDiagnostic[]): XnlCatalog[] {
  const catalogs = record.node.subdomains.Catalogs
  if (!catalogs) return []
  const out: XnlCatalog[] = []
  for (const value of catalogs.body) {
    if (!isResourceNode(value) || value.tag !== "Catalog") continue
    const id = value.resourceId
    const kind = asString(value.properties.kind)
    const root = asString(value.properties.root)
    const entry = asString(value.properties.entry)
    const shapeValue = asString(value.properties.shape) ?? (entry ? "directory" : "single-file")
    const location = `${record.documentUri}#Catalog:${id ?? "unknown"}`
    if (!id || !kind || !root || !isXnlShape(shapeValue)) {
      diagnostics.push({
        code: "RESOURCE_CATALOG_INVALID",
        location,
        message: "Catalog requires #id, kind, root and a valid shape.",
      })
      continue
    }
    out.push({ id, kind, root, entry, shape: shapeValue, location })
  }
  return out
}

function normalizeKindDefinition(
  record: ResourceRecord,
  diagnostics: ResourceDiagnostic[],
): RegisteredKindDefinition | undefined {
  const resourceKind = asString(record.node.properties.resourceKind)
    ?? record.resourceId.split(".").at(-1)
  const shapes = record.node.properties.sourceShapes
  const sourceShapes = Array.isArray(shapes) ? shapes.filter(isXnlShape) : []
  const currentApiVersion = asString(record.node.properties.currentApiVersion)
  const versions = record.node.properties.supportedApiVersions
  const supportedApiVersions = Array.isArray(versions) ? versions.filter((value): value is string => typeof value === "string" && Boolean(value.trim())) : []
  const cardinalityValue = asString(record.node.properties.documentCardinality) ?? "one"
  if (!resourceKind || sourceShapes.length === 0 || !currentApiVersion || supportedApiVersions.length === 0 || !isDocumentCardinality(cardinalityValue)) {
    diagnostics.push({
      code: "KIND_DEFINITION_INVALID",
      location: record.documentUri,
      message: "KindDefinition requires resourceKind (or an id suffix), sourceShapes, currentApiVersion, and supportedApiVersions.",
    })
    return undefined
  }
  if (!supportedApiVersions.includes(currentApiVersion)) {
    diagnostics.push({
      code: "KIND_DEFINITION_VERSION_INVALID",
      location: record.documentUri,
      message: `Kind '${resourceKind}' currentApiVersion '${currentApiVersion}' must be included in supportedApiVersions.`,
    })
    return undefined
  }
  if (cardinalityValue === "many" && sourceShapes.some((shape) => shape !== "single-file")) {
    diagnostics.push({
      code: "KIND_DEFINITION_CARDINALITY_INVALID",
      location: record.documentUri,
      message: `Kind '${resourceKind}' documentCardinality 'many' requires only the single-file source shape.`,
    })
    return undefined
  }
  const requiredFilesNode = record.node.subdomains.DescriptorContract?.subdomains.RequiredFiles
  const requiredFiles = (requiredFilesNode?.body ?? [])
    .filter(isResourceNode)
    .filter((node) => node.tag === "File")
    .map((node) => asString(node.properties.name))
    .filter((value): value is string => Boolean(value))
  return Object.freeze({
    resourceId: record.resourceId,
    resourceKind,
    sourceShapes: Object.freeze([...sourceShapes]),
    requiredFiles: Object.freeze([...requiredFiles]),
    currentApiVersion,
    supportedApiVersions: Object.freeze([...new Set(supportedApiVersions)]),
    documentCardinality: cardinalityValue,
    documentUri: record.documentUri,
  })
}

function validateResourceApiVersion(
  record: ResourceRecord,
  definition: RegisteredKindDefinition,
  diagnostics: ResourceDiagnostic[],
): void {
  if (definition.supportedApiVersions.includes(record.metadata.apiVersion)) return
  diagnostics.push({
    code: "RESOURCE_API_VERSION_UNSUPPORTED",
    location: record.documentUri,
    message: `Kind '${record.kind}' does not support apiVersion '${record.metadata.apiVersion}'.`,
    hint: `Current apiVersion is '${definition.currentApiVersion}'.`,
  })
}

async function validateRequiredFiles(
  resourceDir: string,
  record: ResourceRecord,
  definition: RegisteredKindDefinition,
  diagnostics: ResourceDiagnostic[],
): Promise<void> {
  for (const name of definition.requiredFiles) {
    if (!isPlainEntry(name)) {
      diagnostics.push({ code: "KIND_DEFINITION_REQUIRED_FILE_INVALID", location: record.documentUri, message: `Invalid required file '${name}'.` })
      continue
    }
    const exists = await stat(join(resourceDir, name)).then((info) => info.isFile()).catch(() => false)
    if (!exists) diagnostics.push({ code: "RESOURCE_REQUIRED_FILE_MISSING", location: `${record.documentUri}#${name}`, message: `Resource is missing required material '${name}'.` })
  }
}

async function resolveCatalogDirectory(
  uri: string,
  manifestDir: string,
  location: string,
  context: LoaderContext,
): Promise<string | undefined> {
  const relativeMatch = /^vfs:\/\/(\.\/|@\/)(.*)$/.exec(uri)
  if (!relativeMatch || !uri.endsWith("/")) {
    context.diagnostics.push({ code: "RESOURCE_REF_UNSUPPORTED", location, message: "Catalog roots must be directory vfs://./ or vfs://@/ references." })
    return undefined
  }
  const rawPath = relativeMatch[2]
  let decoded: string
  try {
    decoded = decodeURIComponent(rawPath)
  } catch {
    context.diagnostics.push({ code: "RESOURCE_REF_CONTAINMENT", location, message: "VFS reference contains invalid encoding." })
    return undefined
  }
  if (isAbsolute(decoded) || decoded.split(/[\\/]+/).includes("..") || /%2f|%5c/i.test(rawPath)) {
    context.diagnostics.push({ code: "RESOURCE_REF_CONTAINMENT", location, message: "VFS reference escapes the owning package boundary." })
    return undefined
  }
  const base = relativeMatch[1] === "@/" ? context.rootDir : manifestDir
  const boundary = await realpath(context.rootDir)
  const candidate = resolve(base, decoded)
  const resolved = await realpath(candidate).catch(() => candidate)
  if (resolved !== boundary && !resolved.startsWith(`${boundary}${sep}`)) {
    context.diagnostics.push({ code: "RESOURCE_REF_CONTAINMENT", location, message: "VFS reference resolves outside the owning package boundary." })
    return undefined
  }
  return resolved
}

function validateIdentity(record: ResourceRecord, context: LoaderContext): void {
  const prior = context.seenIdentities.get(record.resourceId)
  if (prior) {
    context.diagnostics.push({
      code: "RESOURCE_IDENTITY_DUPLICATE",
      location: record.documentUri,
      message: `Duplicate resource identity '${record.resourceId}'.`,
      hint: `First seen at ${prior}.`,
    })
    return
  }
  context.seenIdentities.set(record.resourceId, record.documentUri)
}

function documentUriFor(rootDir: string, filePath: string): string {
  return `vfs://@/${relative(rootDir, filePath).split(sep).join("/")}`
}

function kindMismatch(actual: string, expected: string, location: string): ResourceDiagnostic {
  return { code: "RESOURCE_KIND_MISMATCH", location, message: `Resource kind '${actual}' does not match catalog kind '${expected}'.` }
}

function isXnlShape(value: unknown): value is "single-file" | "directory" | "manifest" {
  return value === "single-file" || value === "directory" || value === "manifest"
}

function isDocumentCardinality(value: string): value is "one" | "many" {
  return value === "one" || value === "many"
}

function isPlainEntry(value: string): boolean {
  return Boolean(value) && !value.includes("/") && !value.includes("\\") && !value.includes("..")
}

function asString(value: ResourceValue | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined
}

function isResourceNode(value: ResourceValue): value is ResourceNode {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "tag" in value
}

function isDataElement(value: XnlNode | undefined): value is DataElementNode {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "kind" in value && value.kind === "DataElement"
}

function isElement(value: XnlNode): value is DataElementNode | TextElementNode {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "kind" in value && (value.kind === "DataElement" || value.kind === "TextElement")
}

function isWord(value: XnlNode): value is { kind: "Word"; namespace: string[]; name: string } {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "kind" in value && value.kind === "Word"
}

function isComment(value: XnlNode): value is { kind: "Comment"; value: string } {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "kind" in value && value.kind === "Comment"
}
