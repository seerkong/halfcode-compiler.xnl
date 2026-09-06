import { createHash } from "node:crypto"
import {
  RESOURCE_ENVELOPE_VERSION,
  isSpecVersion,
  resolveEffectiveResourceContentIdentities,
  type AuthoredResourceRecord,
  type AuthoredResourceTree,
  type EffectiveResourceRegistry,
  type KindSpecRevisionDescriptor,
  type ResourceLayerContentIdentityInput,
  type Sha256Digest,
  type SpecVersion,
} from "halfcode-compiler-resource-core"

export const RESOURCE_AUTHORING_SCHEMA_VERSION = "halfcode.resource-authoring/v1" as const

export type ResourceAuthoringOperation = "create" | "update"
export type ResourceAuthoringSourceShape = "single-file"
export type ResourceAuthoringDocumentUri = `vfs://@/${string}`

export interface ResourceAuthoringExpectedAbsent {
  readonly state: "absent"
  readonly registryRevision: string
}

export interface ResourceAuthoringExpectedPresent {
  readonly state: "present"
  readonly authorityDigest: string
  readonly registryRevision: string
}

export type ResourceAuthoringExpectedState =
  | ResourceAuthoringExpectedAbsent
  | ResourceAuthoringExpectedPresent

export interface ResourceAuthoringProposal {
  readonly schemaVersion: typeof RESOURCE_AUTHORING_SCHEMA_VERSION
  readonly operation: ResourceAuthoringOperation
  readonly catalogId: string
  readonly resourceId: string
  readonly kind: string
  readonly envelopeVersion: typeof RESOURCE_ENVELOPE_VERSION
  readonly writerSpecVersion: SpecVersion
  readonly sourceShape: ResourceAuthoringSourceShape
  readonly documentUri: ResourceAuthoringDocumentUri
  readonly authorityText: string
  readonly expected: ResourceAuthoringExpectedState
}

export interface ResourceAuthoringKindDefinition {
  readonly kind: string
  readonly specRevisions: readonly KindSpecRevisionDescriptor[]
  readonly sourceShapes: readonly ResourceAuthoringSourceShape[]
  readonly documentCardinality: "one" | "many"
}

export interface ResourceAuthoringCatalogBinding {
  readonly catalogId: string
  readonly resourceKind: string
  readonly sourceShape: ResourceAuthoringSourceShape
  readonly rootUri: ResourceAuthoringDocumentUri
  readonly entry?: string
}

export interface ResourceAuthoringPlanningAuthority {
  readonly registryRevision: string
  readonly kindDefinitions: readonly ResourceAuthoringKindDefinition[]
  readonly catalogs: readonly ResourceAuthoringCatalogBinding[]
}

export type ResourceAuthoringPlanningConfig = Readonly<Record<never, never>>

export interface ResourceAuthoringInspectedRoot {
  readonly resourceId: string
  readonly kind: string
  readonly envelopeVersion: string
  readonly writerSpecVersion: SpecVersion
}

export interface ResourceAuthoringAuthorityInspection {
  readonly documentUri: ResourceAuthoringDocumentUri
  readonly resources: readonly ResourceAuthoringInspectedRoot[]
}

export interface ResourceAuthoringAuthorityInspector {
  inspectAuthority(input: {
    readonly documentUri: ResourceAuthoringDocumentUri
    readonly sourceShape: ResourceAuthoringSourceShape
    readonly authorityText: string
  }): ResourceAuthoringAuthorityInspection
}

export interface ResourceAuthoringPlanningRuntime extends ResourceAuthoringAuthorityInspector {
  /** Long-lived authentic registry/catalog snapshot; never supplied as per-call config. */
  readonly planningAuthority: ResourceAuthoringPlanningAuthority
}

export interface ResourceAuthoringPlan {
  readonly schemaVersion: typeof RESOURCE_AUTHORING_SCHEMA_VERSION
  readonly proposal: ResourceAuthoringProposal
  readonly kindDefinition: ResourceAuthoringKindDefinition
  readonly writerSpecRevision: KindSpecRevisionDescriptor
  readonly catalog: ResourceAuthoringCatalogBinding
  readonly resources: readonly ResourceAuthoringInspectedRoot[]
  readonly authorityDigest: string
  readonly planDigest: string
}

export interface ResourceAuthoringPreparedWrite {
  readonly transactionId: string
  readonly planDigest: string
  readonly authorityDigestBefore: string | null
  readonly registryRevisionBefore: string
}

export interface ResourceAuthoringRefreshCandidate {
  readonly transactionId: string
  readonly candidateId: string
  readonly targetLayerId: string
  readonly tree: AuthoredResourceTree
  readonly registry: EffectiveResourceRegistry
  readonly layers: readonly ResourceLayerContentIdentityInput[]
}

export interface ResourceAuthoringEffectiveOriginReceipt {
  readonly layerId: string
  readonly layerIndex: number
  readonly packageId: string
  readonly documentUri: string
  readonly logicalPath?: string
}

export interface ResourceAuthoringReceipt {
  readonly schemaVersion: typeof RESOURCE_AUTHORING_SCHEMA_VERSION
  readonly planDigest: string
  readonly transactionId: string
  readonly operation: ResourceAuthoringOperation
  readonly catalogId: string
  readonly resourceId: string
  readonly kind: string
  readonly envelopeVersion: typeof RESOURCE_ENVELOPE_VERSION
  readonly writerSpecVersion: SpecVersion
  readonly sourceShape: ResourceAuthoringSourceShape
  readonly documentUri: ResourceAuthoringDocumentUri
  readonly authorityDigestBefore: string | null
  readonly authorityDigestAfter: string
  readonly registryRevisionBefore: string
  readonly registryRevisionAfter: string
  readonly contentDigest: string
  readonly effectiveOrigin: ResourceAuthoringEffectiveOriginReceipt
  readonly authorityResourceIds: readonly string[]
  /** Content address of every preceding receipt field; the transaction port persists it immutably. */
  readonly receiptDigest: string
}

