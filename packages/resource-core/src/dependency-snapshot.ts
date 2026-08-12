import {
  compareCodeUnits,
  digestCanonical,
  sha256Digest as digestBytes,
  type Sha256Digest,
} from "./canonical"
import { ResourceCompositionError } from "./composition-error"
import { isEffectiveRegistryAuthentic } from "./effective-registry-brand"
import type { ResourceDiagnostic } from "./index"
import type { EffectiveResourceRegistry, ResourceOrigin } from "./layered-registry"

export type { Sha256Digest }

export interface ResourceDigestContribution {
  readonly key: string
  readonly digest: string
  readonly sourceUri?: string
}

export interface CreateResourceContentIdentityInput {
  readonly resourceId: string
  readonly authorityDigest: string
  readonly contributions?: readonly ResourceDigestContribution[]
}

export interface ResourceContentIdentity {
  readonly resourceId: string
  readonly authorityDigest: string
  readonly contributions: readonly ResourceDigestContribution[]
  readonly contentDigest: Sha256Digest
}

export interface ResourceDependencyEdge {
  readonly fromResourceId: string
  readonly toResourceId: string
  readonly relation: string
  readonly declaredBy: string
}

export interface SnapshotResource {
  readonly resourceId: string
  readonly kind: string
  readonly contentDigest: string
  readonly origin: ResourceOrigin
}

export interface ResourceDependencySnapshot {
  readonly roots: readonly string[]
  readonly closure: readonly SnapshotResource[]
  readonly edges: readonly ResourceDependencyEdge[]
  readonly registryRevision: string
  readonly snapshotRevision: Sha256Digest
}

export interface BuildResourceDependencySnapshotInput {
  readonly registry: EffectiveResourceRegistry
  readonly roots: readonly string[]
  readonly edges: readonly ResourceDependencyEdge[]
  readonly contentIdentities: ReadonlyMap<string, ResourceContentIdentity>
}

export function sha256Digest(value: string | Uint8Array): Sha256Digest {
  return digestBytes(value)
}

export function createResourceContentIdentity(
  input: CreateResourceContentIdentityInput,
): ResourceContentIdentity {
  const diagnostics: ResourceDiagnostic[] = []
  const identity = normalizeContentIdentity(input, diagnostics, {
    requireContributions: false,
    strictCanonicalInput: false,
    validateClaimedDigest: false,
  })
  if (diagnostics.length > 0 || !identity) {
    throw new ResourceCompositionError(stableDiagnostics(diagnostics))
  }
  return identity
}

