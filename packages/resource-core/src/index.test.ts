import { describe, expect, test } from "bun:test"
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  loadResourceTree,
  ResourceValidationError,
  sha256Digest,
  validateResourceTree,
  type ResourceNode,
} from "./index"

const xnlFixtureRoot = join(import.meta.dir, "../tests/fixtures/XnlResourceWorkflow")
const fp = (digit: string) => `sha256:${digit.repeat(64)}`

function kindDefinition(kind: string, shape: string, extra = ""): string {
  return [
    `<KindDefinition #halfcode.resource_kind.${kind} envelopeVersion="halfcode.resource-envelope/v1" specVersion=1 {`,
    `  resourceKind = "${kind}"`,
    `  subjectFqn = "Halfcode.ResourceKind.${kind}"`,
    `  sourceShapes = ["${shape}"]`,
    ...(extra ? [`  ${extra}`] : []),
    '} (',
    '  <SpecRevisions [',
    '    <SpecRevision #v1 {',
    '      specVersion = 1',
    '      schemaRef = "vfs://./spec-v1.schema.json"',
    `      schemaFingerprint = "${fp("1")}"`,
    `      contractFingerprint = "${fp("2")}"`,
    `      semanticValidatorFingerprint = "${fp("3")}"`,
    `      referenceProjectionFingerprint = "${fp("4")}"`,
    `      compilerInputFingerprint = "${fp("5")}"`,
    '      stability = "stable"',
    '    }>',
    '  ]>',
    ')>',
    '',
  ].join("\n")
}

async function writeSemanticCatalogFixture(root: string): Promise<void> {
  for (const path of [
    "KindDefinitions/SkillApp",
    "KindDefinitions/Note",
    "KindDefinitions/ResourceModule",
    "KindDefinitions/LocalFunctionBundle",
    "Notes",
    "Modules/Search",
    "LocalFunction",
  ]) {
    await mkdir(join(root, path), { recursive: true })
  }
  await writeFile(join(root, "manifest.xnl"), [
    '<SkillApp #demo.semantic.app envelopeVersion="halfcode.resource-envelope/v1" specVersion=1 (',
    '  <Catalogs [',
    '    <DirectoryResourceCatalog #kind_definitions { resourceKind = "KindDefinition" root = "vfs://./KindDefinitions/" entry = "manifest.xnl" scope = "children" }>',
    '    <FileResourceCatalog #notes { resourceKind = "Note" root = "vfs://./Notes/" }>',
    '    <ManifestResourceCatalog #modules { resourceKind = "ResourceModule" root = "vfs://./Modules/" entry = "manifest.xnl" }>',
    '    <DirectoryResourceCatalog #local_functions { resourceKind = "LocalFunctionBundle" root = "vfs://./LocalFunction/" entry = "manifest.xnl" scope = "root" }>',
    '  ]>',
    ')>',
    '',
  ].join("\n"))
  const definitions: ReadonlyArray<readonly [string, string]> = [
    ["SkillApp", "manifest"],
    ["Note", "single-file"],
    ["ResourceModule", "manifest"],
    ["LocalFunctionBundle", "directory"],
  ]
  for (const [kind, shape] of definitions) {
    await writeFile(join(root, `KindDefinitions/${kind}/manifest.xnl`), kindDefinition(kind, shape))
  }
  await writeFile(join(root, "Notes/Welcome.xnl"), '<Note #demo.semantic.note.welcome envelopeVersion="halfcode.resource-envelope/v1" specVersion=1>\n')
  await writeFile(join(root, "Modules/Search/manifest.xnl"), '<ResourceModule #demo.semantic.module.search envelopeVersion="halfcode.resource-envelope/v1" specVersion=1>\n')
  await writeFile(join(root, "LocalFunction/manifest.xnl"), '<LocalFunctionBundle #demo.semantic.local_functions envelopeVersion="halfcode.resource-envelope/v1" specVersion=1 { runtime = "bun" entry = "vfs://./bundle/index.js" }>\n')
}

