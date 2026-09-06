import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { parse as parseYaml } from "yaml"
import type { ResourceNode, ResourceRecord, ResourceValue } from "halfcode-compiler-resource-core"
import { loadResourceTree } from "halfcode-compiler-resource-core"
import {
  requireObjectOperationBinding,
  setObjectOperationBinding,
  setObjectOperationCompilations,
  type ObjectOperationBinding,
  type ObjectOperationCompilation,
} from "./internal-bindings"

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[]
export interface JsonObject {
  readonly [key: string]: JsonValue
}

export type ObjectOperationOwnerKind = "PageObject" | "BusinessObject"
export type ObjectOperationBehavior = "action" | "mutation"
export type ObjectInvocationMode = "single" | "batch"
export type ObjectOperationEffect = "read-only" | "write" | "mixed"

export interface ObjectTargetRef {
  readonly kindFqn: string
  readonly key: JsonObject
}

export type ObjectTargets =
  | { readonly kind: "none" }
  | { readonly kind: "single"; readonly ref: ObjectTargetRef }
  | {
      readonly kind: "selection"
      readonly kindFqn: string
      readonly selector:
        | { readonly kind: "all" }
        | { readonly kind: "filter"; readonly where: JsonObject }
        | { readonly kind: "refs"; readonly refs: readonly ObjectTargetRef[] }
    }

export type ObjectOperationTargetDeclaration =
  | { readonly kind: "none" }
  | { readonly kind: "single"; readonly kindFqn: string }
  | { readonly kind: "selection"; readonly kindFqn: string }

export interface ObjectOperationDefinition {
  readonly ref: string
  readonly id: string
  readonly ownerKindFqn: string
  readonly ownerResourceKind: ObjectOperationOwnerKind
  readonly behavior: ObjectOperationBehavior
  readonly targets: ObjectOperationTargetDeclaration
  readonly invocationModes: readonly ObjectInvocationMode[]
  readonly effect: ObjectOperationEffect
}

export interface ObjectTargetKindDefinition {
  readonly kindFqn: string
  readonly ownerKindFqn: string
  readonly role: "object" | "nested-subject"
}

export interface ObjectOperationCatalog {
  readonly targetKinds: readonly ObjectTargetKindDefinition[]
  readonly operations: readonly ObjectOperationDefinition[]
}

export type ObjectInvocation =
  | { readonly kind: "action"; readonly operationRef: string; readonly input?: JsonValue }
  | { readonly kind: "mutation"; readonly operationRef: string; readonly desired: JsonValue }

export type ObjectOperationConfig = JsonObject

export interface ObjectOperationCall {
  readonly targets: ObjectTargets
  readonly invocation: ObjectInvocation
  readonly config?: ObjectOperationConfig
}

export type ExecuteObjectOperationRequest =
  | { readonly mode: "single"; readonly call: ObjectOperationCall }
  | {
      readonly mode: "batch"
      readonly items: readonly { readonly key: string; readonly call: ObjectOperationCall }[]
      readonly config: { readonly atomicity: "atomic" | "best-effort" }
    }

export type ObjectOperationHandler<TRuntime = unknown, TResult = unknown> = (
  runtime: TRuntime,
  targets: ObjectTargets,
  invocation: ObjectInvocation,
  config: ObjectOperationConfig | undefined,
) => TResult | Promise<TResult>

export class ObjectOperationContractError extends TypeError {
  constructor(
    readonly code: string,
    message: string,
    readonly path?: string,
  ) {
    super(`${code}: ${message}${path ? ` at ${path}` : ""}`)
    this.name = "ObjectOperationContractError"
  }
}

export function assertObjectOperationCatalog(catalog: ObjectOperationCatalog): void {
  const targetKinds = new Map<string, ObjectTargetKindDefinition>()
  for (const definition of catalog.targetKinds) {
    assertNonEmptyString(definition.kindFqn, "OBJECT_TARGET_KIND_INVALID", "target kind FQN", "targetKinds.kindFqn")
    assertNonEmptyString(definition.ownerKindFqn, "OBJECT_OWNER_KIND_INVALID", "owner kind FQN", "targetKinds.ownerKindFqn")
    if (definition.role !== "object" && definition.role !== "nested-subject") {
      fail("OBJECT_TARGET_ROLE_INVALID", "target role must be object or nested-subject", "targetKinds.role")
    }
    if (targetKinds.has(definition.kindFqn)) {
      fail("OBJECT_TARGET_KIND_DUPLICATE", `duplicate target kind ${definition.kindFqn}`, "targetKinds")
    }
    targetKinds.set(definition.kindFqn, definition)
  }

  const operationRefs = new Set<string>()
  for (const definition of catalog.operations) {
    assertObjectOperationDefinition(definition)
    if (operationRefs.has(definition.ref)) {
      fail("OBJECT_OPERATION_REF_DUPLICATE", `duplicate operation ref ${definition.ref}`, "operations")
    }
    operationRefs.add(definition.ref)
    const ownerTarget = targetKinds.get(definition.ownerKindFqn)
    if (!ownerTarget || ownerTarget.ownerKindFqn !== definition.ownerKindFqn || ownerTarget.role !== "object") {
      fail("OBJECT_OWNER_TARGET_MISSING", `owner ${definition.ownerKindFqn} must publish itself as an object target`, "targetKinds")
    }
    if (definition.targets.kind !== "none") {
      const targetKind = targetKinds.get(definition.targets.kindFqn)
      if (!targetKind) {
        fail("OBJECT_TARGET_KIND_UNPUBLISHED", `operation ${definition.ref} targets unpublished kind ${definition.targets.kindFqn}`, "operations.targets.kindFqn")
      }
      if (targetKind.ownerKindFqn !== definition.ownerKindFqn) {
        fail("OBJECT_TARGET_OWNER_MISMATCH", `target kind ${targetKind.kindFqn} is owned by ${targetKind.ownerKindFqn}`, "operations.targets.kindFqn")
      }
    }
  }
}

