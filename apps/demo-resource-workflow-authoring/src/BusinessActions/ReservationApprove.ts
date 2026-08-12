import type {
  ReservationApproveActionInput,
  ReservationApproveActionOutput,
} from "demo-resource-workflow-contracts/BusinessObject/ReservationApproveAction"
import type { ObjectOperationHandler } from "halfcode-compiler-application-assembly"

export const approveReservationAction: ObjectOperationHandler<unknown, ReservationApproveActionOutput> = (
  _runtime,
  targets,
  invocation,
  _config,
) => {
  if (targets.kind !== "single" || invocation.kind !== "action") {
    throw new TypeError("approveReservationAction requires a single target and action invocation")
  }
  const input = invocation.input as ReservationApproveActionInput | undefined
  const reservationNumber = String(targets.ref.key.reservationNumber ?? "").trim()
  const approvedBy = input?.approvedBy.trim() ?? ""
  const valid = reservationNumber.length > 0 && approvedBy.length > 0
  return {
    done: valid,
    summary: valid
      ? `Reservation ${reservationNumber} approved by ${approvedBy}.`
      : "Reservation approval requires a reservation number and approver.",
    workflowState: valid ? "Approved" : "Requested",
  }
}
