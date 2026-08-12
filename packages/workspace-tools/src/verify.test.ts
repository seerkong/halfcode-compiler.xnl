import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { verifyWorkspace } from "./verify"

describe("workspace governance", () => {
  test("verifies the real workspace from package metadata and generated facts", async () => {
    const rootDir = join(import.meta.dir, "../../..")
    const report = await verifyWorkspace({ rootDir })
    expect(report.packages.map((item) => item.name)).toContain("demo-resource-workflow-shared-authoring")
    expect(report.packages.every((item) => item.packageKind === "framework" || item.applicationRole !== undefined)).toBe(true)
  })

  test("rejects a contracts package that depends on authoring", async () => {
    const rootDir = await workspaceFixture()
    await packageFixture(rootDir, "apps/DemoAuthoring", {
      name: "demo-authoring",
      packageKind: "application",
      applicationFamily: "demo",
      applicationScope: "domain",
      applicationRole: "authoring",
    })
    await packageFixture(rootDir, "apps/DemoContracts", {
      name: "demo-contracts",
      packageKind: "application",
      applicationFamily: "demo",
      applicationScope: "domain",
      applicationRole: "contracts",
      dependencies: { "demo-authoring": "workspace:*" },
    })

    await expect(verifyWorkspace({ rootDir, checkGenerated: false, checkLegacyTerms: false }))
      .rejects.toThrow("contracts package demo-contracts must not depend on authoring package demo-authoring")
  })

  test("requires capability export allowlists to match contract facts", async () => {
    const rootDir = await workspaceFixture()
    await packageFixture(rootDir, "apps/DemoContracts", {
      name: "demo-contracts",
      packageKind: "application",
      applicationFamily: "demo",
      applicationScope: "domain",
      applicationRole: "contracts",
      exports: { ".": "./src/index.ts", "./Function/Prepare": "./src/Function/Prepare/index.ts" },
      capabilitySubpathExports: [],
    })
    const factDir = join(rootDir, "apps/DemoContracts/src/Function/Prepare")
    await mkdir(factDir, { recursive: true })
    await writeFile(join(factDir, "contract.json"), "{}\n")

    await expect(verifyWorkspace({ rootDir, checkGenerated: false, checkLegacyTerms: false }))
      .rejects.toThrow("capabilitySubpathExports mismatch")
  })
})

async function workspaceFixture(): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), "workspace-governance-"))
  await mkdir(join(rootDir, "apps"), { recursive: true })
  await mkdir(join(rootDir, "packages"), { recursive: true })
  await writeFile(join(rootDir, "package.json"), JSON.stringify({
    name: "fixture",
    private: true,
    workspaces: ["packages/*", "apps/*"],
  }))
  return rootDir
}

async function packageFixture(rootDir: string, path: string, manifest: Record<string, unknown>) {
  const packageRoot = join(rootDir, path)
  await mkdir(join(packageRoot, "src"), { recursive: true })
  await writeFile(join(packageRoot, "package.json"), `${JSON.stringify({
    version: "0.0.0",
    type: "module",
    private: true,
    exports: { ".": "./src/index.ts" },
    ...manifest,
  }, null, 2)}\n`)
  await writeFile(join(packageRoot, "src/index.ts"), "export {}\n")
}
