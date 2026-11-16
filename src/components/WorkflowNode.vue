<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { nodeColors, nodeIcons } from '../data/nodeCatalog'
import type { WorkflowNodeData } from '../data/nodeCatalog'

const props = defineProps<{ data: WorkflowNodeData; selected: boolean }>()

const customColor = computed(() => {
  const color = props.data.color && nodeColors[props.data.color]
  return color ? { '--node-accent': color.accent, '--node-border': color.border } : undefined
})
</script>

<template>
  <div class="workflow-node" :class="[`node-${data.kind}`, { 'is-selected': selected }]" :style="customColor">
    <div class="node-tile" :title="data.caption">
      <component :is="nodeIcons[data.icon ?? data.kind].icon" :size="29" :stroke-width="1.7" aria-hidden="true" />
    </div>
    <Handle
      v-if="data.input"
      id="in"
      type="target"
      :connectable-start="false"
      :position="Position.Left"
      :aria-label="`${data.label} input`"
      :title="`${data.label}: input`"
    />
    <Handle
      v-for="(output, index) in data.outputs"
      :id="output.id"
      :key="output.id"
      type="source"
      :position="Position.Right"
      :style="{ top: `${((index + 1) / (data.outputs.length + 1)) * 100}%` }"
      :aria-label="`${data.label} ${output.label} output`"
      :title="output.label"
    />
    <div class="node-label">
      <span :title="data.label">{{ data.label }}</span>
      <small>{{ data.caption }}</small>
    </div>
  </div>
</template>