export interface ResourceAuthoringTransactionPort {
  loadReceipt(planDigest: string): Promise<ResourceAuthoringReceipt | undefined>
  prepare(input: {
    readonly planDigest: string
    readonly operation: ResourceAuthoringOperation
    readonly documentUri: ResourceAuthoringDocumentUri
    readonly expected: ResourceAuthoringExpectedState
    readonly authorityDigest: string
    readonly authorityText: string
  }): Promise<ResourceAuthoringPreparedWrite>
  refreshCandidate(input: {
    readonly transactionId: string
    readonly planDigest: string
  }): Promise<ResourceAuthoringRefreshCandidate>
  commit(input: {
    readonly transactionId: string
    readonly candidateId: string
    readonly receipt: ResourceAuthoringReceipt
  }): Promise<ResourceAuthoringReceipt>
  rollback(input: {
    readonly transactionId: string
    readonly planDigest: string
  }): Promise<void>
}

export interface ResourceAuthoringRuntime extends ResourceAuthoringPlanningRuntime {
  readonly transaction: ResourceAuthoringTransactionPort
}

export type ApplyResourceAuthoringConfig = ResourceAuthoringPlanningConfig

export interface ResourceAuthoringRegistryRevisionInput {
  readonly registry: EffectiveResourceRegistry
  readonly layers: readonly ResourceLayerContentIdentityInput[]
}

export type ResourceAuthoringErrorCode =
  | "RESOURCE_AUTHORING_INPUT_INVALID"
  | "RESOURCE_AUTHORING_KIND_UNKNOWN"
  | "RESOURCE_AUTHORING_WRITER_SPEC_VERSION_UNREGISTERED"
  | "RESOURCE_AUTHORING_SOURCE_SHAPE_UNSUPPORTED"
  | "RESOURCE_AUTHORING_CATALOG_UNKNOWN"
  | "RESOURCE_AUTHORING_CATALOG_MISMATCH"
  | "RESOURCE_AUTHORING_TARGET_UNSAFE"
  | "RESOURCE_AUTHORING_EXPECTED_STATE_INVALID"
  | "RESOURCE_AUTHORING_AUTHORITY_INVALID"
  | "RESOURCE_AUTHORING_PLAN_FORGED"
  | "RESOURCE_AUTHORING_CAS_CONFLICT"
  | "RESOURCE_AUTHORING_PREPARE_INVALID"
  | "RESOURCE_AUTHORING_REFRESH_INVALID"
  | "RESOURCE_AUTHORING_COMMIT_INVALID"
  | "RESOURCE_AUTHORING_ROLLBACK_FAILED"

export class ResourceAuthoringError extends Error {
  constructor(
    readonly code: ResourceAuthoringErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = "ResourceAuthoringError"
  }
}

/** Derives the content-sensitive revision used by planning and CAS from canonical projections. */
export function deriveResourceAuthoringRegistryRevision(
  input: ResourceAuthoringRegistryRevisionInput,
): string {
  let identities: ReadonlyMap<string, { readonly contentDigest: string }>
  try {
    identities = resolveEffectiveResourceContentIdentities(input)
  } catch (cause) {
    throw new ResourceAuthoringError(
      "RESOURCE_AUTHORING_REFRESH_INVALID",
      "Registry revision requires authentic canonical registry and layer projections.",
      cause,
    )
  }
  return digestValue({
    compositionRevision: input.registry.compositionRevision,
    resources: [...identities.entries()]
      .map(([resourceId, value]) => ({ resourceId, contentDigest: value.contentDigest }))
      .sort((left, right) => compareCodeUnits(left.resourceId, right.resourceId)),
  })
}

