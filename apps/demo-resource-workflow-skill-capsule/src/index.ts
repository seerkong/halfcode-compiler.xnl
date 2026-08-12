import { compilerSkillPackage } from "halfcode-compiler-skill-capsule"
import { demoResourceWorkflowAuthoringPackage } from "demo-resource-workflow-authoring"

export const demoResourceWorkflowSkillCapsulePackage = {
  role: "skill-capsule",
  family: "demo-resource-workflow",
  target: "standard-skill",
  dependsOn: [
    compilerSkillPackage.area,
    demoResourceWorkflowAuthoringPackage.role,
  ],
} as const
