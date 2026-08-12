import { compareCodeUnits, digestCanonical } from "./canonical"
import { ResourceCompositionError } from "./composition-error"
import { markEffectiveRegistryAuthentic } from "./effective-registry-brand"
import { readonlyMap } from "./readonly-map"
import type {
  RegisteredKindDefinition,
  ResourceDiagnostic,
  ResourceMetadata,
  ResourceNode,
  ResourceRecord,
  ResourceTree,
  ResourceValue,
} from "./index"

export interface ResourceTombstone {
  readonly resourceId: string
  readonly expectedKind?: string
  readonly reason?: string
}

export interface ResourceLayerInput {
  readonly id: string
  readonly tree: ResourceTree
  readonly tombstones?: readonly ResourceTombstone[]
}

export interface ResourceLayerDescriptor {
  readonly id: string
  readonly index: number
  readonly packageId: string
}

export interface ResourceOrigin {
  readonly layerId: string
  readonly layerIndex: number
  readonly packageId: string
  readonly documentUri: string
  readonly logicalPath?: string
}

export interface ResourceTombstoneOrigin extends ResourceTombstone {
  readonly layerId: string
  readonly layerIndex: number
  readonly packageId: string
}

export interface EffectiveResourceEntry {
  readonly resourceId: string
  readonly kind: string
  readonly resource?: ResourceRecord
  readonly effectiveLayerId?: string
  readonly effectiveOrigin?: ResourceOrigin
  readonly shadowed: readonly ResourceOrigin[]
  readonly tombstone?: ResourceTombstoneOrigin
  readonly tombstones: readonly ResourceTombstoneOrigin[]
}

export interface EffectiveKindDefinition {
  readonly definition: RegisteredKindDefinition
  readonly origins: readonly ResourceOrigin[]
}

export interface EffectiveResourceRegistry {
  readonly byId: ReadonlyMap<string, EffectiveResourceEntry>
  readonly byKind: ReadonlyMap<string, readonly ResourceRecord[]>
  readonly kindDefinitions: ReadonlyMap<string, EffectiveKindDefinition>
  readonly layers: readonly ResourceLayerDescriptor[]
  readonly compositionRevision: string
  /** Compatibility alias for compositionRevision. */
  readonly revision: string
}

export interface ComposeLayeredResourceRegistryInput {
  readonly layers: readonly ResourceLayerInput[]
}

interface MutableEntry {
  resourceId: string
  kind: string
  resource?: ResourceRecord
  effectiveLayerId?: string
  effectiveOrigin?: ResourceOrigin
  shadowed: ResourceOrigin[]
  tombstone?: ResourceTombstoneOrigin
  tombstones: ResourceTombstoneOrigin[]
}

interface MutableKindDefinition {
  definition: RegisteredKindDefinition
  origins: ResourceOrigin[]
}