export function assertObjectOperationDefinition(definition: ObjectOperationDefinition): void {
  assertNonEmptyString(definition.id, "OBJECT_OPERATION_ID_INVALID", "operation id", "operation.id")
  assertNonEmptyString(definition.ownerKindFqn, "OBJECT_OWNER_KIND_INVALID", "owner kind FQN", "operation.ownerKindFqn")
  const expectedRef = `${definition.ownerKindFqn}.${definition.id}`
  if (definition.ref !== expectedRef) {
    fail("OBJECT_OPERATION_REF_INVALID", `operation ref must be ${expectedRef}`, "operation.ref")
  }
  if (definition.ownerResourceKind !== "PageObject" && definition.ownerResourceKind !== "BusinessObject") {
    fail("OBJECT_OWNER_RESOURCE_KIND_INVALID", "owner resource kind must be PageObject or BusinessObject", "operation.ownerResourceKind")
  }
  if (definition.behavior !== "action" && definition.behavior !== "mutation") {
    fail("OBJECT_OPERATION_BEHAVIOR_INVALID", "behavior must be action or mutation", "operation.behavior")
  }
  if (definition.effect !== "read-only" && definition.effect !== "write" && definition.effect !== "mixed") {
    fail("OBJECT_OPERATION_EFFECT_INVALID", "effect must be read-only, write or mixed", "operation.effect")
  }
  if (definition.targets.kind !== "none" && definition.targets.kind !== "single" && definition.targets.kind !== "selection") {
    fail("OBJECT_TARGET_CARDINALITY_INVALID", "target cardinality must be none, single or selection", "operation.targets.kind")
  }
  if (definition.targets.kind !== "none") {
    assertNonEmptyString(definition.targets.kindFqn, "OBJECT_TARGET_KIND_INVALID", "target kind FQN", "operation.targets.kindFqn")
  }
  if (
    definition.invocationModes.length === 0
    || new Set(definition.invocationModes).size !== definition.invocationModes.length
    || definition.invocationModes.some((mode) => mode !== "single" && mode !== "batch")
  ) {
    fail("OBJECT_INVOCATION_MODES_INVALID", "invocationModes must contain distinct single or batch modes", "operation.invocationModes")
  }
}

export function assertObjectOperationCall(
  call: ObjectOperationCall,
  definition: ObjectOperationDefinition,
  mode: ObjectInvocationMode = "single",
): void {
  assertObjectOperationDefinition(definition)
  if (!definition.invocationModes.includes(mode)) {
    fail("OBJECT_INVOCATION_MODE_UNSUPPORTED", `operation ${definition.ref} does not support ${mode}`, "mode")
  }
  if (call.invocation.operationRef !== definition.ref) {
    fail("OBJECT_OPERATION_REF_MISMATCH", `expected ${definition.ref}`, "invocation.operationRef")
  }
  if (call.invocation.kind !== definition.behavior) {
    fail("OBJECT_OPERATION_BEHAVIOR_MISMATCH", `expected ${definition.behavior}`, "invocation.kind")
  }
  assertObjectTargets(call.targets, definition.targets)
  if (call.invocation.kind === "action") {
    if (call.invocation.input !== undefined) assertJsonValue(call.invocation.input, "invocation.input")
  } else {
    if (!("desired" in call.invocation)) {
      fail("OBJECT_MUTATION_DESIRED_REQUIRED", "mutation invocation requires desired", "invocation.desired")
    }
    assertJsonValue(call.invocation.desired, "invocation.desired")
  }
  if (call.config !== undefined) assertJsonValue(call.config, "config", true)
}

export function assertExecuteObjectOperationRequest(
  request: ExecuteObjectOperationRequest,
  resolveDefinition: (operationRef: string) => ObjectOperationDefinition | undefined,
): void {
  if (request.mode === "single") {
    const definition = requiredOperationDefinition(request.call.invocation.operationRef, resolveDefinition)
    assertObjectOperationCall(request.call, definition)
    return
  }
  if (request.config.atomicity !== "best-effort") {
    fail("OBJECT_BATCH_ATOMICITY_UNSUPPORTED", "object operation batch only supports best-effort atomicity", "config.atomicity")
  }
  if (request.items.length === 0) {
    fail("OBJECT_BATCH_EMPTY", "batch requires at least one item", "items")
  }
  const keys = new Set<string>()
  let operationRef: string | undefined
  for (const [index, item] of request.items.entries()) {
    assertNonEmptyString(item.key, "OBJECT_BATCH_KEY_INVALID", "batch item key", `items[${index}].key`)
    if (keys.has(item.key)) fail("OBJECT_BATCH_KEY_DUPLICATE", `duplicate batch key ${item.key}`, `items[${index}].key`)
    keys.add(item.key)
    if (operationRef !== undefined && item.call.invocation.operationRef !== operationRef) {
      fail("OBJECT_BATCH_OPERATION_MISMATCH", "all batch items must use the same operation", `items[${index}].call.invocation.operationRef`)
    }
    operationRef = item.call.invocation.operationRef
    const definition = requiredOperationDefinition(operationRef, resolveDefinition)
    assertObjectOperationCall(item.call, definition, "batch")
  }
}

function requiredOperationDefinition(
  operationRef: string,
  resolveDefinition: (operationRef: string) => ObjectOperationDefinition | undefined,
): ObjectOperationDefinition {
  const definition = resolveDefinition(operationRef)
  if (!definition) fail("OBJECT_OPERATION_UNKNOWN", `unknown operation ${operationRef}`, "invocation.operationRef")
  return definition
}

