import { createHash, randomUUID } from "node:crypto"
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises"
import { basename, dirname, join, posix, resolve } from "node:path"
import type {
  ApplicationAssembly,
  BusinessObjectResource,
  ContractedCallableResource,
  ObjectOperationDefinition,
  PageObjectResource,
  SkillCapsuleResource,
  TextResource,
} from "halfcode-compiler-application-assembly"
import { resourceRefToFqn } from "halfcode-compiler-application-assembly"
import { resolveObjectOperationCompilation } from "halfcode-compiler-application-assembly/compiler-internal"
import type { ResourceRegistry } from "halfcode-compiler-resource-projection"
import {
  parseResourceMappings,
  planResourceMappings,
  ResourceMappingPathError,
  safePathLexicalIssue,
  type ResourceMappingPlan,
  type ResourceMappings,
  unsafeUnicodeCodeUnitIssue,
} from "halfcode-compiler-resource-mapping"

export interface SkillDescriptor {
  name: string
  description: string
  instructions?: string
}

export interface SkillReference {
  path: string
  content: string
}

export interface CompileSkillCapsuleInput {
  skill: SkillDescriptor
  registry?: ResourceRegistry
  references?: readonly SkillReference[]
  outputDir: string
}

export interface SkillCapsulePlan {
  skillName: string
  outputRoot: string
  files: readonly string[]
}

export interface CompileResourceSkillCapsuleInput {
  assembly: ApplicationAssembly
  skillFqn: string
  outputDir: string
  schemas?: ReadonlyMap<string, unknown> | Record<string, unknown>
}

export interface SkillCapsuleIdentity {
  readonly fqn: string
  readonly name: string
  readonly apiVersion: string
  readonly version: string
}

export type SkillCapsuleContentDigest = `sha256:${string}`

export interface SkillCapsuleProvenanceManifest {
  readonly format: "halfcode.skill-provenance/v1"
  readonly generatedBy: "halfcode.skill-distribution/v1"
  readonly source: {
    readonly fqn: string
    readonly apiVersion: string
    readonly version: string
  }
  readonly payloadFiles: readonly {
    readonly path: string
    readonly contentDigest: SkillCapsuleContentDigest
  }[]
}

export interface PlannedSkillFile {
  readonly skillFqn: string
  readonly skillApiVersion: string
  readonly skillVersion: string
  readonly capsuleRelativePath: string
  readonly targetRelativePath: string
  /** Canonical, serializable content authority. */
  readonly contentBase64: string
  /** Compatibility byte snapshot. Every read returns a defensive copy. */
  readonly content: Uint8Array
  readonly contentDigest: SkillCapsuleContentDigest
}

export interface PlannedSkillCapsule {
  readonly identity: SkillCapsuleIdentity
  readonly dependencies: readonly SkillCapsuleIdentity[]
  readonly files: readonly PlannedSkillFile[]
  readonly capsuleDigest: string
}

export interface SkillCapsuleDistributionPlan {
  readonly format: "halfcode.skill-distribution/v1"
  readonly roots: readonly SkillCapsuleIdentity[]
  readonly topology: readonly string[]
  readonly capsules: readonly PlannedSkillCapsule[]
  readonly files: readonly PlannedSkillFile[]
  readonly closureDigest: string
}

export interface PlanSkillCapsuleDistributionInput {
  readonly assembly: ApplicationAssembly
  readonly rootSkillFqns: readonly string[]
  readonly schemas?: ReadonlyMap<string, unknown> | Record<string, unknown>
}

export type SkillCapsuleApplyStep = "after-stage" | "after-readback" | "after-backup" | "before-live-rename"

export interface ApplySkillCapsuleDistributionOptions {
  readonly outputRoot: string
  readonly onStep?: (step: SkillCapsuleApplyStep) => void | Promise<void>
}

export interface SkillCapsuleDistributionReceipt {
  readonly outputRoot: string
  readonly closureDigest: string
  readonly installedSkills: readonly SkillCapsuleIdentity[]
  readonly files: readonly string[]
}

