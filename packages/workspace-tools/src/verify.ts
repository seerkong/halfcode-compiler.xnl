import { readdir, readFile, stat } from "node:fs/promises"
import { join, relative } from "node:path"
import { compileContractSchemas } from "halfcode-compiler-contract-schema"

export type ApplicationRole = "contracts" | "authoring" | "skill-capsule"
export type ApplicationScope = "shared" | "domain"
export type PackageKind = "framework" | "application"

export interface WorkspacePackageManifest {
  path: string
  name: string
  private: boolean
  packageKind: PackageKind
  applicationFamily?: string
  applicationScope?: ApplicationScope
  applicationRole?: ApplicationRole
  capabilitySubpathExports: readonly string[]
  exports: Readonly<Record<string, unknown>>
  dependencies: ReadonlySet<string>
}

export interface VerifyWorkspaceOptions {
  rootDir: string
  checkGenerated?: boolean
  checkLegacyTerms?: boolean
}

export interface WorkspaceVerificationReport {
  packages: readonly WorkspacePackageManifest[]
  textFileCount: number
}

const roleRank: Readonly<Record<ApplicationRole, number>> = {
  contracts: 0,
  authoring: 1,
  "skill-capsule": 2,
}

const bannedTerms = [
  ["it", "asset"].join("-"),
  ["It", "Asset", "Management"].join(""),
  ["asset", "management"].join("-"),
  ["compiler", "ace"].join("-"),
  ["compiler", "omni"].join("-"),
]

export async function verifyWorkspace(options: VerifyWorkspaceOptions): Promise<WorkspaceVerificationReport> {
  const rootDir = options.rootDir
  const rootManifest = await readJson(join(rootDir, "package.json"))
  const workspacePatterns = stringArray(rootManifest.workspaces, "root package workspaces")
  const packagePaths = await discoverWorkspacePackagePaths(rootDir, workspacePatterns)
  const packages = await Promise.all(packagePaths.map((path) => readPackageManifest(rootDir, path)))
  const byName = new Map(packages.map((item) => [item.name, item]))
  if (byName.size !== packages.length) throw new Error("Workspace package names must be unique")

  for (const item of packages) {
    validatePackageTopology(item)
    validateDependencyDirection(item, byName)
    if (item.applicationRole === "contracts") {
      await validateCapabilitySubpathExports(rootDir, item)
      if (options.checkGenerated ?? true) {
        await compileContractSchemas({ packageRoot: join(rootDir, item.path), checkOnly: true, expectedKind: "Contract" })
      }
    }
  }

  const textFiles = await collectTextFiles(rootDir)
  if (options.checkLegacyTerms ?? true) {
    for (const file of textFiles) {
      const content = await readFile(file, "utf8")
      for (const term of bannedTerms) {
        if (content.includes(term)) {
          throw new Error(`forbidden legacy term '${term}' in ${relative(rootDir, file)}`)
        }
      }
    }
  }

  return { packages: packages.sort((a, b) => a.name.localeCompare(b.name)), textFileCount: textFiles.length }
}

