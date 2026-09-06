import { parse as parseYaml } from "yaml"
import {
  parseXnl,
  wordToString,
  type AttributeMap,
  type DataElementNode,
  type TextElementNode,
  type XnlNode,
} from "xnl-core"
import { compareCodeUnits, digestCanonical } from "./canonical"
import {
  createResourceContentIdentity,
  sha256Digest,
  type Sha256Digest,
  type ResourceContentIdentity,
  type ResourceDigestContribution,
} from "./dependency-snapshot"
import { isAuthoredResourceTreeAuthentic, markAuthoredResourceTreeAuthentic } from "./authored-resource-tree-brand"
import { readonlyMap } from "./readonly-map"
import {
  canonicalResourcePackageSourcePath,
  dirnameResourcePackageSourcePath,
  joinResourcePackageSourcePath,
  relativeResourcePackageSourcePath,
  type ResourcePackageReadPort,
} from "./resource-package-read-port"
import { decodeResourceMetadata } from "./resource-envelope"
import { CORE_BOOTSTRAP_WRITER_SPEC_VERSIONS, isSpecVersion } from "./resource-version-contracts"
import type {
  AuthoredResourceRecord,
  AuthoredResourceTree,
  AuthoredResourceTreeBuildResult,
  KindDefinitionImportReceipt,
  ResourceDiagnostic,
  KindSpecRevisionDescriptor,
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
  scope: "root" | "children"
  location: string
}

interface LoaderContext {
  rootPath: string
  port: ResourcePackageReadPort
  diagnostics: ResourceDiagnostic[]
  kindDefinitions: Map<string, RegisteredKindDefinition>
  resources: AuthoredResourceRecord[]
  seenIdentities: Map<string, string>
  authorityFiles: Map<string, Promise<AuthorityFileRead | undefined>>
  recordAuthorityDigests: WeakMap<AuthoredResourceRecord, Sha256Digest>
  recordContributions: WeakMap<AuthoredResourceRecord, readonly ResourceDigestContribution[]>
  kindDefinitionImports: readonly KindDefinitionImportReceipt[]
  importedKindDefinitions: ReadonlyMap<string, { readonly definitionDigest: Sha256Digest; readonly sourceContentDigest: Sha256Digest }>
}

interface AuthorityFileRead {
  readonly source: string
  readonly authorityDigest: Sha256Digest
}

function admitKindDefinitionImports(imports: readonly AuthoredResourceTree[]): {
  readonly definitions: readonly (readonly [string, RegisteredKindDefinition])[]
  readonly receipts: readonly KindDefinitionImportReceipt[]
  readonly provenance: ReadonlyMap<string, { readonly definitionDigest: Sha256Digest; readonly sourceContentDigest: Sha256Digest }>
} {
  const definitions = new Map<string, RegisteredKindDefinition>()
  const provenance = new Map<string, { readonly definitionDigest: Sha256Digest; readonly sourceContentDigest: Sha256Digest }>()
  const receipts: KindDefinitionImportReceipt[] = []
  for (const tree of imports) {
    if (!isAuthoredResourceTreeAuthentic(tree)) throw new TypeError("KIND_DEFINITION_IMPORT_UNTRUSTED")
    if (tree.manifest.kind !== "ResourcePackage" || [...tree.registry.byKind.keys()].some(kind => kind !== "KindDefinition")) {
      throw new TypeError("KIND_DEFINITION_IMPORT_NOT_DEFINITION_ONLY")
    }
    const entries = [...tree.registry.kindDefinitions.entries()].sort(([left], [right]) => compareCodeUnits(left, right))
    if (entries.length === 0) throw new TypeError("KIND_DEFINITION_IMPORT_EMPTY")
    for (const [kind, definition] of entries) {
      if (definitions.has(kind)) throw new TypeError("KIND_DEFINITION_IMPORT_COLLISION")
      const record = tree.registry.byKind.get("KindDefinition")?.find(candidate => candidate.resourceId === definition.resourceId)
      if (!record) throw new TypeError("KIND_DEFINITION_IMPORT_CLOSURE_MISSING")
      definitions.set(kind, definition)
      provenance.set(kind, Object.freeze({ definitionDigest: kindDefinitionContractDigest(definition), sourceContentDigest: record.sourceContentDigest }))
    }
    receipts.push(Object.freeze({
      treeDigest: digestCanonical([...tree.contentIdentities.entries()].sort(([left], [right]) => compareCodeUnits(left, right))),
      kinds: Object.freeze(entries.map(([kind]) => kind)),
    }))
  }
  return Object.freeze({ definitions: Object.freeze([...definitions.entries()]), receipts: Object.freeze(receipts), provenance: readonlyMap([...provenance.entries()]) })
}

