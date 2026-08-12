import { describe, expect, test } from "bun:test"
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  loadResourceTree,
  ResourceValidationError,
  validateResourceTree,
  type ResourceNode,
} from "./index"

const xnlFixtureRoot = join(import.meta.dir, "../tests/fixtures/XnlResourceWorkflow")

describe("resource-core XNL-native loader", () => {
  test("loads XNL catalogs and exposes normalized semantic channels with provenance", async () => {
    const tree = await loadResourceTree({ rootDir: xnlFixtureRoot })

    expect(tree.manifest.kind).toBe("ResourcePackage")
    expect(tree.manifest.resourceId).toBe("demo.resource_workflow.project")
    expect(tree.manifest.metadata.apiVersion).toBe("halfcode.resources/v1")
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
      sourceShapes: ["single-file"],
      requiredFiles: [],
      currentApiVersion: "halfcode.resources/v1",
      supportedApiVersions: ["halfcode.resources/v1"],
      documentCardinality: "one",
      documentUri: "vfs://@/KindDefinitions/Note/manifest.xnl",
    })
    expect(tree.registry.byKind.has("KindDefinition")).toBe(false)

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

  test("validates resource apiVersion against its KindDefinition contract", async () => {
    const root = await mkdtemp(join(tmpdir(), "halfcode-kind-version-"))
    await cp(xnlFixtureRoot, root, { recursive: true })
    const definitionPath = join(root, "KindDefinitions/Note/manifest.xnl")
    const definition = await readFile(definitionPath, "utf8")
    await writeFile(definitionPath, definition.replace(
      'currentApiVersion = "halfcode.resources/v1"\n  supportedApiVersions = ["halfcode.resources/v1"]',
      'currentApiVersion = "demo.notes/v2"\n  supportedApiVersions = ["halfcode.resources/v1" "demo.notes/v1" "demo.notes/v2"]',
    ))
    const notePath = join(root, "Notes/RootNote.xnl")
    const note = await readFile(notePath, "utf8")
    await writeFile(notePath, note.replace('apiVersion="halfcode.resources/v1"', 'apiVersion="demo.notes/v1"'))
    expect((await loadResourceTree({ rootDir: root })).registry.byKind.get("Note")?.find((item) => item.resourceId.endsWith(".root"))?.metadata.apiVersion).toBe("demo.notes/v1")

    await writeFile(notePath, note.replace('apiVersion="halfcode.resources/v1"', 'apiVersion="demo.notes/unknown"'))
    expect(await validateResourceTree({ rootDir: root })).toContainEqual(expect.objectContaining({ code: "RESOURCE_API_VERSION_UNSUPPORTED" }))
  })

  test("rejects an inconsistent KindDefinition version contract", async () => {
    const root = await mkdtemp(join(tmpdir(), "halfcode-kind-contract-"))
    await cp(xnlFixtureRoot, root, { recursive: true })
    const definitionPath = join(root, "KindDefinitions/Note/manifest.xnl")
    const definition = await readFile(definitionPath, "utf8")
    await writeFile(definitionPath, definition.replace(
      'currentApiVersion = "halfcode.resources/v1"\n  supportedApiVersions = ["halfcode.resources/v1"]',
      'currentApiVersion = "demo.notes/v2"\n  supportedApiVersions = ["demo.notes/v1"]',
    ))
    expect(await validateResourceTree({ rootDir: root })).toContainEqual(expect.objectContaining({ code: "KIND_DEFINITION_VERSION_INVALID" }))
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
      'supportedApiVersions = ["halfcode.resources/v1"]',
      'supportedApiVersions = ["halfcode.resources/v1"]\n  documentCardinality = "many"',
    ))
    await writeFile(join(root, "Notes/Forest.xnl"), [
      '<Note #demo.resource_workflow.note.forest_a apiVersion="halfcode.resources/v1" { labels = ["forest"] }>',
      '<Note #demo.resource_workflow.note.forest_b apiVersion="halfcode.resources/v1" { labels = ["forest"] }>',
      "",
    ].join("\n"))

    const forest = (await loadResourceTree({ rootDir: root })).registry.byKind.get("Note")?.filter((item) => item.resourceId.includes("forest_")) ?? []
    expect(forest.map((item) => item.resourceId)).toEqual([
      "demo.resource_workflow.note.forest_a",
      "demo.resource_workflow.note.forest_b",
    ])
    expect(new Set(forest.map((item) => item.documentUri))).toEqual(new Set(["vfs://@/Notes/Forest.xnl"]))
  })

  test("keeps single-root kinds strict and rejects mixed or duplicate forest roots", async () => {
    const strictRoot = await mkdtemp(join(tmpdir(), "halfcode-resource-single-"))
    await cp(xnlFixtureRoot, strictRoot, { recursive: true })
    await writeFile(join(strictRoot, "Notes/Forest.xnl"), [
      '<Note #demo.resource_workflow.note.a apiVersion="halfcode.resources/v1">',
      '<Note #demo.resource_workflow.note.b apiVersion="halfcode.resources/v1">',
    ].join("\n"))
    expect(await validateResourceTree({ rootDir: strictRoot })).toContainEqual(expect.objectContaining({ code: "RESOURCE_XNL_ROOT_INVALID" }))

    const forestRoot = await mkdtemp(join(tmpdir(), "halfcode-resource-invalid-forest-"))
    await cp(xnlFixtureRoot, forestRoot, { recursive: true })
    const definitionPath = join(forestRoot, "KindDefinitions/Note/manifest.xnl")
    const definition = await readFile(definitionPath, "utf8")
    await writeFile(definitionPath, definition.replace(
      'supportedApiVersions = ["halfcode.resources/v1"]',
      'supportedApiVersions = ["halfcode.resources/v1"]\n  documentCardinality = "many"',
    ))
    const forestPath = join(forestRoot, "Notes/Forest.xnl")
    await writeFile(forestPath, [
      '<Note #demo.resource_workflow.note.a apiVersion="halfcode.resources/v1">',
      '<Procedure #demo.resource_workflow.procedure.b apiVersion="halfcode.resources/v1">',
    ].join("\n"))
    expect(await validateResourceTree({ rootDir: forestRoot })).toContainEqual(expect.objectContaining({ code: "RESOURCE_KIND_MISMATCH" }))

    await writeFile(forestPath, [
      '<Note #demo.resource_workflow.note.duplicate apiVersion="halfcode.resources/v1">',
      '<Note #demo.resource_workflow.note.duplicate apiVersion="halfcode.resources/v1">',
    ].join("\n"))
    expect(await validateResourceTree({ rootDir: forestRoot })).toContainEqual(expect.objectContaining({ code: "RESOURCE_IDENTITY_DUPLICATE" }))
  })
})
