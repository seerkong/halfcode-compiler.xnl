import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  RESOURCE_ENVELOPE_CONTRACT,
  RESOURCE_ENVELOPE_FINGERPRINT,
  digestCanonical,
  loadResourceTree,
  validateResourceTree,
  type AuthoredResourceTree,
} from "./index"

const roots = new Set<string>()

afterEach(async () => {
  const pending = [...roots]
  roots.clear()
  await Promise.all(pending.map((root) => rm(root, { recursive: true, force: true })))
})

describe("authored resource envelope", () => {
  test("publishes one deeply immutable canonical decoder contract and its exact fingerprint", () => {
    expect(RESOURCE_ENVELOPE_FINGERPRINT).toBe(digestCanonical(RESOURCE_ENVELOPE_CONTRACT))
    expect(RESOURCE_ENVELOPE_FINGERPRINT).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(Object.isFrozen(RESOURCE_ENVELOPE_CONTRACT)).toBe(true)
    expect(Object.isFrozen(RESOURCE_ENVELOPE_CONTRACT.requiredFields)).toBe(true)
    expect(Object.isFrozen(RESOURCE_ENVELOPE_CONTRACT.removedFields)).toBe(true)
    expect(Object.isFrozen(RESOURCE_ENVELOPE_CONTRACT.specVersion)).toBe(true)
    expect(Object.isFrozen(RESOURCE_ENVELOPE_CONTRACT.bootstrapKinds)).toBe(true)
    expect(Object.isFrozen(RESOURCE_ENVELOPE_CONTRACT.catalogTraversal.entryTags)).toBe(true)
    expect(() => (RESOURCE_ENVELOPE_CONTRACT.requiredFields as unknown as string[]).push("other")).toThrow()
  })

  test("decodes XNL envelopeVersion/specVersion into an explicitly authored tree", async () => {
    const root = await fixture()
    const tree: AuthoredResourceTree = await loadResourceTree({ rootDir: root })
    const note = tree.registry.byKind.get("Note")?.[0]

    expect(tree.stage).toBe("authored")
    expect(tree.manifest.metadata).toEqual({
      envelopeVersion: "halfcode.resource-envelope/v1",
      specVersion: 1,
      lifecycle: "Active",
    })
    expect(note?.stage).toBe("authored")
    expect(note?.subjectFqn).toBe("Halfcode.ResourceKind.Note")
    expect(note?.metadata).toEqual({
      envelopeVersion: "halfcode.resource-envelope/v1",
      specVersion: 1,
    })
    expect(note?.authoredSpec.properties).toEqual({ description: "Authored note" })
    expect(note?.authoredSpec).not.toHaveProperty("metadata")
    expect(note?.sourceContentDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  test.each([
    ["legacy apiVersion", 'apiVersion="halfcode.resources/v1" specVersion=1', "RESOURCE_METADATA_FIELD_REMOVED"],
    ["legacy root version", 'envelopeVersion="halfcode.resource-envelope/v1" specVersion=1 version="1.0.0"', "RESOURCE_METADATA_FIELD_REMOVED"],
    ["missing envelopeVersion", "specVersion=1", "RESOURCE_METADATA_FIELD_MISSING"],
    ["missing specVersion", 'envelopeVersion="halfcode.resource-envelope/v1"', "RESOURCE_METADATA_FIELD_MISSING"],
    ["zero specVersion", 'envelopeVersion="halfcode.resource-envelope/v1" specVersion=0', "RESOURCE_SPEC_VERSION_INVALID"],
    ["negative specVersion", 'envelopeVersion="halfcode.resource-envelope/v1" specVersion=-1', "RESOURCE_SPEC_VERSION_INVALID"],
    ["fractional specVersion", 'envelopeVersion="halfcode.resource-envelope/v1" specVersion=1.5', "RESOURCE_SPEC_VERSION_INVALID"],
    ["string specVersion", 'envelopeVersion="halfcode.resource-envelope/v1" specVersion="1"', "RESOURCE_SPEC_VERSION_INVALID"],
  ])("rejects XNL with %s", async (_label, metadata, code) => {
    const root = await fixture({ noteMetadata: metadata })
    expect(await validateResourceTree({ rootDir: root })).toContainEqual(expect.objectContaining({ code }))
  })

  test("rejects removed current/supported fields in KindDefinition", async () => {
    const root = await fixture({ legacyKindDefinition: true })
    expect(await validateResourceTree({ rootDir: root })).toContainEqual(expect.objectContaining({
      code: "KIND_DEFINITION_VERSION_FIELDS_REMOVED",
    }))
  })

  test.each([
    ["ResourcePackage", { rootSpecVersion: 2 }],
    ["KindDefinition", { kindDefinitionSpecVersion: 2 }],
  ])("rejects an unadmitted bootstrap writer revision for %s", async (_kind, options) => {
    const root = await fixture(options)
    expect(await validateResourceTree({ rootDir: root })).toContainEqual(expect.objectContaining({
      code: "CORE_RESOURCE_SPEC_VERSION_UNSUPPORTED",
    }))
  })

  test("decodes Markdown envelopeVersion/specVersion without materializing legacy metadata", async () => {
    const root = await fixture({ markdown: [
      "---",
      "envelopeVersion: halfcode.resource-envelope/v1",
      "specVersion: 1",
      "kind: Note",
      "metadata:",
      "  fqn: Demo.Note.Markdown",
      "  lifecycle: Active",
      "spec:",
      "  description: Markdown note",
      "---",
      "",
      "Body.",
      "",
    ].join("\n") })

    const note = (await loadResourceTree({ rootDir: root })).registry.byKind.get("Note")?.[0]
    expect(note?.format).toBe("markdown")
    expect(note?.metadata).toEqual({
      envelopeVersion: "halfcode.resource-envelope/v1",
      specVersion: 1,
      lifecycle: "Active",
    })
    expect(note?.authoredSpec.properties).toEqual({ description: "Markdown note" })
    expect(note?.node.text).toBe("\nBody.\n")
    expect(note?.authoredSpec.text).toBe("\nBody.\n")
  })

  test.each([
    ["LF with trailing newline", "First line.\nSecond line.\n", "First line.\nSecond line.\n"],
    ["CRLF with trailing newline", "First line.\r\nSecond line.\r\n", "First line.\r\nSecond line.\r\n"],
    ["no trailing newline", "Only line.", "Only line."],
    ["empty body", "", ""],
  ])("preserves the Markdown body bytes after one frontmatter separator newline: %s", async (_label, body, expected) => {
    const newline = body.includes("\r\n") ? "\r\n" : "\n"
    const root = await fixture({ markdown: [
      "---",
      "envelopeVersion: halfcode.resource-envelope/v1",
      "specVersion: 1",
      "kind: Note",
      "metadata:",
      "  fqn: Demo.Note.Markdown",
      "spec: {}",
      "---",
    ].join(newline) + newline + body })

    const note = (await loadResourceTree({ rootDir: root })).registry.byKind.get("Note")?.[0]
    expect(note?.node.text).toBe(expected)
    expect(note?.authoredSpec.text).toBe(expected)
  })

  test.each([
    ["legacy apiVersion", "apiVersion: halfcode.resources/v1\nspecVersion: 1", "RESOURCE_METADATA_FIELD_REMOVED", undefined],
    ["legacy version", "envelopeVersion: halfcode.resource-envelope/v1\nspecVersion: 1\nversion: 1.0.0", "RESOURCE_METADATA_FIELD_REMOVED", undefined],
    ["nested legacy apiVersion", "envelopeVersion: halfcode.resource-envelope/v1\nspecVersion: 1", "RESOURCE_METADATA_FIELD_REMOVED", "  apiVersion: halfcode.resources/v1"],
    ["nested legacy version", "envelopeVersion: halfcode.resource-envelope/v1\nspecVersion: 1", "RESOURCE_METADATA_FIELD_REMOVED", "  version: 1.0.0"],
    ["missing envelopeVersion", "specVersion: 1", "RESOURCE_METADATA_FIELD_MISSING", undefined],
    ["missing specVersion", "envelopeVersion: halfcode.resource-envelope/v1", "RESOURCE_METADATA_FIELD_MISSING", undefined],
    ["zero specVersion", "envelopeVersion: halfcode.resource-envelope/v1\nspecVersion: 0", "RESOURCE_SPEC_VERSION_INVALID", undefined],
    ["negative specVersion", "envelopeVersion: halfcode.resource-envelope/v1\nspecVersion: -1", "RESOURCE_SPEC_VERSION_INVALID", undefined],
    ["string specVersion", 'envelopeVersion: halfcode.resource-envelope/v1\nspecVersion: "1"', "RESOURCE_SPEC_VERSION_INVALID", undefined],
  ])("rejects Markdown with %s", async (_label, envelope, code, nestedRemovedField) => {
    const root = await fixture({ markdown: [
      "---",
      envelope,
      "kind: Note",
      "metadata:",
      "  fqn: Demo.Note.Markdown",
      ...(nestedRemovedField ? [nestedRemovedField] : []),
      "spec: {}",
      "---",
      "",
    ].join("\n") })
    expect(await validateResourceTree({ rootDir: root })).toContainEqual(expect.objectContaining({ code }))
  })
})

async function fixture(options: {
  noteMetadata?: string
  markdown?: string
  legacyKindDefinition?: boolean
  rootSpecVersion?: number
  kindDefinitionSpecVersion?: number
} = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "halfcode-resource-envelope-"))
  roots.add(root)
  await mkdir(join(root, "KindDefinitions/Note"), { recursive: true })
  await mkdir(join(root, "Notes"), { recursive: true })
  await writeFile(join(root, "manifest.xnl"), [
    `<ResourcePackage #demo.envelope envelopeVersion="halfcode.resource-envelope/v1" specVersion=${options.rootSpecVersion ?? 1} { lifecycle = "Active" } (`,
    "  <Catalogs [",
    '    <Catalog #kind_definitions { kind = "KindDefinition" shape = "directory" root = "vfs://./KindDefinitions/" entry = "manifest.xnl" }>',
    '    <Catalog #notes { kind = "Note" shape = "single-file" root = "vfs://./Notes/" }>',
    "  ]>",
    ")>",
    "",
  ].join("\n"))
  await writeFile(join(root, "KindDefinitions/Note/manifest.xnl"), [
    `<KindDefinition #halfcode.resource_kind.Note envelopeVersion="halfcode.resource-envelope/v1" specVersion=${options.kindDefinitionSpecVersion ?? 1} {`,
    '  resourceKind = "Note"',
    '  subjectFqn = "Halfcode.ResourceKind.Note"',
    '  sourceShapes = ["single-file"]',
    ...(options.legacyKindDefinition ? [
      '  currentApiVersion = "halfcode.resources/v1"',
      '  supportedApiVersions = ["halfcode.resources/v1"]',
    ] : []),
    '} (',
    '  <SpecRevisions [',
    '    <SpecRevision #v1 {',
    '      specVersion = 1',
    '      schemaRef = "vfs://./spec-v1.schema.json"',
    `      schemaFingerprint = "sha256:${"1".repeat(64)}"`,
    `      contractFingerprint = "sha256:${"2".repeat(64)}"`,
    `      semanticValidatorFingerprint = "sha256:${"3".repeat(64)}"`,
    `      referenceProjectionFingerprint = "sha256:${"4".repeat(64)}"`,
    `      compilerInputFingerprint = "sha256:${"5".repeat(64)}"`,
    '      stability = "stable"',
    '    }>',
    '  ]>',
    ')>',
    "",
  ].join("\n"))
  if (options.markdown !== undefined) {
    await writeFile(join(root, "Notes/Note.md"), options.markdown)
  } else {
    await writeFile(
      join(root, "Notes/Note.xnl"),
      `<Note #Demo.Note.Xnl ${options.noteMetadata ?? 'envelopeVersion="halfcode.resource-envelope/v1" specVersion=1'} { description = "Authored note" }>\n`,
    )
  }
  return root
}