async function safeStat(port: ResourcePackageReadPort, sourcePath: string) {
  try {
    return await port.stat(sourcePath)
  } catch {
    return undefined
  }
}

async function safeReadDirectory(port: ResourcePackageReadPort, sourcePath: string) {
  try {
    return await port.readDirectory(sourcePath)
  } catch {
    return undefined
  }
}

async function safeReadBytes(port: ResourcePackageReadPort, sourcePath: string) {
  try {
    return await port.readBytes(sourcePath)
  } catch {
    return undefined
  }
}

export async function buildXnlResourceTree(
  options: { port: ResourcePackageReadPort; rootPath: string; manifestPath: string; kindDefinitionImports?: readonly AuthoredResourceTree[] },
): Promise<AuthoredResourceTreeBuildResult> {
  let rootPath: string
  try {
    rootPath = canonicalResourcePackageSourcePath(options.rootPath)
  } catch {
    return {
      diagnostics: [{
        code: "RESOURCE_SOURCE_PATH_INVALID",
        location: "vfs://@/",
        message: "ResourcePackage read-port rootPath must be canonical POSIX absolute.",
      }],
    }
  }
  const imports = admitKindDefinitionImports(options.kindDefinitionImports ?? [])
  const context: LoaderContext = {
    rootPath,
    port: options.port,
    diagnostics: [],
    kindDefinitions: new Map(imports.definitions),
    resources: [],
    seenIdentities: new Map(),
    authorityFiles: new Map(),
    recordAuthorityDigests: new WeakMap(),
    recordContributions: new WeakMap(),
    kindDefinitionImports: imports.receipts,
    importedKindDefinitions: imports.provenance,
  }
  const manifestFile = resolvePackageRelativePath(context.rootPath, options.manifestPath)
  if (!manifestFile) {
    return {
      diagnostics: [{
        code: "RESOURCE_SOURCE_PATH_INVALID",
        location: `vfs://@/${options.manifestPath}`,
        message: "ResourcePackage manifestPath must be a canonical package-relative file path.",
      }],
    }
  }
  const manifest = await loadManifest(manifestFile, "manifest", context, true)
  if (!manifest || context.diagnostics.length > 0) {
    return { diagnostics: context.diagnostics }
  }

  const byKind = new Map<string, AuthoredResourceRecord[]>()
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
  const tree: AuthoredResourceTree = Object.freeze({
    stage: "authored",
    manifest,
    registry: Object.freeze({ byKind: frozenByKind, kindDefinitions: frozenKindDefinitions }),
    diagnostics: Object.freeze([]),
    contentIdentities,
    ...(context.kindDefinitionImports.length ? { kindDefinitionImports: context.kindDefinitionImports } : {}),
  })
  return { diagnostics: [], tree: markAuthoredResourceTreeAuthentic(tree) }
}

