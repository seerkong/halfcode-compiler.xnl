import type { ResourceDiagnostic } from "./index"

export class ResourceCompositionError extends Error {
  readonly diagnostics: readonly ResourceDiagnostic[]

  constructor(diagnostics: readonly ResourceDiagnostic[]) {
    super(`Resource composition failed with ${diagnostics.length} diagnostic(s)`)
    this.name = "ResourceCompositionError"
    this.diagnostics = Object.freeze([...diagnostics])
  }
}
