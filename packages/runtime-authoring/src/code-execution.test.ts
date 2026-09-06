import { describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { createDirectoryResourcePackageReadPort, type ResourcePackageReadPort } from "halfcode-compiler-resource-core"
import { captureCodeClosure, validateCodeClosure, type CodeExecutionEnvironment, type FrozenCodeClosure } from "../../application-assembly/src/code-execution-closure"
import { bindCodeClosure, restoreCodeClosure } from "./code-execution"

const environment: CodeExecutionEnvironment = { hostIdentity: "bun-test-abi-v1", ambient: {} }
const binding = { packageName: "example", module: "./main.ts", exportName: "run", moduleSpecifier: "example/main.ts" }
const baseFiles = {
  "/source/main.ts": 'import { helper } from "./barrel"; import text from "./word.txt"; import data from "./data.json"; let calls = 0; export function run() { return `${helper()}:${text}:${data.n}:${++calls}` }',
  "/source/barrel.ts": 'export { helper } from "./helper.js"',
  "/source/helper.ts": 'export const helper = () => "V1"',
  "/source/word.txt": "frozen", "/source/data.json": '{"n":7}',
}
function memorySource(files: Record<string, string>): ResourcePackageReadPort {
  return { stat: (path) => files[path] === undefined ? undefined : { kind: "file" }, readDirectory: () => [], readBytes: (path) => files[path] === undefined ? undefined : new TextEncoder().encode(files[path]) }
}
async function capture(files = baseFiles, extra = {}) {
  return captureCodeClosure({ source: memorySource(files) }, { binding, sourceRoot: "/source", entryPath: "/source/main.ts", environment, assets: { "word.txt": "text", "data.json": "json" }, ...extra })
}
const clone = (value: FrozenCodeClosure): any => JSON.parse(JSON.stringify(value))
const canonical = (value: any): string => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value)