async function loadManifest(
  filePath: string,
  sourceShape: "manifest",
  context: LoaderContext,
  isRoot: boolean,
): Promise<AuthoredResourceRecord | undefined> {
  let record = await loadXnlRecord(filePath, sourceShape, context)
  if (!record) return undefined

  if (isRoot && record.kind === "ResourcePackage"
    && record.metadata.specVersion !== CORE_BOOTSTRAP_WRITER_SPEC_VERSIONS.ResourcePackage) {
    context.diagnostics.push({
      code: "CORE_RESOURCE_SPEC_VERSION_UNSUPPORTED",
      location: record.documentUri,
      message: `ResourcePackage bootstrap only admits writer specVersion ${CORE_BOOTSTRAP_WRITER_SPEC_VERSIONS.ResourcePackage}; received ${record.metadata.specVersion}.`,
    })
    return undefined
  }

  const catalogs = readCatalogs(record, context.diagnostics)
  for (const catalog of catalogs.filter((item) => item.kind === "KindDefinition")) {
    await loadKindDefinitions(catalog, dirnameResourcePackageSourcePath(filePath), context)
  }

  if (isRoot && record.kind !== "ResourcePackage") {
    const definition = context.kindDefinitions.get(record.kind)
    if (!definition) {
      context.diagnostics.push({
        code: "KIND_DEFINITION_MISSING",
        location: record.documentUri,
        message: `No KindDefinition is registered for semantic root kind '${record.kind}'.`,
      })
      return undefined
    }
    if (!definition.sourceShapes.includes("manifest")) {
      context.diagnostics.push({
        code: "RESOURCE_SOURCE_SHAPE_NOT_ALLOWED",
        location: record.documentUri,
        message: `Semantic root kind '${record.kind}' does not allow source shape 'manifest'.`,
      })
      return undefined
    }
    record = bindSubject(record, definition.subjectFqn, context)
    await validateRequiredFiles(dirnameResourcePackageSourcePath(filePath), record, definition, context)
    validateIdentity(record, context)
    context.resources.push(record)
  }
  if (isRoot && record.kind === "ResourcePackage") {
    record = bindSubject(record, "Halfcode.ResourceKind.ResourcePackage", context)
  }
  for (const catalog of catalogs.filter((item) => item.kind !== "KindDefinition")) {
    await loadCatalog(catalog, dirnameResourcePackageSourcePath(filePath), context)
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
    const imported = context.importedKindDefinitions.get(definition.resourceKind)
    if (imported && kindDefinitionContractDigest(definition) === imported.definitionDigest) {
      // A legacy package may carry an exact copy of a host-installed standard
      // definition. Keep the imported authority while retaining local bytes as
      // an authored record and content-identity contribution.
    } else if (context.kindDefinitions.has(definition.resourceKind)) {
      context.diagnostics.push({
        code: "KIND_DEFINITION_IMPORT_COLLISION",
        location: record.documentUri,
        message: `KindDefinition '${definition.resourceKind}' collides with an imported or earlier definition.`,
      })
      continue
    }
    context.kindDefinitions.set(definition.resourceKind, definition)
    const authoredDefinition = bindSubject(record, "Halfcode.ResourceKind.KindDefinition", context)
    validateIdentity(authoredDefinition, context)
    context.resources.push(authoredDefinition)
  }
}

function kindDefinitionContractDigest(definition: RegisteredKindDefinition): Sha256Digest {
  return digestCanonical({
    resourceKind: definition.resourceKind,
    subjectFqn: definition.subjectFqn,
    sourceShapes: [...definition.sourceShapes].sort(compareCodeUnits),
    requiredFiles: [...definition.requiredFiles].sort(compareCodeUnits),
    documentCardinality: definition.documentCardinality,
    specRevisions: [...definition.specRevisions].sort((left, right) => left.specVersion - right.specVersion),
  })
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
      let record = await loadXnlRecord(file, "manifest", context)
      if (!record) continue
      if (record.kind !== catalog.kind) {
        context.diagnostics.push(kindMismatch(record.kind, catalog.kind, record.documentUri))
        continue
      }
      record = bindSubject(record, definition.subjectFqn, context)
      await validateRequiredFiles(dirnameResourcePackageSourcePath(file), record, definition, context)
      validateIdentity(record, context)
      context.resources.push(record)
      const catalogs = readCatalogs(record, context.diagnostics)
      for (const nested of catalogs.filter((item) => item.kind !== "KindDefinition")) {
        await loadCatalog(nested, dirnameResourcePackageSourcePath(file), context)
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
    const records = await loadResourceRecords(file, catalog.shape, context, definition.documentCardinality)
    for (let record of records) {
      if (record.kind !== catalog.kind) {
        context.diagnostics.push(kindMismatch(record.kind, catalog.kind, record.documentUri))
        continue
      }
      record = bindSubject(record, definition.subjectFqn, context)
      await validateRequiredFiles(dirnameResourcePackageSourcePath(file), record, definition, context)
      validateIdentity(record, context)
      context.resources.push(record)
    }
  }
}

function bindSubject(
  record: AuthoredResourceRecord,
  subjectFqn: string,
  context: LoaderContext,
): AuthoredResourceRecord {
  if (record.subjectFqn === subjectFqn) return record
  const bound = Object.freeze({ ...record, subjectFqn })
  const authorityDigest = context.recordAuthorityDigests.get(record)
  if (authorityDigest) context.recordAuthorityDigests.set(bound, authorityDigest)
  const contributions = context.recordContributions.get(record)
  if (contributions) context.recordContributions.set(bound, contributions)
  return bound
}

