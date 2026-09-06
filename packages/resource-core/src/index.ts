import { createDirectoryResourcePackageReadPort } from "./directory-resource-package-read-port"
import { buildXnlResourceTree } from "./xnl-loader"
import type { Sha256Digest } from "./dependency-snapshot"
import type { ResourcePackageReadPortOptions } from "./resource-package-read-port"
import type { ResourceMetadata, SpecVersion } from "./resource-version-contracts"
import type {
  KindSemanticContract,
  PortableSpec,
  ResourceResolutionReceipt,
} from "./versioned-contract-types"

export type SourceShape = "single-file" | "directory" | "manifest"

export interface ResourceIdentity {
  kind: string
  fqn?: string
  name?: string
}

export interface ResourceDescriptor extends ResourceIdentity {
  description?: string
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
  format: "xnl" | "markdown"
  node: ResourceNode
}

export interface AuthoredResourceSpec {
  readonly properties: Readonly<Record<string, ResourceValue>>
  readonly body: readonly ResourceValue[]
  readonly subdomains: Readonly<Record<string, ResourceNode>>
  readonly text?: string
}

export interface AuthoredResourceRecord extends ResourceRecord {
  readonly stage: "authored"
  readonly subjectFqn: string
  readonly authoredSpec: AuthoredResourceSpec
  readonly sourceContentDigest: Sha256Digest
}

export interface KindSpecRevisionDescriptor {
  readonly specVersion: SpecVersion
  readonly schemaRef: string
  readonly schemaFingerprint: Sha256Digest
  readonly contractFingerprint: Sha256Digest
  readonly semanticContract: KindSemanticContract
  readonly stability: "experimental" | "stable" | "deprecated"
}

export interface ResourceKindContract {
  readonly resourceKind: string
  readonly subjectFqn: string
  readonly sourceShapes: readonly SourceShape[]
  readonly specRevisions: readonly KindSpecRevisionDescriptor[]
  readonly documentCardinality?: "one" | "many"
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

export interface AuthoredResourceRegistry extends ResourceRegistry {
  readonly byKind: ReadonlyMap<string, readonly AuthoredResourceRecord[]>
}

export interface ResourceTree {
  manifest: ResourceRecord
  registry: ResourceRegistry
  diagnostics: readonly ResourceDiagnostic[]
}

export interface AuthoredResourceTree extends ResourceTree {
  readonly stage: "authored"
  readonly manifest: AuthoredResourceRecord
  readonly registry: AuthoredResourceRegistry
  readonly contentIdentities: ReadonlyMap<string, import("./dependency-snapshot").ResourceContentIdentity>
  /** Provenance of external KindDefinitions used during this tree's decode. */
  readonly kindDefinitionImports?: readonly KindDefinitionImportReceipt[]
}

export interface KindDefinitionImportReceipt {
  readonly treeDigest: Sha256Digest
  readonly kinds: readonly string[]
}

export interface ResolvedResourceRecord<ReaderValue = unknown> extends ResourceRecord {
  readonly stage: "resolved"
  readonly subjectFqn: string
  readonly source: AuthoredResourceRecord
  readonly readerId: string
  readonly readerSpecVersion: SpecVersion
  readonly resolvedSpec: PortableSpec
  readonly readerValue: ReaderValue
  readonly resolution: ResourceResolutionReceipt
  readonly effectiveContentDigest: Sha256Digest
}

export interface ResolvedResourceRegistry extends ResourceRegistry {
  readonly byKind: ReadonlyMap<string, readonly ResolvedResourceRecord[]>
}

export interface ResolvedResourceTree extends ResourceTree {
  readonly stage: "resolved"
  readonly source: AuthoredResourceTree
  readonly manifest: ResolvedResourceRecord
  readonly registry: ResolvedResourceRegistry
  readonly readerProfileId: string
  readonly receipts: readonly ResourceResolutionReceipt[]
  readonly effectiveContentIdentities: ReadonlyMap<string, Sha256Digest>
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

export interface AuthoredResourceTreeBuildResult extends ResourceTreeBuildResult {
  tree?: AuthoredResourceTree
}

export class ResourceValidationError extends Error {
  readonly diagnostics: readonly ResourceDiagnostic[]

  constructor(diagnostics: readonly ResourceDiagnostic[]) {
    super(`Resource validation failed with ${diagnostics.length} diagnostic(s)`)
    this.name = "ResourceValidationError"
    this.diagnostics = diagnostics
  }
}

export async function loadResourceTree(options: LoadResourceTreeOptions): Promise<AuthoredResourceTree> {
  const unsupported = unsupportedAuthorityDiagnostic(options)
  if (unsupported) throw new ResourceValidationError([unsupported])
  const manifestPath = options.manifestPath ?? "manifest.xnl"
  const result = await buildXnlResourceTree({
    port: await createDirectoryResourcePackageReadPort(options.rootDir),
    rootPath: "/",
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
    port: await createDirectoryResourcePackageReadPort(options.rootDir),
    rootPath: "/",
    manifestPath,
  })
  return result.diagnostics
}

export async function loadResourceTreeFromReadPort(options: ResourcePackageReadPortOptions): Promise<AuthoredResourceTree> {
  const unsupported = unsupportedReadPortAuthorityDiagnostic(options)
  if (unsupported) throw new ResourceValidationError([unsupported])
  const result = await buildXnlResourceTree({
    port: options.port,
    rootPath: options.rootPath ?? "/",
    manifestPath: options.manifestPath ?? "manifest.xnl",
    kindDefinitionImports: options.kindDefinitionImports,
  })
  if (result.diagnostics.length > 0 || !result.tree) {
    throw new ResourceValidationError(result.diagnostics)
  }
  return result.tree
}

export async function validateResourceTreeFromReadPort(options: ResourcePackageReadPortOptions): Promise<ResourceDiagnostic[]> {
  const unsupported = unsupportedReadPortAuthorityDiagnostic(options)
  if (unsupported) return [unsupported]
  const result = await buildXnlResourceTree({
    port: options.port,
    rootPath: options.rootPath ?? "/",
    manifestPath: options.manifestPath ?? "manifest.xnl",
    kindDefinitionImports: options.kindDefinitionImports,
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

function unsupportedReadPortAuthorityDiagnostic(options: ResourcePackageReadPortOptions): ResourceDiagnostic | undefined {
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
export * from "./resource-material"
export * from "./resource-package-read-port"
export * from "./directory-resource-package-read-port"
export * from "./resource-version-contracts"
export * from "./versioned-contract-types"
export * from "./resource-envelope"
export { canonicalJson, compareCodeUnits, digestCanonical } from "./canonical"
