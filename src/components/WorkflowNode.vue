<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { nodeColors, nodeIcons } from '../data/nodeCatalog'
import type { WorkflowNodeData } from '../data/nodeCatalog'

const props = defineProps<{ data: WorkflowNodeData; selected: boolean; client: boolean }>()

const displayLabel = computed(() => props.client ? props.data.clientLabel ?? props.data.label : props.data.label)

const customColor = computed(() => {
  const color = props.data.color && nodeColors[props.data.color]
  return color ? { '--node-accent': color.accent, '--node-border': color.border } : undefined
})
</script>

<template>
  <div class="workflow-node" :class="[`node-${data.kind}`, { 'is-selected': selected && !client }]" :style="customColor">
    <div v-if="client" class="client-node-card">
      <div class="client-node-heading">
        <component :is="nodeIcons[data.icon ?? data.kind].icon" :size="19" :stroke-width="1.7" aria-hidden="true" />
        <span class="client-node-label" :title="displayLabel">{{ displayLabel }}</span>
      </div>
      <p v-if="data.businessDescription" class="client-node-description" :title="data.businessDescription">
        {{ data.businessDescription }}
      </p>
    </div>
    <div v-else class="node-tile" :title="data.caption">
      <component :is="nodeIcons[data.icon ?? data.kind].icon" :size="29" :stroke-width="1.7" aria-hidden="true" />
    </div>
    <!-- Keep the handle boxes measurable so the same edges can anchor to the client cards. -->
    <Handle
      v-if="data.input"
      id="in"
      type="target"
      :connectable-start="false"
      :position="Position.Left"
      :aria-hidden="client || undefined"
      :aria-label="`${data.label} input`"
      :title="`${data.label}: input`"
    />
    <Handle
      v-for="(output, index) in data.outputs"
      :id="output.id"
      :key="output.id"
      type="source"
      :position="Position.Right"
      :aria-hidden="client || undefined"
      :style="{ top: `${((index + 1) / (data.outputs.length + 1)) * 100}%` }"
      :aria-label="`${data.label} ${output.label} output`"
      :title="output.label"
    />
    <div v-if="!client" class="node-label">
      <span :title="displayLabel">{{ displayLabel }}</span>
      <small>{{ data.caption }}</small>
    </div>
  </div>
</template>
