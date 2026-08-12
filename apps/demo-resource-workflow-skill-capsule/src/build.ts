import { resolveApplicationAssembly } from "halfcode-compiler-application-assembly"
import { compileResourceSkillCapsule } from "halfcode-compiler-skill-capsule"
import { contractSchemas } from "demo-resource-workflow-contracts"
import { demoResourceWorkflowAuthoringModule } from "demo-resource-workflow-authoring"
import { demoResourceWorkflowSharedAuthoringModule } from "demo-resource-workflow-shared-authoring"

const outputDir = new URL("../dist/demo-resource-workflow", import.meta.url).pathname
const assembly = await resolveApplicationAssembly({
  modules: [demoResourceWorkflowSharedAuthoringModule, demoResourceWorkflowAuthoringModule],
  portBindings: [{
    portFqn: "Demo.ResourceWorkflow.Shared.Port.PrepareProcedure",
    resourceRef: "resource://Demo.ResourceWorkflow.Function.PrepareProcedure",
  }],
})
const plan = await compileResourceSkillCapsule({
  assembly,
  skillFqn: "Demo.ResourceWorkflow.Skill.Main",
  outputDir,
  schemas: contractSchemas,
})

console.log(`built ${plan.skillName}: ${plan.files.length} files`)
