import type { Connection, Dimensions, ViewportTransform, XYPosition } from '@vue-flow/core'
import type { WorkflowNode } from './nodeCatalog'

export function canConnect(
  connection: Connection,
  nodes: readonly WorkflowNode[],
  edges: readonly (Connection & { id: string })[],
  replacingEdgeId?: string,
): boolean {
  if (connection.source === connection.target || connection.targetHandle !== 'in') return false

  const source = nodes.find((node) => node.id === connection.source)
  const target = nodes.find((node) => node.id === connection.target)
  if (!source?.data?.outputs.some((port) => port.id === connection.sourceHandle) || !target?.data?.input) return false

  return !edges.some((edge) => edge.id !== replacingEdgeId
    && edge.source === connection.source && edge.sourceHandle === connection.sourceHandle
    && edge.target === connection.target && edge.targetHandle === connection.targetHandle)
}

const tileSize = 72

export function findNodePosition(
  viewport: ViewportTransform,
  dimensions: Dimensions,
  nodes: readonly WorkflowNode[],
  preferred?: XYPosition,
): XYPosition {
  const { x, y, zoom } = viewport
  const left = (24 - x) / zoom
  const top = (24 - y) / zoom
  const right = Math.max(left, (dimensions.width - 24 - x) / zoom - tileSize)
  const bottom = Math.max(top, (dimensions.height - 60 - y) / zoom - tileSize)
  const anchor = preferred ?? {
    x: (dimensions.width / 2 - x) / zoom - tileSize / 2,
    y: (dimensions.height / 2 - y) / zoom - tileSize / 2,
  }
  const near = {
    x: Math.min(right, Math.max(left, anchor.x)),
    y: Math.min(bottom, Math.max(top, anchor.y)),
  }
  const isFree = (point: XYPosition) => nodes.every(({ position }) =>
    Math.abs(position.x - point.x) >= 106 || Math.abs(position.y - point.y) >= 126)
  if (isFree(near)) return near

  let closest: XYPosition | undefined
  let distance = Infinity
  for (let row = top; row <= bottom; row += 126) {
    for (let column = left; column <= right; column += 106) {
      const candidate = { x: column, y: row }
      const candidateDistance = Math.hypot(column - near.x, row - near.y)
      if (candidateDistance < distance && isFree(candidate)) {
        closest = candidate
        distance = candidateDistance
      }
    }
  }
  return closest ?? near
}
