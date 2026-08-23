import { expect, test } from "bun:test"
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { halfcodeResourceDslSystemSkillModule } from "../../../apps/halfcode-resource-dsl-system-skill/src/index"
import { demoResourceWorkflowAuthoringModule } from "../../../apps/demo-resource-workflow-authoring/src/index"
import {
  resolveApplicationAssembly,
  type ApplicationAssembly,
} from "halfcode-compiler-application-assembly"
import {
  applySkillCapsuleDistributionPlan,
  planSkillCapsuleDistribution,
  skillCapsuleDistributionProjection,
} from "./index"

const resourceRootDir = join(import.meta.dir, "../../../docs/resource-dsl")
const skillFqn = "Halfcode.ResourceDsl.Skill.System"
const outputName = "sys-halfcode-resource-dsl"

test("compiles canonical Resource DSL documents and examples into progressive references", async () => {
  const assembly = await resourceDslAssembly(resourceRootDir)
  const systemSkill = assembly.skillCapsules.find((skill) => skill.fqn === skillFqn)
  const plan = await planSkillCapsuleDistribution({ assembly, rootSkillFqns: [skillFqn] })

  expect(systemSkill).toEqual(expect.objectContaining({ name: outputName }))
  expect(Object.prototype.hasOwnProperty.call(systemSkill?.metadata, "name")).toBe(false)

  expect(plan.roots).toEqual([{
    fqn: skillFqn,
    name: outputName,
    apiVersion: "halfcode.resources/v1",
    version: "1.0.0",
  }])
  const skillText = fileText(plan, `${outputName}/SKILL.md`)
  expect(skillText).toContain("references/resource-dsl/index.md")
  expect(skillText).toContain("references/.halfcode/provenance.json")
  for (const marker of ["bun test", "npm install", ".eidolon", "global init", "WorkflowWorkspace"]) {
    expect(skillText.includes(marker)).toBe(false)
  }

  const canonicalIndex = await readFile(join(resourceRootDir, "index.md"), "utf8")
  expect(fileText(plan, `${outputName}/references/resource-dsl/index.md`)).toEndWith(canonicalIndex)
  const canonicalExample = new Uint8Array(await readFile(join(resourceRootDir, "examples/resource-package.xnl")))
  expect(fileBytes(plan, `${outputName}/references/resource-dsl/examples/resource-package.xnl`))
    .toEqual(canonicalExample)

  const provenance = JSON.parse(fileText(plan, `${outputName}/references/.halfcode/provenance.json`))
  expect(provenance.source).toEqual({
    fqn: skillFqn,
    apiVersion: "halfcode.resources/v1",
    version: "1.0.0",
  })
  expect(provenance.generatedBy).toBe("halfcode.skill-distribution/v1")
})

test("resolves a typed sibling dependency on the canonical Resource DSL Skill in one plan", async () => {
  const downstreamRoot = await mkdtemp(join(tmpdir(), "halfcode-resource-dsl-dependent-module-"))
  await cp(demoResourceWorkflowAuthoringModule.resourceRootDir, downstreamRoot, { recursive: true })
  const descriptorPath = join(downstreamRoot, "SkillCapsules/TopologyAuthoring/manifest.xnl")
  const descriptor = await readFile(descriptorPath, "utf8")
  await writeFile(
    descriptorPath,
    descriptor.replace("example.resource_lifecycle.skill.resource_dsl", skillFqn),
  )
  const downstreamFqn = "example.resource_lifecycle.skill.authoring"
  const combined = await resolveApplicationAssembly({
    modules: [
      halfcodeResourceDslSystemSkillModule,
      { ...demoResourceWorkflowAuthoringModule, resourceRootDir: downstreamRoot },
    ],
    portBindings: [],
  })

  const plan = await planSkillCapsuleDistribution({
    assembly: combined,
    rootSkillFqns: [downstreamFqn],
  })

  expect(plan.topology).toEqual([skillFqn, downstreamFqn])
  expect(plan.roots.map((root) => root.fqn)).toEqual([downstreamFqn])
  expect(plan.capsules.map((capsule) => capsule.identity.fqn)).toEqual([skillFqn, downstreamFqn])
})

test("rejects a YAML name when the SkillCapsule descriptor owns the name", async () => {
  const copiedRoot = await mkdtemp(join(tmpdir(), "halfcode-resource-dsl-name-authority-"))
  await cp(resourceRootDir, copiedRoot, { recursive: true })
  const metadataPath = join(copiedRoot, "SkillCapsules/System/SKILL.metadata.yaml")
  await writeFile(metadataPath, `${await readFile(metadataPath, "utf8")}name: duplicate-name\n`)

  await expect(resourceDslAssembly(copiedRoot)).rejects.toThrow("SKILL_CAPSULE_NAME_DUPLICATE")
})

