import { describe, expect, test } from "bun:test"
import { ResourceSourceMigrationRegistry } from "./index"

interface Document {
  specVersion: number
  value: number
}

describe("ResourceSourceMigrationRegistry", () => {
  test("plans and applies a unique ordered migration chain", () => {
    const registry = new ResourceSourceMigrationRegistry<Document>()
      .register({ id: "demo.v1-to-v2", subjectFqn: "Halfcode.ResourceKind.Demo", fromWriterSpecVersion: 1, toWriterSpecVersion: 2, migrate: (value) => ({ ...value, specVersion: 2, value: value.value + 1 }) })
      .register({ id: "demo.v2-to-v3", subjectFqn: "Halfcode.ResourceKind.Demo", fromWriterSpecVersion: 2, toWriterSpecVersion: 3, migrate: (value) => ({ ...value, specVersion: 3, value: value.value + 1 }) })

    expect(registry.plan("Halfcode.ResourceKind.Demo", 1, 3).map((step) => step.id)).toEqual([
      "demo.v1-to-v2",
      "demo.v2-to-v3",
    ])
    expect(registry.migrate("Halfcode.ResourceKind.Demo", 1, 3, { specVersion: 1, value: 1 })).toEqual({ specVersion: 3, value: 3 })
  })

  test("rejects missing, ambiguous, cyclic, and duplicate migration definitions", () => {
    const missing = new ResourceSourceMigrationRegistry<Document>()
    expect(() => missing.plan("Halfcode.ResourceKind.Demo", 1, 2)).toThrow("No source migration")

    const ambiguous = new ResourceSourceMigrationRegistry<Document>()
      .register({ id: "a", subjectFqn: "Halfcode.ResourceKind.Demo", fromWriterSpecVersion: 1, toWriterSpecVersion: 2, migrate: (value) => value })
      .register({ id: "b", subjectFqn: "Halfcode.ResourceKind.Demo", fromWriterSpecVersion: 1, toWriterSpecVersion: 3, migrate: (value) => value })
    expect(() => ambiguous.plan("Halfcode.ResourceKind.Demo", 1, 3)).toThrow("Ambiguous source migration")

    const cyclic = new ResourceSourceMigrationRegistry<Document>()
      .register({ id: "forward", subjectFqn: "Halfcode.ResourceKind.Demo", fromWriterSpecVersion: 1, toWriterSpecVersion: 2, migrate: (value) => value })
      .register({ id: "back", subjectFqn: "Halfcode.ResourceKind.Demo", fromWriterSpecVersion: 2, toWriterSpecVersion: 1, migrate: (value) => value })
    expect(() => cyclic.plan("Halfcode.ResourceKind.Demo", 1, 3)).toThrow("cycle")
    expect(() => cyclic.register({ id: "forward", subjectFqn: "Halfcode.ResourceKind.Other", fromWriterSpecVersion: 1, toWriterSpecVersion: 2, migrate: (value) => value })).toThrow("Duplicate migration id")
  })
})
