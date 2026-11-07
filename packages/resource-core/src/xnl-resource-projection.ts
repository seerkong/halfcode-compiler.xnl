import { wordToString, type AttributeMap, type DataElementNode, type TextElementNode, type XnlNode } from "xnl-core"
import type { AuthoredResourceSpec, ResourceNode, ResourceValue } from "./index"

export function authoredSpecFromNode(node: ResourceNode) {
  return Object.freeze({
    properties: node.properties,
    body: node.body,
    subdomains: node.subdomains,
    ...(node.text === undefined ? {} : { text: node.text }),
  })
}

/** Shared semantic projection; callers retain the original AST/source for their existing editor. */
export function projectXnlResourceSpec(root: DataElementNode): AuthoredResourceSpec {
  return authoredSpecFromNode(normalizeNode(root))
}

export function normalizeNode(node: DataElementNode | TextElementNode): ResourceNode {
  const subdomains: Record<string, ResourceNode> = {}
  if (node.kind === "DataElement" && node.extend) {
    for (const name of node.extend.order) {
      const child = node.extend.children[name]
      if (child) subdomains[name] = normalizeNode(child)
    }
  }
  const resourceId = wordToString(node.id)
  return Object.freeze({
    tag: node.tag,
    ...(resourceId === undefined ? {} : { resourceId }),
    metadata: Object.freeze(normalizeMap(node.metadata)),
    properties: Object.freeze(normalizeMap(node.attributes)),
    body: Object.freeze(node.kind === "DataElement" ? (node.body ?? []).map(normalizeValue) : []),
    subdomains: Object.freeze(subdomains),
    ...(node.kind === "TextElement" ? { text: node.text ?? "" } : {}),
  })
}

function normalizeMap(map: AttributeMap | undefined): Record<string, ResourceValue> {
  return Object.fromEntries(Object.entries(map ?? {}).map(([key, value]) => [key, normalizeValue(value)]))
}

function normalizeValue(value: XnlNode): ResourceValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value
  if (Array.isArray(value)) return Object.freeze(value.map(normalizeValue))
  if (isElement(value)) return normalizeNode(value)
  if (isWord(value)) return wordToString(value) ?? ""
  if (isComment(value)) return value.value
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalizeValue(child)])))
}

function isElement(value: XnlNode): value is DataElementNode | TextElementNode {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "kind" in value && (value.kind === "DataElement" || value.kind === "TextElement")
}

function isWord(value: XnlNode): value is { kind: "Word"; namespace: string[]; name: string } {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "kind" in value && value.kind === "Word"
}

function isComment(value: XnlNode): value is { kind: "Comment"; value: string } {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "kind" in value && value.kind === "Comment"
}
