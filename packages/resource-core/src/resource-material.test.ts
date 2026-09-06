import { describe, expect, test } from "bun:test"
import { cp, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  ResourceMaterialError,
  loadResourceTree,
  readResourceMaterial,
  sha256Digest,
  validateResourceTree,
  type AuthoredResourceTree,
} from "./index"

const fixtureRoot = join(import.meta.dir, "../tests/fixtures/XnlResourceWorkflow")
const procedureId = "demo.resource_workflow.procedure.prepare"

describe("directory resource materials", () => {
  test("reads one explicit material through an authentic directory resource boundary", async () => {
    const tree = await loadResourceTree({ rootDir: fixtureRoot })
    const material = await readResourceMaterial({
      tree,
      rootDir: fixtureRoot,
      resourceId: procedureId,
      uri: "vfs://./Notes.txt",
    })
    const expected = await readFile(join(fixtureRoot, "Procedures/Prepare/Notes.txt"))

    expect(material).toMatchObject({
      resourceId: procedureId,
      uri: "vfs://./Notes.txt",
      sourceUri: "vfs://@/Procedures/Prepare/Notes.txt",
      digest: sha256Digest(expected),
      contribution: {
        key: "material:vfs://./Notes.txt",
        digest: sha256Digest(expected),
        sourceUri: "vfs://@/Procedures/Prepare/Notes.txt",
      },
    })
    expect(material.bytes()).toEqual(new Uint8Array(expected))
    const first = material.bytes()
    first[0] = 0
    expect(material.bytes()).toEqual(new Uint8Array(expected))
    expect(Object.isFrozen(material)).toBe(true)
    expect(Object.isFrozen(material.contribution)).toBe(true)
  })

  test.each([
    ["non-directory resource", "demo.resource_workflow.note.root", "vfs://./RootNote.xnl", "RESOURCE_MATERIAL_RESOURCE_INVALID"],
    ["parent escape", procedureId, "vfs://./../manifest.xnl", "RESOURCE_MATERIAL_URI_INVALID"],
    ["encoded separator", procedureId, "vfs://./bundle%2fentry.js", "RESOURCE_MATERIAL_URI_INVALID"],
    ["absolute VFS root", procedureId, "vfs://@/manifest.xnl", "RESOURCE_MATERIAL_URI_INVALID"],
    ["missing file", procedureId, "vfs://./Missing.txt", "RESOURCE_MATERIAL_MISSING"],
  ])("rejects %s", async (_label, resourceId, uri, code) => {
    const tree = await loadResourceTree({ rootDir: fixtureRoot })
    await expect(readResourceMaterial({ tree, rootDir: fixtureRoot, resourceId, uri }))
      .rejects.toMatchObject({ diagnostics: [expect.objectContaining({ code })] })
  })

  test("rejects forged trees and material symlinks without leaking machine paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "halfcode-resource-material-"))
    await cp(fixtureRoot, root, { recursive: true })
    const tree = await loadResourceTree({ rootDir: root })
    const forged = { ...tree } as AuthoredResourceTree
    await expect(readResourceMaterial({ tree: forged, rootDir: root, resourceId: procedureId, uri: "vfs://./Notes.txt" }))
      .rejects.toBeInstanceOf(ResourceMaterialError)

    await symlink(join(root, "manifest.xnl"), join(root, "Procedures/Prepare/Linked.txt"))
    try {
      await readResourceMaterial({ tree, rootDir: root, resourceId: procedureId, uri: "vfs://./Linked.txt" })
      throw new Error("expected material symlink rejection")
    } catch (error) {
      expect(error).toBeInstanceOf(ResourceMaterialError)
      expect((error as ResourceMaterialError).diagnostics).toContainEqual(expect.objectContaining({ code: "RESOURCE_MATERIAL_SYMLINK_UNSUPPORTED" }))
      expect(JSON.stringify(error)).not.toContain(root)
    }
  })

  test("rejects the removed code-package source shape instead of mapping it to directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "halfcode-legacy-code-package-"))
    await cp(fixtureRoot, root, { recursive: true })
    const manifestPath = join(root, "manifest.xnl")
    const manifest = await readFile(manifestPath, "utf8")
    await writeFile(manifestPath, manifest.replace(
      '<Catalog #root_procedures { kind = "Procedure" shape = "directory"',
      '<Catalog #root_procedures { kind = "Procedure" shape = "code-package"',
    ))
    expect(await validateResourceTree({ rootDir: root })).toContainEqual(expect.objectContaining({ code: "RESOURCE_CATALOG_INVALID" }))
  })
})