function assertObjectTargets(actual: ObjectTargets, expected: ObjectOperationTargetDeclaration): void {
  if (actual.kind !== expected.kind) {
    fail("OBJECT_TARGET_CARDINALITY_MISMATCH", `expected ${expected.kind}, received ${actual.kind}`, "targets.kind")
  }
  if (actual.kind === "none" || expected.kind === "none") return
  if (actual.kind === "single" && expected.kind === "single") {
    assertTargetRef(actual.ref, expected.kindFqn, "targets.ref")
    return
  }
  if (actual.kind !== "selection" || expected.kind !== "selection") return
  if (actual.kindFqn !== expected.kindFqn) {
    fail("OBJECT_TARGET_KIND_MISMATCH", `expected ${expected.kindFqn}, received ${actual.kindFqn}`, "targets.kindFqn")
  }
  if (actual.selector.kind === "all") return
  if (actual.selector.kind === "filter") {
    assertJsonValue(actual.selector.where, "targets.selector.where", true)
    return
  }
  if (actual.selector.kind === "refs") {
    if (actual.selector.refs.length === 0) fail("OBJECT_TARGET_REFS_EMPTY", "refs selector requires at least one ref", "targets.selector.refs")
    actual.selector.refs.forEach((ref, index) => assertTargetRef(ref, expected.kindFqn, `targets.selector.refs[${index}]`))
    return
  }
  fail("OBJECT_TARGET_SELECTOR_UNSUPPORTED", "selector kind must be all, filter or refs", "targets.selector.kind")
}

function assertTargetRef(ref: ObjectTargetRef, expectedKindFqn: string, path: string): void {
  if (!ref || typeof ref !== "object" || ref.kindFqn !== expectedKindFqn) {
    fail("OBJECT_TARGET_KIND_MISMATCH", `expected ${expectedKindFqn}`, `${path}.kindFqn`)
  }
  assertJsonValue(ref.key, `${path}.key`, true)
}

