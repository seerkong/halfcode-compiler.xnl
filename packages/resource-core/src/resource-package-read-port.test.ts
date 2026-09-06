import { describe, expect, test } from "bun:test"
import {
  canonicalResourcePackageSourcePath,
  dirnameResourcePackageSourcePath,
  joinResourcePackageSourcePath,
  relativeResourcePackageSourcePath,
  ResourcePackageSourcePathError,
  type ResourcePackageReadPort,
} from "./resource-package-read-port"

describe("ResourcePackage read-port contract", () => {
  test("uses a framework-neutral three-operation source effect", () => {
    const files = new Map([["/package/manifest.xnl", new TextEncoder().encode("<ResourcePackage>")]])
    const port: ResourcePackageReadPort = {
      stat: (sourcePath) => sourcePath === "/package" ? { kind: "directory" } : files.has(sourcePath) ? { kind: "file" } : undefined,
      readDirectory: (sourcePath) => sourcePath === "/package" ? [{ name: "manifest.xnl", kind: "file" }] : undefined,
      readBytes: (sourcePath) => files.get(sourcePath),
    }

    expect(port.stat("/package")).toEqual({ kind: "directory" })
    expect(port.readDirectory("/package")).toEqual([{ name: "manifest.xnl", kind: "file" }])
    expect(port.readBytes("/package/manifest.xnl")).toEqual(files.get("/package/manifest.xnl"))
  })

  test("provides canonical containment helpers without provider-specific dependencies", () => {
    expect(canonicalResourcePackageSourcePath("/provider/package")).toBe("/provider/package")
    expect(joinResourcePackageSourcePath("/provider/package", "Catalogs", "manifest.xnl")).toBe("/provider/package/Catalogs/manifest.xnl")
    expect(dirnameResourcePackageSourcePath("/provider/package/Catalogs/manifest.xnl")).toBe("/provider/package/Catalogs")
    expect(relativeResourcePackageSourcePath("/provider/package", "/provider/package/Catalogs/manifest.xnl")).toBe("Catalogs/manifest.xnl")
    expect(relativeResourcePackageSourcePath("/provider/package", "/provider/other/manifest.xnl")).toBeUndefined()
  })

  test.each([
    "relative/path",
    "/provider//package",
    "/provider/./package",
    "/provider/../package",
    "/provider/package/",
    "/provider\\package",
  ])("rejects non-canonical provider path %s", (sourcePath) => {
    expect(() => canonicalResourcePackageSourcePath(sourcePath)).toThrow(ResourcePackageSourcePathError)
  })
})
