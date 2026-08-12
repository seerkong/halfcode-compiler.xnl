import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { halfcodeResourceDslSystemSkillModule } from "../../../apps/halfcode-resource-dsl-system-skill/src/index"
import {
  loadApplicationAssembly,
  resolveApplicationAssembly,
  type ApplicationAssembly,
  type AssemblyResource,
  type ContractedCallableResource,
  type ObjectOperationDefinition,
  type SkillCapsuleResource,
  type TextResource,
} from "halfcode-compiler-application-assembly"
import { createMockRuntime } from "halfcode-compiler-runtime-testing"
import {
  applySkillCapsuleDistributionPlan,
  compileResourceSkillCapsule,
  compileSkillCapsule,
  planSkillCapsuleDistribution,
  SkillCapsuleDistributionError,
  skillCapsuleDistributionProjection,
  type PlannedSkillFile,
  type SkillCapsuleDistributionPlan,
} from "./index"

const xnlAssemblyRoot = join(import.meta.dir, "../../application-assembly/tests/fixtures/XnlAssembly")
const resourceDslRoot = join(import.meta.dir, "../../../docs/resource-dsl")

test("compileSkillCapsule writes deterministic Skill output and removes stale files", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "skill-capsule-"))
  await writeFile(join(outputDir, "stale.txt"), "stale")

  const plan = await compileSkillCapsule({
    outputDir,
    skill: {
      name: "demo-resource-workflow",
      description: "Demo resource workflow Skill.",
      instructions: "Use resource workflow references.",
    },
    registry: {
      byKind: new Map([
        ["Procedure", [{
          kind: "Procedure",
          sourceShape: "directory",
          logicalPath: "vfs://@/Procedures/Prepare/manifest.xnl",
          fqn: "Demo.ResourceWorkflow.Procedure.Prepare",
          description: "Prepare a resource workflow procedure.",
          format: "xnl",
          node: { tag: "Procedure", metadata: {}, properties: {}, body: [], subdomains: {} },
        }]],
      ]),
    },
    references: [{ path: "workflow/overview.md", content: "# Workflow Overview\n" }],
  })

  expect(plan.files).toEqual(["SKILL.md", "references/workflow/overview.md"])
  const skill = await readFile(join(outputDir, "SKILL.md"), "utf8")
  expect(skill).toContain("Demo.ResourceWorkflow.Procedure.Prepare")
  expect(skill).toContain("references/workflow/overview.md")
  await expect(readFile(join(outputDir, "stale.txt"), "utf8")).rejects.toThrow()
})

test("compileSkillCapsule lists multiple references once and uses code-unit resource ordering", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "skill-capsule-order-"))
  await compileSkillCapsule({
    outputDir,
    skill: { name: "ordering", description: "Canonical ordering fixture." },
    registry: {
      byKind: new Map([
        ["ä-kind", [{
          kind: "ä-kind",
          sourceShape: "single-file",
          logicalPath: "vfs://@/ä.xnl",
          fqn: "ä.record",
          description: "umlaut",
          format: "xnl",
          node: { tag: "ä-kind", metadata: {}, properties: {}, body: [], subdomains: {} },
        }]],
        ["z-kind", [{
          kind: "z-kind",
          sourceShape: "single-file",
          logicalPath: "vfs://@/z.xnl",
          fqn: "z.record",
          description: "ascii",
          format: "xnl",
          node: { tag: "z-kind", metadata: {}, properties: {}, body: [], subdomains: {} },
        }]],
      ]),
    },
    references: [
      { path: "z.md", content: "z\n" },
      { path: "ä.md", content: "umlaut\n" },
    ],
  })

  const skill = await readFile(join(outputDir, "SKILL.md"), "utf8")
  expect(skill.indexOf("### z-kind")).toBeLessThan(skill.indexOf("### ä-kind"))
  expect(skill.match(/references\/z\.md/g)).toHaveLength(1)
  expect(skill.match(/references\/ä\.md/g)).toHaveLength(1)
})

test("compileSkillCapsule rejects unsafe reference paths", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "skill-capsule-"))
  await expect(compileSkillCapsule({
    outputDir,
    skill: { name: "demo", description: "demo" },
    references: [{ path: "../escape.md", content: "" }],
  })).rejects.toThrow("Invalid Skill reference path")
})

for (const invalidPath of [
  { label: "NUL", path: "nul\0byte" },
  { label: "C0 control", path: "line\nbreak" },
  { label: "C1 control", path: "next\u0085line" },
  { label: "encoded slash", path: "encoded%2Fseparator" },
  { label: "encoded backslash", path: "encoded%5cseparator" },
  { label: "encoded control", path: "encoded%00control" },
  { label: "encoded dot segment", path: "%2e%2e/escape" },
  { label: "backslash", path: "a\\b" },
  { label: "parent segment", path: "../escape" },
  { label: "current segment", path: "a/./b" },
  { label: "POSIX absolute", path: "/absolute" },
  { label: "Windows absolute", path: "C:/absolute" },
  { label: "empty", path: "" },
  { label: "empty middle segment", path: "a//b" },
  { label: "empty trailing segment", path: "a/" },
  { label: "leading whitespace", path: " leading" },
  { label: "segment trailing whitespace", path: "a/trailing " },
] as const) {
  test(`legacy reference path rejects ${invalidPath.label} before target mutation`, async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "skill-reference-path-invalid-"))
    await Bun.write(join(outputDir, "nested/keep.txt"), "previous projection\n")
    await Bun.write(join(outputDir, "identity.bin"), new Uint8Array([0, 255, 1, 254]))
    const before = await snapshotDirectory(outputDir)

    const error = await captureDistributionError(compileSkillCapsule({
      outputDir,
      skill: { name: "path-contract", description: "Path contract fixture." },
      references: [{ path: invalidPath.path, content: "unsafe\n" }],
    }))
    expect(error.code).toBe("SKILL_REFERENCE_PATH_INVALID")
    expect(error.message).not.toContain("ERR_INVALID_ARG_VALUE")
    expect(await snapshotDirectory(outputDir)).toEqual(before)
  })
}

test("legacy reference paths preserve legal Unicode", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "skill-reference-path-unicode-"))
  const plan = await compileSkillCapsule({
    outputDir,
    skill: { name: "技能-😀", description: "Unicode path fixture." },
    references: [{ path: "参考/😀-naïve.md", content: "合法 Unicode\n" }],
  })
  expect(plan.files).toContain("references/参考/😀-naïve.md")
  expect(await readFile(join(outputDir, "references/参考/😀-naïve.md"), "utf8")).toBe("合法 Unicode\n")
})

test("legacy compile rejects non-adjacent prefix claims deterministically before target mutation", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "skill-capsule-prefix-collision-"))
  await Bun.write(join(outputDir, "nested/keep.txt"), "previous projection\n")
  await Bun.write(join(outputDir, "identity.bin"), new Uint8Array([0, 255, 1, 254]))
  const before = await snapshotDirectory(outputDir)
  const references = [
    { path: "a", content: "prefix\n" },
    { path: "a-b", content: "intervening sibling\n" },
    { path: "a/b", content: "child\n" },
  ]
  const messages: string[] = []

  for (const ordered of [references, [...references].reverse()]) {
    const error = await captureDistributionError(compileSkillCapsule({
      outputDir,
      skill: { name: "prefix-collision", description: "Prefix collision fixture." },
      references: ordered,
    }))
    expect(error.code).toBe("SKILL_TARGET_COLLISION")
    expect(error.message).toContain("owner reference:a target references/a")
    expect(error.message).toContain("owner reference:a/b target references/a/b")
    expect(error.message).not.toContain("EEXIST")
    expect(await snapshotDirectory(outputDir)).toEqual(before)
    messages.push(error.message)
  }
  expect(messages[1]).toBe(messages[0])
})

test("plans a deterministic dependency-first Skill closure without target writes", async () => {
  const assembly = await loadApplicationAssembly({ resourceRootDir: xnlAssemblyRoot })
  const parent = await mkdtemp(join(tmpdir(), "skill-distribution-plan-"))
  const untouched = join(parent, "live")
  await Bun.write(join(untouched, "keep.txt"), "unchanged\n")
  const input = {
    assembly,
    rootSkillFqns: ["demo.xnl_assembly.skill.demo"],
    schemas: xnlSchemas(),
  }

  const plan = await planSkillCapsuleDistribution(input)
  const reordered = await planSkillCapsuleDistribution({ ...input, rootSkillFqns: [...input.rootSkillFqns].reverse() })

  expect(plan.topology).toEqual([
    "demo.xnl_assembly.skill.dependency",
    "demo.xnl_assembly.skill.demo",
  ])
  expect(plan.roots).toEqual([expect.objectContaining({ fqn: "demo.xnl_assembly.skill.demo", version: "1.0.0" })])
  expect(plan.files.every((file) => file.targetRelativePath.startsWith("dependency-xnl/")
    || file.targetRelativePath.startsWith("demo-xnl/"))).toBe(true)
  expect(plan.files.every((file) => file.contentDigest.startsWith("sha256:"))).toBe(true)
  expect(plan.closureDigest).toStartWith("sha256:")
  expect(skillCapsuleDistributionProjection(reordered)).toEqual(skillCapsuleDistributionProjection(plan))
  expect(await readFile(join(untouched, "keep.txt"), "utf8")).toBe("unchanged\n")
})

