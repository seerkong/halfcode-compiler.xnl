import { digestCanonical } from "./canonical"

export const RESOURCE_ENVELOPE_VERSION = "halfcode.resource-envelope/v1" as const

export const CORE_BOOTSTRAP_WRITER_SPEC_VERSIONS = Object.freeze({
  ResourcePackage: 1,
  KindDefinition: 1,
} as const)

/**
 * Canonical, compiler-owned facts enforced by the v1 resource-envelope decoder.
 * Consumers may fingerprint this descriptor, but must not restate it.
 */
export const RESOURCE_ENVELOPE_CONTRACT = Object.freeze({
  envelopeVersion: RESOURCE_ENVELOPE_VERSION,
  requiredFields: Object.freeze(["envelopeVersion", "specVersion"] as const),
  optionalFields: Object.freeze(["lifecycle"] as const),
  removedFields: Object.freeze(["apiVersion", "version"] as const),
  removedFieldScopes: Object.freeze(["resource-root", "metadata"] as const),
  specVersion: Object.freeze({
    type: "integer" as const,
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER,
  }),
  lifecycle: Object.freeze({ type: "string" as const }),
  outputFields: Object.freeze(["envelopeVersion", "specVersion", "lifecycle"] as const),
  bootstrapKinds: Object.freeze({
    ResourcePackage: Object.freeze({ writerSpecVersion: CORE_BOOTSTRAP_WRITER_SPEC_VERSIONS.ResourcePackage }),
    KindDefinition: Object.freeze({ writerSpecVersion: CORE_BOOTSTRAP_WRITER_SPEC_VERSIONS.KindDefinition }),
  }),
  catalogTraversal: Object.freeze({
    authority: "resource-envelope" as const,
    containerTag: "Catalogs" as const,
    entryTags: Object.freeze([
      "Catalog",
      "FileResourceCatalog",
      "DirectoryResourceCatalog",
      "ManifestResourceCatalog",
    ] as const),
    sourceShapes: Object.freeze(["single-file", "directory", "manifest"] as const),
    shapeFields: Object.freeze(["kind", "shape", "root", "entry", "scope"] as const),
    phase: "authored-load-before-business-resolution" as const,
  }),
  authorityFormats: Object.freeze({
    packageManifest: "xnl" as const,
    resourceDocuments: Object.freeze(["xnl", "markdown"] as const),
    markdownFrontmatter: "yaml" as const,
    markdownBody: "all-source-text-after-closing-frontmatter-and-one-separator-newline" as const,
  }),
  identityProjection: Object.freeze({
    xnl: "root-#id" as const,
    markdown: "frontmatter-metadata.fqn" as const,
    recordFields: Object.freeze(["resourceId", "fqn"] as const),
  }),
  authoredSpecProjection: Object.freeze({
    fields: Object.freeze(["properties", "body", "subdomains", "text"] as const),
    resourceMetadataExcluded: true,
    markdownBodyField: "text" as const,
  }),
} as const)

export const RESOURCE_ENVELOPE_FINGERPRINT = digestCanonical(RESOURCE_ENVELOPE_CONTRACT)

export type SpecVersion = number

export interface ResourceMetadata {
  readonly envelopeVersion: string
  readonly specVersion: SpecVersion
  readonly lifecycle?: string
}

export function isSpecVersion(value: unknown): value is SpecVersion {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
}
