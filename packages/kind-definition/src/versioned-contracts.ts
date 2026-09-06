import {
  digestCanonical,
  type CompatibilityPolicy,
  type JsonSchema,
  type JsonSchemaValidator,
  type KindContractLock,
  type KindContractLockReader,
  type KindReaderRegistration,
  type KindSemanticContract,
  type KindSourceContract,
  type KindSourceShape,
  type KindSpecRevision,
  type KindSubjectOwner,
  type KindWriterRegistration,
  type PortableSpec,
  type PortableValue,
  type ReaderProfile,
  type ReaderTarget,
  type ResolvedSpec,
  type ResourceResolutionReceipt,
  type Sha256Digest,
  type SpecResolutionDefinition,
  type SpecVersion,
} from "halfcode-compiler-resource-core"

export type {
  CompatibilityPolicy,
  JsonSchema,
  JsonSchemaValidator,
  KindContractLock,
  KindContractLockReader,
  KindReaderRegistration,
  KindSemanticContract,
  KindSourceContract,
  KindSourceShape,
  KindSpecRevision,
  KindSubjectOwner,
  KindWriterRegistration,
  PortableSpec,
  PortableValue,
  ReaderProfile,
  ReaderTarget,
  ResolvedSpec,
  ResourceResolutionReceipt,
  Sha256Digest,
  SpecResolutionDefinition,
  SpecVersion,
} from "halfcode-compiler-resource-core"

export class KindContractRegistry {
  private readonly ownersByKind = new Map<string, KindSubjectOwner>()
  private readonly ownersBySubject = new Map<string, KindSubjectOwner>()
  private readonly revisionsBySubject = new Map<string, Map<SpecVersion, KindSpecRevision>>()

  registerOwner(input: KindSubjectOwner): this {
    const owner = freezeOwner(input)
    const byKind = this.ownersByKind.get(owner.kind)
    const bySubject = this.ownersBySubject.get(owner.subjectFqn)
    if ((byKind && !sameOwner(byKind, owner)) || (bySubject && !sameOwner(bySubject, owner))) {
      fail("KIND_SUBJECT_OWNER_CONFLICT", `Kind '${owner.kind}' or subject '${owner.subjectFqn}' already has a different owner.`)
    }
    this.ownersByKind.set(owner.kind, owner)
    this.ownersBySubject.set(owner.subjectFqn, owner)
    return this
  }

  registerRevision(input: KindSpecRevision): this {
    const revision = freezeRevision(input)
    const owner = this.ownersBySubject.get(revision.subjectFqn)
    if (!owner || owner.kind !== revision.kind) {
      fail("KIND_SPEC_OWNER_NOT_ADMITTED", `Subject '${revision.subjectFqn}' has no admitted owner for Kind '${revision.kind}'.`)
    }
    if (revision.sourceContractFingerprint !== owner.sourceContract.sourceContractFingerprint) {
      fail(
        "KIND_SPEC_SOURCE_CONTRACT_MISMATCH",
        `Revision '${revision.subjectFqn}@${revision.specVersion}' does not bind its admitted owner source contract.`,
      )
    }
    const revisions = this.revisionsBySubject.get(revision.subjectFqn) ?? new Map<SpecVersion, KindSpecRevision>()
    const previous = revisions.get(revision.specVersion)
    if (previous) {
      if (previous.contractFingerprint !== revision.contractFingerprint
        || previous.schemaFingerprint !== revision.schemaFingerprint
        || digestCanonical(previous.specSchema) !== digestCanonical(revision.specSchema)) {
        fail("KIND_SPEC_CONTRACT_CONFLICT", `Revision '${revision.subjectFqn}@${revision.specVersion}' is immutable.`)
      }
      return this
    }
    revisions.set(revision.specVersion, revision)
    this.revisionsBySubject.set(revision.subjectFqn, revisions)
    return this
  }

  subject(kind: string): KindSubjectOwner {
    const value = this.ownersByKind.get(nonEmpty(kind, "kind"))
    if (!value) fail("KIND_SUBJECT_MISSING", `No admitted subject owns Kind '${kind}'.`)
    return value
  }

  owner(subjectFqn: string): KindSubjectOwner {
    const value = this.ownersBySubject.get(nonEmpty(subjectFqn, "subjectFqn"))
    if (!value) fail("KIND_SUBJECT_MISSING", `No admitted owner exists for subject '${subjectFqn}'.`)
    return value
  }

