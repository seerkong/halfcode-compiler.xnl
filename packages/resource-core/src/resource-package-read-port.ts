export type ResourcePackageAwaitable<T> = T | PromiseLike<T>

export type ResourcePackageEntryKind = "file" | "directory" | "symlink" | "other"

export interface ResourcePackageEntry {
  readonly kind: ResourcePackageEntryKind
}

export interface ResourcePackageDirectoryEntry extends ResourcePackageEntry {
  readonly name: string
}

/**
 * Storage-neutral source effect for one already-materialized ResourcePackage
 * file view. Paths are canonical POSIX absolute coordinates scoped to the
 * provider; they are never semantic resource provenance.
 */
export interface ResourcePackageReadPort {
  stat(sourcePath: string): ResourcePackageAwaitable<ResourcePackageEntry | undefined>
  readDirectory(sourcePath: string): ResourcePackageAwaitable<readonly ResourcePackageDirectoryEntry[] | undefined>
  readBytes(sourcePath: string): ResourcePackageAwaitable<Uint8Array | undefined>
}

import type { AuthoredResourceTree } from "./index"

export interface ResourcePackageReadPortOptions {
  readonly port: ResourcePackageReadPort
  readonly rootPath?: string
  readonly manifestPath?: string
  /** Independently loaded, authentic KindDefinition-only packages trusted by this host. */
  readonly kindDefinitionImports?: readonly AuthoredResourceTree[]
}

export class ResourcePackageSourcePathError extends TypeError {
  constructor(message: string) {
    super(message)
    this.name = "ResourcePackageSourcePathError"
  }
}

export function canonicalResourcePackageSourcePath(input: string): string {
  if (!input.startsWith("/")) {
    throw new ResourcePackageSourcePathError("ResourcePackage source paths must be POSIX absolute")
  }
  if (input.includes("\\") || input.includes("\0")) {
    throw new ResourcePackageSourcePathError("ResourcePackage source paths must not contain backslashes or NUL")
  }
  if (input === "/") return input
  if (input.endsWith("/") || input.includes("//")) {
    throw new ResourcePackageSourcePathError("ResourcePackage source paths must not contain empty segments")
  }
  const segments = input.slice(1).split("/")
  if (segments.some((segment) => segment === "." || segment === ".." || segment.length === 0)) {
    throw new ResourcePackageSourcePathError("ResourcePackage source paths must not contain dot segments")
  }
  return `/${segments.join("/")}`
}

export function joinResourcePackageSourcePath(base: string, ...segments: readonly string[]): string {
  const canonicalBase = canonicalResourcePackageSourcePath(base)
  const additions: string[] = []
  for (const segment of segments) {
    if (!segment || segment === "." || segment === ".." || segment.includes("/") || segment.includes("\\") || segment.includes("\0")) {
      throw new ResourcePackageSourcePathError("ResourcePackage source path segments must be plain names")
    }
    additions.push(segment)
  }
  if (additions.length === 0) return canonicalBase
  return canonicalBase === "/" ? `/${additions.join("/")}` : `${canonicalBase}/${additions.join("/")}`
}

export function dirnameResourcePackageSourcePath(sourcePath: string): string {
  const canonical = canonicalResourcePackageSourcePath(sourcePath)
  if (canonical === "/") return canonical
  const boundary = canonical.lastIndexOf("/")
  return boundary === 0 ? "/" : canonical.slice(0, boundary)
}

export function relativeResourcePackageSourcePath(rootPath: string, sourcePath: string): string | undefined {
  const root = canonicalResourcePackageSourcePath(rootPath)
  const source = canonicalResourcePackageSourcePath(sourcePath)
  if (source === root) return ""
  const prefix = root === "/" ? "/" : `${root}/`
  return source.startsWith(prefix) ? source.slice(prefix.length) : undefined
}