describe("native CodeBinding execution closure", () => {
  test("freezes recursive reexports and assets, independently isolates V1/V2 and instances", async () => {
    const files = { ...baseFiles }
    const v1 = await capture(files)
    files["/source/helper.ts"] = 'export const helper = () => "V2"'
    files["/source/word.txt"] = "new"
    const v2 = await capture(files)
    for (const key of Object.keys(files)) delete files[key as keyof typeof files]
    const oldRun = bindCodeClosure({ environment }, v1, v1.digest)
    const newRun = bindCodeClosure({ environment }, v2, v2.digest)
    expect(oldRun()).toBe("V1:frozen:7:1")
    expect(newRun()).toBe("V2:new:7:1")
    expect(oldRun()).toBe("V1:frozen:7:2")
    expect(bindCodeClosure({ environment }, v1, v1.digest)()).toBe("V1:frozen:7:1")
    expect(v1.digest).not.toBe(v2.digest)
    expect(Object.isFrozen(v1.modules)).toBe(true)
  })

  test("restores in an independent Bun process with only artifact after physical live deletion", async () => {
    const dir = await mkdtemp(join(tmpdir(), "halfcode-closure-"))
    try {
      const live = join(dir, "live")
      await mkdir(live)
      for (const [path, content] of Object.entries(baseFiles)) await writeFile(join(live, path.slice("/source/".length)), content)
      const artifact = await captureCodeClosure({ source: await createDirectoryResourcePackageReadPort(live) }, { binding, sourceRoot: "/", entryPath: "/main.ts", environment, assets: { "word.txt": "text", "data.json": "json" } })
      const artifactPath = join(dir, "closure.json")
      await writeFile(artifactPath, JSON.stringify(artifact))
      await rm(live, { recursive: true })
      const entry = new URL("./code-execution.ts", import.meta.url).pathname
      const child = Bun.spawn([process.execPath, "--eval", `import { bindCodeClosure } from ${JSON.stringify(entry)}; const closure = await Bun.file(process.argv[1]).json(); console.log(bindCodeClosure({ environment: ${JSON.stringify(environment)} }, closure, process.argv[2])());`, artifactPath, artifact.digest], { cwd: dir, stdout: "pipe", stderr: "pipe" })
      const output = await new Response(child.stdout).text()
      const errors = await new Response(child.stderr).text()
      expect(await child.exited, errors).toBe(0)
      expect(output.trim()).toBe("V1:frozen:7:1")
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  test("rejects artifact corruption, absent trusted pin and host/compiler/ambient mismatches before effects", async () => {
    const artifact = await capture()
    for (const mutate of [
      (a: any) => a.modules[0].source += "\nthrow Error('effect')",
      (a: any) => a.modules[0].code += "\nthrow Error('effect')",
      (a: any) => a.assets[0].content += "tampered",
      (a: any) => a.modules.find((m: any) => m.dependencies.length).dependencies[0].target = "missing.ts",
      (a: any) => a.entryPath = "missing.ts",
      (a: any) => a.binding.exportName = "wrong",
      (a: any) => a.compilerIdentity = "typescript@unknown",
      (a: any) => a.digest = "0".repeat(64),
    ]) {
      const broken = clone(artifact); mutate(broken)
      expect(() => restoreCodeClosure({ environment }, broken, artifact.digest)).toThrow()
    }
    expect(() => validateCodeClosure(artifact, { ...environment, hostIdentity: "other" }, artifact.digest)).toThrow("environment")
    expect(() => validateCodeClosure(artifact, environment, undefined as any)).toThrow("digest")
    expect(() => validateCodeClosure(artifact, environment, "0".repeat(64))).toThrow("digest")
    const replacement = await capture({ ...baseFiles, "/source/helper.ts": 'export const helper = () => "attacker"' })
    // A fully self-consistent replacement still fails against the owner's admission pin.
    expect(() => bindCodeClosure({ environment }, replacement, artifact.digest)).toThrow("digest")
    const rehashed = clone(artifact)
    rehashed.binding.exportName = "wrong"
    const { digest: _old, ...payload } = rehashed
    rehashed.digest = createHash("sha256").update(canonical(payload)).digest("hex")
    expect(() => bindCodeClosure({ environment }, rehashed, artifact.digest)).toThrow("digest")
  })

  test.each([
    ['export const run = () => import("./helper")', "dynamic"],
    ['export const run = () => require("./helper")', "require"],
    ['const load = require; export const run = () => load("./helper")', "require"],
    ['await Promise.resolve(); export const run = () => 1', "top-level"],
    ['export const run = () => import.meta.url', "import.meta"],
    ['import x from "unknown"; export const run = () => x', "ambient"],
    ['import x from "../outside"; export const run = () => x', "outside"],
    ['import x from "./word.txt"; export const run = () => x', "asset"],
  ])("rejects unsupported dependency syntax: %s", async (source, message) => {
    await expect(capture({ ...baseFiles, "/source/main.ts": source }, { assets: {} })).rejects.toThrow(message)
  })

  test("allows declared ambient modules only when the pinned environment matches", async () => {
    const env = { hostIdentity: "bun-test-abi-v1", ambient: { "test:abi": "v1" } }
    const artifact = await capture({ ...baseFiles, "/source/main.ts": 'import { get } from "test:abi"; export const run = () => get()' }, { environment: env })
    expect(bindCodeClosure({ environment: env, ambientModules: { "test:abi": { get: () => 42 } } }, artifact, artifact.digest)()).toBe(42)
    expect(() => bindCodeClosure({ environment: { ...env, ambient: { "test:abi": "v2" } }, ambientModules: {} }, artifact, artifact.digest)).toThrow("environment")
    expect(() => bindCodeClosure({ environment: env }, artifact, artifact.digest)).toThrow("ambient")
  })

  test("checks entry binding consistency and rejects symlinks without reading bytes", async () => {
    await expect(capture(baseFiles, { entryPath: "/source/helper.ts" })).rejects.toThrow("binding")
    let reads = 0
    await expect(captureCodeClosure({ source: { stat: () => ({ kind: "symlink" }), readBytes: () => { reads++; return undefined }, readDirectory: () => [] } }, { binding, sourceRoot: "/source", entryPath: "/source/main.ts", environment })).rejects.toThrow("symlink")
    expect(reads).toBe(0)
  })

  test("resolves extensionless bindings and excludes explicit type-only dependencies", async () => {
    const artifact = await capture({ ...baseFiles, "/source/main.ts": 'import type { A } from "./absent.d.ts"; import { type B } from "types-only"; export type { C } from "./also-absent"; export { type D } from "@types/absent"; export const run = () => 9' }, { binding: { ...binding, module: "./main", moduleSpecifier: "example/main" } })
    expect(bindCodeClosure({ environment }, artifact, artifact.digest)()).toBe(9)
    expect(artifact.modules[0]!.dependencies).toEqual([])
  })

  test("rejects getters, toJSON, exotic objects and cycles without invoking them", async () => {
    const artifact = await capture()
    let effects = 0
    const accessor = clone(artifact)
    Object.defineProperty(accessor.modules[0], "source", { enumerable: true, get() { effects++; return "effect" } })
    const serializable = clone(artifact)
    serializable.toJSON = () => { effects++; return artifact }
    const cyclic = clone(artifact)
    cyclic.self = cyclic
    for (const invalid of [accessor, serializable, cyclic, new Date()]) {
      expect(() => validateCodeClosure(invalid as any, environment, artifact.digest)).toThrow("closure-data")
      expect(() => restoreCodeClosure({ environment }, invalid as any, artifact.digest)).toThrow("closure-data")
    }
    expect(effects).toBe(0)
  })

  test("completes validation and ambient presence checks before module side effects", async () => {
    const env = { hostIdentity: environment.hostIdentity, ambient: { "test:effects": "v1" } }
    const artifact = await capture({ ...baseFiles, "/source/main.ts": 'import { hit } from "test:effects"; hit(); export const run = () => 1' }, { environment: env })
    let effects = 0
    const runtime = { environment: env, ambientModules: { "test:effects": { hit: () => effects++ } } }
    expect(() => bindCodeClosure(runtime, artifact, "0".repeat(64))).toThrow("digest")
    expect(() => bindCodeClosure({ ...runtime, environment }, artifact, artifact.digest)).toThrow("environment")
    expect(() => bindCodeClosure({ environment: env }, artifact, artifact.digest)).toThrow("ambient")
    expect(effects).toBe(0)
    expect(bindCodeClosure(runtime, artifact, artifact.digest)()).toBe(1)
    expect(effects).toBe(1)
  })

  test("handles static cycles and a default entry export without live imports", async () => {
    const artifact = await capture({
      ...baseFiles,
      "/source/main.ts": 'import { helper } from "./helper"; export const label = "cycle"; export default () => helper()',
      "/source/helper.ts": 'import { label } from "./main"; export const helper = () => label',
    }, { binding: { ...binding, exportName: "default" } })
    expect(bindCodeClosure({ environment }, artifact, artifact.digest)()).toBe("cycle")
  })

  test("records stable per-file source, emitted-code and asset digests", async () => {
    const artifact = await capture()
    const sha256 = (value: string) => createHash("sha256").update(value).digest("hex")
    for (const module of artifact.modules) {
      expect(module.sourceDigest).toBe(sha256(module.source))
      expect(module.codeDigest).toBe(sha256(module.code))
    }
    for (const asset of artifact.assets) expect(asset.contentDigest).toBe(sha256(asset.content))
    expect((await capture()).digest).toBe(artifact.digest)
    for (const mutate of [
      (a: any) => a.modules[0].sourceDigest = "0".repeat(64),
      (a: any) => a.modules[0].codeDigest = "0".repeat(64),
      (a: any) => a.assets[0].contentDigest = "0".repeat(64),
    ]) {
      const broken = clone(artifact)
      mutate(broken)
      const { digest: _old, ...payload } = broken
      broken.digest = sha256(canonical(payload))
      expect(() => validateCodeClosure(broken, environment, broken.digest)).toThrow("file-digest-mismatch")
    }
  })

  test("preserves leading UTF-8 BOM bytes in frozen source and text assets", async () => {
    const files = {
      ...baseFiles,
      "/source/main.ts": '\uFEFFimport text from "./word.txt"; export const run = () => text',
      "/source/word.txt": "\uFEFFfrozen",
    }
    const artifact = await capture(files)
    const module = artifact.modules.find((item) => item.path === "main.ts")!
    const asset = artifact.assets.find((item) => item.path === "word.txt")!
    expect(module.source).toBe(files["/source/main.ts"])
    expect(module.sourceDigest).toBe(createHash("sha256").update(new TextEncoder().encode(files["/source/main.ts"])).digest("hex"))
    expect(asset.contentDigest).toBe(createHash("sha256").update(new TextEncoder().encode(files["/source/word.txt"])).digest("hex"))
    expect(bindCodeClosure({ environment }, artifact, artifact.digest)()).toBe(files["/source/word.txt"])
  })

  test.each(["mts", "mjs", "cts", "cjs", "ts", "js"])("executes frozen .%s modules and reexports", async (extension) => {
    const artifact = await captureCodeClosure({ source: memorySource({
      [`/source/main.${extension}`]: `export { run } from "./helper.${extension}"`,
      [`/source/helper.${extension}`]: 'export const run = () => "closed"',
    }) }, {
      binding: { ...binding, module: `./main.${extension}`, moduleSpecifier: `example/main.${extension}` },
      sourceRoot: "/source", entryPath: `/source/main.${extension}`, environment,
    })
    expect(bindCodeClosure({ environment }, artifact, artifact.digest)()).toBe("closed")
  })
})