async function catalogFiles(
  catalog: XnlCatalog,
  manifestDir: string,
  context: LoaderContext,
): Promise<string[]> {
  const root = await resolveCatalogDirectory(catalog.root, manifestDir, catalog.location, context)
  if (!root) return []
  const entries = await safeReadDirectory(context.port, root)
  if (!entries) {
    context.diagnostics.push({
      code: "RESOURCE_CATALOG_ROOT_MISSING",
      location: catalog.location,
      message: "Catalog root does not exist or is not readable.",
    })
    return []
  }
  const entryNames = new Set<string>()
  for (const entry of entries) {
    if (
      !entry ||
      typeof entry.name !== "string" ||
      !isPlainSourceEntryName(entry.name) ||
      !isResourcePackageEntryKind(entry.kind) ||
      entryNames.has(entry.name)
    ) {
      context.diagnostics.push({
        code: "RESOURCE_SOURCE_ENTRY_INVALID",
        location: catalog.location,
        message: "ResourcePackage read port returned a non-canonical or duplicate directory entry.",
      })
      return []
    }
    entryNames.add(entry.name)
  }

  if (catalog.shape === "single-file") {
    if (catalog.entry) {
      if (!isPlainEntry(catalog.entry) || !isSingleFileExtension(catalog.entry)) {
        context.diagnostics.push({
          code: "RESOURCE_CATALOG_ENTRY_INVALID",
          location: catalog.location,
          message: "A single-file catalog entry must be a plain XNL or Markdown filename.",
        })
        return []
      }
      return [joinResourcePackageSourcePath(root, catalog.entry)]
    }
    return entries
      .filter((entry) => entry.kind === "file" && isSingleFileExtension(entry.name))
      .sort((left, right) => compareCodeUnits(left.name, right.name))
      .map((entry) => joinResourcePackageSourcePath(root, entry.name))
  }

  if (!catalog.entry || !isPlainEntry(catalog.entry)) {
    context.diagnostics.push({
      code: "RESOURCE_CATALOG_ENTRY_INVALID",
      location: catalog.location,
        message: "Directory and manifest catalogs require a plain XNL entry filename.",
    })
    return []
  }
  if (catalog.shape === "directory" && catalog.scope === "root") {
    const directEntry = joinResourcePackageSourcePath(root, catalog.entry)
    const directStat = await safeStat(context.port, directEntry)
    if (!directStat) return [directEntry]
    if (directStat.kind !== "file") {
      context.diagnostics.push({
        code: "RESOURCE_CATALOG_ENTRY_INVALID",
        location: documentUriFor(context.rootPath, directEntry),
        message: "A root-scoped directory catalog entry must be a regular non-symbolic-link XNL file.",
      })
      return []
    }
    return [directEntry]
  }
  return entries
    .filter((entry) => entry.kind === "directory")
    .sort((left, right) => compareCodeUnits(left.name, right.name))
    .map((entry) => joinResourcePackageSourcePath(root, entry.name, catalog.entry!))
}

async function loadXnlRecord(
  filePath: string,
  sourceShape: SourceShape,
  context: LoaderContext,
): Promise<AuthoredResourceRecord | undefined> {
  return (await loadXnlRecords(filePath, sourceShape, context, "one"))[0]
}

async function loadResourceRecords(
  filePath: string,
  sourceShape: SourceShape,
  context: LoaderContext,
  documentCardinality: "one" | "many",
): Promise<AuthoredResourceRecord[]> {
  if (!filePath.toLowerCase().endsWith(".md")) {
    return loadXnlRecords(filePath, sourceShape, context, documentCardinality)
  }
  if (sourceShape !== "single-file" || documentCardinality !== "one") {
    context.diagnostics.push({
      code: "RESOURCE_MARKDOWN_SOURCE_SHAPE_INVALID",
      location: documentUriFor(context.rootPath, filePath),
      message: "Markdown resource authority requires a single-file catalog with documentCardinality one.",
    })
    return []
  }
  const record = await loadMarkdownRecord(filePath, context)
  return record ? [record] : []
}