  revision(subjectFqn: string, specVersion: SpecVersion): KindSpecRevision {
    const version = exactSpecVersion(specVersion)
    const value = this.revisionsBySubject.get(nonEmpty(subjectFqn, "subjectFqn"))?.get(version)
    if (!value) fail("KIND_SPEC_REVISION_MISSING", `Revision '${subjectFqn}@${version}' is not registered.`)
    return value
  }

  owners(): readonly KindSubjectOwner[] {
    return Object.freeze([...this.ownersBySubject.values()].sort((left, right) => compare(left.subjectFqn, right.subjectFqn)))
  }

  revisions(subjectFqn?: string): readonly KindSpecRevision[] {
    const values = subjectFqn
      ? [...(this.revisionsBySubject.get(subjectFqn)?.values() ?? [])]
      : [...this.revisionsBySubject.values()].flatMap((revisions) => [...revisions.values()])
    return Object.freeze(values.sort((left, right) => compare(left.subjectFqn, right.subjectFqn) || left.specVersion - right.specVersion))
  }
}

export class KindWriterRegistry {
  private readonly registrations = new Map<string, KindWriterRegistration<any>>()

  constructor(readonly contracts: KindContractRegistry) {}

  register<Input>(input: KindWriterRegistration<Input>): this {
    const subjectFqn = nonEmpty(input.subjectFqn, "writer.subjectFqn")
    const writerSpecVersion = exactSpecVersion(input.writerSpecVersion)
    const contractFingerprint = validateFingerprint(input.contractFingerprint, "writer.contractFingerprint")
    if (typeof input.write !== "function") fail("KIND_WRITER_INVALID", "Writer registration requires a write function.")
    const revision = this.contracts.revision(subjectFqn, writerSpecVersion)
    if (revision.contractFingerprint !== contractFingerprint) {
      fail("KIND_WRITER_CONTRACT_MISMATCH", `Writer '${subjectFqn}@${writerSpecVersion}' contract fingerprint does not match its revision.`)
    }
    const key = revisionKey(subjectFqn, writerSpecVersion)
    const previous = this.registrations.get(key)
    if (previous && (previous.contractFingerprint !== contractFingerprint || previous.write !== input.write)) {
      fail("KIND_WRITER_REGISTRATION_CONFLICT", `Writer '${key}' is already registered with a different implementation.`)
    }
    this.registrations.set(key, Object.freeze({ subjectFqn, writerSpecVersion, contractFingerprint, write: input.write }))
    return this
  }

  require(subjectFqn: string, writerSpecVersion: SpecVersion): KindWriterRegistration<any> {
    const key = revisionKey(nonEmpty(subjectFqn, "subjectFqn"), exactSpecVersion(writerSpecVersion))
    const writer = this.registrations.get(key)
    if (!writer) fail("KIND_WRITER_MISSING", `Writer '${key}' is not registered.`)
    return writer
  }
}

export class KindReaderRegistry {
  private readonly registrations = new Map<string, KindReaderRegistration>()

  register<Output>(input: KindReaderRegistration<Output>): this {
    const registration = freezeReader(input)
    const previous = this.registrations.get(registration.readerId)
    if (previous && !sameReader(previous, registration)) {
      fail("KIND_READER_REGISTRATION_CONFLICT", `Reader '${registration.readerId}' is already registered with a different contract.`)
    }
    this.registrations.set(registration.readerId, registration)
    return this
  }

  require(target: ReaderTarget): KindReaderRegistration {
    const exactTarget = freezeTarget(target)
    const reader = this.registrations.get(exactTarget.readerId)
    if (!reader) fail("KIND_READER_MISSING", `Reader '${exactTarget.readerId}' is not registered.`)
    if (reader.subjectFqn !== exactTarget.subjectFqn || reader.readerSpecVersion !== exactTarget.readerSpecVersion) {
      fail("KIND_READER_TARGET_MISMATCH", `Reader '${exactTarget.readerId}' does not implement the requested subject/version.`)
    }
    if (reader.contractFingerprint !== exactTarget.contractFingerprint
      || reader.readerImplementationFingerprint !== exactTarget.readerImplementationFingerprint) {
      fail("KIND_READER_FINGERPRINT_MISMATCH", `Reader '${exactTarget.readerId}' fingerprint does not match its target.`)
    }
    return reader
  }

