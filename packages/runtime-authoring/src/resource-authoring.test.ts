import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  RESOURCE_ENVELOPE_VERSION,
  composeLayeredResourceRegistry,
  loadResourceTree,
  type AuthoredResourceTree,
  type EffectiveResourceRegistry,
  type KindSpecRevisionDescriptor,
} from "halfcode-compiler-resource-core"
import {
  RESOURCE_AUTHORING_SCHEMA_VERSION,
  ResourceAuthoringError,
  applyResourceAuthoring,
  deriveResourceAuthoringRegistryRevision,
  planResourceAuthoring,
  type ResourceAuthoringAuthorityInspector,
  type ResourceAuthoringPlan,
  type ResourceAuthoringPlanningAuthority,
  type ResourceAuthoringProposal,
  type ResourceAuthoringReceipt,
  type ResourceAuthoringRefreshCandidate,
  type ResourceAuthoringRuntime,
  type ResourceAuthoringTransactionPort,
} from "./resource-authoring"

const revision0 = `sha256:${"0".repeat(64)}`
const noteRevision = {
  specVersion: 1,
  schemaRef: "vfs://./spec-v1.schema.json",
  schemaFingerprint: `sha256:${"1".repeat(64)}`,
  contractFingerprint: `sha256:${"2".repeat(64)}`,
  semanticContract: {
    semanticValidatorFingerprint: `sha256:${"3".repeat(64)}`,
    referenceProjectionFingerprint: `sha256:${"4".repeat(64)}`,
    compilerInputFingerprint: `sha256:${"5".repeat(64)}`,
  },
  stability: "stable",
} as const satisfies KindSpecRevisionDescriptor