async function discoverWorkspacePackagePaths(rootDir: string, patterns: readonly string[]): Promise<string[]> {
  const paths: string[] = []
  for (const pattern of patterns) {
    const match = /^([^*]+)\/\*$/.exec(pattern)
    if (!match) throw new Error(`Unsupported workspace pattern '${pattern}'; expected '<directory>/*'`)
    const base = match[1]
    for (const entry of await readdir(join(rootDir, base), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const path = `${base}/${entry.name}`
      const packageJson = join(rootDir, path, "package.json")
      if (await stat(packageJson).then((info) => info.isFile()).catch(() => false)) paths.push(path)
    }
  }
  return paths.sort()
}

async function readPackageManifest(rootDir: string, path: string): Promise<WorkspacePackageManifest> {
  const data = await readJson(join(rootDir, path, "package.json"))
  const name = requiredString(data.name, `${path}/package.json name`)
  const packageKind = requiredEnum(data.packageKind, ["framework", "application"] as const, `${name} packageKind`)
  const dependencies = new Set<string>()
  for (const field of ["dependencies", "devDependencies", "peerDependencies"] as const) {
    const values = objectValue(data[field])
    for (const dependency of Object.keys(values)) dependencies.add(dependency)
  }
  return {
    path,
    name,
    private: requiredBoolean(data.private, `${name} private`),
    packageKind,
    applicationFamily: optionalString(data.applicationFamily),
    applicationScope: optionalEnum(data.applicationScope, ["shared", "domain"] as const, `${name} applicationScope`),
    applicationRole: optionalEnum(data.applicationRole, ["contracts", "authoring", "skill-capsule"] as const, `${name} applicationRole`),
    capabilitySubpathExports: data.capabilitySubpathExports === undefined
      ? []
      : stringArray(data.capabilitySubpathExports, `${name} capabilitySubpathExports`),
    exports: objectValue(data.exports),
    dependencies,
  }
}

function validatePackageTopology(item: WorkspacePackageManifest) {
  if (item.path.startsWith("packages/")) {
    if (item.packageKind !== "framework") throw new Error(`${item.name} under packages/* must declare packageKind=framework`)
    const isPublicDistribution = item.path === "packages/distribution" && item.name === "halfcode-compiler.xnl"
    if (isPublicDistribution && item.private) throw new Error("halfcode-compiler.xnl distribution must be public")
    if (!isPublicDistribution && !item.private) throw new Error(`Internal framework package must be private: ${item.name}`)
    if (!isPublicDistribution && !item.name.startsWith("halfcode-compiler-")) {
      throw new Error(`Framework package must use halfcode-compiler- prefix: ${item.name}`)
    }
    if (item.applicationFamily || item.applicationScope || item.applicationRole) {
      throw new Error(`Framework package ${item.name} must not declare application metadata`)
    }
    return
  }

  if (item.packageKind !== "application") throw new Error(`${item.name} under apps/* must declare packageKind=application`)
  if (!item.private) throw new Error(`Application package must be private: ${item.name}`)
  if (!item.applicationFamily || !item.applicationScope || !item.applicationRole) {
    throw new Error(`Application package ${item.name} requires applicationFamily/applicationScope/applicationRole`)
  }
}

function validateDependencyDirection(
  item: WorkspacePackageManifest,
  packages: ReadonlyMap<string, WorkspacePackageManifest>,
) {
  for (const dependencyName of item.dependencies) {
    const dependency = packages.get(dependencyName)
    if (!dependency) continue
    if (item.packageKind === "framework" && dependency.packageKind === "application") {
      throw new Error(`Framework package ${item.name} must not depend on application package ${dependency.name}`)
    }
    if (item.packageKind !== "application" || dependency.packageKind !== "application") continue
    if (item.applicationFamily !== dependency.applicationFamily) {
      throw new Error(`Application package ${item.name} must not depend across family boundary on ${dependency.name}`)
    }
    if (item.applicationScope === "shared" && dependency.applicationScope === "domain") {
      throw new Error(`Shared package ${item.name} must not depend on domain package ${dependency.name}`)
    }
    if (roleRank[dependency.applicationRole!] > roleRank[item.applicationRole!]) {
      throw new Error(`${item.applicationRole} package ${item.name} must not depend on ${dependency.applicationRole} package ${dependency.name}`)
    }
  }
}

async function validateCapabilitySubpathExports(rootDir: string, item: WorkspacePackageManifest) {
  const srcRoot = join(rootDir, item.path, "src")
  const facts = await findNamedFiles(srcRoot, "contract.json")
  const expected = facts.map((path) => {
    const directory = relative(srcRoot, join(path, "..")).split("\\").join("/")
    return `./${directory}`
  }).sort()
  const declared = [...item.capabilitySubpathExports].sort()
  if (JSON.stringify(expected) !== JSON.stringify(declared)) {
    throw new Error(`${item.name} capabilitySubpathExports mismatch: expected ${expected.join(", ")}; received ${declared.join(", ")}`)
  }
  for (const subpath of declared) {
    if (!(subpath in item.exports)) throw new Error(`${item.name} capability subpath is not exported: ${subpath}`)
  }
}

async function findNamedFiles(dir: string, name: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await findNamedFiles(path, name))
    else if (entry.isFile() && entry.name === name) out.push(path)
  }
  return out.sort()
}

async function collectTextFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await collectTextFiles(path))
    else if (/\.(json|md|ts|xml|yaml|yml|txt)$/.test(entry.name)) out.push(path)
  }
  return out
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`)
  return value
}

function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`)
  return value
}

function optionalString(value: unknown): string | undefined {
  return value === undefined ? undefined : requiredString(value, "metadata field")
}

function requiredEnum<const T extends readonly string[]>(value: unknown, allowed: T, label: string): T[number] {
  const result = optionalEnum(value, allowed, label)
  if (!result) throw new Error(`${label} is required`)
  return result
}

function optionalEnum<const T extends readonly string[]>(value: unknown, allowed: T, label: string): T[number] | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string" || !allowed.includes(value)) throw new Error(`${label} must be one of ${allowed.join(", ")}`)
  return value as T[number]
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${label} must be an array of non-empty strings`)
  }
  return [...value] as string[]
}

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

if (import.meta.main) {
  const rootDir = new URL("../../..", import.meta.url).pathname
  const report = await verifyWorkspace({ rootDir })
  console.log(`verify: ${report.packages.length} packages, ${report.textFileCount} text files`)
}