  all(): readonly KindReaderRegistration[] {
    return Object.freeze([...this.registrations.values()].sort((left, right) => compare(left.readerId, right.readerId)))
  }
}

class ExactReaderProfile implements ReaderProfile {
  readonly readers: ReadonlyMap<string, ReaderTarget>

  constructor(readonly profileId: string, targets: readonly ReaderTarget[]) {
    nonEmpty(profileId, "profileId")
    const readers = new Map<string, ReaderTarget>()
    for (const input of targets) {
      const target = freezeTarget(input)
      if (readers.has(target.subjectFqn)) {
        fail("KIND_READER_TARGET_CONFLICT", `Profile '${profileId}' declares subject '${target.subjectFqn}' more than once.`)
      }
      readers.set(target.subjectFqn, target)
    }
    this.readers = readonlyMap(readers)
    Object.freeze(this)
  }

  readerFor(subjectFqn: string): ReaderTarget {
    const target = this.readers.get(subjectFqn)
    if (!target) fail("KIND_READER_TARGET_MISSING", `Profile '${this.profileId}' has no reader for '${subjectFqn}'.`)
    return target
  }
}

export function createReaderProfile(profileId: string, targets: readonly ReaderTarget[]): ReaderProfile {
  return new ExactReaderProfile(profileId, targets)
}

export class SpecResolutionRegistry {
  private readonly definitions: SpecResolutionDefinition[] = []
  private readonly ids = new Set<string>()

  constructor(readonly contracts: KindContractRegistry) {}

  register(input: SpecResolutionDefinition): this {
    const definition = freezeResolution(input)
    if (this.ids.has(definition.id)) fail("SPEC_RESOLUTION_ID_CONFLICT", `Resolution '${definition.id}' is already registered.`)
    const owner = this.contracts.owner(definition.subjectFqn)
    if (owner.ownerPackageId !== definition.ownerPackageId
      || owner.ownerPackageFingerprint !== definition.ownerPackageFingerprint) {
      fail("SPEC_RESOLUTION_OWNER_NOT_ADMITTED", `Resolution '${definition.id}' is not provided by admitted owner '${owner.ownerPackageId}'.`)
    }
    const writer = this.contracts.revision(definition.subjectFqn, definition.writerSpecVersion)
    const reader = this.contracts.revision(definition.subjectFqn, definition.readerSpecVersion)
    if (writer.contractFingerprint !== definition.writerContractFingerprint
      || reader.contractFingerprint !== definition.readerContractFingerprint) {
      fail("SPEC_RESOLUTION_ENDPOINT_MISMATCH", `Resolution '${definition.id}' endpoint fingerprint does not match its revisions.`)
    }
    if (definition.writerSpecVersion === definition.readerSpecVersion) {
      fail("SPEC_RESOLUTION_IDENTITY_EXPLICIT", "Same-version resolution is implicit and must not register executable code.")
    }
    const sameEndpoints = this.definitions.find((candidate) => candidate.subjectFqn === definition.subjectFqn
      && candidate.writerSpecVersion === definition.writerSpecVersion
      && candidate.readerSpecVersion === definition.readerSpecVersion)
    if (sameEndpoints) {
      fail("SPEC_RESOLUTION_EDGE_CONFLICT", `Resolution edge '${definition.subjectFqn}' ${definition.writerSpecVersion}→${definition.readerSpecVersion} is already owned by '${sameEndpoints.id}'.`)
    }
    this.ids.add(definition.id)
    this.definitions.push(definition)
    return this
  }

  plan(subjectFqn: string, writerSpecVersion: SpecVersion, readerSpecVersion: SpecVersion): readonly SpecResolutionDefinition[] {
    const from = exactSpecVersion(writerSpecVersion)
    const to = exactSpecVersion(readerSpecVersion)
    this.contracts.revision(subjectFqn, from)
    this.contracts.revision(subjectFqn, to)
    if (from === to) return Object.freeze([])
    this.validateGraph(subjectFqn)
    const paths: SpecResolutionDefinition[][] = []
    const visit = (version: SpecVersion, path: SpecResolutionDefinition[], seen: Set<SpecVersion>): void => {
      if (paths.length > 1) return
      if (version === to) {
        paths.push(path)
        return
      }
      for (const edge of this.outgoing(subjectFqn, version)) {
        if (seen.has(edge.readerSpecVersion)) continue
        visit(edge.readerSpecVersion, [...path, edge], new Set([...seen, edge.readerSpecVersion]))
      }
    }
    visit(from, [], new Set([from]))
    if (paths.length === 0) fail("SPEC_RESOLUTION_PATH_MISSING", `No resolution path exists for '${subjectFqn}' ${from}→${to}.`)
    if (paths.length > 1) fail("SPEC_RESOLUTION_PATH_AMBIGUOUS", `More than one resolution path exists for '${subjectFqn}' ${from}→${to}.`)
    return Object.freeze([...paths[0]!])
  }