export function planResourceAuthoring(
  runtime: ResourceAuthoringPlanningRuntime,
  input: ResourceAuthoringProposal,
  _config: ResourceAuthoringPlanningConfig,
): ResourceAuthoringPlan {
  const proposal = normalizeProposal(input)
  const planning = normalizePlanningAuthority(runtime.planningAuthority)
  if (proposal.expected.registryRevision !== planning.registryRevision) {
    fail("RESOURCE_AUTHORING_EXPECTED_STATE_INVALID", "Proposal registry revision does not match the planning authority.")
  }
  if ((proposal.operation === "create") !== (proposal.expected.state === "absent")) {
    fail("RESOURCE_AUTHORING_EXPECTED_STATE_INVALID", "Create requires absent state and update requires present state.")
  }
  const kindDefinition = planning.kindDefinitions.find((item) => item.kind === proposal.kind)
  if (!kindDefinition) fail("RESOURCE_AUTHORING_KIND_UNKNOWN", `Kind '${proposal.kind}' is not registered.`)
  const writerSpecRevision = kindDefinition.specRevisions.find(
    (revision) => revision.specVersion === proposal.writerSpecVersion,
  )
  if (!writerSpecRevision) {
    fail(
      "RESOURCE_AUTHORING_WRITER_SPEC_VERSION_UNREGISTERED",
      `Kind '${proposal.kind}' has no exact writer spec revision ${proposal.writerSpecVersion}.`,
    )
  }
  if (!kindDefinition.sourceShapes.includes(proposal.sourceShape)) {
    fail("RESOURCE_AUTHORING_SOURCE_SHAPE_UNSUPPORTED", `Kind '${proposal.kind}' does not support '${proposal.sourceShape}'.`)
  }
  const catalog = planning.catalogs.find((item) => item.catalogId === proposal.catalogId)
  if (!catalog) fail("RESOURCE_AUTHORING_CATALOG_UNKNOWN", `Catalog '${proposal.catalogId}' is not registered.`)
  if (catalog.resourceKind !== proposal.kind || catalog.sourceShape !== proposal.sourceShape) {
    fail("RESOURCE_AUTHORING_CATALOG_MISMATCH", `Catalog '${catalog.catalogId}' does not admit the proposal Kind and source shape.`)
  }
  assertCatalogTarget(catalog, proposal.documentUri)

  let inspection: ResourceAuthoringAuthorityInspection
  try {
    inspection = normalizeInspection(runtime.inspectAuthority({
      documentUri: proposal.documentUri,
      sourceShape: proposal.sourceShape,
      authorityText: proposal.authorityText,
    }))
  } catch (cause) {
    if (cause instanceof ResourceAuthoringError) throw cause
    throw new ResourceAuthoringError("RESOURCE_AUTHORING_AUTHORITY_INVALID", "Authority inspection failed.", cause)
  }
  if (inspection.documentUri !== proposal.documentUri) {
    fail("RESOURCE_AUTHORING_AUTHORITY_INVALID", "Authority inspection changed the logical document URI.")
  }
  if (kindDefinition.documentCardinality === "one" && inspection.resources.length !== 1) {
    fail("RESOURCE_AUTHORING_AUTHORITY_INVALID", `Kind '${proposal.kind}' requires one resource root per authority document.`)
  }
  if (inspection.resources.length === 0) {
    fail("RESOURCE_AUTHORING_AUTHORITY_INVALID", "Authority document contains no resource roots.")
  }
  const resourceIds = new Set<string>()
  for (const resource of inspection.resources) {
    if (resourceIds.has(resource.resourceId)) fail("RESOURCE_AUTHORING_AUTHORITY_INVALID", "Authority document repeats a resource identity.")
    resourceIds.add(resource.resourceId)
    if (resource.kind !== proposal.kind
      || resource.envelopeVersion !== proposal.envelopeVersion
      || resource.writerSpecVersion !== proposal.writerSpecVersion) {
      fail("RESOURCE_AUTHORING_AUTHORITY_INVALID", "Every authority root must match the proposed Kind, envelopeVersion and writerSpecVersion.")
    }
  }
  if (!resourceIds.has(proposal.resourceId)) {
    fail("RESOURCE_AUTHORING_AUTHORITY_INVALID", `Authority document does not contain target '${proposal.resourceId}'.`)
  }
  const authorityDigest = digestText(proposal.authorityText)
  if (proposal.expected.state === "present" && proposal.expected.authorityDigest === authorityDigest) {
    fail("RESOURCE_AUTHORING_EXPECTED_STATE_INVALID", "Update authority must differ from the expected current authority.")
  }
  const unsigned = {
    schemaVersion: RESOURCE_AUTHORING_SCHEMA_VERSION,
    proposal,
    kindDefinition,
    writerSpecRevision,
    catalog,
    resources: inspection.resources,
    authorityDigest,
  }
  return deepFreeze({ ...unsigned, planDigest: digestValue(unsigned) })
}

export async function applyResourceAuthoring(
  runtime: ResourceAuthoringRuntime,
  input: ResourceAuthoringPlan,
  config: ApplyResourceAuthoringConfig,
): Promise<ResourceAuthoringReceipt> {
  const plan = normalizePlan(input)
  let replanned: ResourceAuthoringPlan
  try {
    replanned = planResourceAuthoring(runtime, plan.proposal, config)
  } catch (cause) {
    throw new ResourceAuthoringError(
      "RESOURCE_AUTHORING_PLAN_FORGED",
      "Resource authoring plan is not admitted by the trusted planning authority.",
      cause,
    )
  }
  if (canonicalJson(plan) !== canonicalJson(replanned)) {
    fail("RESOURCE_AUTHORING_PLAN_FORGED", "Resource authoring plan does not match trusted planning inputs.")
  }
  let replay: ResourceAuthoringReceipt | undefined
  try {
    replay = await runtime.transaction.loadReceipt(plan.planDigest)
  } catch (cause) {
    throw new ResourceAuthoringError("RESOURCE_AUTHORING_COMMIT_INVALID", "Durable receipt lookup failed.", cause)
  }
  if (replay) return verifyReceipt(replay, plan)

  let prepared: ResourceAuthoringPreparedWrite | undefined
  let phase: "prepare" | "refresh" | "commit" = "prepare"
  try {
    prepared = normalizePrepared(await runtime.transaction.prepare({
      planDigest: plan.planDigest,
      operation: plan.proposal.operation,
      documentUri: plan.proposal.documentUri,
      expected: plan.proposal.expected,
      authorityDigest: plan.authorityDigest,
      authorityText: plan.proposal.authorityText,
    }))
    verifyPrepared(prepared, plan)
    phase = "refresh"
    const candidate = await runtime.transaction.refreshCandidate({
      transactionId: prepared.transactionId,
      planDigest: plan.planDigest,
    })
    const receipt = verifyCandidate(candidate, prepared, plan)
    phase = "commit"
    const committed = await runtime.transaction.commit({
      transactionId: prepared.transactionId,
      candidateId: candidate.candidateId,
      receipt,
    })
    return verifyReceipt(committed, plan, receipt)
  } catch (cause) {
    const recovered = await runtime.transaction.loadReceipt(plan.planDigest).catch(() => undefined)
    if (recovered) return verifyReceipt(recovered, plan)
    if (prepared) {
      try {
        await runtime.transaction.rollback({
          transactionId: prepared.transactionId,
          planDigest: plan.planDigest,
        })
      } catch (rollbackCause) {
        throw new ResourceAuthoringError(
          "RESOURCE_AUTHORING_ROLLBACK_FAILED",
          "Resource authoring rollback failed before a durable receipt was found.",
          { cause, rollbackCause },
        )
      }
    }
    if (cause instanceof ResourceAuthoringError) throw cause
    throw new ResourceAuthoringError(
      phase === "prepare"
        ? "RESOURCE_AUTHORING_PREPARE_INVALID"
        : phase === "refresh"
          ? "RESOURCE_AUTHORING_REFRESH_INVALID"
          : "RESOURCE_AUTHORING_COMMIT_INVALID",
      `Resource authoring ${phase} failed.`,
      cause,
    )
  }
}

