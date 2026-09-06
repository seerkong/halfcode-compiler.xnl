import { describe, expect, test } from "bun:test"
import {
  KindContractRegistry,
  KindReaderRegistry,
  KindWriterRegistry,
  SpecResolutionRegistry,
  createKindContractLock,
  createKindSpecRevision,
  createKindSubjectOwner,
  createReaderProfile,
  resolveSpec,
  type JsonSchemaValidator,
  type PortableSpec,
  type Sha256Digest,
} from "./versioned-contracts"
import {
  CORE_KIND_SPEC_REVISIONS,
  CORE_KIND_SUBJECT_OWNERS,
  CORE_KIND_READER_REGISTRATIONS,
  CORE_RESOURCE_CONTRACT_REGISTRATIONS,
  KIND_DEFINITION_KIND_SPEC_REVISION_V1,
  RESOURCE_PACKAGE_KIND_SPEC_REVISION_V1,
} from "./core-kind-contracts"

const digest = (value: string): Sha256Digest => `sha256:${[...value].map((character) => character.charCodeAt(0).toString(16).padStart(2, "0")).join("").padEnd(64, "0").slice(0, 64)}`
const ownerFingerprint = digest("owner")
const readerV1 = digest("reader-v1")
const readerV2 = digest("reader-v2")
const semanticV1 = Object.freeze({
  semanticValidatorFingerprint: digest("validator-v1"),
  referenceProjectionFingerprint: digest("projection-v1"),
  compilerInputFingerprint: digest("compiler-v1"),
})
const semanticV2 = Object.freeze({
  semanticValidatorFingerprint: digest("validator-v2"),
  referenceProjectionFingerprint: digest("projection-v2"),
  compilerInputFingerprint: digest("compiler-v2"),
})
const demoOwner = createKindSubjectOwner({
  kind: "Demo",
  subjectFqn: "Halfcode.ResourceKind.Demo",
  ownerPackageId: "@halfcode/demo-kind",
  ownerPackageFingerprint: ownerFingerprint,
  sourceShapes: ["single-file"],
})
const revisionV1 = createKindSpecRevision({
  kind: "Demo",
  subjectFqn: "Halfcode.ResourceKind.Demo",
  specVersion: 1,
  specSchema: { type: "object", properties: { title: { type: "string" }, level: { type: "string", default: "intro" } }, required: ["title"] },
  semanticContract: semanticV1,
  sourceContractFingerprint: demoOwner.sourceContract.sourceContractFingerprint,
  stability: "stable",
})
const revisionV2 = createKindSpecRevision({
  kind: "Demo",
  subjectFqn: "Halfcode.ResourceKind.Demo",
  specVersion: 2,
  specSchema: { type: "object", properties: { title: { type: "string" }, slug: { type: "string" } }, required: ["title", "slug"] },
  semanticContract: semanticV2,
  sourceContractFingerprint: demoOwner.sourceContract.sourceContractFingerprint,
  stability: "stable",
})
const contractV1 = revisionV1.contractFingerprint
const contractV2 = revisionV2.contractFingerprint

const validators: JsonSchemaValidator = {
  validate(revision, value) {
    const record = value as Record<string, unknown>
    if (revision.specVersion === 1 && typeof record.title === "string") return Object.freeze([])
    if (revision.specVersion === 2 && typeof record.title === "string" && typeof record.slug === "string") return Object.freeze([])
    return Object.freeze([`invalid-v${revision.specVersion}`])
  },
}

function contracts(): KindContractRegistry {
  return new KindContractRegistry()
    .registerOwner(demoOwner)
    .registerRevision(revisionV1)
    .registerRevision(revisionV2)
}

