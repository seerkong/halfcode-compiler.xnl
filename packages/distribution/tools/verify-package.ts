import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const packageRoot = join(import.meta.dir, "..")
const distRoot = join(packageRoot, "dist")
const candidateVersion = "0.2.2"
const publicSpecifiers = [
  "halfcode-compiler.xnl",
  "halfcode-compiler.xnl/application-assembly",
  "halfcode-compiler.xnl/skill-capsule",
  "halfcode-compiler.xnl/contract-schema",
  "halfcode-compiler.xnl/authoring-runtime",
  "halfcode-compiler.xnl/resource-core",
  "halfcode-compiler.xnl/resource-mapping",
  "halfcode-compiler.xnl/resource-projection",
  "halfcode-compiler.xnl/kind-definition",
  "halfcode-compiler.xnl/testing",
] as const

const internalPackagePattern = /\bhalfcode-compiler-[a-z0-9._-]+/i

interface NpmPackResult {
  readonly filename: string
  readonly integrity: string
  readonly shasum: string
  readonly size: number
  readonly files: readonly { readonly path: string; readonly size: number }[]
}

await assertNoInternalSpecifiers()

const verificationRoot = await mkdtemp(join(tmpdir(), "halfcode-compiler-xml-"))
try {
  const [dryRunCandidate] = JSON.parse(
    run(["npm", "pack", "--dry-run", "--json"], packageRoot),
  ) as NpmPackResult[]
  assertCandidateMetadata(dryRunCandidate)

  const packOutput = run(["npm", "pack", "--json", "--pack-destination", verificationRoot], packageRoot)
  const [packedCandidate] = JSON.parse(packOutput) as NpmPackResult[]
  assertCandidateMetadata(packedCandidate)
  if (packedCandidate.shasum !== dryRunCandidate.shasum || packedCandidate.integrity !== dryRunCandidate.integrity) {
    throw new Error("Dry-run and packed candidate identities differ")
  }
  const tarball = join(verificationRoot, packedCandidate.filename)

  assertTarballBoundaries(run(["tar", "-tzf", tarball], packageRoot))
  await verifyConsumer(tarball, join(verificationRoot, "consumer"))
  console.log(JSON.stringify({
    candidate: `halfcode-compiler.xnl@${candidateVersion}`,
    filename: packedCandidate.filename,
    integrity: packedCandidate.integrity,
    shasum: packedCandidate.shasum,
    size: packedCandidate.size,
    files: packedCandidate.files.length,
    publicSpecifiers: publicSpecifiers.length,
  }))
} finally {
  await rm(verificationRoot, { recursive: true, force: true })
}

function assertCandidateMetadata(candidate: NpmPackResult | undefined): asserts candidate is NpmPackResult {
  if (!candidate) throw new Error("npm pack returned no candidate metadata")
  if (candidate.filename !== `halfcode-compiler.xnl-${candidateVersion}.tgz`) {
    throw new Error(`Unexpected candidate filename: ${candidate.filename}`)
  }
  if (!candidate.shasum || !candidate.integrity || candidate.size <= 0 || candidate.files.length === 0) {
    throw new Error("Candidate metadata is incomplete")
  }
  const paths = candidate.files.map((file) => `package/${file.path}`)
  assertTarballBoundaries(paths.join("\n"))
}

async function assertNoInternalSpecifiers(): Promise<void> {
  for (const file of await listFiles(distRoot)) {
    if (!file.endsWith(".js") && !file.endsWith(".d.ts")) continue
    const content = await readFile(file, "utf8")
    if (internalPackagePattern.test(content)) {
      throw new Error(`Private workspace package reference found in ${file}`)
    }
  }
}

function assertTarballBoundaries(listing: string): void {
  const entries = listing.trim().split("\n")
  const forbidden = entries.filter((entry) =>
    entry.startsWith("package/apps/")
    || entry.startsWith("package/codument/")
    || entry.startsWith("package/packages/")
    || entry.startsWith("package/src/")
    || entry.startsWith("package/tools/")
    || entry.includes("tsdown.config"),
  )
  if (forbidden.length > 0) {
    throw new Error(`Unexpected files in npm tarball:\n${forbidden.join("\n")}`)
  }

  const required = ["package/package.json", "package/README.md", "package/dist/index.js", "package/dist/index.d.ts"]
  required.push("package/dist/system-skills/sys-halfcode-resource-dsl.plan.js")
  for (const entry of required) {
    if (!entries.includes(entry)) throw new Error(`Required tarball entry is missing: ${entry}`)
  }
}