function verifyPrepared(prepared: ResourceAuthoringPreparedWrite, plan: ResourceAuthoringPlan): void {
  const before = plan.proposal.expected.state === "present" ? plan.proposal.expected.authorityDigest : null
  if (prepared.planDigest !== plan.planDigest
    || prepared.authorityDigestBefore !== before
    || prepared.registryRevisionBefore !== plan.proposal.expected.registryRevision) {
    fail("RESOURCE_AUTHORING_PREPARE_INVALID", "Prepared write does not match the exact CAS expectation.")
  }
}

function verifyCandidate(
  candidate: ResourceAuthoringRefreshCandidate,
  prepared: ResourceAuthoringPreparedWrite,
  plan: ResourceAuthoringPlan,
): ResourceAuthoringReceipt {
  if (!candidate || typeof candidate !== "object"
    || candidate.transactionId !== prepared.transactionId
    || !nonEmptyString(candidate.candidateId)
    || !nonEmptyString(candidate.targetLayerId)
    || candidate.tree !== candidate.layers.find((layer) => layer.id === candidate.targetLayerId)?.tree) {
    fail("RESOURCE_AUTHORING_REFRESH_INVALID", "Candidate refresh does not bind the prepared transaction and target layer.")
  }
  let identities: ReadonlyMap<string, { readonly authorityDigest: string; readonly contentDigest: string }>
  try {
    identities = resolveEffectiveResourceContentIdentities({
      registry: candidate.registry,
      layers: candidate.layers,
    })
  } catch (cause) {
    throw new ResourceAuthoringError("RESOURCE_AUTHORING_REFRESH_INVALID", "Candidate refresh is not an authentic canonical projection.", cause)
  }
  const target = candidate.registry.byId.get(plan.proposal.resourceId)
  const identity = identities.get(plan.proposal.resourceId)
  const resource = target?.resource
  const origin = target?.effectiveOrigin
  if (!resource || !identity || !origin
    || target.kind !== plan.proposal.kind
    || resource.metadata.envelopeVersion !== plan.proposal.envelopeVersion
    || resource.metadata.specVersion !== plan.proposal.writerSpecVersion
    || resource.sourceShape !== plan.proposal.sourceShape
    || resource.documentUri !== plan.proposal.documentUri
    || identity.authorityDigest !== plan.authorityDigest
    || origin.layerId !== candidate.targetLayerId
    || origin.documentUri !== plan.proposal.documentUri) {
    fail("RESOURCE_AUTHORING_REFRESH_INVALID", "Candidate refresh does not project the planned effective resource and authority.")
  }
  const actualRoots = recordsAtDocument(candidate.tree, plan.proposal.documentUri)
    .map((record) => ({
      resourceId: record.resourceId,
      kind: record.kind,
      envelopeVersion: record.metadata.envelopeVersion,
      writerSpecVersion: record.metadata.specVersion,
    }))
    .sort(compareInspectedRoots)
  const plannedRoots = [...plan.resources].sort(compareInspectedRoots)
  if (canonicalJson(actualRoots) !== canonicalJson(plannedRoots)) {
    fail("RESOURCE_AUTHORING_REFRESH_INVALID", "Candidate refresh changed the whole authority-document resource set.")
  }
  for (const root of plannedRoots) {
    const rootIdentity = candidate.tree.contentIdentities.get(root.resourceId)
    if (!rootIdentity || rootIdentity.authorityDigest !== plan.authorityDigest) {
      fail("RESOURCE_AUTHORING_REFRESH_INVALID", "Candidate refresh does not bind every authority root to the planned bytes.")
    }
  }
  const registryRevisionAfter = deriveResourceAuthoringRegistryRevision({
    registry: candidate.registry,
    layers: candidate.layers,
  })
  if (registryRevisionAfter === prepared.registryRevisionBefore) {
    fail("RESOURCE_AUTHORING_REFRESH_INVALID", "Candidate refresh did not change the content-sensitive registry revision.")
  }
  const unsignedReceipt = {
    schemaVersion: RESOURCE_AUTHORING_SCHEMA_VERSION,
    planDigest: plan.planDigest,
    transactionId: prepared.transactionId,
    operation: plan.proposal.operation,
    catalogId: plan.proposal.catalogId,
    resourceId: plan.proposal.resourceId,
    kind: plan.proposal.kind,
    envelopeVersion: plan.proposal.envelopeVersion,
    writerSpecVersion: plan.proposal.writerSpecVersion,
    sourceShape: plan.proposal.sourceShape,
    documentUri: plan.proposal.documentUri,
    authorityDigestBefore: prepared.authorityDigestBefore,
    authorityDigestAfter: plan.authorityDigest,
    registryRevisionBefore: prepared.registryRevisionBefore,
    registryRevisionAfter,
    contentDigest: identity.contentDigest,
    effectiveOrigin: {
      layerId: origin.layerId,
      layerIndex: origin.layerIndex,
      packageId: origin.packageId,
      documentUri: origin.documentUri,
      ...(origin.logicalPath === undefined ? {} : { logicalPath: origin.logicalPath }),
    },
    authorityResourceIds: plannedRoots.map((item) => item.resourceId),
  }
  return deepFreeze({ ...unsignedReceipt, receiptDigest: digestValue(unsignedReceipt) })
}