test("projects XNL apiVersion and canonical provenance for every planned Skill capsule", async () => {
  const assembly = await loadApplicationAssembly({ resourceRootDir: xnlAssemblyRoot })
  const plan = await planSkillCapsuleDistribution({
    assembly,
    rootSkillFqns: ["demo.xnl_assembly.skill.demo"],
    schemas: xnlSchemas(),
  })

  expect(plan.roots[0]).toEqual(expect.objectContaining({ apiVersion: "halfcode.resources/v1" }))
  for (const capsule of plan.capsules) {
    expect(capsule.identity.apiVersion).toBe("halfcode.resources/v1")
    const provenancePath = `${capsule.identity.name}/references/.halfcode/provenance.json`
    const provenanceFile = capsule.files.find((file) => file.targetRelativePath === provenancePath)
    expect(provenanceFile).toBeDefined()
    const provenance = JSON.parse(Buffer.from(provenanceFile!.contentBase64, "base64").toString("utf8"))
    expect(provenance).toEqual({
      format: "halfcode.skill-provenance/v1",
      generatedBy: "halfcode.skill-distribution/v1",
      source: {
        fqn: capsule.identity.fqn,
        apiVersion: capsule.identity.apiVersion,
        version: capsule.identity.version,
      },
      payloadFiles: capsule.files
        .filter((file) => file !== provenanceFile)
        .map((file) => ({ path: file.capsuleRelativePath, contentDigest: file.contentDigest })),
    })
  }
})

test.each(["missing", "duplicate", "malformed", "source mismatch", "payload mismatch"] as const)(
  "rejects %s canonical provenance before target mutation",
  async (boundaryCase) => {
    const assembly = await loadApplicationAssembly({ resourceRootDir: xnlAssemblyRoot })
    const plan = await planSkillCapsuleDistribution({
      assembly,
      rootSkillFqns: ["demo.xnl_assembly.skill.demo"],
      schemas: xnlSchemas(),
    })
    const owner = plan.capsules[0]!
    const provenancePath = "references/.halfcode/provenance.json"
    const changed = withRewrittenCapsuleFiles(plan, owner.identity.fqn, (files) => {
      if (boundaryCase === "missing") {
        return files.filter((file) => file.capsuleRelativePath !== provenancePath)
      }
      if (boundaryCase === "duplicate") {
        const manifest = files.find((file) => file.capsuleRelativePath === provenancePath)!
        return [...files, manifest]
      }
      return files.map((file) => {
        if (file.capsuleRelativePath !== provenancePath) return file
        if (boundaryCase === "malformed") return withPlannedFileText(file, "not-json\n")
        const manifest = JSON.parse(Buffer.from(file.contentBase64, "base64").toString("utf8"))
        if (boundaryCase === "source mismatch") manifest.source.version = "9.9.9"
        else manifest.payloadFiles[0].contentDigest = "sha256:missing"
        return withPlannedFileText(file, `${JSON.stringify(manifest, null, 2)}\n`)
      })
    })
    const parent = await mkdtemp(join(tmpdir(), "skill-provenance-boundary-"))
    const outputRoot = join(parent, "live")
    await Bun.write(join(outputRoot, "keep.txt"), "previous complete root\n")
    const before = await snapshotDirectory(parent)

    const error = await captureDistributionError(applySkillCapsuleDistributionPlan(changed, { outputRoot }))
    expect(error.code).toBe("SKILL_PLAN_PROVENANCE_INVALID")
    expect(await snapshotDirectory(parent)).toEqual(before)
  },
)

test("plans the canonical sys-halfcode-resource-dsl 1.0.0 consumer Skill", async () => {
  const assembly = await resolveApplicationAssembly({
    modules: [{ ...halfcodeResourceDslSystemSkillModule, resourceRootDir: resourceDslRoot }],
    portBindings: [],
  })
  const plan = await planSkillCapsuleDistribution({
    assembly,
    rootSkillFqns: ["Halfcode.ResourceDsl.Skill.System"],
  })

  expect(plan.roots).toEqual([{
    fqn: "Halfcode.ResourceDsl.Skill.System",
    name: "sys-halfcode-resource-dsl",
    apiVersion: "halfcode.resources/v1",
    version: "1.0.0",
  }])
  expect(plan.files.map((file) => file.targetRelativePath)).toContain(
    "sys-halfcode-resource-dsl/references/resource-dsl/index.md",
  )
  expect(plan.files.map((file) => file.targetRelativePath)).toContain(
    "sys-halfcode-resource-dsl/references/resource-dsl/examples/resource-package.xnl",
  )
  const skill = plan.files.find((file) => file.targetRelativePath === "sys-halfcode-resource-dsl/SKILL.md")
  expect(Buffer.from(skill!.contentBase64, "base64").toString("utf8")).toContain(
    "references/resource-dsl/index.md",
  )
})

test("rejects a control code in real XnlAssembly Skill output name before filesystem mutation", async () => {
  const assembly = await loadApplicationAssembly({ resourceRootDir: xnlAssemblyRoot })
  const rootFqn = "demo.xnl_assembly.skill.demo"
  const badAssembly = assemblyWithSkills(assembly, assembly.skillCapsules.map((skill) =>
    skill.fqn === rootFqn
      ? { ...skill, metadata: { ...skill.metadata, name: "bad\0name" } }
      : skill))
  const parent = await mkdtemp(join(tmpdir(), "skill-output-name-control-"))
  const outputDir = join(parent, "live")
  await Bun.write(join(outputDir, "nested/keep.txt"), "previous projection\n")
  await Bun.write(join(outputDir, "identity.bin"), new Uint8Array([0, 255, 1, 254]))
  const before = await snapshotDirectory(parent)

  const error = await captureDistributionError(compileResourceSkillCapsule({
    assembly: badAssembly,
    skillFqn: rootFqn,
    outputDir,
    schemas: xnlSchemas(),
  }))
  expect(error.code).toBe("SKILL_OUTPUT_NAME_INVALID")
  expect(error.message).toContain("U+0000")
  expect(error.message).not.toContain("ERR_INVALID_ARG_VALUE")
  expect(await snapshotDirectory(parent)).toEqual(before)
})

test("preserves legal Unicode in Skill output names", async () => {
  const assembly = await loadApplicationAssembly({ resourceRootDir: xnlAssemblyRoot })
  const rootFqn = "demo.xnl_assembly.skill.demo"
  const unicodeAssembly = assemblyWithSkills(assembly, assembly.skillCapsules.map((skill) =>
    skill.fqn === rootFqn
      ? { ...skill, metadata: { ...skill.metadata, name: "技能-😀" } }
      : skill))
  const plan = await planSkillCapsuleDistribution({
    assembly: unicodeAssembly,
    rootSkillFqns: [rootFqn],
    schemas: xnlSchemas(),
  })
  expect(plan.files.some((file) => file.targetRelativePath.startsWith("技能-😀/"))).toBe(true)
})

for (const invalidYamlName of [
  { label: "empty", yaml: '""' },
  { label: "whitespace-only", yaml: '"   "' },
  { label: "control-containing", yaml: '"bad\\u0000name"' },
  { label: "unsafe-segment", yaml: '"bad/name"' },
] as const) {
  test(`rejects a present ${invalidYamlName.label} YAML Skill name without FQN fallback`, async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), "skill-yaml-name-invalid-"))
    await cp(xnlAssemblyRoot, fixtureRoot, { recursive: true })
    await writeFile(
      join(fixtureRoot, "Skills/Demo/skill.yaml"),
      `name: ${invalidYamlName.yaml}\ndescription: XNL assembly fixture skill\n`,
    )
    const assembly = await loadApplicationAssembly({ resourceRootDir: fixtureRoot })
    const parent = await mkdtemp(join(tmpdir(), "skill-yaml-name-output-"))
    const outputDir = join(parent, "live")
    await Bun.write(join(outputDir, "nested/keep.txt"), "previous projection\n")
    await Bun.write(join(outputDir, "identity.bin"), new Uint8Array([0, 255, 1, 254]))
    const before = await snapshotDirectory(parent)

    const error = await captureDistributionError(compileResourceSkillCapsule({
      assembly,
      skillFqn: "demo.xnl_assembly.skill.demo",
      outputDir,
      schemas: xnlSchemas(),
    }))
    expect(error.code).toBe("SKILL_OUTPUT_NAME_INVALID")
    expect(error.message).toContain("present YAML name")
    expect(await snapshotDirectory(parent)).toEqual(before)
  })
}

test("uses the legacy FQN fallback only when YAML Skill name is absent", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "skill-yaml-name-absent-"))
  await cp(xnlAssemblyRoot, fixtureRoot, { recursive: true })
  await writeFile(
    join(fixtureRoot, "Skills/Demo/skill.yaml"),
    "description: XNL assembly fixture skill\n",
  )
  const assembly = await loadApplicationAssembly({ resourceRootDir: fixtureRoot })
  const plan = await planSkillCapsuleDistribution({
    assembly,
    rootSkillFqns: ["demo.xnl_assembly.skill.demo"],
    schemas: xnlSchemas(),
  })
  expect(plan.roots[0]?.name).toBe("demo")
  expect(plan.files.some((file) => file.targetRelativePath === "demo/SKILL.md")).toBe(true)
})

test("canonicalizes every output-affecting ApplicationAssembly resource collection", async () => {
  const canonicalAssembly = await demoAssembly()
  const reorderedAssembly = await demoAssembly()
  addOrderingResources(canonicalAssembly)
  addOrderingResources(reorderedAssembly)
  reverseAssemblyCollections(reorderedAssembly)

  const canonical = await planSkillCapsuleDistribution({
    assembly: canonicalAssembly,
    rootSkillFqns: ["Demo.ResourceWorkflow.Skill.Main"],
    schemas: demoSchemas(),
  })
  const reordered = await planSkillCapsuleDistribution({
    assembly: reorderedAssembly,
    rootSkillFqns: ["Demo.ResourceWorkflow.Skill.Main"],
    schemas: demoSchemas(),
  })

  expect(skillCapsuleDistributionProjection(reordered)).toEqual(skillCapsuleDistributionProjection(canonical))
  expect(reordered.closureDigest).toBe(canonical.closureDigest)
})

