import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  loadResourceTree,
  loadResourceTreeFromReadPort,
  validateResourceTree,
  validateResourceTreeFromReadPort,
  type AuthoredResourceTree,
  type ResourcePackageDirectoryEntry,
  type ResourcePackageEntry,
  type ResourcePackageReadPort,
} from "./index"

const fixtureRoot = path.join(import.meta.dir, "../tests/fixtures/XnlResourceWorkflow")

function comparableTree(tree: AuthoredResourceTree) {
  return {
    manifest: tree.manifest,
    byKind: [...tree.registry.byKind.entries()],
    kindDefinitions: [...tree.registry.kindDefinitions.entries()],
    diagnostics: tree.diagnostics,
    contentIdentities: [...tree.contentIdentities.entries()],
  }
}

class MemoryResourcePackageReadPort implements ResourcePackageReadPort {
  readonly #entries: ReadonlyMap<string, ResourcePackageEntry>
  readonly #directories: ReadonlyMap<string, readonly ResourcePackageDirectoryEntry[]>
  readonly #files: ReadonlyMap<string, Uint8Array>

  constructor(input: {
    entries: ReadonlyMap<string, ResourcePackageEntry>
    directories: ReadonlyMap<string, readonly ResourcePackageDirectoryEntry[]>
    files: ReadonlyMap<string, Uint8Array>
  }) {
    this.#entries = input.entries
    this.#directories = input.directories
    this.#files = input.files
  }

  stat(sourcePath: string): ResourcePackageEntry | undefined {
    return this.#entries.get(sourcePath)
  }

  readDirectory(sourcePath: string): readonly ResourcePackageDirectoryEntry[] | undefined {
    return this.#directories.get(sourcePath)
  }

  readBytes(sourcePath: string): Uint8Array | undefined {
    const bytes = this.#files.get(sourcePath)
    return bytes ? bytes.slice() : undefined
  }
}

async function memoryPortFromDirectory(
  sourceRoot: string,
  providerRoot: string,
): Promise<MemoryResourcePackageReadPort> {
  const entries = new Map<string, ResourcePackageEntry>()
  const directories = new Map<string, readonly ResourcePackageDirectoryEntry[]>()
  const files = new Map<string, Uint8Array>()

  const visit = async (physicalDirectory: string, sourceDirectory: string): Promise<void> => {
    entries.set(sourceDirectory, { kind: "directory" })
    const children = await readdir(physicalDirectory, { withFileTypes: true })
    const projected: ResourcePackageDirectoryEntry[] = []
    for (const child of children) {
      const childSourcePath = `${sourceDirectory}/${child.name}`.replace(/\/{2,}/g, "/")
      if (child.isDirectory()) {
        projected.push({ name: child.name, kind: "directory" })
        await visit(path.join(physicalDirectory, child.name), childSourcePath)
      } else if (child.isFile()) {
        projected.push({ name: child.name, kind: "file" })
        entries.set(childSourcePath, { kind: "file" })
        files.set(childSourcePath, await readFile(path.join(physicalDirectory, child.name)))
      }
    }
    directories.set(sourceDirectory, projected.reverse())
  }

  await visit(sourceRoot, providerRoot)
  return new MemoryResourcePackageReadPort({ entries, directories, files })
}

