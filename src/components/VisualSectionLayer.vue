<script setup lang="ts">
import { onUnmounted, ref, shallowRef } from 'vue'
import type { XYPosition } from '@vue-flow/core'
import { nodeColors } from '../data/nodeCatalog'
import { clampSectionPosition, maximumSectionSize, minimumSection } from '../data/visualSections'
import type { SectionGeometry, VisualSection } from '../data/visualSections'

const props = defineProps<{
  sections: readonly VisualSection[]
  selectedId?: string
  editable: boolean
  canStart: () => boolean
  project: (point: XYPosition) => XYPosition
}>()
const emit = defineEmits<{
  select: [id: string]
  gesture: [active: boolean]
  update: [id: string, geometry: SectionGeometry]
}>()

const layer = ref<HTMLElement>()
const preview = shallowRef<SectionGeometry>()
let drag: { section: VisualSection; origin: XYPosition; pointerId: number; resize: boolean; target: HTMLElement } | undefined

function focusSection(id: string) {
  layer.value?.querySelector<HTMLButtonElement>(`[data-section-id="${id}"] button`)?.focus({ preventScroll: true })
}

function begin(event: PointerEvent, section: VisualSection, resize = false) {
  if (event.button !== 0 || drag || !props.canStart()) return
  const target = event.currentTarget as HTMLElement
  event.preventDefault()
  focusSection(section.id)
  emit('select', section.id)
  drag = { section, origin: props.project({ x: event.clientX, y: event.clientY }), pointerId: event.pointerId, resize, target }
  target.setPointerCapture?.(event.pointerId)
  emit('gesture', true)
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', end)
  window.addEventListener('blur', cancelGesture)
}

function move(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointerId) return
  const { section, origin, resize } = drag
  const point = props.project({ x: event.clientX, y: event.clientY })
  const x = point.x - origin.x
  const y = point.y - origin.y
  const { position, width, height } = section
  preview.value = resize ? {
    position,
    width: Math.min(maximumSectionSize, Math.max(minimumSection.width, width + x)),
    height: Math.min(maximumSectionSize, Math.max(minimumSection.height, height + y)),
  } : { width, height, position: clampSectionPosition({ x: position.x + x, y: position.y + y }) }
}

function end(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointerId) return
  if (event.type === 'pointerup') {
    move(event)
    if (preview.value) emit('update', drag.section.id, preview.value)
  }
  cancelGesture()
}

function cancelGesture() {
  if (!drag) return
  const { target, pointerId } = drag
  drag = undefined
  if (target.hasPointerCapture?.(pointerId)) target.releasePointerCapture(pointerId)
  preview.value = undefined
  window.removeEventListener('pointermove', move)
  window.removeEventListener('pointerup', end)
  window.removeEventListener('pointercancel', end)
  window.removeEventListener('blur', cancelGesture)
  emit('gesture', false)
}

function sectionStyle(section: VisualSection) {
  const pending = preview.value
  const { position, width, height } = section.id === drag?.section.id && pending ? pending : section
  const { accent, border } = nodeColors[section.color]
  return {
    left: `${position.x}px`, top: `${position.y}px`, width: `${width}px`, height: `${height}px`,
    '--section-accent': accent, '--section-border': border, '--section-fill': `${accent}14`,
  }
}

onUnmounted(cancelGesture)
defineExpose({ focusSection, cancelGesture })
</script>

<template>
  <div ref="layer" class="visual-section-layer">
    <div
      v-for="section in sections" :key="section.id" class="visual-section" :data-section-id="section.id"
      :class="{ 'section-selected': editable && selectedId === section.id }" :style="sectionStyle(section)"
    >
      <div class="section-heading">
        <button
          v-if="editable" class="section-title section-grip nopan" type="button"
          :aria-label="`Select section ${section.title}`" :aria-pressed="selectedId === section.id" :title="section.title"
          @pointerdown.stop="begin($event, section)" @click.stop="emit('select', section.id)"
        >
          <span>{{ section.title }}</span>
        </button>
        <div v-else class="section-title" :title="section.title"><span>{{ section.title }}</span></div>
        <p v-if="section.description" class="section-description" :title="section.description">{{ section.description }}</p>
      </div>
      <span
        v-if="editable && selectedId === section.id" class="section-resize nopan" aria-hidden="true"
        @pointerdown.stop="begin($event, section, true)"
      ></span>
    </div>
  </div>
</template>