export function buildResourceDependencySnapshot(
  input: BuildResourceDependencySnapshotInput,
): ResourceDependencySnapshot {
  const diagnostics: ResourceDiagnostic[] = []
  if (!isEffectiveRegistryAuthentic(input.registry)
    || input.registry.revision !== input.registry.compositionRevision) {
    throw new ResourceCompositionError(Object.freeze([diagnostic(
      "RESOURCE_EFFECTIVE_REGISTRY_UNTRUSTED",
      "effective-registry:revision",
      "Dependency snapshots require an authentic immutable registry returned by composeLayeredResourceRegistry().",
    )]))
  }
  const roots = validateRoots(input.roots, input.registry, diagnostics)
  const edges = validateEdges(input.edges, input.registry, diagnostics)
  validateContentIdentityIndex(input.contentIdentities, diagnostics)
  const validatedIdentities = validateEffectiveContentIdentities(
    input.registry,
    input.contentIdentities,
    diagnostics,
  )
  if (diagnostics.length > 0) throw new ResourceCompositionError(stableDiagnostics(diagnostics))

  const registryRevision = digestCanonical({
    compositionRevision: input.registry.compositionRevision,
    resources: [...validatedIdentities.values()]
      .sort((left, right) => compareCodeUnits(left.resourceId, right.resourceId))
      .map((identity) => ({
        resourceId: identity.resourceId,
        contentDigest: identity.contentDigest,
      })),
  })

  const adjacency = new Map<string, ResourceDependencyEdge[]>()
  for (const edge of edges) {
    const values = adjacency.get(edge.fromResourceId) ?? []
    values.push(edge)
    adjacency.set(edge.fromResourceId, values)
  }
  for (const values of adjacency.values()) values.sort(compareEdges)

  const reachable = new Set<string>()
  const participating = new Map<string, ResourceDependencyEdge>()
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const path: string[] = []

  const visit = (resourceId: string): void => {
    if (visiting.has(resourceId)) {
      const cycleStart = path.indexOf(resourceId)
      const cycle = [...path.slice(cycleStart), resourceId]
      diagnostics.push(diagnostic(
        "RESOURCE_DEPENDENCY_CYCLE",
        dependencyLocation(resourceId),
        `Resource dependency cycle detected: ${cycle.join(" -> ")}.`,
      ))
      return
    }
    if (visited.has(resourceId)) return
    visiting.add(resourceId)
    path.push(resourceId)
    reachable.add(resourceId)
    for (const edge of adjacency.get(resourceId) ?? []) {
      participating.set(edgeKey(edge), edge)
      visit(edge.toResourceId)
    }
    path.pop()
    visiting.delete(resourceId)
    visited.add(resourceId)
  }
  for (const root of roots) visit(root)

  if (diagnostics.length > 0) throw new ResourceCompositionError(stableDiagnostics(diagnostics))

  const closure = Object.freeze([...reachable]
    .sort(compareCodeUnits)
    .map((resourceId): SnapshotResource => {
      const entry = input.registry.byId.get(resourceId)!
      const identity = validatedIdentities.get(resourceId)!
      return Object.freeze({
        resourceId,
        kind: entry.kind,
        contentDigest: identity.contentDigest,
        origin: cloneOrigin(entry.effectiveOrigin!),
      })
    }))
  const snapshotEdges = Object.freeze([...participating.values()].sort(compareEdges))
  const frozenRoots = Object.freeze([...roots])
  const snapshotRevision = digestCanonical({
    roots: frozenRoots,
    closure: closure.map((resource) => ({
      resourceId: resource.resourceId,
      kind: resource.kind,
      contentDigest: resource.contentDigest,
      origin: stableOriginFact(resource.origin),
    })),
    edges: snapshotEdges,
    registryRevision,
  })
  return Object.freeze({
    roots: frozenRoots,
    closure,
    edges: snapshotEdges,
    registryRevision,
    snapshotRevision,
  })
}

function validateRoots(
  inputRoots: readonly string[],
  registry: EffectiveResourceRegistry,
  diagnostics: ResourceDiagnostic[],
): string[] {
  const roots: string[] = []
  const seen = new Set<string>()
  for (const value of inputRoots) {
    const resourceId = value.trim()
    if (resourceId.length === 0) {
      diagnostics.push(diagnostic(
        "RESOURCE_DEPENDENCY_ROOT_EMPTY",
        "dependency-root:unnamed",
        "Dependency snapshot roots must be non-empty resource ids.",
      ))
      continue
    }
    if (seen.has(resourceId)) {
      diagnostics.push(diagnostic(
        "RESOURCE_DEPENDENCY_ROOT_DUPLICATE",
        dependencyLocation(resourceId),
        `Dependency snapshot root '${resourceId}' is declared more than once.`,
      ))
      continue
    }
    seen.add(resourceId)
    roots.push(resourceId)
    const entry = registry.byId.get(resourceId)
    if (!entry || !entry.resource) {
      diagnostics.push(diagnostic(
        "RESOURCE_DEPENDENCY_ROOT_MISSING",
        dependencyLocation(resourceId),
        `Dependency snapshot root '${resourceId}' is not an effective resource.`,
      ))
    }
  }
  if (roots.length === 0 && diagnostics.length === 0) {
    diagnostics.push(diagnostic(
      "RESOURCE_DEPENDENCY_ROOTS_EMPTY",
      "dependency-root:none",
      "Dependency snapshot requires at least one explicit root.",
    ))
  }
  return roots
}

