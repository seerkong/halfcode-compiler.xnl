import {
  compareCodeUnits,
  type AuthoredResourceRecord,
  type AuthoredResourceTree,
  type JsonSchemaValidator,
  type PortableSpec,
  type ResolvedResourceRecord,
  type ResolvedResourceTree,
  type ResourceNode,
  type ResourceValue,
} from "halfcode-compiler-resource-core"
import {
  KindContractRegistry,
  KindReaderRegistry,
  SpecResolutionRegistry,
  resolveSpec,
  type ReaderProfile,
} from "./versioned-contracts"

export interface ResolveResourceTreeInput {
  readonly tree: AuthoredResourceTree
  readonly readerProfile: ReaderProfile
  readonly contracts: KindContractRegistry
  readonly readers: KindReaderRegistry
  readonly resolutions: SpecResolutionRegistry
  readonly validator: JsonSchemaValidator
}

export function resolveResourceTree(input: ResolveResourceTreeInput): ResolvedResourceTree {
  admitKindDefinitionDescriptions(input)

  const authored = uniqueAuthoredRecords(input.tree)
  const resolvedById = new Map<string, ResolvedResourceRecord>()
  for (const source of authored) {
    const owner = input.contracts.subject(source.kind)
    if (source.subjectFqn !== owner.subjectFqn) {
      fail(
        "AUTHORED_RESOURCE_SUBJECT_MISMATCH",
        `Resource '${source.resourceId}' was decoded as '${source.subjectFqn}' but admitted Kind '${source.kind}' owns '${owner.subjectFqn}'.`,
      )
    }
    const result = resolveSpec({
      resourceId: source.resourceId,
      kind: source.kind,
      writerSpecVersion: source.metadata.specVersion,
      authoredSpec: source.authoredSpec as unknown as PortableSpec,
      sourceContentDigest: source.sourceContentDigest,
      readerProfile: input.readerProfile,
      contracts: input.contracts,
      readers: input.readers,
      resolutions: input.resolutions,
      validator: input.validator,
    })
    const record = Object.freeze({
      stage: "resolved" as const,
      kind: source.kind,
      subjectFqn: owner.subjectFqn,
      resourceId: source.resourceId,
      fqn: source.fqn,
      ...(source.name ? { name: source.name } : {}),
      ...(source.description ? { description: source.description } : {}),
      metadata: source.metadata,
      sourceShape: source.sourceShape,
      logicalPath: source.logicalPath,
      documentUri: source.documentUri,
      format: source.format,
      node: resolvedNode(source.node, result.resolvedSpec),
      source,
      readerId: result.receipt.reader.readerId,
      readerSpecVersion: result.receipt.reader.specVersion,
      resolvedSpec: result.resolvedSpec,
      readerValue: result.readerValue,
      resolution: result.receipt,
      effectiveContentDigest: result.effectiveContentDigest,
    }) satisfies ResolvedResourceRecord
    resolvedById.set(record.resourceId, record)
  }

  const manifest = resolvedById.get(input.tree.manifest.resourceId)
  if (!manifest) fail("RESOLVED_MANIFEST_MISSING", `Manifest '${input.tree.manifest.resourceId}' was not resolved.`)

  const byKind = new Map<string, readonly ResolvedResourceRecord[]>()
  for (const [kind, records] of input.tree.registry.byKind) {
    byKind.set(kind, Object.freeze(records.map((record) => {
      const resolved = resolvedById.get(record.resourceId)
      if (!resolved) fail("RESOLVED_RESOURCE_MISSING", `Resource '${record.resourceId}' was not resolved.`)
      return resolved
    })))
  }
  const receipts = Object.freeze([...resolvedById.values()]
    .sort((left, right) => compareCodeUnits(left.resourceId, right.resourceId))
    .map((record) => record.resolution))
  const effectiveContentIdentities = readonlyMap([...resolvedById.values()]
    .sort((left, right) => compareCodeUnits(left.resourceId, right.resourceId))
    .map((record) => [record.resourceId, record.effectiveContentDigest] as const))

  return Object.freeze({
    stage: "resolved" as const,
    source: input.tree,
    manifest,
    registry: Object.freeze({
      byKind: readonlyMap([...byKind.entries()].sort(([left], [right]) => compareCodeUnits(left, right))),
      kindDefinitions: input.tree.registry.kindDefinitions,
    }),
    diagnostics: Object.freeze([]),
    readerProfileId: input.readerProfile.profileId,
    receipts,
    effectiveContentIdentities,
  })
}

