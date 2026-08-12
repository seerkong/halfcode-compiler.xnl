import { resolve } from "node:path"
import { buildXnlResourceTree } from "./xnl-loader"

export type SourceShape = "single-file" | "directory" | "manifest"

export interface ResourceIdentity {
  kind: string
  fqn?: string
  name?: string
}

export interface ResourceDescriptor extends ResourceIdentity {
  description?: string
}

export interface ResourceMetadata {
  apiVersion: string
  lifecycle?: string
  version?: string
}

export type ResourceScalar = string | number | boolean | null
export interface ResourceValueList extends ReadonlyArray<ResourceValue> {}
export interface ResourceValueMap extends Readonly<Record<string, ResourceValue>> {}
export type ResourceValue = ResourceScalar | ResourceNode | ResourceValueList | ResourceValueMap

export interface ResourceNode {
  readonly tag: string
  readonly resourceId?: string
  readonly metadata: Readonly<Record<string, ResourceValue>>
  readonly properties: Readonly<Record<string, ResourceValue>>
  readonly body: readonly ResourceValue[]
  readonly subdomains: Readonly<Record<string, ResourceNode>>
  readonly text?: string
}

export interface ResourceRecord extends ResourceDescriptor {
  resourceId: string
  metadata: ResourceMetadata
  sourceShape: SourceShape
  logicalPath: string
  documentUri: string
  format: "xnl"
  node: ResourceNode
}

export interface ResourceKindContract {
  resourceKind: string
  sourceShapes: readonly SourceShape[]
  currentApiVersion: string
  supportedApiVersions: readonly string[]
  documentCardinality?: "one" | "many"
}

export interface RegisteredKindDefinition extends ResourceKindContract {
  resourceId: string
  requiredFiles: readonly string[]
  documentCardinality: "one" | "many"
  documentUri: string
}

export interface ResourceRegistry {
  readonly byKind: ReadonlyMap<string, readonly ResourceRecord[]>
  readonly kindDefinitions: ReadonlyMap<string, RegisteredKindDefinition>
}

export interface ResourceTree {
  manifest: ResourceRecord
  registry: ResourceRegistry
  diagnostics: readonly ResourceDiagnostic[]
}

export interface LoadedResourceTree extends ResourceTree {
  readonly contentIdentities: ReadonlyMap<string, import("./dependency-snapshot").ResourceContentIdentity>
}

export interface ResourceDiagnostic {
  code: string
  location: string
  message: string
  hint?: string
}

export interface LoadResourceTreeOptions {
  rootDir: string
  manifestPath?: string
}

export interface ResourceTreeBuildResult {
  diagnostics: ResourceDiagnostic[]
  tree?: ResourceTree
}

export interface LoadedResourceTreeBuildResult extends ResourceTreeBuildResult {
  tree?: LoadedResourceTree
}

export class ResourceValidationError extends Error {
  readonly diagnostics: readonly ResourceDiagnostic[]

  constructor(diagnostics: readonly ResourceDiagnostic[]) {
    super(`Resource validation failed with ${diagnostics.length} diagnostic(s)`)
    this.name = "ResourceValidationError"
    this.diagnostics = diagnostics
  }
}

export async function loadResourceTree(options: LoadResourceTreeOptions): Promise<LoadedResourceTree> {
  const unsupported = unsupportedAuthorityDiagnostic(options)
  if (unsupported) throw new ResourceValidationError([unsupported])
  const manifestPath = options.manifestPath ?? "manifest.xnl"
  const result = await buildXnlResourceTree({
    ...options,
    rootDir: resolve(options.rootDir),
    manifestPath,
  })
  if (result.diagnostics.length > 0 || !result.tree) {
    throw new ResourceValidationError(result.diagnostics)
  }
  return result.tree
}

export async function validateResourceTree(options: LoadResourceTreeOptions): Promise<ResourceDiagnostic[]> {
  const unsupported = unsupportedAuthorityDiagnostic(options)
  if (unsupported) return [unsupported]
  const manifestPath = options.manifestPath ?? "manifest.xnl"
  const result = await buildXnlResourceTree({
    ...options,
    rootDir: resolve(options.rootDir),
    manifestPath,
  })
  return result.diagnostics
}

function unsupportedAuthorityDiagnostic(options: LoadResourceTreeOptions): ResourceDiagnostic | undefined {
  const manifestPath = options.manifestPath ?? "manifest.xnl"
  if (!manifestPath.toLowerCase().endsWith(".xnl")) {
    return {
      code: "RESOURCE_AUTHORITY_FORMAT_UNSUPPORTED",
      location: `vfs://@/${manifestPath}`,
      message: "Resource package manifests must use XNL authority.",
    }
  }
  return undefined
}

export * from "./composition-error"
export * from "./layered-registry"
export * from "./dependency-snapshot"
export * from "./effective-content-identities"