function assertJsonValue(value: unknown, path: string, requireObject = false): asserts value is JsonValue {
  const seen = new Set<object>()
  const visit = (current: unknown, currentPath: string): void => {
    if (current === null || typeof current === "string" || typeof current === "boolean") return
    if (typeof current === "number" && Number.isFinite(current)) return
    if (typeof current !== "object") fail("OBJECT_JSON_VALUE_INVALID", "value must be JSON-compatible", currentPath)
    if (seen.has(current)) fail("OBJECT_JSON_VALUE_INVALID", "cyclic values are not JSON-compatible", currentPath)
    seen.add(current)
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${currentPath}[${index}]`))
    } else {
      const prototype = Object.getPrototypeOf(current)
      if (prototype !== Object.prototype && prototype !== null) {
        fail("OBJECT_JSON_VALUE_INVALID", "value must use plain JSON objects", currentPath)
      }
      for (const [key, item] of Object.entries(current)) visit(item, `${currentPath}.${key}`)
    }
    seen.delete(current)
  }
  if (requireObject && (!value || typeof value !== "object" || Array.isArray(value))) {
    fail("OBJECT_JSON_OBJECT_REQUIRED", "value must be a JSON object", path)
  }
  visit(value, path)
}

function assertNonEmptyString(value: unknown, code: string, label: string, path: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) fail(code, `${label} must be a non-empty string`, path)
}

function fail(code: string, message: string, path?: string): never {
  throw new ObjectOperationContractError(code, message, path)
}

export interface LoadApplicationAssemblyOptions {
  resourceRootDir: string
  manifestPath?: string
  packageName?: string
}

export type ApplicationScope = "shared" | "domain"

export interface AuthoringModuleDescriptor {
  id: string
  packageName: string
  family: string
  scope: ApplicationScope
  resourceRootDir: string
  manifestPath?: string
  ports?: readonly AssemblyPort[]
}

export interface AssemblyPort {
  fqn: string
  description: string
  resourceKind: AssemblyResource["kind"]
  contractRef?: string
  optional?: boolean
}

export interface AssemblyPortBinding {
  portFqn: string
  resourceRef: string
}

export interface ResolveApplicationAssemblyOptions {
  modules: readonly AuthoringModuleDescriptor[]
  portBindings?: readonly AssemblyPortBinding[]
}

export interface ResolvedAssemblyPortBinding extends AssemblyPortBinding {
  port: AssemblyPort
  resource: AssemblyResource
}

export interface ContractedCallableResource {
  kind: "Function" | "ComposedFunction"
  fqn: string
  description: string
  instruction?: TextMaterial
  inputContractRef: string
  outputContractRef: string
  codeBinding: CodeBinding
  mutationRefs: readonly string[]
  source: ResourceSource
}

export interface BusinessObjectResource {
  kind: "BusinessObject"
  fqn: string
  description: string
  instruction?: TextMaterial
  sopRefs: readonly string[]
  relatedRefs: readonly string[]
  targetKinds: readonly ObjectTargetKindDefinition[]
  operations: readonly ObjectOperationDefinition[]
  source: ResourceSource
}

interface BusinessActionResource {
  kind: "BusinessAction"
  fqn: string
  description: string
  instruction?: TextMaterial
  inputContractRef: string
  outputContractRef: string
  codeBinding: CodeBinding
  mutationRefs: readonly string[]
  ownerRef: string
  source: ResourceSource
}

interface BusinessMutationResource {
  kind: "BusinessMutation"
  fqn: string
  description: string
  instruction?: TextMaterial
  ownerRef: string
  codeBinding: CodeBinding
  source: ResourceSource
}

export interface BusinessObjectSopResource {
  kind: "BusinessObjectSOP"
  fqn: string
  description: string
  instruction?: TextMaterial
  source: ResourceSource
}

export interface TextResource {
  kind: "ApplicationSOP" | "PromptFragment" | "WikiPage"
  fqn: string
  description: string
  instruction?: TextMaterial
  source: ResourceSource
}

export interface SkillCapsuleResource {
  kind: "SkillCapsule"
  fqn: string
  name?: string
  envelopeVersion: string
  specVersion: number
  version: string
  description: string
  metadata: Record<string, unknown>
  template: TextMaterial
  resourceMappings?: TextMaterial
  includes: readonly ResourceInclude[]
  dependencies: readonly SkillCapsuleDependency[]
  source: ResourceSource
}

export interface SkillCapsuleDependency {
  ref: string
  fqn: string
  version: string
}

export interface PageObjectResource {
  kind: "PageObject"
  fqn: string
  id: string
  description: string
  targetKinds: readonly ObjectTargetKindDefinition[]
  operations: readonly ObjectOperationDefinition[]
  source: ResourceSource
}

export interface TextMaterial {
  href: string
  format?: string
  absolutePath: string
  content: string
}

export interface CodeBinding {
  packageName: string
  module: string
  exportName: string
  moduleSpecifier: string
}

type CodeModuleBinding = Omit<CodeBinding, "exportName">

export interface ResourceInclude {
  kind: string
  ref: string
}

export interface ResourceSource {
  logicalPath: string
  directory: string
  moduleId: string
  packageName: string
  resourceRootDir: string
}

export interface ApplicationAssembly {
  rootDir: string
  modules: readonly AuthoringModuleDescriptor[]
  portBindings: readonly ResolvedAssemblyPortBinding[]
  functions: readonly ContractedCallableResource[]
  composedFunctions: readonly ContractedCallableResource[]
  businessObjects: readonly BusinessObjectResource[]
  businessObjectSops: readonly BusinessObjectSopResource[]
  applicationSops: readonly TextResource[]
  promptFragments: readonly TextResource[]
  wikiPages: readonly TextResource[]
  skillCapsules: readonly SkillCapsuleResource[]
  pageObjects: readonly PageObjectResource[]
  byFqn: ReadonlyMap<string, AssemblyResource>
}

export type AssemblyResource =
  | ContractedCallableResource
  | BusinessObjectResource
  | BusinessObjectSopResource
  | TextResource
  | SkillCapsuleResource
  | PageObjectResource

export async function loadApplicationAssembly(
  options: LoadApplicationAssemblyOptions,
): Promise<ApplicationAssembly> {
  return resolveApplicationAssembly({
    modules: [{
      id: "DefaultAuthoringModule",
      packageName: options.packageName ?? "anonymous-authoring-module",
      family: "standalone",
      scope: "domain",
      resourceRootDir: options.resourceRootDir,
      manifestPath: options.manifestPath,
    }],
  })
}

export async function resolveApplicationAssembly(
  options: ResolveApplicationAssemblyOptions,
): Promise<ApplicationAssembly> {
  if (options.modules.length === 0) {
    throw new Error("Application assembly requires at least one authoring module")
  }
  assertUniqueModuleIds(options.modules)

  const loaded = await Promise.all(options.modules.map(loadAuthoringModule))
  const all = loaded.flatMap((module) => module.resources)
  const internalOperationResources = loaded.flatMap((module) => module.internalOperationResources)
  const byFqn = uniqueResourceMap(all)
  const closureByFqn = uniqueResourceMap([...all, ...internalOperationResources])
  const compilations = assertObjectOperationAssemblyClosure(all, closureByFqn)
  const ports = options.modules.flatMap((module) => module.ports ?? [])
  const portBindings = resolvePortBindings(ports, options.portBindings ?? [], byFqn)

  const assembly: ApplicationAssembly = {
    rootDir: options.modules[0]?.resourceRootDir ?? "",
    modules: [...options.modules],
    portBindings,
    functions: loaded.flatMap((module) => module.functions),
    composedFunctions: loaded.flatMap((module) => module.composedFunctions),
    businessObjects: loaded.flatMap((module) => module.businessObjects),
    businessObjectSops: loaded.flatMap((module) => module.businessObjectSops),
    applicationSops: loaded.flatMap((module) => module.applicationSops),
    promptFragments: loaded.flatMap((module) => module.promptFragments),
    wikiPages: loaded.flatMap((module) => module.wikiPages),
    skillCapsules: loaded.flatMap((module) => module.skillCapsules),
    pageObjects: loaded.flatMap((module) => module.pageObjects),
    byFqn,
  }
  assertSkillDependencyBindings(assembly.skillCapsules, byFqn)
  setObjectOperationCompilations(assembly, compilations)
  return assembly
}

async function loadAuthoringModule(module: AuthoringModuleDescriptor) {
  const tree = await loadResourceTree({
    rootDir: module.resourceRootDir,
    manifestPath: module.manifestPath,
  })

  const records = [...tree.registry.byKind.values()].flat()
  const functions = await Promise.all(records
    .filter((record) => record.kind === "Function")
    .map((record) => readContractedCallable(module, record, "Function")))
  const composedFunctions = await Promise.all(records
    .filter((record) => record.kind === "ComposedFunction")
    .map((record) => readContractedCallable(module, record, "ComposedFunction")))
  const businessActions = await Promise.all(records
    .filter((record) => record.kind === "BusinessAction")
    .map((record) => readContractedCallable(module, record, "BusinessAction")))
  const businessObjects = await Promise.all(records
    .filter((record) => record.kind === "BusinessObject")
    .map((record) => readBusinessObject(module, record)))
  const businessMutations = await Promise.all(records
    .filter((record) => record.kind === "BusinessMutation")
    .map((record) => readBusinessMutation(module, record)))
  const businessObjectSops = await Promise.all(records
    .filter((record) => record.kind === "BusinessObjectSOP")
    .map((record) => readBusinessObjectSop(module, record)))
  const applicationSops = await Promise.all(records
    .filter((record) => record.kind === "ApplicationSOP")
    .map((record) => readTextResource(module, record, "ApplicationSOP")))
  const promptFragments = await Promise.all(records
    .filter((record) => record.kind === "PromptFragment")
    .map((record) => readTextResource(module, record, "PromptFragment")))
  const wikiPages = await Promise.all(records
    .filter((record) => record.kind === "WikiPage")
    .map((record) => readTextResource(module, record, "WikiPage")))
  const skillCapsules = await Promise.all(records
    .filter((record) => record.kind === "SkillCapsule")
    .map((record) => readSkillCapsule(module, record)))
  const pageObjects = records
    .filter((record) => record.kind === "PageObject")
    .map((record) => readPageObject(module, record))

  const all: AssemblyResource[] = [
    ...functions,
    ...composedFunctions,
    ...businessObjects,
    ...businessObjectSops,
    ...applicationSops,
    ...promptFragments,
    ...wikiPages,
    ...skillCapsules,
    ...pageObjects,
  ]

  return {
    functions,
    composedFunctions,
    businessObjects,
    businessActions,
    businessMutations,
    businessObjectSops,
    applicationSops,
    promptFragments,
    wikiPages,
    skillCapsules,
    pageObjects,
    resources: all,
    internalOperationResources: [...businessActions, ...businessMutations],
  }
}

function readPageObject(module: AuthoringModuleDescriptor, record: ResourceRecord): PageObjectResource {
  const ownerKindFqn = requiredFqn(record)
  const operations = requiredNode(record, "Operations")
  const moduleBinding = requiredNodeCodeModuleBinding(record)
  const operationDefinitions = readXnlObjectOperations(
    operations,
    "PageObject",
    ownerKindFqn,
    record,
    (operation) => ({
      kind: "export",
      codeBinding: {
        ...moduleBinding,
        exportName: requiredNodeProperty(operation, "export", record),
      },
    }),
  )
  if (operationDefinitions.length === 0) {
    throw new Error(`${record.logicalPath} is missing Action or Mutation operation`)
  }

  return {
    kind: "PageObject",
    fqn: ownerKindFqn,
    id: requiredRootProperty(record, "localId"),
    description: requiredDescription(record),
    targetKinds: readXnlObjectTargetKinds(record.node.subdomains.TargetKinds, ownerKindFqn, record),
    operations: operationDefinitions,
    source: sourceFor(module, record),
  }
}

function readXnlObjectOperations(
  operations: ResourceNode,
  ownerResourceKind: ObjectOperationOwnerKind,
  ownerKindFqn: string,
  record: ResourceRecord,
  binding: (operation: ResourceNode) => ObjectOperationBinding,
): ObjectOperationDefinition[] {
  const result: ObjectOperationDefinition[] = []
  for (const operation of nodeMembers(operations).filter((node) => node.tag === "Action" || node.tag === "Mutation")) {
    const id = operation.resourceId
    if (!id) throw new Error(`${record.logicalPath} ${operation.tag} is missing #id`)
    const target = requiredNodeProperty(operation, "target", record)
    const targetKindFqn = optionalNodeProperty(operation, "targetKindFqn")
    let targets: ObjectOperationTargetDeclaration
    if (target === "none") {
      targets = { kind: "none" }
    } else if (target === "single" || target === "selection") {
      targets = { kind: target, kindFqn: targetKindFqn ?? "" }
    } else {
      invalidObjectOperation(record, `${operation.tag} target must be none, single or selection`)
    }
    if (target === "none" && targetKindFqn) {
      throw new Error(`${record.logicalPath} ${operation.tag} target none must not declare targetKindFqn`)
    }
    const definition: ObjectOperationDefinition = {
      ref: `${ownerKindFqn}.${id}`,
      id,
      ownerKindFqn,
      ownerResourceKind,
      behavior: operation.tag === "Action" ? "action" : "mutation",
      targets,
      invocationModes: requiredNodeStringList(operation, "invocationModes", record) as ObjectInvocationMode[],
      effect: requiredNodeProperty(operation, "effect", record) as ObjectOperationEffect,
    }
    try {
      assertObjectOperationDefinition(definition)
    } catch (error) {
      throw new Error(`${record.logicalPath} has invalid ${operation.tag} '${id}': ${(error as Error).message}`)
    }
    setObjectOperationBinding(definition, binding(operation))
    result.push(definition)
  }
  return result
}

