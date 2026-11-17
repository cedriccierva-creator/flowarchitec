import { nodeCatalog } from './nodeCatalog'
import { nodeDocumentationFields, overviewFields } from './workflowDocument'
import type { WorkflowDocument } from './workflowDocument'

export interface ArchitectureFinding {
  id: string
  rule: string
  severity: 'warning' | 'info'
  target: { type: 'project' | 'node' | 'edge'; id?: string }
  title: string
  evidence: string
}

// Advisory graph/document checks only. No execution, note interpretation, or network access.
export function validateArchitecture(document: WorkflowDocument): ArchitectureFinding[] {
  const findings: ArchitectureFinding[] = []
  const add = (rule: string, severity: ArchitectureFinding['severity'], target: ArchitectureFinding['target'], title: string, evidence: string) => {
    findings.push({ id: JSON.stringify([rule, target.type, target.id ?? '']), rule, severity, target, title, evidence })
  }
  const blank = (value: string | undefined) => !value?.trim()
  const overviewMissing = overviewFields.filter((field) => blank(document.metadata.overview?.[field]))
  if (overviewMissing.length) add('project-documentation', 'info', { type: 'project' }, 'Missing project documentation', `Empty overview fields: ${overviewMissing.join(', ')}.`)

  const incoming = new Map<string, number>()
  const outgoing = new Map<string, number>()
  const errorSources = new Set<string>()
  for (const edge of document.edges) {
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1)
    outgoing.set(edge.source, (outgoing.get(edge.source) ?? 0) + 1)
    if (edge.sourceHandle === 'error') errorSources.add(edge.source)
  }
  for (const node of document.nodes) {
    const target = { type: 'node' as const, id: node.id }
    const reference = `${node.label} [${node.id}]`
    const inputs = incoming.get(node.id) ?? 0
    const outputs = outgoing.get(node.id) ?? 0
    if (!inputs && !outputs) {
      add('disconnected-node', 'warning', target, 'Disconnected node', `${reference} has no incoming or outgoing connections.`)
    } else if (nodeCatalog[node.kind].input && !inputs) {
      add('missing-incoming', 'warning', target, 'No incoming connection', `${reference} has an input port and zero incoming connections. Confirm whether this is an intended entry point.`)
    }
    const missing = nodeDocumentationFields.filter((field) => blank(node.documentation?.[field]))
    if (missing.length) add('node-documentation', 'info', target, 'Missing node documentation', `${reference} has empty fields: ${missing.join(', ')}.`)
    if (node.kind === 'router' && !errorSources.has(node.id)) {
      add('unconnected-error-output', 'warning', target, 'Unconnected Error output', `${reference} exposes an Error output with no connection. This does not prove runtime errors are unhandled.`)
    }
  }
  for (const edge of document.edges) {
    if (blank(edge.description)) add('connection-documentation', 'info', { type: 'edge', id: edge.id }, 'Missing connection documentation', `Connection [${edge.id}]: ${edge.source}.${edge.sourceHandle} → ${edge.target}.${edge.targetHandle} has no technical description. Labels and colors do not establish a data contract or error strategy.`)
  }
  return findings
}
