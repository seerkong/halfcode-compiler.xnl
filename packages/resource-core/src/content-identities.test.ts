import { afterEach, describe, expect, test } from "bun:test"
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  ResourceCompositionError,
  ResourceValidationError,
  buildResourceDependencySnapshot,
  composeLayeredResourceRegistry,
  loadResourceTree,
  resolveEffectiveResourceContentIdentities,
  sha256Digest,
  validateResourceTree,
  type LoadedResourceTree,
  type ResourceDiagnostic,
  type ResourceTree,
} from "./index"

const fixtureRoot = join(import.meta.dir, "../tests/fixtures/XnlResourceWorkflow")
const rootNoteId = "demo.resource_workflow.note.root"
const coreNoteId = "demo.resource_workflow.note.core"
const temporaryRoots = new Set<string>()

afterEach(async () => {
  const roots = [...temporaryRoots]
  temporaryRoots.clear()
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
})

describe("loaded resource content identities", () => {
  test("binds identities to exact authority bytes and keeps deterministic resource order", async () => {
    const firstRoot = await fixtureCopy("halfcode-loaded-identity-first-")
    const secondRoot = await fixtureCopy("halfcode-loaded-identity-second-")
    const authorityBytes = await readFile(join(firstRoot, "Notes/RootNote.xnl"))

    const first = await loadResourceTree({ rootDir: firstRoot })
    const second = await loadResourceTree({ rootDir: secondRoot })
    const firstIdentity = first.contentIdentities.get(rootNoteId)!
    const secondIdentity = second.contentIdentities.get(rootNoteId)!

    expect(firstIdentity.authorityDigest).toBe(sha256Digest(authorityBytes))
    expect(firstIdentity).toEqual(secondIdentity)
    expect([...first.contentIdentities.keys()]).toEqual(
      [...first.registry.byKind.values()]
        .flatMap((records) => records.map((record) => record.resourceId))
        .sort(codeUnitOrder),
    )

    const notePath = join(secondRoot, "Notes/RootNote.xnl")
    const changed = (await readFile(notePath, "utf8")).replace('value = "root"', 'value = "changed"')
    await writeFile(notePath, changed)
    const changedTree = await loadResourceTree({ rootDir: secondRoot })
    expect(changedTree.contentIdentities.get(rootNoteId)?.authorityDigest).not.toBe(firstIdentity.authorityDigest)
    expect(changedTree.contentIdentities.get(rootNoteId)?.contentDigest).not.toBe(firstIdentity.contentDigest)
  })

  test("shares one forest authority digest while retaining per-resource content identity", async () => {
    const root = await fixtureCopy("halfcode-loaded-identity-forest-")
    const definitionPath = join(root, "KindDefinitions/Note/manifest.xnl")
    await writeFile(definitionPath, (await readFile(definitionPath, "utf8")).replace(
      'supportedApiVersions = ["halfcode.resources/v1"]',
      'supportedApiVersions = ["halfcode.resources/v1"]\n  documentCardinality = "many"',
    ))
    const forestPath = join(root, "Notes/Forest.xnl")
    await writeFile(forestPath, [
      '<Note #demo.resource_workflow.note.forest_a apiVersion="halfcode.resources/v1">',
      '<Note #demo.resource_workflow.note.forest_b apiVersion="halfcode.resources/v1">',
      "",
    ].join("\n"))

    const tree = await loadResourceTree({ rootDir: root })
    const first = tree.contentIdentities.get("demo.resource_workflow.note.forest_a")!
    const second = tree.contentIdentities.get("demo.resource_workflow.note.forest_b")!

    expect(first.authorityDigest).toBe(sha256Digest(await readFile(forestPath)))
    expect(second.authorityDigest).toBe(first.authorityDigest)
    expect(second.resourceId).not.toBe(first.resourceId)
    expect(second.contentDigest).not.toBe(first.contentDigest)
  })

  test("reports invalid UTF-8 and incomplete resource identities with stable diagnostics", async () => {
    const invalidUtf8Root = await fixtureCopy("halfcode-loaded-identity-utf8-")
    await writeFile(join(invalidUtf8Root, "Notes/InvalidUtf8.xnl"), new Uint8Array([
      0x3c, 0x4e, 0x6f, 0x74, 0x65, 0x20, 0x23, 0x61, 0x20, 0xc3, 0x28,
    ]))
    expect(await validateResourceTree({ rootDir: invalidUtf8Root })).toContainEqual(expect.objectContaining({
      code: "RESOURCE_XNL_UTF8_INVALID",
      location: "vfs://@/Notes/InvalidUtf8.xnl",
    }))
    await expect(loadResourceTree({ rootDir: invalidUtf8Root })).rejects.toBeInstanceOf(ResourceValidationError)

    const missingIdentityRoot = await fixtureCopy("halfcode-loaded-identity-missing-")
    await writeFile(
      join(missingIdentityRoot, "Notes/MissingIdentity.xnl"),
      '<Note apiVersion="halfcode.resources/v1">\n',
    )
    expect(await validateResourceTree({ rootDir: missingIdentityRoot })).toContainEqual(expect.objectContaining({
      code: "RESOURCE_IDENTITY_MISSING",
    }))
  })

  test("returns an immutable loaded-tree subtype while preserving structural ResourceTree compatibility", async () => {
    const loaded = await loadResourceTree({ rootDir: fixtureRoot })
    const structural: ResourceTree = loaded
    const identity = loaded.contentIdentities.get(rootNoteId)!

    expect(structural.manifest.resourceId).toBe("demo.resource_workflow.project")
    expect(Object.isFrozen(loaded)).toBe(true)
    expect(Object.isFrozen(identity)).toBe(true)
    expect(Object.isFrozen(identity.contributions)).toBe(true)
    expect("set" in loaded.contentIdentities).toBe(false)
    expect(Reflect.set(loaded, "contentIdentities", new Map())).toBe(false)
  })
})