describe("resource-core XNL-native loader", () => {
  test("loads a registered semantic root through named resource catalogs", async () => {
    const root = await mkdtemp(join(tmpdir(), "halfcode-semantic-catalogs-"))
    await writeSemanticCatalogFixture(root)

    const tree = await loadResourceTree({ rootDir: root })

    expect(tree.manifest).toMatchObject({ kind: "SkillApp", resourceId: "demo.semantic.app", sourceShape: "manifest" })
    expect(tree.registry.byKind.get("SkillApp")?.map((item) => item.resourceId)).toEqual(["demo.semantic.app"])
    expect(tree.registry.byKind.get("Note")?.[0]).toMatchObject({ sourceShape: "single-file", logicalPath: "Notes/Welcome.xnl" })
    expect(tree.registry.byKind.get("ResourceModule")?.[0]).toMatchObject({ sourceShape: "manifest", logicalPath: "Modules/Search/manifest.xnl" })
    expect(tree.registry.byKind.get("LocalFunctionBundle")?.[0]).toMatchObject({ sourceShape: "directory", logicalPath: "LocalFunction/manifest.xnl" })
    expect(tree.contentIdentities.has("demo.semantic.app")).toBe(true)
  })

  test.each([
    ["unknown semantic root", (source: string) => source.replace("<SkillApp #", "<UnknownApp #"), "KIND_DEFINITION_MISSING"],
    ["typed catalog shape conflict", (source: string) => source.replace("<FileResourceCatalog #notes {", '<FileResourceCatalog #notes { shape = "directory"'), "RESOURCE_CATALOG_INVALID"],
    ["invalid directory scope", (source: string) => source.replace('scope = "root"', 'scope = "package"'), "RESOURCE_CATALOG_INVALID"],
  ])("rejects %s", async (_label, mutate, code) => {
    const root = await mkdtemp(join(tmpdir(), "halfcode-semantic-invalid-"))
    await writeSemanticCatalogFixture(root)
    const manifestPath = join(root, "manifest.xnl")
    await writeFile(manifestPath, mutate(await readFile(manifestPath, "utf8")))
    expect(await validateResourceTree({ rootDir: root })).toContainEqual(expect.objectContaining({ code }))
  })

  test("rejects a named catalog whose expected kind disagrees with the resource root", async () => {
    const root = await mkdtemp(join(tmpdir(), "halfcode-semantic-kind-mismatch-"))
    await writeSemanticCatalogFixture(root)
    const bundlePath = join(root, "LocalFunction/manifest.xnl")
    await writeFile(bundlePath, (await readFile(bundlePath, "utf8")).replace("<LocalFunctionBundle #", "<PageWorkflowBundle #"))
    expect(await validateResourceTree({ rootDir: root })).toContainEqual(expect.objectContaining({ code: "RESOURCE_KIND_MISMATCH" }))
  })

  test("loads XNL catalogs and exposes normalized semantic channels with provenance", async () => {
    const tree = await loadResourceTree({ rootDir: xnlFixtureRoot })

    expect(tree.manifest.kind).toBe("ResourcePackage")
    expect(tree.manifest.resourceId).toBe("demo.resource_workflow.project")
    expect(tree.manifest.metadata).toMatchObject({ envelopeVersion: "halfcode.resource-envelope/v1", specVersion: 1 })
    expect(tree.manifest.format).toBe("xnl")
    expect(tree.registry.byKind.get("Note")?.map((item) => item.resourceId).sort()).toEqual([
      "demo.resource_workflow.note.core",
      "demo.resource_workflow.note.minimal",
      "demo.resource_workflow.note.root",
    ])
    expect(tree.registry.byKind.get("Procedure")?.[0]?.sourceShape).toBe("directory")
    expect(tree.registry.byKind.get("ResourceModule")?.[0]?.sourceShape).toBe("manifest")

    expect([...tree.registry.kindDefinitions.keys()].sort()).toEqual(["Note", "Procedure", "ResourceModule"])
    expect(tree.registry.kindDefinitions.get("Note")).toEqual({
      resourceId: "halfcode.resource_kind.Note",
      resourceKind: "Note",
      subjectFqn: "Halfcode.ResourceKind.Note",
      sourceShapes: ["single-file"],
      requiredFiles: [],
      specRevisions: [expect.objectContaining({ specVersion: 1 })],
      documentCardinality: "one",
      documentUri: "vfs://@/KindDefinitions/Note/manifest.xnl",
    })
    expect(tree.registry.byKind.get("KindDefinition")?.map((item) => ({
      resourceId: item.resourceId,
      subjectFqn: item.subjectFqn,
      stage: item.stage,
    }))).toEqual([
      { resourceId: "halfcode.resource_kind.Note", subjectFqn: "Halfcode.ResourceKind.KindDefinition", stage: "authored" },
      { resourceId: "halfcode.resource_kind.Procedure", subjectFqn: "Halfcode.ResourceKind.KindDefinition", stage: "authored" },
      { resourceId: "halfcode.resource_kind.ResourceModule", subjectFqn: "Halfcode.ResourceKind.KindDefinition", stage: "authored" },
    ])

    const rootNote = tree.registry.byKind.get("Note")?.find((item) => item.resourceId.endsWith(".root"))
    expect(rootNote?.node.properties.labels).toEqual(["root", "demo"])
    expect((rootNote?.node.body[0] as ResourceNode | undefined)?.tag).toBe("Tag")
    expect(rootNote?.documentUri).toBe("vfs://@/Notes/RootNote.xnl")
    expect(rootNote?.logicalPath).toBe("Notes/RootNote.xnl")

    const minimalNote = tree.registry.byKind.get("Note")?.find((item) => item.resourceId.endsWith(".minimal"))
    expect(minimalNote?.description).toBeUndefined()
    expect(minimalNote?.metadata.lifecycle).toBeUndefined()

    const procedure = tree.registry.byKind.get("Procedure")?.[0]
    expect(procedure?.node.subdomains.Instruction?.text).toContain("Prepare normalized")
    expect(procedure?.node.subdomains.CodeBinding?.properties.src).toContain("#prepareProcedure")
  })

  test.each([
    ["UnsafeManifest.xnl", "RESOURCE_REF_CONTAINMENT"],
    ["DuplicateManifest.xnl", "RESOURCE_IDENTITY_DUPLICATE"],
    ["BrokenManifest.xnl", "RESOURCE_XNL_SYNTAX"],
    ["UnknownKindManifest.xnl", "KIND_DEFINITION_MISSING"],
  ])("rejects invalid XNL authority %s", async (manifestPath, expectedCode) => {
    const diagnostics = await validateResourceTree({ rootDir: xnlFixtureRoot, manifestPath })
    expect(diagnostics.some((item) => item.code === expectedCode)).toBe(true)
    expect(JSON.stringify(diagnostics)).not.toContain(xnlFixtureRoot)
    await expect(loadResourceTree({ rootDir: xnlFixtureRoot, manifestPath })).rejects.toBeInstanceOf(ResourceValidationError)
  })

  test("rejects an explicitly named XML authority without parsing its content", async () => {
    const input = { rootDir: xnlFixtureRoot, manifestPath: "Manifest.xml" }
    await expect(loadResourceTree(input)).rejects.toMatchObject({
      diagnostics: [expect.objectContaining({ code: "RESOURCE_AUTHORITY_FORMAT_UNSUPPORTED" })],
    })
    expect(await validateResourceTree(input)).toEqual([
      expect.objectContaining({ code: "RESOURCE_AUTHORITY_FORMAT_UNSUPPORTED" }),
    ])
  })

  test("preserves the exact authored writer specVersion", async () => {
    const root = await mkdtemp(join(tmpdir(), "halfcode-kind-version-"))
    await cp(xnlFixtureRoot, root, { recursive: true })
    const notePath = join(root, "Notes/RootNote.xnl")
    const note = await readFile(notePath, "utf8")
    await writeFile(notePath, note.replace("specVersion=1", "specVersion=2"))
    expect((await loadResourceTree({ rootDir: root })).registry.byKind.get("Note")?.find((item) => item.resourceId.endsWith(".root"))?.metadata.specVersion).toBe(2)
  })

  test("rejects removed KindDefinition current/supported version fields", async () => {
    const root = await mkdtemp(join(tmpdir(), "halfcode-kind-contract-"))
    await cp(xnlFixtureRoot, root, { recursive: true })
    const definitionPath = join(root, "KindDefinitions/Note/manifest.xnl")
    const definition = await readFile(definitionPath, "utf8")
    await writeFile(definitionPath, definition.replace('resourceKind = "Note"', 'resourceKind = "Note"\n  currentSpecVersion = 1'))
    expect(await validateResourceTree({ rootDir: root })).toContainEqual(expect.objectContaining({ code: "KIND_DEFINITION_VERSION_FIELDS_REMOVED" }))
  })

  test("selects one named XNL document from a single-file catalog", async () => {
    const root = await mkdtemp(join(tmpdir(), "halfcode-resource-entry-"))
    await cp(xnlFixtureRoot, root, { recursive: true })
    const manifestPath = join(root, "manifest.xnl")
    const manifest = await readFile(manifestPath, "utf8")
    await writeFile(manifestPath, manifest.replace(
      '<Catalog #root_notes { kind = "Note" shape = "single-file" root = "vfs://./Notes/" }>',
      '<Catalog #root_notes { kind = "Note" shape = "single-file" root = "vfs://./Notes/" entry = "RootNote.xnl" }>',
    ))

    const notes = (await loadResourceTree({ rootDir: root })).registry.byKind.get("Note") ?? []
    expect(notes.filter((item) => item.logicalPath.startsWith("Notes/"))).toHaveLength(1)
    expect(notes.find((item) => item.logicalPath === "Notes/RootNote.xnl")?.resourceId).toBe("demo.resource_workflow.note.root")
  })

  test.each(["../RootNote.xnl", "RootNote.xml"])("rejects invalid single-file catalog entry %s", async (entry) => {
    const root = await mkdtemp(join(tmpdir(), "halfcode-resource-entry-invalid-"))
    await cp(xnlFixtureRoot, root, { recursive: true })
    const manifestPath = join(root, "manifest.xnl")
    const manifest = await readFile(manifestPath, "utf8")
    await writeFile(manifestPath, manifest.replace(
      '<Catalog #root_notes { kind = "Note" shape = "single-file" root = "vfs://./Notes/" }>',
      `<Catalog #root_notes { kind = "Note" shape = "single-file" root = "vfs://./Notes/" entry = "${entry}" }>`,
    ))

    expect(await validateResourceTree({ rootDir: root })).toContainEqual(expect.objectContaining({
      code: "RESOURCE_CATALOG_ENTRY_INVALID",
    }))
  })

  test("reports a missing selected single-file catalog entry", async () => {
    const root = await mkdtemp(join(tmpdir(), "halfcode-resource-entry-missing-"))
    await cp(xnlFixtureRoot, root, { recursive: true })
    const manifestPath = join(root, "manifest.xnl")
    const manifest = await readFile(manifestPath, "utf8")
    await writeFile(manifestPath, manifest.replace(
      '<Catalog #root_notes { kind = "Note" shape = "single-file" root = "vfs://./Notes/" }>',
      '<Catalog #root_notes { kind = "Note" shape = "single-file" root = "vfs://./Notes/" entry = "Missing.xnl" }>',
    ))

    expect(await validateResourceTree({ rootDir: root })).toContainEqual(expect.objectContaining({
      code: "RESOURCE_FILE_MISSING",
      location: "vfs://@/Notes/Missing.xnl",
    }))
  })

  test("loads every root from a Kind-authorized XNL forest with shared provenance", async () => {
    const root = await mkdtemp(join(tmpdir(), "halfcode-resource-forest-"))
    await cp(xnlFixtureRoot, root, { recursive: true })
    const definitionPath = join(root, "KindDefinitions/Note/manifest.xnl")
    const definition = await readFile(definitionPath, "utf8")
    await writeFile(definitionPath, definition.replace(
      'sourceShapes = ["single-file"]',
      'sourceShapes = ["single-file"]\n  documentCardinality = "many"',
    ))
    await writeFile(join(root, "Notes/Forest.xnl"), [
      '<Note #demo.resource_workflow.note.forest_a envelopeVersion="halfcode.resource-envelope/v1" specVersion=1 { labels = ["forest"] }>',
      '<Note #demo.resource_workflow.note.forest_b envelopeVersion="halfcode.resource-envelope/v1" specVersion=1 { labels = ["forest"] }>',
      "",
    ].join("\n"))

    const forest = (await loadResourceTree({ rootDir: root })).registry.byKind.get("Note")?.filter((item) => item.resourceId.includes("forest_")) ?? []
    expect(forest.map((item) => item.resourceId)).toEqual([
      "demo.resource_workflow.note.forest_a",
      "demo.resource_workflow.note.forest_b",
    ])
    expect(new Set(forest.map((item) => item.documentUri))).toEqual(new Set(["vfs://@/Notes/Forest.xnl"]))
  })

  test("loads one Markdown frontmatter file as one single-file resource authority", async () => {
    const root = await mkdtemp(join(tmpdir(), "halfcode-markdown-resource-"))
    await mkdir(join(root, "KindDefinitions/ApplicationSOP"), { recursive: true })
    await mkdir(join(root, "ApplicationSOP"), { recursive: true })
    await writeFile(join(root, "manifest.xnl"), [
      '<ResourcePackage #demo.markdown envelopeVersion="halfcode.resource-envelope/v1" specVersion=1 (',
      '  <Catalogs [',
      '    <Catalog #kind_definitions { kind = "KindDefinition" shape = "directory" root = "vfs://./KindDefinitions/" entry = "manifest.xnl" }>',
      '    <Catalog #application_sops { kind = "ApplicationSOP" shape = "single-file" root = "vfs://./ApplicationSOP/" }>',
      '  ]>',
      ')>',
      '',
    ].join("\n"))
    await writeFile(join(root, "KindDefinitions/ApplicationSOP/manifest.xnl"), kindDefinition("ApplicationSOP", "single-file"))
    const markdown = [
      '---',
      'envelopeVersion: halfcode.resource-envelope/v1',
      'specVersion: 1',
      'kind: ApplicationSOP',
      'metadata:',
      '  fqn: Demo.ApplicationSOP.Search',
      'spec:',
      '  description: Search and return a typed result.',
      '---',
      '',
      'Use resource://Not.A.Dependency only as prose.',
      '',
    ].join("\n")
    await writeFile(join(root, "ApplicationSOP/search.md"), markdown)

    const tree = await loadResourceTree({ rootDir: root })
    const resource = tree.registry.byKind.get("ApplicationSOP")?.[0]
    expect(resource).toMatchObject({
      resourceId: "Demo.ApplicationSOP.Search",
      fqn: "Demo.ApplicationSOP.Search",
      kind: "ApplicationSOP",
      description: "Search and return a typed result.",
      format: "markdown",
      sourceShape: "single-file",
      logicalPath: "ApplicationSOP/search.md",
      documentUri: "vfs://@/ApplicationSOP/search.md",
      metadata: { envelopeVersion: "halfcode.resource-envelope/v1", specVersion: 1 },
    })
    expect(resource?.node.properties).toEqual({ description: "Search and return a typed result." })
    expect(tree.contentIdentities.get("Demo.ApplicationSOP.Search")?.authorityDigest).toBe(sha256Digest(markdown))
  })

  test.each([
    ["missing frontmatter", "# SOP\n", "RESOURCE_MARKDOWN_FRONTMATTER_INVALID"],
    ["unterminated frontmatter", "---\nkind: ApplicationSOP\n", "RESOURCE_MARKDOWN_FRONTMATTER_INVALID"],
    ["non-object frontmatter", "---\n- invalid\n---\nbody\n", "RESOURCE_MARKDOWN_FRONTMATTER_INVALID"],
    ["missing identity", "---\nenvelopeVersion: halfcode.resource-envelope/v1\nspecVersion: 1\nkind: ApplicationSOP\nmetadata: {}\n---\nbody\n", "RESOURCE_MARKDOWN_METADATA_INVALID"],
  ])("rejects Markdown single-file authority with %s", async (_label, markdown, code) => {
    const root = await mkdtemp(join(tmpdir(), "halfcode-markdown-invalid-"))
    await cp(xnlFixtureRoot, root, { recursive: true })
    await writeFile(join(root, "Notes/Invalid.md"), markdown)
    expect(await validateResourceTree({ rootDir: root })).toContainEqual(expect.objectContaining({ code }))
  })

  test("keeps single-root kinds strict and rejects mixed or duplicate forest roots", async () => {
    const strictRoot = await mkdtemp(join(tmpdir(), "halfcode-resource-single-"))
    await cp(xnlFixtureRoot, strictRoot, { recursive: true })
    await writeFile(join(strictRoot, "Notes/Forest.xnl"), [
      '<Note #demo.resource_workflow.note.a envelopeVersion="halfcode.resource-envelope/v1" specVersion=1>',
      '<Note #demo.resource_workflow.note.b envelopeVersion="halfcode.resource-envelope/v1" specVersion=1>',
    ].join("\n"))
    expect(await validateResourceTree({ rootDir: strictRoot })).toContainEqual(expect.objectContaining({ code: "RESOURCE_XNL_ROOT_INVALID" }))

    const forestRoot = await mkdtemp(join(tmpdir(), "halfcode-resource-invalid-forest-"))
    await cp(xnlFixtureRoot, forestRoot, { recursive: true })
    const definitionPath = join(forestRoot, "KindDefinitions/Note/manifest.xnl")
    const definition = await readFile(definitionPath, "utf8")
    await writeFile(definitionPath, definition.replace(
      'sourceShapes = ["single-file"]',
      'sourceShapes = ["single-file"]\n  documentCardinality = "many"',
    ))
    const forestPath = join(forestRoot, "Notes/Forest.xnl")
    await writeFile(forestPath, [
      '<Note #demo.resource_workflow.note.a envelopeVersion="halfcode.resource-envelope/v1" specVersion=1>',
      '<Procedure #demo.resource_workflow.procedure.b envelopeVersion="halfcode.resource-envelope/v1" specVersion=1>',
    ].join("\n"))
    expect(await validateResourceTree({ rootDir: forestRoot })).toContainEqual(expect.objectContaining({ code: "RESOURCE_KIND_MISMATCH" }))

    await writeFile(forestPath, [
      '<Note #demo.resource_workflow.note.duplicate envelopeVersion="halfcode.resource-envelope/v1" specVersion=1>',
      '<Note #demo.resource_workflow.note.duplicate envelopeVersion="halfcode.resource-envelope/v1" specVersion=1>',
    ].join("\n"))
    expect(await validateResourceTree({ rootDir: forestRoot })).toContainEqual(expect.objectContaining({ code: "RESOURCE_IDENTITY_DUPLICATE" }))
  })
})
