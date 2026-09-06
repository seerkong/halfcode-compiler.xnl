import {
  CORE_BOOTSTRAP_WRITER_SPEC_VERSIONS,
  digestCanonical,
  type JsonSchema,
  type KindReaderRegistration,
  type PortableSpec,
  type KindSemanticContract,
  type KindSpecRevision,
  type KindSubjectOwner,
} from "halfcode-compiler-resource-core"
import { createKindSpecRevision, createKindSubjectOwner } from "./versioned-contracts"

const CORE_KIND_OWNER_PACKAGE_ID = "halfcode-compiler.xnl"
const CORE_KIND_OWNER_PACKAGE_FINGERPRINT = digestCanonical(Object.freeze({
  authority: "halfcode-compiler.xnl/core-kind-contracts/v1",
  ownerPackageId: CORE_KIND_OWNER_PACKAGE_ID,
  subjects: Object.freeze([
    "Halfcode.ResourceKind.KindDefinition",
    "Halfcode.ResourceKind.ResourcePackage",
  ]),
}))

export const RESOURCE_PACKAGE_KIND_OWNER: KindSubjectOwner = createKindSubjectOwner({
  kind: "ResourcePackage",
  subjectFqn: "Halfcode.ResourceKind.ResourcePackage",
  ownerPackageId: CORE_KIND_OWNER_PACKAGE_ID,
  ownerPackageFingerprint: CORE_KIND_OWNER_PACKAGE_FINGERPRINT,
  sourceShapes: Object.freeze(["manifest"]),
  documentCardinality: "one",
})

export const KIND_DEFINITION_KIND_OWNER: KindSubjectOwner = createKindSubjectOwner({
  kind: "KindDefinition",
  subjectFqn: "Halfcode.ResourceKind.KindDefinition",
  ownerPackageId: CORE_KIND_OWNER_PACKAGE_ID,
  ownerPackageFingerprint: CORE_KIND_OWNER_PACKAGE_FINGERPRINT,
  sourceShapes: Object.freeze(["single-file", "directory"]),
  documentCardinality: "one",
})

const AUTHORED_SPEC_PROPERTIES = Object.freeze({
  properties: Object.freeze({ type: "object" }),
  body: Object.freeze({ type: "array" }),
  subdomains: Object.freeze({ type: "object" }),
  text: Object.freeze({ type: "string" }),
})

export const RESOURCE_PACKAGE_SPEC_SCHEMA_V1: JsonSchema = Object.freeze({
  type: "object",
  required: Object.freeze(["properties", "body", "subdomains"]),
  properties: Object.freeze({
    ...AUTHORED_SPEC_PROPERTIES,
    subdomains: Object.freeze({
      type: "object",
      required: Object.freeze(["Catalogs"]),
    }),
  }),
  additionalProperties: false,
})

export const KIND_DEFINITION_SPEC_SCHEMA_V1: JsonSchema = Object.freeze({
  type: "object",
  required: Object.freeze(["properties", "body", "subdomains"]),
  properties: Object.freeze({
    ...AUTHORED_SPEC_PROPERTIES,
    properties: Object.freeze({
      type: "object",
      required: Object.freeze(["resourceKind", "subjectFqn", "sourceShapes"]),
      properties: Object.freeze({
        resourceKind: Object.freeze({ type: "string", minLength: 1 }),
        subjectFqn: Object.freeze({ type: "string", minLength: 1 }),
        sourceShapes: Object.freeze({
          type: "array",
          minItems: 1,
          items: Object.freeze({ enum: Object.freeze(["single-file", "directory", "manifest"]) }),
        }),
        documentCardinality: Object.freeze({ enum: Object.freeze(["one", "many"]) }),
      }),
    }),
    subdomains: Object.freeze({
      type: "object",
      required: Object.freeze(["SpecRevisions"]),
    }),
  }),
  additionalProperties: false,
})