test("canonicalizes callable and object schema keys while retaining semantic array order", async () => {
  const assembly = await demoAssembly()
  const canonical = await planSkillCapsuleDistribution({
    assembly,
    rootSkillFqns: ["Demo.ResourceWorkflow.Skill.Main"],
    schemas: schemaOrderingFixtures(false, false),
  })
  const permuted = await planSkillCapsuleDistribution({
    assembly,
    rootSkillFqns: ["Demo.ResourceWorkflow.Skill.Main"],
    schemas: schemaOrderingFixtures(true, false),
  })

  expect(skillCapsuleDistributionProjection(permuted)).toEqual(skillCapsuleDistributionProjection(canonical))
  expect(permuted.closureDigest).toBe(canonical.closureDigest)
  for (const target of [
    "demo-resource-workflow/references/Functions/PrepareProcedure.md",
    "demo-resource-workflow/functions/registry.json",
    "demo-resource-workflow/objects/registry.json",
  ]) {
    expect(permuted.files.find((file) => file.targetRelativePath === target)?.contentBase64).toBe(
      canonical.files.find((file) => file.targetRelativePath === target)?.contentBase64,
    )
  }

  const arrayReordered = await planSkillCapsuleDistribution({
    assembly,
    rootSkillFqns: ["Demo.ResourceWorkflow.Skill.Main"],
    schemas: schemaOrderingFixtures(true, true),
  })
  expect(arrayReordered.closureDigest).not.toBe(canonical.closureDigest)
  expect(skillCapsuleDistributionProjection(arrayReordered)).not.toEqual(
    skillCapsuleDistributionProjection(canonical),
  )
})

for (const invalidSchema of [
  {
    label: "nested undefined",
    value: () => ({ type: "object", properties: { invalid: undefined } }),
  },
  {
    label: "a non-plain object",
    value: () => ({ type: "object", invalid: new Date("2026-08-15T00:00:00.000Z") }),
  },
  {
    label: "a cyclic value",
    value: () => {
      const cyclic: Record<string, unknown> = { type: "object" }
      cyclic.self = cyclic
      return cyclic
    },
  },
  {
    label: "a non-finite number",
    value: () => ({ type: "object", invalid: Number.NaN }),
  },
  {
    label: "an accessor property",
    value: () => {
      const value = { type: "object" } as Record<string, unknown>
      Object.defineProperty(value, "invalid", { enumerable: true, get: () => "hidden" })
      return value
    },
  },
  {
    label: "a symbol key",
    value: () => {
      const value = { type: "object" } as Record<PropertyKey, unknown>
      value[Symbol("invalid")] = true
      return value
    },
  },
  {
    label: "a sparse array",
    value: () => {
      const sparse: unknown[] = []
      sparse.length = 1
      return { type: "object", invalid: sparse }
    },
  },
] as const) {
  test(`rejects schema JSON containing ${invalidSchema.label} before target mutation`, async () => {
    const schemas = demoSchemas()
    schemas.set("Demo.ResourceWorkflow.Contract.PrepareProcedure.Input", invalidSchema.value())
    const outputDir = await mkdtemp(join(tmpdir(), "resource-skill-invalid-schema-json-"))
    await Bun.write(join(outputDir, "nested/keep.txt"), "existing projection\n")
    await Bun.write(join(outputDir, "identity.bin"), new Uint8Array([0, 255, 1, 254]))
    const before = await snapshotDirectory(outputDir)

    const error = await captureDistributionError(compileResourceSkillCapsule({
      assembly: await demoAssembly(),
      skillFqn: "Demo.ResourceWorkflow.Skill.Main",
      outputDir,
      schemas,
    }))
    expect(error.code).toBe("SKILL_SCHEMA_INVALID")
    expect(error.message).toContain("Demo.ResourceWorkflow.Contract.PrepareProcedure.Input")
    expect(await snapshotDirectory(outputDir)).toEqual(before)
  })
}

test("plans the canonical generic four-Skill example topology", async () => {
  const assembly = await demoAssembly()
  const plan = await planSkillCapsuleDistribution({
    assembly,
    rootSkillFqns: ["example.resource_lifecycle.skill.devops"],
  })

  expect(plan.topology).toEqual([
    "example.resource_lifecycle.skill.resource_dsl",
    "example.resource_lifecycle.skill.authoring",
    "example.resource_lifecycle.skill.run",
    "example.resource_lifecycle.skill.devops",
  ])
  expect(plan.roots).toEqual([expect.objectContaining({
    fqn: "example.resource_lifecycle.skill.devops",
    version: "1.0.0",
  })])
})

test("resolves shared dependencies once and ignores SkillCapsule Includes", async () => {
  const assembly = await loadApplicationAssembly({ resourceRootDir: xnlAssemblyRoot })
  const [dependency, root] = skillsByFqn(assembly,
    "demo.xnl_assembly.skill.dependency",
    "demo.xnl_assembly.skill.demo")
  const leaf: SkillCapsuleResource = {
    ...dependency,
    fqn: "demo.xnl_assembly.skill.leaf",
    metadata: { ...dependency.metadata, name: "leaf-xnl" },
    dependencies: [],
  }
  const transitiveDependency: SkillCapsuleResource = {
    ...dependency,
    dependencies: [{ ref: `resource://${leaf.fqn}`, fqn: leaf.fqn, version: leaf.version }],
  }
  const secondRoot: SkillCapsuleResource = {
    ...root,
    fqn: "demo.xnl_assembly.skill.second",
    metadata: { ...root.metadata, name: "second-xnl" },
    dependencies: [...root.dependencies],
  }
  const sharedAssembly = assemblyWithSkills(assembly, [leaf, transitiveDependency, root, secondRoot])
  const shared = await planSkillCapsuleDistribution({
    assembly: sharedAssembly,
    rootSkillFqns: [secondRoot.fqn, root.fqn],
    schemas: xnlSchemas(),
  })
  expect(shared.topology).toEqual([leaf.fqn, dependency.fqn, root.fqn, secondRoot.fqn])
  const reordered = await planSkillCapsuleDistribution({
    assembly: sharedAssembly,
    rootSkillFqns: [root.fqn, secondRoot.fqn],
    schemas: xnlSchemas(),
  })
  expect(skillCapsuleDistributionProjection(reordered)).toEqual(skillCapsuleDistributionProjection(shared))

  const includesOnlyRoot = {
    ...root,
    dependencies: [],
    includes: [...root.includes, { kind: "SkillCapsule", ref: `resource://${dependency.fqn}` }],
  }
  const includesOnly = await planSkillCapsuleDistribution({
    assembly: assemblyWithSkills(assembly, [dependency, includesOnlyRoot]),
    rootSkillFqns: [root.fqn],
    schemas: xnlSchemas(),
  })
  expect(includesOnly.topology).toEqual([root.fqn])
})

test.each([
  ["missing", "resource://demo.xnl_assembly.skill.missing", "1.0.0", "SKILL_DEPENDENCY_MISSING"],
  ["wrong kind", "resource://demo.xnl_assembly.function.prepare", "1.0.0", "SKILL_DEPENDENCY_KIND_MISMATCH"],
  ["wrong version", "resource://demo.xnl_assembly.skill.dependency", "2.0.0", "SKILL_DEPENDENCY_VERSION_MISMATCH"],
])("rejects %s dependency graphs before planning files", async (_label, ref, version, code) => {
  const assembly = await loadApplicationAssembly({ resourceRootDir: xnlAssemblyRoot })
  const [dependency, root] = skillsByFqn(assembly,
    "demo.xnl_assembly.skill.dependency",
    "demo.xnl_assembly.skill.demo")
  const brokenRoot = {
    ...root,
    dependencies: [{ ref, fqn: ref.slice("resource://".length), version }],
  }
  await expect(planSkillCapsuleDistribution({
    assembly: assemblyWithSkills(assembly, [dependency, brokenRoot]),
    rootSkillFqns: [root.fqn],
    schemas: xnlSchemas(),
  })).rejects.toThrow(code)
})

test("rejects self and multi-node dependency cycles with a stable path", async () => {
  const assembly = await loadApplicationAssembly({ resourceRootDir: xnlAssemblyRoot })
  const [dependency, root] = skillsByFqn(assembly,
    "demo.xnl_assembly.skill.dependency",
    "demo.xnl_assembly.skill.demo")
  const self = {
    ...root,
    dependencies: [{ ref: `resource://${root.fqn}`, fqn: root.fqn, version: root.version }],
  }
  await expect(planSkillCapsuleDistribution({
    assembly: assemblyWithSkills(assembly, [dependency, self]),
    rootSkillFqns: [root.fqn],
    schemas: xnlSchemas(),
  })).rejects.toThrow(`SKILL_DEPENDENCY_CYCLE: ${root.fqn} -> ${root.fqn}`)

  const cyclicDependency = {
    ...dependency,
    dependencies: [{ ref: `resource://${root.fqn}`, fqn: root.fqn, version: root.version }],
  }
  await expect(planSkillCapsuleDistribution({
    assembly: assemblyWithSkills(assembly, [cyclicDependency, root]),
    rootSkillFqns: [root.fqn],
    schemas: xnlSchemas(),
  })).rejects.toThrow(
    `SKILL_DEPENDENCY_CYCLE: ${root.fqn} -> ${dependency.fqn} -> ${root.fqn}`,
  )
})

test("preflights duplicate output names across the complete closure", async () => {
  const assembly = await loadApplicationAssembly({ resourceRootDir: xnlAssemblyRoot })
  const [dependency, root] = skillsByFqn(assembly,
    "demo.xnl_assembly.skill.dependency",
    "demo.xnl_assembly.skill.demo")
  const duplicateNameDependency = { ...dependency, metadata: { ...dependency.metadata, name: "demo-xnl" } }
  await expect(planSkillCapsuleDistribution({
    assembly: assemblyWithSkills(assembly, [duplicateNameDependency, root]),
    rootSkillFqns: [root.fqn],
    schemas: xnlSchemas(),
  })).rejects.toThrow("SKILL_OUTPUT_NAME_DUPLICATE")
})

