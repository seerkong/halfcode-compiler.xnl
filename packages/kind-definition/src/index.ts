import type { ResourceDescriptor, ResourceKindContract } from "halfcode-compiler-resource-core"

export interface KindDefinition extends ResourceDescriptor, ResourceKindContract {
  kind: "KindDefinition"
}

export interface ResourceSourceMigrationDefinition<T> {
  id: string
  subjectFqn: string
  fromWriterSpecVersion: number
  toWriterSpecVersion: number
  migrate: (resource: T) => T
}

export class ResourceSourceMigrationRegistry<T> {
  private readonly definitions: ResourceSourceMigrationDefinition<T>[] = []
  private readonly ids = new Set<string>()

  register(definition: ResourceSourceMigrationDefinition<T>): this {
    if (this.ids.has(definition.id)) throw new Error(`Duplicate migration id '${definition.id}'`)
    if (!definition.id || !definition.subjectFqn
      || !Number.isSafeInteger(definition.fromWriterSpecVersion) || definition.fromWriterSpecVersion <= 0
      || !Number.isSafeInteger(definition.toWriterSpecVersion) || definition.toWriterSpecVersion <= 0) {
      throw new Error("Source migration definitions require id, subjectFqn and positive writer spec versions")
    }
    if (definition.fromWriterSpecVersion === definition.toWriterSpecVersion) {
      throw new Error(`Migration '${definition.id}' must change writer specVersion`)
    }
    this.ids.add(definition.id)
    this.definitions.push(Object.freeze({ ...definition }))
    return this
  }

  plan(subjectFqn: string, fromWriterSpecVersion: number, toWriterSpecVersion: number): readonly ResourceSourceMigrationDefinition<T>[] {
    if (fromWriterSpecVersion === toWriterSpecVersion) return []
    const steps: ResourceSourceMigrationDefinition<T>[] = []
    const visited = new Set<number>()
    let current = fromWriterSpecVersion
    while (current !== toWriterSpecVersion) {
      if (visited.has(current)) throw new Error(`Source migration cycle detected for '${subjectFqn}' at writer specVersion ${current}`)
      visited.add(current)
      const candidates = this.definitions.filter((definition) => definition.subjectFqn === subjectFqn && definition.fromWriterSpecVersion === current)
      if (candidates.length === 0) throw new Error(`No source migration for '${subjectFqn}' from writer specVersion ${current} to ${toWriterSpecVersion}`)
      if (candidates.length > 1) throw new Error(`Ambiguous source migration for '${subjectFqn}' from writer specVersion ${current}: ${candidates.map((candidate) => candidate.id).join(", ")}`)
      const step = candidates[0]
      steps.push(step)
      current = step.toWriterSpecVersion
    }
    return Object.freeze(steps)
  }

  migrate(subjectFqn: string, fromWriterSpecVersion: number, toWriterSpecVersion: number, resource: T): T {
    return this.plan(subjectFqn, fromWriterSpecVersion, toWriterSpecVersion).reduce((value, step) => step.migrate(value), resource)
  }
}

export const kindDefinitionPackage = {
  role: "framework",
  area: "kind-definition",
  owns: "resource kind validation authority",
} as const

export * from "./versioned-contracts"
export * from "./resource-tree-resolution"
export * from "./core-kind-contracts"
