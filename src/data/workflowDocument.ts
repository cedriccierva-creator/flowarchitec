import type { Edge } from '@vue-flow/core'
import { createWorkflowNode, nodeCatalog, nodeColors, nodeIcons } from './nodeCatalog'
import type { NodeColor, NodeIcon, NodeKind, WorkflowNode } from './nodeCatalog'
import { createSampleEdges, createSampleNodes, errorEdgeStyle } from './sampleWorkflow'
import { canConnect } from './workflowGraph'

interface ProjectMetadata {
  name: string
}

interface DocumentNode {
  id: string
  kind: NodeKind
  position: { x: number; y: number }
  label: string
  icon?: NodeIcon
  color?: NodeColor
}

interface DocumentEdge {
  id: string
  source: string
  sourceHandle: string
  target: string
  targetHandle: string
  label?: string
  appearance?: 'error'
}

export interface WorkflowDocument {
  schemaVersion: 1
  metadata: ProjectMetadata
  nodes: DocumentNode[]
  edges: DocumentEdge[]
}

export const untitled = 'Untitled workflow'

export function captureWorkflow(name: string, nodes: readonly WorkflowNode[], edges: readonly Edge[]): WorkflowDocument {
  return {
    schemaVersion: 1,
    metadata: { name },
    nodes: nodes.map(({ id, position, data }) => ({
      id, kind: data.kind, position: { x: position.x, y: position.y }, label: data.label,
      icon: data.icon, color: data.color,
    })),
    edges: edges.map(({ id, source, sourceHandle, target, targetHandle, label, style }) => ({
      id, source, sourceHandle: sourceHandle!, target, targetHandle: targetHandle!,
      label: typeof label === 'string' && label ? label : undefined,
      appearance: typeof style === 'object' && style.stroke === errorEdgeStyle.stroke ? 'error' : undefined,
    })),
  }
}

export function demoWorkflow() {
  return captureWorkflow('From event to action', createSampleNodes(), createSampleEdges())
}

export function materializeNode(node: DocumentNode): WorkflowNode {
  const result = createWorkflowNode(node.kind, node.id, { ...node.position })
  Object.assign(result.data, { label: node.label, icon: node.icon, color: node.color })
  return result
}

export function materializeEdge({ appearance, ...edge }: DocumentEdge): Edge {
  return { ...edge, style: appearance === 'error' ? { ...errorEdgeStyle } : undefined }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid workflow structure.')
  return value as Record<string, unknown>
}

function boundedText(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('Invalid workflow text.')
  return value
}

function coordinate(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 10_000_000) throw new Error('Invalid node position.')
  return value
}

function catalogKey<T extends object>(catalog: T, value: unknown): Extract<keyof T, string> {
  if (typeof value !== 'string' || !Object.hasOwn(catalog, value)) throw new Error('Unknown node type, icon, or color.')
  return value as Extract<keyof T, string>
}

export function parseWorkflow(json: string): WorkflowDocument {
  let raw: Record<string, unknown>
  try {
    raw = asRecord(JSON.parse(json))
  } catch {
    throw new Error('The file does not contain a workflow JSON object.')
  }

  if (raw.schemaVersion !== 1) throw new Error('Unsupported workflow schema version.')
  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) throw new Error('The workflow is missing nodes or connections.')

  const name = boundedText(asRecord(raw.metadata).name, 100)
  const ids = new Set<string>()
  function uniqueId(value: unknown) {
    const id = boundedText(value, 128)
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || Object.hasOwn(Object.prototype, id)) throw new Error('Invalid node or connection ID.')
    if (ids.has(id)) throw new Error('The workflow contains duplicate IDs.')
    ids.add(id)
    return id
  }

  const nodes = raw.nodes.map((value: unknown): DocumentNode => {
    const node = asRecord(value)
    const position = asRecord(node.position)
    return {
      id: uniqueId(node.id),
      kind: catalogKey(nodeCatalog, node.kind),
      position: { x: coordinate(position.x), y: coordinate(position.y) },
      label: boundedText(node.label, 80),
      icon: node.icon === undefined ? undefined : catalogKey(nodeIcons, node.icon),
      color: node.color === undefined ? undefined : catalogKey(nodeColors, node.color),
    }
  })
  const nodesById = new Map(nodes.map((node) => [node.id, materializeNode(node)]))
  const connections = new Set<string>()
  const edges = raw.edges.map((value: unknown): DocumentEdge => {
    const edge = asRecord(value)
    const source = boundedText(edge.source, 128)
    const target = boundedText(edge.target, 128)
    const sourceHandle = boundedText(edge.sourceHandle, 48)
    const targetHandle = boundedText(edge.targetHandle, 48)
    const from = nodesById.get(source)
    const to = nodesById.get(target)
    const connection = { source, sourceHandle, target, targetHandle }
    const key = JSON.stringify([source, sourceHandle, target, targetHandle])
    if (!from || !to || !canConnect(connection, [from, to], []) || connections.has(key)) {
      throw new Error('The workflow contains an invalid or duplicate connection.')
    }
    connections.add(key)
    const appearance = edge.appearance
    if (appearance !== undefined && appearance !== 'error') throw new Error('Unknown connection appearance.')
    return {
      id: uniqueId(edge.id), ...connection,
      label: edge.label === undefined ? undefined : boundedText(edge.label, 48),
      appearance,
    }
  })
  return { schemaVersion: 1, metadata: { name }, nodes, edges }
}