export class SkillCapsuleDistributionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`)
    this.name = "SkillCapsuleDistributionError"
  }
}

const SKILL_PROVENANCE_PATH = "references/.halfcode/provenance.json"

interface AtomicFile {
  readonly targetRelativePath: string
  readonly content: Uint8Array
  readonly contentDigest: SkillCapsuleContentDigest
}

interface TargetClaim {
  readonly targetRelativePath: string
  readonly owner: string
}

type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue }

export async function compileSkillCapsule(
  input: CompileSkillCapsuleInput,
): Promise<SkillCapsulePlan> {
  validateSkillDescriptor(input.skill)
  const references = input.references ?? []
  for (const reference of references) {
    validateReferencePath(reference.path)
  }

  const skillText = renderSkill(input.skill, input.registry, references)
  const plannedFiles = [
    atomicTextFile("SKILL.md", skillText),
    ...references.map((reference) => atomicTextFile(`references/${reference.path}`, reference.content)),
  ]
  assertNoTargetCollisions(plannedFiles.map((file) => ({
    targetRelativePath: file.targetRelativePath,
    owner: file.targetRelativePath === "SKILL.md"
      ? "generated:skill"
      : `reference:${file.targetRelativePath.slice("references/".length)}`,
  })), "SKILL_TARGET_COLLISION")
  await applyAtomicFiles(plannedFiles, input.outputDir, undefined, ["references"])

  return {
    skillName: input.skill.name,
    outputRoot: input.outputDir,
    files: plannedFiles.map((file) => file.targetRelativePath),
  }
}

export async function compileResourceSkillCapsule(
  input: CompileResourceSkillCapsuleInput,
): Promise<SkillCapsulePlan> {
  const plan = await planSkillCapsuleDistribution({
    assembly: input.assembly,
    rootSkillFqns: [input.skillFqn],
    schemas: input.schemas,
  })
  const capsule = plan.capsules.find((item) => item.identity.fqn === input.skillFqn)
  if (!capsule) failDistribution("SKILL_ROOT_MISSING", `SkillCapsule not found: ${input.skillFqn}`)
  const files = capsule.files.map((file) => ({
    targetRelativePath: file.capsuleRelativePath,
    content: plannedFileBytes(file),
    contentDigest: file.contentDigest,
  }))
  await applyAtomicFiles(files, input.outputDir)
  return {
    skillName: capsule.identity.name,
    outputRoot: input.outputDir,
    files: files.map((file) => file.targetRelativePath).sort(compareStrings),
  }
}

export async function planSkillCapsuleDistribution(
  input: PlanSkillCapsuleDistributionInput,
): Promise<SkillCapsuleDistributionPlan> {
  const graph = resolveSkillClosure(input.assembly, input.rootSkillFqns)
  const identities = new Map(graph.topology.map((fqn) => {
    const skill = graph.skills.get(fqn)!
    return [fqn, skillIdentity(skill)]
  }))
  const outputNames = new Map<string, string>()
  for (const identity of identities.values()) {
    validateSkillOutputName(identity.name)
    const prior = outputNames.get(identity.name)
    if (prior) {
      failDistribution(
        "SKILL_OUTPUT_NAME_DUPLICATE",
        `SkillCapsules ${prior} and ${identity.fqn} both claim output name ${identity.name}`,
      )
    }
    outputNames.set(identity.name, identity.fqn)
  }

  const capsules: PlannedSkillCapsule[] = []
  for (const fqn of graph.topology) {
    const skill = graph.skills.get(fqn)!
    const identity = identities.get(fqn)!
    const materialized = await planResourceSkillCapsuleFiles(input.assembly, skill, identity, input.schemas)
    const dependencies = skill.dependencies
      .map((dependency) => identities.get(dependency.fqn)!)
      .sort((left, right) => compareStrings(left.fqn, right.fqn))
    const files = materialized.files.map((file) => {
      const targetRelativePath = posix.join(identity.name, file.targetRelativePath)
      return plannedSkillFile({
        skillFqn: identity.fqn,
        skillApiVersion: identity.apiVersion,
        skillVersion: identity.version,
        capsuleRelativePath: file.targetRelativePath,
        targetRelativePath,
      }, file)
    }).sort((left, right) => compareStrings(left.targetRelativePath, right.targetRelativePath))
    const capsuleDigest = digestJson({
      format: "halfcode.skill-capsule/v1",
      identity,
      dependencies,
      files: files.map(fileDigestProjection),
    })
    capsules.push(Object.freeze({
      identity,
      dependencies: Object.freeze(dependencies),
      files: Object.freeze(files),
      capsuleDigest,
    }))
  }
  const files = capsules.flatMap((capsule) => capsule.files)
    .sort((left, right) => compareStrings(left.targetRelativePath, right.targetRelativePath))
  assertNoTargetCollisions(files.map((file) => ({
    targetRelativePath: file.targetRelativePath,
    owner: `skill:${file.skillFqn}`,
  })), "SKILL_CLOSURE_TARGET_COLLISION")
  const roots = [...new Set(input.rootSkillFqns)].sort(compareStrings)
    .map((fqn) => identities.get(fqn)!)
  const closureDigest = digestJson({
    format: "halfcode.skill-distribution/v1",
    roots,
    topology: graph.topology,
    capsules: capsules.map((capsule) => ({
      identity: capsule.identity,
      capsuleDigest: capsule.capsuleDigest,
    })),
  })
  return Object.freeze({
    format: "halfcode.skill-distribution/v1",
    roots: Object.freeze(roots),
    topology: Object.freeze([...graph.topology]),
    capsules: Object.freeze(capsules),
    files: Object.freeze(files),
    closureDigest,
  })
}

export function skillCapsuleDistributionProjection(plan: SkillCapsuleDistributionPlan) {
  return {
    format: plan.format,
    roots: plan.roots,
    topology: plan.topology,
    capsules: plan.capsules.map((capsule) => ({
      identity: capsule.identity,
      dependencies: capsule.dependencies,
      files: capsule.files.map((file) => ({
        ...fileDigestProjection(file),
        contentBase64: file.contentBase64,
      })),
      capsuleDigest: capsule.capsuleDigest,
    })),
    closureDigest: plan.closureDigest,
  }
}

export async function applySkillCapsuleDistributionPlan(
  plan: SkillCapsuleDistributionPlan,
  options: ApplySkillCapsuleDistributionOptions,
): Promise<SkillCapsuleDistributionReceipt> {
  assertValidDistributionPlan(plan)
  const files = plan.files.map((file) => ({
    targetRelativePath: file.targetRelativePath,
    content: plannedFileBytes(file),
    contentDigest: file.contentDigest,
  }))
  await applyAtomicFiles(files, options.outputRoot, options.onStep)
  return Object.freeze({
    outputRoot: options.outputRoot,
    closureDigest: plan.closureDigest,
    installedSkills: Object.freeze(plan.topology.map((fqn) =>
      plan.capsules.find((capsule) => capsule.identity.fqn === fqn)!.identity)),
    files: Object.freeze(plan.files.map((file) => file.targetRelativePath)),
  })
}

async function planResourceSkillCapsuleFiles(
  assembly: ApplicationAssembly,
  skill: SkillCapsuleResource,
  identity: SkillCapsuleIdentity,
  schemaInput: CompileResourceSkillCapsuleInput["schemas"],
): Promise<{ skillName: string; files: readonly AtomicFile[] }> {
  const schemas = schemaReader(schemaInput)
  const selection = selectSkillResources(assembly, skill)
  const mappings = parseSkillResourceMappings(skill)
  const callableResources = [
    ...selection.functions,
    ...selection.composedFunctions,
  ]
  assertCallableClosure(callableResources, schemas)
  assertObjectOperationArtifactClosure(selection, schemas)

  const generatedTargets = plannedGeneratedTargets(selection, callableResources, mappings)
  assertNoGeneratedTargetCollisions(generatedTargets)
  let resourceMappingPlan: ResourceMappingPlan
  try {
    resourceMappingPlan = await planResourceMappings(mappings, {
      moduleRoots: new Map(assembly.modules.map((module) => [module.id, module.resourceRootDir])),
      defaultSourceRoot: skill.source.directory,
      reservedTargetPaths: generatedTargets.map((claim) => claim.targetRelativePath),
    })
  } catch (error) {
    translateResourceMappingPathError(error)
  }

  const skillName = skillOutputName(skill)
  const skillText = renderEjsTemplate(skill.template.content, {
    skill,
    metadata: Object.freeze({ ...skill.metadata, name: skillName }),
    references: referenceModel(selection, mappings),
    renderPromptFragment: (fqn: string) => {
      const fragment = selection.promptFragments.find((item) => item.fqn === fqn)
      return fragment?.instruction?.content.trim() ?? ""
    },
  })
  const mappingFiles = await Promise.all(resourceMappingPlan.entries.map(async (entry) => {
    const content = new Uint8Array(await readFile(entry.sourcePath))
    return Object.freeze({
      targetRelativePath: entry.targetRelativePath,
      content,
      contentDigest: digestBytes(content),
    })
  }))
  const payloadFiles = [
    ...planReferenceFiles(selection, schemas, mappings),
    ...planCallableArtifacts(callableResources, schemas, mappings.callableArtifactsTarget),
    ...planObjectOperationArtifacts(selection, schemas),
    ...mappingFiles,
    atomicTextFile("SKILL.md", skillText.trimEnd() + "\n"),
  ].sort((left, right) => compareStrings(left.targetRelativePath, right.targetRelativePath))
  const files = [
    ...payloadFiles,
    atomicFile(SKILL_PROVENANCE_PATH, canonicalSkillProvenanceBytes(identity, payloadFiles)),
  ].sort((left, right) => compareStrings(left.targetRelativePath, right.targetRelativePath))
  assertNoTargetCollisions(files.map((file) => ({
    targetRelativePath: file.targetRelativePath,
    owner: `skill:${skill.fqn}`,
  })), "SKILL_TARGET_COLLISION")
  return { skillName, files: Object.freeze(files) }
}

function resolveSkillClosure(
  assembly: ApplicationAssembly,
  rootSkillFqns: readonly string[],
): { skills: ReadonlyMap<string, SkillCapsuleResource>; topology: readonly string[] } {
  if (rootSkillFqns.length === 0) failDistribution("SKILL_ROOTS_EMPTY", "at least one root SkillCapsule is required")
  const skills = new Map<string, SkillCapsuleResource>()
  const graph = new Map<string, readonly string[]>()

  const resolveSkill = (fqn: string, owner?: SkillCapsuleResource): SkillCapsuleResource => {
    const resource = assembly.byFqn.get(fqn)
    if (!resource) {
      failDistribution(
        owner ? "SKILL_DEPENDENCY_MISSING" : "SKILL_ROOT_MISSING",
        owner ? `${owner.fqn} dependency resource://${fqn} does not exist` : `SkillCapsule not found: ${fqn}`,
      )
    }
    if (resource.kind !== "SkillCapsule") {
      failDistribution(
        owner ? "SKILL_DEPENDENCY_KIND_MISMATCH" : "SKILL_ROOT_KIND_MISMATCH",
        `${owner?.fqn ?? fqn} references ${fqn}, which is ${resource.kind}`,
      )
    }
    return resource
  }

  const collect = (skill: SkillCapsuleResource): void => {
    if (skills.has(skill.fqn)) return
    skills.set(skill.fqn, skill)
    const dependencyFqns: string[] = []
    const seen = new Set<string>()
    for (const dependency of [...skill.dependencies].sort((left, right) => compareStrings(left.fqn, right.fqn))) {
      let refFqn: string
      try {
        refFqn = resourceRefToFqn(dependency.ref)
      } catch (error) {
        failDistribution("SKILL_DEPENDENCY_REF_INVALID", `${skill.fqn}: ${error instanceof Error ? error.message : String(error)}`)
      }
      if (refFqn !== dependency.fqn) {
        failDistribution(
          "SKILL_DEPENDENCY_REF_INVALID",
          `${skill.fqn} dependency ref ${dependency.ref} does not match projected FQN ${dependency.fqn}`,
        )
      }
      if (seen.has(dependency.fqn)) {
        failDistribution("SKILL_DEPENDENCY_DUPLICATE", `${skill.fqn} declares ${dependency.fqn} more than once`)
      }
      seen.add(dependency.fqn)
      const target = resolveSkill(dependency.fqn, skill)
      if (target.version !== dependency.version) {
        failDistribution(
          "SKILL_DEPENDENCY_VERSION_MISMATCH",
          `${skill.fqn} dependency ${dependency.ref} expected ${dependency.version} but found ${target.version}`,
        )
      }
      dependencyFqns.push(target.fqn)
      collect(target)
    }
    graph.set(skill.fqn, Object.freeze(dependencyFqns))
  }

  for (const fqn of [...new Set(rootSkillFqns)].sort(compareStrings)) collect(resolveSkill(fqn))
  assertAcyclicSkillGraph(graph)

  const indegree = new Map<string, number>()
  const dependents = new Map<string, string[]>()
  for (const [fqn, dependencies] of graph) {
    indegree.set(fqn, dependencies.length)
    for (const dependency of dependencies) {
      const values = dependents.get(dependency) ?? []
      values.push(fqn)
      dependents.set(dependency, values)
    }
  }
  const ready = [...indegree].filter(([, count]) => count === 0).map(([fqn]) => fqn).sort(compareStrings)
  const topology: string[] = []
  while (ready.length > 0) {
    const current = ready.shift()!
    topology.push(current)
    for (const dependent of [...(dependents.get(current) ?? [])].sort(compareStrings)) {
      const next = (indegree.get(dependent) ?? 0) - 1
      indegree.set(dependent, next)
      if (next === 0) {
        ready.push(dependent)
        ready.sort(compareStrings)
      }
    }
  }
  if (topology.length !== skills.size) failDistribution("SKILL_DEPENDENCY_CYCLE", "dependency graph contains a cycle")
  return { skills, topology: Object.freeze(topology) }
}

