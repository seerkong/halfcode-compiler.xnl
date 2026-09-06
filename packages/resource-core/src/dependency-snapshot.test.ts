import { describe, expect, test } from "bun:test"
import { canonicalJson } from "./canonical"
import {
  ResourceCompositionError,
  buildResourceDependencySnapshot,
  composeLayeredResourceRegistry,
  createResourceContentIdentity,
  sha256Digest,
  type RegisteredKindDefinition,
  type ResourceContentIdentity,
  type ResourceDiagnostic,
  type ResourceNode,
  type ResourceRecord,
  type ResourceTree,
} from "./index"

describe("explicit resource dependency snapshots", () => {
  test("builds a deterministic closure only from typed edges", () => {
    const root = record("demo.root", "Note", "resource://demo.untyped")
    const dependency = record("demo.dependency", "Note", "dependency")
    const leaf = record("demo.leaf", "Note", "leaf")
    const untyped = record("demo.untyped", "Note", "untyped")
    const registry = composeLayeredResourceRegistry({
      layers: [{ id: "base", tree: tree("demo.package", [untyped, leaf, root, dependency]) }],
    })
    const identities = new Map([
      ["demo.root", identity("demo.root", "root", [["prompt", "prompt-a"]])],
      ["demo.dependency", identity("demo.dependency", "dependency")],
      ["demo.leaf", identity("demo.leaf", "leaf")],
      ["demo.untyped", identity("demo.untyped", "untyped")],
    ])
    const edges = [
      { fromResourceId: "demo.root", toResourceId: "demo.dependency", relation: "uses", declaredBy: "NoteContract" },
      { fromResourceId: "demo.dependency", toResourceId: "demo.leaf", relation: "uses", declaredBy: "NoteContract" },
    ] as const

    const snapshot = buildResourceDependencySnapshot({
      registry,
      roots: ["demo.root"],
      edges: [...edges].reverse(),
      contentIdentities: new Map([...identities].reverse()),
    })
    expect(snapshot.roots).toEqual(["demo.root"])
    expect(snapshot.closure.map((item) => item.resourceId)).toEqual([
      "demo.dependency",
      "demo.leaf",
      "demo.root",
    ])
    expect(snapshot.closure.some((item) => item.resourceId === "demo.untyped")).toBe(false)
    expect(snapshot.edges.map((edge) => `${edge.fromResourceId}->${edge.toResourceId}`)).toEqual([
      "demo.dependency->demo.leaf",
      "demo.root->demo.dependency",
    ])
    expect(registry.compositionRevision).toBe(registry.revision)
    expect(snapshot.registryRevision).not.toBe(registry.compositionRevision)
    expect(snapshot.registryRevision).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(snapshot.snapshotRevision).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.closure)).toBe(true)

    const repeated = buildResourceDependencySnapshot({
      registry,
      roots: ["demo.root"],
      edges,
      contentIdentities: identities,
    })
    expect(repeated.snapshotRevision).toBe(snapshot.snapshotRevision)
  })

  test("canonicalizes explicit digest contributions independent of input order", () => {
    const first = createResourceContentIdentity({
      resourceId: "demo.root",
      authorityDigest: sha256Digest("authority"),
      contributions: [
        { key: "schema", digest: sha256Digest("schema"), sourceUri: "vfs://@/schema.xnl" },
        { key: "prompt", digest: sha256Digest("prompt"), sourceUri: "vfs://@/prompt.md" },
      ],
    })
    const second = createResourceContentIdentity({
      resourceId: "demo.root",
      authorityDigest: sha256Digest("authority"),
      contributions: [
        { key: "prompt", digest: sha256Digest("prompt"), sourceUri: "vfs://@/prompt.md" },
        { key: "schema", digest: sha256Digest("schema"), sourceUri: "vfs://@/schema.xnl" },
      ],
    })

    expect(first.contributions.map((item) => item.key)).toEqual(["prompt", "schema"])
    expect(second.contentDigest).toBe(first.contentDigest)
    expect(first.contentDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  test("uses a fixed UTF-16 code-unit order for Unicode digest keys and closure ids", () => {
    expect(canonicalJson({ "😀": 4, "Ä": 3, a: 2, Z: 1 })).toBe('{"Z":1,"a":2,"Ä":3,"😀":4}')
    const content = createResourceContentIdentity({
      resourceId: "demo.Z",
      authorityDigest: sha256Digest("authority"),
      contributions: ["😀", "Ä", "a", "Z"].map((key) => ({ key, digest: sha256Digest(key) })),
    })
    expect(content.contributions.map((item) => item.key)).toEqual(["Z", "a", "Ä", "😀"])

    const records = ["demo.😀", "demo.Ä", "demo.a", "demo.Z"].map((resourceId) =>
      record(resourceId, "Note", resourceId),
    )
    const registry = composeLayeredResourceRegistry({ layers: [{ id: "unicode", tree: tree("demo.unicode", records) }] })
    const identities = new Map(records.map((item) => [item.resourceId, identity(item.resourceId, item.resourceId)]))
    const snapshot = buildResourceDependencySnapshot({
      registry,
      roots: records.map((item) => item.resourceId),
      edges: [],
      contentIdentities: identities,
    })
    expect(snapshot.closure.map((item) => item.resourceId)).toEqual([
      "demo.Z",
      "demo.a",
      "demo.Ä",
      "demo.😀",
    ])
  })

  test("revalidates reconstructed content identity facts and rejects inconsistent digests", () => {
    const registry = composeLayeredResourceRegistry({
      layers: [{ id: "base", tree: tree("demo.package", [record("demo.root", "Note", "root")]) }],
    })
    const valid = identity("demo.root", "authority", [["prompt", "prompt"]])
    const inconsistentIdentity = Object.freeze({
      ...valid,
      contentDigest: `sha256:${"0".repeat(64)}`,
    }) as ResourceContentIdentity

    expect(diagnosticCodes(() => buildResourceDependencySnapshot({
      registry,
      roots: ["demo.root"],
      edges: [],
      contentIdentities: new Map([["demo.root", inconsistentIdentity]]),
    }))).toContain("RESOURCE_CONTENT_DIGEST_MISMATCH")

    const invalidAuthority = Object.freeze({ ...valid, authorityDigest: "sha256:not-a-digest" }) as ResourceContentIdentity
    expect(diagnosticCodes(() => buildResourceDependencySnapshot({
      registry,
      roots: ["demo.root"],
      edges: [],
      contentIdentities: new Map([["demo.root", invalidAuthority]]),
    }))).toContain("RESOURCE_CONTENT_AUTHORITY_DIGEST_INVALID")

    const invalidContribution = Object.freeze({
      ...valid,
      contributions: Object.freeze([{ key: "prompt", digest: "sha256:not-a-digest" }]),
    }) as ResourceContentIdentity
    expect(diagnosticCodes(() => buildResourceDependencySnapshot({
      registry,
      roots: ["demo.root"],
      edges: [],
      contentIdentities: new Map([["demo.root", invalidContribution]]),
    }))).toContain("RESOURCE_DIGEST_CONTRIBUTION_INVALID")

    const conflictingContributions = Object.freeze({
      ...valid,
      contributions: Object.freeze([
        { key: "prompt", digest: sha256Digest("one") },
        { key: "prompt", digest: sha256Digest("two") },
      ]),
    }) as ResourceContentIdentity
    expect(diagnosticCodes(() => buildResourceDependencySnapshot({
      registry,
      roots: ["demo.root"],
      edges: [],
      contentIdentities: new Map([["demo.root", conflictingContributions]]),
    }))).toContain("RESOURCE_DIGEST_CONTRIBUTION_CONFLICT")

    const duplicateContributions = Object.freeze({
      ...valid,
      contributions: Object.freeze([
        { key: "prompt", digest: sha256Digest("same"), sourceUri: "vfs://@/one.md" },
        { key: "prompt", digest: sha256Digest("same"), sourceUri: "vfs://@/two.md" },
      ]),
      contentDigest: createResourceContentIdentity({
        resourceId: valid.resourceId,
        authorityDigest: valid.authorityDigest,
        contributions: [{ key: "prompt", digest: sha256Digest("same") }],
      }).contentDigest,
    }) as ResourceContentIdentity
    expect(diagnosticCodes(() => buildResourceDependencySnapshot({
      registry,
      roots: ["demo.root"],
      edges: [],
      contentIdentities: new Map([["demo.root", duplicateContributions]]),
    }))).toContain("RESOURCE_DIGEST_CONTRIBUTION_DUPLICATE")
  })

  test("requires validated identities for every effective resource and binds material to registry revision", () => {
    const registry = composeLayeredResourceRegistry({
      layers: [{ id: "base", tree: tree("demo.package", [
        record("demo.root", "Note", "root"),
        record("demo.unused", "Note", "unused"),
      ]) }],
    })
    const rootIdentity = identity("demo.root", "root")

    expect(diagnosticCodes(() => buildResourceDependencySnapshot({
      registry,
      roots: ["demo.root"],
      edges: [],
      contentIdentities: new Map([["demo.root", rootIdentity]]),
    }))).toContain("RESOURCE_CONTENT_IDENTITY_MISSING")

    const first = buildResourceDependencySnapshot({
      registry,
      roots: ["demo.root"],
      edges: [],
      contentIdentities: new Map([
        ["demo.root", rootIdentity],
        ["demo.unused", identity("demo.unused", "unused", [["material", "one"]])],
      ]),
    })
    const second = buildResourceDependencySnapshot({
      registry,
      roots: ["demo.root"],
      edges: [],
      contentIdentities: new Map([
        ["demo.root", rootIdentity],
        ["demo.unused", identity("demo.unused", "unused", [["material", "two"]])],
      ]),
    })

    expect(first.closure.map((item) => item.resourceId)).toEqual(["demo.root"])
    expect(second.closure.map((item) => item.resourceId)).toEqual(["demo.root"])
    expect(first.registryRevision).not.toBe(second.registryRevision)
    expect(first.snapshotRevision).not.toBe(second.snapshotRevision)
    expect(registry.compositionRevision).toBe(registry.revision)
  })

  test("rejects unauthenticated registry projections and owns frozen snapshot origins", () => {
    const registry = composeLayeredResourceRegistry({
      layers: [{ id: "base", tree: tree("demo.package", [record("demo.root", "Note", "root")]) }],
    })
    const rootIdentity = identity("demo.root", "root")
    const inconsistentRegistry = Object.freeze({
      ...registry,
      compositionRevision: sha256Digest("inconsistent-composition"),
      revision: sha256Digest("different-alias"),
    }) as typeof registry

    expect(diagnosticCodes(() => buildResourceDependencySnapshot({
      registry: inconsistentRegistry,
      roots: ["demo.root"],
      edges: [],
      contentIdentities: new Map([["demo.root", rootIdentity]]),
    }))).toContain("RESOURCE_EFFECTIVE_REGISTRY_UNTRUSTED")

    const snapshot = buildResourceDependencySnapshot({
      registry,
      roots: ["demo.root"],
      edges: [],
      contentIdentities: new Map([["demo.root", rootIdentity]]),
    })
    const registryOrigin = registry.byId.get("demo.root")!.effectiveOrigin!
    expect(snapshot.closure[0]!.origin).not.toBe(registryOrigin)
    expect(snapshot.closure[0]!.origin).toEqual(registryOrigin)
    expect(Object.isFrozen(snapshot.closure[0]!.origin)).toBe(true)
  })

  test("fails closed for conflicting contributions, missing endpoints, and dependency cycles", () => {
    expect(diagnosticCodes(() => createResourceContentIdentity({
      resourceId: "demo.root",
      authorityDigest: sha256Digest("authority"),
      contributions: [
        { key: "prompt", digest: sha256Digest("one") },
        { key: "prompt", digest: sha256Digest("two") },
      ],
    }))).toContain("RESOURCE_DIGEST_CONTRIBUTION_CONFLICT")

    const registry = composeLayeredResourceRegistry({
      layers: [{ id: "base", tree: tree("demo.package", [
        record("demo.root", "Note", "root"),
        record("demo.dependency", "Note", "dependency"),
      ]) }],
    })
    const contentIdentities = new Map([
      ["demo.root", identity("demo.root", "root")],
      ["demo.dependency", identity("demo.dependency", "dependency")],
    ])

    expect(diagnosticCodes(() => buildResourceDependencySnapshot({
      registry,
      roots: ["demo.root"],
      edges: [{ fromResourceId: "demo.root", toResourceId: "demo.missing", relation: "uses", declaredBy: "NoteContract" }],
      contentIdentities,
    }))).toContain("RESOURCE_DEPENDENCY_TARGET_MISSING")

    expect(diagnosticCodes(() => buildResourceDependencySnapshot({
      registry,
      roots: ["demo.root"],
      edges: [
        { fromResourceId: "demo.root", toResourceId: "demo.dependency", relation: "uses", declaredBy: "NoteContract" },
        { fromResourceId: "demo.dependency", toResourceId: "demo.root", relation: "uses", declaredBy: "NoteContract" },
      ],
      contentIdentities,
    }))).toContain("RESOURCE_DEPENDENCY_CYCLE")
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

function identity(resourceId: string, authority: string, contributions: readonly (readonly [string, string])[] = []) {
  return createResourceContentIdentity({
    resourceId,
    authorityDigest: sha256Digest(authority),
    contributions: contributions.map(([key, value]) => ({ key, digest: sha256Digest(value) })),
  })
}

function tree(packageId: string, records: readonly ResourceRecord[]): ResourceTree {
  return {
    manifest: record(packageId, "ResourcePackage", packageId),
    registry: {
      byKind: new Map([["Note", records.filter((item) => item.kind === "Note")]]),
      kindDefinitions: new Map([["Note", kindDefinition("Note")]]),
    },
    diagnostics: [],
  }
}

function record(resourceId: string, kind: string, value: string): ResourceRecord {
  const node: ResourceNode = Object.freeze({
    tag: kind,
    resourceId,
    metadata: Object.freeze({ envelopeVersion: "halfcode.resource-envelope/v1", specVersion: 1 }),
    properties: Object.freeze({ value }),
    body: Object.freeze([]),
    subdomains: Object.freeze({}),
  })
  return Object.freeze({
    kind,
    resourceId,
    fqn: resourceId,
    metadata: Object.freeze({ envelopeVersion: "halfcode.resource-envelope/v1", specVersion: 1 }),
    sourceShape: "single-file" as const,
    logicalPath: `${resourceId}.xnl`,
    documentUri: `vfs://@/${resourceId}.xnl`,
    format: "xnl" as const,
    node,
  })
}

function kindDefinition(resourceKind: string): RegisteredKindDefinition {
  return Object.freeze({
    resourceId: `halfcode.resource_kind.${resourceKind}`,
    resourceKind,
    subjectFqn: `Halfcode.ResourceKind.${resourceKind}`,
    sourceShapes: Object.freeze(["single-file" as const]),
    requiredFiles: Object.freeze([]),
    specRevisions: Object.freeze([Object.freeze({
      specVersion: 1,
      schemaRef: "vfs://./spec-v1.schema.json",
      schemaFingerprint: `sha256:${"1".repeat(64)}` as const,
      contractFingerprint: `sha256:${"2".repeat(64)}` as const,
      semanticContract: Object.freeze({
        semanticValidatorFingerprint: `sha256:${"3".repeat(64)}` as const,
        referenceProjectionFingerprint: `sha256:${"4".repeat(64)}` as const,
        compilerInputFingerprint: `sha256:${"5".repeat(64)}` as const,
      }),
      stability: "stable" as const,
    })]),
    documentCardinality: "one" as const,
    documentUri: `vfs://@/KindDefinitions/${resourceKind}/manifest.xnl`,
  })
}
