import { describe, expect, test } from "bun:test"
import { ResourceMigrationRegistry } from "./index"

interface Document {
  apiVersion: string
  value: number
}

describe("ResourceMigrationRegistry", () => {
  test("plans and applies a unique ordered migration chain", () => {
    const registry = new ResourceMigrationRegistry<Document>()
      .register({ id: "demo.v1-to-v2", resourceKind: "Demo", fromApiVersion: "demo/v1", toApiVersion: "demo/v2", migrate: (value) => ({ ...value, apiVersion: "demo/v2", value: value.value + 1 }) })
      .register({ id: "demo.v2-to-v3", resourceKind: "Demo", fromApiVersion: "demo/v2", toApiVersion: "demo/v3", migrate: (value) => ({ ...value, apiVersion: "demo/v3", value: value.value + 1 }) })

    expect(registry.plan("Demo", "demo/v1", "demo/v3").map((step) => step.id)).toEqual([
      "demo.v1-to-v2",
      "demo.v2-to-v3",
    ])
    expect(registry.migrate("Demo", "demo/v1", "demo/v3", { apiVersion: "demo/v1", value: 1 })).toEqual({ apiVersion: "demo/v3", value: 3 })
  })

  test("rejects missing, ambiguous, cyclic, and duplicate migration definitions", () => {
    const missing = new ResourceMigrationRegistry<Document>()
    expect(() => missing.plan("Demo", "demo/v1", "demo/v2")).toThrow("No migration")

    const ambiguous = new ResourceMigrationRegistry<Document>()
      .register({ id: "a", resourceKind: "Demo", fromApiVersion: "demo/v1", toApiVersion: "demo/v2", migrate: (value) => value })
      .register({ id: "b", resourceKind: "Demo", fromApiVersion: "demo/v1", toApiVersion: "demo/v3", migrate: (value) => value })
    expect(() => ambiguous.plan("Demo", "demo/v1", "demo/v3")).toThrow("Ambiguous migration")

    const cyclic = new ResourceMigrationRegistry<Document>()
      .register({ id: "forward", resourceKind: "Demo", fromApiVersion: "demo/v1", toApiVersion: "demo/v2", migrate: (value) => value })
      .register({ id: "back", resourceKind: "Demo", fromApiVersion: "demo/v2", toApiVersion: "demo/v1", migrate: (value) => value })
    expect(() => cyclic.plan("Demo", "demo/v1", "demo/v3")).toThrow("cycle")
    expect(() => cyclic.register({ id: "forward", resourceKind: "Other", fromApiVersion: "x/v1", toApiVersion: "x/v2", migrate: (value) => value })).toThrow("Duplicate migration id")
  })
})
