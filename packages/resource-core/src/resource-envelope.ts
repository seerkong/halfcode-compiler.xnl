import {
  RESOURCE_ENVELOPE_VERSION,
  isSpecVersion,
  type ResourceMetadata,
} from "./resource-version-contracts"
import type { ResourceDiagnostic } from "./index"

export interface ResourceMetadataDecodeInput {
  readonly fields: Readonly<Record<string, unknown>>
  readonly removedFieldContainers?: readonly Readonly<Record<string, unknown>>[]
  readonly lifecycle?: unknown
  readonly location: string
  readonly source: "XNL" | "Markdown"
}

export type ResourceMetadataDecodeResult =
  | Readonly<{ metadata: ResourceMetadata }>
  | Readonly<{ diagnostic: ResourceDiagnostic }>

export function decodeResourceMetadata(input: ResourceMetadataDecodeInput): ResourceMetadataDecodeResult {
  const removedFieldContainers = [input.fields, ...(input.removedFieldContainers ?? [])]
  if (removedFieldContainers.some((container) => hasOwn(container, "apiVersion") || hasOwn(container, "version"))) {
    return failure(
      "RESOURCE_METADATA_FIELD_REMOVED",
      input,
      `${input.source} resources must not declare removed apiVersion or version metadata.`,
    )
  }
  if (!hasOwn(input.fields, "envelopeVersion") || !hasOwn(input.fields, "specVersion")) {
    return failure(
      "RESOURCE_METADATA_FIELD_MISSING",
      input,
      `${input.source} resources require envelopeVersion and specVersion.`,
    )
  }
  const envelopeVersion = input.fields.envelopeVersion
  if (typeof envelopeVersion !== "string" || envelopeVersion !== RESOURCE_ENVELOPE_VERSION) {
    return failure(
      "RESOURCE_ENVELOPE_VERSION_UNSUPPORTED",
      input,
      `${input.source} resource envelopeVersion must be '${RESOURCE_ENVELOPE_VERSION}'.`,
    )
  }
  if (!isSpecVersion(input.fields.specVersion)) {
    return failure(
      "RESOURCE_SPEC_VERSION_INVALID",
      input,
      `${input.source} resource specVersion must be a positive safe integer.`,
    )
  }
  if (input.lifecycle !== undefined && typeof input.lifecycle !== "string") {
    return failure(
      "RESOURCE_METADATA_FIELD_INVALID",
      input,
      `${input.source} resource lifecycle must be a string when present.`,
    )
  }
  return Object.freeze({
    metadata: Object.freeze({
      envelopeVersion,
      specVersion: input.fields.specVersion,
      ...(input.lifecycle === undefined ? {} : { lifecycle: input.lifecycle }),
    }),
  })
}

function failure(
  code: string,
  input: ResourceMetadataDecodeInput,
  message: string,
): Readonly<{ diagnostic: ResourceDiagnostic }> {
  return Object.freeze({ diagnostic: Object.freeze({ code, location: input.location, message }) })
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}