function assertAcyclicSkillGraph(graph: ReadonlyMap<string, readonly string[]>): void {
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const stack: string[] = []
  const visit = (fqn: string): void => {
    if (visited.has(fqn)) return
    if (visiting.has(fqn)) {
      const start = stack.indexOf(fqn)
      const cycle = canonicalCyclePath([...stack.slice(start), fqn])
      failDistribution("SKILL_DEPENDENCY_CYCLE", cycle.join(" -> "))
    }
    visiting.add(fqn)
    stack.push(fqn)
    for (const dependency of [...(graph.get(fqn) ?? [])].sort(compareStrings)) visit(dependency)
    stack.pop()
    visiting.delete(fqn)
    visited.add(fqn)
  }
  for (const fqn of [...graph.keys()].sort(compareStrings)) visit(fqn)
}

function canonicalCyclePath(path: readonly string[]): string[] {
  const nodes = path.slice(0, -1)
  if (nodes.length <= 1) return [nodes[0]!, nodes[0]!]
  const rotations = nodes.map((_, index) => [...nodes.slice(index), ...nodes.slice(0, index)])
  rotations.sort((left, right) => compareStrings(left.join("\u0000"), right.join("\u0000")))
  return [...rotations[0]!, rotations[0]![0]!]
}

function skillIdentity(skill: SkillCapsuleResource): SkillCapsuleIdentity {
  return Object.freeze({
    fqn: skill.fqn,
    name: skillOutputName(skill),
    apiVersion: skill.apiVersion,
    version: skill.version,
  })
}

function skillOutputName(skill: SkillCapsuleResource): string {
  if (skill.name !== undefined) {
    if (Object.prototype.hasOwnProperty.call(skill.metadata, "name")) {
      failDistribution(
        "SKILL_OUTPUT_NAME_INVALID",
        `Skill ${skill.fqn} name is owned by XNL and must not be repeated in YAML metadata`,
      )
    }
    const issue = safePathLexicalIssue(skill.name, "segment")
    if (issue) {
      failDistribution(
        "SKILL_OUTPUT_NAME_INVALID",
        `Skill ${skill.fqn} XNL name must be one safe path segment: ${JSON.stringify(skill.name)} (${issue})`,
      )
    }
    return skill.name
  }
  if (!Object.prototype.hasOwnProperty.call(skill.metadata, "name")) {
    return lastFqnSegment(skill.fqn)
  }
  const name = skill.metadata.name
  if (typeof name !== "string") {
    failDistribution(
      "SKILL_OUTPUT_NAME_INVALID",
      `Skill ${skill.fqn} present YAML name must be a string: ${JSON.stringify(name)}`,
    )
  }
  const issue = safePathLexicalIssue(name, "segment")
  if (issue) {
    failDistribution(
      "SKILL_OUTPUT_NAME_INVALID",
      `Skill ${skill.fqn} present YAML name must be one safe path segment: ${JSON.stringify(name)} (${issue})`,
    )
  }
  return name
}

function parseSkillResourceMappings(skill: SkillCapsuleResource): ResourceMappings {
  try {
    return parseResourceMappings(
      skill.resourceMappings?.content ?? "<ResourceMappings #default>",
      skill.resourceMappings?.absolutePath ?? `${skill.source.logicalPath}#ResourceMappings`,
    )
  } catch (error) {
    translateResourceMappingPathError(error)
  }
}

function translateResourceMappingPathError(error: unknown): never {
  if (error instanceof ResourceMappingPathError) {
    const role = error.attribute === "to" ? "target" : "source path"
    failDistribution(
      error.attribute === "to" ? "SKILL_PLAN_TARGET_INVALID" : "SKILL_RESOURCE_MAPPING_INVALID",
      `ResourceMappings owner ${error.owner} raw ${role} ${JSON.stringify(error.rawPath)} is unsafe: ${error.issue}`,
    )
  }
  throw error
}

function validateSkillOutputName(name: string): void {
  const issue = safePathLexicalIssue(name, "segment")
  if (issue) failDistribution(
    "SKILL_OUTPUT_NAME_INVALID",
    `Skill output name must be one safe path segment: ${JSON.stringify(name)} (${issue})`,
  )
}

function assertValidDistributionPlan(plan: SkillCapsuleDistributionPlan): void {
  if (plan.format !== "halfcode.skill-distribution/v1") {
    failDistribution("SKILL_PLAN_FORMAT_INVALID", `unsupported plan format ${String(plan.format)}`)
  }
  if (plan.roots.length === 0) {
    failDistribution("SKILL_PLAN_ROOTS_EMPTY", "at least one root SkillCapsule is required")
  }
  if (new Set(plan.roots.map((root) => root.fqn)).size !== plan.roots.length) {
    failDistribution("SKILL_PLAN_ROOT_INVALID", "roots contain duplicate Skill identities")
  }
  if (new Set(plan.topology).size !== plan.topology.length) {
    failDistribution("SKILL_PLAN_TOPOLOGY_INVALID", "topology contains duplicate Skill FQNs")
  }
  const capsuleByFqn = new Map<string, PlannedSkillCapsule>()
  for (const capsule of plan.capsules) {
    validateSkillOutputName(capsule.identity.name)
    if (!capsule.identity.fqn.trim() || !capsule.identity.apiVersion.trim() || !capsule.identity.version.trim()) {
      failDistribution("SKILL_PLAN_IDENTITY_INVALID", "planned Skill identity requires non-empty FQN, apiVersion and version")
    }
    if (capsuleByFqn.has(capsule.identity.fqn)) {
      failDistribution("SKILL_PLAN_CAPSULE_DUPLICATE", `duplicate planned capsule ${capsule.identity.fqn}`)
    }
    capsuleByFqn.set(capsule.identity.fqn, capsule)
    for (const file of capsule.files) {
      validatePlannedFilePath(file, "targetRelativePath")
      validatePlannedFilePath(file, "capsuleRelativePath")
    }
    assertCanonicalSkillEntry(capsule)
    for (const file of capsule.files) {
      assertValidPlannedFile(file)
      if (file.skillFqn !== capsule.identity.fqn
        || file.skillApiVersion !== capsule.identity.apiVersion
        || file.skillVersion !== capsule.identity.version) {
        failDistribution("SKILL_PLAN_FILE_OWNER_INVALID", `file ${file.targetRelativePath} has the wrong Skill owner`)
      }
      if (file.targetRelativePath !== posix.join(capsule.identity.name, file.capsuleRelativePath)) {
        failDistribution("SKILL_PLAN_TARGET_INVALID", `file ${file.targetRelativePath} is outside Skill output ${capsule.identity.name}`)
      }
    }
    assertCanonicalSkillProvenance(capsule)
    const expectedCapsuleDigest = digestJson({
      format: "halfcode.skill-capsule/v1",
      identity: capsule.identity,
      dependencies: capsule.dependencies,
      files: capsule.files.map(fileDigestProjection),
    })
    if (capsule.capsuleDigest !== expectedCapsuleDigest) {
      failDistribution("SKILL_PLAN_CAPSULE_DIGEST_INVALID", `capsule digest mismatch for ${capsule.identity.fqn}`)
    }
  }
  if (plan.topology.some((fqn) => !capsuleByFqn.has(fqn)) || plan.topology.length !== plan.capsules.length) {
    failDistribution("SKILL_PLAN_TOPOLOGY_INVALID", "topology and planned capsules do not identify the same closure")
  }
  if (JSON.stringify(plan.capsules.map((capsule) => capsule.identity.fqn)) !== JSON.stringify(plan.topology)) {
    failDistribution("SKILL_PLAN_TOPOLOGY_INVALID", "planned capsules must use dependency-first topology order")
  }
  const topologyIndex = new Map(plan.topology.map((fqn, index) => [fqn, index]))
  for (const capsule of plan.capsules) {
    const seenDependencies = new Set<string>()
    for (const dependency of capsule.dependencies) {
      if (seenDependencies.has(dependency.fqn)) {
        failDistribution("SKILL_PLAN_DEPENDENCY_DUPLICATE", `${capsule.identity.fqn} repeats dependency ${dependency.fqn}`)
      }
      seenDependencies.add(dependency.fqn)
      const target = capsuleByFqn.get(dependency.fqn)
      if (!target || JSON.stringify(target.identity) !== JSON.stringify(dependency)) {
        failDistribution("SKILL_PLAN_DEPENDENCY_INVALID", `${capsule.identity.fqn} dependency ${dependency.fqn} is not bound to the planned identity`)
      }
      if ((topologyIndex.get(dependency.fqn) ?? Number.MAX_SAFE_INTEGER) >= topologyIndex.get(capsule.identity.fqn)!) {
        failDistribution("SKILL_PLAN_TOPOLOGY_INVALID", `${dependency.fqn} must precede ${capsule.identity.fqn}`)
      }
    }
  }
  for (const root of plan.roots) {
    const capsule = capsuleByFqn.get(root.fqn)
    if (!capsule || JSON.stringify(capsule.identity) !== JSON.stringify(root)) {
      failDistribution("SKILL_PLAN_ROOT_INVALID", `root identity ${root.fqn} is not in the planned closure`)
    }
  }
  const reachable = new Set<string>()
  const visit = (fqn: string): void => {
    if (reachable.has(fqn)) return
    reachable.add(fqn)
    for (const dependency of capsuleByFqn.get(fqn)!.dependencies) visit(dependency.fqn)
  }
  for (const root of plan.roots) visit(root.fqn)
  const disconnected = plan.topology.filter((fqn) => !reachable.has(fqn)).sort(compareStrings)
  if (disconnected.length > 0) {
    failDistribution(
      "SKILL_PLAN_CLOSURE_DISCONNECTED",
      `planned capsules are not reachable from roots: ${disconnected.join(", ")}`,
    )
  }
  for (const file of plan.files) assertValidPlannedFile(file)
  assertNoTargetCollisions(plan.files.map((file) => ({
    targetRelativePath: file.targetRelativePath,
    owner: file.skillFqn,
  })), "SKILL_CLOSURE_TARGET_COLLISION")
  const flattened = plan.capsules.flatMap((capsule) => capsule.files)
    .sort((left, right) => compareStrings(left.targetRelativePath, right.targetRelativePath))
  const publicFileClaims = plan.files.map(fileDigestProjection)
  const capsuleFileClaims = flattened.map(fileDigestProjection)
  if (JSON.stringify(publicFileClaims) !== JSON.stringify(capsuleFileClaims)) {
    failDistribution("SKILL_PLAN_FILE_SET_INVALID", "plan files do not match capsule file claims")
  }
  const expectedClosureDigest = digestJson({
    format: "halfcode.skill-distribution/v1",
    roots: plan.roots,
    topology: plan.topology,
    capsules: plan.capsules.map((capsule) => ({
      identity: capsule.identity,
      capsuleDigest: capsule.capsuleDigest,
    })),
  })
  if (plan.closureDigest !== expectedClosureDigest) {
    failDistribution("SKILL_PLAN_CLOSURE_DIGEST_INVALID", "closure digest does not match the planned capsules")
  }
}