function admitKindDefinitionDescriptions(input: ResolveResourceTreeInput): void {
  for (const definition of input.tree.registry.kindDefinitions.values()) {
    const owner = input.contracts.subject(definition.resourceKind)
    if (owner.subjectFqn !== definition.subjectFqn) {
      fail(
        "KIND_DEFINITION_SUBJECT_MISMATCH",
        `KindDefinition '${definition.resourceId}' describes '${definition.subjectFqn}', admitted owner describes '${owner.subjectFqn}'.`,
      )
    }
    const expectedSource = owner.sourceContract
    const actualSourceShapes = Object.freeze([...new Set(definition.sourceShapes)].sort(compareCodeUnits))
    const actualRequiredFiles = Object.freeze([...new Set(definition.requiredFiles)].sort(compareCodeUnits))
    if (actualSourceShapes.length !== expectedSource.sourceShapes.length
      || actualSourceShapes.some((shape, index) => shape !== expectedSource.sourceShapes[index])
      || definition.documentCardinality !== expectedSource.documentCardinality
      || actualRequiredFiles.length !== expectedSource.requiredFiles.length
      || actualRequiredFiles.some((name, index) => name !== expectedSource.requiredFiles[index])) {
      fail(
        "KIND_DEFINITION_SOURCE_CONTRACT_MISMATCH",
        `KindDefinition '${definition.resourceId}' source shapes, cardinality, or required files differ from admitted owner '${owner.subjectFqn}'.`,
      )
    }
    const admitted = input.contracts.revisions(definition.subjectFqn)
    if (admitted.length !== definition.specRevisions.length) {
      fail(
        "KIND_DEFINITION_REVISION_SET_MISMATCH",
        `KindDefinition '${definition.resourceId}' revision set does not match admitted registrations.`,
      )
    }
    for (const descriptor of definition.specRevisions) {
      const revision = input.contracts.revision(definition.subjectFqn, descriptor.specVersion)
      if (revision.schemaFingerprint !== descriptor.schemaFingerprint
        || revision.contractFingerprint !== descriptor.contractFingerprint
        || revision.stability !== descriptor.stability
        || revision.semanticContract.semanticValidatorFingerprint !== descriptor.semanticContract.semanticValidatorFingerprint
        || revision.semanticContract.referenceProjectionFingerprint !== descriptor.semanticContract.referenceProjectionFingerprint
        || revision.semanticContract.compilerInputFingerprint !== descriptor.semanticContract.compilerInputFingerprint) {
        fail(
          "KIND_DEFINITION_REVISION_MISMATCH",
          `KindDefinition '${definition.resourceId}' revision ${descriptor.specVersion} differs from admitted contract content.`,
        )
      }
    }
  }
}

function uniqueAuthoredRecords(tree: AuthoredResourceTree): readonly AuthoredResourceRecord[] {
  const byId = new Map<string, AuthoredResourceRecord>([[tree.manifest.resourceId, tree.manifest]])
  for (const records of tree.registry.byKind.values()) {
    for (const record of records) byId.set(record.resourceId, record)
  }
  return Object.freeze([...byId.values()].sort((left, right) => compareCodeUnits(left.resourceId, right.resourceId)))
}

function resolvedNode(source: ResourceNode, spec: PortableSpec): ResourceNode {
  return Object.freeze({
    ...source,
    properties: asResourceMap(spec.properties, source.properties),
    body: asResourceList(spec.body, source.body),
    subdomains: asResourceNodeMap(spec.subdomains, source.subdomains),
    ...(typeof spec.text === "string" ? { text: spec.text } : source.text === undefined ? {} : { text: source.text }),
  })
}

function asResourceMap(value: unknown, fallback: Readonly<Record<string, ResourceValue>>): Readonly<Record<string, ResourceValue>> {
  return isRecord(value) ? value as Readonly<Record<string, ResourceValue>> : fallback
}

function asResourceList(value: unknown, fallback: readonly ResourceValue[]): readonly ResourceValue[] {
  return Array.isArray(value) ? value as readonly ResourceValue[] : fallback
}

function asResourceNodeMap(value: unknown, fallback: Readonly<Record<string, ResourceNode>>): Readonly<Record<string, ResourceNode>> {
  return isRecord(value) ? value as Readonly<Record<string, ResourceNode>> : fallback
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readonlyMap<K, V>(entries: readonly (readonly [K, V])[]): ReadonlyMap<K, V> {
  const target = new Map(entries)
  return Object.freeze({
    get size() { return target.size },
    has: (key: K) => target.has(key),
    get: (key: K) => target.get(key),
    forEach: (callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown) => {
      target.forEach((value, key) => callback.call(thisArg, value, key, target))
    },
    entries: () => target.entries(),
    keys: () => target.keys(),
    values: () => target.values(),
    [Symbol.iterator]: () => target[Symbol.iterator](),
  })
}

function fail(code: string, message: string): never {
  throw new Error(`${code}: ${message}`)
}