test("keeps the Resource DSL Skill plan stable across resource enumeration order", async () => {
  const assembly = await resourceDslAssembly(resourceRootDir)
  const reversed: ApplicationAssembly = {
    ...assembly,
    wikiPages: [...assembly.wikiPages].reverse(),
    skillCapsules: [...assembly.skillCapsules].reverse(),
    modules: [...assembly.modules].reverse(),
  }
  const canonical = await planSkillCapsuleDistribution({ assembly, rootSkillFqns: [skillFqn] })
  const reordered = await planSkillCapsuleDistribution({ assembly: reversed, rootSkillFqns: [skillFqn] })

  expect(skillCapsuleDistributionProjection(reordered)).toEqual(skillCapsuleDistributionProjection(canonical))
  expect(reordered.closureDigest).toBe(canonical.closureDigest)
})

test("binds canonical document changes into reference, provenance and closure digests", async () => {
  const copiedRoot = await mkdtemp(join(tmpdir(), "halfcode-resource-dsl-skill-"))
  await cp(resourceRootDir, copiedRoot, { recursive: true })
  const before = await planResourceDslSkill(copiedRoot)
  await writeFile(join(copiedRoot, "index.md"), `${await readFile(join(copiedRoot, "index.md"), "utf8")}\nCanonical extension.\n`)
  const after = await planResourceDslSkill(copiedRoot)

  expect(fileText(after, `${outputName}/references/resource-dsl/index.md`)).toContain("Canonical extension.")
  expect(fileDigest(after, `${outputName}/references/resource-dsl/index.md`))
    .not.toBe(fileDigest(before, `${outputName}/references/resource-dsl/index.md`))
  expect(fileDigest(after, `${outputName}/references/.halfcode/provenance.json`))
    .not.toBe(fileDigest(before, `${outputName}/references/.halfcode/provenance.json`))
  expect(after.closureDigest).not.toBe(before.closureDigest)
})

test("binds the XNL consumer name into the plan and rendered Skill", async () => {
  const copiedRoot = await mkdtemp(join(tmpdir(), "halfcode-resource-dsl-xnl-name-"))
  await cp(resourceRootDir, copiedRoot, { recursive: true })
  const before = await planResourceDslSkill(copiedRoot)
  const descriptorPath = join(copiedRoot, "SkillCapsules/System/manifest.xnl")
  const descriptor = await readFile(descriptorPath, "utf8")
  await writeFile(descriptorPath, descriptor.replace(outputName, `${outputName}-next`))
  const after = await planResourceDslSkill(copiedRoot)

  expect(after.roots[0]?.name).toBe(`${outputName}-next`)
  expect(fileText(after, `${outputName}-next/SKILL.md`)).toContain(`name: ${outputName}-next`)
  expect(after.closureDigest).not.toBe(before.closureDigest)
})

test("applies the complete Resource DSL Skill plan and reads back canonical files", async () => {
  const plan = await planResourceDslSkill(resourceRootDir)
  const outputRoot = join(await mkdtemp(join(tmpdir(), "halfcode-resource-dsl-install-")), "skills")
  const receipt = await applySkillCapsuleDistributionPlan(plan, { outputRoot })

  expect(receipt.installedSkills).toEqual(plan.roots)
  expect(await readFile(join(outputRoot, outputName, "references/resource-dsl/index.md"), "utf8"))
    .toContain("Halfcode XNL Resource DSL")
  expect(JSON.parse(await readFile(
    join(outputRoot, outputName, "references/.halfcode/provenance.json"),
    "utf8",
  )).source.fqn).toBe(skillFqn)
})

async function planResourceDslSkill(rootDir: string) {
  return planSkillCapsuleDistribution({
    assembly: await resourceDslAssembly(rootDir),
    rootSkillFqns: [skillFqn],
  })
}

async function resourceDslAssembly(rootDir: string) {
  return resolveApplicationAssembly({
    modules: [{ ...halfcodeResourceDslSystemSkillModule, resourceRootDir: rootDir }],
    portBindings: [],
  })
}

function fileText(plan: Awaited<ReturnType<typeof planResourceDslSkill>>, target: string): string {
  return new TextDecoder().decode(fileBytes(plan, target))
}

function fileBytes(plan: Awaited<ReturnType<typeof planResourceDslSkill>>, target: string): Uint8Array {
  const file = plan.files.find((item) => item.targetRelativePath === target)
  if (!file) throw new Error(`Missing planned file: ${target}`)
  return new Uint8Array(Buffer.from(file.contentBase64, "base64"))
}

function fileDigest(plan: Awaited<ReturnType<typeof planResourceDslSkill>>, target: string): string {
  const file = plan.files.find((item) => item.targetRelativePath === target)
  if (!file) throw new Error(`Missing planned file: ${target}`)
  return file.contentDigest
}