function validateEdges(
  inputEdges: readonly ResourceDependencyEdge[],
  registry: EffectiveResourceRegistry,
  diagnostics: ResourceDiagnostic[],
): ResourceDependencyEdge[] {
  const values = new Map<string, ResourceDependencyEdge>()
  inputEdges.forEach((inputEdge, index) => {
    const edge = Object.freeze({
      fromResourceId: inputEdge.fromResourceId.trim(),
      toResourceId: inputEdge.toResourceId.trim(),
      relation: inputEdge.relation.trim(),
      declaredBy: inputEdge.declaredBy.trim(),
    })
    if (!edge.fromResourceId || !edge.toResourceId || !edge.relation || !edge.declaredBy) {
      diagnostics.push(diagnostic(
        "RESOURCE_DEPENDENCY_EDGE_INVALID",
        `dependency-edge:${index}`,
        "Dependency edges require non-empty fromResourceId, toResourceId, relation, and declaredBy fields.",
      ))
      return
    }
    const source = registry.byId.get(edge.fromResourceId)
    const target = registry.byId.get(edge.toResourceId)
    if (!source?.resource) {
      diagnostics.push(diagnostic(
        "RESOURCE_DEPENDENCY_SOURCE_MISSING",
        dependencyLocation(edge.fromResourceId),
        `Dependency edge source '${edge.fromResourceId}' is not an effective resource.`,
      ))
    }
    if (!target?.resource) {
      diagnostics.push(diagnostic(
        "RESOURCE_DEPENDENCY_TARGET_MISSING",
        dependencyLocation(edge.toResourceId),
        `Dependency edge target '${edge.toResourceId}' is not an effective resource.`,
      ))
    }
    values.set(edgeKey(edge), edge)
  })
  return [...values.values()].sort(compareEdges)
}

interface NormalizeContentIdentityOptions {
  readonly requireContributions: boolean
  readonly strictCanonicalInput: boolean
  readonly validateClaimedDigest: boolean
}