const inspector: ResourceAuthoringAuthorityInspector = {
  inspectAuthority({ documentUri, authorityText }) {
    const resources = [...authorityText.matchAll(/<([A-Za-z][A-Za-z0-9.]*) #([^\s]+) envelopeVersion="([^"]+)" specVersion=([0-9]+)/gu)]
      .map((match) => ({
        resourceId: match[2]!,
        kind: match[1]!,
        envelopeVersion: match[3]!,
        writerSpecVersion: Number(match[4]),
      }))
    return { documentUri, resources }
  },
}

const planning = (overrides: Partial<ResourceAuthoringPlanningAuthority> = {}): ResourceAuthoringPlanningAuthority => ({
  registryRevision: revision0,
  kindDefinitions: [{
    kind: "Note",
    specRevisions: [noteRevision],
    sourceShapes: ["single-file"],
    documentCardinality: "one",
  }],
  catalogs: [{
    catalogId: "root_notes",
    resourceKind: "Note",
    sourceShape: "single-file",
    rootUri: "vfs://@/Notes/",
  }],
  ...overrides,
})

function note(resourceId: string, value: string, writerSpecVersion = 1): string {
  return `<Note #${resourceId} envelopeVersion="${RESOURCE_ENVELOPE_VERSION}" specVersion=${writerSpecVersion} { description = "${value}" }>\n`
}

function proposal(
  authorityText = note("demo.runtime.note", "created"),
  overrides: Partial<ResourceAuthoringProposal> = {},
): ResourceAuthoringProposal {
  return {
    schemaVersion: RESOURCE_AUTHORING_SCHEMA_VERSION,
    operation: "create",
    catalogId: "root_notes",
    resourceId: "demo.runtime.note",
    kind: "Note",
    envelopeVersion: RESOURCE_ENVELOPE_VERSION,
    writerSpecVersion: 1,
    sourceShape: "single-file",
    documentUri: "vfs://@/Notes/Runtime.xnl",
    authorityText,
    expected: { state: "absent", registryRevision: revision0 },
    ...overrides,
  }
}

interface TestTransactionState {
  readonly port: ResourceAuthoringTransactionPort
  readonly effectCalls: string[]
  readonly candidateDirectories: Set<string>
  readonly receipts: Map<string, ResourceAuthoringReceipt>
  liveTree(): AuthoredResourceTree
  liveRegistry(): EffectiveResourceRegistry
  authorityDigest(): string | null
  registryRevision(): string
  inject: {
    refreshFailure: boolean
    refreshMismatch: boolean
    commitUncertain: boolean
  }
}

async function createTransactionState(options: {
  readonly initialAuthority?: string
  readonly documentCardinalityMany?: boolean
} = {}): Promise<TestTransactionState> {
  const liveRoot = await mkdtemp(join(tmpdir(), "halfcode-authoring-live-"))
  await mkdir(join(liveRoot, "KindDefinitions/Note"), { recursive: true })
  await mkdir(join(liveRoot, "Notes"), { recursive: true })
  await writeFile(join(liveRoot, "manifest.xnl"), [
    `<ResourcePackage #demo.runtime_authoring.package envelopeVersion="${RESOURCE_ENVELOPE_VERSION}" specVersion=1 (`,
    '  <Catalogs [',
    '    <Catalog #kind_definitions { kind = "KindDefinition" shape = "directory" root = "vfs://./KindDefinitions/" entry = "manifest.xnl" }>',
    '    <Catalog #root_notes { kind = "Note" shape = "single-file" root = "vfs://./Notes/" }>',
    '  ]>',
    ')>',
    '',
  ].join("\n"))
  await writeFile(join(liveRoot, "KindDefinitions/Note/manifest.xnl"), [
    `<KindDefinition #halfcode.resource_kind.Note envelopeVersion="${RESOURCE_ENVELOPE_VERSION}" specVersion=1 {`,
    '  resourceKind = "Note"',
    '  subjectFqn = "Halfcode.ResourceKind.Note"',
    '  sourceShapes = ["single-file"]',
    ...(options.documentCardinalityMany ? ['  documentCardinality = "many"'] : []),
    '} (',
    '  <SpecRevisions [',
    '    <SpecRevision #v1 {',
    '      specVersion = 1',
    `      schemaRef = "${noteRevision.schemaRef}"`,
    `      schemaFingerprint = "${noteRevision.schemaFingerprint}"`,
    `      contractFingerprint = "${noteRevision.contractFingerprint}"`,
    `      semanticValidatorFingerprint = "${noteRevision.semanticContract.semanticValidatorFingerprint}"`,
    `      referenceProjectionFingerprint = "${noteRevision.semanticContract.referenceProjectionFingerprint}"`,
    `      compilerInputFingerprint = "${noteRevision.semanticContract.compilerInputFingerprint}"`,
    '      stability = "stable"',
    '    }>',
    '  ]>',
    ')>',
    '',
  ].join("\n"))
  const targetPath = join(liveRoot, "Notes/Runtime.xnl")
  if (options.initialAuthority !== undefined) await writeFile(targetPath, options.initialAuthority)
  let tree = await loadResourceTree({ rootDir: liveRoot })
  let registry = composeLayeredResourceRegistry({ layers: [{ id: "workspace", tree }] })
  let currentAuthorityDigest = options.initialAuthority === undefined ? null : digest(options.initialAuthority)
  let currentRegistryRevision = revision0
  let sequence = 0
  const prepared = new Map<string, {
    readonly transactionId: string
    readonly planDigest: string
    readonly authorityText: string
    readonly authorityDigest: string
    readonly authorityDigestBefore: string | null
    readonly registryRevisionBefore: string
    candidate?: ResourceAuthoringRefreshCandidate
    candidateRoot?: string
  }>()
  const transactionByPlan = new Map<string, string>()
  const lockedTargets = new Set<string>()
  const receipts = new Map<string, ResourceAuthoringReceipt>()
  const effectCalls: string[] = []
  const candidateDirectories = new Set<string>()
  const inject = { refreshFailure: false, refreshMismatch: false, commitUncertain: false }

  const port: ResourceAuthoringTransactionPort = {
    async loadReceipt(planDigest) {
      effectCalls.push("loadReceipt")
      return receipts.get(planDigest)
    },
    async prepare(input) {
      effectCalls.push("prepare")
      const replayId = transactionByPlan.get(input.planDigest)
      if (replayId) {
        const replay = prepared.get(replayId)!
        return {
          transactionId: replay.transactionId,
          planDigest: replay.planDigest,
          authorityDigestBefore: replay.authorityDigestBefore,
          registryRevisionBefore: replay.registryRevisionBefore,
        }
      }
      if (lockedTargets.has(input.documentUri)) {
        throw new ResourceAuthoringError("RESOURCE_AUTHORING_CAS_CONFLICT", "Target is already prepared.")
      }
      if (input.expected.registryRevision !== currentRegistryRevision) {
        throw new ResourceAuthoringError("RESOURCE_AUTHORING_CAS_CONFLICT", "Registry revision is stale.")
      }
      if (input.expected.state === "absent" ? currentAuthorityDigest !== null : currentAuthorityDigest !== input.expected.authorityDigest) {
        throw new ResourceAuthoringError("RESOURCE_AUTHORING_CAS_CONFLICT", "Authority digest is stale.")
      }
      lockedTargets.add(input.documentUri)
      const transactionId = `tx-${++sequence}`
      const state = {
        transactionId,
        planDigest: input.planDigest,
        authorityText: input.authorityText,
        authorityDigest: input.authorityDigest,
        authorityDigestBefore: currentAuthorityDigest,
        registryRevisionBefore: currentRegistryRevision,
      }
      prepared.set(transactionId, state)
      transactionByPlan.set(input.planDigest, transactionId)
      return {
        transactionId,
        planDigest: input.planDigest,
        authorityDigestBefore: currentAuthorityDigest,
        registryRevisionBefore: currentRegistryRevision,
      }
    },
    async refreshCandidate(input) {
      effectCalls.push("refreshCandidate")
      const state = prepared.get(input.transactionId)
      if (!state || state.planDigest !== input.planDigest) throw new Error("unknown prepared transaction")
      if (inject.refreshFailure) throw new Error("injected canonical refresh failure")
      const candidateRoot = await mkdtemp(join(tmpdir(), "halfcode-authoring-candidate-"))
      candidateDirectories.add(candidateRoot)
      await cp(liveRoot, candidateRoot, { recursive: true })
      await writeFile(join(candidateRoot, "Notes/Runtime.xnl"), state.authorityText)
      const candidateTree = await loadResourceTree({ rootDir: candidateRoot })
      const candidateRegistry = composeLayeredResourceRegistry({ layers: [{ id: "workspace", tree: candidateTree }] })
      const candidate = {
        transactionId: state.transactionId,
        candidateId: `candidate-${state.transactionId}`,
        targetLayerId: inject.refreshMismatch ? "foreign" : "workspace",
        tree: candidateTree,
        registry: candidateRegistry,
        layers: [{ id: "workspace", tree: candidateTree }],
      } satisfies ResourceAuthoringRefreshCandidate
      state.candidate = candidate
      state.candidateRoot = candidateRoot
      return candidate
    },
    async commit(input) {
      effectCalls.push("commit")
      const state = prepared.get(input.transactionId)
      if (!state || state.candidate?.candidateId !== input.candidateId) throw new Error("unknown candidate")
      await writeFile(targetPath, state.authorityText)
      tree = state.candidate.tree
      registry = state.candidate.registry
      currentAuthorityDigest = state.authorityDigest
      currentRegistryRevision = input.receipt.registryRevisionAfter
      receipts.set(input.receipt.planDigest, input.receipt)
      lockedTargets.clear()
      if (state.candidateRoot) {
        await rm(state.candidateRoot, { recursive: true, force: true })
        candidateDirectories.delete(state.candidateRoot)
      }
      if (inject.commitUncertain) throw new Error("injected response loss after commit")
      return input.receipt
    },
    async rollback(input) {
      effectCalls.push("rollback")
      if (receipts.has(input.planDigest)) return
      const state = prepared.get(input.transactionId)
      if (!state || state.planDigest !== input.planDigest) return
      lockedTargets.clear()
      transactionByPlan.delete(input.planDigest)
      prepared.delete(input.transactionId)
      if (state.candidateRoot) {
        await rm(state.candidateRoot, { recursive: true, force: true })
        candidateDirectories.delete(state.candidateRoot)
      }
    },
  }
  return {
    port,
    effectCalls,
    candidateDirectories,
    receipts,
    liveTree: () => tree,
    liveRegistry: () => registry,
    authorityDigest: () => currentAuthorityDigest,
    registryRevision: () => currentRegistryRevision,
    inject,
  }
}

function runtime(
  state: TestTransactionState,
  planningAuthority: ResourceAuthoringPlanningAuthority = planning(),
): ResourceAuthoringRuntime {
  return { ...inspector, planningAuthority, transaction: state.port }
}

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`
}

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  const entries = Object.entries(value as Readonly<Record<string, unknown>>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`
}

describe("transactional runtime resource authoring", () => {
  test("derives the planning CAS revision only from authentic content-sensitive projections", async () => {
    const state = await createTransactionState()
    const revision = deriveResourceAuthoringRegistryRevision({
      registry: state.liveRegistry(),
      layers: [{ id: "workspace", tree: state.liveTree() }],
    })
    expect(revision).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(() => deriveResourceAuthoringRegistryRevision({
      registry: { ...state.liveRegistry() },
      layers: [{ id: "workspace", tree: state.liveTree() }],
    })).toThrow(expect.objectContaining({ code: "RESOURCE_AUTHORING_REFRESH_INVALID" }))
  })

  test("plans deterministically from closed authority and performs zero effects", async () => {
    const state = await createTransactionState()
    const first = planResourceAuthoring(runtime(state), proposal(), {})
    const secondAuthority = planning({
      catalogs: [...planning().catalogs].reverse(),
      kindDefinitions: [...planning().kindDefinitions].reverse(),
    })
    const second = planResourceAuthoring(runtime(state, secondAuthority), proposal(), {})
    expect(first).toEqual(second)
    expect(first.authorityDigest).toBe(digest(first.proposal.authorityText))
    expect(first.proposal.writerSpecVersion).toBe(1)
    expect(first.writerSpecRevision).toEqual(noteRevision)
    expect(first.proposal.authorityText).toContain(`envelopeVersion="${RESOURCE_ENVELOPE_VERSION}" specVersion=1`)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.resources)).toBe(true)
    expect(state.effectCalls).toEqual([])
  })

  test("accepts canonical Unicode catalog and document identities without lossy normalization", async () => {
    const state = await createTransactionState()
    const authority = planning({
      catalogs: [{
        catalogId: "notes", resourceKind: "Note", sourceShape: "single-file", rootUri: "vfs://@/笔记/",
      }],
    })
    const plan = planResourceAuthoring(runtime(state, authority), proposal(undefined, {
      catalogId: "notes",
      documentUri: "vfs://@/笔记/运行时说明.xnl",
    }), {})
    expect(plan.proposal.documentUri).toBe("vfs://@/笔记/运行时说明.xnl")
    expect(state.effectCalls).toEqual([])
  })

  test.each([
    ["unknown Kind", proposal(undefined, { kind: "Unknown" }), planning(), "RESOURCE_AUTHORING_KIND_UNKNOWN"],
    ["unregistered writer specVersion", proposal(note("demo.runtime.note", "created", 2), { writerSpecVersion: 2 }), planning(), "RESOURCE_AUTHORING_WRITER_SPEC_VERSION_UNREGISTERED"],
    ["missing catalog", proposal(undefined, { catalogId: "missing" }), planning(), "RESOURCE_AUTHORING_CATALOG_UNKNOWN"],
    ["unsafe logical URI", proposal(undefined, { documentUri: "vfs://@/../escape.xnl" }), planning(), "RESOURCE_AUTHORING_TARGET_UNSAFE"],
    ["foreign catalog target", proposal(undefined, { documentUri: "vfs://@/Other/Runtime.xnl" }), planning(), "RESOURCE_AUTHORING_CATALOG_MISMATCH"],
    ["stale registry", proposal(undefined, { expected: { state: "absent", registryRevision: `sha256:${"1".repeat(64)}` } }), planning(), "RESOURCE_AUTHORING_EXPECTED_STATE_INVALID"],
    ["authority identity mismatch", proposal(note("demo.other.note", "created")), planning(), "RESOURCE_AUTHORING_AUTHORITY_INVALID"],
    ["authority writer version mismatch", proposal(note("demo.runtime.note", "created", 2)), planning(), "RESOURCE_AUTHORING_AUTHORITY_INVALID"],
  ])("rejects %s before invoking an effect", async (_name, candidate, authority, code) => {
    const state = await createTransactionState()
    expect(() => planResourceAuthoring(runtime(state, authority), candidate as ResourceAuthoringProposal, {})).toThrow(
      expect.objectContaining({ code }),
    )
    expect(state.effectCalls).toEqual([])
  })

  test("rejects unsupported shapes and accessor-bearing proposal data before inspection", async () => {
    let inspected = false
    const guardedInspector: ResourceAuthoringAuthorityInspector = {
      inspectAuthority(input) { inspected = true; return inspector.inspectAuthority(input) },
    }
    const guardedRuntime = { ...guardedInspector, planningAuthority: planning() }
    expect(() => planResourceAuthoring(guardedRuntime, {
      ...proposal(), sourceShape: "directory",
    } as never, {})).toThrow(expect.objectContaining({ code: "RESOURCE_AUTHORING_SOURCE_SHAPE_UNSUPPORTED" }))
    const accessor = { ...proposal() } as Record<string, unknown>
    Object.defineProperty(accessor, "kind", { enumerable: true, get() { inspected = true; return "Note" } })
    expect(() => planResourceAuthoring(guardedRuntime, accessor as never, {})).toThrow(
      expect.objectContaining({ code: "RESOURCE_AUTHORING_INPUT_INVALID" }),
    )
    expect(inspected).toBe(false)
  })

  test("creates through canonical refresh, commits one durable receipt and replays idempotently", async () => {
    const state = await createTransactionState()
    const activeRuntime = runtime(state)
    const plan = planResourceAuthoring(activeRuntime, proposal(), {})
    const receipt = await applyResourceAuthoring(activeRuntime, plan, {})
    expect(receipt).toMatchObject({
      planDigest: plan.planDigest,
      resourceId: "demo.runtime.note",
      envelopeVersion: RESOURCE_ENVELOPE_VERSION,
      writerSpecVersion: 1,
      authorityDigestBefore: null,
      authorityDigestAfter: plan.authorityDigest,
      effectiveOrigin: { layerId: "workspace", documentUri: "vfs://@/Notes/Runtime.xnl" },
    })
    expect(state.liveTree().registry.byKind.get("Note")?.some((item) => item.resourceId === "demo.runtime.note")).toBe(true)
    expect(state.authorityDigest()).toBe(plan.authorityDigest)
    expect(state.candidateDirectories.size).toBe(0)
    const beforeReplay = [...state.effectCalls]
    expect(await applyResourceAuthoring(activeRuntime, plan, {})).toEqual(receipt)
    expect(state.effectCalls.slice(beforeReplay.length)).toEqual(["loadReceipt"])
  })

  test("uses authority/content CAS when compositionRevision intentionally stays stable", async () => {
    const oldAuthority = note("demo.runtime.note", "old")
    const nextAuthority = note("demo.runtime.note", "new")
    const state = await createTransactionState({ initialAuthority: oldAuthority })
    const oldCompositionRevision = state.liveRegistry().compositionRevision
    const updatePlanning = planning()
    const activeRuntime = runtime(state, updatePlanning)
    const plan = planResourceAuthoring(activeRuntime, proposal(nextAuthority, {
      operation: "update",
      expected: {
        state: "present",
        authorityDigest: digest(oldAuthority),
        registryRevision: revision0,
      },
    }), {})
    const receipt = await applyResourceAuthoring(activeRuntime, plan, {})
    expect(receipt.authorityDigestBefore).toBe(digest(oldAuthority))
    expect(receipt.authorityDigestAfter).toBe(digest(nextAuthority))
    expect(receipt.registryRevisionAfter).not.toBe(receipt.registryRevisionBefore)
    expect(state.liveRegistry().compositionRevision).toBe(oldCompositionRevision)
  })

  test("rolls back staging and preserves authority and live registry on refresh failure", async () => {
    const state = await createTransactionState()
    const beforeTree = state.liveTree()
    const beforeRegistry = state.liveRegistry()
    state.inject.refreshFailure = true
    const activeRuntime = runtime(state)
    const plan = planResourceAuthoring(activeRuntime, proposal(), {})
    await expect(applyResourceAuthoring(activeRuntime, plan, {})).rejects.toThrow(
      expect.objectContaining({ code: "RESOURCE_AUTHORING_REFRESH_INVALID" }),
    )
    expect(state.authorityDigest()).toBeNull()
    expect(state.registryRevision()).toBe(revision0)
    expect(state.liveTree()).toBe(beforeTree)
    expect(state.liveRegistry()).toBe(beforeRegistry)
    expect(state.candidateDirectories.size).toBe(0)
    expect(state.effectCalls).toContain("rollback")
  })

  test("rejects a mismatched canonical candidate and restores the prepared transaction", async () => {
    const state = await createTransactionState()
    state.inject.refreshMismatch = true
    const activeRuntime = runtime(state)
    const plan = planResourceAuthoring(activeRuntime, proposal(), {})
    await expect(applyResourceAuthoring(activeRuntime, plan, {})).rejects.toThrow(
      expect.objectContaining({ code: "RESOURCE_AUTHORING_REFRESH_INVALID" }),
    )
    expect(state.authorityDigest()).toBeNull()
    expect(state.candidateDirectories.size).toBe(0)
  })

  test("recovers an uncertain commit from the atomically persisted receipt", async () => {
    const state = await createTransactionState()
    state.inject.commitUncertain = true
    const activeRuntime = runtime(state)
    const plan = planResourceAuthoring(activeRuntime, proposal(), {})
    const receipt = await applyResourceAuthoring(activeRuntime, plan, {})
    expect(state.receipts.get(plan.planDigest)).toEqual(receipt)
    expect(state.authorityDigest()).toBe(plan.authorityDigest)
    expect(state.effectCalls.at(-1)).toBe("loadReceipt")
    expect(state.effectCalls).not.toContain("rollback")
  })

  test("rejects a structurally valid but content-tampered durable replay receipt", async () => {
    const state = await createTransactionState()
    const activeRuntime = runtime(state)
    const plan = planResourceAuthoring(activeRuntime, proposal(), {})
    const receipt = await applyResourceAuthoring(activeRuntime, plan, {})
    state.receipts.set(plan.planDigest, {
      ...receipt,
      contentDigest: `sha256:${"f".repeat(64)}`,
    })
    const beforeReplay = state.effectCalls.length
    await expect(applyResourceAuthoring(activeRuntime, plan, {})).rejects.toThrow(
      expect.objectContaining({ code: "RESOURCE_AUTHORING_COMMIT_INVALID" }),
    )
    expect(state.effectCalls.slice(beforeReplay)).toEqual(["loadReceipt"])
  })

  test("admits only one of two concurrent creates for one authority target", async () => {
    const state = await createTransactionState()
    const activeRuntime = runtime(state)
    const first = planResourceAuthoring(activeRuntime, proposal(note("demo.runtime.note", "first")), {})
    const second = planResourceAuthoring(activeRuntime, proposal(note("demo.runtime.note", "second")), {})
    const outcomes = await Promise.allSettled([
      applyResourceAuthoring(activeRuntime, first, {}),
      applyResourceAuthoring(activeRuntime, second, {}),
    ])
    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1)
    expect(outcomes.filter((item) => item.status === "rejected")).toHaveLength(1)
    expect(outcomes.find((item) => item.status === "rejected")).toMatchObject({
      reason: { code: "RESOURCE_AUTHORING_CAS_CONFLICT" },
    })
    expect(state.receipts.size).toBe(1)
  })

  test("admits only one of two concurrent updates from the same authority and registry revision", async () => {
    const oldAuthority = note("demo.runtime.note", "old")
    const state = await createTransactionState({ initialAuthority: oldAuthority })
    const expected = {
      state: "present" as const,
      authorityDigest: digest(oldAuthority),
      registryRevision: revision0,
    }
    const activeRuntime = runtime(state)
    const first = planResourceAuthoring(activeRuntime, proposal(note("demo.runtime.note", "first"), {
      operation: "update", expected,
    }), {})
    const second = planResourceAuthoring(activeRuntime, proposal(note("demo.runtime.note", "second"), {
      operation: "update", expected,
    }), {})
    const outcomes = await Promise.allSettled([
      applyResourceAuthoring(activeRuntime, first, {}),
      applyResourceAuthoring(activeRuntime, second, {}),
    ])
    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1)
    expect(outcomes.filter((item) => item.status === "rejected")).toHaveLength(1)
    expect(outcomes.find((item) => item.status === "rejected")).toMatchObject({
      reason: { code: "RESOURCE_AUTHORING_CAS_CONFLICT" },
    })
    expect(state.receipts.size).toBe(1)
  })

  test("rejects a stale update without staging or changing the live projection", async () => {
    const oldAuthority = note("demo.runtime.note", "old")
    const state = await createTransactionState({ initialAuthority: oldAuthority })
    const beforeTree = state.liveTree()
    const activeRuntime = runtime(state)
    const plan = planResourceAuthoring(activeRuntime, proposal(note("demo.runtime.note", "new"), {
      operation: "update",
      expected: {
        state: "present",
        authorityDigest: `sha256:${"f".repeat(64)}`,
        registryRevision: revision0,
      },
    }), {})
    await expect(applyResourceAuthoring(activeRuntime, plan, {})).rejects.toThrow(
      expect.objectContaining({ code: "RESOURCE_AUTHORING_CAS_CONFLICT" }),
    )
    expect(state.liveTree()).toBe(beforeTree)
    expect(state.authorityDigest()).toBe(digest(oldAuthority))
    expect(state.effectCalls).not.toContain("refreshCandidate")
  })

  test("rejects a modified or re-digested plan against trusted planning authority before prepare", async () => {
    const state = await createTransactionState()
    const activeRuntime = runtime(state)
    const plan = planResourceAuthoring(activeRuntime, proposal(), {})
    const unsigned = {
      ...plan,
      proposal: { ...plan.proposal, catalogId: "missing" },
    } as Record<string, unknown>
    delete unsigned.planDigest
    const forged = { ...unsigned, planDigest: digest(canonical(unsigned)) } as unknown as ResourceAuthoringPlan
    await expect(applyResourceAuthoring(activeRuntime, forged, {})).rejects.toThrow(
      expect.objectContaining({ code: "RESOURCE_AUTHORING_PLAN_FORGED" }),
    )
    expect(state.effectCalls).toEqual([])
  })

  test("treats a many-root document as one whole-authority CAS unit", async () => {
    const state = await createTransactionState({ documentCardinalityMany: true })
    const authority = [
      note("demo.runtime.note.a", "A"),
      note("demo.runtime.note.b", "B"),
    ].join("")
    const manyPlanning = planning({
      kindDefinitions: [{
        kind: "Note", specRevisions: [noteRevision],
        sourceShapes: ["single-file"], documentCardinality: "many",
      }],
    })
    const activeRuntime = runtime(state, manyPlanning)
    const plan = planResourceAuthoring(activeRuntime, proposal(authority, {
      resourceId: "demo.runtime.note.a",
    }), {})
    const receipt = await applyResourceAuthoring(activeRuntime, plan, {})
    expect(receipt.authorityResourceIds).toEqual(["demo.runtime.note.a", "demo.runtime.note.b"])
    expect(state.authorityDigest()).toBe(plan.authorityDigest)
    expect(state.liveTree().contentIdentities.get("demo.runtime.note.a")?.authorityDigest).toBe(plan.authorityDigest)
    expect(state.liveTree().contentIdentities.get("demo.runtime.note.b")?.authorityDigest).toBe(plan.authorityDigest)
    expect(state.candidateDirectories.size).toBe(0)
  })

  test("keeps the production resource transaction free of consumer vocabulary", async () => {
    const source = await readFile(join(import.meta.dir, "resource-authoring.ts"), "utf8")
    for (const forbidden of ["AIAgentDefinition", "AIData", "Workflow", "CapabilityCatalog", "Eidolon"]) {
      expect(source).not.toContain(forbidden)
    }
  })
})
