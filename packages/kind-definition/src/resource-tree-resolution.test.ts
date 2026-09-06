import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  loadResourceTree,
  type JsonSchemaValidator,
  type PortableSpec,
  type Sha256Digest,
} from "halfcode-compiler-resource-core"
import {
  KindContractRegistry,
  KindReaderRegistry,
  SpecResolutionRegistry,
  createKindSpecRevision,
  createKindSubjectOwner,
  createReaderProfile,
} from "./versioned-contracts"
import {
  CORE_KIND_READER_REGISTRATIONS,
  CORE_KIND_SPEC_REVISIONS,
  CORE_KIND_SUBJECT_OWNERS,
} from "./core-kind-contracts"
import { resolveResourceTree } from "./resource-tree-resolution"

const roots = new Set<string>()
const digest = (value: string): Sha256Digest => `sha256:${[...value].map((character) => character.charCodeAt(0).toString(16).padStart(2, "0")).join("").padEnd(64, "0").slice(0, 64)}`
const ownerFingerprint = digest("owner")
const semantics = Object.freeze({
  semanticValidatorFingerprint: digest("validator"),
  referenceProjectionFingerprint: digest("projection"),
  compilerInputFingerprint: digest("compiler"),
})
const noteOwner = createKindSubjectOwner({
  kind: "Note",
  subjectFqn: "Halfcode.ResourceKind.Note",
  ownerPackageId: "demo-note-kind",
  ownerPackageFingerprint: ownerFingerprint,
  sourceShapes: ["single-file"],
})
const noteV1 = createKindSpecRevision({
  kind: "Note",
  subjectFqn: "Halfcode.ResourceKind.Note",
  specVersion: 1,
  specSchema: { type: "object" },
  semanticContract: semantics,
  sourceContractFingerprint: noteOwner.sourceContract.sourceContractFingerprint,
  stability: "stable",
})
const noteV2 = createKindSpecRevision({
  kind: "Note",
  subjectFqn: "Halfcode.ResourceKind.Note",
  specVersion: 2,
  specSchema: { type: "object" },
  semanticContract: { ...semantics, compilerInputFingerprint: digest("compiler-v2") },
  sourceContractFingerprint: noteOwner.sourceContract.sourceContractFingerprint,
  stability: "stable",
})

afterEach(async () => {
  const pending = [...roots]
  roots.clear()
  await Promise.all(pending.map((root) => rm(root, { recursive: true, force: true })))
})