function readXnlObjectTargetKinds(
  value: ResourceNode | undefined,
  ownerKindFqn: string,
  record: ResourceRecord,
): ObjectTargetKindDefinition[] {
  const result: ObjectTargetKindDefinition[] = [{ kindFqn: ownerKindFqn, ownerKindFqn, role: "object" }]
  if (!value) return result
  for (const targetKind of nodeMembers(value).filter((node) => node.tag === "TargetKind")) {
    const role = requiredNodeProperty(targetKind, "role", record)
    if (role !== "nested-subject") {
      throw new Error(`${record.logicalPath} explicit TargetKind role must be nested-subject`)
    }
    result.push({
      kindFqn: requiredNodeProperty(targetKind, "kindFqn", record),
      ownerKindFqn,
      role,
    })
  }
  return result
}

function invalidObjectOperation(record: ResourceRecord, message: string): never {
  throw new Error(`${record.logicalPath} ${message}`)
}

async function readContractedCallable(
  module: AuthoringModuleDescriptor,
  record: ResourceRecord,
  kind: ContractedCallableResource["kind"],
): Promise<ContractedCallableResource>
async function readContractedCallable(
  module: AuthoringModuleDescriptor,
  record: ResourceRecord,
  kind: "BusinessAction",
): Promise<BusinessActionResource>
async function readContractedCallable(
  module: AuthoringModuleDescriptor,
  record: ResourceRecord,
  kind: ContractedCallableResource["kind"] | "BusinessAction",
): Promise<ContractedCallableResource | BusinessActionResource> {
  const common = {
    kind,
    fqn: requiredFqn(record),
    description: requiredDescription(record),
    instruction: await readOptionalMaterial(module, record, "Instruction"),
    inputContractRef: requiredNodeRef(record, "InputContract"),
    outputContractRef: requiredNodeRef(record, "OutputContract"),
    codeBinding: requiredNodeCodeBinding(record),
    mutationRefs: refsFromNodeContainer(record.node.subdomains.Mutations, "Mutation"),
    source: sourceFor(module, record),
  }
  return kind === "BusinessAction"
    ? { ...common, kind, ownerRef: requiredRootProperty(record, "ownerRef") }
    : { ...common, kind }
}

