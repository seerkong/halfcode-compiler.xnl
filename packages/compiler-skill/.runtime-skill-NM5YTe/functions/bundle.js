import { runWithRuntime } from "@ai-resource-compiler/runtime-authoring"
import Demo_ResourceWorkflow_Function_PrepareProcedure from "./Functions/PrepareProcedure.js"
import Demo_ResourceWorkflow_ComposedFunction_PrepareWorkflow from "./ComposedFunctions/PrepareWorkflow.js"
import Demo_ResourceWorkflow_BO_MakerSpace_Reservation_Action_Approve from "./BusinessActions/Approve.js"

const registry = { "Demo.ResourceWorkflow.Function.PrepareProcedure": { kind: "Function", handler: Demo_ResourceWorkflow_Function_PrepareProcedure }, "Demo.ResourceWorkflow.ComposedFunction.PrepareWorkflow": { kind: "ComposedFunction", handler: Demo_ResourceWorkflow_ComposedFunction_PrepareWorkflow }, "Demo.ResourceWorkflow.BO.MakerSpace.Reservation.Action.Approve": { kind: "BusinessAction", handler: Demo_ResourceWorkflow_BO_MakerSpace_Reservation_Action_Approve } }

export async function run_callable_resource(fqn, input, runtime) {
  const entry = registry[fqn]
  if (!entry) throw new Error(`Unknown callable resource: ${fqn}`)
  const invoke = () => entry.handler(input)
  return runtime ? runWithRuntime(runtime, invoke) : invoke()
}

export function resolve_callable_resource(fqn) {
  const entry = registry[fqn]
  if (!entry) throw new Error(`Unknown callable resource: ${fqn}`)
  return { fqn, kind: entry.kind }
}
