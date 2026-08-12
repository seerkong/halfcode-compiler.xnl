import type { ObjectOperationHandler } from "halfcode-compiler-application-assembly"

export const markApprovedReservationMutation: ObjectOperationHandler = async (
  _runtime,
  targets,
  invocation,
  config,
) => {
  if (invocation.kind !== "mutation") {
    throw new TypeError("markApprovedReservationMutation requires a mutation invocation")
  }
  return {
    targets,
    desired: invocation.desired,
    config: config ?? null,
  }
}
