import { h, render } from 'vue'
import { getBezierPath, Position } from '@vue-flow/core'
import { clientCard, defaultNodeColors, nodeCatalog, nodeColors, nodeIcons, outputPortFraction, workflowHandleSize } from './nodeCatalog'
import { errorEdgeStyle } from './sampleWorkflow'
import type { WorkflowDocument } from './workflowDocument'

const padding = 40
const background = '#201f1c'
const connectionColor = '#8f8b82'
const fontFamily = 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
const graphemes = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : undefined

function wrapText(context: CanvasRenderingContext2D, value: string, width: number, size: number, weight: number) {
  const lines: string[] = []
  // Keep imported text serializable as XML, including lone UTF-16 surrogates.
  let remaining = value.replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '\uFFFD')
    .trim().replace(/\s+/gu, ' ')
  context.font = weight + ' ' + size + 'px ' + fontFamily
  const fits = (text: string) => context.measureText(text).width <= width
  while (remaining && lines.length < 2) {
    if (fits(remaining)) {
      lines.push(remaining)
      break
    }
    const lastLine = lines.length === 1
    let prefix = ''
    const characters = graphemes ? Array.from(graphemes.segment(remaining), ({ segment }) => segment) : Array.from(remaining)
    for (const segment of characters) {
      if (!fits(prefix + segment + (lastLine ? '…' : ''))) break
      prefix += segment
    }
    if (lastLine) {
      lines.push(prefix.trimEnd() + '…')
      break
    }
    const breakAt = prefix.lastIndexOf(' ')
    const line = breakAt > 0 && remaining[prefix.length] !== ' ' ? prefix.slice(0, breakAt) : prefix.trimEnd()
    lines.push(line)
    remaining = remaining.slice(line.length || 1).trimStart()
  }
  return lines
}

function clientNode(context: CanvasRenderingContext2D, node: WorkflowDocument['nodes'][number]) {
  const { width, height } = clientCard
  const { accent, border } = nodeColors[node.color ?? defaultNodeColors[node.kind]]
  const label = wrapText(context, node.clientLabel ?? node.label, width - 48, 13, 650)
  const description = node.businessDescription ? wrapText(context, node.businessDescription, width - 22, 11, 400) : []
  const headingHeight = Math.max(19, label.length * 15.6)
  const descriptionHeight = description.length * 13.2
  const top = (height - headingHeight - (descriptionHeight ? 5 + descriptionHeight : 0)) / 2
  const lines = (content: string[], x: number, y: number, size: number, weight: number, fill: string) =>
    h('text', { x, fill, 'font-size': size, 'font-weight': weight, 'clip-path': 'url(#card-text)' },
      content.map((line, index) => h('tspan', { x, y: y + index * size * 1.2 }, line)))

  return h('g', { transform: 'translate(' + node.position.x + ' ' + node.position.y + ')' }, [
    h('rect', { x: 0.5, y: 0.5, width: width - 1, height: height - 1, rx: 11.5, fill: '#292722', stroke: border }),
    h(nodeIcons[node.icon ?? node.kind].icon, {
      x: 11, y: top + (headingHeight - 19) / 2, size: 19, color: accent, strokeWidth: 1.7,
    }),
    lines(label, 37, top + (headingHeight - label.length * 15.6) / 2 + 12.5, 13, 650, '#f0e9dd'),
    ...(description.length ? [lines(description, 11, top + headingHeight + 15.5, 11, 400, '#c3bbae')] : []),
  ])
}

