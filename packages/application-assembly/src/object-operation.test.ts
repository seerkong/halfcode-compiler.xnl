import { describe, expect, test } from "bun:test"
import {
  assertExecuteObjectOperationRequest,
  assertObjectOperationCall,
  assertObjectOperationCatalog,
  ObjectOperationContractError,
  type ObjectOperationCatalog,
  type ObjectOperationDefinition,
  type ObjectOperationHandler,
} from "./index"

const reservationKind = "Demo.ResourceWorkflow.BO.MakerSpace.Reservation"
const rowKind = `${reservationKind}.Row`

const approve: ObjectOperationDefinition = {
  ref: `${reservationKind}.approve`,
  id: "approve",
  ownerKindFqn: reservationKind,
  ownerResourceKind: "BusinessObject",
  behavior: "action",
  targets: { kind: "single", kindFqn: reservationKind },
  invocationModes: ["single", "batch"],
  effect: "write",
}

const reconcile: ObjectOperationDefinition = {
  ref: `${reservationKind}.reconcile`,
  id: "reconcile",
  ownerKindFqn: reservationKind,
  ownerResourceKind: "BusinessObject",
  behavior: "mutation",
  targets: { kind: "selection", kindFqn: rowKind },
  invocationModes: ["single"],
  effect: "mixed",
}

const catalog: ObjectOperationCatalog = {
  targetKinds: [
    { kindFqn: reservationKind, ownerKindFqn: reservationKind, role: "object" },
    { kindFqn: rowKind, ownerKindFqn: reservationKind, role: "nested-subject" },
  ],
  operations: [approve, reconcile],
}

describe("object operation contract", () => {
  test("validates a shared PageObject/BusinessObject catalog and semantic calls", () => {
    expect(() => assertObjectOperationCatalog(catalog)).not.toThrow()

    expect(() => assertObjectOperationCall({
      targets: {
        kind: "single",
        ref: { kindFqn: reservationKind, key: { reservationNumber: "R-100" } },
      },
      invocation: {
        kind: "action",
        operationRef: approve.ref,
        input: { approvedBy: "member-7" },
      },
      config: { observe: ["after"], trace: true },
    }, approve)).not.toThrow()

    expect(() => assertObjectOperationCall({
      targets: {
        kind: "selection",
        kindFqn: rowKind,
        selector: { kind: "filter", where: { workflowState: "Requested" } },
      },
      invocation: {
        kind: "mutation",
        operationRef: reconcile.ref,
        desired: { workflowState: "Approved" },
      },
    }, reconcile)).not.toThrow()
  })

  test("rejects mismatched identity, behavior, targets, modes and non-JSON control data", () => {
    const cases: Array<{ call: Parameters<typeof assertObjectOperationCall>[0]; definition?: ObjectOperationDefinition; mode?: "single" | "batch"; code: string }> = [
      {
        call: { targets: { kind: "none" }, invocation: { kind: "action", operationRef: "wrong" } },
        code: "OBJECT_OPERATION_REF_MISMATCH",
      },
      {
        call: { targets: { kind: "single", ref: { kindFqn: reservationKind, key: {} } }, invocation: { kind: "mutation", operationRef: approve.ref, desired: {} } },
        code: "OBJECT_OPERATION_BEHAVIOR_MISMATCH",
      },
      {
        call: { targets: { kind: "none" }, invocation: { kind: "action", operationRef: approve.ref } },
        code: "OBJECT_TARGET_CARDINALITY_MISMATCH",
      },
      {
        call: { targets: { kind: "single", ref: { kindFqn: reservationKind, key: {} } }, invocation: { kind: "action", operationRef: approve.ref }, config: { bad: () => undefined } as never },
        code: "OBJECT_JSON_VALUE_INVALID",
      },
      {
        call: { targets: { kind: "single", ref: { kindFqn: reservationKind, key: {} } }, invocation: { kind: "action", operationRef: approve.ref } },
        definition: { ...approve, invocationModes: ["single"] },
        mode: "batch",
        code: "OBJECT_INVOCATION_MODE_UNSUPPORTED",
      },
    ]

    for (const item of cases) {
      try {
        assertObjectOperationCall(item.call, item.definition ?? approve, item.mode)
        throw new Error("expected contract failure")
      } catch (error) {
        expect(error).toBeInstanceOf(ObjectOperationContractError)
        expect((error as ObjectOperationContractError).code).toBe(item.code)
      }
    }
  })

  test("keeps batch outside target cardinality and rejects fake atomicity", () => {
    const resolve = (ref: string) => catalog.operations.find((item) => item.ref === ref)
    expect(() => assertExecuteObjectOperationRequest({
      mode: "batch",
      items: [{
        key: "first",
        call: {
          targets: { kind: "single", ref: { kindFqn: reservationKind, key: { reservationNumber: "R-1" } } },
          invocation: { kind: "action", operationRef: approve.ref, input: { approvedBy: "A" } },
        },
      }],
      config: { atomicity: "best-effort" },
    }, resolve)).not.toThrow()

    expect(() => assertExecuteObjectOperationRequest({
      mode: "batch",
      items: [{
        key: "first",
        call: {
          targets: { kind: "single", ref: { kindFqn: reservationKind, key: {} } },
          invocation: { kind: "action", operationRef: approve.ref },
        },
      }],
      config: { atomicity: "atomic" },
    }, resolve)).toThrow("OBJECT_BATCH_ATOMICITY_UNSUPPORTED")
  })

  test("defines handlers with explicit runtime, targets, invocation and config dimensions", async () => {
    const handler: ObjectOperationHandler<{ requestId: string }> = async (
      runtime,
      targets,
      invocation,
      config,
    ) => ({ runtime, targets, invocation, config })

    const output = await handler(
      { requestId: "req-1" },
      { kind: "none" },
      { kind: "action", operationRef: "Demo.Page.open" },
      { trace: true },
    ) as { runtime: { requestId: string } }
    expect(output.runtime.requestId).toBe("req-1")
    expect(handler.length).toBe(4)
  })
})
