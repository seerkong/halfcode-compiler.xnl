import type { SkillCapsuleDistributionPlan } from "halfcode-compiler-skill-capsule"

export async function loadHalfcodeResourceDslSystemSkillPlan(): Promise<SkillCapsuleDistributionPlan> {
  const moduleUrl = new URL("./system-skills/sys-halfcode-resource-dsl.plan.js", import.meta.url)
  const bundled = await import(moduleUrl.href) as { readonly default?: SkillCapsuleDistributionPlan }
  if (!bundled.default) throw new Error("HALFCODE_RESOURCE_DSL_SKILL_PLAN_MISSING: bundled plan has no default export")
  return bundled.default
}