test("atomically applies a frozen plan and rejects invalid plan modifications before live mutation", async () => {
  const assembly = await loadApplicationAssembly({ resourceRootDir: xnlAssemblyRoot })
  const plan = await planSkillCapsuleDistribution({
    assembly,
    rootSkillFqns: ["demo.xnl_assembly.skill.demo"],
    schemas: xnlSchemas(),
  })
  const parent = await mkdtemp(join(tmpdir(), "skill-distribution-apply-"))
  const outputRoot = join(parent, "live")
  await Bun.write(join(outputRoot, "old.txt"), "old\n")

  const invalidContentPlan = {
    ...plan,
    files: plan.files.map((file, index) => index === 0
      ? { ...file, content: new TextEncoder().encode("changed-content") }
      : file),
  }
  await expect(applySkillCapsuleDistributionPlan(invalidContentPlan, { outputRoot }))
    .rejects.toThrow("SKILL_PLAN_CONTENT_DIGEST_INVALID")
  expect(await readFile(join(outputRoot, "old.txt"), "utf8")).toBe("old\n")

  await expect(applySkillCapsuleDistributionPlan({
    ...plan,
    format: "invalid" as typeof plan.format,
  }, { outputRoot })).rejects.toThrow("SKILL_PLAN_FORMAT_INVALID")
  await expect(applySkillCapsuleDistributionPlan({
    ...plan,
    closureDigest: "sha256:invalid",
  }, { outputRoot })).rejects.toThrow("SKILL_PLAN_CLOSURE_DIGEST_INVALID")
  await expect(applySkillCapsuleDistributionPlan({
    ...plan,
    files: plan.files.map((file, index) => index === 0
      ? { ...file, targetRelativePath: "../escape" }
      : file),
  }, { outputRoot })).rejects.toThrow("SKILL_PLAN_TARGET_INVALID")
  const firstTarget = plan.files[0]!.targetRelativePath
  await expect(applySkillCapsuleDistributionPlan({
    ...plan,
    files: plan.files.map((file, index) => index === 1
      ? { ...file, targetRelativePath: `${firstTarget}/nested` }
      : file),
  }, { outputRoot })).rejects.toThrow("SKILL_CLOSURE_TARGET_COLLISION")
  expect(await readFile(join(outputRoot, "old.txt"), "utf8")).toBe("old\n")

  const receipt = await applySkillCapsuleDistributionPlan(plan, { outputRoot })
  expect(receipt.closureDigest).toBe(plan.closureDigest)
  expect(receipt.installedSkills.map((item) => item.fqn)).toEqual([...plan.topology])
  await expect(readFile(join(outputRoot, "old.txt"), "utf8")).rejects.toThrow()
  expect(await readFile(join(outputRoot, "demo-xnl/SKILL.md"), "utf8")).toContain("Demo XNL Skill")
})

for (const boundaryCase of [
  {
    label: "empty roots",
    code: "SKILL_PLAN_ROOTS_EMPTY",
    mutate(plan: SkillCapsuleDistributionPlan): SkillCapsuleDistributionPlan {
      return withRecomputedClosureDigest({ ...plan, roots: [] })
    },
  },
  {
    label: "a disconnected capsule",
    code: "SKILL_PLAN_CLOSURE_DISCONNECTED",
    mutate(plan: SkillCapsuleDistributionPlan): SkillCapsuleDistributionPlan {
      return withRecomputedClosureDigest({ ...plan, roots: [plan.capsules[0]!.identity] })
    },
  },
] as const) {
  test(`rejects ${boundaryCase.label} with a recomputed digest before live mutation`, async () => {
    const assembly = await loadApplicationAssembly({ resourceRootDir: xnlAssemblyRoot })
    const plan = await planSkillCapsuleDistribution({
      assembly,
      rootSkillFqns: ["demo.xnl_assembly.skill.demo"],
      schemas: xnlSchemas(),
    })
    const outputRoot = join(await mkdtemp(join(tmpdir(), "skill-distribution-root-boundary-case-")), "live")
    await Bun.write(join(outputRoot, "nested/keep.txt"), "previous complete root\n")
    await Bun.write(join(outputRoot, "identity.bin"), new Uint8Array([0, 255, 1, 254]))
    const before = await snapshotDirectory(outputRoot)

    await expect(applySkillCapsuleDistributionPlan(boundaryCase.mutate(plan), { outputRoot }))
      .rejects.toThrow(boundaryCase.code)
    expect(await snapshotDirectory(outputRoot)).toEqual(before)
  })
}

test("keeps planned content immutable when a caller mutates the compatibility byte view", async () => {
  const assembly = await loadApplicationAssembly({ resourceRootDir: xnlAssemblyRoot })
  const plan = await planSkillCapsuleDistribution({
    assembly,
    rootSkillFqns: ["demo.xnl_assembly.skill.demo"],
    schemas: xnlSchemas(),
  })
  const file = plan.files[0]!
  const originalBytes = new Uint8Array(file.content)
  const originalProjection = skillCapsuleDistributionProjection(plan)

  file.content.fill(0)

  expect(file.contentBase64).toBe(
    Buffer.from(originalBytes).toString("base64"),
  )
  expect(file.content).toEqual(originalBytes)
  expect(skillCapsuleDistributionProjection(plan)).toEqual(originalProjection)

  const outputRoot = join(await mkdtemp(join(tmpdir(), "skill-distribution-immutable-content-")), "live")
  await applySkillCapsuleDistributionPlan(plan, { outputRoot })
  expect(new Uint8Array(await readFile(join(outputRoot, file.targetRelativePath)))).toEqual(originalBytes)
})

for (const collision of [
  {
    label: "a sibling-interleaved prefix",
    claims: [
      ["references/a", "fixture.prefix"],
      ["references/a-b", "fixture.sibling"],
      ["references/a/b", "fixture.child"],
    ],
    expected: ["fixture.prefix", "references/a", "fixture.child", "references/a/b"],
  },
  {
    label: "a multi-segment prefix",
    claims: [
      ["references/deep/a", "fixture.deep-prefix"],
      ["references/deep/a-b", "fixture.deep-sibling"],
      ["references/deep/a/b/c", "fixture.deep-child"],
    ],
    expected: ["fixture.deep-prefix", "references/deep/a", "fixture.deep-child", "references/deep/a/b/c"],
  },
  {
    label: "an exact file duplicate",
    claims: [
      ["references/same", "fixture.duplicate-a"],
      ["references/same", "fixture.duplicate-b"],
    ],
    expected: ["fixture.duplicate-a", "references/same", "fixture.duplicate-b", "references/same"],
  },
] as const) {
  test(`closure preflight rejects ${collision.label} deterministically before live mutation`, async () => {
    const assembly = await loadApplicationAssembly({ resourceRootDir: xnlAssemblyRoot })
    const plan = await planSkillCapsuleDistribution({
      assembly,
      rootSkillFqns: ["demo.xnl_assembly.skill.demo"],
      schemas: xnlSchemas(),
    })
    const seed = plan.files[0]!
    const collisionFiles = collision.claims.map(([targetRelativePath, skillFqn]) => ({
      ...seed,
      skillFqn,
      capsuleRelativePath: targetRelativePath,
      targetRelativePath,
    }))
    const outputRoot = join(await mkdtemp(join(tmpdir(), "skill-distribution-prefix-boundary-case-")), "live")
    await Bun.write(join(outputRoot, "nested/keep.txt"), "previous complete root\n")
    await Bun.write(join(outputRoot, "identity.bin"), new Uint8Array([0, 255, 1, 254]))
    const before = await snapshotDirectory(outputRoot)
    const messages: string[] = []

    for (const files of [collisionFiles, [...collisionFiles].reverse()]) {
      const error = await captureDistributionError(applySkillCapsuleDistributionPlan({ ...plan, files }, { outputRoot }))
      expect(error.code).toBe("SKILL_CLOSURE_TARGET_COLLISION")
      expect(error.message).toContain(`owner ${collision.expected[0]} target ${collision.expected[1]}`)
      expect(error.message).toContain(`owner ${collision.expected[2]} target ${collision.expected[3]}`)
      expect(error.message).not.toContain("EEXIST")
      expect(await snapshotDirectory(outputRoot)).toEqual(before)
      messages.push(error.message)
    }
    expect(messages[1]).toBe(messages[0])
  })
}

for (const boundaryPath of [
  "bad\0target",
  "bad\ntarget",
  "bad\u007ftarget",
  "bad\u0085target",
  "bad\uD800target",
  "bad\uDC00target",
] as const) {
  for (const field of ["capsuleRelativePath", "targetRelativePath"] as const) {
    test(`apply preserves raw plan path diagnostic for re-signed ${field} boundary case ${JSON.stringify(boundaryPath)}`, async () => {
      const assembly = await loadApplicationAssembly({ resourceRootDir: xnlAssemblyRoot })
      const plan = await planSkillCapsuleDistribution({
        assembly,
        rootSkillFqns: ["demo.xnl_assembly.skill.demo"],
        schemas: xnlSchemas(),
      })
      const owner = plan.capsules[0]!.files[0]!.skillFqn
      const modifiedPlan = withRewrittenPlanFilePath(plan, field, boundaryPath)
      const parent = await mkdtemp(join(tmpdir(), "skill-plan-path-boundary-case-"))
      const outputRoot = join(parent, "live")
      await Bun.write(join(outputRoot, "nested/keep.txt"), "previous complete root\n")
      await Bun.write(join(outputRoot, "identity.bin"), new Uint8Array([0, 255, 1, 254]))
      const before = await snapshotDirectory(parent)

      const error = await captureDistributionError(applySkillCapsuleDistributionPlan(modifiedPlan, { outputRoot }))
      expect(error.code).toBe("SKILL_PLAN_TARGET_INVALID")
      expect(error.message).toContain(`owner ${owner}`)
      expect(error.message).toContain(`field ${field}`)
      expect(error.message).toContain(`raw target ${JSON.stringify(boundaryPath)}`)
      expect(error.message).not.toContain("ERR_INVALID_ARG_VALUE")
      expect(await snapshotDirectory(parent)).toEqual(before)
    })
  }
}