function assertCanonicalSkillEntry(capsule: PlannedSkillCapsule): void {
  const canonicalTarget = `${capsule.identity.name}/SKILL.md`
  const canonical = capsule.files.filter((file) =>
    file.capsuleRelativePath === "SKILL.md" && file.targetRelativePath === canonicalTarget)
  const rootSkillClaims = capsule.files.filter((file) =>
    !file.capsuleRelativePath.includes("/") && file.capsuleRelativePath.toUpperCase() === "SKILL.MD")
  if (capsule.files.length === 0 || canonical.length !== 1 || rootSkillClaims.length !== 1) {
    failDistribution(
      "SKILL_PLAN_REQUIRED_FILE_INVALID",
      `planned capsule ${capsule.identity.fqn} must contain exactly one canonical SKILL.md at ${canonicalTarget}`,
    )
  }
}

function assertValidPlannedFile(file: PlannedSkillFile): void {
  validatePlannedFilePath(file, "targetRelativePath")
  validatePlannedFilePath(file, "capsuleRelativePath")
  const content = plannedFileBytes(file)
  const compatibilityContent = file.content
  if (!(compatibilityContent instanceof Uint8Array) || !bytesEqual(content, compatibilityContent)) {
    failDistribution("SKILL_PLAN_CONTENT_DIGEST_INVALID", `compatibility content mismatch for ${file.targetRelativePath}`)
  }
  const actualDigest = digestBytes(content)
  if (file.contentDigest !== actualDigest) {
    failDistribution("SKILL_PLAN_CONTENT_DIGEST_INVALID", `content digest mismatch for ${file.targetRelativePath}`)
  }
}

function plannedSkillFile(
  identity: Pick<PlannedSkillFile, "skillFqn" | "skillApiVersion" | "skillVersion" | "capsuleRelativePath" | "targetRelativePath">,
  file: AtomicFile,
): PlannedSkillFile {
  const contentBase64 = Buffer.from(file.content).toString("base64")
  return Object.freeze({
    ...identity,
    contentBase64,
    get content() {
      return decodeCanonicalBase64(contentBase64, identity.targetRelativePath)
    },
    contentDigest: file.contentDigest,
  })
}

function plannedFileBytes(file: PlannedSkillFile): Uint8Array {
  return decodeCanonicalBase64(file.contentBase64, file.targetRelativePath)
}

function decodeCanonicalBase64(contentBase64: string, targetRelativePath: string): Uint8Array {
  if (typeof contentBase64 !== "string") {
    failDistribution("SKILL_PLAN_CONTENT_ENCODING_INVALID", `contentBase64 is required for ${targetRelativePath}`)
  }
  const content = Buffer.from(contentBase64, "base64")
  if (content.toString("base64") !== contentBase64) {
    failDistribution("SKILL_PLAN_CONTENT_ENCODING_INVALID", `contentBase64 is not canonical for ${targetRelativePath}`)
  }
  return new Uint8Array(content)
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  return left.every((byte, index) => byte === right[index])
}

function fileDigestProjection(file: PlannedSkillFile) {
  return {
    skillFqn: file.skillFqn,
    skillApiVersion: file.skillApiVersion,
    skillVersion: file.skillVersion,
    capsuleRelativePath: file.capsuleRelativePath,
    targetRelativePath: file.targetRelativePath,
    contentDigest: file.contentDigest,
  }
}

function atomicTextFile(targetRelativePath: string, content: string): AtomicFile {
  const bytes = new TextEncoder().encode(content)
  return Object.freeze({ targetRelativePath, content: bytes, contentDigest: digestBytes(bytes) })
}

function atomicFile(targetRelativePath: string, content: Uint8Array): AtomicFile {
  return Object.freeze({ targetRelativePath, content, contentDigest: digestBytes(content) })
}

