import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, posix } from "node:path"
import {
  applyResourceMappingPlan,
  parseResourceMappings,
  planResourceMappings,
  ResourceMappingPathError,
  safePathLexicalIssue,
} from "./index"

describe("resource-mapping", () => {
  test("plans the staged product resource-mappings.xnl against XNL module roots", async () => {
    const domainRoot = join(import.meta.dir, "../../../apps/demo-resource-workflow-authoring/resources-xnl")
    const sharedRoot = join(import.meta.dir, "../../../apps/demo-resource-workflow-shared-authoring/resources-xnl")
    const mappingPath = join(domainRoot, "SkillCapsules/Main/resource-mappings.xnl")
    const mappings = parseResourceMappings(await readFile(mappingPath, "utf8"), mappingPath)

    expect(mappings.referenceTargets.get("Function")).toBe("references/Functions/")
    expect(mappings.callableArtifactsTarget).toBe("functions/")
    const plan = await planResourceMappings(mappings, {
      moduleRoots: { DomainAuthoring: domainRoot, SharedAuthoring: sharedRoot },
    })
    expect(plan.entries.map((item) => item.targetRelativePath)).toEqual([
      "references/Protocol/workflow-protocol.md",
      "references/Shared/SharedNotes.md",
    ])
  })

  test("plans and applies CopyDirectory and CopyFile from named module roots", async () => {
    const root = await mkdtemp(join(tmpdir(), "resource-mapping-"))
    const shared = join(root, "Shared")
    const domain = join(root, "Domain")
    const output = join(root, "Output")
    await mkdir(join(shared, "Guides"), { recursive: true })
    await mkdir(join(domain, "Protocol"), { recursive: true })
    await writeFile(join(shared, "Guides", "Shared.md"), "shared\n")
    await writeFile(join(domain, "Protocol", "Runtime.md"), "runtime\n")
    const mappings = parseResourceMappings(`<ResourceMappings #demo.mappings (
      <ReferenceTargets [ <ReferenceTarget #function { kind = "Function" target = "references/Functions/" }> ]>
      <CallableArtifacts { target = "functions/" }>
      <SourceRoots [
        <SourceRoot #Shared { sourceRoot = "vfs://module/Shared/" } [ <CopyFile { from = "Guides/Shared.md" to = "references/Shared/Shared.md" }> ]>
        <SourceRoot #Domain { sourceRoot = "vfs://module/Domain/" } [ <CopyDirectory { from = "Protocol" to = "references/Protocol" }> ]>
      ]>
    )>`)

    const plan = await planResourceMappings(mappings, { moduleRoots: { Shared: shared, Domain: domain } })
    expect(plan.entries.map((item) => item.targetRelativePath)).toEqual([
      "references/Protocol/Runtime.md",
      "references/Shared/Shared.md",
    ])
    await applyResourceMappingPlan(plan, output)
    expect(await readFile(join(output, "references/Shared/Shared.md"), "utf8")).toBe("shared\n")
  })

  test("rejects overlapping roots and generated target collisions during preflight", async () => {
    const root = await mkdtemp(join(tmpdir(), "resource-mapping-collision-"))
    await mkdir(join(root, "Guides"), { recursive: true })
    await writeFile(join(root, "Guides", "Function.md"), "collision\n")
    const mappings = parseResourceMappings(`<ResourceMappings #demo.collision (
      <SourceRoots [ <SourceRoot #One { sourceRoot = "vfs://module/Domain/" } [ <CopyDirectory { from = "Guides" to = "references/Functions" }> ]> ]>
    )>`)

    await expect(planResourceMappings(mappings, {
      moduleRoots: { Domain: root },
      reservedTargetPaths: ["references/Functions/Function.md"],
    })).rejects.toThrow("conflicts with generated target")
  })

  test("preserves raw authoring target and owner in typed path diagnostics before normalization", () => {
    for (const fixture of [
      {
        owner: "generated-reference:Function",
        rawTarget: "references/./Functions/",
        source: `<ResourceMappings #demo.generated (
          <ReferenceTargets [ <ReferenceTarget { kind = "Function" target = "references/./Functions/" }> ]>
        )>`,
      },
      {
        owner: "mapping:Shared:CopyFile",
        rawTarget: "references//Shared.md",
        source: `<ResourceMappings #demo.mapping (
          <SourceRoots [ <SourceRoot #Shared { sourceRoot = "vfs://module/Shared/" } [
            <CopyFile { from = "Guides/Shared.md" to = "references//Shared.md" }>
          ]> ]>
        )>`,
      },
    ]) {
      let captured: unknown
      try {
        parseResourceMappings(fixture.source, "fixture://raw-target.xnl")
      } catch (error) {
        captured = error
      }
      expect(captured).toBeInstanceOf(ResourceMappingPathError)
      expect(captured).toMatchObject({
        code: "RESOURCE_MAPPING_PATH_INVALID",
        attribute: "to",
        owner: fixture.owner,
        rawPath: fixture.rawTarget,
      })
    }
  })

  test("revalidates bypassed raw operations before source resolution", async () => {
    const parsed = parseResourceMappings(`<ResourceMappings #demo.bypass (
      <SourceRoots [ <SourceRoot #Domain { sourceRoot = "vfs://module/Domain/" } [
        <CopyFile { from = "Guides/Shared.md" to = "references/Shared.md" }>
      ]> ]>
    )>`)
    const bypassed = {
      ...parsed,
      sources: parsed.sources.map((source) => ({
        ...source,
        operations: source.operations.map((operation) => ({ ...operation, to: "unsafe/./target" })),
      })),
    }

    await expect(planResourceMappings(bypassed, {
      moduleRoots: { Domain: "/definitely/not/a/live/module/root" },
    })).rejects.toMatchObject({
      code: "RESOURCE_MAPPING_PATH_INVALID",
      owner: "mapping:Domain:CopyFile",
      rawPath: "unsafe/./target",
    })
  })

  test("preflights every invalid apply target before copying any entry", async () => {
    const root = await mkdtemp(join(tmpdir(), "resource-mapping-apply-preflight-"))
    const output = join(root, "Output")
    const firstSource = join(root, "first.md")
    const secondSource = join(root, "second.md")
    await writeFile(firstSource, "first\n")
    await writeFile(secondSource, "second\n")
    await mkdir(output, { recursive: true })
    await writeFile(join(output, "keep.txt"), "previous\n")

    await expect(applyResourceMappingPlan({ entries: [
      { sourcePath: firstSource, targetRelativePath: "new/first.md", mappingId: "One" },
      { sourcePath: secondSource, targetRelativePath: "unsafe//second.md", mappingId: "Two" },
    ] }, output)).rejects.toMatchObject({
      code: "RESOURCE_MAPPING_PATH_INVALID",
      owner: "mapping:Two:planned-copy",
      rawPath: "unsafe//second.md",
    })
    expect(await readFile(join(output, "keep.txt"), "utf8")).toBe("previous\n")
    await expect(readFile(join(output, "new/first.md"), "utf8")).rejects.toThrow()
  })

  test("accepted Unicode paths retain exact UTF-16 identity across posix.join", () => {
    for (const accepted of [
      "参考/资料/共享.md",
      "emoji/😀/artifact.md",
      "supplementary/𐐷/record.md",
      "mixed/中文-😀-𐐷.md",
    ]) {
      expect(safePathLexicalIssue(accepted, "relative-path")).toBeUndefined()
      const joined = posix.join("capsule", accepted)
      expect(joined).toBe(`capsule/${accepted}`)
      expect(joined.slice("capsule/".length)).toBe(accepted)
    }
  })
})
