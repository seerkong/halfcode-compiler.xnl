import { expect, test } from "bun:test"
import * as assembly from "halfcode-compiler.xnl/application-assembly"
import * as runtime from "halfcode-compiler.xnl/authoring-runtime"

test("distribution exposes native closure capture and pinned restoration", () => {
  expect(typeof assembly.captureCodeClosure).toBe("function")
  expect(typeof assembly.validateCodeClosure).toBe("function")
  expect(typeof assembly.CodeClosureError).toBe("function")
  expect(typeof assembly.CODE_CLOSURE_COMPILER_IDENTITY).toBe("string")
  expect(typeof runtime.restoreCodeClosure).toBe("function")
  expect(typeof runtime.bindCodeClosure).toBe("function")
})

test("public capture and restore execute frozen bytes with explicit runtime arguments", async () => {
  const files: Record<string, string> = {
    "/recipe/main.ts": "export const compose = (runtime, input, config) => runtime.format(input + config.suffix)",
  }
  const environment = { hostIdentity: "test-context-runtime/v1", ambient: {} }
  const artifact = await assembly.captureCodeClosure({ source: {
    stat: (path) => files[path] === undefined ? undefined : { kind: "file" },
    readDirectory: () => [],
    readBytes: (path) => files[path] === undefined ? undefined : new TextEncoder().encode(files[path]),
  } }, {
    binding: { packageName: "recipe", module: "./main.ts", exportName: "compose", moduleSpecifier: "recipe/main.ts" },
    sourceRoot: "/recipe", entryPath: "/recipe/main.ts", environment,
  })
  delete files["/recipe/main.ts"]
  assembly.validateCodeClosure(artifact, environment, artifact.digest)
  const compose = runtime.bindCodeClosure({ environment }, artifact, artifact.digest)
  expect(compose({ format: (text: string) => `[${text}]` }, "context", { suffix: "-fact" })).toBe("[context-fact]")
})
