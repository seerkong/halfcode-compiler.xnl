import type { ResourceDescriptor } from "halfcode-compiler-resource-core"

export interface ResourceRegistry {
  readonly byKind: ReadonlyMap<string, readonly ResourceDescriptor[]>
}

export const resourceProjectionPackage = {
  role: "framework",
  area: "resource-projection",
  owns: "validated registry facts and target projection inputs",
} as const