export async function exportPng(workflow: WorkflowDocument): Promise<string> {
  const { nodes, edges } = workflow
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) throw new Error('PNG rendering is unavailable.')

  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  function include(x: number, y: number) {
    left = Math.min(left, x)
    top = Math.min(top, y)
    right = Math.max(right, x)
    bottom = Math.max(bottom, y)
  }

  for (const { position: { x, y } } of nodes) {
    include(x, y)
    include(x + clientCard.width, y + clientCard.height)
  }

  const paths = edges.map((edge) => {
    const source = nodesById.get(edge.source)!
    const target = nodesById.get(edge.target)!
    const outputs = nodeCatalog[source.kind].outputs
    const port = outputs.findIndex(({ id }) => id === edge.sourceHandle)
    const [path] = getBezierPath({
      sourceX: source.position.x + clientCard.width + workflowHandleSize,
      sourceY: source.position.y + clientCard.height * outputPortFraction(port, outputs.length),
      sourcePosition: Position.Right,
      targetX: target.position.x - workflowHandleSize,
      targetY: target.position.y + clientCard.height / 2,
      targetPosition: Position.Left,
    })
    // The cubic stays inside the bounds of its two endpoints and two control points.
    for (const point of path.slice(1).replace('C', '').split(' ')) {
      if (!point) continue
      const [x, y] = point.split(',').map(Number)
      include(x!, y!)
    }
    return h('path', {
      d: path, fill: 'none', 'stroke-width': 1.6, 'marker-end': 'url(#arrow)',
      stroke: edge.appearance === 'error' ? errorEdgeStyle.stroke : connectionColor,
      'stroke-dasharray': edge.appearance === 'error' ? errorEdgeStyle.strokeDasharray : undefined,
    })
  })

  if (!nodes.length) {
    include(0, 0)
    include(240, 80)
  }
  const width = Math.ceil(right - left + 2 * padding)
  const height = Math.ceil(bottom - top + 2 * padding)
  // Keep unusually large layouts within WebKit's canvas memory and dimension limits.
  const scale = Math.min(2, 8192 / width, 8192 / height, Math.sqrt(16_000_000 / (width * height)))
  const pixelWidth = Math.max(1, Math.floor(width * scale))
  const pixelHeight = Math.max(1, Math.floor(height * scale))
  const scene = h('svg', {
    width: pixelWidth, height: pixelHeight, viewBox: [left - padding, top - padding, width, height].join(' '),
    'font-family': fontFamily,
  }, [
    h('defs', [
      h('clipPath', { id: 'card-text' }, [
        h('rect', { x: 11, y: 8, width: clientCard.width - 22, height: clientCard.height - 16 }),
      ]),
      h('marker', { id: 'arrow', viewBox: '-10 -10 20 20', markerWidth: 16, markerHeight: 16, orient: 'auto' }, [
        h('polyline', {
          points: '-5,-4 0,0 -5,4 -5,-4', stroke: connectionColor, fill: connectionColor,
          'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        }),
      ]),
    ]),
    ...paths,
    ...nodes.map((node) => clientNode(context, node)),
    ...(!nodes.length ? [h('text', { x: 120, y: 45, fill: '#c3bbae', 'text-anchor': 'middle', 'font-size': 14 }, 'No nodes in this workflow')] : []),
  ])

  const container = document.createElement('div')
  render(scene, container)
  const svg = new XMLSerializer().serializeToString(container.firstElementChild!)
  render(null, container)
  // A plain SVG image with no HTML or external resources remains canvas-readable in WebKit.
  const image = new Image()
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('Could not render the workflow diagram.'))
    image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  })

  canvas.width = pixelWidth
  canvas.height = pixelHeight
  context.fillStyle = background
  context.fillRect(0, 0, pixelWidth, pixelHeight)
  context.drawImage(image, 0, 0)
  try {
    const png = canvas.toDataURL('image/png')
    if (!png.startsWith('data:image/png;base64,')) throw new Error('Could not encode the workflow as PNG.')
    const encoded = png.slice('data:image/png;base64,'.length)
    // The first 32 base64 characters contain the PNG signature and IHDR dimensions.
    const header = atob(encoded.slice(0, 32))
    const dimension = (offset: number) =>
      header.charCodeAt(offset) * 2 ** 24 + header.charCodeAt(offset + 1) * 2 ** 16
      + header.charCodeAt(offset + 2) * 256 + header.charCodeAt(offset + 3)
    if (dimension(16) !== pixelWidth || dimension(20) !== pixelHeight) {
      throw new Error(`The PNG encoder did not produce the requested ${pixelWidth} × ${pixelHeight} image.`)
    }
    return encoded
  } finally {
    canvas.width = canvas.height = 1
  }
}
