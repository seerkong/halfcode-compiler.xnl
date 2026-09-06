const authenticAuthoredResourceTrees = new WeakSet<object>()

export function markAuthoredResourceTreeAuthentic<T extends object>(tree: T): T {
  authenticAuthoredResourceTrees.add(tree)
  return tree
}

export function isAuthoredResourceTreeAuthentic(tree: object): boolean {
  return authenticAuthoredResourceTrees.has(tree)
}