function verifyReceipt(
  value: ResourceAuthoringReceipt,
  plan: ResourceAuthoringPlan,
  expected?: ResourceAuthoringReceipt,
): ResourceAuthoringReceipt {
  const receipt = normalizeReceipt(value)
  const authorityDigestBefore = plan.proposal.expected.state === "present"
    ? plan.proposal.expected.authorityDigest
    : null
  if (receipt.planDigest !== plan.planDigest
    || receipt.operation !== plan.proposal.operation
    || receipt.catalogId !== plan.proposal.catalogId
    || receipt.resourceId !== plan.proposal.resourceId
    || receipt.kind !== plan.proposal.kind
    || receipt.envelopeVersion !== plan.proposal.envelopeVersion
    || receipt.writerSpecVersion !== plan.proposal.writerSpecVersion
    || receipt.sourceShape !== plan.proposal.sourceShape
    || receipt.documentUri !== plan.proposal.documentUri
    || receipt.authorityDigestBefore !== authorityDigestBefore
    || receipt.authorityDigestAfter !== plan.authorityDigest
    || receipt.registryRevisionBefore !== plan.proposal.expected.registryRevision
    || receipt.registryRevisionAfter === receipt.registryRevisionBefore
    || receipt.effectiveOrigin.documentUri !== plan.proposal.documentUri
    || canonicalJson(receipt.authorityResourceIds) !== canonicalJson(plan.resources.map((item) => item.resourceId).sort(compareCodeUnits))
    || (expected && canonicalJson(receipt) !== canonicalJson(expected))) {
    fail("RESOURCE_AUTHORING_COMMIT_INVALID", "Durable receipt does not match the exact accepted plan and refresh projection.")
  }
  return receipt
}

function normalizeProposal(value: unknown): ResourceAuthoringProposal {
  const input = ownRecord(value, [
    "schemaVersion", "operation", "catalogId", "resourceId", "kind", "envelopeVersion", "writerSpecVersion", "sourceShape",
    "documentUri", "authorityText", "expected",
  ], "proposal")
  if (input.schemaVersion !== RESOURCE_AUTHORING_SCHEMA_VERSION) invalid("proposal.schemaVersion")
  if (input.envelopeVersion !== RESOURCE_ENVELOPE_VERSION) invalid("proposal.envelopeVersion")
  if (input.operation !== "create" && input.operation !== "update") invalid("proposal.operation")
  if (input.sourceShape !== "single-file") {
    fail("RESOURCE_AUTHORING_SOURCE_SHAPE_UNSUPPORTED", "The initial authoring transaction supports only single-file authority.")
  }
  const documentUri = normalizeDocumentUri(input.documentUri, "proposal.documentUri")
  const authorityText = requiredString(input.authorityText, "proposal.authorityText", true)
  const expectedInput = ownRecord(input.expected,
    input.operation === "create" ? ["state", "registryRevision"] : ["state", "authorityDigest", "registryRevision"],
    "proposal.expected")
  const registryRevision = digestString(expectedInput.registryRevision, "proposal.expected.registryRevision")
  const expected: ResourceAuthoringExpectedState = input.operation === "create"
    ? (() => {
        if (expectedInput.state !== "absent") invalid("proposal.expected.state")
        return { state: "absent", registryRevision }
      })()
    : (() => {
        if (expectedInput.state !== "present") invalid("proposal.expected.state")
        return {
          state: "present",
          authorityDigest: digestString(expectedInput.authorityDigest, "proposal.expected.authorityDigest"),
          registryRevision,
        }
      })()
  return deepFreeze({
    schemaVersion: RESOURCE_AUTHORING_SCHEMA_VERSION,
    operation: input.operation as ResourceAuthoringOperation,
    catalogId: requiredString(input.catalogId, "proposal.catalogId"),
    resourceId: requiredString(input.resourceId, "proposal.resourceId"),
    kind: requiredString(input.kind, "proposal.kind"),
    envelopeVersion: RESOURCE_ENVELOPE_VERSION,
    writerSpecVersion: exactSpecVersion(input.writerSpecVersion, "proposal.writerSpecVersion"),
    sourceShape: "single-file" as const,
    documentUri,
    authorityText,
    expected,
  })
}

