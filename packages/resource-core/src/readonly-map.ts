export function readonlyMap<K, V>(entries: Iterable<readonly [K, V]>): ReadonlyMap<K, V> {
  const values = new Map(entries)
  return Object.freeze({
    get size() {
      return values.size
    },
    get(key: K) {
      return values.get(key)
    },
    has(key: K) {
      return values.has(key)
    },
    entries() {
      return values.entries()
    },
    keys() {
      return values.keys()
    },
    values() {
      return values.values()
    },
    forEach(callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown) {
      const view = this as ReadonlyMap<K, V>
      values.forEach((value, key) => callback.call(thisArg, value, key, view))
    },
    [Symbol.iterator]() {
      return values[Symbol.iterator]()
    },
  }) as ReadonlyMap<K, V>
}
