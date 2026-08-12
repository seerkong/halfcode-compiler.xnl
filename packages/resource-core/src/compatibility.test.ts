import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import {
  composeLayeredResourceRegistry,
  loadResourceTree,
  validateResourceTree,
  type ResourceRegistry,
  type ResourceTree,
  type ResourceTreeBuildResult,
} from "./index"

const fixtureRoot = join(import.meta.dir, "../tests/fixtures/XnlResourceWorkflow")

describe("resource-core 0.2.1 compatibility surface", () => {
  test("keeps the single-tree loader and validated registry shape", async () => {
    const tree: ResourceTree = await loadResourceTree({ rootDir: fixtureRoot })
    const registry: ResourceRegistry = tree.registry

    expect(tree.manifest.resourceId).toBe("demo.resource_workflow.project")
    expect(registry.byKind.get("Note")?.map((record) => record.resourceId).sort()).toEqual([
      "demo.resource_workflow.note.core",
      "demo.resource_workflow.note.minimal",
      "demo.resource_workflow.note.root",
    ])
    expect([...registry.kindDefinitions.keys()].sort()).toEqual([
      "Note",
      "Procedure",
      "ResourceModule",
    ])
    expect(tree.diagnostics).toEqual([])

    const structuralTree: ResourceTree = {
      manifest: tree.manifest,
      registry: tree.registry,
      diagnostics: tree.diagnostics,
    }
    const legacyBuildResult: ResourceTreeBuildResult = { diagnostics: [], tree: structuralTree }
    const layered = composeLayeredResourceRegistry({
      layers: [{ id: "structural", tree: structuralTree }],
    })
    expect(layered.byId.get("demo.resource_workflow.note.root")?.effectiveLayerId).toBe("structural")
    expect(legacyBuildResult.tree).toBe(structuralTree)
  })

  test("keeps validateResourceTree diagnostic-only and non-mutating", async () => {
    expect(await validateResourceTree({ rootDir: fixtureRoot })).toEqual([])
  })
})