function canonicalSkillProvenanceBytes(
  identity: SkillCapsuleIdentity,
  payloadFiles: readonly { readonly targetRelativePath: string; readonly contentDigest: SkillCapsuleContentDigest }[],
): Uint8Array {
  const manifest: SkillCapsuleProvenanceManifest = {
    format: "halfcode.skill-provenance/v1",
    generatedBy: "halfcode.skill-distribution/v1",
    source: {
      fqn: identity.fqn,
      apiVersion: identity.apiVersion,
      version: identity.version,
    },
    payloadFiles: payloadFiles
      .map((file) => ({ path: file.targetRelativePath, contentDigest: file.contentDigest }))
      .sort((left, right) => compareStrings(left.path, right.path)),
  }
  return new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`)
}

function assertCanonicalSkillProvenance(capsule: PlannedSkillCapsule): void {
  const manifests = capsule.files.filter((file) => file.capsuleRelativePath === SKILL_PROVENANCE_PATH)
  if (manifests.length !== 1) {
    failDistribution(
      "SKILL_PLAN_PROVENANCE_INVALID",
      `planned capsule ${capsule.identity.fqn} must contain exactly one canonical ${SKILL_PROVENANCE_PATH}`,
    )
  }
  const manifest = manifests[0]!
  const payloadFiles = capsule.files
    .filter((file) => file !== manifest)
    .map((file) => ({
      targetRelativePath: file.capsuleRelativePath,
      contentDigest: file.contentDigest,
    }))
  const expected = canonicalSkillProvenanceBytes(capsule.identity, payloadFiles)
  if (!bytesEqual(plannedFileBytes(manifest), expected)) {
    failDistribution(
      "SKILL_PLAN_PROVENANCE_INVALID",
      `planned capsule ${capsule.identity.fqn} provenance does not match source identity and payload files`,
    )
  }
}

async function readAtomicFiles(root: string): Promise<AtomicFile[]> {
  const files: AtomicFile[] = []
  const visit = async (directory: string, prefix: string): Promise<void> => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => compareStrings(left.name, right.name))) {
      const absolutePath = join(directory, entry.name)
      const relativePath = prefix ? posix.join(prefix, entry.name) : entry.name
      if (entry.isSymbolicLink()) failDistribution("SKILL_PLAN_SYMLINK_UNSUPPORTED", `generated file is a symbolic link: ${relativePath}`)
      if (entry.isDirectory()) await visit(absolutePath, relativePath)
      else if (entry.isFile()) {
        const content = new Uint8Array(await readFile(absolutePath))
        files.push(Object.freeze({
          targetRelativePath: relativePath,
          content,
          contentDigest: digestBytes(content),
        }))
      } else {
        failDistribution("SKILL_PLAN_FILE_TYPE_UNSUPPORTED", `generated entry is not a regular file: ${relativePath}`)
      }
    }
  }
  await visit(root, "")
  return files.sort((left, right) => compareStrings(left.targetRelativePath, right.targetRelativePath))
}

async function applyAtomicFiles(
  files: readonly AtomicFile[],
  outputRoot: string,
  onStep?: ApplySkillCapsuleDistributionOptions["onStep"],
  directories: readonly string[] = [],
): Promise<void> {
  if (!outputRoot.trim()) failDistribution("SKILL_APPLY_ROOT_INVALID", "outputRoot must be non-empty")
  const outputRootControl = unsafeUnicodeCodeUnitIssue(outputRoot)
  if (outputRootControl) failDistribution("SKILL_APPLY_ROOT_INVALID", `outputRoot is unsafe: ${outputRootControl}`)
  const frozenFiles = files.map((file) => ({
    targetRelativePath: file.targetRelativePath,
    content: new Uint8Array(file.content),
    contentDigest: file.contentDigest,
  }))
  for (const file of frozenFiles) {
    validatePlanTarget(file.targetRelativePath)
    if (file.contentDigest !== digestBytes(file.content)) {
      failDistribution("SKILL_PLAN_CONTENT_DIGEST_INVALID", `content digest mismatch for ${file.targetRelativePath}`)
    }
  }
  assertNoTargetCollisions(frozenFiles.map((file) => ({
    targetRelativePath: file.targetRelativePath,
    owner: `atomic-file:${file.targetRelativePath}`,
  })), "SKILL_CLOSURE_TARGET_COLLISION")
  for (const directory of directories) validatePlanTarget(directory)

  const liveRoot = resolve(outputRoot)
  const parent = dirname(liveRoot)
  const liveName = basename(liveRoot)
  if (!liveName) failDistribution("SKILL_APPLY_ROOT_INVALID", "outputRoot must not be a filesystem root")
  await mkdir(parent, { recursive: true })
  const stagingRoot = await mkdtemp(join(parent, `.${liveName}.staging-`))
  const backupRoot = join(parent, `.${liveName}.backup-${randomUUID()}`)
  let backupCreated = false
  let liveInstalled = false
  try {
    for (const directory of directories) {
      await mkdir(join(stagingRoot, ...directory.split("/")), { recursive: true })
    }
    for (const file of [...frozenFiles].sort((left, right) => compareStrings(left.targetRelativePath, right.targetRelativePath))) {
      const target = join(stagingRoot, ...file.targetRelativePath.split("/"))
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, file.content)
    }
    await onStep?.("after-stage")
    const stagedFiles = await readAtomicFiles(stagingRoot)
    const expected = [...frozenFiles].sort((left, right) => compareStrings(left.targetRelativePath, right.targetRelativePath))
    if (JSON.stringify(stagedFiles.map(atomicFileProjection)) !== JSON.stringify(expected.map(atomicFileProjection))) {
      failDistribution("SKILL_APPLY_READBACK_INVALID", "staged files do not match the frozen plan")
    }
    await onStep?.("after-readback")

    if (await pathExists(liveRoot)) {
      await rename(liveRoot, backupRoot)
      backupCreated = true
      await onStep?.("after-backup")
    }
    await onStep?.("before-live-rename")
    await rename(stagingRoot, liveRoot)
    liveInstalled = true
    if (backupCreated) await rm(backupRoot, { recursive: true, force: true })
  } catch (error) {
    try {
      if (backupCreated) {
        if (liveInstalled || await pathExists(liveRoot)) await rm(liveRoot, { recursive: true, force: true })
        await rename(backupRoot, liveRoot)
      }
      await rm(stagingRoot, { recursive: true, force: true })
    } catch (rollbackError) {
      throw new SkillCapsuleDistributionError(
        "SKILL_APPLY_ROLLBACK_FAILED",
        `${error instanceof Error ? error.message : String(error)}; rollback: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
      )
    }
    throw error
  } finally {
    if (!liveInstalled) await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined)
  }
}

function atomicFileProjection(file: AtomicFile) {
  return { targetRelativePath: file.targetRelativePath, contentDigest: file.contentDigest }
}

function assertNoTargetCollisions(claims: readonly TargetClaim[], code: string): void {
  const normalized = [...claims].map((claim) => {
    validatePlanTarget(claim.targetRelativePath)
    return claim
  }).sort((left, right) =>
    compareStrings(left.targetRelativePath, right.targetRelativePath)
    || compareStrings(left.owner, right.owner))
  const claimByPath = new Map<string, TargetClaim>()
  for (const current of normalized) {
    const segments = current.targetRelativePath.split("/")
    for (let length = 1; length < segments.length; length += 1) {
      const ancestor = claimByPath.get(segments.slice(0, length).join("/"))
      if (ancestor) failTargetCollision(code, ancestor, current)
    }
    const duplicate = claimByPath.get(current.targetRelativePath)
    if (duplicate) failTargetCollision(code, duplicate, current)
    claimByPath.set(current.targetRelativePath, current)
  }
}

function failTargetCollision(code: string, left: TargetClaim, right: TargetClaim): never {
  failDistribution(
    code,
    `target claim overlap: owner ${left.owner} target ${left.targetRelativePath} conflicts with owner ${right.owner} target ${right.targetRelativePath}`,
  )
}

type PlannedFilePathField = "capsuleRelativePath" | "targetRelativePath"

function validatePlannedFilePath(file: PlannedSkillFile, field: PlannedFilePathField): void {
  validatePlanTarget(file[field], { owner: file.skillFqn, field })
}

function validatePlanTarget(
  path: string,
  diagnostic?: { readonly owner: string; readonly field: PlannedFilePathField },
): void {
  const issue = safePathLexicalIssue(path, "relative-path")
  if (issue) failDistribution(
    "SKILL_PLAN_TARGET_INVALID",
    diagnostic
      ? `plan file owner ${diagnostic.owner} field ${diagnostic.field} raw target ${JSON.stringify(path)} must be a safe relative path (${issue})`
      : `plan target must be a safe relative path: ${JSON.stringify(path)} (${issue})`,
  )
}

function digestBytes(content: Uint8Array): SkillCapsuleContentDigest {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`
}

function digestJson(value: unknown): string {
  return digestBytes(new TextEncoder().encode(JSON.stringify(value)))
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

async function pathExists(path: string): Promise<boolean> {
  return Boolean(await lstat(path).catch(() => undefined))
}

function failDistribution(code: string, message: string): never {
  throw new SkillCapsuleDistributionError(code, message)
}

function renderSkill(
  skill: SkillDescriptor,
  registry: ResourceRegistry | undefined,
  references: readonly SkillReference[],
): string {
  const lines = [
    "---",
    `name: ${skill.name}`,
    `description: ${skill.description}`,
    "---",
    "",
    `# ${skill.name}`,
    "",
    skill.description,
    "",
  ]

  if (skill.instructions?.trim()) {
    lines.push("## Instructions", "", skill.instructions.trim(), "")
  }

  if (registry) {
    lines.push("## Resources", "")
    for (const [kind, records] of [...registry.byKind.entries()].sort(([a], [b]) => compareStrings(a, b))) {
      lines.push(`### ${kind}`, "")
      for (const record of [...records].sort((a, b) => compareStrings(a.fqn ?? a.name ?? "", b.fqn ?? b.name ?? ""))) {
        lines.push(`- ${record.fqn ?? record.name}: ${record.description}`)
      }
      lines.push("")
    }
  }

  if (references.length > 0) {
    lines.push("## References", "")
    for (const reference of references) {
      lines.push(`- references/${reference.path}`)
    }
    lines.push("")
  }

  return `${lines.join("\n").trimEnd()}\n`
}

function validateSkillDescriptor(skill: SkillDescriptor) {
  if (!skill.name.trim()) {
    throw new Error("Skill name is required")
  }
  if (!skill.description.trim()) {
    throw new Error("Skill description is required")
  }
}

function validateReferencePath(path: string) {
  const issue = safePathLexicalIssue(path, "relative-path")
  if (issue) failDistribution(
    "SKILL_REFERENCE_PATH_INVALID",
    `Invalid Skill reference path ${JSON.stringify(path)}: ${issue}`,
  )
}

interface SkillResourceSelection {
  assembly: ApplicationAssembly
  functions: ContractedCallableResource[]
  composedFunctions: ContractedCallableResource[]
  businessObjects: BusinessObjectResource[]
  pageObjects: PageObjectResource[]
  businessObjectSops: TextResourceLike[]
  applicationSops: TextResource[]
  promptFragments: TextResource[]
  wikiPages: TextResource[]
}

type TextResourceLike = {
  kind: string
  fqn: string
  description: string
  instruction?: { content: string }
}

