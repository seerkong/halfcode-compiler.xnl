import { createHash } from "node:crypto"

export type Sha256Digest = `sha256:${string}`

// ECMAScript relational comparison is defined over UTF-16 code units. Keeping
// the comparator explicit avoids host locale and ICU-version drift.
export function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

export function sha256Digest(value: string | Uint8Array): Sha256Digest {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`
}

export function digestCanonical(value: unknown): Sha256Digest {
  return sha256Digest(canonicalJson(value))
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizeCanonical(value))
}

function normalizeCanonical(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical values must contain only finite numbers")
    return Object.is(value, -0) ? 0 : value
  }
  if (Array.isArray(value)) return value.map(normalizeCanonical)
  if (value instanceof Map) {
    return [...value.entries()]
      .map(([key, item]) => [String(key), normalizeCanonical(item)] as const)
      .sort(([left], [right]) => compareCodeUnits(left, right))
  }
  if (typeof value === "object") {
    const normalized: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort(compareCodeUnits)) {
      const item = (value as Record<string, unknown>)[key]
      if (item !== undefined) normalized[key] = normalizeCanonical(item)
    }
    return normalized
  }
  throw new TypeError(`Unsupported canonical value type: ${typeof value}`)
}