describe("ResourcePackage read port", () => {
  test("matches the physical directory loader without exposing provider coordinates", async () => {
    const directoryTree = await loadResourceTree({ rootDir: fixtureRoot })
    const firstPort = await memoryPortFromDirectory(fixtureRoot, "/provider-a/packages/app")
    const secondPort = await memoryPortFromDirectory(fixtureRoot, "/another/provider/root")

    const first = await loadResourceTreeFromReadPort({
      port: firstPort,
      rootPath: "/provider-a/packages/app",
    })
    const second = await loadResourceTreeFromReadPort({
      port: secondPort,
      rootPath: "/another/provider/root",
    })

    expect(comparableTree(first)).toEqual(comparableTree(directoryTree))
    expect(comparableTree(second)).toEqual(comparableTree(directoryTree))
    expect(comparableTree(first)).toEqual(comparableTree(second))
    expect(JSON.stringify(first)).not.toContain("provider-a")
    expect(JSON.stringify(second)).not.toContain("another/provider")
    expect(first.registry.byKind.get("Note")?.map((record) => record.logicalPath)).toEqual([
      "Modules/Core/Notes/CoreNote.xnl",
      "Notes/MinimalNote.xnl",
      "Notes/RootNote.xnl",
    ])
  })

  test.each([
    ["UnsafeManifest.xnl", "RESOURCE_REF_CONTAINMENT"],
    ["DuplicateManifest.xnl", "RESOURCE_IDENTITY_DUPLICATE"],
    ["BrokenManifest.xnl", "RESOURCE_XNL_SYNTAX"],
    ["UnknownKindManifest.xnl", "KIND_DEFINITION_MISSING"],
  ])("matches directory diagnostics for %s", async (manifestPath, expectedCode) => {
    const port = await memoryPortFromDirectory(fixtureRoot, "/virtual/package")
    const directoryDiagnostics = await validateResourceTree({ rootDir: fixtureRoot, manifestPath })
    const portDiagnostics = await validateResourceTreeFromReadPort({
      port,
      rootPath: "/virtual/package",
      manifestPath,
    })

    expect(portDiagnostics).toEqual(directoryDiagnostics)
    expect(portDiagnostics).toContainEqual(expect.objectContaining({ code: expectedCode }))
    expect(JSON.stringify(portDiagnostics)).not.toContain("virtual/package")
    expect(JSON.stringify(portDiagnostics)).not.toContain(fixtureRoot)
  })

  test("rejects non-canonical provider entries without throwing or leaking provider facts", async () => {
    const base = await memoryPortFromDirectory(fixtureRoot, "/virtual/package")
    const invalidPort: ResourcePackageReadPort = {
      stat: (sourcePath) => base.stat(sourcePath),
      readBytes: (sourcePath) => base.readBytes(sourcePath),
      readDirectory: (sourcePath) => sourcePath.endsWith("/KindDefinitions")
        ? [{ name: "../escape", kind: "directory" }]
        : base.readDirectory(sourcePath),
    }

    const diagnostics = await validateResourceTreeFromReadPort({
      port: invalidPort,
      rootPath: "/virtual/package",
    })

    expect(diagnostics).toContainEqual(expect.objectContaining({ code: "RESOURCE_SOURCE_ENTRY_INVALID" }))
    expect(JSON.stringify(diagnostics)).not.toContain("virtual/package")
    expect(JSON.stringify(diagnostics)).not.toContain("escape")
  })

  test("turns provider read failures into stable diagnostics", async () => {
    const base = await memoryPortFromDirectory(fixtureRoot, "/virtual/package")
    const failingPort: ResourcePackageReadPort = {
      stat: (sourcePath) => base.stat(sourcePath),
      readBytes: (sourcePath) => base.readBytes(sourcePath),
      readDirectory: () => { throw new Error("secret provider coordinate /private/source") },
    }

    const diagnostics = await validateResourceTreeFromReadPort({
      port: failingPort,
      rootPath: "/virtual/package",
    })

    expect(diagnostics).toContainEqual(expect.objectContaining({ code: "RESOURCE_CATALOG_ROOT_MISSING" }))
    expect(JSON.stringify(diagnostics)).not.toContain("secret provider")
    expect(JSON.stringify(diagnostics)).not.toContain("private/source")
  })

  test("imports KindDefinitions only from an independently authentic resource tree", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "halfcode-trusted-kinds-"))
    const importedRoot = await mkdtemp(path.join(tmpdir(), "halfcode-kind-import-"))
    try {
      await mkdir(path.join(importedRoot, "KindDefinitions/Note"), { recursive: true })
      await writeFile(path.join(importedRoot, "manifest.xnl"), [
        '<ResourcePackage #demo.kind_import envelopeVersion="halfcode.resource-envelope/v1" specVersion=1 (',
        '  <Catalogs [<Catalog #kinds { kind = "KindDefinition" shape = "directory" root = "vfs://./KindDefinitions/" entry = "manifest.xnl" }>]>',
        ')>', '',
      ].join("\n"))
      await writeFile(path.join(importedRoot, "KindDefinitions/Note/manifest.xnl"), await readFile(path.join(fixtureRoot, "KindDefinitions/Note/manifest.xnl")))
      await mkdir(path.join(target, "Notes"))
      await writeFile(path.join(target, "manifest.xnl"), [
        '<ResourcePackage #demo.imported_kinds envelopeVersion="halfcode.resource-envelope/v1" specVersion=1 (',
        '  <Catalogs [<Catalog #notes { kind = "Note" shape = "single-file" root = "vfs://./Notes/" }>]>',
        ')>', '',
      ].join("\n"))
      await writeFile(path.join(target, "Notes/Imported.xnl"), '<Note #demo.imported.note envelopeVersion="halfcode.resource-envelope/v1" specVersion=1>\n')
      const imported = await loadResourceTree({ rootDir: importedRoot })
      const tree = await loadResourceTreeFromReadPort({
        port: await memoryPortFromDirectory(target, "/provider/target"), rootPath: "/provider/target", kindDefinitionImports: [imported],
      })
      expect(tree.registry.byKind.get("Note")?.map(record => record.resourceId)).toEqual(["demo.imported.note"])
      expect(tree.registry.kindDefinitions.get("Note")?.documentUri).toBe("vfs://@/KindDefinitions/Note/manifest.xnl")
      expect(tree.kindDefinitionImports?.[0]?.treeDigest).toMatch(/^sha256:/)
      await mkdir(path.join(target, "KindDefinitions/Note"), { recursive: true })
      await writeFile(path.join(target, "KindDefinitions/Note/manifest.xnl"), await readFile(path.join(importedRoot, "KindDefinitions/Note/manifest.xnl")))
      await writeFile(path.join(target, "manifest.xnl"), [
        '<ResourcePackage #demo.imported_kinds envelopeVersion="halfcode.resource-envelope/v1" specVersion=1 (',
        '  <Catalogs [',
        '    <Catalog #kinds { kind = "KindDefinition" shape = "directory" root = "vfs://./KindDefinitions/" entry = "manifest.xnl" }>',
        '    <Catalog #notes { kind = "Note" shape = "single-file" root = "vfs://./Notes/" }>',
        '  ]>', ')>', '',
      ].join("\n"))
      expect(await validateResourceTreeFromReadPort({
        port: await memoryPortFromDirectory(target, "/provider/target"), rootPath: "/provider/target", kindDefinitionImports: [imported],
      })).not.toContainEqual(expect.objectContaining({ code: "KIND_DEFINITION_IMPORT_COLLISION" }))
      const localDefinition = await readFile(path.join(target, "KindDefinitions/Note/manifest.xnl"), "utf8")
      await writeFile(path.join(target, "KindDefinitions/Note/manifest.xnl"), localDefinition.replace("sha256:2222222222222222222222222222222222222222222222222222222222222222", "sha256:9999999999999999999999999999999999999999999999999999999999999999"))
      expect(await validateResourceTreeFromReadPort({
        port: await memoryPortFromDirectory(target, "/provider/target"), rootPath: "/provider/target", kindDefinitionImports: [imported],
      })).toContainEqual(expect.objectContaining({ code: "KIND_DEFINITION_IMPORT_COLLISION" }))
      await writeFile(path.join(importedRoot, "KindDefinitions/Note/manifest.xnl"), localDefinition.replace("sha256:2222222222222222222222222222222222222222222222222222222222222222", "sha256:8888888888888888888888888888888888888888888888888888888888888888"))
      const changedImported = await loadResourceTree({ rootDir: importedRoot })
      expect([...changedImported.contentIdentities.values()]).not.toEqual([...imported.contentIdentities.values()])
      await expect(loadResourceTreeFromReadPort({
        port: await memoryPortFromDirectory(target, "/provider/target"), rootPath: "/provider/target", kindDefinitionImports: [{ ...imported }],
      })).rejects.toThrow("KIND_DEFINITION_IMPORT_UNTRUSTED")
    } finally { await Promise.all([rm(target, { recursive: true, force: true }), rm(importedRoot, { recursive: true, force: true })]) }
  })
})