async function verifyConsumer(tarball: string, consumerRoot: string): Promise<void> {
  await mkdir(consumerRoot, { recursive: true })
  await writeResourceFixture(join(consumerRoot, "resources-base"), "demo.package.base", "base")
  await writeResourceFixture(join(consumerRoot, "resources-override"), "demo.package.override", "override")
  await writeFile(join(consumerRoot, "package.json"), JSON.stringify({ private: true, type: "module" }, null, 2))
  await writeFile(join(consumerRoot, "runtime-smoke.mjs"), [
    'import { readFile } from "node:fs/promises"',
    'import { dirname, join } from "node:path"',
    'import { fileURLToPath } from "node:url"',
    "",
    `const specifiers = ${JSON.stringify(publicSpecifiers)}`,
    'const packageEntry = fileURLToPath(import.meta.resolve("halfcode-compiler.xnl"))',
    "const packageRoot = dirname(dirname(packageEntry))",
    'const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"))',
    `if (manifest.name !== "halfcode-compiler.xnl" || manifest.version !== "${candidateVersion}" || manifest.private !== false) {`,
    '  throw new Error("Installed package root identity changed")',
    "}",
    'if (JSON.stringify(Object.keys(manifest.exports ?? {})) !== JSON.stringify(specifiers.map((value) => value === "halfcode-compiler.xnl" ? "." : `.${value.slice("halfcode-compiler.xnl".length)}`))) {',
    '  throw new Error("Installed package public specifiers changed")',
    "}",
    "for (const specifier of specifiers) {",
    "  const module = await import(specifier)",
    "  if (Object.keys(module).length === 0) throw new Error(`No exports found for ${specifier}`)",
    "  for (const privateName of ['resolveInternalObjectOperationBinding', 'resolveObjectOperationCompilation', 'InternalObjectOperationBinding', 'ObjectOperationBinding', 'ObjectOperationCompilation', 'BusinessMutationResource']) {",
    "    if (privateName in module) throw new Error(`Private object binding export ${privateName} leaked from ${specifier}`)",
    "  }",
    "}",
    "",
    'const rootModule = await import("halfcode-compiler.xnl")',
    'const resourceCore = await import("halfcode-compiler.xnl/resource-core")',
    'for (const name of [',
    '  "resolveApplicationAssembly",',
    '  "compileSkillCapsule",',
    '  "compileResourceSkillCapsule",',
    '  "planSkillCapsuleDistribution",',
    '  "skillCapsuleDistributionProjection",',
    '  "applySkillCapsuleDistributionPlan",',
    '  "loadResourceTree",',
    '  "composeLayeredResourceRegistry",',
    '  "resolveEffectiveResourceContentIdentities",',
    '  "buildResourceDependencySnapshot",',
    ']) {',
    '  if (typeof rootModule[name] !== "function") throw new Error(`Root runtime identity is missing ${name}`)',
    "}",
    'const skillCapsuleModule = await import("halfcode-compiler.xnl/skill-capsule")',
    'for (const name of [',
    '  "compileSkillCapsule",',
    '  "compileResourceSkillCapsule",',
    '  "planSkillCapsuleDistribution",',
    '  "skillCapsuleDistributionProjection",',
    '  "applySkillCapsuleDistributionPlan",',
    ']) {',
    '  if (typeof skillCapsuleModule[name] !== "function") throw new Error(`Skill subpath runtime identity is missing ${name}`)',
    "}",
    "for (const name of [",
    '  "loadResourceTree",',
    '  "composeLayeredResourceRegistry",',
    '  "createResourceContentIdentity",',
    '  "buildResourceDependencySnapshot",',
    '  "resolveEffectiveResourceContentIdentities",',
    '  "sha256Digest",',
    "]) {",
    "  if (typeof resourceCore[name] !== \"function\") throw new Error(`Missing resource-core runtime export ${name}`)",
    "}",
    "",
    "let legacyLoaderError",
    "try {",
    '  await resourceCore.loadResourceTree({ rootDir: process.cwd(), manifestPath: "unsupported.xml" })',
    "} catch (error) {",
    "  legacyLoaderError = error",
    "}",
    "if (!(legacyLoaderError instanceof resourceCore.ResourceValidationError)) {",
    '  throw new Error("Legacy loadResourceTree surface is not callable")',
    "}",
    'if (legacyLoaderError.diagnostics[0]?.code !== "RESOURCE_AUTHORITY_FORMAT_UNSUPPORTED") {',
    '  throw new Error("Legacy loadResourceTree diagnostic contract changed")',
    "}",
    "",
    "const resourceNode = (kind, resourceId, value) => Object.freeze({",
    "  tag: kind,",
    "  resourceId,",
    '  metadata: Object.freeze({ apiVersion: "halfcode.resources/v1" }),',
    "  properties: Object.freeze({ value }),",
    "  body: Object.freeze([]),",
    "  subdomains: Object.freeze({}),",
    "})",
    "const resourceRecord = (resourceId, kind, value) => Object.freeze({",
    "  resourceId,",
    "  kind,",
    "  fqn: resourceId,",
    '  metadata: Object.freeze({ apiVersion: "halfcode.resources/v1", version: "1.0.0" }),',
    '  sourceShape: "single-file",',
    '  logicalPath: `${resourceId}.xnl`,',
    '  documentUri: `vfs://@/${resourceId}.xnl`,',
    '  format: "xnl",',
    "  node: resourceNode(kind, resourceId, value),",
    "})",
    "const resourceTree = (packageId, value) => {",
    '  const resource = resourceRecord("demo.note.root", "Note", value)',
    "  return Object.freeze({",
    '    manifest: resourceRecord(packageId, "ResourcePackage", packageId),',
    '    registry: Object.freeze({ byKind: new Map([["Note", [resource]]]), kindDefinitions: new Map() }),',
    "    diagnostics: Object.freeze([]),",
    "  })",
    "}",
    "const registry = resourceCore.composeLayeredResourceRegistry({",
    "  layers: [",
    '    { id: "base", tree: resourceTree("demo.package.base", "base") },',
    '    { id: "override", tree: resourceTree("demo.package.override", "override") },',
    "  ],",
    "})",
    'if (registry.byId.get("demo.note.root")?.effectiveLayerId !== "override") {',
    '  throw new Error("Layered registry did not apply explicit caller order")',
    "}",
    'if (registry.byId.get("demo.note.root")?.shadowed.length !== 1) {',
    '  throw new Error("Layered registry did not preserve shadow provenance")',
    "}",
    "const identity = resourceCore.createResourceContentIdentity({",
    '  resourceId: "demo.note.root",',
    '  authorityDigest: resourceCore.sha256Digest("authority"),',
    '  contributions: [{ key: "instruction", digest: resourceCore.sha256Digest("instruction"), sourceUri: "vfs://@/instruction.md" }],',
    "})",
    "const snapshot = resourceCore.buildResourceDependencySnapshot({",
    "  registry,",
    '  roots: ["demo.note.root"],',
    "  edges: [],",
    '  contentIdentities: new Map([["demo.note.root", identity]]),',
    "})",
    'if (snapshot.closure.length !== 1 || snapshot.closure[0]?.resourceId !== "demo.note.root") {',
    '  throw new Error("Dependency snapshot did not retain the explicit root")',
    "}",
    'if (!snapshot.snapshotRevision.startsWith("sha256:")) throw new Error("Snapshot revision is missing")',
    "",
    'const baseTree = await resourceCore.loadResourceTree({ rootDir: join(process.cwd(), "resources-base") })',
    'const overrideTree = await resourceCore.loadResourceTree({ rootDir: join(process.cwd(), "resources-override") })',
    'if (baseTree.contentIdentities.size !== 1 || overrideTree.contentIdentities.size !== 1) {',
    '  throw new Error("Real loader content identity coverage changed")',
    "}",
    "const loadedLayers = [",
    '  { id: "base", tree: baseTree },',
    '  { id: "override", tree: overrideTree },',
    "]",
    "const loadedRegistry = resourceCore.composeLayeredResourceRegistry({ layers: loadedLayers })",
    "const loadedIdentities = resourceCore.resolveEffectiveResourceContentIdentities({",
    "  registry: loadedRegistry,",
    "  layers: loadedLayers,",
    "  contributions: new Map([[",
    '    "demo.note.root",',
    '    [{ key: "instruction", digest: resourceCore.sha256Digest("installed-consumer") }],',
    "  ]]),",
    "})",
    'if (loadedIdentities.get("demo.note.root")?.authorityDigest !== overrideTree.contentIdentities.get("demo.note.root")?.authorityDigest) {',
    '  throw new Error("Effective content identity did not select the exact loaded override")',
    "}",
    "const loadedSnapshot = resourceCore.buildResourceDependencySnapshot({",
    "  registry: loadedRegistry,",
    '  roots: ["demo.note.root"],',
    "  edges: [],",
    "  contentIdentities: loadedIdentities,",
    "})",
    'if (loadedSnapshot.closure[0]?.origin.packageId !== "demo.package.override") {',
    '  throw new Error("Real loader snapshot did not preserve effective package origin")',
    "}",
    'if (!loadedSnapshot.snapshotRevision.startsWith("sha256:")) throw new Error("Real loader snapshot revision is missing")',
    "",
    "const bundledSkillPlan = await rootModule.loadHalfcodeResourceDslSystemSkillPlan()",
    'if ("halfcodeResourceDslSystemSkillIdentity" in rootModule) {',
    '  throw new Error("Bundled Resource DSL Skill identity must be derived from the generated plan")',
    "}",
    'if (JSON.stringify(bundledSkillPlan.roots) !== JSON.stringify([{ fqn: "Halfcode.ResourceDsl.Skill.System", name: "sys-halfcode-resource-dsl", apiVersion: "halfcode.resources/v1", version: "1.0.0" }])) {',
    '  throw new Error("Bundled Resource DSL Skill identity changed")',
    "}",
    'const bundledOutputRoot = join(process.cwd(), "installed-system-skills")',
    "await rootModule.applySkillCapsuleDistributionPlan(bundledSkillPlan, { outputRoot: bundledOutputRoot })",
    'const bundledProvenance = JSON.parse(await readFile(join(bundledOutputRoot, "sys-halfcode-resource-dsl/references/.halfcode/provenance.json"), "utf8"))',
    'if (bundledProvenance.source?.fqn !== "Halfcode.ResourceDsl.Skill.System" || bundledProvenance.source?.version !== "1.0.0") {',
    '  throw new Error("Bundled Resource DSL Skill provenance changed")',
    "}",
    'const bundledIndex = await readFile(join(bundledOutputRoot, "sys-halfcode-resource-dsl/references/resource-dsl/index.md"), "utf8")',
    'if (!bundledIndex.includes("Halfcode XNL Resource DSL")) throw new Error("Bundled canonical Resource DSL index is missing")',
    "",
  ].join("\n"))
  await writeFile(join(consumerRoot, "type-smoke.ts"), [
    ...publicSpecifiers.map((specifier, index) => `import * as entry${index} from ${JSON.stringify(specifier)}`),
    "import type {",
    "  ApplySkillCapsuleDistributionOptions as RootApplySkillCapsuleDistributionOptions,",
    "  CompileResourceSkillCapsuleInput as RootCompileResourceSkillCapsuleInput,",
    "  CompileSkillCapsuleInput as RootCompileSkillCapsuleInput,",
    "  PageObjectResource,",
    "  LoadedResourceTree as RootLoadedResourceTree,",
    "  PlanSkillCapsuleDistributionInput as RootPlanSkillCapsuleDistributionInput,",
    "  PlannedSkillFile as RootPlannedSkillFile,",
    "  SkillCapsuleDependency as RootSkillCapsuleDependency,",
    "  SkillCapsuleProvenanceManifest as RootSkillCapsuleProvenanceManifest,",
    "  SkillCapsuleDistributionPlan as RootSkillCapsuleDistributionPlan,",
    "  SkillCapsuleDistributionReceipt as RootSkillCapsuleDistributionReceipt,",
    "  SkillCapsulePlan as RootSkillCapsulePlan,",
    "  ResourceLayerContentIdentityInput as RootResourceLayerContentIdentityInput,",
    "  ResolveEffectiveResourceContentIdentitiesInput as RootResolveEffectiveResourceContentIdentitiesInput,",
    "  ResourceTreeBuildResult as RootResourceTreeBuildResult,",
    '} from "halfcode-compiler.xnl"',
    "import {",
    "  applySkillCapsuleDistributionPlan,",
    "  compileResourceSkillCapsule,",
    "  compileSkillCapsule,",
    "  planSkillCapsuleDistribution,",
    "  skillCapsuleDistributionProjection,",
    "  type ApplySkillCapsuleDistributionOptions,",
    "  type CompileResourceSkillCapsuleInput,",
    "  type CompileSkillCapsuleInput,",
    "  type PlanSkillCapsuleDistributionInput,",
    "  type PlannedSkillFile,",
    "  type SkillCapsuleDependency,",
    "  type SkillCapsuleProvenanceManifest,",
    "  type SkillCapsuleDistributionPlan,",
    "  type SkillCapsuleDistributionReceipt,",
    "  type SkillCapsulePlan,",
    '} from "halfcode-compiler.xnl/skill-capsule"',
    "import {",
    "  buildResourceDependencySnapshot,",
    "  composeLayeredResourceRegistry,",
    "  createResourceContentIdentity,",
    "  loadResourceTree,",
    "  resolveEffectiveResourceContentIdentities,",
    "  sha256Digest,",
    "  type EffectiveResourceRegistry,",
    "  type LoadedResourceTree,",
    "  type ResourceDependencyEdge,",
    "  type ResourceDependencySnapshot,",
    "  type ResourceLayerInput,",
    "  type ResourceLayerContentIdentityInput,",
    "  type ResolveEffectiveResourceContentIdentitiesInput,",
    "  type ResourceTree,",
    "  type ResourceTreeBuildResult,",
    '} from "halfcode-compiler.xnl/resource-core"',
    "",
    `void [${publicSpecifiers.map((_, index) => `entry${index}`).join(", ")}]`,
    "const pageObject = null as PageObjectResource | null",
    "void pageObject",
    "const dependency: SkillCapsuleDependency = {",
    '  ref: "resource://example.skill.authoring",',
    '  fqn: "example.skill.authoring",',
    '  version: "1.0.0",',
    "}",
    "const rootDependency: RootSkillCapsuleDependency = dependency",
    "const plannedFile: PlannedSkillFile = {",
    '  skillFqn: "example.skill.authoring",',
    '  skillApiVersion: "halfcode.resources/v1",',
    '  skillVersion: "1.0.0",',
    '  capsuleRelativePath: "SKILL.md",',
    '  targetRelativePath: "example-authoring/SKILL.md",',
    '  contentBase64: "",',
    "  get content() { return new Uint8Array() },",
    '  contentDigest: "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",',
    "}",
    "const rootPlannedFile: RootPlannedSkillFile = plannedFile",
    "const provenance: SkillCapsuleProvenanceManifest = {",
    '  format: "halfcode.skill-provenance/v1",',
    '  generatedBy: "halfcode.skill-distribution/v1",',
    '  source: { fqn: "example.skill.authoring", apiVersion: "halfcode.resources/v1", version: "1.0.0" },',
    "  payloadFiles: [],",
    "}",
    "const rootProvenance: RootSkillCapsuleProvenanceManifest = provenance",
    'type RootProvenanceDigest = RootSkillCapsuleProvenanceManifest["payloadFiles"][number]["contentDigest"]',
    'const rootProvenanceDigest: `sha256:${string}` = null as unknown as RootProvenanceDigest',
    "void rootProvenanceDigest",
    "const distributionPlan: SkillCapsuleDistributionPlan = {",
    '  format: "halfcode.skill-distribution/v1",',
    "  roots: [],",
    "  topology: [],",
    "  capsules: [],",
    "  files: [plannedFile],",
    '  closureDigest: "sha256:fixture",',
    "}",
    "const rootDistributionPlan: RootSkillCapsuleDistributionPlan = distributionPlan",
    "declare const rootTypes: readonly [",
    "  RootCompileSkillCapsuleInput,",
    "  RootCompileResourceSkillCapsuleInput,",
    "  RootSkillCapsulePlan,",
    "  RootPlanSkillCapsuleDistributionInput,",
    "  RootApplySkillCapsuleDistributionOptions,",
    "  RootSkillCapsuleDistributionReceipt,",
    "]",
    "declare const subpathTypes: readonly [",
    "  CompileSkillCapsuleInput,",
    "  CompileResourceSkillCapsuleInput,",
    "  SkillCapsulePlan,",
    "  PlanSkillCapsuleDistributionInput,",
    "  ApplySkillCapsuleDistributionOptions,",
    "  SkillCapsuleDistributionReceipt,",
    "]",
    "void [",
    "  rootDependency,",
    "  rootPlannedFile,",
    "  rootProvenance,",
    "  rootDistributionPlan,",
    "  rootTypes,",
    "  subpathTypes,",
    "  compileSkillCapsule,",
    "  compileResourceSkillCapsule,",
    "  planSkillCapsuleDistribution,",
    "  skillCapsuleDistributionProjection,",
    "  applySkillCapsuleDistributionPlan,",
    "]",
    "declare const tree: ResourceTree",
    "const legacyBuildResult: ResourceTreeBuildResult = { diagnostics: [], tree }",
    "const rootLegacyBuildResult: RootResourceTreeBuildResult = legacyBuildResult",
    'const layers: readonly ResourceLayerInput[] = [{ id: "base", tree }]',
    "const registry: EffectiveResourceRegistry = composeLayeredResourceRegistry({ layers })",
    "const identity = createResourceContentIdentity({",
    "  resourceId: tree.manifest.resourceId,",
    '  authorityDigest: sha256Digest("authority"),',
    "})",
    "const edges: readonly ResourceDependencyEdge[] = []",
    "const snapshot: ResourceDependencySnapshot = buildResourceDependencySnapshot({",
    "  registry,",
    "  roots: [identity.resourceId],",
    "  edges,",
    "  contentIdentities: new Map([[identity.resourceId, identity]]),",
    "})",
    "const legacyLoad: ReturnType<typeof loadResourceTree> = loadResourceTree({ rootDir: \".\" })",
    "declare const loadedTree: LoadedResourceTree",
    'const contentLayers: readonly ResourceLayerContentIdentityInput[] = [{ id: "base", tree: loadedTree }]',
    "declare const loadedRegistry: EffectiveResourceRegistry",
    "const projectorInput: ResolveEffectiveResourceContentIdentitiesInput = {",
    "  registry: loadedRegistry,",
    "  layers: contentLayers,",
    "}",
    "const projectedIdentities = resolveEffectiveResourceContentIdentities(projectorInput)",
    "const rootLoadedTree: RootLoadedResourceTree = loadedTree",
    "const rootContentLayers: readonly RootResourceLayerContentIdentityInput[] = contentLayers",
    "const rootProjectorInput: RootResolveEffectiveResourceContentIdentitiesInput = projectorInput",
    "void [snapshot, legacyLoad, legacyBuildResult, rootLegacyBuildResult, projectedIdentities, rootLoadedTree, rootContentLayers, rootProjectorInput]",
    "",
  ].join("\n"))
  await writeFile(join(consumerRoot, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      module: "NodeNext",
      moduleResolution: "NodeNext",
      noEmit: true,
      strict: true,
      target: "ES2022",
    },
    include: ["type-smoke.ts"],
  }, null, 2))

  run(["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], consumerRoot)
  run(["node", "runtime-smoke.mjs"], consumerRoot)
  run(["node", "node_modules/typescript/bin/tsc", "--noEmit"], consumerRoot)
}

async function writeResourceFixture(root: string, packageId: string, value: string): Promise<void> {
  await mkdir(join(root, "KindDefinitions/Note"), { recursive: true })
  await mkdir(join(root, "Notes"), { recursive: true })
  await writeFile(join(root, "manifest.xnl"), [
    `<ResourcePackage #${packageId} apiVersion="halfcode.resources/v1" version="1.0.0" { lifecycle = "Active" } (`,
    "  <Catalogs [",
    '    <Catalog #kind_definitions { kind = "KindDefinition" shape = "directory" root = "vfs://./KindDefinitions/" entry = "manifest.xnl" }>',
    '    <Catalog #notes { kind = "Note" shape = "single-file" root = "vfs://./Notes/" }>',
    "  ]>",
    ")>",
    "",
  ].join("\n"))
  await writeFile(join(root, "KindDefinitions/Note/manifest.xnl"), [
    '<KindDefinition #halfcode.resource_kind.Note apiVersion="halfcode.resources/v1" version="1.0.0" {',
    '  lifecycle = "Stable"',
    '  resourceKind = "Note"',
    '  sourceShapes = ["single-file"]',
    '  currentApiVersion = "halfcode.resources/v1"',
    '  supportedApiVersions = ["halfcode.resources/v1"]',
    "}>",
    "",
  ].join("\n"))
  await writeFile(join(root, "Notes/Root.xnl"), [
    '<Note #demo.note.root apiVersion="halfcode.resources/v1" version="1.0.0" {',
    `  value = ${JSON.stringify(value)}`,
    "}>",
    "",
  ].join("\n"))
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? listFiles(path) : [path]
  }))
  return files.flat()
}

function run(command: string[], cwd: string): string {
  const result = Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe" })
  const stdout = result.stdout.toString()
  const stderr = result.stderr.toString()
  if (result.exitCode !== 0) {
    throw new Error(`${command.join(" ")} failed (${result.exitCode})\n${stdout}${stderr}`)
  }
  return stdout
}
