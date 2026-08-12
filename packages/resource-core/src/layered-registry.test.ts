import { describe, expect, test } from "bun:test"
import {
  ResourceCompositionError,
  composeLayeredResourceRegistry,
  type RegisteredKindDefinition,
  type ResourceDiagnostic,
  type ResourceNode,
  type ResourceRecord,
  type ResourceTree,
} from "./index"

describe("ordered named resource layers", () => {
  test("lets a later layer shadow the same kind while retaining provenance", () => {
    const base = tree("demo.base", [
      record("demo.note.a", "Note", "base-a"),
      record("demo.note.b", "Note", "base-b"),
    ], [kindDefinition("Note")])
    const override = tree("demo.override", [
      record("demo.note.a", "Note", "override-a"),
    ], [kindDefinition("Note", "vfs://@/override/Note.xnl")])

    const registry = composeLayeredResourceRegistry({
      layers: [
        { id: "base", tree: base },
        { id: "override", tree: override },
      ],
    })

    expect(registry.layers.map((layer) => layer.id)).toEqual(["base", "override"])
    expect(registry.byId.get("demo.note.a")?.resource?.node.properties.value).toBe("override-a")
    expect(registry.byId.get("demo.note.a")?.effectiveLayerId).toBe("override")
    expect(registry.byId.get("demo.note.a")?.shadowed.map((origin) => origin.layerId)).toEqual(["base"])
    expect(registry.byId.get("demo.note.b")?.effectiveLayerId).toBe("base")
    expect(registry.byKind.get("Note")?.map((item) => item.resourceId)).toEqual([
      "demo.note.a",
      "demo.note.b",
    ])
    expect(registry.kindDefinitions.get("Note")?.origins.map((origin) => origin.layerId)).toEqual([
      "base",
      "override",
    ])
    expect(registry.revision).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(registry.compositionRevision).toBe(registry.revision)

    const reorderedBase = tree("demo.base", [...(base.registry.byKind.get("Note") ?? [])].reverse(), [kindDefinition("Note")])
    const reordered = composeLayeredResourceRegistry({
      layers: [
        { id: "base", tree: reorderedBase },
        { id: "override", tree: override },
      ],
    })
    expect(reordered.revision).toBe(registry.revision)
  })

  test("deep-copies and freezes composition facts independently of mutable inputs", () => {
    const mutableNode = {
      tag: "Note",
      resourceId: "demo.mutable",
      metadata: { apiVersion: "halfcode.resources/v1" },
      properties: { value: "before", nested: { labels: ["one"] } },
      body: [{ item: "before" }],
      subdomains: {},
    } as unknown as ResourceNode
    const mutableRecord = {
      kind: "Note",
      resourceId: "demo.mutable",
      fqn: "demo.mutable",
      metadata: { apiVersion: "halfcode.resources/v1", version: "1.0.0" },
      sourceShape: "single-file" as const,
      logicalPath: "demo.mutable.xnl",
      documentUri: "vfs://@/demo.mutable.xnl",
      format: "xnl" as const,
      node: mutableNode,
    }
    const mutableDefinition = {
      resourceId: "halfcode.resource_kind.Note",
      resourceKind: "Note",
      sourceShapes: ["single-file" as const],
      requiredFiles: ["instruction.md"],
      currentApiVersion: "halfcode.resources/v1",
      supportedApiVersions: ["halfcode.resources/v1"],
      documentCardinality: "one" as const,
      documentUri: "vfs://@/KindDefinitions/Note/manifest.xnl",
    }
    const input = tree("demo.mutable.package", [mutableRecord], [mutableDefinition])
    const registry = composeLayeredResourceRegistry({ layers: [{ id: "mutable", tree: input }] })
    const revision = registry.compositionRevision
    const projected = registry.byId.get("demo.mutable")!.resource!
    const projectedDefinition = registry.kindDefinitions.get("Note")!.definition

    mutableRecord.metadata.version = "9.9.9"
    ;(mutableNode.properties as Record<string, unknown>).value = "after"
    ;(((mutableNode.properties as Record<string, unknown>).nested as { labels: string[] }).labels).push("two")
    mutableDefinition.requiredFiles.push("changed.md")
    mutableDefinition.supportedApiVersions.push("halfcode.resources/v2")

    expect(projected.metadata.version).toBe("1.0.0")
    expect(projected.node.properties.value).toBe("before")
    expect(((projected.node.properties.nested as { labels: readonly string[] }).labels)).toEqual(["one"])
    expect(projectedDefinition.requiredFiles).toEqual(["instruction.md"])
    expect(projectedDefinition.supportedApiVersions).toEqual(["halfcode.resources/v1"])
    expect(registry.compositionRevision).toBe(revision)
    expect(Object.isFrozen(projected)).toBe(true)
    expect(Object.isFrozen(projected.metadata)).toBe(true)
    expect(Object.isFrozen(projected.node)).toBe(true)
    expect(Object.isFrozen(projected.node.properties)).toBe(true)
    expect(Object.isFrozen(projected.node.properties.nested)).toBe(true)
    expect(Object.isFrozen((projected.node.properties.nested as { labels: readonly string[] }).labels)).toBe(true)
    expect(Object.isFrozen(projectedDefinition)).toBe(true)
    expect(Object.isFrozen(projectedDefinition.requiredFiles)).toBe(true)
  })

  test("keeps composition revision independent of descriptor content bytes", () => {
    const first = composeLayeredResourceRegistry({
      layers: [{ id: "base", tree: tree("demo.package", [record("demo.note", "Note", "content-one")], []) }],
    })
    const second = composeLayeredResourceRegistry({
      layers: [{ id: "base", tree: tree("demo.package", [record("demo.note", "Note", "content-two")], []) }],
    })

    expect(second.byId.get("demo.note")?.resource?.node.properties.value).toBe("content-two")
    expect(second.compositionRevision).toBe(first.compositionRevision)
  })

  test("binds logical origin provenance into composition revision", () => {
    const original = record("demo.note", "Note", "same-content")
    const relocated = Object.freeze({
      ...original,
      logicalPath: "relocated/demo.note.xnl",
      documentUri: "vfs://@/relocated/demo.note.xnl",
    })
    const first = composeLayeredResourceRegistry({
      layers: [{ id: "base", tree: tree("demo.package", [original], []) }],
    })
    const second = composeLayeredResourceRegistry({
      layers: [{ id: "base", tree: tree("demo.package", [relocated], []) }],
    })

    expect(second.byId.get("demo.note")?.effectiveOrigin?.logicalPath).toBe("relocated/demo.note.xnl")
    expect(second.compositionRevision).not.toBe(first.compositionRevision)
  })

  test("binds the projected KindDefinition identity into composition revision", () => {
    const original = kindDefinition("Note")
    const reidentified = Object.freeze({
      ...original,
      resourceId: "alternate.resource_kind.Note",
    })
    const first = composeLayeredResourceRegistry({
      layers: [{ id: "base", tree: tree("demo.package", [], [original]) }],
    })
    const second = composeLayeredResourceRegistry({
      layers: [{ id: "base", tree: tree("demo.package", [], [reidentified]) }],
    })

    expect(second.kindDefinitions.get("Note")?.definition.resourceId).toBe("alternate.resource_kind.Note")
    expect(second.compositionRevision).not.toBe(first.compositionRevision)
  })

  test("uses a fixed UTF-16 code-unit order for Unicode resource identities", () => {
    const registry = composeLayeredResourceRegistry({
      layers: [{ id: "unicode", tree: tree("demo.unicode", [
        record("demo.😀", "Note", "emoji"),
        record("demo.Ä", "Note", "umlaut"),
        record("demo.a", "Note", "lower"),
        record("demo.Z", "Note", "upper"),
      ], [kindDefinition("Note")]) }],
    })

    expect(registry.byKind.get("Note")?.map((item) => item.resourceId)).toEqual([
      "demo.Z",
      "demo.a",
      "demo.Ä",
      "demo.😀",
    ])
  })

  test("requires an explicit tombstone and never treats absence as deletion", () => {
    const base = tree("demo.base", [
      record("demo.note.a", "Note", "base-a"),
      record("demo.note.b", "Note", "base-b"),
    ], [kindDefinition("Note")])
    const emptyOverride = tree("demo.override", [], [kindDefinition("Note", "vfs://@/override/Note.xnl")])

    const withoutTombstone = composeLayeredResourceRegistry({
      layers: [
        { id: "base", tree: base },
        { id: "override", tree: emptyOverride },
      ],
    })
    expect(withoutTombstone.byId.get("demo.note.b")?.resource?.resourceId).toBe("demo.note.b")

    const withTombstone = composeLayeredResourceRegistry({
      layers: [
        { id: "base", tree: base },
        {
          id: "override",
          tree: emptyOverride,
          tombstones: [{ resourceId: "demo.note.b", expectedKind: "Note", reason: "removed" }],
        },
      ],
    })
    const entry = withTombstone.byId.get("demo.note.b")
    expect(entry?.resource).toBeUndefined()
    expect(entry?.tombstone?.layerId).toBe("override")
    expect(entry?.tombstones.map((item) => item.layerId)).toEqual(["override"])
    expect(entry?.shadowed.map((origin) => origin.layerId)).toEqual(["base"])
    expect(withTombstone.byKind.get("Note")?.map((item) => item.resourceId)).toEqual(["demo.note.a"])
  })

  test("fails closed for invalid layer, identity, tombstone, and KindDefinition facts", () => {
    const note = tree("demo.note", [record("demo.item", "Note", "note")], [kindDefinition("Note")])
    const procedure = tree("demo.procedure", [record("demo.item", "Procedure", "procedure")], [
      kindDefinition("Procedure"),
    ])

    expect(diagnosticCodes(() => composeLayeredResourceRegistry({
      layers: [{ id: "same", tree: note }, { id: "same", tree: note }],
    }))).toContain("RESOURCE_LAYER_ID_DUPLICATE")
    expect(diagnosticCodes(() => composeLayeredResourceRegistry({
      layers: [{ id: "base", tree: note }, { id: "override", tree: procedure }],
    }))).toContain("RESOURCE_LAYER_IDENTITY_KIND_CONFLICT")
    expect(diagnosticCodes(() => composeLayeredResourceRegistry({
      layers: [{ id: "base", tree: note }, {
        id: "override",
        tree: tree("demo.override", [], [kindDefinition("Note", "vfs://@/Note.xnl", "demo.notes/v2")]),
      }],
    }))).toContain("RESOURCE_LAYER_KIND_DEFINITION_CONFLICT")
    expect(diagnosticCodes(() => composeLayeredResourceRegistry({
      layers: [{ id: "base", tree: note }, {
        id: "override",
        tree: tree("demo.override", [], [kindDefinition("Note", "vfs://@/Note.xnl")]),
        tombstones: [{ resourceId: "demo.item", expectedKind: "Procedure" }],
      }],
    }))).toContain("RESOURCE_LAYER_TOMBSTONE_KIND_MISMATCH")
    expect(diagnosticCodes(() => composeLayeredResourceRegistry({
      layers: [{ id: "base", tree: note }, {
        id: "override",
        tree: tree("demo.override", [], [kindDefinition("Note", "vfs://@/Note.xnl")]),
        tombstones: [{ resourceId: "demo.missing" }],
      }],
    }))).toContain("RESOURCE_LAYER_TOMBSTONE_TARGET_MISSING")
    const unsafeOrigin = Object.freeze({
      ...record("demo.unsafe", "Note", "unsafe"),
      logicalPath: "/Users/example/demo.unsafe.xnl",
      documentUri: "/Users/example/demo.unsafe.xnl",
    })
    expect(diagnosticCodes(() => composeLayeredResourceRegistry({
      layers: [{ id: "unsafe", tree: tree("demo.unsafe.package", [unsafeOrigin], []) }],
    }))).toContain("RESOURCE_LAYER_PROVENANCE_INVALID")
  })
})