function normalizePlanningAuthority(value: unknown): ResourceAuthoringPlanningAuthority {
  const input = ownRecord(value, ["registryRevision", "kindDefinitions", "catalogs"], "planning")
  const registryRevision = digestString(input.registryRevision, "planning.registryRevision")
  const kindDefinitions = ownArray(input.kindDefinitions, "planning.kindDefinitions").map((item, index) => {
    const location = `planning.kindDefinitions[${index}]`
    const record = ownRecord(item, ["kind", "specRevisions", "sourceShapes", "documentCardinality"], location)
    const sourceShapes: ResourceAuthoringSourceShape[] = ownArray(
      record.sourceShapes,
      `planning.kindDefinitions[${index}].sourceShapes`,
    ).map((shape): ResourceAuthoringSourceShape => {
      if (shape !== "single-file") fail("RESOURCE_AUTHORING_SOURCE_SHAPE_UNSUPPORTED", "Planning authority contains an unsupported source shape.")
      return shape
    })
    if (record.documentCardinality !== "one" && record.documentCardinality !== "many") invalid(`planning.kindDefinitions[${index}].documentCardinality`)
    const specRevisions = ownArray(record.specRevisions, `${location}.specRevisions`)
      .map((revision, revisionIndex) => normalizeSpecRevision(revision, `${location}.specRevisions[${revisionIndex}]`))
      .sort((left, right) => left.specVersion - right.specVersion)
    if (specRevisions.length === 0) invalid(`${location}.specRevisions`)
    requireUnique(specRevisions.map((revision) => String(revision.specVersion)), `${location} spec revision`)
    return deepFreeze({
      kind: requiredString(record.kind, `${location}.kind`),
      specRevisions,
      sourceShapes: sourceShapes.sort(compareCodeUnits),
      documentCardinality: record.documentCardinality as "one" | "many",
    })
  })
  const catalogs = ownArray(input.catalogs, "planning.catalogs").map((item, index) => {
    const record = ownRecordOptional(item, ["catalogId", "resourceKind", "sourceShape", "rootUri"], ["entry"], `planning.catalogs[${index}]`)
    if (record.sourceShape !== "single-file") fail("RESOURCE_AUTHORING_SOURCE_SHAPE_UNSUPPORTED", "Planning catalog contains an unsupported source shape.")
    const entry = record.entry === undefined ? undefined : plainEntry(record.entry, `planning.catalogs[${index}].entry`)
    return deepFreeze({
      catalogId: requiredString(record.catalogId, `planning.catalogs[${index}].catalogId`),
      resourceKind: requiredString(record.resourceKind, `planning.catalogs[${index}].resourceKind`),
      sourceShape: "single-file" as const,
      rootUri: normalizeDirectoryUri(record.rootUri, `planning.catalogs[${index}].rootUri`),
      ...(entry === undefined ? {} : { entry }),
    })
  })
  requireUnique(kindDefinitions.map((item) => item.kind), "planning Kind")
  requireUnique(catalogs.map((item) => item.catalogId), "planning catalog")
  return deepFreeze({ registryRevision, kindDefinitions, catalogs })
}

function normalizeInspection(value: unknown): ResourceAuthoringAuthorityInspection {
  const input = ownRecord(value, ["documentUri", "resources"], "authorityInspection")
  const resources = ownArray(input.resources, "authorityInspection.resources").map((item, index) => {
    const record = ownRecord(item, ["resourceId", "kind", "envelopeVersion", "writerSpecVersion"], `authorityInspection.resources[${index}]`)
    return deepFreeze({
      resourceId: requiredString(record.resourceId, `authorityInspection.resources[${index}].resourceId`),
      kind: requiredString(record.kind, `authorityInspection.resources[${index}].kind`),
      envelopeVersion: requiredString(record.envelopeVersion, `authorityInspection.resources[${index}].envelopeVersion`),
      writerSpecVersion: exactSpecVersion(record.writerSpecVersion, `authorityInspection.resources[${index}].writerSpecVersion`),
    })
  }).sort(compareInspectedRoots)
  return deepFreeze({
    documentUri: normalizeDocumentUri(input.documentUri, "authorityInspection.documentUri"),
    resources,
  })
}

function normalizeSpecRevision(value: unknown, location: string): KindSpecRevisionDescriptor {
  const input = ownRecord(value, [
    "specVersion",
    "schemaRef",
    "schemaFingerprint",
    "contractFingerprint",
    "semanticContract",
    "stability",
  ], location)
  const semantic = ownRecord(input.semanticContract, [
    "semanticValidatorFingerprint",
    "referenceProjectionFingerprint",
    "compilerInputFingerprint",
  ], `${location}.semanticContract`)
  if (input.stability !== "experimental" && input.stability !== "stable" && input.stability !== "deprecated") {
    invalid(`${location}.stability`)
  }
  return deepFreeze({
    specVersion: exactSpecVersion(input.specVersion, `${location}.specVersion`),
    schemaRef: requiredString(input.schemaRef, `${location}.schemaRef`),
    schemaFingerprint: digestString(input.schemaFingerprint, `${location}.schemaFingerprint`),
    contractFingerprint: digestString(input.contractFingerprint, `${location}.contractFingerprint`),
    semanticContract: {
      semanticValidatorFingerprint: digestString(
        semantic.semanticValidatorFingerprint,
        `${location}.semanticContract.semanticValidatorFingerprint`,
      ),
      referenceProjectionFingerprint: digestString(
        semantic.referenceProjectionFingerprint,
        `${location}.semanticContract.referenceProjectionFingerprint`,
      ),
      compilerInputFingerprint: digestString(
        semantic.compilerInputFingerprint,
        `${location}.semanticContract.compilerInputFingerprint`,
      ),
    },
    stability: input.stability,
  })
}