async function loadMarkdownRecord(
  filePath: string,
  context: LoaderContext,
): Promise<AuthoredResourceRecord | undefined> {
  const documentUri = documentUriFor(context.rootPath, filePath)
  const authority = await readAuthorityFile(filePath, documentUri, context)
  if (!authority) return undefined
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(authority.source)
  if (!match) {
    context.diagnostics.push({
      code: "RESOURCE_MARKDOWN_FRONTMATTER_INVALID",
      location: documentUri,
      message: "Markdown resource authority requires a closed YAML frontmatter block at the start of the file.",
    })
    return undefined
  }
  let parsed: unknown
  try {
    parsed = parseYaml(match[1] ?? "")
  } catch (error) {
    context.diagnostics.push({
      code: "RESOURCE_MARKDOWN_FRONTMATTER_INVALID",
      location: documentUri,
      message: `Invalid Markdown resource frontmatter: ${error instanceof Error ? error.message : String(error)}`,
    })
    return undefined
  }
  if (!isPlainObject(parsed)) {
    context.diagnostics.push({
      code: "RESOURCE_MARKDOWN_FRONTMATTER_INVALID",
      location: documentUri,
      message: "Markdown resource frontmatter must be a YAML object.",
    })
    return undefined
  }
  const metadataValue = parsed.metadata
  const specValue = parsed.spec
  const kind = stringField(parsed.kind)
  const metadataObject = isPlainObject(metadataValue) ? metadataValue : undefined
  const resourceId = metadataObject ? stringField(metadataObject.fqn) : undefined
  if (!kind || !resourceId || (specValue !== undefined && !isPlainObject(specValue))) {
    context.diagnostics.push({
      code: "RESOURCE_MARKDOWN_METADATA_INVALID",
      location: documentUri,
      message: "Markdown resource frontmatter requires kind, metadata.fqn and an optional object spec.",
    })
    return undefined
  }
  const decoded = decodeResourceMetadata({
    fields: parsed,
    removedFieldContainers: metadataObject ? [metadataObject] : [],
    lifecycle: metadataObject?.lifecycle,
    location: documentUri,
    source: "Markdown",
  })
  if ("diagnostic" in decoded) {
    context.diagnostics.push(decoded.diagnostic)
    return undefined
  }
  let properties: Readonly<Record<string, ResourceValue>>
  try {
    properties = Object.freeze(normalizeExternalMap((specValue as Record<string, unknown> | undefined) ?? {}))
  } catch (error) {
    context.diagnostics.push({
      code: "RESOURCE_MARKDOWN_METADATA_INVALID",
      location: documentUri,
      message: `Markdown resource spec is not JSON-compatible: ${error instanceof Error ? error.message : String(error)}`,
    })
    return undefined
  }
  const name = metadataObject ? stringField(metadataObject.name) : undefined
  const description = stringField(properties.description)
  const node: ResourceNode = Object.freeze({
    tag: kind,
    resourceId,
    metadata: Object.freeze({
      envelopeVersion: decoded.metadata.envelopeVersion,
      specVersion: decoded.metadata.specVersion,
    }),
    properties,
    body: Object.freeze([]),
    subdomains: Object.freeze({}),
    text: authority.source.slice(match[0].length),
  })
  const record: AuthoredResourceRecord = Object.freeze({
    stage: "authored",
    kind,
    subjectFqn: kind,
    resourceId,
    fqn: resourceId,
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
    metadata: decoded.metadata,
    authoredSpec: authoredSpecFromNode(node),
    sourceContentDigest: authority.authorityDigest,
    sourceShape: "single-file",
    logicalPath: logicalPathFor(context.rootPath, filePath),
    documentUri,
    format: "markdown",
    node,
  })
  context.recordAuthorityDigests.set(record, authority.authorityDigest)
  return record
}

async function loadXnlRecords(
  filePath: string,
  sourceShape: SourceShape,
  context: LoaderContext,
  documentCardinality: "one" | "many",
): Promise<AuthoredResourceRecord[]> {
  const documentUri = documentUriFor(context.rootPath, filePath)
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
    const record = resourceRecordFromRoot(root, filePath, sourceShape, authority.authorityDigest, context)
    if (record) context.recordAuthorityDigests.set(record, authority.authorityDigest)
    return record ? [record] : []
  })
}

