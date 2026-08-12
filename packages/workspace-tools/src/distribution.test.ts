import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

const workspaceRoot = join(import.meta.dir, "../../..")

describe("halfcode-compiler.xnl distribution contract", () => {
  test("declares the single public package and explicit entry points", async () => {
    const manifest = JSON.parse(await readFile(join(workspaceRoot, "packages/distribution/package.json"), "utf8")) as {
      name?: string
      private?: boolean
      exports?: Record<string, unknown>
    }

    expect(manifest.name).toBe("halfcode-compiler.xnl")
    expect(manifest.private).toBe(false)
    expect(Object.keys(manifest.exports ?? {})).toEqual([
      ".",
      "./application-assembly",
      "./skill-capsule",
      "./contract-schema",
      "./authoring-runtime",
      "./resource-core",
      "./resource-mapping",
      "./resource-projection",
      "./kind-definition",
      "./testing",
    ])
  })

  test("generates callable bundles against the public runtime subpath", async () => {
    const compilerSource = await readFile(join(workspaceRoot, "packages/compiler-skill/src/index.ts"), "utf8")

    expect(compilerSource).toContain('import { runWithRuntime } from "halfcode-compiler.xnl/authoring-runtime"')
    expect(compilerSource).not.toContain('import { runWithRuntime } from "halfcode-compiler-authoring-runtime"')
  })

  test("keeps object operation bindings behind the compiler capsule", async () => {
    const rootSource = await readFile(join(workspaceRoot, "packages/distribution/src/index.ts"), "utf8")
    const assemblySource = await readFile(join(workspaceRoot, "packages/distribution/src/application-assembly.ts"), "utf8")
    const assemblyImplementation = await readFile(join(workspaceRoot, "packages/application-assembly/src/index.ts"), "utf8")
    const compilerSource = await readFile(join(workspaceRoot, "packages/compiler-skill/src/index.ts"), "utf8")

    expect(rootSource).not.toContain('export * from "halfcode-compiler-application-assembly"')
    expect(assemblySource).not.toContain("resolveInternalObjectOperationBinding")
    expect(assemblySource).not.toContain("resolveObjectOperationCompilation")
    expect(assemblySource).not.toContain("InternalObjectOperationBinding")
    expect(assemblySource).not.toContain("ObjectOperationBinding")
    expect(assemblySource).not.toContain("BusinessMutationResource")
    expect(assemblyImplementation).not.toContain("businessActions: readonly")
    expect(assemblyImplementation).not.toContain("businessMutations: readonly")
    expect(compilerSource).toContain('from "halfcode-compiler-application-assembly/compiler-internal"')
    expect(compilerSource).not.toContain('resource.kind === "BusinessAction"')
    expect(compilerSource).not.toContain('BusinessAction: "references/BusinessActions/"')
  })

  test("derives bundled system Skill identity from the generated plan", async () => {
    const bundledSystemSkills = await import("../../distribution/src/bundled-system-skills")

    expect(Object.keys(bundledSystemSkills)).toEqual([
      "loadHalfcodeResourceDslSystemSkillPlan",
    ])
  })
})
