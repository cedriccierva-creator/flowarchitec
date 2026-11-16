<script setup lang="ts">
import { computed } from 'vue'
import type { Dimensions, GraphNode, Rect, ViewportTransform, XYPosition } from '@vue-flow/core'
import { nodeColors, defaultNodeColors } from '../data/nodeCatalog'
import type { WorkflowNodeData } from '../data/nodeCatalog'
import type { VisualSection } from '../data/visualSections'

const props = defineProps<{
  bounds: Rect
  nodes: GraphNode<WorkflowNodeData>[]
  sections: readonly VisualSection[]
  tile: Dimensions
  dimensions: Dimensions
  viewport: ViewportTransform
  disabled: boolean
}>()
const emit = defineEmits<{ center: [point: XYPosition]; fit: [] }>()

const mapSize = { width: 160, height: 92 }
const padding = 6
const map = computed(() => {
  const { x, y, width, height } = props.bounds
  const scale = Math.min((mapSize.width - padding * 2) / width, (mapSize.height - padding * 2) / height)
  return {
    scale,
    x: (mapSize.width - width * scale) / 2 - x * scale,
    y: (mapSize.height - height * scale) / 2 - y * scale,
  }
})

function mapRect(position: XYPosition, size: Dimensions) {
  const { x, y, scale } = map.value
  return { x: position.x * scale + x, y: position.y * scale + y, width: size.width * scale, height: size.height * scale }
}

const sectionRects = computed(() => props.sections.map(({ id, position, width, height, color }) => ({
  id, rect: mapRect(position, { width, height }), color: nodeColors[color].accent,
})))
const nodeRects = computed(() => props.nodes.map(({ id, position, data }) => ({
  id, rect: mapRect(position, props.tile), color: nodeColors[data.color ?? defaultNodeColors[data.kind]].accent,
})))
const windowRect = computed(() => {
  const { x, y, zoom } = props.viewport
  const { width, height } = props.dimensions
  return mapRect({ x: -x / zoom, y: -y / zoom }, { width: width / zoom, height: height / zoom })
})
const offMapMarker = computed(() => {
  const { x, y, width, height } = windowRect.value
  if (x + width >= 0 && x <= mapSize.width && y + height >= 0 && y <= mapSize.height) return
  return {
    cx: Math.min(mapSize.width - 4, Math.max(4, x + width / 2)),
    cy: Math.min(mapSize.height - 4, Math.max(4, y + height / 2)),
  }
})

let pointerId: number | undefined

function navigate(event: PointerEvent) {
  if (props.disabled || event.pointerId !== pointerId) return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  if (!rect.width || !rect.height) return
  const { x, y, scale } = map.value
  const relativeX = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
  const relativeY = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
  emit('center', { x: (relativeX * mapSize.width - x) / scale, y: (relativeY * mapSize.height - y) / scale })
}

function begin(event: PointerEvent) {
  if (props.disabled || event.button !== 0 || pointerId !== undefined) return
  event.preventDefault()
  pointerId = event.pointerId
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture?.(event.pointerId)
  navigate(event)
}

function end(event: PointerEvent) {
  if (event.pointerId === pointerId) pointerId = undefined
}
</script>

<template>
  <button
    class="workflow-minimap nopan nowheel nokey" type="button" :disabled="disabled"
    aria-label="Workflow minimap" title="Click or drag to pan. Press Enter to fit."
    @pointerdown="begin" @pointermove="navigate" @pointerup="end" @pointercancel="end" @lostpointercapture="end"
    @click="!$event.detail && emit('fit')"
  >
    <svg :viewBox="`0 0 ${mapSize.width} ${mapSize.height}`" preserveAspectRatio="none" aria-hidden="true">
      <rect
        v-for="{ id, rect, color } in sectionRects" :key="id" class="minimap-section"
        v-bind="rect" :fill="color" :stroke="color"
      />
      <rect
        v-for="{ id, rect, color } in nodeRects" :key="id" class="minimap-node"
        v-bind="rect" :fill="color"
      />
      <rect class="minimap-viewport" v-bind="windowRect" />
      <circle v-if="offMapMarker" class="minimap-marker" v-bind="offMapMarker" r="2" />
    </svg>
  </button>
</template>