function coreSemanticContract(kind: "ResourcePackage" | "KindDefinition"): KindSemanticContract {
  return Object.freeze({
    semanticValidatorFingerprint: digestCanonical(Object.freeze({
      authority: "halfcode-compiler.xnl/core-kind-contracts/v1",
      kind,
      role: "bootstrap-structural-admission",
    })),
    referenceProjectionFingerprint: digestCanonical(Object.freeze({
      authority: "halfcode-compiler.xnl/core-kind-contracts/v1",
      kind,
      role: kind === "ResourcePackage" ? "catalog-reference-projection" : "spec-revision-reference-projection",
    })),
    compilerInputFingerprint: digestCanonical(Object.freeze({
      authority: "halfcode-compiler.xnl/core-kind-contracts/v1",
      kind,
      role: "authored-spec-envelope-projection",
      fields: Object.freeze(["properties", "body", "subdomains", "text"]),
    })),
  })
}

export const RESOURCE_PACKAGE_KIND_SPEC_REVISION_V1: KindSpecRevision = createKindSpecRevision({
  kind: RESOURCE_PACKAGE_KIND_OWNER.kind,
  subjectFqn: RESOURCE_PACKAGE_KIND_OWNER.subjectFqn,
  specVersion: CORE_BOOTSTRAP_WRITER_SPEC_VERSIONS.ResourcePackage,
  specSchema: RESOURCE_PACKAGE_SPEC_SCHEMA_V1,
  semanticContract: coreSemanticContract("ResourcePackage"),
  sourceContractFingerprint: RESOURCE_PACKAGE_KIND_OWNER.sourceContract.sourceContractFingerprint,
  stability: "stable",
})

export const KIND_DEFINITION_KIND_SPEC_REVISION_V1: KindSpecRevision = createKindSpecRevision({
  kind: KIND_DEFINITION_KIND_OWNER.kind,
  subjectFqn: KIND_DEFINITION_KIND_OWNER.subjectFqn,
  specVersion: CORE_BOOTSTRAP_WRITER_SPEC_VERSIONS.KindDefinition,
  specSchema: KIND_DEFINITION_SPEC_SCHEMA_V1,
  semanticContract: coreSemanticContract("KindDefinition"),
  sourceContractFingerprint: KIND_DEFINITION_KIND_OWNER.sourceContract.sourceContractFingerprint,
  stability: "stable",
})

export const CORE_KIND_SUBJECT_OWNERS = Object.freeze([
  KIND_DEFINITION_KIND_OWNER,
  RESOURCE_PACKAGE_KIND_OWNER,
] as const)

export const CORE_KIND_SPEC_REVISIONS = Object.freeze([
  KIND_DEFINITION_KIND_SPEC_REVISION_V1,
  RESOURCE_PACKAGE_KIND_SPEC_REVISION_V1,
] as const)

function coreReaderRegistration(
  readerId: string,
  revision: KindSpecRevision,
): KindReaderRegistration<PortableSpec> {
  return Object.freeze({
    readerId,
    subjectFqn: revision.subjectFqn,
    readerSpecVersion: revision.specVersion,
    contractFingerprint: revision.contractFingerprint,
    readerImplementationFingerprint: digestCanonical(Object.freeze({
      authority: "halfcode-compiler.xnl/core-kind-contracts/v1",
      readerId,
      subjectFqn: revision.subjectFqn,
      readerSpecVersion: revision.specVersion,
      operation: "identity-read-of-validated-authored-spec",
    })),
    compatibilityPolicy: "exact",
    read: (spec: PortableSpec) => spec,
  })
}

export const KIND_DEFINITION_KIND_READER_REGISTRATION_V1 = coreReaderRegistration(
  "halfcode.compiler.kind-definition.reader.v1",
  KIND_DEFINITION_KIND_SPEC_REVISION_V1,
)

export const RESOURCE_PACKAGE_KIND_READER_REGISTRATION_V1 = coreReaderRegistration(
  "halfcode.compiler.resource-package.reader.v1",
  RESOURCE_PACKAGE_KIND_SPEC_REVISION_V1,
)

export const CORE_KIND_READER_REGISTRATIONS = Object.freeze([
  KIND_DEFINITION_KIND_READER_REGISTRATION_V1,
  RESOURCE_PACKAGE_KIND_READER_REGISTRATION_V1,
] as const)

export const CORE_RESOURCE_CONTRACT_REGISTRATIONS = Object.freeze({
  owners: CORE_KIND_SUBJECT_OWNERS,
  revisions: CORE_KIND_SPEC_REVISIONS,
  readers: CORE_KIND_READER_REGISTRATIONS,
})