for (const surrogate of [
  { label: "unpaired high surrogate", value: "bad\uD800target" },
  { label: "unpaired low surrogate", value: "bad\uDC00target" },
] as const) {
  for (const surface of ["capsule files", "public files"] as const) {
    for (const field of ["capsuleRelativePath", "targetRelativePath"] as const) {
      test(`apply preserves raw plan path diagnostic for direct ${surface} ${field} boundary case with ${surrogate.label}`, async () => {
        const assembly = await loadApplicationAssembly({ resourceRootDir: xnlAssemblyRoot })
        const plan = await planSkillCapsuleDistribution({
          assembly,
          rootSkillFqns: ["demo.xnl_assembly.skill.demo"],
          schemas: xnlSchemas(),
        })
        const owner = surface === "public files"
          ? plan.files[0]!.skillFqn
          : plan.capsules[0]!.files[0]!.skillFqn
        const modifiedPlan = withDirectPlanFilePathChange(plan, surface, field, surrogate.value)
        const parent = await mkdtemp(join(tmpdir(), "skill-plan-direct-surrogate-"))
        const outputRoot = join(parent, "live")
        await Bun.write(join(outputRoot, "nested/keep.txt"), "previous complete root\n")
        await Bun.write(join(outputRoot, "identity.bin"), new Uint8Array([0, 255, 1, 254]))
        const before = await snapshotDirectory(parent)

        const error = await captureDistributionError(applySkillCapsuleDistributionPlan(modifiedPlan, { outputRoot }))
        expect(error.code).toBe("SKILL_PLAN_TARGET_INVALID")
        expect(error.message).toContain(`owner ${owner}`)
        expect(error.message).toContain(`field ${field}`)
        expect(error.message).toContain(`raw target ${JSON.stringify(surrogate.value)}`)
        expect(error.message).toContain(surrogate.label.includes("high") ? "U+D800" : "U+DC00")
        expect(await snapshotDirectory(parent)).toEqual(before)
      })
    }
  }
}

for (const capsuleRole of ["root", "dependency"] as const) {
  for (const requiredFileBoundaryCase of [
    {
      label: "empty file set",
      rewrite(_files: readonly PlannedSkillFile[], _identityName: string): PlannedSkillFile[] {
        return []
      },
    },
    {
      label: "missing SKILL.md",
      rewrite(files: readonly PlannedSkillFile[], _identityName: string): PlannedSkillFile[] {
        return files.filter((file) => file.capsuleRelativePath !== "SKILL.md")
      },
    },
    {
      label: "duplicate SKILL.md",
      rewrite(files: readonly PlannedSkillFile[], _identityName: string): PlannedSkillFile[] {
        return [...files, files.find((file) => file.capsuleRelativePath === "SKILL.md")!]
      },
    },
    {
      label: "wrong-case skill.md",
      rewrite(files: readonly PlannedSkillFile[], identityName: string): PlannedSkillFile[] {
        return files.map((file) => file.capsuleRelativePath === "SKILL.md"
          ? { ...file, capsuleRelativePath: "skill.md", targetRelativePath: `${identityName}/skill.md` }
          : file)
      },
    },
    {
      label: "wrong SKILL.md target",
      rewrite(files: readonly PlannedSkillFile[], identityName: string): PlannedSkillFile[] {
        return files.map((file) => file.capsuleRelativePath === "SKILL.md"
          ? { ...file, targetRelativePath: `${identityName}/nested/SKILL.md` }
          : file)
      },
    },
  ] as const) {
    test(`apply rejects ${capsuleRole} capsule with ${requiredFileBoundaryCase.label} after full re-signing`, async () => {
      const assembly = await loadApplicationAssembly({ resourceRootDir: xnlAssemblyRoot })
      const plan = await planSkillCapsuleDistribution({
        assembly,
        rootSkillFqns: ["demo.xnl_assembly.skill.demo"],
        schemas: xnlSchemas(),
      })
      const targetFqn = capsuleRole === "root"
        ? "demo.xnl_assembly.skill.demo"
        : "demo.xnl_assembly.skill.dependency"
      const modifiedPlan = withRewrittenCapsuleFiles(plan, targetFqn, requiredFileBoundaryCase.rewrite)
      const parent = await mkdtemp(join(tmpdir(), "skill-plan-required-file-"))
      const outputRoot = join(parent, "live")
      await Bun.write(join(outputRoot, "nested/keep.txt"), "previous complete root\n")
      await Bun.write(join(outputRoot, "identity.bin"), new Uint8Array([0, 255, 1, 254]))
      const before = await snapshotDirectory(parent)

      const error = await captureDistributionError(applySkillCapsuleDistributionPlan(modifiedPlan, { outputRoot }))
      expect(error.code).toBe("SKILL_PLAN_REQUIRED_FILE_INVALID")
      expect(error.message).toContain(targetFqn)
      expect(error.message).toContain("exactly one canonical SKILL.md")
      expect(await snapshotDirectory(parent)).toEqual(before)
    })
  }
}

for (const injectedStep of ["after-stage", "after-readback", "after-backup", "before-live-rename"] as const) {
  test(`preserves the previous complete root when ${injectedStep} fails`, async () => {
    const assembly = await loadApplicationAssembly({ resourceRootDir: xnlAssemblyRoot })
    const plan = await planSkillCapsuleDistribution({
      assembly,
      rootSkillFqns: ["demo.xnl_assembly.skill.demo"],
      schemas: xnlSchemas(),
    })
    const parent = await mkdtemp(join(tmpdir(), "skill-distribution-rollback-"))
    const outputRoot = join(parent, "live")
    await Bun.write(join(outputRoot, "old.txt"), "previous complete root\n")

    await expect(applySkillCapsuleDistributionPlan(plan, {
      outputRoot,
      onStep(step) {
        if (step === injectedStep) throw new Error(`injected ${injectedStep} failure`)
      },
    })).rejects.toThrow(`injected ${injectedStep} failure`)
    expect(await readFile(join(outputRoot, "old.txt"), "utf8")).toBe("previous complete root\n")
    expect((await readdir(parent)).filter((name) => name !== "live")).toEqual([])
  })
}

test("applies bytes frozen at plan time after source files change", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "skill-distribution-freeze-"))
  await cp(xnlAssemblyRoot, fixtureRoot, { recursive: true })
  const assembly = await loadApplicationAssembly({ resourceRootDir: fixtureRoot })
  const plan = await planSkillCapsuleDistribution({
    assembly,
    rootSkillFqns: ["demo.xnl_assembly.skill.demo"],
    schemas: xnlSchemas(),
  })
  await writeFile(join(fixtureRoot, "Skills/Demo/SKILL.md"), "# Changed after planning\n")
  const outputRoot = join(await mkdtemp(join(tmpdir(), "skill-distribution-frozen-output-")), "live")

  await applySkillCapsuleDistributionPlan(plan, { outputRoot })
  expect(await readFile(join(outputRoot, "demo-xnl/SKILL.md"), "utf8")).toContain("Demo XNL Skill")
  expect(await readFile(join(outputRoot, "demo-xnl/SKILL.md"), "utf8")).not.toContain("Changed after planning")
})