function selectSkillResources(
  assembly: ApplicationAssembly,
  skill: SkillCapsuleResource,
): SkillResourceSelection {
  const includes = skill.includes.length > 0 ? skill.includes : [
    ...assembly.functions.map((item) => ({ kind: item.kind, ref: `resource://${item.fqn}` })),
    ...assembly.composedFunctions.map((item) => ({ kind: item.kind, ref: `resource://${item.fqn}` })),
    ...assembly.businessObjects.map((item) => ({ kind: item.kind, ref: `resource://${item.fqn}` })),
    ...assembly.pageObjects.map((item) => ({ kind: item.kind, ref: `resource://${item.fqn}` })),
    ...assembly.applicationSops.map((item) => ({ kind: item.kind, ref: `resource://${item.fqn}` })),
    ...assembly.promptFragments.map((item) => ({ kind: item.kind, ref: `resource://${item.fqn}` })),
    ...assembly.wikiPages.map((item) => ({ kind: item.kind, ref: `resource://${item.fqn}` })),
  ]

  const fqnSet = new Set(includes.map((include) => resourceRefToFqn(include.ref)))
  const selected = <T extends { fqn: string }>(resources: readonly T[]): T[] =>
    resources.filter((item) => fqnSet.has(item.fqn)).sort((left, right) => compareStrings(left.fqn, right.fqn))
  const businessObjects = selected(assembly.businessObjects).map(canonicalObjectOwner)
  const pageObjects = selected(assembly.pageObjects).map(canonicalObjectOwner)
  const businessSopRefs = new Set(businessObjects.flatMap((item) => item.sopRefs).map(resourceRefToFqn))

  return {
    assembly,
    functions: selected(assembly.functions),
    composedFunctions: selected(assembly.composedFunctions),
    businessObjects,
    pageObjects,
    businessObjectSops: assembly.businessObjectSops
      .filter((item) => businessSopRefs.has(item.fqn))
      .sort((left, right) => compareStrings(left.fqn, right.fqn)),
    applicationSops: selected(assembly.applicationSops),
    promptFragments: selected(assembly.promptFragments),
    wikiPages: selected(assembly.wikiPages),
  }
}

function canonicalObjectOwner<T extends BusinessObjectResource | PageObjectResource>(resource: T): T {
  const canonical = {
    ...resource,
    targetKinds: [...resource.targetKinds]
      .sort((left, right) => compareStrings(left.kindFqn, right.kindFqn)),
    operations: [...resource.operations]
      .map((operation) => ({
        ...operation,
        invocationModes: [...operation.invocationModes].sort(compareStrings),
      }))
      .sort((left, right) => compareStrings(left.ref, right.ref)),
  }
  if (resource.kind === "BusinessObject") {
    return {
      ...canonical,
      sopRefs: [...resource.sopRefs].sort(compareStrings),
      relatedRefs: [...resource.relatedRefs].sort(compareStrings),
    } as T
  }
  return canonical as T
}

function planReferenceFiles(
  selection: SkillResourceSelection,
  schemas: (ref: string) => unknown | undefined,
  mappings: ResourceMappings,
): AtomicFile[] {
  const files: AtomicFile[] = []
  for (const item of selection.composedFunctions) {
    files.push(planReferenceFile(mappedResourcePath(mappings, item.kind, item.fqn), callableReferenceMarkdown(item, schemas)))
  }
  for (const item of selection.functions) {
    files.push(planReferenceFile(mappedResourcePath(mappings, item.kind, item.fqn), callableReferenceMarkdown(item, schemas)))
  }
  for (const item of selection.businessObjects) {
    const sops = selection.businessObjectSops.filter((sop) => item.sopRefs.map(resourceRefToFqn).includes(sop.fqn))
    files.push(planReferenceFile(
      mappedResourcePath(mappings, item.kind, item.fqn),
      businessObjectMarkdown(item, sops, (kind, fqn) => mappedResourcePath(mappings, kind, fqn)),
    ))
  }
  for (const item of selection.pageObjects) {
    files.push(planReferenceFile(
      mappedResourcePath(mappings, item.kind, item.fqn),
      objectOwnerMarkdown(item),
    ))
  }
  for (const item of selection.businessObjectSops) {
    files.push(planReferenceFile(mappedResourcePath(mappings, item.kind, item.fqn), textReferenceMarkdown(item)))
  }
  for (const item of selection.applicationSops) {
    files.push(planReferenceFile(mappedResourcePath(mappings, item.kind, item.fqn), textReferenceMarkdown(item)))
  }
  for (const item of selection.promptFragments) {
    files.push(planReferenceFile(mappedResourcePath(mappings, item.kind, item.fqn), textReferenceMarkdown(item)))
  }
  for (const item of selection.wikiPages) {
    files.push(planReferenceFile(mappedResourcePath(mappings, item.kind, item.fqn), textReferenceMarkdown(item)))
  }
  return files
}

function objectOwnerMarkdown(resource: PageObjectResource | BusinessObjectResource): string {
  return [
    `# ${lastFqnSegment(resource.fqn)}`,
    "",
    `<fqn>${resource.fqn}</fqn>`,
    `<kind>${resource.kind}</kind>`,
    `<description>${resource.description}</description>`,
    "",
    "<available_operations>",
    ...resource.operations.map((operation) =>
      `- ${operation.ref}: ${operation.behavior}, targets=${operation.targets.kind}, modes=${operation.invocationModes.join(",")}`),
    "</available_operations>",
    "",
    "<usage>",
    "Call `run_object_operation({ targets, invocation, config })`; action invocation uses input and mutation invocation uses desired.",
    "</usage>",
    "",
  ].join("\n")
}

function planReferenceFile(path: string, content: string): AtomicFile {
  validatePlanTarget(path)
  return atomicTextFile(path, content.trimEnd() + "\n")
}

function callableReferenceMarkdown(
  resource: ContractedCallableResource,
  schemas: (ref: string) => unknown | undefined,
): string {
  return [
    `# ${lastFqnSegment(resource.fqn)}`,
    "",
    `<fqn>${resource.fqn}</fqn>`,
    `<kind>${resource.kind}</kind>`,
    `<description>${resource.description}</description>`,
    "",
    "<usage>",
    `Call \`run_callable_resource(${JSON.stringify(resource.fqn)}, input, config)\` with an input object matching <input_schema>. The host supplies runtime separately; omit config when the capability does not need it.`,
    "</usage>",
    "",
    "<input_schema>",
    "```json",
    JSON.stringify(schemas(resource.inputContractRef), null, 2),
    "```",
    "</input_schema>",
    "",
    "<output_schema>",
    "```json",
    JSON.stringify(schemas(resource.outputContractRef), null, 2),
    "```",
    "</output_schema>",
    "",
    "<instruction>",
    resource.instruction?.content.trim() ?? "",
    "</instruction>",
    "",
  ].join("\n")
}

function businessObjectMarkdown(
  resource: BusinessObjectResource,
  sops: readonly TextResourceLike[],
  mappedPath: (kind: string, fqn: string) => string,
): string {
  return [
    `# ${lastFqnSegment(resource.fqn)}`,
    "",
    `<fqn>${resource.fqn}</fqn>`,
    `<kind>${resource.kind}</kind>`,
    `<description>${resource.description}</description>`,
    "",
    "<available_operations>",
    ...resource.operations.map((operation) =>
      `- ${operation.ref}: ${operation.behavior}, targets=${operation.targets.kind}, modes=${operation.invocationModes.join(",")}`),
    "</available_operations>",
    "",
    "<available_sops>",
    ...sops.map((item) => `- ${item.fqn}: ${mappedPath(item.kind, item.fqn)}`),
    "</available_sops>",
    "",
    "<usage>",
    "Call `run_object_operation({ targets, invocation, config })`; action invocation uses input and mutation invocation uses desired.",
    "</usage>",
    "",
    "<instruction>",
    resource.instruction?.content.trim() ?? "",
    "</instruction>",
    "",
  ].join("\n")
}

function textReferenceMarkdown(resource: TextResourceLike): string {
  return [
    `# ${lastFqnSegment(resource.fqn)}`,
    "",
    `<fqn>${resource.fqn}</fqn>`,
    `<kind>${resource.kind}</kind>`,
    `<description>${resource.description}</description>`,
    "",
    resource.instruction?.content.trim() ?? "",
    "",
  ].join("\n")
}

