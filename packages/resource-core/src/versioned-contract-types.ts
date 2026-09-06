import type { Sha256Digest } from "./dependency-snapshot"
import type { SpecVersion } from "./resource-version-contracts"

export type JsonSchema = boolean | Readonly<Record<string, unknown>>
export type PortableValue = string | number | boolean | null | PortableSpec | readonly PortableValue[]
export interface PortableSpec extends Readonly<Record<string, unknown>> {}
export type CompatibilityPolicy = "exact" | "backward" | "backward-transitive"
export type KindSourceShape = "single-file" | "directory" | "manifest"

export interface KindSourceContract {
  readonly sourceShapes: readonly KindSourceShape[]
  readonly documentCardinality: "one" | "many"
  readonly requiredFiles: readonly string[]
  readonly sourceContractFingerprint: Sha256Digest
}

export interface KindSubjectOwner {
  readonly kind: string
  readonly subjectFqn: string
  readonly ownerPackageId: string
  readonly ownerPackageFingerprint: Sha256Digest
  readonly sourceContract: KindSourceContract
}

export interface KindSemanticContract {
  readonly semanticValidatorFingerprint: Sha256Digest
  readonly referenceProjectionFingerprint: Sha256Digest
  readonly compilerInputFingerprint: Sha256Digest
}

export interface KindSpecRevision {
  readonly kind: string
  readonly subjectFqn: string
  readonly specVersion: SpecVersion
  readonly specSchema: JsonSchema
  readonly semanticContract: KindSemanticContract
  readonly sourceContractFingerprint: Sha256Digest
  readonly schemaFingerprint: Sha256Digest
  readonly contractFingerprint: Sha256Digest
  readonly stability: "experimental" | "stable" | "deprecated"
}

export interface KindWriterRegistration<Input = unknown> {
  readonly subjectFqn: string
  readonly writerSpecVersion: SpecVersion
  readonly contractFingerprint: Sha256Digest
  readonly write: (input: Input) => PortableSpec
}

export interface KindReaderRegistration<Output = unknown> {
  readonly readerId: string
  readonly subjectFqn: string
  readonly readerSpecVersion: SpecVersion
  readonly contractFingerprint: Sha256Digest
  readonly readerImplementationFingerprint: Sha256Digest
  readonly compatibilityPolicy: CompatibilityPolicy
  readonly read: (spec: PortableSpec) => Output
}

export interface ReaderTarget {
  readonly readerId: string
  readonly subjectFqn: string
  readonly readerSpecVersion: SpecVersion
  readonly contractFingerprint: Sha256Digest
  readonly readerImplementationFingerprint: Sha256Digest
}

export interface KindContractLockReader extends ReaderTarget {
  readonly compatibilityPolicy: CompatibilityPolicy
}

export interface ReaderProfile {
  readonly profileId: string
  readonly readers: ReadonlyMap<string, ReaderTarget>
  readerFor(subjectFqn: string): ReaderTarget
}

export interface SpecResolutionDefinition {
  readonly id: string
  readonly subjectFqn: string
  readonly ownerPackageId: string
  readonly ownerPackageFingerprint: Sha256Digest
  readonly writerSpecVersion: SpecVersion
  readonly readerSpecVersion: SpecVersion
  readonly writerContractFingerprint: Sha256Digest
  readonly readerContractFingerprint: Sha256Digest
  readonly resolutionFingerprint: Sha256Digest
  readonly resolve: (writerSpec: PortableSpec) => PortableSpec
}

export interface JsonSchemaValidator {
  validate(revision: KindSpecRevision, value: PortableSpec): readonly string[]
}

export interface ResourceResolutionReceipt {
  readonly resourceId: string
  readonly subjectFqn: string
  readonly sourceContentDigest: Sha256Digest
  readonly writer: Readonly<{
    specVersion: SpecVersion
    schemaFingerprint: Sha256Digest
    contractFingerprint: Sha256Digest
    sourceContractFingerprint: Sha256Digest
  }>
  readonly reader: Readonly<{
    readerId: string
    specVersion: SpecVersion
    schemaFingerprint: Sha256Digest
    contractFingerprint: Sha256Digest
    implementationFingerprint: Sha256Digest
    sourceContractFingerprint: Sha256Digest
  }>
  readonly path: readonly Readonly<{
    resolutionId: string
    resolutionFingerprint: Sha256Digest
  }>[]
  readonly resolvedSpecDigest: Sha256Digest
}

export interface ResolvedSpec<Output = unknown> {
  readonly resolvedSpec: PortableSpec
  readonly readerValue: Output
  readonly receipt: ResourceResolutionReceipt
  readonly effectiveContentDigest: Sha256Digest
}

export interface KindContractLock {
  readonly envelopeVersion: string
  readonly envelopeFingerprint: Sha256Digest
  readonly owners: readonly KindSubjectOwner[]
  readonly readers: readonly KindContractLockReader[]
  readonly revisions: readonly Readonly<{
    subjectFqn: string
    specVersion: SpecVersion
    schemaFingerprint: Sha256Digest
    contractFingerprint: Sha256Digest
    ownerPackageId: string
    ownerPackageFingerprint: Sha256Digest
    sourceContractFingerprint: Sha256Digest
  }>[]
  readonly resolutions: readonly Readonly<{
    resolutionId: string
    subjectFqn: string
    writerSpecVersion: SpecVersion
    readerSpecVersion: SpecVersion
    resolutionFingerprint: Sha256Digest
  }>[]
  readonly lockDigest: Sha256Digest
}