describe("effective resource content identity projector", () => {
  test("keeps validated canonical layer ids aligned through identity projection and snapshot", async () => {
    const base = await loadNamedFixture("canonical-base")
    const override = await loadNamedFixture("canonical-override", { changeRootNote: true })
    const registry = composeLayeredResourceRegistry({
      layers: [
        { id: "  base \t", tree: base },
        { id: "\toverride  ", tree: override },
      ],
    })
    const canonicalLayers = [
      { id: "base", tree: base },
      { id: "override", tree: override },
    ] as const

    expect(registry.layers.map((layer) => layer.id)).toEqual(["base", "override"])
    const identities = resolveEffectiveResourceContentIdentities({ registry, layers: canonicalLayers })
    const snapshot = buildResourceDependencySnapshot({
      registry,
      roots: [rootNoteId],
      edges: [],
      contentIdentities: identities,
    })
    expect(snapshot.closure.map((resource) => resource.resourceId)).toEqual([rootNoteId])
    expect(snapshot.closure[0]?.origin.layerId).toBe("override")

    expect(diagnosticCodes(() => resolveEffectiveResourceContentIdentities({
      registry,
      layers: [
        { id: "  base \t", tree: base },
        canonicalLayers[1],
      ],
    }))).toContain("RESOURCE_CONTENT_IDENTITY_LAYER_ID_MISMATCH")
    expect(diagnosticCodes(() => resolveEffectiveResourceContentIdentities({
      registry,
      layers: [
        { id: "other", tree: base },
        canonicalLayers[1],
      ],
    }))).toContain("RESOURCE_CONTENT_IDENTITY_LAYER_ID_MISMATCH")
    expect(diagnosticCodes(() => resolveEffectiveResourceContentIdentities({
      registry,
      layers: [...canonicalLayers].reverse(),
    }))).toContain("RESOURCE_CONTENT_IDENTITY_LAYER_ID_MISMATCH")
    expect(diagnosticCodes(() => resolveEffectiveResourceContentIdentities({
      registry,
      layers: [canonicalLayers[0], { id: "override", tree: base }],
    }))).toContain("RESOURCE_CONTENT_IDENTITY_LAYER_PACKAGE_MISMATCH")
  })

  test("selects exact effective origins, merges explicit contributions, and feeds snapshots", async () => {
    const base = await loadNamedFixture("base")
    const override = await loadNamedFixture("override", { changeRootNote: true })
    const cleanup = await loadNamedFixture("cleanup", { emptyBusinessCatalogs: true })
    const registry = composeLayeredResourceRegistry({
      layers: [
        { id: "base", tree: base },
        { id: "override", tree: override },
        { id: "cleanup", tree: cleanup, tombstones: [{ resourceId: coreNoteId, expectedKind: "Note" }] },
      ],
    })
    const contributions = new Map([
      [rootNoteId, [
        { key: "\uE000", digest: sha256Digest("private-use") },
        { key: "𐀀", digest: sha256Digest("supplementary") },
      ]],
    ])

    const identities = resolveEffectiveResourceContentIdentities({
      registry,
      layers: [
        { id: "base", tree: base },
        { id: "override", tree: override },
        { id: "cleanup", tree: cleanup },
      ],
      contributions,
    })

    const effectiveIds = [...registry.byId.values()]
      .filter((entry) => entry.resource !== undefined)
      .map((entry) => entry.resourceId)
      .sort(codeUnitOrder)
    expect([...identities.keys()]).toEqual(effectiveIds)
    expect(identities.has(coreNoteId)).toBe(false)
    expect(identities.get(rootNoteId)?.authorityDigest).toBe(
      override.contentIdentities.get(rootNoteId)?.authorityDigest,
    )
    expect(identities.get(rootNoteId)?.contributions.map((item) => item.key)).toEqual(["𐀀", "\uE000"])
    expect(Object.isFrozen(identities.get(rootNoteId))).toBe(true)
    expect("set" in identities).toBe(false)

    const snapshot = buildResourceDependencySnapshot({
      registry,
      roots: [rootNoteId],
      edges: [],
      contentIdentities: identities,
    })
    expect(snapshot.closure.map((resource) => resource.resourceId)).toEqual([rootNoteId])
  })

  test("rejects inconsistent registry, layer, package, and contribution facts without partial output", async () => {
    const base = await loadNamedFixture("base-boundary")
    const override = await loadNamedFixture("override-boundary", { changeRootNote: true })
    const registry = composeLayeredResourceRegistry({
      layers: [
        { id: "base", tree: base },
        { id: "override", tree: override },
      ],
    })
    const validLayers = [
      { id: "base", tree: base },
      { id: "override", tree: override },
    ] as const

    const structuralRegistry = { ...registry }
    expect(diagnosticCodes(() => resolveEffectiveResourceContentIdentities({
      registry: structuralRegistry,
      layers: validLayers,
    }))).toContain("RESOURCE_CONTENT_IDENTITY_REGISTRY_UNTRUSTED")

    const structuralTree = { ...base } as LoadedResourceTree
    expect(diagnosticCodes(() => resolveEffectiveResourceContentIdentities({
      registry,
      layers: [{ id: "base", tree: structuralTree }, validLayers[1]],
    }))).toContain("RESOURCE_CONTENT_IDENTITY_LAYER_UNTRUSTED")

    expect(diagnosticCodes(() => resolveEffectiveResourceContentIdentities({
      registry,
      layers: [...validLayers].reverse(),
    }))).toContain("RESOURCE_CONTENT_IDENTITY_LAYER_ID_MISMATCH")

    expect(diagnosticCodes(() => resolveEffectiveResourceContentIdentities({
      registry,
      layers: [{ id: "base", tree: base }, { id: "override", tree: base }],
    }))).toContain("RESOURCE_CONTENT_IDENTITY_LAYER_PACKAGE_MISMATCH")

    expect(diagnosticCodes(() => resolveEffectiveResourceContentIdentities({
      registry,
      layers: validLayers,
      contributions: new Map([["demo.missing", []]]),
    }))).toContain("RESOURCE_DIGEST_CONTRIBUTION_OWNER_UNKNOWN")

    expect(diagnosticCodes(() => resolveEffectiveResourceContentIdentities({
      registry,
      layers: validLayers,
      contributions: new Map([[rootNoteId, [
        { key: "instruction", digest: sha256Digest("one") },
        { key: "instruction", digest: sha256Digest("two") },
      ]]]),
    }))).toContain("RESOURCE_DIGEST_CONTRIBUTION_CONFLICT")
  })
})

