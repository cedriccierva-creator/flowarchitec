import type { Edge } from '@vue-flow/core'
import { createWorkflowNode } from './nodeCatalog'
import type { WorkflowNode } from './nodeCatalog'

// Factories keep the demo reset independent of Vue Flow's reactive mutations.
export function createSampleNodes(): WorkflowNode[] {
  return [
    createWorkflowNode('webhook', 'webhook', { x: 0, y: 100 }),
    createWorkflowNode('http', 'http', { x: 235, y: 100 }),
    createWorkflowNode('router', 'router', { x: 470, y: 100 }),
    createWorkflowNode('agent', 'agent', { x: 730, y: 0 }),
    createWorkflowNode('error', 'error', { x: 730, y: 235 }),
  ]
}

export function createSampleEdges(): Edge[] {
  return [
    { id: 'webhook-http', source: 'webhook', sourceHandle: 'out', target: 'http', targetHandle: 'in' },
    { id: 'http-router', source: 'http', sourceHandle: 'out', target: 'router', targetHandle: 'in' },
    { id: 'router-agent', source: 'router', sourceHandle: 'success', target: 'agent', targetHandle: 'in' },
    {
      id: 'router-error', source: 'router', sourceHandle: 'error', target: 'error', targetHandle: 'in',
      style: { stroke: '#ba8277', strokeDasharray: '5 5' },
    },
  ]
}
