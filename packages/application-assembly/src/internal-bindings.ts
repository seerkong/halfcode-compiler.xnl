import type { ApplicationAssembly, CodeBinding, ObjectOperationDefinition } from "./index"

export type ObjectOperationBinding =
  | { readonly kind: "export"; readonly codeBinding: CodeBinding }
  | { readonly kind: "resource"; readonly resourceRef: string }

export interface ObjectOperationCompilation {
  readonly codeBinding: CodeBinding
  readonly inputContractRef?: string
  readonly outputContractRef?: string
}

const bindingsByDefinition = new WeakMap<ObjectOperationDefinition, ObjectOperationBinding>()
const compilationsByAssembly = new WeakMap<ApplicationAssembly, ReadonlyMap<string, ObjectOperationCompilation>>()
const compilationsByBusinessObjects = new WeakMap<
  ApplicationAssembly["businessObjects"],
  ReadonlyMap<string, ObjectOperationCompilation>
>()

export function setObjectOperationBinding(
  definition: ObjectOperationDefinition,
  binding: ObjectOperationBinding,
): void {
  bindingsByDefinition.set(definition, binding)
}

export function requireObjectOperationBinding(
  definition: ObjectOperationDefinition,
): ObjectOperationBinding {
  const binding = bindingsByDefinition.get(definition)
  if (!binding) throw new Error(`Object operation ${definition.ref} has no internal binding`)
  return binding
}

export function setObjectOperationCompilations(
  assembly: ApplicationAssembly,
  compilations: ReadonlyMap<string, ObjectOperationCompilation>,
): void {
  compilationsByAssembly.set(assembly, compilations)
  compilationsByBusinessObjects.set(assembly.businessObjects, compilations)
}

export function resolveObjectOperationCompilation(
  assembly: ApplicationAssembly,
  operationRef: string,
): ObjectOperationCompilation {
  const compilation = (compilationsByAssembly.get(assembly)
    ?? compilationsByBusinessObjects.get(assembly.businessObjects))?.get(operationRef)
  if (!compilation) throw new Error(`Unknown object operation: ${operationRef}`)
  return compilation
}