async function readBusinessObject(module: AuthoringModuleDescriptor, record: ResourceRecord): Promise<BusinessObjectResource> {
  const ownerKindFqn = requiredFqn(record)
  const operations = record.node.subdomains.Operations
  return {
    kind: "BusinessObject",
    fqn: ownerKindFqn,
    description: requiredDescription(record),
    instruction: await readOptionalMaterial(module, record, "Instruction"),
    sopRefs: refsFromNodeContainer(record.node.subdomains.SOPs, "SOP"),
    relatedRefs: refsFromNodeContainer(record.node.subdomains.RelatedResources, "Resource"),
    targetKinds: readXnlObjectTargetKinds(record.node.subdomains.TargetKinds, ownerKindFqn, record),
    operations: operations
      ? readXnlObjectOperations(
        operations,
        "BusinessObject",
        ownerKindFqn,
        record,
        (operation) => ({
          kind: "resource",
          resourceRef: requiredNodeProperty(operation, "resourceRef", record),
        }),
      )
      : [],
    source: sourceFor(module, record),
  }
}

async function readBusinessMutation(
  module: AuthoringModuleDescriptor,
  record: ResourceRecord,
): Promise<BusinessMutationResource> {
  return {
    kind: "BusinessMutation",
    fqn: requiredFqn(record),
    description: requiredDescription(record),
    instruction: await readOptionalMaterial(module, record, "Instruction"),
    ownerRef: requiredRootProperty(record, "ownerRef"),
    codeBinding: requiredNodeCodeBinding(record),
    source: sourceFor(module, record),
  }
}

async function readBusinessObjectSop(module: AuthoringModuleDescriptor, record: ResourceRecord): Promise<BusinessObjectSopResource> {
  return {
    kind: "BusinessObjectSOP",
    fqn: requiredFqn(record),
    description: requiredDescription(record),
    instruction: await readOptionalMaterial(module, record, "Instruction"),
    source: sourceFor(module, record),
  }
}

async function readTextResource(
  module: AuthoringModuleDescriptor,
  record: ResourceRecord,
  kind: TextResource["kind"],
): Promise<TextResource> {
  return {
    kind,
    fqn: requiredFqn(record),
    description: requiredDescription(record),
    instruction: await readOptionalMaterial(module, record, "Instruction"),
    source: sourceFor(module, record),
  }
}

async function readSkillCapsule(module: AuthoringModuleDescriptor, record: ResourceRecord): Promise<SkillCapsuleResource> {
  const metadataMaterial = await readRequiredMaterial(module, record, "SkillMetadata")
  const template = await readRequiredMaterial(module, record, "Template")
  const parsedMetadata = parseYaml(metadataMaterial.content)
  if (!parsedMetadata || typeof parsedMetadata !== "object" || Array.isArray(parsedMetadata)) {
    throw new Error(`SKILL_CAPSULE_METADATA_INVALID: ${record.logicalPath} Skill metadata must be a YAML object`)
  }
  const yamlVersion = (parsedMetadata as Record<string, unknown>).version
  if (typeof yamlVersion !== "string" || !yamlVersion.trim()) {
    throw new Error(`SKILL_CAPSULE_VERSION_MISSING: ${record.logicalPath} Skill metadata must declare a non-empty version`)
  }
  const version = yamlVersion.trim()
  const hasXnlName = Object.prototype.hasOwnProperty.call(record.node.properties, "name")
  const xnlName = stringResourceValue(record.node.properties.name)
  if (hasXnlName && !xnlName) {
    throw new Error(`SKILL_CAPSULE_NAME_INVALID: ${requiredFqn(record)} XNL name must be a non-empty string`)
  }
  if (hasXnlName && Object.prototype.hasOwnProperty.call(parsedMetadata, "name")) {
    throw new Error(
      `SKILL_CAPSULE_NAME_DUPLICATE: ${requiredFqn(record)} name is owned by XNL and must not be repeated in YAML`,
    )
  }
  return {
    kind: "SkillCapsule",
    fqn: requiredFqn(record),
    ...(xnlName ? { name: xnlName } : {}),
    envelopeVersion: record.metadata.envelopeVersion,
    specVersion: record.metadata.specVersion,
    version,
    description: requiredDescription(record),
    metadata: { ...(parsedMetadata as Record<string, unknown>), version },
    template,
    resourceMappings: await readOptionalMaterial(module, record, "ResourceMappings"),
    includes: nodeMembers(record.node.subdomains.Includes)
      .filter((node) => node.tag === "Include")
      .map((include) => ({
        kind: requiredNodeProperty(include, "kind", record),
        ref: requiredNodeProperty(include, "ref", record),
      })),
    dependencies: nodeMembers(record.node.subdomains.SkillDependencies)
      .filter((node) => node.tag === "SkillDependency")
      .map((dependency) => {
        const ref = requiredNodeProperty(dependency, "ref", record)
        return {
          ref,
          fqn: resourceRefToFqn(ref),
          version: requiredNodeProperty(dependency, "version", record),
        }
      }),
    source: sourceFor(module, record),
  }
}

function assertSkillDependencyBindings(
  skills: readonly SkillCapsuleResource[],
  byFqn: ReadonlyMap<string, AssemblyResource>,
): void {
  for (const skill of skills) {
    const seen = new Set<string>()
    for (const dependency of skill.dependencies) {
      if (seen.has(dependency.fqn)) {
        throw new Error(`SKILL_DEPENDENCY_DUPLICATE: ${skill.fqn} declares ${dependency.fqn} more than once`)
      }
      seen.add(dependency.fqn)
      const target = byFqn.get(dependency.fqn)
      if (!target) {
        throw new Error(`SKILL_DEPENDENCY_MISSING: ${skill.fqn} dependency ${dependency.ref} does not exist`)
      }
      if (target.kind !== "SkillCapsule") {
        throw new Error(
          `SKILL_DEPENDENCY_KIND_MISMATCH: ${skill.fqn} dependency ${dependency.ref} targets ${target.kind}`,
        )
      }
      if (target.version !== dependency.version) {
        throw new Error(
          `SKILL_DEPENDENCY_VERSION_MISMATCH: ${skill.fqn} dependency ${dependency.ref} expected ${dependency.version} but found ${target.version}`,
        )
      }
    }
  }
}