export function composeLayeredResourceRegistry(
  input: ComposeLayeredResourceRegistryInput,
): EffectiveResourceRegistry {
  const diagnostics: ResourceDiagnostic[] = []
  const layerIds = new Set<string>()
  const layers: ResourceLayerDescriptor[] = []
  const entries = new Map<string, MutableEntry>()
  const kindDefinitions = new Map<string, MutableKindDefinition>()

  input.layers.forEach((layer, layerIndex) => {
    const layerId = layer.id.trim()
    const packageId = layer.tree.manifest.resourceId
    if (layerId.length === 0) {
      diagnostics.push(diagnostic(
        "RESOURCE_LAYER_ID_EMPTY",
        layerLocation(layerIndex),
        "Resource layer id must be a non-empty explicit value.",
      ))
      return
    }
    if (layerIds.has(layerId)) {
      diagnostics.push(diagnostic(
        "RESOURCE_LAYER_ID_DUPLICATE",
        layerLocation(layerIndex, layerId),
        `Resource layer id '${layerId}' is declared more than once.`,
      ))
      return
    }
    layerIds.add(layerId)
    layers.push(Object.freeze({ id: layerId, index: layerIndex, packageId }))

    mergeKindDefinitions(layer.tree, layerId, layerIndex, packageId, kindDefinitions, diagnostics)
    mergeResources(layer.tree, layerId, layerIndex, packageId, entries, diagnostics)
    applyTombstones(layer, layerId, layerIndex, packageId, entries, diagnostics)
  })

  if (diagnostics.length > 0) throw new ResourceCompositionError(stableDiagnostics(diagnostics))

  const frozenEntries = [...entries.values()]
    .sort((left, right) => compareCodeUnits(left.resourceId, right.resourceId))
    .map((entry) => freezeEntry(entry))
  const byId = readonlyMap(frozenEntries.map((entry) => [entry.resourceId, entry] as const))

  const byKindValues = new Map<string, ResourceRecord[]>()
  for (const entry of frozenEntries) {
    if (!entry.resource) continue
    const records = byKindValues.get(entry.kind) ?? []
    records.push(entry.resource)
    byKindValues.set(entry.kind, records)
  }
  const byKind = readonlyMap(
    [...byKindValues.entries()]
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([kind, records]) => [
        kind,
        Object.freeze([...records].sort((left, right) => compareCodeUnits(left.resourceId, right.resourceId))),
      ] as const),
  )

  const frozenDefinitions = [...kindDefinitions.entries()]
    .sort(([left], [right]) => compareCodeUnits(left, right))
    .map(([kind, value]) => [kind, Object.freeze({
      definition: value.definition,
      origins: Object.freeze([...value.origins].sort(compareOrigins)),
    })] as const)
  const publicKindDefinitions = readonlyMap(frozenDefinitions)
  const frozenLayers = Object.freeze([...layers])
  const compositionRevision = digestCanonical({
    layers: frozenLayers.map((layer) => ({
      id: layer.id,
      index: layer.index,
      packageId: layer.packageId,
    })),
    entries: frozenEntries.map(entryRevisionFact),
    kindDefinitions: frozenDefinitions.map(([kind, value]) => ({
      kind,
      definitionResourceId: value.definition.resourceId,
      contract: normalizedKindContract(value.definition),
      origins: value.origins.map(stableOriginFact),
    })),
  })

  return markEffectiveRegistryAuthentic(Object.freeze({
    byId,
    byKind,
    kindDefinitions: publicKindDefinitions,
    layers: frozenLayers,
    compositionRevision,
    revision: compositionRevision,
  }), frozenLayers.map((layer) => ({
    id: layer.id,
    tree: input.layers[layer.index]!.tree,
  })))
}

function mergeKindDefinitions(
  tree: ResourceTree,
  layerId: string,
  layerIndex: number,
  packageId: string,
  definitions: Map<string, MutableKindDefinition>,
  diagnostics: ResourceDiagnostic[],
): void {
  for (const [kind, inputDefinition] of [...tree.registry.kindDefinitions.entries()]
    .sort(([left], [right]) => compareCodeUnits(left, right))) {
    if (!isCanonicalVfsDocumentUri(inputDefinition.documentUri)) {
      diagnostics.push(diagnostic(
        "RESOURCE_LAYER_PROVENANCE_INVALID",
        layerLocation(layerIndex, layerId, kind),
        `Resource kind '${kind}' must use canonical VFS document provenance.`,
      ))
      continue
    }
    const definition = cloneRegisteredKindDefinition(inputDefinition)
    const origin = kindDefinitionOrigin(layerId, layerIndex, packageId, definition)
    const current = definitions.get(kind)
    if (!current) {
      definitions.set(kind, { definition, origins: [origin] })
      continue
    }
    if (JSON.stringify(normalizedKindContract(current.definition)) !== JSON.stringify(normalizedKindContract(definition))) {
      diagnostics.push(diagnostic(
        "RESOURCE_LAYER_KIND_DEFINITION_CONFLICT",
        layerLocation(layerIndex, layerId, kind),
        `Resource kind '${kind}' has incompatible KindDefinition contracts across layers.`,
      ))
      continue
    }
    current.origins.push(origin)
  }
}