async function readAuthorityFile(
  filePath: string,
  documentUri: string,
  context: LoaderContext,
): Promise<AuthorityFileRead | undefined> {
  const canonicalPath = canonicalResourcePackageSourcePath(filePath)
  let pending = context.authorityFiles.get(canonicalPath)
  if (!pending) {
    pending = safeReadBytes(context.port, canonicalPath).then((bytes) => {
      if (!bytes) {
        context.diagnostics.push({
          code: "RESOURCE_FILE_MISSING",
          location: documentUri,
          message: "Resource file does not exist.",
        })
        return undefined
      }
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

function loadedContentIdentity(resource: AuthoredResourceRecord, context: LoaderContext): ResourceContentIdentity {
  const authorityDigest = context.recordAuthorityDigests.get(resource)
  if (!authorityDigest) throw new Error(`Loader authority digest is missing for ${resource.resourceId}`)
  return createResourceContentIdentity({
    resourceId: resource.resourceId,
    authorityDigest,
    contributions: context.recordContributions.get(resource) ?? [],
  })
}

function resourceRecordFromRoot(
  root: DataElementNode,
  filePath: string,
  sourceShape: SourceShape,
  sourceContentDigest: Sha256Digest,
  context: LoaderContext,
): AuthoredResourceRecord | undefined {
  const documentUri = documentUriFor(context.rootPath, filePath)
  const node = normalizeNode(root)
  const resourceId = node.resourceId
  const description = asString(node.properties.description) ?? node.subdomains.Description?.text
  if (!resourceId) {
    context.diagnostics.push({ code: "RESOURCE_IDENTITY_MISSING", location: documentUri, message: "XNL resource roots must declare a #id." })
  }
  if (!resourceId) return undefined
  const decoded = decodeResourceMetadata({
    fields: node.metadata,
    lifecycle: node.properties.lifecycle,
    location: documentUri,
    source: "XNL",
  })
  if ("diagnostic" in decoded) {
    context.diagnostics.push(decoded.diagnostic)
    return undefined
  }
  const logicalPath = logicalPathFor(context.rootPath, filePath)
  return Object.freeze({
    stage: "authored",
    kind: node.tag,
    subjectFqn: node.tag,
    resourceId,
    fqn: resourceId,
    ...(description ? { description } : {}),
    metadata: decoded.metadata,
    authoredSpec: authoredSpecFromNode(node),
    sourceContentDigest,
    sourceShape,
    logicalPath,
    documentUri,
    format: "xnl",
    node,
  })
}

function authoredSpecFromNode(node: ResourceNode) {
  return Object.freeze({
    properties: node.properties,
    body: node.body,
    subdomains: node.subdomains,
    ...(node.text === undefined ? {} : { text: node.text }),
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
    if (!isResourceNode(value)) continue
    const fixedShape = catalogShapeForTag(value.tag)
    if (value.tag !== "Catalog" && !fixedShape) continue
    const id = value.resourceId
    const kind = asString(value.properties.resourceKind) ?? asString(value.properties.kind)
    const root = asString(value.properties.root)
    const entry = asString(value.properties.entry)
    const declaredShape = asString(value.properties.shape)
    const shapeValue = fixedShape ?? declaredShape ?? (entry ? "directory" : "single-file")
    const declaredScope = asString(value.properties.scope)
    const scope = declaredScope ?? "children"
    const location = `${record.documentUri}#${value.tag}:${id ?? "unknown"}`
    const shapeConflict = Boolean(fixedShape && declaredShape && declaredShape !== fixedShape)
    const invalidScope = scope !== "root" && scope !== "children"
    const scopeNotAllowed = Boolean(declaredScope && shapeValue !== "directory")
    if (!id || !kind || !root || !isXnlShape(shapeValue) || shapeConflict || invalidScope || scopeNotAllowed) {
      diagnostics.push({
        code: "RESOURCE_CATALOG_INVALID",
        location,
        message: "Resource catalog requires #id, resourceKind (or legacy kind), root, a tag-consistent shape and a valid directory scope.",
      })
      continue
    }
    out.push({ id, kind, root, entry, shape: shapeValue, scope, location })
  }
  return out
}

function catalogShapeForTag(tag: string): SourceShape | undefined {
  if (tag === "FileResourceCatalog") return "single-file"
  if (tag === "DirectoryResourceCatalog") return "directory"
  if (tag === "ManifestResourceCatalog") return "manifest"
  return undefined
}

function normalizeKindDefinition(
  record: ResourceRecord,
  diagnostics: ResourceDiagnostic[],
): RegisteredKindDefinition | undefined {
  if (record.metadata.specVersion !== CORE_BOOTSTRAP_WRITER_SPEC_VERSIONS.KindDefinition) {
    diagnostics.push({
      code: "CORE_RESOURCE_SPEC_VERSION_UNSUPPORTED",
      location: record.documentUri,
      message: `KindDefinition bootstrap only admits writer specVersion ${CORE_BOOTSTRAP_WRITER_SPEC_VERSIONS.KindDefinition}; received ${record.metadata.specVersion}.`,
    })
    return undefined
  }
  if (Object.prototype.hasOwnProperty.call(record.node.properties, "currentApiVersion")
    || Object.prototype.hasOwnProperty.call(record.node.properties, "supportedApiVersions")
    || Object.prototype.hasOwnProperty.call(record.node.properties, "currentSpecVersion")
    || Object.prototype.hasOwnProperty.call(record.node.properties, "supportedSpecVersions")) {
    diagnostics.push({
      code: "KIND_DEFINITION_VERSION_FIELDS_REMOVED",
      location: record.documentUri,
      message: "KindDefinition must not declare current/supported API or spec version fields; declare exact SpecRevisions instead.",
    })
    return undefined
  }
  const resourceKind = asString(record.node.properties.resourceKind)
    ?? record.resourceId.split(".").at(-1)
  const subjectFqn = asString(record.node.properties.subjectFqn)
  const shapes = record.node.properties.sourceShapes
  const sourceShapes = Array.isArray(shapes)
    ? [...new Set(shapes.filter(isXnlShape))].sort(compareCodeUnits)
    : []
  const cardinalityValue = asString(record.node.properties.documentCardinality) ?? "one"
  if (!resourceKind || !subjectFqn || sourceShapes.length === 0 || !isDocumentCardinality(cardinalityValue)) {
    diagnostics.push({
      code: "KIND_DEFINITION_INVALID",
      location: record.documentUri,
      message: "KindDefinition requires resourceKind, subjectFqn, sourceShapes and one or more exact SpecRevisions.",
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
    .sort(compareCodeUnits)
  const sourceContractFingerprint = digestCanonical({
    sourceShapes,
    documentCardinality: cardinalityValue,
    requiredFiles,
  })
  const specRevisions = normalizeSpecRevisions(record, diagnostics, sourceContractFingerprint)
  if (specRevisions.length === 0) {
    diagnostics.push({
      code: "KIND_DEFINITION_INVALID",
      location: record.documentUri,
      message: "KindDefinition requires one or more exact SpecRevisions.",
    })
    return undefined
  }
  return Object.freeze({
    resourceId: record.resourceId,
    resourceKind,
    subjectFqn,
    sourceShapes: Object.freeze([...sourceShapes]),
    specRevisions,
    requiredFiles: Object.freeze([...requiredFiles]),
    documentCardinality: cardinalityValue,
    documentUri: record.documentUri,
  })
}

function normalizeSpecRevisions(
  record: ResourceRecord,
  diagnostics: ResourceDiagnostic[],
  _sourceContractFingerprint: Sha256Digest,
): readonly KindSpecRevisionDescriptor[] {
  const node = record.node.subdomains.SpecRevisions
  if (!node) return Object.freeze([])
  const revisions: KindSpecRevisionDescriptor[] = []
  const seen = new Set<number>()
  for (const value of node.body) {
    if (!isResourceNode(value) || value.tag !== "SpecRevision") continue
    const specVersion = value.properties.specVersion
    const schemaRef = asString(value.properties.schemaRef)
    const schemaFingerprint = asSha256(value.properties.schemaFingerprint)
    const contractFingerprint = asSha256(value.properties.contractFingerprint)
    const semanticValidatorFingerprint = asSha256(value.properties.semanticValidatorFingerprint)
    const referenceProjectionFingerprint = asSha256(value.properties.referenceProjectionFingerprint)
    const compilerInputFingerprint = asSha256(value.properties.compilerInputFingerprint)
    const stability = asString(value.properties.stability)
    if (!isSpecVersion(specVersion) || !schemaRef || !schemaFingerprint || !contractFingerprint
      || !semanticValidatorFingerprint || !referenceProjectionFingerprint || !compilerInputFingerprint
      || !isRevisionStability(stability)) {
      diagnostics.push({
        code: "KIND_SPEC_REVISION_INVALID",
        location: `${record.documentUri}#SpecRevision:${value.resourceId ?? "unknown"}`,
        message: "SpecRevision requires a positive specVersion, schemaRef, exact schema/contract/semantic fingerprints and stability.",
      })
      continue
    }
    if (seen.has(specVersion)) {
      diagnostics.push({
        code: "KIND_SPEC_REVISION_CONFLICT",
        location: `${record.documentUri}#SpecRevision:${value.resourceId ?? specVersion}`,
        message: `KindDefinition declares specVersion ${specVersion} more than once.`,
      })
      continue
    }
    seen.add(specVersion)
    revisions.push(Object.freeze({
      specVersion,
      schemaRef,
      schemaFingerprint,
      contractFingerprint,
      semanticContract: Object.freeze({
        semanticValidatorFingerprint,
        referenceProjectionFingerprint,
        compilerInputFingerprint,
      }),
      stability,
    }))
  }
  return Object.freeze(revisions.sort((left, right) => left.specVersion - right.specVersion))
}

async function validateRequiredFiles(
  resourceDir: string,
  record: ResourceRecord,
  definition: RegisteredKindDefinition,
  context: LoaderContext,
): Promise<void> {
  for (const name of definition.requiredFiles) {
    if (!isPlainEntry(name)) {
      context.diagnostics.push({ code: "KIND_DEFINITION_REQUIRED_FILE_INVALID", location: record.documentUri, message: `Invalid required file '${name}'.` })
      continue
    }
    const target = joinResourcePackageSourcePath(resourceDir, name)
    const entry = await safeStat(context.port, target)
    if (entry?.kind !== "file") context.diagnostics.push({ code: "RESOURCE_REQUIRED_FILE_MISSING", location: `${record.documentUri}#${name}`, message: `Resource is missing required material '${name}'.` })
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
  if (decoded.startsWith("/") || /^[A-Za-z]:/u.test(decoded) || decoded.split(/[\\/]+/).includes("..") || /%2f|%5c/i.test(rawPath)) {
    context.diagnostics.push({ code: "RESOURCE_REF_CONTAINMENT", location, message: "VFS reference escapes the owning package boundary." })
    return undefined
  }
  const base = relativeMatch[1] === "@/" ? context.rootPath : manifestDir
  const candidate = resolvePackageRelativePath(base, decoded)
  if (!candidate || relativeResourcePackageSourcePath(context.rootPath, candidate) === undefined) {
    context.diagnostics.push({ code: "RESOURCE_REF_CONTAINMENT", location, message: "VFS reference resolves outside the owning package boundary." })
    return undefined
  }
  return candidate
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

function logicalPathFor(rootPath: string, filePath: string): string {
  const relative = relativeResourcePackageSourcePath(rootPath, filePath)
  if (relative === undefined) throw new TypeError("Resource source path is outside the package root")
  return relative
}

function documentUriFor(rootPath: string, filePath: string): string {
  return `vfs://@/${logicalPathFor(rootPath, filePath)}`
}

function kindMismatch(actual: string, expected: string, location: string): ResourceDiagnostic {
  return { code: "RESOURCE_KIND_MISMATCH", location, message: `Resource kind '${actual}' does not match catalog kind '${expected}'.` }
}

function isXnlShape(value: unknown): value is SourceShape {
  return value === "single-file" || value === "directory" || value === "manifest"
}

function isDocumentCardinality(value: string): value is "one" | "many" {
  return value === "one" || value === "many"
}

function isPlainEntry(value: string): boolean {
  return Boolean(value) && !value.includes("/") && !value.includes("\\") && !value.includes("..")
}

function isPlainSourceEntryName(value: string): boolean {
  return Boolean(value) && value !== "." && value !== ".." && !value.includes("/") && !value.includes("\\") && !value.includes("\0")
}

function isResourcePackageEntryKind(value: unknown): value is "file" | "directory" | "symlink" | "other" {
  return value === "file" || value === "directory" || value === "symlink" || value === "other"
}

function isSingleFileExtension(value: string): boolean {
  const lower = value.toLowerCase()
  return lower.endsWith(".xnl") || lower.endsWith(".md")
}

function resolvePackageRelativePath(base: string, relativePath: string): string | undefined {
  if (relativePath.includes("\\") || relativePath.includes("\0") || relativePath.startsWith("/")) return undefined
  const segments = relativePath.split("/").filter((segment) => segment.length > 0)
  if (segments.some((segment) => segment === "." || segment === "..")) return undefined
  try {
    return joinResourcePackageSourcePath(base, ...segments)
  } catch {
    return undefined
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function normalizeExternalMap(value: Record<string, unknown>): Record<string, ResourceValue> {
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalizeExternalValue(child)]))
}

function normalizeExternalValue(value: unknown): ResourceValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (Array.isArray(value)) return Object.freeze(value.map(normalizeExternalValue))
  if (isPlainObject(value)) return Object.freeze(normalizeExternalMap(value))
  throw new TypeError(`unsupported value ${Object.prototype.toString.call(value)}`)
}

function asString(value: ResourceValue | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined
}

function asSha256(value: ResourceValue | undefined): Sha256Digest | undefined {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value)
    ? value as Sha256Digest
    : undefined
}

function isRevisionStability(value: string | undefined): value is KindSpecRevisionDescriptor["stability"] {
  return value === "experimental" || value === "stable" || value === "deprecated"
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
