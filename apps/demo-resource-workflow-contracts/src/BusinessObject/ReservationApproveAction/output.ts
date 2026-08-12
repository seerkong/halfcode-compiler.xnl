export interface ReservationApproveActionOutput {
  done: boolean
  summary: string
  workflowState: "Requested" | "Approved"
}
