import { inputSchema as prepareProcedureInputSchema, outputSchema as prepareProcedureOutputSchema } from "./Function/PrepareProcedure"
import { inputSchema as prepareWorkflowInputSchema, outputSchema as prepareWorkflowOutputSchema } from "./ComposedFunction/PrepareWorkflow"
import { inputSchema as reservationApproveActionInputSchema, outputSchema as reservationApproveActionOutputSchema } from "./BusinessObject/ReservationApproveAction"

export type {
  PrepareProcedureInput,
  PrepareProcedureOutput,
} from "./Function/PrepareProcedure"
export type {
  PrepareWorkflowInput,
  PrepareWorkflowOutput,
} from "./ComposedFunction/PrepareWorkflow"
export type {
  ReservationApproveActionInput,
  ReservationApproveActionOutput,
} from "./BusinessObject/ReservationApproveAction"
export type { ResourceWorkflowReadiness } from "./Shared"

export {
  prepareProcedureInputSchema,
  prepareProcedureOutputSchema,
  prepareWorkflowInputSchema,
  prepareWorkflowOutputSchema,
  reservationApproveActionInputSchema,
  reservationApproveActionOutputSchema,
}

export const demoResourceWorkflowContractsPackage = {
  role: "contracts",
  family: "demo-resource-workflow",
  owns: "public TypeScript contracts and generated schema facts",
} as const

export const contractSchemas = new Map<string, unknown>([
  [prepareProcedureInputSchema.$id, prepareProcedureInputSchema],
  [prepareProcedureOutputSchema.$id, prepareProcedureOutputSchema],
  [prepareWorkflowInputSchema.$id, prepareWorkflowInputSchema],
  [prepareWorkflowOutputSchema.$id, prepareWorkflowOutputSchema],
  [reservationApproveActionInputSchema.$id, reservationApproveActionInputSchema],
  [reservationApproveActionOutputSchema.$id, reservationApproveActionOutputSchema],
])

export function getContractSchema(schemaId: string): unknown {
  const schema = contractSchemas.get(schemaId)
  if (!schema) {
    throw new Error(`Unknown contract schema: ${schemaId}`)
  }
  return schema
}
