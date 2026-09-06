import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createKindSpecRevision, createKindSubjectOwner } from "halfcode-compiler-kind-definition"
import { digestCanonical } from "halfcode-compiler-resource-core"

const packageRoot = join(import.meta.dir, "..")
const distRoot = join(packageRoot, "dist")
const candidateVersion = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")).version as string
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
await assertPackagedResourceTree()

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

async function assertPackagedResourceTree(): Promise<void> {
  const canonicalRoot = join(packageRoot, "../../docs/resource-dsl")
  const packagedRoot = join(distRoot, "system-skills/resource-dsl")
  const canonicalFiles = (await listFiles(canonicalRoot))
    .map((file) => file.slice(canonicalRoot.length + 1))
    .sort(compareStrings)
  const packagedFiles = (await listFiles(packagedRoot))
    .map((file) => file.slice(packagedRoot.length + 1))
    .sort(compareStrings)
  if (JSON.stringify(packagedFiles) !== JSON.stringify(canonicalFiles)) {
    throw new Error("Package-contained Resource DSL file set differs from canonical source")
  }
  for (const relativePath of canonicalFiles) {
    const canonical = Buffer.from(await readFile(join(canonicalRoot, relativePath)))
    const packaged = Buffer.from(await readFile(join(packagedRoot, relativePath)))
    if (!canonical.equals(packaged)) {
      throw new Error(`Package-contained Resource DSL bytes differ: ${relativePath}`)
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
  required.push("package/dist/system-skills/resource-dsl/manifest.xnl")
  for (const entry of required) {
    if (!entries.includes(entry)) throw new Error(`Required tarball entry is missing: ${entry}`)
  }
}

async function verifyConsumer(tarball: string, consumerRoot: string): Promise<void> {
  await mkdir(consumerRoot, { recursive: true })
  await writeResourceFixture(join(consumerRoot, "resources-base"), "demo.package.base", "base")
  await writeResourceFixture(join(consumerRoot, "resources-override"), "demo.package.override", "override")
  await writeMaterialFixture(join(consumerRoot, "resource-material"))
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
    "  for (const privateName of ['resolveInternalObjectOperationBinding', 'resolveObjectOperationCompilation', 'InternalObjectOperationBinding', 'ObjectOperationBinding', 'ObjectOperationCompilation', 'BusinessMutationResource', 'CodePackageLoadError', 'loadCodePackageModule', 'admitCodePackageExports']) {",
    "    if (privateName in module) throw new Error(`Private object binding export ${privateName} leaked from ${specifier}`)",
    "  }",
    "}",
    "",
    'const rootModule = await import("halfcode-compiler.xnl")',
    'const resourceCore = await import("halfcode-compiler.xnl/resource-core")',
    'const kindDefinition = await import("halfcode-compiler.xnl/kind-definition")',
    'const authoringRuntime = await import("halfcode-compiler.xnl/authoring-runtime")',
    'const assembly = await import("halfcode-compiler.xnl/application-assembly")',
    'const environment = { hostIdentity: "packed-consumer/v1", ambient: {} }',
    'const files = { "/recipe/main.ts": "export const compose = (runtime, input, config) => runtime.format(input + config.suffix)" }',
    'const artifact = await assembly.captureCodeClosure({ source: {',
    '  stat: (path) => files[path] === undefined ? undefined : { kind: "file" },',
    '  readDirectory: () => [],',
    '  readBytes: (path) => files[path] === undefined ? undefined : new TextEncoder().encode(files[path]),',
    '} }, {',
    '  binding: { packageName: "recipe", module: "./main.ts", exportName: "compose", moduleSpecifier: "recipe/main.ts" },',
    '  sourceRoot: "/recipe", entryPath: "/recipe/main.ts", environment,',
    '})',
    'delete files["/recipe/main.ts"]',
    'assembly.validateCodeClosure(artifact, environment, artifact.digest)',
    'const compose = authoringRuntime.bindCodeClosure({ environment }, artifact, artifact.digest)',
    'if (compose({ format: (text) => `[${text}]` }, "context", { suffix: "-fact" }) !== "[context-fact]") throw new Error("Packed frozen closure execution failed")',
    'for (const name of [',
    '  "resolveApplicationAssembly",',
    '  "compileSkillCapsule",',
    '  "compileResourceSkillCapsule",',
    '  "planSkillCapsuleDistribution",',
    '  "skillCapsuleDistributionProjection",',
    '  "applySkillCapsuleDistributionPlan",',
    '  "loadResourceTree",',
    '  "loadResourceTreeFromReadPort",',
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
    '  "loadResourceTreeFromReadPort",',
    '  "validateResourceTreeFromReadPort",',
    '  "composeLayeredResourceRegistry",',
    '  "createResourceContentIdentity",',
    '  "buildResourceDependencySnapshot",',
    '  "resolveEffectiveResourceContentIdentities",',
    '  "sha256Digest",',
    '  "readResourceMaterial",',
    '  "digestCanonical",',
    "]) {",
    "  if (typeof resourceCore[name] !== \"function\") throw new Error(`Missing resource-core runtime export ${name}`)",
    "}",
    'if (resourceCore.RESOURCE_ENVELOPE_FINGERPRINT !== resourceCore.digestCanonical(resourceCore.RESOURCE_ENVELOPE_CONTRACT)) {',
    '  throw new Error("Resource envelope fingerprint does not match the canonical public contract")',
    "}",
    'if (!Object.isFrozen(resourceCore.RESOURCE_ENVELOPE_CONTRACT) || !Object.isFrozen(resourceCore.RESOURCE_ENVELOPE_CONTRACT.authoredSpecProjection.fields)) {',
    '  throw new Error("Resource envelope contract is not deeply immutable")',
    "}",
    'if (rootModule.RESOURCE_ENVELOPE_FINGERPRINT !== resourceCore.RESOURCE_ENVELOPE_FINGERPRINT) {',
    '  throw new Error("Root and resource-core envelope authorities differ")',
    "}",
    'if (!Object.isFrozen(kindDefinition.CORE_KIND_SUBJECT_OWNERS) || kindDefinition.CORE_KIND_SUBJECT_OWNERS.length !== 2) {',
    '  throw new Error("Compiler-owned core Kind owners are not public immutable facts")',
    "}",
    'if (!Object.isFrozen(kindDefinition.CORE_KIND_SPEC_REVISIONS) || kindDefinition.CORE_KIND_SPEC_REVISIONS.length !== 2) {',
    '  throw new Error("Compiler-owned core Kind revisions are not public immutable facts")',
    "}",
    'if (!Object.isFrozen(kindDefinition.CORE_KIND_READER_REGISTRATIONS) || kindDefinition.CORE_KIND_READER_REGISTRATIONS.length !== 2) {',
    '  throw new Error("Compiler-owned core Kind readers are not public immutable registrations")',
    "}",
    'if (JSON.stringify(rootModule.CORE_KIND_SPEC_REVISIONS) !== JSON.stringify(kindDefinition.CORE_KIND_SPEC_REVISIONS)) {',
    '  throw new Error("Root and kind-definition core Kind authorities differ")',
    "}",
    "for (const name of [",
    '  "planResourceAuthoring",',
    '  "applyResourceAuthoring",',
    '  "deriveResourceAuthoringRegistryRevision",',
    "]) {",
    '  if (typeof authoringRuntime[name] !== "function") throw new Error(`Missing authoring-runtime export ${name}`)',
    "}",
    'if (authoringRuntime.RESOURCE_AUTHORING_SCHEMA_VERSION !== "halfcode.resource-authoring/v1") {',
    '  throw new Error("Resource authoring schema identity changed")',
    "}",
    "",
    "let authoredLoaderError",
    "try {",
    '  await resourceCore.loadResourceTree({ rootDir: process.cwd(), manifestPath: "unsupported.xml" })',
    "} catch (error) {",
    "  authoredLoaderError = error",
    "}",
    "if (!(authoredLoaderError instanceof resourceCore.ResourceValidationError)) {",
    '  throw new Error("Authored loadResourceTree surface is not callable")',
    "}",
    'if (authoredLoaderError.diagnostics[0]?.code !== "RESOURCE_AUTHORITY_FORMAT_UNSUPPORTED") {',
    '  throw new Error("Authored loadResourceTree diagnostic contract changed")',
    "}",
    "",
    "const resourceNode = (kind, resourceId, value) => Object.freeze({",
    "  tag: kind,",
    "  resourceId,",
    '  metadata: Object.freeze({ envelopeVersion: "halfcode.resource-envelope/v1", specVersion: 1 }),',
    "  properties: Object.freeze({ value }),",
    "  body: Object.freeze([]),",
    "  subdomains: Object.freeze({}),",
    "})",
    "const resourceRecord = (resourceId, kind, value) => Object.freeze({",
    "  resourceId,",
    "  kind,",
    "  fqn: resourceId,",
    '  metadata: Object.freeze({ envelopeVersion: "halfcode.resource-envelope/v1", specVersion: 1 }),',
    '  sourceShape: "single-file",',
    '  logicalPath: `${resourceId}.xnl`,',
    '  documentUri: `vfs://@/${resourceId}.xnl`,',
    '  format: "xnl",',
    "  node: resourceNode(kind, resourceId, value),",
    "})",
    "const authoredTreeFixture = (packageId, value) => {",
    '  const resource = resourceRecord("demo.note.root", "Note", value)',
    "  return Object.freeze({",
    '    manifest: resourceRecord(packageId, "ResourcePackage", packageId),',
    '    registry: Object.freeze({ byKind: new Map([["Note", [resource]]]), kindDefinitions: new Map() }),',
    "    diagnostics: Object.freeze([]),",
    "  })",
    "}",
    "const registry = resourceCore.composeLayeredResourceRegistry({",
    "  layers: [",
    '    { id: "base", tree: authoredTreeFixture("demo.package.base", "base") },',
    '    { id: "override", tree: authoredTreeFixture("demo.package.override", "override") },',
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
    'if (baseTree.contentIdentities.size !== 2 || overrideTree.contentIdentities.size !== 2) {',
    '  throw new Error("Real loader content identity coverage changed")',
    "}",
    'if (baseTree.stage !== "authored" || overrideTree.stage !== "authored") {',
    '  throw new Error("Resource loader did not return authored trees")',
    "}",
    'if (baseTree.registry.byKind.get("Note")?.[0]?.node.text !== "Installed Markdown body.\\r\\n") {',
    '  throw new Error("Installed Markdown loader did not preserve canonical body text")',
    "}",
    "const authoredLayers = [",
    '  { id: "base", tree: baseTree },',
    '  { id: "override", tree: overrideTree },',
    "]",
    "const authoredRegistry = resourceCore.composeLayeredResourceRegistry({ layers: authoredLayers })",
    "const authoredIdentities = resourceCore.resolveEffectiveResourceContentIdentities({",
    "  registry: authoredRegistry,",
    "  layers: authoredLayers,",
    "  contributions: new Map([[",
    '    "demo.note.root",',
    '    [{ key: "instruction", digest: resourceCore.sha256Digest("installed-consumer") }],',
    "  ]]),",
    "})",
    'if (authoredIdentities.get("demo.note.root")?.authorityDigest !== overrideTree.contentIdentities.get("demo.note.root")?.authorityDigest) {',
    '  throw new Error("Effective content identity did not select the exact loaded override")',
    "}",
    "const authoredSnapshot = resourceCore.buildResourceDependencySnapshot({",
    "  registry: authoredRegistry,",
    '  roots: ["demo.note.root"],',
    "  edges: [],",
    "  contentIdentities: authoredIdentities,",
    "})",
    'if (authoredSnapshot.closure[0]?.origin.packageId !== "demo.package.override") {',
    '  throw new Error("Real loader snapshot did not preserve effective package origin")',
    "}",
    'if (!authoredSnapshot.snapshotRevision.startsWith("sha256:")) throw new Error("Authored loader snapshot revision is missing")',
    "",
    'const materialRoot = join(process.cwd(), "resource-material")',
    "const materialTree = await resourceCore.loadResourceTree({ rootDir: materialRoot })",
    "const material = await resourceCore.readResourceMaterial({ tree: materialTree, rootDir: materialRoot, resourceId: \"demo.procedure.installed\", uri: \"vfs://./Notes.txt\" })",
    'if (new TextDecoder().decode(material.bytes()) !== "Installed material.\\n" || !material.digest.startsWith("sha256:")) {',
    '  throw new Error("Installed directory ResourceMaterial API is unavailable")',
    "}",
    "",
    "const bundledSkillPlan = await rootModule.loadHalfcodeResourceDslSystemSkillPlan()",
    "const bundledSkillModule = rootModule.loadHalfcodeResourceDslSystemSkillModule()",
    'if (!Object.isFrozen(bundledSkillModule) || bundledSkillModule === rootModule.loadHalfcodeResourceDslSystemSkillModule()) {',
    '  throw new Error("Package-contained Resource DSL module must be an immutable fresh descriptor")',
    "}",
    'if (bundledSkillModule.id !== "ResourceDsl" || bundledSkillModule.packageName !== "halfcode-resource-dsl-system-skill") {',
    '  throw new Error("Package-contained Resource DSL module identity changed")',
    "}",
    'const packagedManifest = await readFile(join(bundledSkillModule.resourceRootDir, "manifest.xnl"), "utf8")',
    'if (!packagedManifest.includes("Halfcode.ResourceDsl.Package")) throw new Error("Package-contained Resource DSL manifest is missing")',
    "const packagedAssembly = await rootModule.resolveApplicationAssembly({ modules: [bundledSkillModule], portBindings: [] })",
    "const replannedSkill = await rootModule.planSkillCapsuleDistribution({",
    "  assembly: packagedAssembly,",
    '  rootSkillFqns: ["Halfcode.ResourceDsl.Skill.System"],',
    "})",
    "if (JSON.stringify(rootModule.skillCapsuleDistributionProjection(replannedSkill)) !== JSON.stringify(rootModule.skillCapsuleDistributionProjection(bundledSkillPlan))) {",
    '  throw new Error("Package-contained Resource DSL module and bundled plan projections differ")',
    "}",
    'if ("halfcodeResourceDslSystemSkillIdentity" in rootModule) {',
    '  throw new Error("Bundled Resource DSL Skill identity must be derived from the generated plan")',
    "}",
    'if (JSON.stringify(bundledSkillPlan.roots) !== JSON.stringify([{ fqn: "Halfcode.ResourceDsl.Skill.System", name: "sys-halfcode-resource-dsl", envelopeVersion: "halfcode.resource-envelope/v1", specVersion: 1, version: "1.0.0" }])) {',
    '  throw new Error("Bundled Resource DSL Skill identity changed")',
    "}",
    'if (bundledSkillPlan.closureDigest !== "sha256:bd271b519f14bae31fddd6a2feff16620635b5a2f6818913bd6b370a1971509b") {',
    '  throw new Error("Bundled Resource DSL Skill closure identity changed")',
    "}",
    'const bundledOutputRoot = join(process.cwd(), "installed-system-skills")',
    "await rootModule.applySkillCapsuleDistributionPlan(bundledSkillPlan, { outputRoot: bundledOutputRoot })",
    'const bundledProvenance = JSON.parse(await readFile(join(bundledOutputRoot, "sys-halfcode-resource-dsl/references/.halfcode/provenance.json"), "utf8"))',
    'if (bundledProvenance.source?.fqn !== "Halfcode.ResourceDsl.Skill.System" || bundledProvenance.source?.envelopeVersion !== "halfcode.resource-envelope/v1" || bundledProvenance.source?.specVersion !== 1 || bundledProvenance.source?.version !== "1.0.0") {',
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
    "  AuthoringModuleDescriptor,",
    "  CompileResourceSkillCapsuleInput as RootCompileResourceSkillCapsuleInput,",
    "  CompileSkillCapsuleInput as RootCompileSkillCapsuleInput,",
    "  PageObjectResource,",
    "  AuthoredResourceTree as RootAuthoredResourceTree,",
    "  AuthoredResourceTreeBuildResult as RootAuthoredResourceTreeBuildResult,",
    "  PlanSkillCapsuleDistributionInput as RootPlanSkillCapsuleDistributionInput,",
    "  PlannedSkillFile as RootPlannedSkillFile,",
    "  SkillCapsuleDependency as RootSkillCapsuleDependency,",
    "  SkillCapsuleProvenanceManifest as RootSkillCapsuleProvenanceManifest,",
    "  SkillCapsuleDistributionPlan as RootSkillCapsuleDistributionPlan,",
    "  SkillCapsuleDistributionReceipt as RootSkillCapsuleDistributionReceipt,",
    "  SkillCapsulePlan as RootSkillCapsulePlan,",
    "  ResourceLayerContentIdentityInput as RootResourceLayerContentIdentityInput,",
    "  ResolveEffectiveResourceContentIdentitiesInput as RootResolveEffectiveResourceContentIdentitiesInput,",
    "  ResolvedResourceTree as RootResolvedResourceTree,",
    '} from "halfcode-compiler.xnl"',
    'import { CORE_KIND_SPEC_REVISIONS as RootCoreKindSpecRevisions, RESOURCE_ENVELOPE_CONTRACT as RootResourceEnvelopeContract, RESOURCE_ENVELOPE_FINGERPRINT as RootResourceEnvelopeFingerprint, loadHalfcodeResourceDslSystemSkillModule } from "halfcode-compiler.xnl"',
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
    "  loadResourceTreeFromReadPort,",
    "  validateResourceTreeFromReadPort,",
    "  readResourceMaterial,",
    "  resolveEffectiveResourceContentIdentities,",
    "  sha256Digest,",
    "  RESOURCE_ENVELOPE_CONTRACT,",
    "  RESOURCE_ENVELOPE_FINGERPRINT,",
    "  type EffectiveResourceRegistry,",
    "  type AuthoredResourceTree,",
    "  type AuthoredResourceTreeBuildResult,",
    "  type ResourceMaterial,",
    "  type ResourcePackageEntry,",
    "  type ResourcePackageReadPort,",
    "  type ResourcePackageReadPortOptions,",
    "  type ResourceDependencyEdge,",
    "  type ResourceDependencySnapshot,",
    "  type ResourceLayerInput,",
    "  type ResourceLayerContentIdentityInput,",
    "  type ResolveEffectiveResourceContentIdentitiesInput,",
    "  type ResolvedResourceTree,",
    '} from "halfcode-compiler.xnl/resource-core"',
    'import { CORE_KIND_READER_REGISTRATIONS, CORE_KIND_SPEC_REVISIONS, CORE_KIND_SUBJECT_OWNERS, type KindContractLockReader } from "halfcode-compiler.xnl/kind-definition"',
    "import {",
    "  RESOURCE_AUTHORING_SCHEMA_VERSION,",
    "  applyResourceAuthoring,",
    "  deriveResourceAuthoringRegistryRevision,",
    "  planResourceAuthoring,",
    "  type ApplyResourceAuthoringConfig,",
    "  type ResourceAuthoringPlan,",
    "  type ResourceAuthoringProposal,",
    "  type ResourceAuthoringReceipt,",
    "  type ResourceAuthoringRuntime,",
    "  type ResourceAuthoringTransactionPort,",
    '} from "halfcode-compiler.xnl/authoring-runtime"',
    "// @ts-expect-error removed CodePackage runtime is not public",
    'import { loadCodePackageModule } from "halfcode-compiler.xnl/resource-core"',
    "",
    `void [${publicSpecifiers.map((_, index) => `entry${index}`).join(", ")}]`,
    "const pageObject = null as PageObjectResource | null",
    "void pageObject",
    'const envelopeFingerprint: `sha256:${string}` = RESOURCE_ENVELOPE_FINGERPRINT',
    'const rootEnvelopeFingerprint: typeof RESOURCE_ENVELOPE_FINGERPRINT = RootResourceEnvelopeFingerprint',
    'const rootEnvelopeContract: typeof RESOURCE_ENVELOPE_CONTRACT = RootResourceEnvelopeContract',
    'const rootCoreKindRevisions: typeof CORE_KIND_SPEC_REVISIONS = RootCoreKindSpecRevisions',
    'declare const lockReader: KindContractLockReader',
    'void [envelopeFingerprint, rootEnvelopeFingerprint, rootEnvelopeContract, CORE_KIND_SUBJECT_OWNERS, CORE_KIND_READER_REGISTRATIONS, rootCoreKindRevisions, lockReader]',
    'const authoringSchema: "halfcode.resource-authoring/v1" = RESOURCE_AUTHORING_SCHEMA_VERSION',
    "declare const authoringTypes: readonly [",
    "  ApplyResourceAuthoringConfig,",
    "  ResourceAuthoringPlan,",
    "  ResourceAuthoringProposal,",
    "  ResourceAuthoringReceipt,",
    "  ResourceAuthoringRuntime,",
    "  ResourceAuthoringTransactionPort,",
    "]",
    "void [authoringSchema, authoringTypes, planResourceAuthoring, applyResourceAuthoring, deriveResourceAuthoringRegistryRevision]",
    "const dependency: SkillCapsuleDependency = {",
    '  ref: "resource://example.skill.authoring",',
    '  fqn: "example.skill.authoring",',
    '  version: "1.0.0",',
    "}",
    "const rootDependency: RootSkillCapsuleDependency = dependency",
    "const plannedFile: PlannedSkillFile = {",
    '  skillFqn: "example.skill.authoring",',
    '  skillEnvelopeVersion: "halfcode.resource-envelope/v1",',
    "  skillSpecVersion: 1,",
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
    '  source: { fqn: "example.skill.authoring", envelopeVersion: "halfcode.resource-envelope/v1", specVersion: 1, version: "1.0.0" },',
    "  payloadFiles: [],",
    "}",
    "const rootProvenance: RootSkillCapsuleProvenanceManifest = provenance",
    'type RootProvenanceDigest = RootSkillCapsuleProvenanceManifest["payloadFiles"][number]["contentDigest"]',
    'const rootProvenanceDigest: `sha256:${string}` = null as unknown as RootProvenanceDigest',
    "void rootProvenanceDigest",
    "const resourceDslModule: AuthoringModuleDescriptor = loadHalfcodeResourceDslSystemSkillModule()",
    "void resourceDslModule",
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
    "  AuthoringModuleDescriptor,",
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
    "declare const authoredTree: AuthoredResourceTree",
    "const authoredBuildResult: AuthoredResourceTreeBuildResult = { diagnostics: [], tree: authoredTree }",
    "const rootAuthoredBuildResult: RootAuthoredResourceTreeBuildResult = authoredBuildResult",
    "const rootAuthoredTree: RootAuthoredResourceTree = authoredTree",
    "declare const resolvedTree: ResolvedResourceTree",
    "const rootResolvedTree: RootResolvedResourceTree = resolvedTree",
    'const layers: readonly ResourceLayerInput[] = [{ id: "base", tree: authoredTree }]',
    "const registry: EffectiveResourceRegistry = composeLayeredResourceRegistry({ layers })",
    "const identity = createResourceContentIdentity({",
    "  resourceId: authoredTree.manifest.resourceId,",
    '  authorityDigest: sha256Digest("authority"),',
    "})",
    "const edges: readonly ResourceDependencyEdge[] = []",
    "const snapshot: ResourceDependencySnapshot = buildResourceDependencySnapshot({",
    "  registry,",
    "  roots: [identity.resourceId],",
    "  edges,",
    "  contentIdentities: new Map([[identity.resourceId, identity]]),",
    "})",
    "const authoredLoad: ReturnType<typeof loadResourceTree> = loadResourceTree({ rootDir: \".\" })",
    "const readPort: ResourcePackageReadPort = {",
    "  stat: (_sourcePath: string): ResourcePackageEntry | undefined => undefined,",
    "  readDirectory: (_sourcePath: string) => undefined,",
    "  readBytes: (_sourcePath: string) => undefined,",
    "}",
    "const readPortOptions: ResourcePackageReadPortOptions = { port: readPort, rootPath: \"/package\" }",
    "const portLoad: ReturnType<typeof loadResourceTreeFromReadPort> = loadResourceTreeFromReadPort(readPortOptions)",
    "const portDiagnostics: ReturnType<typeof validateResourceTreeFromReadPort> = validateResourceTreeFromReadPort(readPortOptions)",
    "declare const resourceMaterial: ResourceMaterial",
    "const materialPromise: Promise<ResourceMaterial> = readResourceMaterial({ tree: authoredTree, rootDir: \".\", resourceId: \"demo.procedure\", uri: \"vfs://./Notes.txt\" })",
    "void resourceMaterial",
    'const contentLayers: readonly ResourceLayerContentIdentityInput[] = [{ id: "base", tree: authoredTree }]',
    "declare const authoredRegistry: EffectiveResourceRegistry",
    "const projectorInput: ResolveEffectiveResourceContentIdentitiesInput = {",
    "  registry: authoredRegistry,",
    "  layers: contentLayers,",
    "}",
    "const projectedIdentities = resolveEffectiveResourceContentIdentities(projectorInput)",
    "const rootContentLayers: readonly RootResourceLayerContentIdentityInput[] = contentLayers",
    "const rootProjectorInput: RootResolveEffectiveResourceContentIdentitiesInput = projectorInput",
    "void [snapshot, authoredLoad, portLoad, portDiagnostics, authoredBuildResult, rootAuthoredBuildResult, rootAuthoredTree, resolvedTree, rootResolvedTree, projectedIdentities, rootContentLayers, rootProjectorInput, materialPromise]",
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
    `<ResourcePackage #${packageId} envelopeVersion="halfcode.resource-envelope/v1" specVersion=1 { lifecycle = "Active" } (`,
    "  <Catalogs [",
    '    <Catalog #kind_definitions { kind = "KindDefinition" shape = "directory" root = "vfs://./KindDefinitions/" entry = "manifest.xnl" }>',
    '    <Catalog #notes { kind = "Note" shape = "single-file" root = "vfs://./Notes/" }>',
    "  ]>",
    ")>",
    "",
  ].join("\n"))
  await writeFile(join(root, "KindDefinitions/Note/manifest.xnl"), kindDefinitionFixture("Note", "single-file"))
  await writeFile(join(root, "Notes/Root.md"), [
    "---",
    "envelopeVersion: halfcode.resource-envelope/v1",
    "specVersion: 1",
    "kind: Note",
    "metadata:",
    "  fqn: demo.note.root",
    "spec:",
    `  value: ${JSON.stringify(value)}`,
    "---",
  ].join("\r\n") + "\r\nInstalled Markdown body.\r\n")
}