test("compileResourceSkillCapsule writes mapped references and callable artifacts", async () => {
  const capsulePackageRoot = join(import.meta.dir, "../../../apps/demo-resource-workflow-skill-capsule")
  const outputDir = await mkdtemp(join(capsulePackageRoot, ".runtime-skill-"))
  const assembly = await demoAssembly()
  const plan = await compileResourceSkillCapsule({
    assembly,
    skillFqn: "Demo.ResourceWorkflow.Skill.Main",
    outputDir,
    schemas: demoSchemas(),
  })

  expect(plan.files).toContain("SKILL.md")
  expect(plan.files).toContain("functions/registry.json")
  expect(plan.files).toContain("functions/bundle.js")
  expect(plan.files).toContain("objects/registry.json")
  expect(plan.files).toContain("objects/bundle.js")
  expect(plan.files).toContain("references/PageObjects/ReservationDetail/PAGE_OBJECT.md")
  expect(plan.files).toContain("references/BusinessObjects/Reservation/BUSINESS_OBJECT.md")
  expect(plan.files).toContain("references/BusinessObjects/Member/BUSINESS_OBJECT.md")
  expect(plan.files).toContain("references/BusinessObjects/Tool/BUSINESS_OBJECT.md")
  expect(plan.files).not.toContain("references/BusinessActions/Approve.md")
  expect(plan.files).not.toContain("references/BusinessMutations/MarkApproved.md")
  expect(plan.files).toContain("references/PromptFragments/SkillPrelude.md")
  expect(plan.files).toContain("references/Shared/SharedNotes.md")
  expect(plan.files).toContain("references/Protocol/workflow-protocol.md")

  const businessObjectReference = await readFile(
    join(outputDir, "references/BusinessObjects/Reservation/BUSINESS_OBJECT.md"),
    "utf8",
  )
  expect(businessObjectReference).toContain("Demo.ResourceWorkflow.BO.MakerSpace.Reservation.approve")
  expect(businessObjectReference).toContain("run_object_operation")
  const pageObjectReference = await readFile(
    join(outputDir, "references/PageObjects/ReservationDetail/PAGE_OBJECT.md"),
    "utf8",
  )
  expect(pageObjectReference).toContain("Demo.ResourceWorkflow.PageObject.ReservationDetail.reconcile")
  expect(pageObjectReference).toContain("run_object_operation")
  const skillText = await readFile(join(outputDir, "SKILL.md"), "utf8")
  expect(skillText).not.toContain("<business_actions>")
  expect(skillText).not.toContain("<business_mutations>")

  const registry = await readFile(join(outputDir, "functions/registry.json"), "utf8")
  const registryValue = JSON.parse(registry) as { callableResources: unknown[] }
  expect(registryValue.callableResources).toHaveLength(2)
  expect(registry).not.toContain("BusinessAction")

  const objectRegistry = JSON.parse(await readFile(join(outputDir, "objects/registry.json"), "utf8")) as {
    targetKinds: unknown[]
    operations: Array<{ ref: string }>
  }
  expect(objectRegistry.targetKinds).toHaveLength(5)
  expect(objectRegistry.operations.map((item) => item.ref)).toEqual([
    "Demo.ResourceWorkflow.BO.MakerSpace.Reservation.approve",
    "Demo.ResourceWorkflow.BO.MakerSpace.Reservation.markApproved",
    "Demo.ResourceWorkflow.PageObject.ReservationDetail.fill",
    "Demo.ResourceWorkflow.PageObject.ReservationDetail.open",
    "Demo.ResourceWorkflow.PageObject.ReservationDetail.reconcile",
    "Demo.ResourceWorkflow.PageObject.ReservationDetail.save",
  ])
  expect(JSON.stringify(objectRegistry)).not.toContain('"subject"')
  expect(JSON.stringify(objectRegistry)).not.toContain('"module"')
  expect(JSON.stringify(objectRegistry)).not.toContain('"resourceRef"')
  expect(JSON.stringify(objectRegistry)).not.toContain('"exportName"')

  const bundle = await import(`${pathToFileURL(join(outputDir, "functions/bundle.js")).href}?test=${Date.now()}`) as {
    initialize_callable_runtime(runtime: unknown): void
    run_callable_resource(fqn: string, input: unknown, config?: unknown): Promise<unknown>
    run_function?: unknown
  }
  expect(bundle.run_function).toBeUndefined()
  await expect(bundle.run_callable_resource(
    "Demo.ResourceWorkflow.Function.PrepareProcedure",
    { procedureName: "Review", objective: "Confirm readiness" },
  )).rejects.toThrow("Callable runtime has not been initialized")
  bundle.initialize_callable_runtime(createMockRuntime())
  const result = await bundle.run_callable_resource(
    "Demo.ResourceWorkflow.Function.PrepareProcedure",
    { procedureName: "Review", objective: "Confirm readiness" },
    { summaryPrefix: "Configured" },
  ) as { accepted: boolean; summary: string }
  expect(result.accepted).toBe(true)
  expect(result.summary).toStartWith("Configured procedure")
  const bundleSource = await readFile(join(outputDir, "functions/bundle.js"), "utf8")
  expect(bundleSource).toContain("async function invokeCallableResource(runtime, fqn, input, config)")
  expect(bundleSource).toContain("entry.handler(input, config)")
  expect(bundleSource).toContain("runtime is never an AI argument")

  const objectBundle = await import(`${pathToFileURL(join(outputDir, "objects/bundle.js")).href}?test=${Date.now()}`) as {
    initialize_object_operation_runtime(runtime: unknown): void
    run_object_operation(call: unknown): Promise<unknown>
  }
  const approveCall = {
    targets: {
      kind: "single",
      ref: {
        kindFqn: "Demo.ResourceWorkflow.BO.MakerSpace.Reservation",
        key: { reservationNumber: "R-100" },
      },
    },
    invocation: {
      kind: "action",
      operationRef: "Demo.ResourceWorkflow.BO.MakerSpace.Reservation.approve",
      input: { approvedBy: "M-7" },
    },
    config: { trace: true },
  }
  await expect(objectBundle.run_object_operation(approveCall))
    .rejects.toThrow("Object operation runtime has not been initialized")
  objectBundle.initialize_object_operation_runtime(createMockRuntime({ context: { requestId: "object-test" } }))
  const approved = await objectBundle.run_object_operation(approveCall) as { done: boolean; summary: string }
  expect(approved.done).toBe(true)
  expect(approved.summary).toContain("R-100")
  const marked = await objectBundle.run_object_operation({
    targets: approveCall.targets,
    invocation: {
      kind: "mutation",
      operationRef: "Demo.ResourceWorkflow.BO.MakerSpace.Reservation.markApproved",
      desired: { workflowState: "Approved" },
    },
  }) as { desired: { workflowState: string } }
  expect(marked.desired.workflowState).toBe("Approved")
  const opened = await objectBundle.run_object_operation({
    targets: { kind: "none" },
    invocation: {
      kind: "action",
      operationRef: "Demo.ResourceWorkflow.PageObject.ReservationDetail.open",
    },
  }) as { operation: string }
  expect(opened.operation).toBe("open")
  const reconciled = await objectBundle.run_object_operation({
    targets: {
      kind: "single",
      ref: { kindFqn: "Demo.ResourceWorkflow.PageObject.ReservationDetail.Form", key: { formId: "main" } },
    },
    invocation: {
      kind: "mutation",
      operationRef: "Demo.ResourceWorkflow.PageObject.ReservationDetail.reconcile",
      desired: { status: "ready" },
    },
  }) as { operation: string }
  expect(reconciled.operation).toBe("reconcile")
  await expect(objectBundle.run_object_operation({
    targets: { kind: "none" },
    invocation: approveCall.invocation,
  })).rejects.toThrow("OBJECT_TARGET_CARDINALITY_MISMATCH")
  await expect(objectBundle.run_object_operation({
    targets: { kind: "none" },
    invocation: { kind: "action", operationRef: "unknown" },
  })).rejects.toThrow("Unknown object operation")
  const objectBundleSource = await readFile(join(outputDir, "objects/bundle.js"), "utf8")
  expect(objectBundleSource).toContain('import catalog from "./registry.json"')
  expect(objectBundleSource).not.toContain("definition:")
  await rm(outputDir, { recursive: true, force: true })
})

test("compileResourceSkillCapsule preflights collisions before deleting output", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "resource-skill-preflight-"))
  await writeFile(join(outputDir, "keep.txt"), "existing projection\n")
  const assembly = await demoAssembly()
  const skill = assembly.skillCapsules[0]!
  const resourceMappings = skill.resourceMappings!
  const brokenAssembly = assemblyWithSkills(assembly, [{
    ...skill,
    resourceMappings: {
      ...resourceMappings,
      content: resourceMappings.content.replace(
        'to = "references/Shared/SharedNotes.md"',
        'to = "SKILL.md"',
      ),
    },
  }])

  await expect(compileResourceSkillCapsule({
    assembly: brokenAssembly,
    skillFqn: skill.fqn,
    outputDir,
    schemas: demoSchemas(),
  })).rejects.toThrow("conflicts with generated target SKILL.md")
  expect(await readFile(join(outputDir, "keep.txt"), "utf8")).toBe("existing projection\n")

  const objectCollisionAssembly = assemblyWithSkills(assembly, [{
    ...skill,
    resourceMappings: {
      ...resourceMappings,
      content: resourceMappings.content.replace(
        'to = "references/Shared/SharedNotes.md"',
        'to = "objects/bundle.js"',
      ),
    },
  }])
  await expect(compileResourceSkillCapsule({
    assembly: objectCollisionAssembly,
    skillFqn: skill.fqn,
    outputDir,
    schemas: demoSchemas(),
  })).rejects.toThrow("conflicts with generated target objects/bundle.js")
  expect(await readFile(join(outputDir, "keep.txt"), "utf8")).toBe("existing projection\n")
})

test("generated preflight rejects a sibling-interleaved prefix with stable owners before target mutation", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "resource-skill-generated-prefix-"))
  await Bun.write(join(outputDir, "nested/keep.txt"), "existing projection\n")
  await Bun.write(join(outputDir, "identity.bin"), new Uint8Array([0, 255, 1, 254]))
  const before = await snapshotDirectory(outputDir)
  const messages: string[] = []

  for (const reverse of [false, true]) {
    const assembly = await demoAssembly()
    if (reverse) reverseAssemblyCollections(assembly)
    const skill = assembly.skillCapsules.find((item) => item.fqn === "Demo.ResourceWorkflow.Skill.Main")!
    const mappings = skill.resourceMappings!
    const brokenAssembly = assemblyWithSkills(assembly, [{
      ...skill,
      resourceMappings: {
        ...mappings,
        content: mappings.content
          .replace(
            'kind = "Function" target = "references/Functions/"',
            'kind = "Function" target = "SKILL.md/"',
          )
          .replace(
            'kind = "WikiPage" target = "references/Wiki/"',
            'kind = "WikiPage" target = "SKILL.md-/"',
          ),
      },
    }])

    const error = await captureDistributionError(compileResourceSkillCapsule({
      assembly: brokenAssembly,
      skillFqn: skill.fqn,
      outputDir,
      schemas: demoSchemas(),
    }))
    expect(error.code).toBe("SKILL_GENERATED_TARGET_COLLISION")
    expect(error.message).toContain("owner generated:skill target SKILL.md")
    expect(error.message).toContain(
      "owner resource:Demo.ResourceWorkflow.Function.PrepareProcedure target SKILL.md/PrepareProcedure.md",
    )
    expect(error.message).not.toContain("EEXIST")
    expect(await snapshotDirectory(outputDir)).toEqual(before)
    messages.push(error.message)
  }
  expect(messages[1]).toBe(messages[0])
})

for (const unsafeClaim of [
  {
    label: "generated",
    rewrite(content: string) {
      return content.replace(
        'kind = "Function" target = "references/Functions/"',
        'kind = "Function" target = "bad\0generated/"',
      )
    },
  },
  {
    label: "mapping",
    rewrite(content: string) {
      return content.replace(
        'to = "references/Shared/SharedNotes.md"',
        'to = "bad\0mapping/SharedNotes.md"',
      )
    },
  },
] as const) {
  test(`rejects a control code in ${unsafeClaim.label} target claims before filesystem mutation`, async () => {
    const assembly = await demoAssembly()
    const skill = assembly.skillCapsules.find((item) => item.fqn === "Demo.ResourceWorkflow.Skill.Main")!
    const mappings = skill.resourceMappings!
    const brokenAssembly = assemblyWithSkills(assembly, [{
      ...skill,
      resourceMappings: { ...mappings, content: unsafeClaim.rewrite(mappings.content) },
    }])
    const parent = await mkdtemp(join(tmpdir(), "resource-skill-claim-control-"))
    const outputDir = join(parent, "live")
    await Bun.write(join(outputDir, "nested/keep.txt"), "previous projection\n")
    await Bun.write(join(outputDir, "identity.bin"), new Uint8Array([0, 255, 1, 254]))
    const before = await snapshotDirectory(parent)

    const error = await captureDistributionError(compileResourceSkillCapsule({
      assembly: brokenAssembly,
      skillFqn: skill.fqn,
      outputDir,
      schemas: demoSchemas(),
    }))
    expect(error.code).toBe("SKILL_PLAN_TARGET_INVALID")
    expect(error.message).not.toContain("ERR_INVALID_ARG_VALUE")
    expect(await snapshotDirectory(parent)).toEqual(before)
  })
}