function readers(): KindReaderRegistry {
  return new KindReaderRegistry()
    .register({
      readerId: "demo.reader.v1",
      subjectFqn: "Halfcode.ResourceKind.Demo",
      readerSpecVersion: 1,
      contractFingerprint: contractV1,
      readerImplementationFingerprint: readerV1,
      compatibilityPolicy: "exact",
      read: (spec) => Object.freeze({ ...spec, reader: "v1" }),
    })
    .register({
      readerId: "demo.reader.v2",
      subjectFqn: "Halfcode.ResourceKind.Demo",
      readerSpecVersion: 2,
      contractFingerprint: contractV2,
      readerImplementationFingerprint: readerV2,
      compatibilityPolicy: "backward-transitive",
      read: (spec) => Object.freeze({ ...spec, reader: "v2" }),
    })
}

function resolutions(): SpecResolutionRegistry {
  return new SpecResolutionRegistry(contracts())
    .register({
      id: "demo.v1-to-v2",
      subjectFqn: "Halfcode.ResourceKind.Demo",
      ownerPackageId: "@halfcode/demo-kind",
      ownerPackageFingerprint: ownerFingerprint,
      writerSpecVersion: 1,
      readerSpecVersion: 2,
      writerContractFingerprint: contractV1,
      readerContractFingerprint: contractV2,
      resolutionFingerprint: digest("v1-to-v2"),
      resolve: (spec) => Object.freeze({ ...spec, slug: String(spec.title).toLowerCase() }),
    })
}

