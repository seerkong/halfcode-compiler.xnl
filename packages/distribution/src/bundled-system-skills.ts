import { fileURLToPath } from "node:url"
import type { AuthoringModuleDescriptor } from "halfcode-compiler-application-assembly"
import type { SkillCapsuleDistributionPlan } from "halfcode-compiler-skill-capsule"

export function loadHalfcodeResourceDslSystemSkillModule(): AuthoringModuleDescriptor {
  return Object.freeze({
    id: "ResourceDsl",
    packageName: "halfcode-resource-dsl-system-skill",
    family: "halfcode-resource-dsl",
    scope: "shared",
    resourceRootDir: fileURLToPath(new URL("./system-skills/resource-dsl/", import.meta.url)),
  })
}

export async function loadHalfcodeResourceDslSystemSkillPlan(): Promise<SkillCapsuleDistributionPlan> {
  const moduleUrl = new URL("./system-skills/sys-halfcode-resource-dsl.plan.js", import.meta.url)
  const bundled = await import(moduleUrl.href) as { readonly default?: SkillCapsuleDistributionPlan }
  if (!bundled.default) throw new Error("HALFCODE_RESOURCE_DSL_SKILL_PLAN_MISSING: bundled plan has no default export")
  return bundled.default
}