function normalizeContentIdentity(
  input: unknown,
  diagnostics: ResourceDiagnostic[],
  options: NormalizeContentIdentityOptions,
): ResourceContentIdentity | undefined {
  const initialDiagnosticCount = diagnostics.length
  if (!isRecord(input)) {
    diagnostics.push(diagnostic(
      "RESOURCE_CONTENT_IDENTITY_INVALID",
      contentLocation(""),
      "Resource content identity must be an object fact.",
    ))
    return undefined
  }

  const rawResourceId = input.resourceId
  const resourceId = typeof rawResourceId === "string" ? rawResourceId.trim() : ""
  if (resourceId.length === 0) {
    diagnostics.push(diagnostic(
      "RESOURCE_CONTENT_IDENTITY_ID_EMPTY",
      contentLocation(""),
      "Resource content identity requires a non-empty resource id.",
    ))
  } else if (options.strictCanonicalInput && rawResourceId !== resourceId) {
    diagnostics.push(diagnostic(
      "RESOURCE_CONTENT_IDENTITY_NON_CANONICAL",
      contentLocation(resourceId),
      `Resource content identity '${resourceId}' must use its canonical id without surrounding whitespace.`,
    ))
  }

  const authorityDigest = typeof input.authorityDigest === "string" ? input.authorityDigest : ""
  if (!isSha256Digest(authorityDigest)) {
    diagnostics.push(diagnostic(
      "RESOURCE_CONTENT_AUTHORITY_DIGEST_INVALID",
      contentLocation(resourceId),
      `Resource '${resourceId || "unnamed"}' has an invalid authority digest.`,
    ))
  }

  const rawContributions = input.contributions
  let contributionFacts: readonly unknown[] = []
  if (rawContributions === undefined && !options.requireContributions) {
    contributionFacts = []
  } else if (!Array.isArray(rawContributions)) {
    diagnostics.push(diagnostic(
      "RESOURCE_DIGEST_CONTRIBUTIONS_INVALID",
      contentLocation(resourceId),
      `Resource '${resourceId || "unnamed"}' must provide an explicit digest contribution array.`,
    ))
  } else {
    contributionFacts = rawContributions
  }

  const contributions = new Map<string, ResourceDigestContribution>()
  for (const fact of contributionFacts) {
    if (!isRecord(fact)) {
      diagnostics.push(diagnostic(
        "RESOURCE_DIGEST_CONTRIBUTION_INVALID",
        contentLocation(resourceId),
        `Resource '${resourceId || "unnamed"}' has a non-object digest contribution.`,
      ))
      continue
    }
    const rawKey = fact.key
    const key = typeof rawKey === "string" ? rawKey.trim() : ""
    if (key.length === 0) {
      diagnostics.push(diagnostic(
        "RESOURCE_DIGEST_CONTRIBUTION_KEY_EMPTY",
        contentLocation(resourceId),
        `Resource '${resourceId || "unnamed"}' has a digest contribution with an empty key.`,
      ))
      continue
    }
    if (options.strictCanonicalInput && rawKey !== key) {
      diagnostics.push(diagnostic(
        "RESOURCE_DIGEST_CONTRIBUTION_NON_CANONICAL",
        contentLocation(resourceId, key),
        `Digest contribution '${key}' for resource '${resourceId}' must use its canonical key.`,
      ))
    }
    const digest = typeof fact.digest === "string" ? fact.digest : ""
    if (!isSha256Digest(digest)) {
      diagnostics.push(diagnostic(
        "RESOURCE_DIGEST_CONTRIBUTION_INVALID",
        contentLocation(resourceId, key),
        `Digest contribution '${key}' for resource '${resourceId || "unnamed"}' is invalid.`,
      ))
      continue
    }
    const sourceUri = fact.sourceUri
    if (sourceUri !== undefined && typeof sourceUri !== "string") {
      diagnostics.push(diagnostic(
        "RESOURCE_DIGEST_CONTRIBUTION_SOURCE_INVALID",
        contentLocation(resourceId, key),
        `Digest contribution '${key}' for resource '${resourceId}' has an invalid source URI.`,
      ))
      continue
    }
    const contribution = Object.freeze({
      key,
      digest,
      ...(sourceUri === undefined ? {} : { sourceUri }),
    })
    const current = contributions.get(key)
    if (current) {
      const conflicting = current.digest !== digest
      diagnostics.push(diagnostic(
        conflicting ? "RESOURCE_DIGEST_CONTRIBUTION_CONFLICT" : "RESOURCE_DIGEST_CONTRIBUTION_DUPLICATE",
        contentLocation(resourceId, key),
        conflicting
          ? `Digest contribution '${key}' for resource '${resourceId || "unnamed"}' has conflicting digests.`
          : `Digest contribution '${key}' for resource '${resourceId || "unnamed"}' is declared more than once.`,
      ))
      continue
    }
    contributions.set(key, contribution)
  }

  if (diagnostics.length > initialDiagnosticCount) return undefined
  const ordered = Object.freeze([...contributions.values()].sort(compareContributions))
  const contentDigest = digestCanonical({
    resourceId,
    authorityDigest,
    contributions: ordered.map((contribution) => ({
      key: contribution.key,
      digest: contribution.digest,
    })),
  })

  if (options.validateClaimedDigest) {
    const claimedDigest = input.contentDigest
    if (typeof claimedDigest !== "string" || !isSha256Digest(claimedDigest)) {
      diagnostics.push(diagnostic(
        "RESOURCE_CONTENT_DIGEST_INVALID",
        contentLocation(resourceId),
        `Resource '${resourceId}' has an invalid claimed content digest.`,
      ))
      return undefined
    }
    if (claimedDigest !== contentDigest) {
      diagnostics.push(diagnostic(
        "RESOURCE_CONTENT_DIGEST_MISMATCH",
        contentLocation(resourceId),
        `Resource '${resourceId}' claimed a content digest that does not match its explicit authority and contributions.`,
      ))
      return undefined
    }
  }

  return Object.freeze({ resourceId, authorityDigest, contributions: ordered, contentDigest })
}

