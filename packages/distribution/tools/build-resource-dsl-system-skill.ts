import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { halfcodeResourceDslSystemSkillModule } from "../../../apps/halfcode-resource-dsl-system-skill/src/index"
import { resolveApplicationAssembly } from "halfcode-compiler-application-assembly"
import {
  planSkillCapsuleDistribution,
  skillCapsuleDistributionProjection,
} from "halfcode-compiler-skill-capsule"

const distRoot = join(import.meta.dir, "../dist")
const outputDir = join(distRoot, "system-skills")
const assembly = await resolveApplicationAssembly({
  modules: [halfcodeResourceDslSystemSkillModule],
  portBindings: [],
})
const plan = await planSkillCapsuleDistribution({
  assembly,
  rootSkillFqns: ["Halfcode.ResourceDsl.Skill.System"],
})
const projection = skillCapsuleDistributionProjection(plan)
const moduleSource = [
  `const projection = ${JSON.stringify(projection, null, 2)}`,
  "",
  "function hydrateFile(file) {",
  "  const contentBase64 = file.contentBase64",
  "  return {",
  "    ...file,",
  "    get content() { return new Uint8Array(Buffer.from(contentBase64, \"base64\")) },",
  "  }",
  "}",
  "",
  "const capsules = projection.capsules.map((capsule) => ({",
  "  ...capsule,",
  "  files: capsule.files.map(hydrateFile),",
  "}))",
  "const plan = {",
  "  ...projection,",
  "  capsules,",
  "  files: capsules.flatMap((capsule) => capsule.files)",
  "    .sort((left, right) => left.targetRelativePath < right.targetRelativePath ? -1 : left.targetRelativePath > right.targetRelativePath ? 1 : 0),",
  "}",
  "",
  "deepFreeze(plan)",
  "export default plan",
  "",
  "function deepFreeze(value) {",
  "  if (!value || typeof value !== \"object\" || Object.isFrozen(value)) return value",
  "  if (ArrayBuffer.isView(value)) return value",
  "  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {",
  "    if (Object.prototype.hasOwnProperty.call(descriptor, \"value\")) deepFreeze(descriptor.value)",
  "  }",
  "  return Object.freeze(value)",
  "}",
  "",
].join("\n")

await mkdir(outputDir, { recursive: true })
await writeFile(join(outputDir, "sys-halfcode-resource-dsl.plan.js"), moduleSource)

console.log(JSON.stringify({
  skill: plan.roots[0],
  files: plan.files.length,
  closureDigest: plan.closureDigest,
}))
