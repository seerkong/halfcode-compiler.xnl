import {
  runWithRuntime,
  type AuthoringRuntime,
  type Logger,
} from "halfcode-compiler-authoring-runtime"

export interface MockEffectCall {
  effectFqn: string
  input: unknown
}

export interface MockLogEntry {
  level: "info" | "warn" | "error"
  message: string
  fields?: Readonly<Record<string, unknown>>
}

export interface MockRuntime extends AuthoringRuntime {
  readonly mock: {
    readonly effectCalls: MockEffectCall[]
    readonly logs: MockLogEntry[]
  }
}

export interface MockRuntimeOptions {
  context?: Readonly<Record<string, unknown>>
  handlers?: Readonly<Record<string, (input: unknown) => unknown | Promise<unknown>>>
}

export function createMockRuntime(options: MockRuntimeOptions = {}): MockRuntime {
  const effectCalls: MockEffectCall[] = []
  const logs: MockLogEntry[] = []
  const logger: Logger = {
    info(message, fields) { logs.push({ level: "info", message, fields }) },
    warn(message, fields) { logs.push({ level: "warn", message, fields }) },
    error(message, fields) { logs.push({ level: "error", message, fields }) },
  }
  return {
    context: options.context ?? {},
    effects: {
      logger,
      async invoke<TResult>(effectFqn: string, input: unknown): Promise<TResult> {
        effectCalls.push({ effectFqn, input })
        const handler = options.handlers?.[effectFqn]
        if (!handler) throw new Error(`No mock effect handler registered for ${effectFqn}`)
        return await handler(input) as TResult
      },
    },
    mock: { effectCalls, logs },
  }
}

export function runWithMockRuntime<T>(runtime: MockRuntime, callback: () => T): T {
  return runWithRuntime(runtime, callback)
}

export const runtimeMockPackage = {
  role: "framework",
  area: "runtime-mock",
  owns: "inspectable target-neutral effect harness for deterministic authoring tests",
} as const