  validateGraph(subjectFqn?: string): void {
    const subjects = subjectFqn
      ? [subjectFqn]
      : [...new Set(this.definitions.map((definition) => definition.subjectFqn))]
    for (const subject of subjects) {
      const visiting = new Set<SpecVersion>()
      const visited = new Set<SpecVersion>()
      const walk = (version: SpecVersion): void => {
        if (visiting.has(version)) fail("SPEC_RESOLUTION_GRAPH_CYCLIC", `Resolution graph for '${subject}' contains a cycle at version ${version}.`)
        if (visited.has(version)) return
        visiting.add(version)
        for (const edge of this.outgoing(subject, version)) walk(edge.readerSpecVersion)
        visiting.delete(version)
        visited.add(version)
      }
      for (const revision of this.contracts.revisions(subject)) walk(revision.specVersion)
    }
  }

  validateReaderCompatibility(registration: KindReaderRegistration): void {
    const target = registration.readerSpecVersion
    if (registration.compatibilityPolicy === "exact") return
    const older = this.contracts.revisions(registration.subjectFqn).filter((revision) => revision.specVersion < target)
    if (registration.compatibilityPolicy === "backward") {
      const previous = older.at(-1)
      if (previous && this.plan(registration.subjectFqn, previous.specVersion, target).length !== 1) {
        fail("KIND_READER_BACKWARD_COVERAGE_INVALID", `Reader '${registration.readerId}' requires one direct previous-version resolution.`)
      }
      return
    }
    for (const revision of older) this.plan(registration.subjectFqn, revision.specVersion, target)
  }

  all(): readonly SpecResolutionDefinition[] {
    return Object.freeze([...this.definitions].sort((left, right) => compare(left.subjectFqn, right.subjectFqn)
      || left.writerSpecVersion - right.writerSpecVersion
      || left.readerSpecVersion - right.readerSpecVersion
      || compare(left.id, right.id)))
  }

  private outgoing(subjectFqn: string, writerSpecVersion: SpecVersion): readonly SpecResolutionDefinition[] {
    return this.definitions
      .filter((definition) => definition.subjectFqn === subjectFqn && definition.writerSpecVersion === writerSpecVersion)
      .sort((left, right) => left.readerSpecVersion - right.readerSpecVersion || compare(left.id, right.id))
  }
}

