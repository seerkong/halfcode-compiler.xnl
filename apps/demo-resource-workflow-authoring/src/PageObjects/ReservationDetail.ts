import type { ObjectOperationHandler } from "halfcode-compiler-application-assembly"

function receipt(
  operation: string,
  targets: Parameters<ObjectOperationHandler>[1],
  invocation: Parameters<ObjectOperationHandler>[2],
  config: Parameters<ObjectOperationHandler>[3],
) {
  return { operation, targets, invocation, config: config ?? null }
}

export const open: ObjectOperationHandler = (_runtime, targets, invocation, config) =>
  receipt("open", targets, invocation, config)

export const fill: ObjectOperationHandler = (_runtime, targets, invocation, config) =>
  receipt("fill", targets, invocation, config)

export const save: ObjectOperationHandler = (_runtime, targets, invocation, config) =>
  receipt("save", targets, invocation, config)

export const reconcile: ObjectOperationHandler = (_runtime, targets, invocation, config) =>
  receipt("reconcile", targets, invocation, config)