function mergeResources(
  tree: ResourceTree,
  layerId: string,
  layerIndex: number,
  packageId: string,
  entries: Map<string, MutableEntry>,
  diagnostics: ResourceDiagnostic[],
): void {
  const records = [...tree.registry.byKind.values()]
    .flatMap((values) => [...values])
    .sort((left, right) => compareCodeUnits(left.resourceId, right.resourceId)
      || compareCodeUnits(left.kind, right.kind))
  const seenInLayer = new Set<string>()
  for (const resource of records) {
    if (seenInLayer.has(resource.resourceId)) {
      diagnostics.push(diagnostic(
        "RESOURCE_LAYER_RESOURCE_DUPLICATE",
        layerLocation(layerIndex, layerId, resource.resourceId),
        `Resource '${resource.resourceId}' occurs more than once in layer '${layerId}'.`,
      ))
      continue
    }
    seenInLayer.add(resource.resourceId)
    if (!isSafeLogicalPath(resource.logicalPath)
      || resource.documentUri !== `vfs://@/${resource.logicalPath}`) {
      diagnostics.push(diagnostic(
        "RESOURCE_LAYER_PROVENANCE_INVALID",
        layerLocation(layerIndex, layerId, resource.resourceId),
        `Resource '${resource.resourceId}' must use matching canonical VFS documentUri and safe logicalPath provenance.`,
      ))
      continue
    }
    const immutableResource = cloneResourceRecord(resource)
    const origin = resourceOrigin(layerId, layerIndex, packageId, immutableResource)
    const current = entries.get(resource.resourceId)
    if (!current) {
      entries.set(resource.resourceId, {
        resourceId: resource.resourceId,
        kind: resource.kind,
        resource: immutableResource,
        effectiveLayerId: layerId,
        effectiveOrigin: origin,
        shadowed: [],
        tombstones: [],
      })
      continue
    }
    if (current.kind !== resource.kind) {
      diagnostics.push(diagnostic(
        "RESOURCE_LAYER_IDENTITY_KIND_CONFLICT",
        layerLocation(layerIndex, layerId, resource.resourceId),
        `Resource '${resource.resourceId}' changes kind from '${current.kind}' to '${resource.kind}' across layers.`,
      ))
      continue
    }
    if (current.effectiveOrigin) current.shadowed.push(current.effectiveOrigin)
    current.resource = immutableResource
    current.effectiveLayerId = layerId
    current.effectiveOrigin = origin
    current.tombstone = undefined
  }
}

function applyTombstones(
  layer: ResourceLayerInput,
  layerId: string,
  layerIndex: number,
  packageId: string,
  entries: Map<string, MutableEntry>,
  diagnostics: ResourceDiagnostic[],
): void {
  const tombstones = [...(layer.tombstones ?? [])]
    .sort((left, right) => compareCodeUnits(left.resourceId, right.resourceId))
  const seen = new Set<string>()
  for (const tombstone of tombstones) {
    const resourceId = tombstone.resourceId.trim()
    if (resourceId.length === 0) {
      diagnostics.push(diagnostic(
        "RESOURCE_LAYER_TOMBSTONE_ID_EMPTY",
        layerLocation(layerIndex, layerId),
        "Resource tombstone target must be a non-empty resource id.",
      ))
      continue
    }
    if (seen.has(resourceId)) {
      diagnostics.push(diagnostic(
        "RESOURCE_LAYER_TOMBSTONE_DUPLICATE",
        layerLocation(layerIndex, layerId, resourceId),
        `Resource '${resourceId}' has more than one tombstone in layer '${layerId}'.`,
      ))
      continue
    }
    seen.add(resourceId)
    const current = entries.get(resourceId)
    if (!current) {
      diagnostics.push(diagnostic(
        "RESOURCE_LAYER_TOMBSTONE_TARGET_MISSING",
        layerLocation(layerIndex, layerId, resourceId),
        `Tombstone target '${resourceId}' does not exist in a lower or current layer.`,
      ))
      continue
    }
    if (current.effectiveLayerId === layerId) {
      diagnostics.push(diagnostic(
        "RESOURCE_LAYER_TOMBSTONE_RESOURCE_CONFLICT",
        layerLocation(layerIndex, layerId, resourceId),
        `Resource '${resourceId}' cannot be both effective and tombstoned in layer '${layerId}'.`,
      ))
      continue
    }
    if (tombstone.expectedKind !== undefined && tombstone.expectedKind !== current.kind) {
      diagnostics.push(diagnostic(
        "RESOURCE_LAYER_TOMBSTONE_KIND_MISMATCH",
        layerLocation(layerIndex, layerId, resourceId),
        `Tombstone for '${resourceId}' expects kind '${tombstone.expectedKind}', but the target kind is '${current.kind}'.`,
      ))
      continue
    }
    const origin: ResourceTombstoneOrigin = Object.freeze({
      resourceId,
      ...(tombstone.expectedKind === undefined ? {} : { expectedKind: tombstone.expectedKind }),
      ...(tombstone.reason === undefined ? {} : { reason: tombstone.reason }),
      layerId,
      layerIndex,
      packageId,
    })
    if (current.effectiveOrigin) current.shadowed.push(current.effectiveOrigin)
    current.resource = undefined
    current.effectiveLayerId = undefined
    current.effectiveOrigin = undefined
    current.tombstone = origin
    current.tombstones.push(origin)
  }
}