export function resolveSpec<Output = unknown>(input: Readonly<{
  resourceId: string
  kind: string
  writerSpecVersion: SpecVersion
  authoredSpec: PortableSpec
  sourceContentDigest: Sha256Digest
  readerProfile: ReaderProfile
  contracts: KindContractRegistry
  readers: KindReaderRegistry
  resolutions: SpecResolutionRegistry
  validator: JsonSchemaValidator
}>): ResolvedSpec<Output> {
  const resourceId = nonEmpty(input.resourceId, "resourceId")
  const owner = input.contracts.subject(input.kind)
  const writer = input.contracts.revision(owner.subjectFqn, input.writerSpecVersion)
  validateFingerprint(input.sourceContentDigest, "sourceContentDigest")
  let resolvedSpec = clonePortableSpec(input.authoredSpec)
  validateSchema(input.validator, writer, resolvedSpec, "WRITER_SCHEMA_INVALID")

  const target = input.readerProfile.readerFor(owner.subjectFqn)
  const reader = input.readers.require(target)
  const readerRevision = input.contracts.revision(owner.subjectFqn, reader.readerSpecVersion)
  if (readerRevision.contractFingerprint !== reader.contractFingerprint) {
    fail("KIND_READER_CONTRACT_MISMATCH", `Reader '${reader.readerId}' contract fingerprint does not match revision ${reader.readerSpecVersion}.`)
  }
  input.resolutions.validateReaderCompatibility(reader)
  if (reader.compatibilityPolicy === "exact" && writer.specVersion !== reader.readerSpecVersion) {
    fail("KIND_READER_EXACT_VERSION_REQUIRED", `Reader '${reader.readerId}' only accepts writer version ${reader.readerSpecVersion}.`)
  }
  if (reader.compatibilityPolicy !== "exact" && writer.specVersion > reader.readerSpecVersion) {
    fail(
      "KIND_READER_FORWARD_VERSION_UNSUPPORTED",
      `Reader '${reader.readerId}' uses '${reader.compatibilityPolicy}' compatibility and cannot read newer writer version ${writer.specVersion}.`,
    )
  }
  const path = input.resolutions.plan(owner.subjectFqn, writer.specVersion, reader.readerSpecVersion)
  if (reader.compatibilityPolicy === "backward" && path.length > 1) {
    fail("KIND_READER_BACKWARD_PATH_NOT_DIRECT", `Reader '${reader.readerId}' requires a direct resolution.`)
  }
  for (const edge of path) {
    const next = clonePortableSpec(edge.resolve(resolvedSpec))
    const targetRevision = input.contracts.revision(owner.subjectFqn, edge.readerSpecVersion)
    validateSchema(input.validator, targetRevision, next, "SPEC_RESOLUTION_TARGET_SCHEMA_INVALID")
    resolvedSpec = next
  }
  validateSchema(input.validator, readerRevision, resolvedSpec, "READER_SCHEMA_INVALID")
  const readerValue = reader.read(resolvedSpec) as Output
  const resolvedSpecDigest = digestCanonical(resolvedSpec)
  const pathReceipt = Object.freeze(path.map((edge) => Object.freeze({
    resolutionId: edge.id,
    resolutionFingerprint: edge.resolutionFingerprint,
  })))
  const receipt: ResourceResolutionReceipt = Object.freeze({
    resourceId,
    subjectFqn: owner.subjectFqn,
    sourceContentDigest: input.sourceContentDigest,
    writer: Object.freeze({
      specVersion: writer.specVersion,
      schemaFingerprint: writer.schemaFingerprint,
      contractFingerprint: writer.contractFingerprint,
      sourceContractFingerprint: writer.sourceContractFingerprint,
    }),
    reader: Object.freeze({
      readerId: reader.readerId,
      specVersion: reader.readerSpecVersion,
      schemaFingerprint: readerRevision.schemaFingerprint,
      contractFingerprint: reader.contractFingerprint,
      implementationFingerprint: reader.readerImplementationFingerprint,
      sourceContractFingerprint: readerRevision.sourceContractFingerprint,
    }),
    path: pathReceipt,
    resolvedSpecDigest,
  })
  return Object.freeze({
    resolvedSpec,
    readerValue,
    receipt,
    effectiveContentDigest: digestCanonical({
      sourceContentDigest: input.sourceContentDigest,
      writer: receipt.writer,
      reader: receipt.reader,
      path: pathReceipt,
      resolvedSpecDigest,
    }),
  })
}

export function createKindContractLock(input: Readonly<{
  envelopeVersion: string
  envelopeFingerprint: Sha256Digest
  contracts: KindContractRegistry
  readerProfile: ReaderProfile
  readers: KindReaderRegistry
  resolutions: SpecResolutionRegistry
}>): KindContractLock {
  const envelopeVersion = nonEmpty(input.envelopeVersion, "envelopeVersion")
  const envelopeFingerprint = validateFingerprint(input.envelopeFingerprint, "envelopeFingerprint")
  const owners = Object.freeze(input.contracts.owners().map(freezeOwner))
  const readers = Object.freeze([...input.readerProfile.readers.values()]
    .map((target) => {
      const reader = input.readers.require(target)
      const revision = input.contracts.revision(target.subjectFqn, target.readerSpecVersion)
      if (revision.contractFingerprint !== target.contractFingerprint) {
        fail("KIND_READER_CONTRACT_MISMATCH", `Reader target '${target.readerId}' does not match revision '${target.subjectFqn}@${target.readerSpecVersion}'.`)
      }
      input.resolutions.validateReaderCompatibility(reader)
      return Object.freeze({
        ...freezeTarget(target),
        compatibilityPolicy: reader.compatibilityPolicy,
      }) satisfies KindContractLockReader
    })
    .sort((left, right) => compare(left.subjectFqn, right.subjectFqn)))
  const revisions = Object.freeze(input.contracts.revisions().map((revision) => {
    const owner = input.contracts.owner(revision.subjectFqn)
    return Object.freeze({
      subjectFqn: revision.subjectFqn,
      specVersion: revision.specVersion,
      schemaFingerprint: revision.schemaFingerprint,
      contractFingerprint: revision.contractFingerprint,
      ownerPackageId: owner.ownerPackageId,
      ownerPackageFingerprint: owner.ownerPackageFingerprint,
      sourceContractFingerprint: revision.sourceContractFingerprint,
    })
  }))
  input.resolutions.validateGraph()
  const resolutions = Object.freeze(input.resolutions.all().map((resolution) => Object.freeze({
    resolutionId: resolution.id,
    subjectFqn: resolution.subjectFqn,
    writerSpecVersion: resolution.writerSpecVersion,
    readerSpecVersion: resolution.readerSpecVersion,
    resolutionFingerprint: resolution.resolutionFingerprint,
  })))
  const facts = { envelopeVersion, envelopeFingerprint, owners, readers, revisions, resolutions }
  return Object.freeze({ ...facts, lockDigest: digestCanonical(facts) })
}