async function fixtureCopy(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  temporaryRoots.add(root)
  await cp(fixtureRoot, root, { recursive: true })
  return root
}

async function loadNamedFixture(
  name: string,
  options: { changeRootNote?: boolean; emptyBusinessCatalogs?: boolean } = {},
): Promise<LoadedResourceTree> {
  const root = await fixtureCopy(`halfcode-loaded-${name}-`)
  const manifestPath = join(root, "manifest.xnl")
  let manifest = (await readFile(manifestPath, "utf8")).replace(
    "#demo.resource_workflow.project",
    `#demo.resource_workflow.project.${name.replace(/[^A-Za-z0-9_]/g, "_")}`,
  )
  if (options.emptyBusinessCatalogs) {
    manifest = manifest.split("\n")
      .filter((line) => line.includes("kind_definitions") || !line.includes("<Catalog #"))
      .join("\n")
  }
  await writeFile(manifestPath, manifest)
  if (options.changeRootNote) {
    const notePath = join(root, "Notes/RootNote.xnl")
    await writeFile(notePath, (await readFile(notePath, "utf8")).replace('value = "root"', 'value = "override"'))
  }
  return loadResourceTree({ rootDir: root })
}

function diagnosticCodes(action: () => unknown): string[] {
  try {
    action()
  } catch (error) {
    expect(error).toBeInstanceOf(ResourceCompositionError)
    return [...(error as ResourceCompositionError).diagnostics].map((item: ResourceDiagnostic) => item.code)
  }
  throw new Error("Expected ResourceCompositionError")
}

function codeUnitOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
