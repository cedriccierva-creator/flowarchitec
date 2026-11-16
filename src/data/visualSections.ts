import type { Dimensions, XYPosition } from '@vue-flow/core'
import { architectTile } from './nodeCatalog'
import type { NodeColor } from './nodeCatalog'

export interface VisualSection {
  id: string
  title: string
  description?: string
  color: NodeColor
  position: XYPosition
  width: number
  height: number
}

export type SectionGeometry = Pick<VisualSection, 'position' | 'width' | 'height'>

export const sectionTitleLimit = 80
export const sectionDescriptionLimit = 240
export const minimumSection = { width: 160, height: 100 }
export const maximumSectionSize = 10_000_000
export const sectionPositionLimit = 10_000_000

export function clampSectionPosition(position: XYPosition): XYPosition {
  return {
    x: Math.min(sectionPositionLimit, Math.max(-sectionPositionLimit, position.x)),
    y: Math.min(sectionPositionLimit, Math.max(-sectionPositionLimit, position.y)),
  }
}

export function createSection(id: string, canvas: Dimensions, zoom: number, project: (point: XYPosition) => XYPosition): VisualSection {
  const width = Math.max(minimumSection.width, Math.min(400, (canvas.width - 48) / zoom))
  const height = Math.max(minimumSection.height, Math.min(240, (canvas.height - 48) / zoom))
  const center = project({ x: canvas.width / 2, y: canvas.height / 2 })
  return {
    id, title: 'New Section', color: 'blue', width, height,
    position: clampSectionPosition({ x: center.x - width / 2, y: center.y - height / 2 }),
  }
}

export function sectionMembers<T extends { position: XYPosition }>(sections: readonly VisualSection[], nodes: readonly T[]) {
  const members = new Map(sections.map(({ id }) => [id, [] as T[]]))
  if (!sections.length) return members
  for (const node of nodes) {
    const x = node.position.x + architectTile.width / 2
    const y = node.position.y + architectTile.height / 2
    // The last containing section is painted on top. Rectangular boundaries are inclusive.
    for (let index = sections.length - 1; index >= 0; index--) {
      const section = sections[index]!
      const { position, width, height } = section
      if (x >= position.x && x <= position.x + width && y >= position.y && y <= position.y + height) {
        members.get(section.id)!.push(node)
        break
      }
    }
  }
  return members
}