describe("resolved resource tree", () => {
  test("publishes a reader tree with auditable receipts without changing authored source", async () => {
    const source = await loadResourceTree({ rootDir: await fixture() })
    const authored = source.registry.byKind.get("Note")?.[0]
    const resolved = resolveResourceTree({
      tree: source,
      ...registrations(),
      validator,
    })

    expect(resolved.stage).toBe("resolved")
    expect(resolved.source).toBe(source)
    expect(resolved.readerProfileId).toBe("host-v2")
    expect(resolved.receipts).toHaveLength(3)
    const definition = resolved.registry.byKind.get("KindDefinition")?.[0]
    expect(definition?.stage).toBe("resolved")
    expect(definition?.subjectFqn).toBe("Halfcode.ResourceKind.KindDefinition")
    expect(definition?.resolution.writer.specVersion).toBe(1)
    expect(definition?.resolution.reader.specVersion).toBe(1)
    expect(definition?.resolution.path).toEqual([])
    const note = resolved.registry.byKind.get("Note")?.[0]
    expect(note?.stage).toBe("resolved")
    expect(note?.resolution.writer.specVersion).toBe(1)
    expect(note?.resolution.reader.specVersion).toBe(2)
    expect(note?.resolution.path.map((step) => step.resolutionId)).toEqual(["note.v1-to-v2"])
    expect(note?.node.properties).toEqual({ description: "Authored note", slug: "authored-note" })
    expect(note?.effectiveContentDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(authored?.metadata.specVersion).toBe(1)
    expect(authored?.node.properties).toEqual({ description: "Authored note" })
  })

  test("fails before publishing a partial reader tree when final reader validation fails", async () => {
    const source = await loadResourceTree({ rootDir: await fixture() })
    let validationCalls = 0
    let noteV2Calls = 0
    expect(() => resolveResourceTree({
      tree: source,
      ...registrations(),
      validator: {
        validate(revision, value) {
          validationCalls += 1
          if (revision.subjectFqn === noteV2.subjectFqn && revision.specVersion === 2) {
            noteV2Calls += 1
            if (noteV2Calls === 2) return ["reader rejected"]
          }
          return validator.validate(revision, value)
        },
      },
    })).toThrow("READER_SCHEMA_INVALID")
    expect(validationCalls).toBeGreaterThan(0)
  })

  test("rejects descriptive KindDefinition fingerprints that differ from admitted revisions", async () => {
    const source = await loadResourceTree({ rootDir: await fixture({ forgedContract: true }) })
    expect(() => resolveResourceTree({ tree: source, ...registrations(), validator })).toThrow("KIND_DEFINITION_REVISION_MISMATCH")
  })

  test.each([
    ["sourceShapes expansion", { sourceShapes: '["single-file" "directory"]' }],
    ["requiredFiles expansion", { requiredFile: "Support.txt" }],
  ])("rejects %s even when every claimed SpecRevision fingerprint is unchanged", async (_label, options) => {
    const source = await loadResourceTree({ rootDir: await fixture(options) })
    expect(() => resolveResourceTree({ tree: source, ...registrations(), validator })).toThrow(
      "KIND_DEFINITION_SOURCE_CONTRACT_MISMATCH",
    )
  })

  test("carries canonical Markdown body text from authored source into the resolved node", async () => {
    const source = await loadResourceTree({ rootDir: await fixture({ markdownBody: "First.\r\nSecond.\r\n" }) })
    const authored = source.registry.byKind.get("Note")?.[0]
    const resolved = resolveResourceTree({ tree: source, ...registrations(), validator })
    const note = resolved.registry.byKind.get("Note")?.[0]

    expect(authored?.node.text).toBe("First.\r\nSecond.\r\n")
    expect(note?.node.text).toBe("First.\r\nSecond.\r\n")
    expect(note?.resolvedSpec.text).toBe("First.\r\nSecond.\r\n")
  })
})

const validator: JsonSchemaValidator = {
  validate(revision, value) {
    const properties = value.properties as Readonly<Record<string, unknown>> | undefined
    if (!properties) return ["properties missing"]
    if (revision.subjectFqn === noteV2.subjectFqn && revision.specVersion === 2 && typeof properties.slug !== "string") return ["slug missing"]
    return []
  },
}

function registrations() {
  const contracts = new KindContractRegistry()
    .registerOwner(noteOwner)
    .registerRevision(noteV1)
    .registerRevision(noteV2)
  for (const owner of CORE_KIND_SUBJECT_OWNERS) contracts.registerOwner(owner)
  for (const revision of CORE_KIND_SPEC_REVISIONS) contracts.registerRevision(revision)
  const readers = new KindReaderRegistry()
    .register({
      readerId: "note.reader.v2",
      subjectFqn: noteV1.subjectFqn,
      readerSpecVersion: 2,
      contractFingerprint: noteV2.contractFingerprint,
      readerImplementationFingerprint: digest("note-reader"),
      compatibilityPolicy: "backward-transitive",
      read: (spec) => spec,
    })
  for (const reader of CORE_KIND_READER_REGISTRATIONS) readers.register(reader)
  const readerProfile = createReaderProfile("host-v2", [
    ...CORE_KIND_READER_REGISTRATIONS.map((reader) => ({
      readerId: reader.readerId,
      subjectFqn: reader.subjectFqn,
      readerSpecVersion: reader.readerSpecVersion,
      contractFingerprint: reader.contractFingerprint,
      readerImplementationFingerprint: reader.readerImplementationFingerprint,
    })),
    {
      readerId: "note.reader.v2",
      subjectFqn: noteV1.subjectFqn,
      readerSpecVersion: 2,
      contractFingerprint: noteV2.contractFingerprint,
      readerImplementationFingerprint: digest("note-reader"),
    },
  ])
  const resolutions = new SpecResolutionRegistry(contracts).register({
    id: "note.v1-to-v2",
    subjectFqn: noteV1.subjectFqn,
    ownerPackageId: "demo-note-kind",
    ownerPackageFingerprint: ownerFingerprint,
    writerSpecVersion: 1,
    readerSpecVersion: 2,
    writerContractFingerprint: noteV1.contractFingerprint,
    readerContractFingerprint: noteV2.contractFingerprint,
    resolutionFingerprint: digest("note-resolution"),
    resolve(spec: PortableSpec) {
      const properties = spec.properties as Readonly<Record<string, unknown>>
      return Object.freeze({
        ...spec,
        properties: Object.freeze({ ...properties, slug: "authored-note" }),
      })
    },
  })
  return { contracts, readers, readerProfile, resolutions }
}

async function fixture(options: {
  forgedContract?: boolean
  markdownBody?: string
  sourceShapes?: string
  requiredFile?: string
} = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "halfcode-resolved-tree-"))
  roots.add(root)
  await mkdir(join(root, "KindDefinitions/Note"), { recursive: true })
  await mkdir(join(root, "Notes"), { recursive: true })
  await writeFile(join(root, "manifest.xnl"), [
    '<ResourcePackage #demo.resolution envelopeVersion="halfcode.resource-envelope/v1" specVersion=1 (',
    "  <Catalogs [",
    '    <Catalog #kind_definitions { kind = "KindDefinition" shape = "directory" root = "vfs://./KindDefinitions/" entry = "manifest.xnl" }>',
    '    <Catalog #notes { kind = "Note" shape = "single-file" root = "vfs://./Notes/" }>',
    "  ]>",
    ")>",
    "",
  ].join("\n"))
  await writeFile(join(root, "KindDefinitions/Note/manifest.xnl"), [
    '<KindDefinition #Halfcode.ResourceKind.Note envelopeVersion="halfcode.resource-envelope/v1" specVersion=1 {',
    '  resourceKind = "Note"',
    `  subjectFqn = "${noteV1.subjectFqn}"`,
    `  sourceShapes = ${options.sourceShapes ?? '["single-file"]'}`,
    '} (',
    ...(options.requiredFile ? [
      '  <DescriptorContract (',
      '    <RequiredFiles [',
      `      <File { name = "${options.requiredFile}" }>`,
      '    ]>',
      '  )>',
    ] : []),
    '  <SpecRevisions [',
    revisionSource(noteV1, options.forgedContract ? digest("forged") : noteV1.contractFingerprint),
    revisionSource(noteV2, noteV2.contractFingerprint),
    '  ]>',
    ')>',
    "",
  ].join("\n"))
  if (options.requiredFile) await writeFile(join(root, "Notes", options.requiredFile), "support\n")
  if (options.markdownBody === undefined) {
    await writeFile(join(root, "Notes/Note.xnl"), '<Note #Demo.Note envelopeVersion="halfcode.resource-envelope/v1" specVersion=1 { description = "Authored note" }>\n')
  } else {
    await writeFile(join(root, "Notes/Note.md"), [
      "---",
      "envelopeVersion: halfcode.resource-envelope/v1",
      "specVersion: 1",
      "kind: Note",
      "metadata:",
      "  fqn: Demo.Note",
      "spec:",
      "  description: Authored note",
      "---",
    ].join("\r\n") + "\r\n" + options.markdownBody)
  }
  return root
}

function revisionSource(revision: typeof noteV1, contractFingerprint: Sha256Digest): string {
  return [
    `    <SpecRevision #v${revision.specVersion} {`,
    `      specVersion = ${revision.specVersion}`,
    `      schemaRef = "vfs://./spec-v${revision.specVersion}.schema.json"`,
    `      schemaFingerprint = "${revision.schemaFingerprint}"`,
    `      contractFingerprint = "${contractFingerprint}"`,
    `      semanticValidatorFingerprint = "${revision.semanticContract.semanticValidatorFingerprint}"`,
    `      referenceProjectionFingerprint = "${revision.semanticContract.referenceProjectionFingerprint}"`,
    `      compilerInputFingerprint = "${revision.semanticContract.compilerInputFingerprint}"`,
    `      stability = "${revision.stability}"`,
    "    }>",
  ].join("\n")
}