export function exactSpecVersion(value: number): SpecVersion {
  if (!Number.isSafeInteger(value) || value <= 0) fail("SPEC_VERSION_INVALID", "specVersion must be a positive safe integer.")
  return value
}

export function createKindSubjectOwner(input: Readonly<{
  kind: string
  subjectFqn: string
  ownerPackageId: string
  ownerPackageFingerprint: Sha256Digest
  sourceShapes: readonly KindSourceShape[]
  documentCardinality?: "one" | "many"
  requiredFiles?: readonly string[]
}>): KindSubjectOwner {
  const kind = nonEmpty(input.kind, "owner.kind")
  const subjectFqn = nonEmpty(input.subjectFqn, "owner.subjectFqn")
  const ownerPackageId = nonEmpty(input.ownerPackageId, "owner.ownerPackageId")
  const ownerPackageFingerprint = validateFingerprint(input.ownerPackageFingerprint, "owner.ownerPackageFingerprint")
  const sourceShapes = Object.freeze([...new Set(input.sourceShapes.map((shape) => validateSourceShape(shape)))].sort(compare))
  if (sourceShapes.length === 0) fail("KIND_SOURCE_CONTRACT_INVALID", "Kind source contract requires at least one source shape.")
  const documentCardinality = input.documentCardinality ?? "one"
  if (documentCardinality !== "one" && documentCardinality !== "many") {
    fail("KIND_SOURCE_CONTRACT_INVALID", `Unknown document cardinality '${documentCardinality}'.`)
  }
  if (documentCardinality === "many" && (sourceShapes.length !== 1 || sourceShapes[0] !== "single-file")) {
    fail("KIND_SOURCE_CONTRACT_INVALID", "documentCardinality 'many' requires exactly the single-file source shape.")
  }
  const requiredFiles = Object.freeze([...new Set((input.requiredFiles ?? []).map((name) => nonEmpty(name, "owner.requiredFile")))].sort(compare))
  const sourceFacts = Object.freeze({ sourceShapes, documentCardinality, requiredFiles })
  const sourceContract: KindSourceContract = Object.freeze({
    ...sourceFacts,
    sourceContractFingerprint: digestCanonical(sourceFacts),
  })
  return Object.freeze({ kind, subjectFqn, ownerPackageId, ownerPackageFingerprint, sourceContract })
}

export function createKindSpecRevision(input: Readonly<{
  kind: string
  subjectFqn: string
  specVersion: SpecVersion
  specSchema: JsonSchema
  semanticContract: KindSemanticContract
  sourceContractFingerprint: Sha256Digest
  stability: KindSpecRevision["stability"]
}>): KindSpecRevision {
  const kind = nonEmpty(input.kind, "revision.kind")
  const subjectFqn = nonEmpty(input.subjectFqn, "revision.subjectFqn")
  const specVersion = exactSpecVersion(input.specVersion)
  const specSchema = cloneJson(input.specSchema) as JsonSchema
  const semanticContract = freezeSemanticContract(input.semanticContract)
  const sourceContractFingerprint = validateFingerprint(input.sourceContractFingerprint, "revision.sourceContractFingerprint")
  const schemaFingerprint = digestCanonical(specSchema)
  return Object.freeze({
    kind,
    subjectFqn,
    specVersion,
    specSchema,
    semanticContract,
    sourceContractFingerprint,
    schemaFingerprint,
    contractFingerprint: digestCanonical({
      kind,
      subjectFqn,
      specVersion,
      schemaFingerprint,
      semanticContract,
      sourceContractFingerprint,
    }),
    stability: input.stability,
  })
}