async function readOptionalMaterial(
  module: AuthoringModuleDescriptor,
  record: ResourceRecord,
  childName: string,
): Promise<TextMaterial | undefined> {
  const child = record.node.subdomains[childName]
  if (!child) return undefined
  const href = optionalNodeProperty(child, "href")
  if (!href) return undefined
  return readMaterial(module, record, href, optionalNodeProperty(child, "format"))
}

async function readRequiredMaterial(
  module: AuthoringModuleDescriptor,
  record: ResourceRecord,
  childName: string,
): Promise<TextMaterial> {
  const material = await readOptionalMaterial(module, record, childName)
  if (!material) {
    throw new Error(`${record.logicalPath} is missing required ${childName} material`)
  }
  return material
}

async function readMaterial(
  module: AuthoringModuleDescriptor,
  record: ResourceRecord,
  href: string,
  format: string | undefined,
): Promise<TextMaterial> {
  const absolutePath = resolveMaterialHref(module, record, href)
  return {
    href,
    format,
    absolutePath,
    content: await readFile(absolutePath, "utf8"),
  }
}

function requiredNodeCodeBinding(record: ResourceRecord): CodeBinding {
  const moduleBinding = requiredNodeCodeModuleBinding(record)
  const codeBinding = requiredNode(record, "CodeBinding")
  return {
    ...moduleBinding,
    exportName: requiredNodeProperty(codeBinding, "export", record),
  }
}

function requiredNodeCodeModuleBinding(record: ResourceRecord): CodeModuleBinding {
  const codeBinding = requiredNode(record, "CodeBinding")
  const packageName = requiredNodeProperty(codeBinding, "package", record)
  const module = requiredNodeProperty(codeBinding, "module", record)
  return {
    packageName,
    module,
    moduleSpecifier: module.startsWith("./") ? `${packageName}/${module.slice(2)}` : module,
  }
}

function refsFromNodeContainer(value: ResourceNode | undefined, childName: string): string[] {
  return nodeMembers(value)
    .filter((node) => node.tag === childName)
    .map((node) => optionalNodeProperty(node, "ref"))
    .filter((ref): ref is string => Boolean(ref))
}

function resolveMaterialHref(module: AuthoringModuleDescriptor, record: ResourceRecord, href: string): string {
  const relativePrefix = href.startsWith("vfs://./") ? "vfs://./" : undefined
  const rootPrefix = href.startsWith("vfs://@/") ? "vfs://@/" : undefined
  const prefix = relativePrefix ?? rootPrefix
  if (!prefix) {
    throw new Error(`Unsupported material href '${href}' in ${record.logicalPath}`)
  }
  const local = href.slice(prefix.length)
  if (!local || local.includes("..") || local.includes("\\") || local.startsWith("/")) {
    throw new Error(`Unsafe material href '${href}' in ${record.logicalPath}`)
  }
  const source = sourceFor(module, record)
  const base = rootPrefix ? source.resourceRootDir : source.directory
  return join(base, local)
}

