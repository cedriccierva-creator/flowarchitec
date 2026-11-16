<script setup lang="ts">
import type { GraphEdge, GraphNode } from '@vue-flow/core'
import { Copy, Trash2, X } from 'lucide-vue-next'
import DocumentationField from './DocumentationField.vue'
import { nodeColors, nodeIcons } from '../data/nodeCatalog'
import type { NodeColor, NodeIcon, WorkflowNodeData } from '../data/nodeCatalog'
import {
  businessDescriptionLimit, clientLabelLimit, nodeDocumentationFields, overviewFields, readBusinessDescription, readClientLabel,
} from '../data/workflowDocument'
import type { NodeDocumentation, NodeDocumentationField, OverviewField, ProjectOverview } from '../data/workflowDocument'

const props = defineProps<{
  node?: GraphNode<WorkflowNodeData>
  edge?: GraphEdge
  architect: boolean
  nodeDocumentation?: NodeDocumentation
  edgeDescription?: string
  overview?: ProjectOverview
}>()
const emit = defineEmits<{
  close: []
  updateNode: [data: Partial<WorkflowNodeData>]
  updateLabel: [label: string]
  updateNodeDocumentation: [field: NodeDocumentationField, value: string | undefined]
  updateEdgeDescription: [value: string | undefined]
  updateOverview: [field: OverviewField, value: string | undefined]
  duplicate: []
  delete: []
}>()

const nodeFields = {
  purpose: { label: 'Purpose', placeholder: 'What does this step do?' },
  inputs: { label: 'Inputs', placeholder: 'Expected data, format, or source' },
  outputs: { label: 'Outputs', placeholder: 'Data or side effects this step produces' },
  configuration: { label: 'Configuration notes', placeholder: 'Settings, mappings, or dependencies' },
  errorHandling: { label: 'Error-handling strategy', placeholder: 'Retries, fallback, or escalation' },
} satisfies Record<NodeDocumentationField, { label: string; placeholder: string }>

const projectFields = {
  summary: { label: 'Project summary', placeholder: 'What does the workflow do?' },
  goals: { label: 'Architecture goals', placeholder: 'What should this design achieve?' },
  assumptions: { label: 'Assumptions', placeholder: 'What is expected to hold true?' },
  constraints: { label: 'Constraints', placeholder: 'Limits on tools, time, or resources' },
} satisfies Record<OverviewField, { label: string; placeholder: string }>

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
  <div
    class="editor-popover graph-inspector nopan nowheel" :class="{ 'architect-inspector': architect }"
    role="region" aria-labelledby="graph-inspector-title"
  >
    <header class="editor-heading">
      <h2 id="graph-inspector-title">{{ node ? 'Edit node' : edge ? 'Edit connection' : 'Project overview' }}</h2>
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
    <template v-if="architect">
      <template v-if="node">
        <h3 class="editor-section-title">Technical documentation</h3>
        <DocumentationField
          v-for="field in nodeDocumentationFields" :key="field"
          v-bind="nodeFields[field]" :value="nodeDocumentation?.[field]"
          @commit="emit('updateNodeDocumentation', field, $event)"
        />
        <h3 class="editor-section-title">Client View</h3>
        <DocumentationField
          label="Client label" placeholder="Uses the node name when empty" :value="node.data.clientLabel"
          single-line :limit="clientLabelLimit" :normalize="readClientLabel"
          @commit="emit('updateNode', { clientLabel: $event })"
        />
        <DocumentationField
          label="Business description" placeholder="What happens in this step?" :value="node.data.businessDescription"
          :limit="businessDescriptionLimit" :normalize="readBusinessDescription"
          @commit="emit('updateNode', { businessDescription: $event })"
        />
      </template>
      <DocumentationField
        v-else-if="edge" label="Technical description" placeholder="Data contract, routing condition, or fallback"
        :value="edgeDescription" @commit="emit('updateEdgeDescription', $event)"
      />
      <template v-else>
        <DocumentationField
          v-for="field in overviewFields" :key="field"
          v-bind="projectFields[field]" :value="overview?.[field]"
          @commit="emit('updateOverview', field, $event)"
        />
      </template>
    </template>
    <div v-if="node || edge" class="editor-actions">
      <button v-if="node" class="reset-button" type="button" @click="emit('duplicate')">
        <Copy :size="13" aria-hidden="true" />Duplicate
      </button>
      <button class="reset-button editor-delete" type="button" @click="emit('delete')">
        <Trash2 :size="13" aria-hidden="true" />{{ node ? 'Delete node' : 'Delete edge' }}
      </button>
    </div>
  </div>
</template>
