import { compareCodeUnits } from "./canonical"
import { ResourceCompositionError } from "./composition-error"
import {
  createResourceContentIdentity,
  type ResourceContentIdentity,
  type ResourceDigestContribution,
} from "./dependency-snapshot"
import {
  effectiveRegistryLayerBindings,
  isEffectiveRegistryAuthentic,
} from "./effective-registry-brand"
import { isLoadedResourceTreeAuthentic } from "./loaded-resource-tree-brand"
import { readonlyMap } from "./readonly-map"
import type { LoadedResourceTree, ResourceDiagnostic, ResourceRecord } from "./index"
import type { EffectiveResourceEntry, EffectiveResourceRegistry } from "./layered-registry"

export interface ResourceLayerContentIdentityInput {
  readonly id: string
  readonly tree: LoadedResourceTree
}

export interface ResolveEffectiveResourceContentIdentitiesInput {
  readonly registry: EffectiveResourceRegistry
  readonly layers: readonly ResourceLayerContentIdentityInput[]
  readonly contributions?: ReadonlyMap<string, readonly ResourceDigestContribution[]>
}

export function resolveEffectiveResourceContentIdentities(
  input: ResolveEffectiveResourceContentIdentitiesInput,
): ReadonlyMap<string, ResourceContentIdentity> {
  const diagnostics: ResourceDiagnostic[] = []
  if (!isEffectiveRegistryAuthentic(input.registry)) {
    throw compositionError(diagnostic(
      "RESOURCE_CONTENT_IDENTITY_REGISTRY_UNTRUSTED",
      "content-projector:registry",
      "Effective content identities require an authentic registry returned by composeLayeredResourceRegistry().",
    ))
  }

  const bindings = effectiveRegistryLayerBindings(input.registry) ?? []
  if (input.layers.length !== input.registry.layers.length || bindings.length !== input.registry.layers.length) {
    diagnostics.push(diagnostic(
      "RESOURCE_CONTENT_IDENTITY_LAYER_COUNT_MISMATCH",
      "content-projector:layers",
      "Effective content identity layers must exactly match the composed registry layers.",
    ))
  }

  const loadedById = new Map<string, LoadedResourceTree>()
  for (let index = 0; index < input.registry.layers.length; index += 1) {
    const descriptor = input.registry.layers[index]!
    const layer = input.layers[index]
    const binding = bindings[index]
    if (!layer) continue
    if (!isLoadedResourceTreeAuthentic(layer.tree)) {
      diagnostics.push(diagnostic(
        "RESOURCE_CONTENT_IDENTITY_LAYER_UNTRUSTED",
        layerLocation(index, layer.id),
        `Layer '${layer.id}' must use an authentic LoadedResourceTree returned by loadResourceTree().`,
      ))
      continue
    }
    if (layer.id !== descriptor.id || binding?.id !== descriptor.id) {
      diagnostics.push(diagnostic(
        "RESOURCE_CONTENT_IDENTITY_LAYER_ID_MISMATCH",
        layerLocation(index, layer.id),
        `Layer at index ${index} must retain exact id '${descriptor.id}'.`,
      ))
      continue
    }
    if (descriptor.index !== index) {
      diagnostics.push(diagnostic(
        "RESOURCE_CONTENT_IDENTITY_LAYER_INDEX_MISMATCH",
        layerLocation(index, layer.id),
        `Layer '${layer.id}' has inconsistent registry index ${descriptor.index}.`,
      ))
      continue
    }
    if (layer.tree.manifest.resourceId !== descriptor.packageId) {
      diagnostics.push(diagnostic(
        "RESOURCE_CONTENT_IDENTITY_LAYER_PACKAGE_MISMATCH",
        layerLocation(index, layer.id),
        `Layer '${layer.id}' must retain package '${descriptor.packageId}'.`,
      ))
      continue
    }
    if (binding?.tree !== layer.tree) {
      diagnostics.push(diagnostic(
        "RESOURCE_CONTENT_IDENTITY_LAYER_BINDING_MISMATCH",
        layerLocation(index, layer.id),
        `Layer '${layer.id}' must use the exact loaded tree composed into the registry.`,
      ))
      continue
    }
    validateLoadedIdentityCoverage(layer.tree, layer.id, diagnostics)
    loadedById.set(layer.id, layer.tree)
  }

  const effectiveEntries = [...input.registry.byId.values()]
    .filter((entry) => entry.resource !== undefined)
    .sort((left, right) => compareCodeUnits(left.resourceId, right.resourceId))
  const effectiveIds = new Set(effectiveEntries.map((entry) => entry.resourceId))
  for (const resourceId of input.contributions?.keys() ?? []) {
    if (!effectiveIds.has(resourceId)) {
      diagnostics.push(diagnostic(
        "RESOURCE_DIGEST_CONTRIBUTION_OWNER_UNKNOWN",
        contentLocation(resourceId),
        `Digest contributions target unknown effective resource '${resourceId}'.`,
      ))
    }
  }

  const output: Array<readonly [string, ResourceContentIdentity]> = []
  for (const entry of effectiveEntries) {
    const tree = entry.effectiveLayerId === undefined ? undefined : loadedById.get(entry.effectiveLayerId)
    if (!tree || !entry.effectiveOrigin) {
      diagnostics.push(diagnostic(
        "RESOURCE_CONTENT_IDENTITY_EFFECTIVE_ORIGIN_MISSING",
        contentLocation(entry.resourceId),
        `Effective resource '${entry.resourceId}' has no exact loaded layer origin.`,
      ))
      continue
    }
    validateEffectiveOrigin(entry, input.registry, tree, diagnostics)
    const authorityIdentity = tree.contentIdentities.get(entry.resourceId)
    if (!authorityIdentity) {
      diagnostics.push(diagnostic(
        "RESOURCE_CONTENT_IDENTITY_MISSING",
        contentLocation(entry.resourceId),
        `Effective resource '${entry.resourceId}' is missing its loader authority identity.`,
      ))
      continue
    }
    try {
      const identity = createResourceContentIdentity({
        resourceId: entry.resourceId,
        authorityDigest: authorityIdentity.authorityDigest,
        contributions: input.contributions?.get(entry.resourceId) ?? [],
      })
      output.push([entry.resourceId, identity])
    } catch (error) {
      if (error instanceof ResourceCompositionError) diagnostics.push(...error.diagnostics)
      else throw error
    }
  }

  if (diagnostics.length > 0) throw new ResourceCompositionError(stableDiagnostics(diagnostics))
  return readonlyMap(output.sort(([left], [right]) => compareCodeUnits(left, right)))
}