function sourceFor(module: AuthoringModuleDescriptor, record: ResourceRecord): ResourceSource {
  const relative = record.logicalPath.replace(/^vfs:\/\/@\//, "")
  return {
    logicalPath: record.logicalPath,
    directory: join(module.resourceRootDir, dirname(relative)),
    moduleId: module.id,
    packageName: module.packageName,
    resourceRootDir: module.resourceRootDir,
  }
}

function assertUniqueModuleIds(modules: readonly AuthoringModuleDescriptor[]) {
  const ids = new Set<string>()
  for (const module of modules) {
    if (!/^[A-Z][A-Za-z0-9]*$/.test(module.id)) {
      throw new Error(`Authoring module id must be a PascalCase segment: ${module.id}`)
    }
    if (ids.has(module.id)) {
      throw new Error(`Duplicate authoring module id: ${module.id}`)
    }
    ids.add(module.id)
  }
}

function uniqueResourceMap<T extends { fqn: string; source: ResourceSource }>(resources: readonly T[]): ReadonlyMap<string, T> {
  const byFqn = new Map<string, T>()
  for (const resource of resources) {
    const prior = byFqn.get(resource.fqn)
    if (prior) {
      throw new Error(
        `Duplicate resource FQN ${resource.fqn} from ${prior.source.packageName}:${prior.source.logicalPath} and ${resource.source.packageName}:${resource.source.logicalPath}`,
      )
    }
    byFqn.set(resource.fqn, resource)
  }
  return byFqn
}

function assertObjectOperationAssemblyClosure(
  resources: readonly AssemblyResource[],
  byFqn: ReadonlyMap<string, AssemblyResource | BusinessActionResource | BusinessMutationResource>,
): ReadonlyMap<string, ObjectOperationCompilation> {
  const owners = resources.filter(isObjectOperationOwner)
  const catalog: ObjectOperationCatalog = {
    targetKinds: owners.flatMap((owner) => owner.targetKinds),
    operations: owners.flatMap((owner) => owner.operations),
  }
  assertObjectOperationCatalog(catalog)

  const boundResources = new Set<string>()
  const compilations = new Map<string, ObjectOperationCompilation>()
  for (const owner of owners) {
    for (const definition of owner.operations) {
      const binding = requireObjectOperationBinding(definition)
      if (binding.kind === "export") {
        compilations.set(definition.ref, { codeBinding: binding.codeBinding })
        continue
      }
      const resourceFqn = resourceRefToFqn(binding.resourceRef)
      if (boundResources.has(resourceFqn)) {
        throw new Error(`Object operation resource ${resourceFqn} is bound more than once`)
      }
      boundResources.add(resourceFqn)
      const resource = byFqn.get(resourceFqn)
      const expectedKind = definition.behavior === "action" ? "BusinessAction" : "BusinessMutation"
      if (!resource) {
        throw new Error(`Object operation ${definition.ref} binds unknown resource ${resourceFqn}`)
      }
      if (resource.kind !== expectedKind) {
        throw new Error(`Object operation ${definition.ref} requires ${expectedKind}, received ${resource.kind}`)
      }
      const expectedOwnerRef = `resource://${definition.ownerKindFqn}`
      if (resource.ownerRef !== expectedOwnerRef) {
        throw new Error(`Object operation ${definition.ref} binding owner does not match ${expectedOwnerRef}`)
      }
      compilations.set(definition.ref, {
        codeBinding: resource.codeBinding,
        ...(resource.kind === "BusinessAction"
          ? {
              inputContractRef: resource.inputContractRef,
              outputContractRef: resource.outputContractRef,
            }
          : {}),
      })
    }
  }
  return compilations
}

function isObjectOperationOwner(
  resource: AssemblyResource,
): resource is PageObjectResource | BusinessObjectResource {
  return resource.kind === "PageObject" || resource.kind === "BusinessObject"
}

function resolvePortBindings(
  ports: readonly AssemblyPort[],
  bindings: readonly AssemblyPortBinding[],
  resources: ReadonlyMap<string, AssemblyResource>,
): ResolvedAssemblyPortBinding[] {
  const portsByFqn = new Map<string, AssemblyPort>()
  for (const port of ports) {
    if (portsByFqn.has(port.fqn)) throw new Error(`Duplicate assembly port FQN: ${port.fqn}`)
    portsByFqn.set(port.fqn, port)
  }

  const resolved: ResolvedAssemblyPortBinding[] = []
  const boundPorts = new Set<string>()
  for (const binding of bindings) {
    if (boundPorts.has(binding.portFqn)) throw new Error(`Assembly port is bound more than once: ${binding.portFqn}`)
    const port = portsByFqn.get(binding.portFqn)
    if (!port) throw new Error(`Unknown assembly port: ${binding.portFqn}`)
    const resourceFqn = resourceRefToFqn(binding.resourceRef)
    const resource = resources.get(resourceFqn)
    if (!resource) throw new Error(`Assembly port ${binding.portFqn} targets unknown resource: ${resourceFqn}`)
    if (resource.kind !== port.resourceKind) {
      throw new Error(`Assembly port ${binding.portFqn} requires ${port.resourceKind}, received ${resource.kind}`)
    }
    if (port.contractRef && isContractedCallable(resource)) {
      const contracts = [resource.inputContractRef, resource.outputContractRef]
      if (!contracts.includes(port.contractRef)) {
        throw new Error(`Assembly port ${binding.portFqn} requires contract ${port.contractRef}`)
      }
    }
    boundPorts.add(binding.portFqn)
    resolved.push({ ...binding, port, resource })
  }

  for (const port of ports) {
    if (!port.optional && !boundPorts.has(port.fqn)) {
      throw new Error(`Required assembly port is not bound: ${port.fqn}`)
    }
  }
  return resolved.sort((left, right) => left.portFqn.localeCompare(right.portFqn))
}

function isContractedCallable(resource: AssemblyResource): resource is ContractedCallableResource {
  return resource.kind === "Function" || resource.kind === "ComposedFunction"
}

function requiredFqn(record: ResourceRecord): string {
  if (!record.fqn) {
    throw new Error(`${record.logicalPath} is missing fqn`)
  }
  return record.fqn
}

function requiredDescription(record: ResourceRecord): string {
  if (!record.description) {
    throw new Error(`${record.logicalPath} ${record.kind} is missing description`)
  }
  return record.description
}

function requiredNode(record: ResourceRecord, childName: string): ResourceNode {
  const child = record.node.subdomains[childName]
  if (!child) throw new Error(`${record.logicalPath} is missing ${childName}`)
  return child
}

function requiredNodeRef(record: ResourceRecord, childName: string): string {
  return requiredNodeProperty(requiredNode(record, childName), "ref", record)
}

function requiredRootProperty(record: ResourceRecord, name: string): string {
  const value = stringResourceValue(record.node.properties[name])
  if (!value) throw new Error(`${record.logicalPath} ${record.kind} is missing ${name}`)
  return value
}

function requiredNodeProperty(node: ResourceNode, name: string, record: ResourceRecord): string {
  const value = optionalNodeProperty(node, name)
  if (!value) throw new Error(`${record.logicalPath} ${node.tag} is missing ${name}`)
  return value
}

function optionalNodeProperty(node: ResourceNode, name: string): string | undefined {
  return stringResourceValue(node.properties[name])
}

function requiredNodeStringList(node: ResourceNode, name: string, record: ResourceRecord): string[] {
  const value = node.properties[name]
  if (!Array.isArray(value)) {
    throw new Error(`${record.logicalPath} ${node.tag} is missing ${name}`)
  }
  const strings = value.map(stringResourceValue)
  if (strings.some((item) => !item)) {
    throw new Error(`${record.logicalPath} ${node.tag} ${name} must contain strings`)
  }
  return strings as string[]
}

function nodeMembers(node: ResourceNode | undefined): ResourceNode[] {
  return (node?.body ?? []).filter(isResourceNode)
}

function isResourceNode(value: ResourceValue): value is ResourceNode {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "tag" in value
}

function stringResourceValue(value: ResourceValue | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined
}

export function resourceRefToFqn(ref: string): string {
  if (!ref.startsWith("resource://")) {
    throw new Error(`Unsupported resource reference '${ref}'`)
  }
  return ref.slice("resource://".length)
}

export const applicationAssemblyPackage = {
  role: "framework",
  area: "application-assembly",
  owns: "resource registry facts normalized for target-neutral compiler projections",
} as const

export * from "./code-execution-closure"
