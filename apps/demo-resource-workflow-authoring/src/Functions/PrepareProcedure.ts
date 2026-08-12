import type {
  PrepareProcedureInput,
  PrepareProcedureOutput,
} from "demo-resource-workflow-contracts/Function/PrepareProcedure"

export interface PrepareProcedureConfig {
  summaryPrefix?: string
}

export function prepareProcedure(
  input: PrepareProcedureInput,
  config: PrepareProcedureConfig = {},
): PrepareProcedureOutput {
  const procedureName = input.procedureName.trim()
  const objective = input.objective.trim()
  return {
    accepted: procedureName.length > 0 && objective.length > 0,
    summary: `${config.summaryPrefix ?? "Prepared"} procedure ${procedureName} for ${input.audience ?? "general users"}.`,
    nextStep: "Review the draft and confirm the expected outcome before execution.",
  }
}