function resourceOrigin(
  layerId: string,
  layerIndex: number,
  packageId: string,
  resource: ResourceRecord,
): ResourceOrigin {
  return Object.freeze({
    layerId,
    layerIndex,
    packageId,
    documentUri: resource.documentUri,
    logicalPath: resource.logicalPath,
  })
}

function kindDefinitionOrigin(
  layerId: string,
  layerIndex: number,
  packageId: string,
  definition: RegisteredKindDefinition,
): ResourceOrigin {
  return Object.freeze({ layerId, layerIndex, packageId, documentUri: definition.documentUri })
}

function freezeEntry(entry: MutableEntry): EffectiveResourceEntry {
  return Object.freeze({
    resourceId: entry.resourceId,
    kind: entry.kind,
    ...(entry.resource === undefined ? {} : { resource: entry.resource }),
    ...(entry.effectiveLayerId === undefined ? {} : { effectiveLayerId: entry.effectiveLayerId }),
    ...(entry.effectiveOrigin === undefined ? {} : { effectiveOrigin: entry.effectiveOrigin }),
    shadowed: Object.freeze([...entry.shadowed].sort(compareOrigins)),
    ...(entry.tombstone === undefined ? {} : { tombstone: entry.tombstone }),
    tombstones: Object.freeze([...entry.tombstones].sort(compareTombstones)),
  })
}

function entryRevisionFact(entry: EffectiveResourceEntry): unknown {
  return {
    resourceId: entry.resourceId,
    kind: entry.kind,
    resourcePresent: entry.resource !== undefined,
    effectiveLayerId: entry.effectiveLayerId,
    effectiveOrigin: entry.effectiveOrigin === undefined ? undefined : stableOriginFact(entry.effectiveOrigin),
    shadowed: entry.shadowed.map(stableOriginFact),
    tombstone: entry.tombstone === undefined ? undefined : stableTombstoneFact(entry.tombstone),
    tombstones: entry.tombstones.map(stableTombstoneFact),
  }
}

function cloneResourceRecord(resource: ResourceRecord): ResourceRecord {
  return Object.freeze({
    kind: resource.kind,
    ...(resource.fqn === undefined ? {} : { fqn: resource.fqn }),
    ...(resource.name === undefined ? {} : { name: resource.name }),
    ...(resource.description === undefined ? {} : { description: resource.description }),
    resourceId: resource.resourceId,
    metadata: cloneResourceMetadata(resource.metadata),
    sourceShape: resource.sourceShape,
    logicalPath: resource.logicalPath,
    documentUri: resource.documentUri,
    format: resource.format,
    node: cloneResourceValue(resource.node) as ResourceNode,
  })
}

