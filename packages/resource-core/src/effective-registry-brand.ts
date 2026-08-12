const authenticEffectiveRegistries = new WeakSet<object>()
const effectiveRegistryLayers = new WeakMap<object, readonly EffectiveRegistryLayerBinding[]>()

export interface EffectiveRegistryLayerBinding {
  readonly id: string
  readonly tree: object
}

export function markEffectiveRegistryAuthentic<T extends object>(
  registry: T,
  layers: readonly EffectiveRegistryLayerBinding[] = [],
): T {
  authenticEffectiveRegistries.add(registry)
  effectiveRegistryLayers.set(registry, Object.freeze(layers.map((layer) => Object.freeze({ ...layer }))))
  return registry
}

export function isEffectiveRegistryAuthentic(registry: object): boolean {
  return authenticEffectiveRegistries.has(registry)
}

export function effectiveRegistryLayerBindings(registry: object): readonly EffectiveRegistryLayerBinding[] | undefined {
  return effectiveRegistryLayers.get(registry)
}
