import { CodeClosureError, validateCodeClosure, type CodeBinding, type CodeExecutionEnvironment, type FrozenCodeClosure } from "halfcode-compiler-application-assembly"

export interface CodeClosureExecutionRuntime {
  readonly environment: CodeExecutionEnvironment
  /** Explicit host exports for the exact identities declared in environment. */
  readonly ambientModules?: Readonly<Record<string, unknown>>
}
export interface RestoredCodeClosure {
  readonly binding: CodeBinding
  readonly closureDigest: string
  readonly exports: Readonly<Record<string, unknown>>
}

/** Each restore owns a fresh module table; this is not an untrusted-code sandbox. */
export function restoreCodeClosure(runtime: CodeClosureExecutionRuntime, input: FrozenCodeClosure, expectedDigest: string): RestoredCodeClosure {
  // Reject active objects before serialization, then detach validated JSON.
  validateCodeClosure(input, runtime.environment, expectedDigest)
  const closure: FrozenCodeClosure = JSON.parse(JSON.stringify(input))
  const ambient = new Map<string, unknown>()
  for (const name of Object.keys(closure.environment.ambient)) {
    if (!runtime.ambientModules || !Object.hasOwn(runtime.ambientModules, name)) throw new CodeClosureError("missing-ambient", `Missing explicit ambient exports: ${name}`)
    ambient.set(name, runtime.ambientModules[name])
  }
  const modules = new Map(closure.modules.map((module) => [module.path, module]))
  const assets = new Map(closure.assets.map((asset) => [asset.path, asset.format === "json" ? JSON.parse(asset.content) : asset.content]))
  const table = new Map<string, { exports: Record<string, unknown> }>()
  const load = (path: string): Record<string, unknown> => {
    const cached = table.get(path)
    if (cached) return cached.exports
    const source = modules.get(path)
    if (!source) throw new CodeClosureError("missing-module", `Frozen module absent: ${path}`)
    const module = { exports: {} as Record<string, unknown> }
    table.set(path, module)
    const edges = new Map(source.dependencies.map((edge) => [edge.specifier, edge]))
    const requireFrozen = (specifier: string): unknown => {
      const edge = edges.get(specifier)
      if (!edge) throw new CodeClosureError("undeclared-dependency", `No frozen edge for ${path}: ${specifier}`)
      if (edge.kind === "module") return load(edge.target)
      if (edge.kind === "asset") return assets.get(edge.target)
      return ambient.get(edge.target)
    }
    try {
      const evaluate = new Function("require", "module", "exports", source.code)
      evaluate(requireFrozen, module, module.exports)
      return module.exports
    } catch (error) {
      table.delete(path)
      throw error
    }
  }
  return Object.freeze({ binding: Object.freeze(closure.binding), closureDigest: closure.digest, exports: load(closure.entryPath) })
}

export function bindCodeClosure(runtime: CodeClosureExecutionRuntime, closure: FrozenCodeClosure, expectedDigest: string): (...args: unknown[]) => unknown {
  const restored = restoreCodeClosure(runtime, closure, expectedDigest)
  const callable = restored.exports[restored.binding.exportName]
  if (typeof callable !== "function") throw new CodeClosureError("missing-export", `CodeBinding export is not callable: ${restored.binding.exportName}`)
  return (...args: unknown[]) => Reflect.apply(callable, undefined, args)
}