describe("versioned Kind contracts", () => {
  test("publishes immutable compiler-owned core Kind registrations with factory-derived fingerprints", () => {
    expect(CORE_KIND_SUBJECT_OWNERS.map((owner) => owner.subjectFqn)).toEqual([
      "Halfcode.ResourceKind.KindDefinition",
      "Halfcode.ResourceKind.ResourcePackage",
    ])
    expect(CORE_KIND_SPEC_REVISIONS).toEqual([
      KIND_DEFINITION_KIND_SPEC_REVISION_V1,
      RESOURCE_PACKAGE_KIND_SPEC_REVISION_V1,
    ])
    expect(CORE_RESOURCE_CONTRACT_REGISTRATIONS).toEqual({
      owners: CORE_KIND_SUBJECT_OWNERS,
      revisions: CORE_KIND_SPEC_REVISIONS,
      readers: CORE_KIND_READER_REGISTRATIONS,
    })
    expect(Object.isFrozen(CORE_KIND_SUBJECT_OWNERS)).toBe(true)
    expect(Object.isFrozen(RESOURCE_PACKAGE_KIND_SPEC_REVISION_V1.specSchema)).toBe(true)
    expect(CORE_KIND_READER_REGISTRATIONS.every((reader) => reader.compatibilityPolicy === "exact")).toBe(true)
    expect(CORE_KIND_READER_REGISTRATIONS.every((reader) => /^sha256:[0-9a-f]{64}$/u.test(reader.readerImplementationFingerprint))).toBe(true)
    for (const revision of CORE_KIND_SPEC_REVISIONS) {
      const recomputed = createKindSpecRevision({
        kind: revision.kind,
        subjectFqn: revision.subjectFqn,
        specVersion: revision.specVersion,
        specSchema: revision.specSchema,
        semanticContract: revision.semanticContract,
        sourceContractFingerprint: revision.sourceContractFingerprint,
        stability: revision.stability,
      })
      expect(recomputed.schemaFingerprint).toBe(revision.schemaFingerprint)
      expect(recomputed.contractFingerprint).toBe(revision.contractFingerprint)
    }
  })

  test("resolves one writer to two explicit readers without mutating source", () => {
    const source = Object.freeze({ title: "Algebra" })
    const contractRegistry = contracts()
    const readerRegistry = readers()
    const resolutionRegistry = resolutions()

    const exact = resolveSpec({
      resourceId: "demo.algebra",
      kind: "Demo",
      writerSpecVersion: 1,
      authoredSpec: source,
      sourceContentDigest: digest("source"),
      readerProfile: createReaderProfile("reader-v1", [{
        readerId: "demo.reader.v1",
        subjectFqn: "Halfcode.ResourceKind.Demo",
        readerSpecVersion: 1,
        contractFingerprint: contractV1,
        readerImplementationFingerprint: readerV1,
      }]),
      contracts: contractRegistry,
      readers: readerRegistry,
      resolutions: resolutionRegistry,
      validator: validators,
    })
    const upgraded = resolveSpec({
      resourceId: "demo.algebra",
      kind: "Demo",
      writerSpecVersion: 1,
      authoredSpec: source,
      sourceContentDigest: digest("source"),
      readerProfile: createReaderProfile("reader-v2", [{
        readerId: "demo.reader.v2",
        subjectFqn: "Halfcode.ResourceKind.Demo",
        readerSpecVersion: 2,
        contractFingerprint: contractV2,
        readerImplementationFingerprint: readerV2,
      }]),
      contracts: contractRegistry,
      readers: readerRegistry,
      resolutions: resolutionRegistry,
      validator: validators,
    })

    expect(exact.readerValue).toEqual({ title: "Algebra", reader: "v1" })
    expect(upgraded.readerValue).toEqual({ title: "Algebra", slug: "algebra", reader: "v2" })
    expect(exact.receipt.writer.specVersion).toBe(1)
    expect(exact.receipt.reader.specVersion).toBe(1)
    expect(upgraded.receipt.writer.contractFingerprint).toBe(contractV1)
    expect(upgraded.receipt.reader.contractFingerprint).toBe(contractV2)
    expect(upgraded.receipt.reader.implementationFingerprint).toBe(readerV2)
    expect(upgraded.receipt.path.map((step) => step.resolutionId)).toEqual(["demo.v1-to-v2"])
    expect(upgraded.effectiveContentDigest).not.toBe(exact.effectiveContentDigest)
    expect(source).toEqual({ title: "Algebra" })
  })

  test("validates writer, every edge target, and final reader schema", () => {
    const visits: number[] = []
    const validator: JsonSchemaValidator = {
      validate(revision, value) {
        visits.push(revision.specVersion)
        return validators.validate(revision, value)
      },
    }
    resolveSpec({
      resourceId: "demo.validation",
      kind: "Demo",
      writerSpecVersion: 1,
      authoredSpec: Object.freeze({ title: "Geometry" }),
      sourceContentDigest: digest("validation"),
      readerProfile: createReaderProfile("reader-v2", [{
        readerId: "demo.reader.v2",
        subjectFqn: "Halfcode.ResourceKind.Demo",
        readerSpecVersion: 2,
        contractFingerprint: contractV2,
        readerImplementationFingerprint: readerV2,
      }]),
      contracts: contracts(),
      readers: readers(),
      resolutions: resolutions(),
      validator,
    })
    expect(visits).toEqual([1, 2, 2])
  })

  test("binds admitted writer contract facts into effective content identity", () => {
    const changedWriter = createKindSpecRevision({
      kind: "Demo",
      subjectFqn: "Halfcode.ResourceKind.Demo",
      specVersion: 1,
      specSchema: revisionV1.specSchema,
      semanticContract: { ...semanticV1, semanticValidatorFingerprint: digest("changed-writer-validator") },
      sourceContractFingerprint: demoOwner.sourceContract.sourceContractFingerprint,
      stability: "stable",
    })
    const changedContracts = new KindContractRegistry()
      .registerOwner(demoOwner)
      .registerRevision(changedWriter)
      .registerRevision(revisionV2)
    const changedResolutions = new SpecResolutionRegistry(changedContracts).register({
      id: "demo.v1-to-v2",
      subjectFqn: "Halfcode.ResourceKind.Demo",
      ownerPackageId: "@halfcode/demo-kind",
      ownerPackageFingerprint: ownerFingerprint,
      writerSpecVersion: 1,
      readerSpecVersion: 2,
      writerContractFingerprint: changedWriter.contractFingerprint,
      readerContractFingerprint: contractV2,
      resolutionFingerprint: digest("v1-to-v2"),
      resolve: (spec) => Object.freeze({ ...spec, slug: String(spec.title).toLowerCase() }),
    })
    const input = {
      resourceId: "demo.writer-identity",
      kind: "Demo",
      writerSpecVersion: 1,
      authoredSpec: Object.freeze({ title: "Identity" }),
      sourceContentDigest: digest("same-source-bytes"),
      readerProfile: createReaderProfile("reader-v2", [{
        readerId: "demo.reader.v2",
        subjectFqn: "Halfcode.ResourceKind.Demo",
        readerSpecVersion: 2,
        contractFingerprint: contractV2,
        readerImplementationFingerprint: readerV2,
      }]),
      readers: readers(),
      validator: validators,
    } as const
    const baseline = resolveSpec({ ...input, contracts: contracts(), resolutions: resolutions() })
    const changed = resolveSpec({ ...input, contracts: changedContracts, resolutions: changedResolutions })

    expect(changed.resolvedSpec).toEqual(baseline.resolvedSpec)
    expect(changed.receipt.reader).toEqual(baseline.receipt.reader)
    expect(changed.receipt.path).toEqual(baseline.receipt.path)
    expect(changed.receipt.writer.contractFingerprint).not.toBe(baseline.receipt.writer.contractFingerprint)
    expect(changed.effectiveContentDigest).not.toBe(baseline.effectiveContentDigest)
  })

  test("fails closed for owner, revision, reader, and graph conflicts", () => {
    const contractRegistry = contracts()
    expect(() => contractRegistry.registerOwner(createKindSubjectOwner({
      kind: "Demo",
      subjectFqn: "Other.Demo",
      ownerPackageId: "@other/demo-kind",
      ownerPackageFingerprint: digest("other-owner"),
      sourceShapes: ["single-file"],
    }))).toThrow("KIND_SUBJECT_OWNER_CONFLICT")
    const changedRevision = createKindSpecRevision({
      kind: "Demo",
      subjectFqn: "Halfcode.ResourceKind.Demo",
      specVersion: 1,
      specSchema: revisionV1.specSchema,
      semanticContract: { ...semanticV1, compilerInputFingerprint: digest("changed-compiler") },
      sourceContractFingerprint: demoOwner.sourceContract.sourceContractFingerprint,
      stability: "stable",
    })
    expect(() => contractRegistry.registerRevision(changedRevision)).toThrow("KIND_SPEC_CONTRACT_CONFLICT")
    expect(() => contracts().registerRevision({ ...revisionV1, schemaFingerprint: digest("forged-schema") })).toThrow("KIND_SPEC_FINGERPRINT_MISMATCH")

    const writer = new KindWriterRegistry(contractRegistry).register({
      subjectFqn: "Halfcode.ResourceKind.Demo",
      writerSpecVersion: 1,
      contractFingerprint: contractV1,
      write: (input: { title: string }) => Object.freeze({ title: input.title }),
    })
    expect(writer.require("Halfcode.ResourceKind.Demo", 1).contractFingerprint).toBe(contractV1)
    expect(() => new KindWriterRegistry(contractRegistry).register({
      subjectFqn: "Halfcode.ResourceKind.Demo",
      writerSpecVersion: 1,
      contractFingerprint: digest("wrong-writer-contract"),
      write: () => Object.freeze({ title: "wrong" }),
    })).toThrow("KIND_WRITER_CONTRACT_MISMATCH")

    const readerRegistry = readers()
    expect(() => readerRegistry.require({
      readerId: "demo.reader.v2",
      subjectFqn: "Halfcode.ResourceKind.Demo",
      readerSpecVersion: 2,
      contractFingerprint: contractV2,
      readerImplementationFingerprint: digest("wrong-reader"),
    })).toThrow("KIND_READER_FINGERPRINT_MISMATCH")

    expect(() => new SpecResolutionRegistry(contractRegistry).register({
      id: "untrusted",
      subjectFqn: "Halfcode.ResourceKind.Demo",
      ownerPackageId: "@other/demo-kind",
      ownerPackageFingerprint: digest("other-owner"),
      writerSpecVersion: 1,
      readerSpecVersion: 2,
      writerContractFingerprint: contractV1,
      readerContractFingerprint: contractV2,
      resolutionFingerprint: digest("untrusted"),
      resolve: (spec) => spec,
    })).toThrow("SPEC_RESOLUTION_OWNER_NOT_ADMITTED")

    expect(() => resolutions().register({
      id: "demo.v1-to-v2.alternate",
      subjectFqn: "Halfcode.ResourceKind.Demo",
      ownerPackageId: "@halfcode/demo-kind",
      ownerPackageFingerprint: ownerFingerprint,
      writerSpecVersion: 1,
      readerSpecVersion: 2,
      writerContractFingerprint: contractV1,
      readerContractFingerprint: contractV2,
      resolutionFingerprint: digest("alternate"),
      resolve: (spec) => Object.freeze({ ...spec, slug: "alternate" }),
    })).toThrow("SPEC_RESOLUTION_EDGE_CONFLICT")

    const revisionV3 = createKindSpecRevision({
      kind: "Demo",
      subjectFqn: "Halfcode.ResourceKind.Demo",
      specVersion: 3,
      specSchema: { type: "object", required: ["title", "slug"] },
      semanticContract: { ...semanticV2, compilerInputFingerprint: digest("compiler-v3") },
      sourceContractFingerprint: demoOwner.sourceContract.sourceContractFingerprint,
      stability: "experimental",
    })
    const branchingContracts = contracts().registerRevision(revisionV3)
    const ambiguous = new SpecResolutionRegistry(branchingContracts)
      .register({
        id: "direct-v1-v2",
        subjectFqn: "Halfcode.ResourceKind.Demo",
        ownerPackageId: "@halfcode/demo-kind",
        ownerPackageFingerprint: ownerFingerprint,
        writerSpecVersion: 1,
        readerSpecVersion: 2,
        writerContractFingerprint: contractV1,
        readerContractFingerprint: contractV2,
        resolutionFingerprint: digest("direct"),
        resolve: (spec) => Object.freeze({ ...spec, slug: "direct" }),
      })
      .register({
        id: "branch-v1-v3",
        subjectFqn: "Halfcode.ResourceKind.Demo",
        ownerPackageId: "@halfcode/demo-kind",
        ownerPackageFingerprint: ownerFingerprint,
        writerSpecVersion: 1,
        readerSpecVersion: 3,
        writerContractFingerprint: contractV1,
        readerContractFingerprint: revisionV3.contractFingerprint,
        resolutionFingerprint: digest("branch"),
        resolve: (spec) => Object.freeze({ ...spec, slug: "branch" }),
      })
      .register({
        id: "branch-v3-v2",
        subjectFqn: "Halfcode.ResourceKind.Demo",
        ownerPackageId: "@halfcode/demo-kind",
        ownerPackageFingerprint: ownerFingerprint,
        writerSpecVersion: 3,
        readerSpecVersion: 2,
        writerContractFingerprint: revisionV3.contractFingerprint,
        readerContractFingerprint: contractV2,
        resolutionFingerprint: digest("merge"),
        resolve: (spec) => spec,
      })
    expect(() => ambiguous.plan("Halfcode.ResourceKind.Demo", 1, 2)).toThrow("SPEC_RESOLUTION_PATH_AMBIGUOUS")
  })

  test("requires a new spec revision identity when the declarative source contract changes", () => {
    const expandedOwner = createKindSubjectOwner({
      kind: "Demo",
      subjectFqn: "Halfcode.ResourceKind.Demo",
      ownerPackageId: "@halfcode/demo-kind",
      ownerPackageFingerprint: ownerFingerprint,
      sourceShapes: ["single-file", "directory"],
    })
    const expandedRevisionV1 = createKindSpecRevision({
      kind: "Demo",
      subjectFqn: "Halfcode.ResourceKind.Demo",
      specVersion: 1,
      specSchema: revisionV1.specSchema,
      semanticContract: revisionV1.semanticContract,
      sourceContractFingerprint: expandedOwner.sourceContract.sourceContractFingerprint,
      stability: revisionV1.stability,
    })

    expect(expandedRevisionV1.contractFingerprint).not.toBe(revisionV1.contractFingerprint)
    expect(() => new KindContractRegistry().registerOwner(expandedOwner).registerRevision(revisionV1)).toThrow(
      "KIND_SPEC_SOURCE_CONTRACT_MISMATCH",
    )
  })

  test("fails closed for missing targets, invalid intermediate specs, and cycles", () => {
    const profile = createReaderProfile("missing", [])
    expect(() => profile.readerFor("Halfcode.ResourceKind.Demo")).toThrow("KIND_READER_TARGET_MISSING")

    const badResolution = new SpecResolutionRegistry(contracts()).register({
      id: "bad-v1-to-v2",
      subjectFqn: "Halfcode.ResourceKind.Demo",
      ownerPackageId: "@halfcode/demo-kind",
      ownerPackageFingerprint: ownerFingerprint,
      writerSpecVersion: 1,
      readerSpecVersion: 2,
      writerContractFingerprint: contractV1,
      readerContractFingerprint: contractV2,
      resolutionFingerprint: digest("bad"),
      resolve: (spec) => spec,
    })
    expect(() => resolveSpec({
      resourceId: "demo.invalid",
      kind: "Demo",
      writerSpecVersion: 1,
      authoredSpec: Object.freeze({ title: "Invalid" }),
      sourceContentDigest: digest("invalid"),
      readerProfile: createReaderProfile("reader-v2", [{
        readerId: "demo.reader.v2",
        subjectFqn: "Halfcode.ResourceKind.Demo",
        readerSpecVersion: 2,
        contractFingerprint: contractV2,
        readerImplementationFingerprint: readerV2,
      }]),
      contracts: contracts(),
      readers: readers(),
      resolutions: badResolution,
      validator: validators,
    })).toThrow("SPEC_RESOLUTION_TARGET_SCHEMA_INVALID")

    const cyclic = resolutions().register({
      id: "demo.v2-to-v1",
      subjectFqn: "Halfcode.ResourceKind.Demo",
      ownerPackageId: "@halfcode/demo-kind",
      ownerPackageFingerprint: ownerFingerprint,
      writerSpecVersion: 2,
      readerSpecVersion: 1,
      writerContractFingerprint: contractV2,
      readerContractFingerprint: contractV1,
      resolutionFingerprint: digest("v2-to-v1"),
      resolve: (spec) => Object.freeze({ title: spec.title }),
    })
    expect(() => cyclic.validateGraph()).toThrow("SPEC_RESOLUTION_GRAPH_CYCLIC")
    expect(() => new SpecResolutionRegistry(contracts()).plan("Halfcode.ResourceKind.Demo", 1, 2)).toThrow("SPEC_RESOLUTION_PATH_MISSING")
  })

  test("does not materialize JSON Schema defaults and produces a deterministic lock", () => {
    const source: PortableSpec = Object.freeze({ title: "Calculus" })
    const profile = createReaderProfile("reader-v1", [{
      readerId: "demo.reader.v1",
      subjectFqn: "Halfcode.ResourceKind.Demo",
      readerSpecVersion: 1,
      contractFingerprint: contractV1,
      readerImplementationFingerprint: readerV1,
    }])
    resolveSpec({
      resourceId: "demo.defaults",
      kind: "Demo",
      writerSpecVersion: 1,
      authoredSpec: source,
      sourceContentDigest: digest("defaults"),
      readerProfile: profile,
      contracts: contracts(),
      readers: readers(),
      resolutions: resolutions(),
      validator: { validate: () => Object.freeze([]) },
    })
    expect(source).toEqual({ title: "Calculus" })

    const first = createKindContractLock({
      envelopeVersion: "halfcode.resource-envelope/v1",
      envelopeFingerprint: digest("envelope"),
      contracts: contracts(),
      readerProfile: profile,
      readers: readers(),
      resolutions: resolutions(),
    })
    const second = createKindContractLock({
      envelopeVersion: "halfcode.resource-envelope/v1",
      envelopeFingerprint: digest("envelope"),
      contracts: contracts(),
      readerProfile: profile,
      readers: readers(),
      resolutions: resolutions(),
    })
    expect(first.lockDigest).toBe(second.lockDigest)
  })

  test("includes the admitted compatibility policy in Kind lock identity", () => {
    const profile = createReaderProfile("reader-v1", [{
      readerId: "demo.reader.v1",
      subjectFqn: "Halfcode.ResourceKind.Demo",
      readerSpecVersion: 1,
      contractFingerprint: contractV1,
      readerImplementationFingerprint: readerV1,
    }])
    const exactLock = createKindContractLock({
      envelopeVersion: "halfcode.resource-envelope/v1",
      envelopeFingerprint: digest("envelope"),
      contracts: contracts(),
      readerProfile: profile,
      readers: readers(),
      resolutions: resolutions(),
    })
    const backwardReaders = new KindReaderRegistry().register({
      readerId: "demo.reader.v1",
      subjectFqn: "Halfcode.ResourceKind.Demo",
      readerSpecVersion: 1,
      contractFingerprint: contractV1,
      readerImplementationFingerprint: readerV1,
      compatibilityPolicy: "backward",
      read: (spec) => spec,
    })
    const backwardLock = createKindContractLock({
      envelopeVersion: "halfcode.resource-envelope/v1",
      envelopeFingerprint: digest("envelope"),
      contracts: contracts(),
      readerProfile: profile,
      readers: backwardReaders,
      resolutions: resolutions(),
    })

    expect(exactLock.readers[0]?.compatibilityPolicy).toBe("exact")
    expect(backwardLock.readers[0]?.compatibilityPolicy).toBe("backward")
    expect(backwardLock.lockDigest).not.toBe(exactLock.lockDigest)
  })

  test.each(["backward", "backward-transitive"] as const)(
    "rejects a newer writer for the %s reader policy even when a reverse resolution is registered",
    (compatibilityPolicy) => {
      const readerRegistry = new KindReaderRegistry().register({
        readerId: "demo.reader.v1",
        subjectFqn: "Halfcode.ResourceKind.Demo",
        readerSpecVersion: 1,
        contractFingerprint: contractV1,
        readerImplementationFingerprint: readerV1,
        compatibilityPolicy,
        read: (spec) => spec,
      })
      const reverseSourceResolution = new SpecResolutionRegistry(contracts()).register({
        id: "demo.v2-to-v1.source-migration",
        subjectFqn: "Halfcode.ResourceKind.Demo",
        ownerPackageId: "@halfcode/demo-kind",
        ownerPackageFingerprint: ownerFingerprint,
        writerSpecVersion: 2,
        readerSpecVersion: 1,
        writerContractFingerprint: contractV2,
        readerContractFingerprint: contractV1,
        resolutionFingerprint: digest("v2-to-v1-source-migration"),
        resolve: (spec) => Object.freeze({ title: spec.title }),
      })

      expect(() => resolveSpec({
        resourceId: "demo.future-writer",
        kind: "Demo",
        writerSpecVersion: 2,
        authoredSpec: Object.freeze({ title: "Future", slug: "future" }),
        sourceContentDigest: digest("future-writer"),
        readerProfile: createReaderProfile("reader-v1", [{
          readerId: "demo.reader.v1",
          subjectFqn: "Halfcode.ResourceKind.Demo",
          readerSpecVersion: 1,
          contractFingerprint: contractV1,
          readerImplementationFingerprint: readerV1,
        }]),
        contracts: contracts(),
        readers: readerRegistry,
        resolutions: reverseSourceResolution,
        validator: validators,
      })).toThrow("KIND_READER_FORWARD_VERSION_UNSUPPORTED")
    },
  )

  test("checks backward-transitive coverage against every older registered writer", () => {
    const reader = readers().require({
      readerId: "demo.reader.v2",
      subjectFqn: "Halfcode.ResourceKind.Demo",
      readerSpecVersion: 2,
      contractFingerprint: contractV2,
      readerImplementationFingerprint: readerV2,
    })
    expect(() => resolutions().validateReaderCompatibility(reader)).not.toThrow()
    expect(() => new SpecResolutionRegistry(contracts()).validateReaderCompatibility(reader)).toThrow("SPEC_RESOLUTION_PATH_MISSING")
  })
})
