<script setup lang="ts">
import type { GraphEdge, GraphNode } from '@vue-flow/core'
import { Copy, Trash2, X } from 'lucide-vue-next'
import { nodeColors, nodeIcons } from '../data/nodeCatalog'
import type { NodeColor, NodeIcon, WorkflowNodeData } from '../data/nodeCatalog'

const props = defineProps<{ node?: GraphNode<WorkflowNodeData>; edge?: GraphEdge }>()
const emit = defineEmits<{
  close: []
  updateNode: [data: Partial<WorkflowNodeData>]
  updateLabel: [label: string]
  duplicate: []
  delete: []
}>()

function rename(event: Event) {
  const input = event.target as HTMLInputElement
  input.value = input.value.trim() || props.node?.data.label || ''
  emit('updateNode', { label: input.value })
}

function setIcon(event: Event) {
  const value = (event.target as HTMLSelectElement).value as NodeIcon | ''
  emit('updateNode', { icon: value || undefined })
}

function setColor(event: Event) {
  const value = (event.target as HTMLSelectElement).value as NodeColor | ''
  emit('updateNode', { color: value || undefined })
}

function labelEdge(event: Event) {
  const input = event.target as HTMLInputElement
  input.value = input.value.trim()
  emit('updateLabel', input.value)
}

function commitInput(event: KeyboardEvent) {
  if (!event.isComposing) (event.target as HTMLInputElement).blur()
}
</script>

<template>
  <div class="editor-popover graph-inspector nopan nowheel" role="region" :aria-label="node ? 'Edit node' : 'Edit connection'">
    <header class="editor-heading">
      <h2>{{ node ? 'Edit node' : 'Edit connection' }}</h2>
      <button class="editor-close" type="button" aria-label="Close inspector" @click="emit('close')">
        <X :size="15" aria-hidden="true" />
      </button>
    </header>
    <template v-if="node">
      <label class="editor-field">
        Name
        <input type="text" :value="node.data.label" maxlength="80" @change="rename" @keydown.enter="commitInput" />
      </label>
      <label class="editor-field">
        Icon
        <select :value="node.data.icon ?? ''" @change="setIcon">
          <option value="">Type default</option>
          <option v-for="(item, key) in nodeIcons" :key="key" :value="key">{{ item.label }}</option>
        </select>
      </label>
      <label class="editor-field">
        Color
        <select :value="node.data.color ?? ''" @change="setColor">
          <option value="">Type default</option>
          <option v-for="(item, key) in nodeColors" :key="key" :value="key">{{ item.label }}</option>
        </select>
      </label>
    </template>
    <template v-else-if="edge">
      <label class="editor-field">
        Label
        <input
          type="text" :value="typeof edge.label === 'string' ? edge.label : ''" maxlength="48"
          placeholder="Optional label" @change="labelEdge" @keydown.enter="commitInput"
        />
      </label>
      <p class="editor-hint">Drag either highlighted endpoint to reconnect.</p>
    </template>
    <div class="editor-actions">
      <button v-if="node" class="reset-button" type="button" @click="emit('duplicate')">
        <Copy :size="13" aria-hidden="true" />Duplicate
      </button>
      <button class="reset-button editor-delete" type="button" @click="emit('delete')">
        <Trash2 :size="13" aria-hidden="true" />{{ node ? 'Delete node' : 'Delete edge' }}
      </button>
    </div>
  </div>
</template>