async function writeMaterialFixture(root: string): Promise<void> {
  await mkdir(join(root, "KindDefinitions/Procedure"), { recursive: true })
  await mkdir(join(root, "Procedures/Installed"), { recursive: true })
  await writeFile(join(root, "manifest.xnl"), [
    '<ResourcePackage #demo.materials envelopeVersion="halfcode.resource-envelope/v1" specVersion=1 (',
    "  <Catalogs [",
    '    <Catalog #kind_definitions { kind = "KindDefinition" shape = "directory" root = "vfs://./KindDefinitions/" entry = "manifest.xnl" }>',
    '    <Catalog #procedures { kind = "Procedure" shape = "directory" root = "vfs://./Procedures/" entry = "manifest.xnl" }>',
    "  ]>",
    ")>",
    "",
  ].join("\n"))
  await writeFile(join(root, "KindDefinitions/Procedure/manifest.xnl"), kindDefinitionFixture("Procedure", "directory"))
  await writeFile(join(root, "Procedures/Installed/manifest.xnl"), '<Procedure #demo.procedure.installed envelopeVersion="halfcode.resource-envelope/v1" specVersion=1>\n')
  await writeFile(join(root, "Procedures/Installed/Notes.txt"), "Installed material.\n")
}

function kindDefinitionFixture(resourceKind: string, sourceShape: "single-file" | "directory"): string {
  const owner = createKindSubjectOwner({
    kind: resourceKind,
    subjectFqn: `Halfcode.ResourceKind.${resourceKind}`,
    ownerPackageId: "halfcode-compiler.xnl-distribution-smoke",
    ownerPackageFingerprint: digestCanonical({ authority: "distribution-smoke", resourceKind }),
    sourceShapes: [sourceShape],
  })
  const revision = createKindSpecRevision({
    kind: resourceKind,
    subjectFqn: `Halfcode.ResourceKind.${resourceKind}`,
    specVersion: 1,
    specSchema: { type: "object" },
    semanticContract: Object.freeze({
      semanticValidatorFingerprint: digestCanonical({ resourceKind, role: "fixture-semantic-validator" }),
      referenceProjectionFingerprint: digestCanonical({ resourceKind, role: "fixture-reference-projection" }),
      compilerInputFingerprint: digestCanonical({ resourceKind, role: "fixture-compiler-input" }),
    }),
    sourceContractFingerprint: owner.sourceContract.sourceContractFingerprint,
    stability: "stable",
  })
  return [
    `<KindDefinition #halfcode.resource_kind.${resourceKind} envelopeVersion="halfcode.resource-envelope/v1" specVersion=1 {`,
    '  lifecycle = "Stable"',
    `  resourceKind = "${resourceKind}"`,
    `  subjectFqn = "Halfcode.ResourceKind.${resourceKind}"`,
    `  sourceShapes = ["${sourceShape}"]`,
    '} (',
    '  <SpecRevisions [',
    '    <SpecRevision #v1 {',
    '      specVersion = 1',
    '      schemaRef = "vfs://./spec-v1.schema.json"',
    `      schemaFingerprint = "${revision.schemaFingerprint}"`,
    `      contractFingerprint = "${revision.contractFingerprint}"`,
    `      semanticValidatorFingerprint = "${revision.semanticContract.semanticValidatorFingerprint}"`,
    `      referenceProjectionFingerprint = "${revision.semanticContract.referenceProjectionFingerprint}"`,
    `      compilerInputFingerprint = "${revision.semanticContract.compilerInputFingerprint}"`,
    '      stability = "stable"',
    '    }>',
    '  ]>',
    ')>',
    '',
  ].join("\n")
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

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
