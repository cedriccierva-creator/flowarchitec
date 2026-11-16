import { Bot, Braces, Clock, Database, GitBranch, Globe, Mail, ShieldAlert, Webhook, Zap } from 'lucide-vue-next'
import type { Node } from '@vue-flow/core'

export const nodeIcons = {
  webhook: { label: 'Webhook', icon: Webhook },
  http: { label: 'Globe', icon: Globe },
  router: { label: 'Branch', icon: GitBranch },
  agent: { label: 'Bot', icon: Bot },
  error: { label: 'Shield', icon: ShieldAlert },
  code: { label: 'Code', icon: Braces },
  clock: { label: 'Clock', icon: Clock },
  database: { label: 'Database', icon: Database },
  mail: { label: 'Mail', icon: Mail },
  bolt: { label: 'Lightning', icon: Zap },
}

export const nodeColors = {
  amber: { label: 'Amber', accent: '#d3ac74', border: '#6b5840' },
  blue: { label: 'Blue', accent: '#92aebe', border: '#485c66' },
  green: { label: 'Green', accent: '#a3b88d', border: '#526047' },
  violet: { label: 'Violet', accent: '#b4a3cc', border: '#60516f' },
  rose: { label: 'Rose', accent: '#d0988c', border: '#74544b' },
}

export const nodeCatalog = {
  webhook: { label: 'Webhook Trigger', caption: 'Receive an event', input: false, outputs: [{ id: 'out', label: 'Event' }] },
  http: { label: 'HTTP Request', caption: 'Fetch the details', input: true, outputs: [{ id: 'out', label: 'Response' }] },
  router: {
    label: 'Router', caption: 'Choose a path', input: true,
    outputs: [{ id: 'success', label: 'Success' }, { id: 'error', label: 'Error' }],
  },
  agent: { label: 'AI Agent', caption: 'Plan an AI step', input: true, outputs: [{ id: 'out', label: 'Result' }] },
  error: { label: 'Error Handler', caption: 'Handle a failure', input: true, outputs: [{ id: 'out', label: 'Recovery' }] },
}

export type NodeKind = keyof typeof nodeCatalog
export type NodeIcon = keyof typeof nodeIcons
export type NodeColor = keyof typeof nodeColors

export const defaultNodeColors: Record<NodeKind, NodeColor> = {
  webhook: 'amber', http: 'blue', router: 'green', agent: 'violet', error: 'rose',
}

export const clientCard = { width: 140, height: 88 }
export const workflowHandleSize = 12

export function outputPortFraction(index: number, count: number) {
  return (index + 1) / (count + 1)
}

export interface WorkflowNodeData {
  kind: NodeKind
  label: string
  clientLabel?: string
  businessDescription?: string
  caption: string
  input: boolean
  outputs: { id: string; label: string }[]
  icon?: NodeIcon
  color?: NodeColor
}

export type WorkflowNode = Node<WorkflowNodeData> & { data: WorkflowNodeData }

export function createWorkflowNode(kind: NodeKind, id: string, position: WorkflowNode['position']): WorkflowNode {
  const definition = nodeCatalog[kind]
  return {
    id, type: 'workflow', position,
    data: { ...definition, kind, outputs: definition.outputs.map((port) => ({ ...port })) },
  }
}
