import type { ResourceDescriptor, ResourceKindContract } from "halfcode-compiler-resource-core"

export interface KindDefinition extends ResourceDescriptor, ResourceKindContract {
  kind: "KindDefinition"
}

export interface ResourceMigrationDefinition<T> {
  id: string
  resourceKind: string
  fromApiVersion: string
  toApiVersion: string
  migrate: (resource: T) => T
}

export class ResourceMigrationRegistry<T> {
  private readonly definitions: ResourceMigrationDefinition<T>[] = []
  private readonly ids = new Set<string>()

  register(definition: ResourceMigrationDefinition<T>): this {
    if (this.ids.has(definition.id)) throw new Error(`Duplicate migration id '${definition.id}'`)
    if (!definition.id || !definition.resourceKind || !definition.fromApiVersion || !definition.toApiVersion) {
      throw new Error("Migration definitions require id, resourceKind, fromApiVersion, and toApiVersion")
    }
    if (definition.fromApiVersion === definition.toApiVersion) {
      throw new Error(`Migration '${definition.id}' must change apiVersion`)
    }
    this.ids.add(definition.id)
    this.definitions.push(Object.freeze({ ...definition }))
    return this
  }

  plan(resourceKind: string, fromApiVersion: string, toApiVersion: string): readonly ResourceMigrationDefinition<T>[] {
    if (fromApiVersion === toApiVersion) return []
    const steps: ResourceMigrationDefinition<T>[] = []
    const visited = new Set<string>()
    let current = fromApiVersion
    while (current !== toApiVersion) {
      if (visited.has(current)) throw new Error(`Migration cycle detected for Kind '${resourceKind}' at '${current}'`)
      visited.add(current)
      const candidates = this.definitions.filter((definition) => definition.resourceKind === resourceKind && definition.fromApiVersion === current)
      if (candidates.length === 0) throw new Error(`No migration for Kind '${resourceKind}' from '${current}' to '${toApiVersion}'`)
      if (candidates.length > 1) throw new Error(`Ambiguous migration for Kind '${resourceKind}' from '${current}': ${candidates.map((candidate) => candidate.id).join(", ")}`)
      const step = candidates[0]
      steps.push(step)
      current = step.toApiVersion
    }
    return Object.freeze(steps)
  }

  migrate(resourceKind: string, fromApiVersion: string, toApiVersion: string, resource: T): T {
    return this.plan(resourceKind, fromApiVersion, toApiVersion).reduce((value, step) => step.migrate(value), resource)
  }
}

export const kindDefinitionPackage = {
  role: "framework",
  area: "kind-definition",
  owns: "resource kind validation authority",
} as const
