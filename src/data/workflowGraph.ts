import type { Connection, Dimensions, XYPosition } from '@vue-flow/core'
import { architectTile } from './nodeCatalog'
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

export function findNodePosition(
  project: (point: XYPosition) => XYPosition,
  { width, height }: Dimensions,
  nodes: readonly WorkflowNode[],
  preferred?: XYPosition,
): XYPosition {
  const center = project({ x: width / 2, y: height / 2 })
  const centeredTile = { x: center.x - architectTile.width / 2, y: center.y - architectTile.height / 2 }
  const insetStart = project({ x: 24, y: 24 })
  const insetEnd = project({ x: width - 24, y: height - 60 })
  const left = Math.min(insetStart.x, centeredTile.x)
  const top = Math.min(insetStart.y, centeredTile.y)
  const right = Math.max(left, insetEnd.x - architectTile.width)
  const bottom = Math.max(top, insetEnd.y - architectTile.height)
  const anchor = preferred ?? centeredTile
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
