import { lstat, readFile, readdir, realpath } from "node:fs/promises"
import path from "node:path"
import {
  canonicalResourcePackageSourcePath,
  relativeResourcePackageSourcePath,
  type ResourcePackageDirectoryEntry,
  type ResourcePackageEntry,
  type ResourcePackageReadPort,
} from "./resource-package-read-port"

function entryKind(entry: { isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean }): ResourcePackageEntry["kind"] {
  if (entry.isSymbolicLink()) return "symlink"
  if (entry.isFile()) return "file"
  if (entry.isDirectory()) return "directory"
  return "other"
}

export async function createDirectoryResourcePackageReadPort(rootDir: string): Promise<ResourcePackageReadPort> {
  const requestedRoot = path.resolve(rootDir)
  const boundary = await realpath(requestedRoot).catch(() => requestedRoot)

  const lexicalPhysicalPath = (sourcePath: string): string => {
    const canonical = canonicalResourcePackageSourcePath(sourcePath)
    const relative = relativeResourcePackageSourcePath("/", canonical)
    if (relative === undefined) throw new TypeError("ResourcePackage source path is outside the directory port")
    return path.resolve(boundary, relative)
  }

  const containedRealPath = async (sourcePath: string): Promise<string | undefined> => {
    const candidate = lexicalPhysicalPath(sourcePath)
    const resolved = await realpath(candidate).catch(() => undefined)
    if (!resolved) return undefined
    if (resolved !== boundary && !resolved.startsWith(`${boundary}${path.sep}`)) return undefined
    return resolved
  }

  return Object.freeze({
    async stat(sourcePath: string): Promise<ResourcePackageEntry | undefined> {
      const candidate = lexicalPhysicalPath(sourcePath)
      const info = await lstat(candidate).catch(() => undefined)
      return info ? Object.freeze({ kind: entryKind(info) }) : undefined
    },
    async readDirectory(sourcePath: string): Promise<readonly ResourcePackageDirectoryEntry[] | undefined> {
      const resolved = await containedRealPath(sourcePath)
      if (!resolved) return undefined
      const entries = await readdir(resolved, { withFileTypes: true }).catch(() => undefined)
      return entries?.map((entry) => Object.freeze({ name: entry.name, kind: entryKind(entry) }))
    },
    async readBytes(sourcePath: string): Promise<Uint8Array | undefined> {
      const resolved = await containedRealPath(sourcePath)
      if (!resolved) return undefined
      return readFile(resolved).catch(() => undefined)
    },
  })
}