function diagnosticCodes(action: () => unknown): string[] {
  try {
    action()
  } catch (error) {
    expect(error).toBeInstanceOf(ResourceCompositionError)
    return [...(error as ResourceCompositionError).diagnostics].map((item: ResourceDiagnostic) => item.code)
  }
  throw new Error("Expected ResourceCompositionError")
}

function tree(
  packageId: string,
  records: readonly ResourceRecord[],
  definitions: readonly RegisteredKindDefinition[],
): ResourceTree {
  const byKind = new Map<string, ResourceRecord[]>()
  for (const item of records) {
    const values = byKind.get(item.kind) ?? []
    values.push(item)
    byKind.set(item.kind, values)
  }
  return {
    manifest: record(packageId, "ResourcePackage", packageId),
    registry: {
      byKind,
      kindDefinitions: new Map(definitions.map((definition) => [definition.resourceKind, definition])),
    },
    diagnostics: [],
  }
}

function record(resourceId: string, kind: string, value: string): ResourceRecord {
  const node: ResourceNode = Object.freeze({
    tag: kind,
    resourceId,
    metadata: Object.freeze({ apiVersion: "halfcode.resources/v1" }),
    properties: Object.freeze({ value }),
    body: Object.freeze([]),
    subdomains: Object.freeze({}),
  })
  return Object.freeze({
    kind,
    resourceId,
    fqn: resourceId,
    metadata: Object.freeze({ apiVersion: "halfcode.resources/v1", version: "1.0.0" }),
    sourceShape: "single-file" as const,
    logicalPath: `${resourceId}.xnl`,
    documentUri: `vfs://@/${resourceId}.xnl`,
    format: "xnl" as const,
    node,
  })
}

function kindDefinition(
  resourceKind: string,
  documentUri = `vfs://@/KindDefinitions/${resourceKind}/manifest.xnl`,
  currentApiVersion = "halfcode.resources/v1",
): RegisteredKindDefinition {
  return Object.freeze({
    resourceId: `halfcode.resource_kind.${resourceKind}`,
    resourceKind,
    sourceShapes: Object.freeze(["single-file" as const]),
    requiredFiles: Object.freeze([]),
    currentApiVersion,
    supportedApiVersions: Object.freeze([currentApiVersion]),
    documentCardinality: "one" as const,
    documentUri,
  })
}