function planCallableArtifacts(
  resources: readonly ContractedCallableResource[],
  schemas: (ref: string) => unknown | undefined,
  targetBase: string,
): AtomicFile[] {
  const files: AtomicFile[] = []
  const imports: string[] = []
  const entries: string[] = []
  for (const resource of resources) {
    const kindDir = `${resource.kind}s`
    const filePath = `${kindDir}/${lastFqnSegment(resource.fqn)}.js`
    const symbol = safeJsIdentifier(resource.fqn)
    files.push(atomicTextFile(`${targetBase}${filePath}`, [
      `import { ${resource.codeBinding.exportName} as entry } from ${JSON.stringify(resource.codeBinding.moduleSpecifier)}`,
      "",
      "export default entry",
      "",
    ].join("\n")))
    imports.push(`import ${symbol} from ${JSON.stringify(`./${filePath}`)}`)
    entries.push(JSON.stringify(resource.fqn) + `: { kind: ${JSON.stringify(resource.kind)}, handler: ${symbol} }`)
  }

  const registry = resources.map((resource) => ({
    fqn: resource.fqn,
    kind: resource.kind,
    description: resource.description,
    inputContractRef: resource.inputContractRef,
    outputContractRef: resource.outputContractRef,
    inputSchema: schemas(resource.inputContractRef),
    outputSchema: schemas(resource.outputContractRef),
    module: `./${resource.kind}s/${lastFqnSegment(resource.fqn)}.js`,
  }))
  files.push(atomicTextFile(`${targetBase}registry.json`, `${JSON.stringify({ callableResources: registry }, null, 2)}\n`))

  files.push(atomicTextFile(`${targetBase}bundle.js`, [
    'import { runWithRuntime } from "halfcode-compiler.xnl/authoring-runtime"',
    ...imports,
    "",
    `const registry = { ${entries.join(", ")} }`,
    "let callableRuntime",
    "",
    "/**",
    " * Host-only initialization boundary. Bind runtime capabilities before exposing",
    " * run_callable_resource to AI-authored code; runtime is never an AI argument.",
    " */",
    "export function initialize_callable_runtime(runtime) {",
    "  if (!runtime) throw new Error(\"Callable runtime is required\")",
    "  callableRuntime = runtime",
    "}",
    "",
    "/**",
    " * AI-facing callable entry. Callers provide only the resource identity, business",
    " * input, and optional invocation config; the host-owned runtime stays hidden.",
    " */",
    "export async function run_callable_resource(fqn, input, config) {",
    "  if (!callableRuntime) throw new Error(\"Callable runtime has not been initialized\")",
    "  return invokeCallableResource(callableRuntime, fqn, input, config)",
    "}",
    "",
    "/**",
    " * Framework-internal bridge. It activates the host runtime context and forwards",
    " * input/config unchanged to the deterministic resource handler.",
    " */",
    "async function invokeCallableResource(runtime, fqn, input, config) {",
    "  const entry = registry[fqn]",
    "  if (!entry) throw new Error(`Unknown callable resource: ${fqn}`)",
    "  return runWithRuntime(runtime, () => entry.handler(input, config))",
    "}",
    "",
    "export function resolve_callable_resource(fqn) {",
    "  const entry = registry[fqn]",
    "  if (!entry) throw new Error(`Unknown callable resource: ${fqn}`)",
    "  return { fqn, kind: entry.kind }",
    "}",
    "",
  ].join("\n")))
  return files
}

function planObjectOperationArtifacts(
  selection: SkillResourceSelection,
  schemas: (ref: string) => unknown | undefined,
): AtomicFile[] {
  const targetBase = "objects/"
  const owners = [...selection.businessObjects, ...selection.pageObjects]
  const operations = owners.flatMap((owner) => owner.operations).sort((left, right) => compareStrings(left.ref, right.ref))
  const targetKinds = owners
    .flatMap((owner) => owner.targetKinds)
    .sort((left, right) => compareStrings(left.kindFqn, right.kindFqn))
  const files: AtomicFile[] = []
  const imports: string[] = []
  const entries: string[] = []

  for (const definition of operations) {
    const binding = resolveObjectOperationCompilation(selection.assembly, definition.ref)
    const fileName = `${safeJsIdentifier(definition.ref)}.js`
    const filePath = `handlers/${fileName}`
    const symbol = safeJsIdentifier(definition.ref)
    files.push(atomicTextFile(`${targetBase}${filePath}`, [
      `import { ${binding.codeBinding.exportName} as entry } from ${JSON.stringify(binding.codeBinding.moduleSpecifier)}`,
      "",
      "export default entry",
      "",
    ].join("\n")))
    imports.push(`import ${symbol} from ${JSON.stringify(`./${filePath}`)}`)
    entries.push(`${JSON.stringify(definition.ref)}: ${symbol}`)
  }

  const registry = {
    targetKinds,
    operations: operations.map((definition) => ({
      ...definition,
      ...objectOperationContractProjection(selection.assembly, definition, schemas),
    })),
  }
  files.push(atomicTextFile(`${targetBase}registry.json`, `${JSON.stringify(registry, null, 2)}\n`))

  files.push(atomicTextFile(`${targetBase}bundle.js`, [
    'import { assertObjectOperationCall } from "halfcode-compiler.xnl"',
    'import { runWithRuntime } from "halfcode-compiler.xnl/authoring-runtime"',
    'import catalog from "./registry.json" with { type: "json" }',
    ...imports,
    "",
    `const handlers = { ${entries.join(", ")} }`,
    "const definitions = Object.fromEntries(catalog.operations.map((definition) => [definition.ref, definition]))",
    "let objectOperationRuntime",
    "",
    "/** Host-only runtime initialization; runtime is never an AI argument. */",
    "export function initialize_object_operation_runtime(runtime) {",
    "  if (!runtime) throw new Error(\"Object operation runtime is required\")",
    "  objectOperationRuntime = runtime",
    "}",
    "",
    "/** AI-facing object entry with orthogonal targets, invocation and config. */",
    "export async function run_object_operation(call) {",
    "  if (!objectOperationRuntime) throw new Error(\"Object operation runtime has not been initialized\")",
    "  const operationRef = call?.invocation?.operationRef",
    "  const definition = definitions[operationRef]",
    "  if (!definition) throw new Error(`Unknown object operation: ${operationRef}`)",
    "  const handler = handlers[operationRef]",
    "  if (!handler) throw new Error(`Object operation handler is unavailable: ${operationRef}`)",
    "  assertObjectOperationCall(call, definition)",
    "  return runWithRuntime(objectOperationRuntime, () =>",
    "    handler(objectOperationRuntime, call.targets, call.invocation, call.config)",
    "  )",
    "}",
    "",
    "export function resolve_object_operation(operationRef) {",
    "  const definition = definitions[operationRef]",
    "  if (!definition) throw new Error(`Unknown object operation: ${operationRef}`)",
    "  return definition",
    "}",
    "",
  ].join("\n")))
  return files
}

function objectOperationContractProjection(
  assembly: ApplicationAssembly,
  definition: ObjectOperationDefinition,
  schemas: (ref: string) => unknown | undefined,
) {
  const compilation = resolveObjectOperationCompilation(assembly, definition.ref)
  if (!compilation.inputContractRef || !compilation.outputContractRef) return {}
  return {
    inputContractRef: compilation.inputContractRef,
    outputContractRef: compilation.outputContractRef,
    inputSchema: schemas(compilation.inputContractRef),
    outputSchema: schemas(compilation.outputContractRef),
  }
}

function referenceModel(selection: SkillResourceSelection, mappings: ResourceMappings) {
  const ref = (kind: string, item: { fqn: string; description: string }) => ({
    fqn: item.fqn,
    description: item.description,
    path: mappedResourcePath(mappings, kind, item.fqn),
  })
  return {
    composedFunctions: selection.composedFunctions.map((item) => ref(item.kind, item)),
    functions: selection.functions.map((item) => ref(item.kind, item)),
    businessObjects: selection.businessObjects.map((item) => ({
      fqn: item.fqn,
      description: item.description,
      path: mappedResourcePath(mappings, item.kind, item.fqn),
    })),
    pageObjects: selection.pageObjects.map((item) => ref(item.kind, item)),
    applicationSops: selection.applicationSops.map((item) => ref(item.kind, item)),
    promptFragments: selection.promptFragments.map((item) => ref(item.kind, item)),
    wikiPages: selection.wikiPages.map((item) => ref(item.kind, item)),
    callableArtifacts: {
      registryPath: `${mappings.callableArtifactsTarget}registry.json`,
      bundlePath: `${mappings.callableArtifactsTarget}bundle.js`,
    },
    objectArtifacts: {
      registryPath: "objects/registry.json",
      bundlePath: "objects/bundle.js",
    },
  }
}

function mappedResourcePath(mappings: ResourceMappings, kind: string, fqn: string): string {
  const base = mappings.referenceTargets.get(kind) ?? defaultReferenceTarget(kind)
  const leaf = kind === "BusinessObject"
    ? `${lastFqnSegment(fqn)}/BUSINESS_OBJECT.md`
    : kind === "PageObject"
      ? `${lastFqnSegment(fqn)}/PAGE_OBJECT.md`
      : `${lastFqnSegment(fqn)}.md`
  return `${base}${leaf}`
}

function defaultReferenceTarget(kind: string): string {
  const defaults: Record<string, string> = {
    Function: "references/Functions/",
    ComposedFunction: "references/ComposedFunctions/",
    BusinessObject: "references/BusinessObjects/",
    PageObject: "references/PageObjects/",
    BusinessObjectSOP: "references/BusinessObjectSOPs/",
    ApplicationSOP: "references/ApplicationSOPs/",
    PromptFragment: "references/PromptFragments/",
    WikiPage: "references/Wiki/",
  }
  return defaults[kind] ?? `references/${kind}/`
}

