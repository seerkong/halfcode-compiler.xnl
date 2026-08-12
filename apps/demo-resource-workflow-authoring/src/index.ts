import type { AuthoringModuleDescriptor } from "halfcode-compiler-application-assembly"

export * from "./Functions/PrepareProcedure"
export * from "./ComposedFunctions/PrepareWorkflow"
export * from "./BusinessActions/ReservationApprove"
export * from "./BusinessMutations/ReservationMarkApproved"
export * from "./PageObjects/ReservationDetail"

export const demoResourceWorkflowAuthoringPackage = {
  role: "authoring",
  family: "demo-resource-workflow",
  owns: "target-neutral resources and deterministic code bindings",
} as const

export const demoResourceWorkflowAuthoringModule: AuthoringModuleDescriptor = {
  id: "DomainAuthoring",
  packageName: "demo-resource-workflow-authoring",
  family: "demo-resource-workflow",
  scope: "domain",
  resourceRootDir: new URL("../resources-xnl", import.meta.url).pathname,
}