function normalizePlan(value: unknown): ResourceAuthoringPlan {
  const input = ownRecord(value, [
    "schemaVersion", "proposal", "kindDefinition", "writerSpecRevision", "catalog", "resources", "authorityDigest", "planDigest",
  ], "plan")
  if (input.schemaVersion !== RESOURCE_AUTHORING_SCHEMA_VERSION) invalid("plan.schemaVersion")
  const proposal = normalizeProposal(input.proposal)
  const authority = normalizePlanningAuthority({
    registryRevision: proposal.expected.registryRevision,
    kindDefinitions: [input.kindDefinition],
    catalogs: [input.catalog],
  })
  const unsigned = {
    schemaVersion: RESOURCE_AUTHORING_SCHEMA_VERSION,
    proposal,
    kindDefinition: authority.kindDefinitions[0]!,
    writerSpecRevision: normalizeSpecRevision(input.writerSpecRevision, "plan.writerSpecRevision"),
    catalog: authority.catalogs[0]!,
    resources: normalizeInspection({
      documentUri: proposal.documentUri,
      resources: input.resources,
    }).resources,
    authorityDigest: digestString(input.authorityDigest, "plan.authorityDigest"),
  }
  const admittedRevision = unsigned.kindDefinition.specRevisions.find(
    (revision) => revision.specVersion === proposal.writerSpecVersion,
  )
  if (!admittedRevision || canonicalJson(admittedRevision) !== canonicalJson(unsigned.writerSpecRevision)) {
    fail("RESOURCE_AUTHORING_PLAN_FORGED", "Plan writer spec revision is not the exact admitted revision.")
  }
  const planDigest = digestString(input.planDigest, "plan.planDigest")
  if (digestValue(unsigned) !== planDigest) fail("RESOURCE_AUTHORING_PLAN_FORGED", "Resource authoring plan digest is invalid.")
  return deepFreeze({ ...unsigned, planDigest })
}

function normalizePrepared(value: unknown): ResourceAuthoringPreparedWrite {
  const input = ownRecord(value, ["transactionId", "planDigest", "authorityDigestBefore", "registryRevisionBefore"], "prepared")
  return deepFreeze({
    transactionId: requiredString(input.transactionId, "prepared.transactionId"),
    planDigest: digestString(input.planDigest, "prepared.planDigest"),
    authorityDigestBefore: input.authorityDigestBefore === null
      ? null
      : digestString(input.authorityDigestBefore, "prepared.authorityDigestBefore"),
    registryRevisionBefore: digestString(input.registryRevisionBefore, "prepared.registryRevisionBefore"),
  })
}

function normalizeReceipt(value: unknown): ResourceAuthoringReceipt {
  const input = ownRecord(value, [
    "schemaVersion", "planDigest", "transactionId", "operation", "catalogId", "resourceId", "kind", "envelopeVersion", "writerSpecVersion",
    "sourceShape", "documentUri", "authorityDigestBefore", "authorityDigestAfter", "registryRevisionBefore",
    "registryRevisionAfter", "contentDigest", "effectiveOrigin", "authorityResourceIds", "receiptDigest",
  ], "receipt")
  if (input.schemaVersion !== RESOURCE_AUTHORING_SCHEMA_VERSION) invalid("receipt.schemaVersion")
  if (input.envelopeVersion !== RESOURCE_ENVELOPE_VERSION) invalid("receipt.envelopeVersion")
  if (input.operation !== "create" && input.operation !== "update") invalid("receipt.operation")
  if (input.sourceShape !== "single-file") invalid("receipt.sourceShape")
  const origin = ownRecordOptional(input.effectiveOrigin,
    ["layerId", "layerIndex", "packageId", "documentUri"], ["logicalPath"], "receipt.effectiveOrigin")
  if (!Number.isSafeInteger(origin.layerIndex) || Number(origin.layerIndex) < 0) invalid("receipt.effectiveOrigin.layerIndex")
  const unsignedReceipt = {
    schemaVersion: RESOURCE_AUTHORING_SCHEMA_VERSION,
    planDigest: digestString(input.planDigest, "receipt.planDigest"),
    transactionId: requiredString(input.transactionId, "receipt.transactionId"),
    operation: input.operation as ResourceAuthoringOperation,
    catalogId: requiredString(input.catalogId, "receipt.catalogId"),
    resourceId: requiredString(input.resourceId, "receipt.resourceId"),
    kind: requiredString(input.kind, "receipt.kind"),
    envelopeVersion: RESOURCE_ENVELOPE_VERSION,
    writerSpecVersion: exactSpecVersion(input.writerSpecVersion, "receipt.writerSpecVersion"),
    sourceShape: "single-file" as const,
    documentUri: normalizeDocumentUri(input.documentUri, "receipt.documentUri"),
    authorityDigestBefore: input.authorityDigestBefore === null
      ? null
      : digestString(input.authorityDigestBefore, "receipt.authorityDigestBefore"),
    authorityDigestAfter: digestString(input.authorityDigestAfter, "receipt.authorityDigestAfter"),
    registryRevisionBefore: digestString(input.registryRevisionBefore, "receipt.registryRevisionBefore"),
    registryRevisionAfter: digestString(input.registryRevisionAfter, "receipt.registryRevisionAfter"),
    contentDigest: digestString(input.contentDigest, "receipt.contentDigest"),
    effectiveOrigin: {
      layerId: requiredString(origin.layerId, "receipt.effectiveOrigin.layerId"),
      layerIndex: Number(origin.layerIndex),
      packageId: requiredString(origin.packageId, "receipt.effectiveOrigin.packageId"),
      documentUri: normalizeDocumentUri(origin.documentUri, "receipt.effectiveOrigin.documentUri"),
      ...(origin.logicalPath === undefined ? {} : { logicalPath: safeLogicalPath(origin.logicalPath, "receipt.effectiveOrigin.logicalPath") }),
    },
    authorityResourceIds: [...uniqueStrings(input.authorityResourceIds, "receipt.authorityResourceIds")].sort(compareCodeUnits),
  }
  const receiptDigest = digestString(input.receiptDigest, "receipt.receiptDigest")
  if (digestValue(unsignedReceipt) !== receiptDigest) {
    fail("RESOURCE_AUTHORING_COMMIT_INVALID", "Durable receipt content digest is invalid.")
  }
  return deepFreeze({ ...unsignedReceipt, receiptDigest })
}

