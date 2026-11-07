import { compareCodeUnits } from './canonical'

export interface KindIdentityEntry<T> {
  readonly kind: string
  readonly subjectFqn: string
  readonly value: T
}

/** A read-only projection: full subjects resolve exactly; only unique short names resolve. */
export function createKindIdentityMap<T>(entries: readonly KindIdentityEntry<T>[]): ReadonlyMap<string, T> {
  const subjects = new Map(entries.map(entry => [entry.subjectFqn, entry]))
  const aliases = new Map<string, string[]>()
  for (const entry of subjects.values()) {
    const candidates = aliases.get(entry.kind) ?? []
    candidates.push(entry.subjectFqn)
    aliases.set(entry.kind, candidates)
  }
  const projection = new Map([...subjects.values()]
    .map(entry => [aliases.get(entry.kind)!.length === 1 ? entry.kind : entry.subjectFqn, entry.value] as const)
    .sort(([left], [right]) => compareCodeUnits(left, right)))
  const view: ReadonlyMap<string, T> = Object.freeze({
    get size() { return projection.size },
    get(key: string) {
      const exact = subjects.get(key)
      if (exact) return exact.value
      const candidates = aliases.get(key)
      if (candidates && candidates.length > 1) {
        throw new Error(`KIND_SUBJECT_AMBIGUOUS: Kind '${key}' requires an explicit subject: ${[...candidates].sort(compareCodeUnits).join(', ')}.`)
      }
      return candidates ? subjects.get(candidates[0]!)?.value : undefined
    },
    has: (key: string) => subjects.has(key) || aliases.has(key),
    entries: () => projection.entries(),
    keys: () => projection.keys(),
    values: () => projection.values(),
    forEach(callback: (value: T, key: string, map: ReadonlyMap<string, T>) => void, thisArg?: unknown) {
      projection.forEach((value, key) => callback.call(thisArg, value, key, view))
    },
    [Symbol.iterator]: () => projection[Symbol.iterator](),
  })
  return view
}
