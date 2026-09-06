import { AsyncLocalStorage } from "node:async_hooks"

export interface Logger {
  info(message: string, fields?: Readonly<Record<string, unknown>>): void
  warn(message: string, fields?: Readonly<Record<string, unknown>>): void
  error(message: string, fields?: Readonly<Record<string, unknown>>): void
}

export interface RuntimeEffects {
  logger: Logger
  invoke<TResult = unknown>(effectFqn: string, input: unknown): Promise<TResult>
}

export interface AuthoringRuntime<TContext extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>> {
  context: TContext
  effects: RuntimeEffects
}

export interface AuthoringBindings {
  readonly runtime: AuthoringRuntime
  readonly logger: Logger
  invokeEffect<TResult = unknown>(effectFqn: string, input: unknown): Promise<TResult>
}

const runtimeScope = new AsyncLocalStorage<AuthoringRuntime>()

export function runWithRuntime<T>(runtime: AuthoringRuntime, callback: () => T): T {
  return runtimeScope.run(runtime, callback)
}

export function currentRuntime(): AuthoringRuntime {
  const runtime = runtimeScope.getStore()
  if (!runtime) throw new Error("No authoring runtime is active in the current async scope")
  return runtime
}

export function createAuthoringBindings(runtime = currentRuntime()): AuthoringBindings {
  return {
    runtime,
    logger: runtime.effects.logger,
    invokeEffect: (effectFqn, input) => runtime.effects.invoke(effectFqn, input),
  }
}

export const logger: Logger = {
  info(message, fields) {
    currentRuntime().effects.logger.info(message, fields)
  },
  warn(message, fields) {
    currentRuntime().effects.logger.warn(message, fields)
  },
  error(message, fields) {
    currentRuntime().effects.logger.error(message, fields)
  },
}

export function invokeEffect<TResult = unknown>(effectFqn: string, input: unknown): Promise<TResult> {
  return currentRuntime().effects.invoke<TResult>(effectFqn, input)
}

export const runtimeAuthoringPackage = {
  role: "framework",
  area: "runtime-authoring",
  owns: "target-neutral deterministic-code runtime and effect boundary",
} as const

export * from "./resource-authoring"
export * from "./code-execution"