function assertCatalogTarget(catalog: ResourceAuthoringCatalogBinding, documentUri: ResourceAuthoringDocumentUri): void {
  const relative = documentUri.slice(catalog.rootUri.length)
  if (!documentUri.startsWith(catalog.rootUri) || relative.length === 0 || relative.includes("/")) {
    fail("RESOURCE_AUTHORING_CATALOG_MISMATCH", `Target '${documentUri}' is not a direct member of catalog '${catalog.catalogId}'.`)
  }
  if (catalog.entry !== undefined && relative !== catalog.entry) {
    fail("RESOURCE_AUTHORING_CATALOG_MISMATCH", `Catalog '${catalog.catalogId}' admits only '${catalog.entry}'.`)
  }
}

function recordsAtDocument(tree: AuthoredResourceTree, documentUri: string): AuthoredResourceRecord[] {
  return [...tree.registry.byKind.values()].flatMap((records) => [...records]).filter((record) => record.documentUri === documentUri)
}

function compareInspectedRoots(left: ResourceAuthoringInspectedRoot, right: ResourceAuthoringInspectedRoot): number {
  return compareCodeUnits(left.resourceId, right.resourceId)
    || compareCodeUnits(left.kind, right.kind)
    || compareCodeUnits(left.envelopeVersion, right.envelopeVersion)
    || left.writerSpecVersion - right.writerSpecVersion
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function digestText(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`
}

function digestValue(value: unknown): string {
  return digestText(canonicalJson(value))
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Readonly<Record<string, unknown>>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`
  }
  invalid("canonical value")
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value
  for (const item of Object.values(value as Readonly<Record<string, unknown>>)) deepFreeze(item)
  return Object.freeze(value)
}

function ownRecord(value: unknown, keys: readonly string[], location: string): Readonly<Record<string, unknown>> {
  return ownRecordOptional(value, keys, [], location)
}

function ownRecordOptional(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  location: string,
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0) invalid(location)
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const actual = Object.keys(descriptors).filter((key) => descriptors[key]!.enumerable).sort(compareCodeUnits)
  const allowed = [...required, ...optional]
  if (required.some((key) => !actual.includes(key)) || actual.some((key) => !allowed.includes(key))) invalid(location)
  const output: Record<string, unknown> = {}
  for (const key of actual) {
    const descriptor = descriptors[key]!
    if (!("value" in descriptor)) invalid(`${location}.${key}`)
    output[key] = descriptor.value
  }
  return output
}

function ownArray(value: unknown, location: string): readonly unknown[] {
  if (!Array.isArray(value) || Object.getOwnPropertySymbols(value).length > 0) invalid(location)
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) invalid(location)
  }
  return value
}

function requiredString(value: unknown, location: string, allowWhitespace = false): string {
  if (typeof value !== "string" || value.length === 0 || (!allowWhitespace && value.trim() !== value)) invalid(location)
  return value
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function digestString(value: unknown, location: string): Sha256Digest {
  const text = requiredString(value, location)
  if (!/^sha256:[0-9a-f]{64}$/u.test(text)) invalid(location)
  return text as Sha256Digest
}

function exactSpecVersion(value: unknown, location: string): SpecVersion {
  if (!isSpecVersion(value)) invalid(location)
  return value
}

function normalizeDocumentUri(value: unknown, location: string): ResourceAuthoringDocumentUri {
  const text = requiredString(value, location)
  const logicalPath = text.startsWith("vfs://@/") ? text.slice("vfs://@/".length) : ""
  if (!isSafeAuthoringPath(logicalPath)
    || !/\.(?:xnl|md)$/u.test(logicalPath)) {
    fail("RESOURCE_AUTHORING_TARGET_UNSAFE", `${location} must be a containment-safe XNL or Markdown VFS document URI.`)
  }
  return text as ResourceAuthoringDocumentUri
}

function normalizeDirectoryUri(value: unknown, location: string): ResourceAuthoringDocumentUri {
  const text = requiredString(value, location)
  const logicalPath = text.startsWith("vfs://@/") && text.endsWith("/")
    ? text.slice("vfs://@/".length, -1)
    : ""
  if (!isSafeAuthoringPath(logicalPath)) {
    fail("RESOURCE_AUTHORING_TARGET_UNSAFE", `${location} must be a containment-safe VFS directory URI ending in '/'.`)
  }
  return text as ResourceAuthoringDocumentUri
}

function plainEntry(value: unknown, location: string): string {
  const text = requiredString(value, location)
  if (!isSafeAuthoringPath(text) || text.includes("/") || !/\.(?:xnl|md)$/u.test(text)) invalid(location)
  return text
}

function safeLogicalPath(value: unknown, location: string): string {
  const text = requiredString(value, location)
  if (!isSafeAuthoringPath(text)) invalid(location)
  return text
}

function isSafeAuthoringPath(value: string): boolean {
  if (value.length === 0 || value.startsWith("/") || value.includes("\\") || value.includes("%")
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
    || /[\ud800-\udfff]/u.test(value)) return false
  return value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
}

function uniqueStrings(value: unknown, location: string): readonly string[] {
  const items = ownArray(value, location).map((item, index) => requiredString(item, `${location}[${index}]`))
  requireUnique(items, location)
  return Object.freeze([...items])
}

function requireUnique(values: readonly string[], location: string): void {
  if (new Set(values).size !== values.length) invalid(`${location} identities`)
}

function invalid(location: string): never {
  throw new ResourceAuthoringError("RESOURCE_AUTHORING_INPUT_INVALID", `${location} is invalid or not closed own-data.`)
}

function fail(code: ResourceAuthoringErrorCode, message: string): never {
  throw new ResourceAuthoringError(code, message)
}
