import type { Edge } from '@vue-flow/core'
import { createWorkflowNode, nodeCatalog, nodeColors, nodeIcons } from './nodeCatalog'
import type { NodeColor, NodeIcon, NodeKind, WorkflowNode } from './nodeCatalog'
import { createSampleEdges, createSampleNodes, errorEdgeStyle } from './sampleWorkflow'
import { canConnect } from './workflowGraph'

export const overviewFields = ['summary', 'goals', 'assumptions', 'constraints'] as const
export const nodeDocumentationFields = ['purpose', 'inputs', 'outputs', 'configuration', 'errorHandling'] as const
export const documentationLimit = 8_000

export type OverviewField = typeof overviewFields[number]
export type NodeDocumentationField = typeof nodeDocumentationFields[number]
export type ProjectOverview = Partial<Record<OverviewField, string>>
export type NodeDocumentation = Partial<Record<NodeDocumentationField, string>>

interface ProjectMetadata {
  name: string
  overview?: ProjectOverview
}

interface DocumentNode {
  id: string
  kind: NodeKind
  position: { x: number; y: number }
  label: string
  icon?: NodeIcon
  color?: NodeColor
  documentation?: NodeDocumentation
}

interface DocumentEdge {
  id: string
  source: string
  sourceHandle: string
  target: string
  targetHandle: string
  label?: string
  appearance?: 'error'
  description?: string
}

export interface WorkflowDocument {
  schemaVersion: 1
  metadata: ProjectMetadata
  nodes: DocumentNode[]
  edges: DocumentEdge[]
}

export const untitled = 'Untitled workflow'

export function captureWorkflow(
  metadata: ProjectMetadata,
  nodes: readonly WorkflowNode[],
  edges: readonly Edge[],
  nodeDocumentation?: ReadonlyMap<string, NodeDocumentation>,
  edgeDescriptions?: ReadonlyMap<string, string>,
): WorkflowDocument {
  return {
    schemaVersion: 1,
    metadata: { name: metadata.name, overview: readNotes(metadata.overview, overviewFields) },
    nodes: nodes.map(({ id, position, data }) => ({
      id, kind: data.kind, position: { x: position.x, y: position.y }, label: data.label,
      icon: data.icon, color: data.color,
      documentation: readNotes(nodeDocumentation?.get(id), nodeDocumentationFields),
    })),
    edges: edges.map(({ id, source, sourceHandle, target, targetHandle, label, style }) => ({
      id, source, sourceHandle: sourceHandle!, target, targetHandle: targetHandle!,
      label: typeof label === 'string' && label ? label : undefined,
      appearance: typeof style === 'object' && style.stroke === errorEdgeStyle.stroke ? 'error' : undefined,
      description: edgeDescriptions?.get(id),
    })),
  }
}

export function demoWorkflow() {
  return captureWorkflow({ name: 'From event to action' }, createSampleNodes(), createSampleEdges())
}

export function materializeNode(node: DocumentNode): WorkflowNode {
  const result = createWorkflowNode(node.kind, node.id, { ...node.position })
  Object.assign(result.data, { label: node.label, icon: node.icon, color: node.color })
  return result
}

export function materializeEdge(edge: DocumentEdge): Edge {
  const { id, source, sourceHandle, target, targetHandle, label, appearance } = edge
  return { id, source, sourceHandle, target, targetHandle, label, style: appearance === 'error' ? { ...errorEdgeStyle } : undefined }
}

function asRecord(value: unknown, message = 'Invalid workflow structure.'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message)
  return value as Record<string, unknown>
}

function boundedText(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('Invalid workflow text.')
  return value
}

export function readDocumentationText(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error('Documentation must contain plain text.')
  const normalized = value.replace(/\r\n?/g, '\n')
  if (normalized.length > documentationLimit) throw new Error(`Documentation fields are limited to ${documentationLimit} characters.`)
  return normalized.trim() ? normalized : undefined
}

function readNotes<K extends string>(value: unknown, fields: readonly K[]): Partial<Record<K, string>> | undefined {
  if (value === undefined) return undefined
  const raw = asRecord(value, 'Invalid documentation structure.')
  const notes: Partial<Record<K, string>> = {}
  for (const field of fields) {
    const note = readDocumentationText(raw[field])
    if (note !== undefined) notes[field] = note
  }
  return Object.keys(notes).length ? notes : undefined
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

  const metadata = asRecord(raw.metadata)
  const name = boundedText(metadata.name, 100)
  const overview = readNotes(metadata.overview, overviewFields)
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
      documentation: readNotes(node.documentation, nodeDocumentationFields),
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
      description: readDocumentationText(edge.description),
    }
  })
  return { schemaVersion: 1, metadata: { name, overview }, nodes, edges }
}