for (const rawTarget of [
  { label: "empty", value: "" },
  { label: "dot segment", value: "unsafe/./target" },
  { label: "parent segment", value: "unsafe/../target" },
  { label: "double slash", value: "unsafe//target" },
  { label: "backslash", value: "unsafe\\target" },
  { label: "POSIX absolute", value: "/unsafe/target" },
  { label: "Windows absolute", value: "C:/unsafe/target" },
  { label: "encoded separator", value: "unsafe%2Ftarget" },
  { label: "encoded control", value: "unsafe%00target" },
  { label: "unpaired high surrogate", value: "unsafe\uD800target" },
  { label: "unpaired low surrogate", value: "unsafe\uDC00target" },
] as const) {
  for (const authority of ["generated", "mapping"] as const) {
    test(`rejects ${authority} raw ResourceMappings target with ${rawTarget.label} before normalization or mutation`, async () => {
      const messages: string[] = []
      for (const reverse of [false, true]) {
        const assembly = await demoAssembly()
        if (reverse) reverseAssemblyCollections(assembly)
        const brokenAssembly = assemblyWithResourceMappingTarget(assembly, authority, rawTarget.value)
        const parent = await mkdtemp(join(tmpdir(), "resource-skill-raw-target-invalid-"))
        const outputDir = join(parent, "live")
        await Bun.write(join(outputDir, "nested/keep.txt"), "previous projection\n")
        await Bun.write(join(outputDir, "identity.bin"), new Uint8Array([0, 255, 1, 254]))
        const before = await snapshotDirectory(parent)

        const error = await captureDistributionError(compileResourceSkillCapsule({
          assembly: brokenAssembly,
          skillFqn: "Demo.ResourceWorkflow.Skill.Main",
          outputDir,
          schemas: demoSchemas(),
        }))
        expect(error.code).toBe("SKILL_PLAN_TARGET_INVALID")
        expect(error.message).toContain(`owner ${authority === "generated"
          ? "generated-reference:Function"
          : "mapping:SharedMaterials:CopyFile"}`)
        expect(error.message).toContain(`raw target ${JSON.stringify(rawTarget.value)}`)
        if (rawTarget.label === "unpaired high surrogate") expect(error.message).toContain("U+D800")
        if (rawTarget.label === "unpaired low surrogate") expect(error.message).toContain("U+DC00")
        expect(error.message).not.toContain("ERR_INVALID_ARG_VALUE")
        expect(await snapshotDirectory(parent)).toEqual(before)
        messages.push(error.message)
      }
      expect(messages[1]).toBe(messages[0])
    })
  }
}

test("accepts legal Unicode and nested raw ResourceMappings targets without lossy normalization", async () => {
  const assembly = assemblyWithResourceMappingTarget(
    assemblyWithResourceMappingTarget(await demoAssembly(), "generated", "参考/😀/嵌套/"),
    "mapping",
    "参考/资料/😀共享.md",
  )
  const outputDir = join(await mkdtemp(join(tmpdir(), "resource-skill-raw-target-unicode-")), "live")

  const result = await compileResourceSkillCapsule({
    assembly,
    skillFqn: "Demo.ResourceWorkflow.Skill.Main",
    outputDir,
    schemas: demoSchemas(),
  })

  expect(result.files).toContain("参考/😀/嵌套/PrepareProcedure.md")
  expect(result.files).toContain("参考/资料/😀共享.md")
  expect(await readFile(join(outputDir, "参考/资料/😀共享.md"), "utf8")).toContain("Shared Workflow Notes")
})

test("compileResourceSkillCapsule rejects incomplete callable schema closure before writes", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "resource-skill-schema-closure-"))
  await writeFile(join(outputDir, "keep.txt"), "last valid projection\n")
  const schemas = demoSchemas()
  schemas.delete("Demo.ResourceWorkflow.Contract.PrepareProcedure.Input")

  await expect(compileResourceSkillCapsule({
    assembly: await demoAssembly(),
    skillFqn: "Demo.ResourceWorkflow.Skill.Main",
    outputDir,
    schemas,
  })).rejects.toThrow("is missing input schema")
  expect(await readFile(join(outputDir, "keep.txt"), "utf8")).toBe("last valid projection\n")
})

test("compileResourceSkillCapsule rejects incomplete object operation schema closure before writes", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "resource-skill-object-schema-closure-"))
  await writeFile(join(outputDir, "keep.txt"), "last valid projection\n")
  const schemas = demoSchemas()
  schemas.delete("Demo.ResourceWorkflow.Contract.ReservationApproveAction.Input")

  await expect(compileResourceSkillCapsule({
    assembly: await demoAssembly(),
    skillFqn: "Demo.ResourceWorkflow.Skill.Main",
    outputDir,
    schemas,
  })).rejects.toThrow("Object operation Demo.ResourceWorkflow.BO.MakerSpace.Reservation.approve is missing input schema")
  expect(await readFile(join(outputDir, "keep.txt"), "utf8")).toBe("last valid projection\n")
})

async function demoAssembly() {
  const domainRoot = join(import.meta.dir, "../../../apps/demo-resource-workflow-authoring/resources-xnl")
  const sharedRoot = join(import.meta.dir, "../../../apps/demo-resource-workflow-shared-authoring/resources-xnl")
  return resolveApplicationAssembly({
    modules: [{
      id: "SharedAuthoring",
      packageName: "demo-resource-workflow-shared-authoring",
      family: "demo-resource-workflow",
      scope: "shared",
      resourceRootDir: sharedRoot,
      ports: [{
        fqn: "Demo.ResourceWorkflow.Shared.Port.PrepareProcedure",
        description: "Prepare procedure provider.",
        resourceKind: "Function",
        contractRef: "resource://Demo.ResourceWorkflow.Contract.PrepareProcedure.Input",
      }],
    }, {
      id: "DomainAuthoring",
      packageName: "demo-resource-workflow-authoring",
      family: "demo-resource-workflow",
      scope: "domain",
      resourceRootDir: domainRoot,
    }],
    portBindings: [{
      portFqn: "Demo.ResourceWorkflow.Shared.Port.PrepareProcedure",
      resourceRef: "resource://Demo.ResourceWorkflow.Function.PrepareProcedure",
    }],
  })
}

function xnlSchemas() {
  return new Map<string, unknown>([
    ["demo.contract.prepare.input", { type: "object" }],
    ["demo.contract.prepare.output", { type: "object" }],
  ])
}

function skillsByFqn(assembly: ApplicationAssembly, ...fqns: string[]): SkillCapsuleResource[] {
  return fqns.map((fqn) => {
    const skill = assembly.skillCapsules.find((item) => item.fqn === fqn)
    if (!skill) throw new Error(`test fixture Skill missing: ${fqn}`)
    return skill
  })
}

function assemblyWithSkills(
  assembly: ApplicationAssembly,
  skills: readonly SkillCapsuleResource[],
): ApplicationAssembly {
  const byFqn = new Map(assembly.byFqn)
  for (const original of assembly.skillCapsules) byFqn.delete(original.fqn)
  for (const skill of skills) byFqn.set(skill.fqn, skill)
  return { ...assembly, skillCapsules: skills, byFqn }
}

function assemblyWithResourceMappingTarget(
  assembly: ApplicationAssembly,
  authority: "generated" | "mapping",
  rawTarget: string,
): ApplicationAssembly {
  const rootFqn = "Demo.ResourceWorkflow.Skill.Main"
  return assemblyWithSkills(assembly, assembly.skillCapsules.map((skill) => {
    if (skill.fqn !== rootFqn || !skill.resourceMappings) return skill
    const content = authority === "generated"
      ? skill.resourceMappings.content.replace(
        'kind = "Function" target = "references/Functions/"',
        `kind = "Function" target = ${xnlRawPathLiteral(rawTarget)}`,
      )
      : skill.resourceMappings.content.replace(
        'to = "references/Shared/SharedNotes.md"',
        `to = ${xnlRawPathLiteral(rawTarget)}`,
      )
    return { ...skill, resourceMappings: { ...skill.resourceMappings, content } }
  }))
}

function xnlRawPathLiteral(value: string): string {
  const containsUnpairedSurrogate = [...value].some((character) => {
    const codeUnit = character.charCodeAt(0)
    return character.length === 1 && codeUnit >= 0xD800 && codeUnit <= 0xDFFF
  })
  return containsUnpairedSurrogate ? `"${value}"` : JSON.stringify(value)
}

