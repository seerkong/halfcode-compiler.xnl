const authenticLoadedResourceTrees = new WeakSet<object>()

export function markLoadedResourceTreeAuthentic<T extends object>(tree: T): T {
  authenticLoadedResourceTrees.add(tree)
  return tree
}

export function isLoadedResourceTreeAuthentic(tree: object): boolean {
  return authenticLoadedResourceTrees.has(tree)
}