function validateSchema(
  validator: JsonSchemaValidator,
  revision: KindSpecRevision,
  value: PortableSpec,
  code: string,
): void {
  const issues = validator.validate(revision, value)
  if (issues.length > 0) fail(code, `${revision.subjectFqn}@${revision.specVersion}: ${issues.join("; ")}`)
}

function freezeOwner(input: KindSubjectOwner): KindSubjectOwner {
  const owner = createKindSubjectOwner({
    kind: input.kind,
    subjectFqn: input.subjectFqn,
    ownerPackageId: input.ownerPackageId,
    ownerPackageFingerprint: input.ownerPackageFingerprint,
    sourceShapes: input.sourceContract.sourceShapes,
    documentCardinality: input.sourceContract.documentCardinality,
    requiredFiles: input.sourceContract.requiredFiles,
  })
  if (owner.sourceContract.sourceContractFingerprint !== validateFingerprint(
    input.sourceContract.sourceContractFingerprint,
    "owner.sourceContract.sourceContractFingerprint",
  )) fail("KIND_SOURCE_CONTRACT_FINGERPRINT_MISMATCH", `Kind '${owner.kind}' source contract fingerprint is not canonical.`)
  return owner
}

function freezeRevision(input: KindSpecRevision): KindSpecRevision {
  const revision = createKindSpecRevision({
    kind: nonEmpty(input.kind, "revision.kind"),
    subjectFqn: nonEmpty(input.subjectFqn, "revision.subjectFqn"),
    specVersion: exactSpecVersion(input.specVersion),
    specSchema: cloneJson(input.specSchema) as JsonSchema,
    semanticContract: input.semanticContract,
    sourceContractFingerprint: input.sourceContractFingerprint,
    stability: input.stability,
  })
  if (revision.schemaFingerprint !== validateFingerprint(input.schemaFingerprint, "revision.schemaFingerprint")
    || revision.contractFingerprint !== validateFingerprint(input.contractFingerprint, "revision.contractFingerprint")) {
    fail("KIND_SPEC_FINGERPRINT_MISMATCH", `Revision '${revision.subjectFqn}@${revision.specVersion}' fingerprints do not match canonical contract content.`)
  }
  return revision
}

function freezeReader<Output>(input: KindReaderRegistration<Output>): KindReaderRegistration<Output> {
  if (typeof input.read !== "function") fail("KIND_READER_INVALID", "Reader registration requires a read function.")
  if (!(["exact", "backward", "backward-transitive"] as const).includes(input.compatibilityPolicy)) {
    fail("KIND_READER_POLICY_INVALID", `Unknown compatibility policy '${input.compatibilityPolicy}'.`)
  }
  return Object.freeze({
    readerId: nonEmpty(input.readerId, "reader.readerId"),
    subjectFqn: nonEmpty(input.subjectFqn, "reader.subjectFqn"),
    readerSpecVersion: exactSpecVersion(input.readerSpecVersion),
    contractFingerprint: validateFingerprint(input.contractFingerprint, "reader.contractFingerprint"),
    readerImplementationFingerprint: validateFingerprint(input.readerImplementationFingerprint, "reader.readerImplementationFingerprint"),
    compatibilityPolicy: input.compatibilityPolicy,
    read: input.read,
  })
}

function freezeTarget(input: ReaderTarget): ReaderTarget {
  return Object.freeze({
    readerId: nonEmpty(input.readerId, "target.readerId"),
    subjectFqn: nonEmpty(input.subjectFqn, "target.subjectFqn"),
    readerSpecVersion: exactSpecVersion(input.readerSpecVersion),
    contractFingerprint: validateFingerprint(input.contractFingerprint, "target.contractFingerprint"),
    readerImplementationFingerprint: validateFingerprint(input.readerImplementationFingerprint, "target.readerImplementationFingerprint"),
  })
}