function addOrderingResources(assembly: ApplicationAssembly): void {
  const functions = assembly.functions as ContractedCallableResource[]
  const composedFunctions = assembly.composedFunctions as ContractedCallableResource[]
  const applicationSops = assembly.applicationSops as TextResource[]
  const promptFragments = assembly.promptFragments as TextResource[]
  const wikiPages = assembly.wikiPages as TextResource[]
  const byFqn = assembly.byFqn as Map<string, AssemblyResource>
  const skill = assembly.skillCapsules.find((item) => item.fqn === "Demo.ResourceWorkflow.Skill.Main")!

  const additions: AssemblyResource[] = [
    { ...functions[0]!, fqn: "Demo.ResourceWorkflow.Function.ZetaPrepareProcedure" },
    { ...composedFunctions[0]!, fqn: "Demo.ResourceWorkflow.ComposedFunction.ZetaPrepareWorkflow" },
    { ...applicationSops[0]!, fqn: "Demo.ResourceWorkflow.ApplicationSOP.ZetaApproval" },
    { ...promptFragments[0]!, fqn: "Demo.ResourceWorkflow.PromptFragment.ZetaPrelude" },
    { ...wikiPages[0]!, fqn: "Demo.ResourceWorkflow.Wiki.ZetaLifecycle" },
  ]
  functions.push(additions[0] as ContractedCallableResource)
  composedFunctions.push(additions[1] as ContractedCallableResource)
  applicationSops.push(additions[2] as TextResource)
  promptFragments.push(additions[3] as TextResource)
  wikiPages.push(additions[4] as TextResource)
  for (const resource of additions) byFqn.set(resource.fqn, resource)
  ;(skill as SkillCapsuleResource & { includes: Array<{ kind: string; ref: string }> }).includes = [
    ...skill.includes,
    ...additions.map((resource) => ({ kind: resource.kind, ref: `resource://${resource.fqn}` })),
  ]
}

function reverseAssemblyCollections(assembly: ApplicationAssembly): void {
  const mutable = assembly as unknown as Record<string, unknown[]>
  for (const key of [
    "modules",
    "portBindings",
    "functions",
    "composedFunctions",
    "businessObjects",
    "businessObjectSops",
    "applicationSops",
    "promptFragments",
    "wikiPages",
    "skillCapsules",
    "pageObjects",
  ]) {
    mutable[key]!.reverse()
  }
  for (const owner of [...assembly.businessObjects, ...assembly.pageObjects]) {
    ;(owner.operations as ObjectOperationDefinition[]).reverse()
    ;(owner.targetKinds as unknown as Array<{ kindFqn: string }>).reverse()
    for (const operation of owner.operations) {
      ;(operation.invocationModes as string[]).reverse()
    }
  }
  for (const owner of assembly.businessObjects) {
    ;(owner.sopRefs as string[]).reverse()
    ;(owner.relatedRefs as string[]).reverse()
  }
}

function withRecomputedClosureDigest(plan: SkillCapsuleDistributionPlan): SkillCapsuleDistributionPlan {
  const payload = JSON.stringify({
    format: "halfcode.skill-distribution/v1",
    roots: plan.roots,
    topology: plan.topology,
    capsules: plan.capsules.map((capsule) => ({
      identity: capsule.identity,
      capsuleDigest: capsule.capsuleDigest,
    })),
  })
  return {
    ...plan,
    closureDigest: `sha256:${createHash("sha256").update(payload).digest("hex")}`,
  }
}

function withRewrittenPlanFilePath(
  plan: SkillCapsuleDistributionPlan,
  field: "capsuleRelativePath" | "targetRelativePath",
  value: string,
): SkillCapsuleDistributionPlan {
  const owner = plan.capsules[0]!
  const original = owner.files[0]!
  const rewritten: PlannedSkillFile = {
    ...original,
    [field]: value,
  }
  const capsules = plan.capsules.map((capsule, capsuleIndex) => {
    if (capsuleIndex !== 0) return capsule
    const files = capsule.files.map((file, fileIndex) => fileIndex === 0 ? rewritten : file)
    return {
      ...capsule,
      files,
      capsuleDigest: testDigestJson({
        format: "halfcode.skill-capsule/v1",
        identity: capsule.identity,
        dependencies: capsule.dependencies,
        files: files.map(testFileDigestProjection),
      }),
    }
  })
  const files = capsules.flatMap((capsule) => capsule.files)
    .sort((left, right) => left.targetRelativePath < right.targetRelativePath
      ? -1
      : left.targetRelativePath > right.targetRelativePath ? 1 : 0)
  return {
    ...plan,
    capsules,
    files,
    closureDigest: testDigestJson({
      format: "halfcode.skill-distribution/v1",
      roots: plan.roots,
      topology: plan.topology,
      capsules: capsules.map((capsule) => ({
        identity: capsule.identity,
        capsuleDigest: capsule.capsuleDigest,
      })),
    }),
  }
}

function withDirectPlanFilePathChange(
  plan: SkillCapsuleDistributionPlan,
  surface: "capsule files" | "public files",
  field: "capsuleRelativePath" | "targetRelativePath",
  value: string,
): SkillCapsuleDistributionPlan {
  if (surface === "public files") {
    return {
      ...plan,
      files: plan.files.map((file, fileIndex) => fileIndex === 0
        ? { ...file, [field]: value }
        : file),
    }
  }
  return {
    ...plan,
    capsules: plan.capsules.map((capsule, capsuleIndex) => capsuleIndex === 0
      ? {
        ...capsule,
        files: capsule.files.map((file, fileIndex) => fileIndex === 0
          ? { ...file, [field]: value }
          : file),
      }
      : capsule),
  }
}

function withRewrittenCapsuleFiles(
  plan: SkillCapsuleDistributionPlan,
  targetFqn: string,
  rewrite: (files: readonly PlannedSkillFile[], identityName: string) => PlannedSkillFile[],
): SkillCapsuleDistributionPlan {
  const capsules = plan.capsules.map((capsule) => {
    if (capsule.identity.fqn !== targetFqn) return capsule
    const files = rewrite(capsule.files, capsule.identity.name)
    return {
      ...capsule,
      files,
      capsuleDigest: testDigestJson({
        format: "halfcode.skill-capsule/v1",
        identity: capsule.identity,
        dependencies: capsule.dependencies,
        files: files.map(testFileDigestProjection),
      }),
    }
  })
  const files = capsules.flatMap((capsule) => capsule.files)
    .sort((left, right) => left.targetRelativePath < right.targetRelativePath
      ? -1
      : left.targetRelativePath > right.targetRelativePath ? 1 : 0)
  return withRecomputedClosureDigest({ ...plan, capsules, files })
}

function testFileDigestProjection(file: PlannedSkillFile) {
  return {
    skillFqn: file.skillFqn,
    skillApiVersion: file.skillApiVersion,
    skillVersion: file.skillVersion,
    capsuleRelativePath: file.capsuleRelativePath,
    targetRelativePath: file.targetRelativePath,
    contentDigest: file.contentDigest,
  }
}

function withPlannedFileText(file: PlannedSkillFile, content: string): PlannedSkillFile {
  const bytes = new TextEncoder().encode(content)
  return {
    ...file,
    contentBase64: Buffer.from(bytes).toString("base64"),
    content: bytes,
    contentDigest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  }
}

function testDigestJson(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`
}

async function snapshotDirectory(root: string): Promise<ReadonlyArray<readonly [string, string]>> {
  const snapshot: Array<readonly [string, string]> = []
  const visit = async (directory: string, prefix: string): Promise<void> => {
    for (const entry of (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
      const absolutePath = join(directory, entry.name)
      if (entry.isDirectory()) await visit(absolutePath, relativePath)
      else snapshot.push([relativePath, Buffer.from(await readFile(absolutePath)).toString("base64")])
    }
  }
  await visit(root, "")
  return snapshot
}

async function captureDistributionError(promise: Promise<unknown>): Promise<SkillCapsuleDistributionError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(SkillCapsuleDistributionError)
    return error as SkillCapsuleDistributionError
  }
  throw new Error("Expected SkillCapsuleDistributionError")
}

function demoSchemas() {
  return new Map<string, unknown>([
    ["Demo.ResourceWorkflow.Contract.PrepareProcedure.Input", {
      type: "object", properties: { procedureName: { type: "string" } },
    }],
    ["Demo.ResourceWorkflow.Contract.PrepareProcedure.Output", {
      type: "object", properties: { accepted: { type: "boolean" } },
    }],
    ["Demo.ResourceWorkflow.Contract.PrepareWorkflow.Input", {
      type: "object", properties: { procedureName: { type: "string" } },
    }],
    ["Demo.ResourceWorkflow.Contract.PrepareWorkflow.Output", {
      type: "object", properties: { ready: { type: "boolean" } },
    }],
    ["Demo.ResourceWorkflow.Contract.ReservationApproveAction.Input", {
      type: "object", properties: { approvedBy: { type: "string" } },
    }],
    ["Demo.ResourceWorkflow.Contract.ReservationApproveAction.Output", {
      type: "object", properties: { done: { type: "boolean" } },
    }],
  ])
}

function schemaOrderingFixtures(reverseKeys: boolean, reverseRequired: boolean): Map<string, unknown> {
  const schemas = demoSchemas()
  const fixtures = new Map<string, unknown>([
    ["Demo.ResourceWorkflow.Contract.PrepareProcedure.Input", {
      title: "Prepare procedure input",
      type: "object",
      required: reverseRequired ? ["objective", "procedureName"] : ["procedureName", "objective"],
      properties: {
        procedureName: { type: "string", minLength: 1 },
        objective: { type: "string", description: "Requested outcome" },
      },
    }],
    ["Demo.ResourceWorkflow.Contract.PrepareProcedure.Output", {
      type: "object",
      required: ["accepted", "summary"],
      properties: {
        accepted: { type: "boolean" },
        summary: { type: "string" },
      },
    }],
    ["Demo.ResourceWorkflow.Contract.ReservationApproveAction.Input", {
      type: "object",
      required: ["approvedBy", "checks"],
      properties: {
        approvedBy: { type: "string" },
        checks: {
          type: "array",
          items: { type: "string", enum: ["member", "tool", "window"] },
        },
      },
    }],
    ["Demo.ResourceWorkflow.Contract.ReservationApproveAction.Output", {
      type: "object",
      properties: {
        done: { type: "boolean" },
        audit: { type: "object", properties: { actor: { type: "string" }, at: { type: "string" } } },
      },
    }],
  ])
  for (const [fqn, value] of fixtures) schemas.set(fqn, reverseKeys ? reverseJsonObjectKeys(value) : value)
  return schemas
}

function reverseJsonObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseJsonObjectKeys)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value).reverse().map(([key, nested]) => [key, reverseJsonObjectKeys(nested)]),
  )
}