function schemaReader(schemas: CompileResourceSkillCapsuleInput["schemas"]): (ref: string) => CanonicalJsonValue | undefined {
  const canonicalByFqn = new Map<string, CanonicalJsonValue>()
  return (ref: string) => {
    const fqn = resourceRefToFqn(ref)
    if (!schemas) return undefined
    const cached = canonicalByFqn.get(fqn)
    if (cached !== undefined) return cached
    let value: unknown
    if (typeof (schemas as ReadonlyMap<string, unknown>).get === "function") {
      value = (schemas as ReadonlyMap<string, unknown>).get(fqn)
    } else {
      value = (schemas as Record<string, unknown>)[fqn]
    }
    if (value === undefined) return undefined
    const canonical = canonicalJsonValue(value, fqn)
    canonicalByFqn.set(fqn, canonical)
    return canonical
  }
}

function canonicalJsonValue(value: unknown, schemaFqn: string): CanonicalJsonValue {
  const ancestors = new Set<object>()
  const visit = (current: unknown, path: string): CanonicalJsonValue => {
    if (current === null || typeof current === "string" || typeof current === "boolean") return current
    if (typeof current === "number") {
      if (!Number.isFinite(current)) failInvalidSchema(schemaFqn, path, "number must be finite")
      return Object.is(current, -0) ? 0 : current
    }
    if (typeof current !== "object") {
      failInvalidSchema(schemaFqn, path, `unsupported ${typeof current} value`)
    }
    if (ancestors.has(current)) failInvalidSchema(schemaFqn, path, "cyclic value")
    if (Object.getOwnPropertySymbols(current).length > 0) {
      failInvalidSchema(schemaFqn, path, "symbol keys are not JSON-compatible")
    }
    ancestors.add(current)
    try {
      if (Array.isArray(current)) {
        const names = Object.getOwnPropertyNames(current)
        const indices = Array.from({ length: current.length }, (_, index) => index)
        const allowed = new Set(["length", ...indices.map(String)])
        if (names.some((name) => !allowed.has(name)) || indices.some((index) => !(index in current))) {
          failInvalidSchema(schemaFqn, path, "arrays must be dense and contain no extra properties")
        }
        const values = indices.map((index) => {
          const descriptor = Object.getOwnPropertyDescriptor(current, String(index))
          if (!descriptor?.enumerable || !("value" in descriptor)) {
            failInvalidSchema(schemaFqn, `${path}[${index}]`, "array entries must be enumerable data values")
          }
          return visit(descriptor.value, `${path}[${index}]`)
        })
        return Object.freeze(values)
      }
      const prototype = Object.getPrototypeOf(current)
      if (prototype !== Object.prototype && prototype !== null) {
        failInvalidSchema(schemaFqn, path, "value must be a plain object")
      }
      const entries = Object.getOwnPropertyNames(current).sort(compareStrings).map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(current, key)
        if (!descriptor?.enumerable || !("value" in descriptor)) {
          failInvalidSchema(schemaFqn, `${path}[${JSON.stringify(key)}]`, "properties must be enumerable data values")
        }
        return [key, visit(descriptor.value, `${path}[${JSON.stringify(key)}]`)] as const
      })
      return Object.freeze(Object.fromEntries(entries))
    } finally {
      ancestors.delete(current)
    }
  }
  return visit(value, "$")
}

function failInvalidSchema(schemaFqn: string, path: string, reason: string): never {
  failDistribution("SKILL_SCHEMA_INVALID", `schema ${schemaFqn} at ${path}: ${reason}`)
}

function renderEjsTemplate(template: string, context: Record<string, unknown>): string {
  let cursor = 0
  let code = "let __out = '';\nconst __append = (value) => { __out += value == null ? '' : String(value) };\nwith (ctx) {\n"
  const pattern = /<%([=-]?)([\s\S]*?)%>/g
  for (const match of template.matchAll(pattern)) {
    code += `__append(${JSON.stringify(template.slice(cursor, match.index))});\n`
    const [, mode, body] = match
    if (mode === "=" || mode === "-") {
      code += `__append(${body.trim()});\n`
    } else {
      code += `${body}\n`
    }
    cursor = (match.index ?? 0) + match[0].length
  }
  code += `__append(${JSON.stringify(template.slice(cursor))});\n`
  code += "}\nreturn __out"
  return new Function("ctx", code)(context) as string
}

function stringField(source: Record<string, unknown>, name: string): string | undefined {
  const value = source[name]
  return typeof value === "string" && value.trim() ? value : undefined
}

function lastFqnSegment(fqn: string): string {
  return fqn.split(".").at(-1) ?? fqn
}

function safeJsIdentifier(fqn: string): string {
  return fqn.replace(/[^A-Za-z0-9_$]/g, "_")
}

function plannedGeneratedTargets(
  selection: SkillResourceSelection,
  callableResources: readonly ContractedCallableResource[],
  mappings: ResourceMappings,
): TargetClaim[] {
  const referenceResources: { kind: string; fqn: string }[] = [
    ...selection.functions,
    ...selection.composedFunctions,
    ...selection.businessObjects,
    ...selection.pageObjects,
    ...selection.businessObjectSops,
    ...selection.applicationSops,
    ...selection.promptFragments,
    ...selection.wikiPages,
  ]
  return [
    { targetRelativePath: "SKILL.md", owner: "generated:skill" },
    { targetRelativePath: SKILL_PROVENANCE_PATH, owner: "generated:provenance" },
    ...referenceResources.map((item) => ({
      targetRelativePath: mappedResourcePath(mappings, item.kind, item.fqn),
      owner: `resource:${item.fqn}`,
    })),
    ...callableResources.map((resource) => {
      return {
        targetRelativePath: `${mappings.callableArtifactsTarget}${resource.kind}s/${lastFqnSegment(resource.fqn)}.js`,
        owner: `resource:${resource.fqn}`,
      }
    }),
    { targetRelativePath: `${mappings.callableArtifactsTarget}registry.json`, owner: "generated:callable-registry" },
    { targetRelativePath: `${mappings.callableArtifactsTarget}bundle.js`, owner: "generated:callable-bundle" },
    ...[...selection.businessObjects, ...selection.pageObjects]
      .flatMap((owner) => owner.operations)
      .map((operation) => ({
        targetRelativePath: `objects/handlers/${safeJsIdentifier(operation.ref)}.js`,
        owner: `operation:${operation.ref}`,
      })),
    { targetRelativePath: "objects/registry.json", owner: "generated:object-registry" },
    { targetRelativePath: "objects/bundle.js", owner: "generated:object-bundle" },
  ]
}

function assertNoGeneratedTargetCollisions(claims: readonly TargetClaim[]) {
  assertNoTargetCollisions(claims, "SKILL_GENERATED_TARGET_COLLISION")
}

function assertCallableClosure(
  resources: readonly ContractedCallableResource[],
  schemas: (ref: string) => unknown | undefined,
) {
  const fqns = new Set<string>()
  for (const resource of resources) {
    if (fqns.has(resource.fqn)) throw new Error(`Callable resource FQN appears more than once: ${resource.fqn}`)
    fqns.add(resource.fqn)
    if (schemas(resource.inputContractRef) === undefined) {
      throw new Error(`Callable resource ${resource.fqn} is missing input schema ${resource.inputContractRef}`)
    }
    if (schemas(resource.outputContractRef) === undefined) {
      throw new Error(`Callable resource ${resource.fqn} is missing output schema ${resource.outputContractRef}`)
    }
    if (!resource.codeBinding.moduleSpecifier || !resource.codeBinding.exportName) {
      throw new Error(`Callable resource ${resource.fqn} is missing an executable code binding`)
    }
  }
}

function assertObjectOperationArtifactClosure(
  selection: SkillResourceSelection,
  schemas: (ref: string) => unknown | undefined,
) {
  const operationRefs = new Set<string>()
  for (const owner of [...selection.businessObjects, ...selection.pageObjects]) {
    for (const definition of owner.operations) {
      if (operationRefs.has(definition.ref)) throw new Error(`Object operation ref appears more than once: ${definition.ref}`)
      operationRefs.add(definition.ref)
      const binding = resolveObjectOperationCompilation(selection.assembly, definition.ref)
      if (!binding.codeBinding.moduleSpecifier || !binding.codeBinding.exportName) {
        throw new Error(`Object operation ${definition.ref} is missing an executable code binding`)
      }
      if (!binding.inputContractRef || !binding.outputContractRef) continue
      if (schemas(binding.inputContractRef) === undefined) {
        throw new Error(`Object operation ${definition.ref} is missing input schema ${binding.inputContractRef}`)
      }
      if (schemas(binding.outputContractRef) === undefined) {
        throw new Error(`Object operation ${definition.ref} is missing output schema ${binding.outputContractRef}`)
      }
    }
  }
}

export const compilerSkillPackage = {
  role: "framework",
  area: "compiler-skill",
  owns: "standard Skill capsule projection",
} as const