function validateLoadedIdentityCoverage(
  tree: LoadedResourceTree,
  layerId: string,
  diagnostics: ResourceDiagnostic[],
): void {
  const resources = [...tree.registry.byKind.values()]
    .flatMap((records) => [...records])
    .sort((left, right) => compareCodeUnits(left.resourceId, right.resourceId))
  const resourcesById = new Map(resources.map((resource) => [resource.resourceId, resource]))
  for (const resource of resources) {
    const identity = tree.contentIdentities.get(resource.resourceId)
    if (!identity) {
      diagnostics.push(diagnostic(
        "RESOURCE_CONTENT_IDENTITY_MISSING",
        layerLocation(undefined, layerId, resource.resourceId),
        `Loaded resource '${resource.resourceId}' has no authority identity.`,
      ))
      continue
    }
    const normalized = createResourceContentIdentity({
      resourceId: identity.resourceId,
      authorityDigest: identity.authorityDigest,
      contributions: [],
    })
    if (identity.resourceId !== resource.resourceId || identity.contentDigest !== normalized.contentDigest) {
      diagnostics.push(diagnostic(
        "RESOURCE_CONTENT_IDENTITY_INVALID",
        layerLocation(undefined, layerId, resource.resourceId),
        `Loaded resource '${resource.resourceId}' has an inconsistent authority identity.`,
      ))
    }
  }
  for (const resourceId of tree.contentIdentities.keys()) {
    if (!resourcesById.has(resourceId)) {
      diagnostics.push(diagnostic(
        "RESOURCE_CONTENT_IDENTITY_EXTRA",
        layerLocation(undefined, layerId, resourceId),
        `Loaded tree contains an extra authority identity '${resourceId}'.`,
      ))
    }
  }
}

function validateEffectiveOrigin(
  entry: EffectiveResourceEntry,
  registry: EffectiveResourceRegistry,
  tree: LoadedResourceTree,
  diagnostics: ResourceDiagnostic[],
): void {
  const origin = entry.effectiveOrigin!
  const descriptor = registry.layers[origin.layerIndex]
  const loadedRecord = findResource(tree, entry.resourceId)
  if (!descriptor
    || descriptor.id !== origin.layerId
    || descriptor.packageId !== origin.packageId
    || tree.manifest.resourceId !== origin.packageId
    || !loadedRecord
    || loadedRecord.documentUri !== origin.documentUri
    || loadedRecord.logicalPath !== origin.logicalPath) {
    diagnostics.push(diagnostic(
      "RESOURCE_CONTENT_IDENTITY_EFFECTIVE_ORIGIN_MISMATCH",
      contentLocation(entry.resourceId),
      `Effective resource '${entry.resourceId}' does not match its exact layer/package/origin facts.`,
    ))
  }
}

function findResource(tree: LoadedResourceTree, resourceId: string): ResourceRecord | undefined {
  for (const records of tree.registry.byKind.values()) {
    const resource = records.find((record) => record.resourceId === resourceId)
    if (resource) return resource
  }
  return undefined
}

function stableDiagnostics(diagnostics: readonly ResourceDiagnostic[]): readonly ResourceDiagnostic[] {
  return Object.freeze([...diagnostics].sort((left, right) =>
    compareCodeUnits(left.location, right.location) || compareCodeUnits(left.code, right.code),
  ))
}

function compositionError(diagnosticValue: ResourceDiagnostic): ResourceCompositionError {
  return new ResourceCompositionError(Object.freeze([diagnosticValue]))
}

function diagnostic(code: string, location: string, message: string): ResourceDiagnostic {
  return Object.freeze({ code, location, message })
}

function layerLocation(index: number | undefined, layerId: string, resourceId?: string): string {
  return `content-layer:${index ?? "unknown"}:${layerId}${resourceId === undefined ? "" : `:${resourceId}`}`
}

function contentLocation(resourceId: string): string {
  return `content:${resourceId || "unnamed"}`
}