function freezeResolution(input: SpecResolutionDefinition): SpecResolutionDefinition {
  if (typeof input.resolve !== "function") fail("SPEC_RESOLUTION_INVALID", "Resolution registration requires a resolve function.")
  return Object.freeze({
    id: nonEmpty(input.id, "resolution.id"),
    subjectFqn: nonEmpty(input.subjectFqn, "resolution.subjectFqn"),
    ownerPackageId: nonEmpty(input.ownerPackageId, "resolution.ownerPackageId"),
    ownerPackageFingerprint: validateFingerprint(input.ownerPackageFingerprint, "resolution.ownerPackageFingerprint"),
    writerSpecVersion: exactSpecVersion(input.writerSpecVersion),
    readerSpecVersion: exactSpecVersion(input.readerSpecVersion),
    writerContractFingerprint: validateFingerprint(input.writerContractFingerprint, "resolution.writerContractFingerprint"),
    readerContractFingerprint: validateFingerprint(input.readerContractFingerprint, "resolution.readerContractFingerprint"),
    resolutionFingerprint: validateFingerprint(input.resolutionFingerprint, "resolution.resolutionFingerprint"),
    resolve: input.resolve,
  })
}

function freezeSemanticContract(input: KindSemanticContract): KindSemanticContract {
  return Object.freeze({
    semanticValidatorFingerprint: validateFingerprint(input.semanticValidatorFingerprint, "semanticContract.semanticValidatorFingerprint"),
    referenceProjectionFingerprint: validateFingerprint(input.referenceProjectionFingerprint, "semanticContract.referenceProjectionFingerprint"),
    compilerInputFingerprint: validateFingerprint(input.compilerInputFingerprint, "semanticContract.compilerInputFingerprint"),
  })
}

function sameOwner(left: KindSubjectOwner, right: KindSubjectOwner): boolean {
  return left.kind === right.kind
    && left.subjectFqn === right.subjectFqn
    && left.ownerPackageId === right.ownerPackageId
    && left.ownerPackageFingerprint === right.ownerPackageFingerprint
    && left.sourceContract.sourceContractFingerprint === right.sourceContract.sourceContractFingerprint
}

function validateSourceShape(value: string): KindSourceShape {
  if (value === "single-file" || value === "directory" || value === "manifest") return value
  fail("KIND_SOURCE_CONTRACT_INVALID", `Unknown source shape '${value}'.`)
}

function sameReader(left: KindReaderRegistration, right: KindReaderRegistration): boolean {
  return left.readerId === right.readerId
    && left.subjectFqn === right.subjectFqn
    && left.readerSpecVersion === right.readerSpecVersion
    && left.contractFingerprint === right.contractFingerprint
    && left.readerImplementationFingerprint === right.readerImplementationFingerprint
    && left.compatibilityPolicy === right.compatibilityPolicy
    && left.read === right.read
}

function validateFingerprint(value: string, label: string): Sha256Digest {
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) fail("CONTRACT_FINGERPRINT_INVALID", `${label} must be a lowercase SHA-256 digest.`)
  return value as Sha256Digest
}

function nonEmpty(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) fail("CONTRACT_FIELD_INVALID", `${label} must be a non-empty string.`)
  return value.trim()
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function revisionKey(subjectFqn: string, specVersion: SpecVersion): string {
  return `${subjectFqn}@${specVersion}`
}

function readonlyMap<K, V>(source: Map<K, V>): ReadonlyMap<K, V> {
  const target = new Map(source)
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

function clonePortableSpec(value: PortableSpec): PortableSpec {
  const cloned = cloneJson(value)
  if (!cloned || Array.isArray(cloned) || typeof cloned !== "object") fail("PORTABLE_SPEC_INVALID", "Spec must be a JSON-compatible object.")
  return cloned as PortableSpec
}

function cloneJson(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("PORTABLE_VALUE_INVALID", "Portable values require finite numbers.")
    return value
  }
  if (Array.isArray(value)) return Object.freeze(value.map(cloneJson))
  if (typeof value === "object") {
    const output: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort(compare)) {
      const item = (value as Record<string, unknown>)[key]
      if (item !== undefined) output[key] = cloneJson(item)
    }
    return Object.freeze(output)
  }
  fail("PORTABLE_VALUE_INVALID", `Unsupported portable value type '${typeof value}'.`)
}

function fail(code: string, message: string): never {
  throw new Error(`${code}: ${message}`)
}