function validateEffectiveContentIdentities(
  registry: EffectiveResourceRegistry,
  identities: ReadonlyMap<string, ResourceContentIdentity>,
  diagnostics: ResourceDiagnostic[],
): ReadonlyMap<string, ResourceContentIdentity> {
  const validated = new Map<string, ResourceContentIdentity>()
  const effectiveEntries = [...registry.byId.values()]
    .filter((entry) => entry.resource !== undefined)
    .sort((left, right) => compareCodeUnits(left.resourceId, right.resourceId))
  for (const entry of effectiveEntries) {
    const input = identities.get(entry.resourceId)
    if (input === undefined) {
      diagnostics.push(diagnostic(
        "RESOURCE_CONTENT_IDENTITY_MISSING",
        dependencyLocation(entry.resourceId),
        `Effective resource '${entry.resourceId}' has no explicit content identity.`,
      ))
      continue
    }
    const identity = normalizeContentIdentity(input, diagnostics, {
      requireContributions: true,
      strictCanonicalInput: true,
      validateClaimedDigest: true,
    })
    if (identity) validated.set(entry.resourceId, identity)
  }
  return validated
}

function validateContentIdentityIndex(
  identities: ReadonlyMap<string, ResourceContentIdentity>,
  diagnostics: ResourceDiagnostic[],
): void {
  for (const [key, identity] of [...identities.entries()]
    .sort(([left], [right]) => compareCodeUnits(left, right))) {
    const identityResourceId = isRecord(identity) && typeof identity.resourceId === "string"
      ? identity.resourceId
      : undefined
    if (key !== identityResourceId) {
      diagnostics.push(diagnostic(
        "RESOURCE_CONTENT_IDENTITY_KEY_MISMATCH",
        dependencyLocation(key),
        `Content identity index key '${key}' does not match identity '${identityResourceId ?? "invalid"}'.`,
      ))
    }
  }
}

function isSha256Digest(value: string): value is Sha256Digest {
  return /^sha256:[0-9a-f]{64}$/.test(value)
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function compareEdges(left: ResourceDependencyEdge, right: ResourceDependencyEdge): number {
  return compareCodeUnits(left.fromResourceId, right.fromResourceId)
    || compareCodeUnits(left.toResourceId, right.toResourceId)
    || compareCodeUnits(left.relation, right.relation)
    || compareCodeUnits(left.declaredBy, right.declaredBy)
}

function compareContributions(
  left: ResourceDigestContribution,
  right: ResourceDigestContribution,
): number {
  const semanticOrder = compareCodeUnits(left.key, right.key) || compareCodeUnits(left.digest, right.digest)
  if (semanticOrder !== 0) return semanticOrder
  if (left.sourceUri === right.sourceUri) return 0
  if (left.sourceUri === undefined) return 1
  if (right.sourceUri === undefined) return -1
  return compareCodeUnits(left.sourceUri, right.sourceUri)
}

function edgeKey(edge: ResourceDependencyEdge): string {
  return JSON.stringify([edge.fromResourceId, edge.toResourceId, edge.relation, edge.declaredBy])
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

function cloneOrigin(origin: ResourceOrigin): ResourceOrigin {
  return Object.freeze({
    layerId: origin.layerId,
    layerIndex: origin.layerIndex,
    packageId: origin.packageId,
    documentUri: origin.documentUri,
    ...(origin.logicalPath === undefined ? {} : { logicalPath: origin.logicalPath }),
  })
}

function stableDiagnostics(diagnostics: readonly ResourceDiagnostic[]): readonly ResourceDiagnostic[] {
  return Object.freeze([...diagnostics].sort((left, right) =>
    compareCodeUnits(left.location, right.location) || compareCodeUnits(left.code, right.code),
  ))
}

function diagnostic(code: string, location: string, message: string): ResourceDiagnostic {
  return Object.freeze({ code, location, message })
}

function dependencyLocation(resourceId: string): string {
  return `dependency:${resourceId || "unnamed"}`
}

function contentLocation(resourceId: string, key?: string): string {
  return `content:${resourceId || "unnamed"}${key === undefined ? "" : `:${key}`}`
}