function cloneResourceMetadata(metadata: ResourceMetadata): ResourceMetadata {
  return Object.freeze({
    apiVersion: metadata.apiVersion,
    ...(metadata.lifecycle === undefined ? {} : { lifecycle: metadata.lifecycle }),
    ...(metadata.version === undefined ? {} : { version: metadata.version }),
  })
}

function cloneResourceValue(value: ResourceValue): ResourceValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => cloneResourceValue(item)))
  }
  const clone: Record<string, ResourceValue> = {}
  for (const key of Object.keys(value).sort(compareCodeUnits)) {
    clone[key] = cloneResourceValue((value as Readonly<Record<string, ResourceValue>>)[key]!)
  }
  return Object.freeze(clone)
}

function cloneRegisteredKindDefinition(definition: RegisteredKindDefinition): RegisteredKindDefinition {
  return Object.freeze({
    resourceId: definition.resourceId,
    resourceKind: definition.resourceKind,
    sourceShapes: Object.freeze([...definition.sourceShapes].sort(compareCodeUnits)),
    requiredFiles: Object.freeze([...definition.requiredFiles].sort(compareCodeUnits)),
    currentApiVersion: definition.currentApiVersion,
    supportedApiVersions: Object.freeze([...definition.supportedApiVersions].sort(compareCodeUnits)),
    documentCardinality: definition.documentCardinality,
    documentUri: definition.documentUri,
  })
}

function normalizedKindContract(definition: RegisteredKindDefinition): unknown {
  return {
    resourceKind: definition.resourceKind,
    sourceShapes: [...definition.sourceShapes].sort(compareCodeUnits),
    requiredFiles: [...definition.requiredFiles].sort(compareCodeUnits),
    currentApiVersion: definition.currentApiVersion,
    supportedApiVersions: [...definition.supportedApiVersions].sort(compareCodeUnits),
    documentCardinality: definition.documentCardinality,
  }
}

function stableOriginFact(origin: ResourceOrigin): unknown {
  return {
    layerId: origin.layerId,
    layerIndex: origin.layerIndex,
    packageId: origin.packageId,
    documentUri: origin.documentUri,
    logicalPath: origin.logicalPath,
  }
}

function stableTombstoneFact(origin: ResourceTombstoneOrigin): unknown {
  return {
    resourceId: origin.resourceId,
    expectedKind: origin.expectedKind,
    reason: origin.reason,
    layerId: origin.layerId,
    layerIndex: origin.layerIndex,
    packageId: origin.packageId,
  }
}

function isCanonicalVfsDocumentUri(documentUri: string): boolean {
  const prefix = "vfs://@/"
  return documentUri.startsWith(prefix) && isSafeLogicalPath(documentUri.slice(prefix.length))
}

function isSafeLogicalPath(logicalPath: string): boolean {
  if (logicalPath.length === 0 || logicalPath.startsWith("/") || logicalPath.includes("\\")) return false
  return logicalPath.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
}

function compareOrigins(left: ResourceOrigin, right: ResourceOrigin): number {
  return left.layerIndex - right.layerIndex || compareCodeUnits(left.layerId, right.layerId)
}

function compareTombstones(left: ResourceTombstoneOrigin, right: ResourceTombstoneOrigin): number {
  return left.layerIndex - right.layerIndex || compareCodeUnits(left.resourceId, right.resourceId)
}

function stableDiagnostics(diagnostics: readonly ResourceDiagnostic[]): readonly ResourceDiagnostic[] {
  return Object.freeze([...diagnostics].sort((left, right) =>
    compareCodeUnits(left.location, right.location) || compareCodeUnits(left.code, right.code),
  ))
}

function diagnostic(code: string, location: string, message: string): ResourceDiagnostic {
  return Object.freeze({ code, location, message })
}

function layerLocation(index: number, layerId?: string, subject?: string): string {
  return `layer:${index}:${layerId ?? "unnamed"}${subject === undefined ? "" : `:${subject}`}`
}
