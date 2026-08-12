import { describe, expect, test } from "bun:test"
import { currentRuntime, invokeEffect, logger } from "halfcode-compiler-authoring-runtime"
import { createMockRuntime, runWithMockRuntime } from "./index"

describe("runtime mock harness", () => {
  test("records effects and logs and restores the async runtime scope", async () => {
    const runtime = createMockRuntime({
      context: { requestId: "DemoRequest" },
      handlers: {
        "Demo.ResourceWorkflow.Effect.ResolveLabel": (input) => ({ input, label: "Ready" }),
      },
    })

    const result = await runWithMockRuntime(runtime, async () => {
      logger.info("resolving", { fqn: "Demo.ResourceWorkflow.Effect.ResolveLabel" })
      expect(currentRuntime().context.requestId).toBe("DemoRequest")
      return invokeEffect<{ label: string }>("Demo.ResourceWorkflow.Effect.ResolveLabel", { id: "One" })
    })

    expect(result.label).toBe("Ready")
    expect(runtime.mock.effectCalls).toEqual([{
      effectFqn: "Demo.ResourceWorkflow.Effect.ResolveLabel",
      input: { id: "One" },
    }])
    expect(runtime.mock.logs[0]?.message).toBe("resolving")
    expect(() => currentRuntime()).toThrow("No authoring runtime is active")
  })
})
