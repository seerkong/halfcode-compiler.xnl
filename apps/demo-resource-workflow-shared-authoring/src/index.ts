import type { AuthoringModuleDescriptor } from "halfcode-compiler-application-assembly"

export const demoResourceWorkflowSharedAuthoringModule: AuthoringModuleDescriptor = {
  id: "SharedAuthoring",
  packageName: "demo-resource-workflow-shared-authoring",
  family: "demo-resource-workflow",
  scope: "shared",
  resourceRootDir: new URL("../resources-xnl", import.meta.url).pathname,
  ports: [{
    fqn: "Demo.ResourceWorkflow.Shared.Port.PrepareProcedure",
    description: "Capability used to prepare a workflow procedure.",
    resourceKind: "Function",
    contractRef: "resource://Demo.ResourceWorkflow.Contract.PrepareProcedure.Input",
  }],
}
