import type {
  PrepareWorkflowInput,
  PrepareWorkflowOutput,
} from "demo-resource-workflow-contracts/ComposedFunction/PrepareWorkflow"
import { prepareProcedure } from "../Functions/PrepareProcedure"

export function prepareWorkflow(input: PrepareWorkflowInput): PrepareWorkflowOutput {
  const prepared = prepareProcedure({
    procedureName: input.procedureName,
    objective: input.objective,
    audience: input.reviewer,
  })
  return {
    ready: prepared.accepted,
    summary: prepared.summary,
    reviewHint: input.reviewer
      ? `Ask ${input.reviewer} to review the procedure before publishing.`
      : "Assign a reviewer before publishing.",
  }
}
