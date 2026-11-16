<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, shallowRef, watch } from 'vue'
import { ConnectionLineType, ConnectionMode, MarkerType, Panel, VueFlow, useVueFlow } from '@vue-flow/core'
import type { Connection, DefaultEdgeOptions, MouseTouchEvent, XYPosition } from '@vue-flow/core'
import { Maximize, Minus, MousePointer2, Plus, Redo2, Undo2 } from 'lucide-vue-next'
import GraphInspector from './GraphInspector.vue'
import NodePicker from './NodePicker.vue'
import WorkflowNode from './WorkflowNode.vue'
import { clientCard, createWorkflowNode } from '../data/nodeCatalog'
import type { NodeKind, WorkflowNodeData } from '../data/nodeCatalog'
import { isDesktop } from '../data/desktop'
import { reviewModes } from '../data/exportReviewPrompt'
import { captureWorkflow, materializeEdge, materializeNode, untitled } from '../data/workflowDocument'
import type { NodeDocumentation, NodeDocumentationField, OverviewField, ProjectOverview, WorkflowDocument } from '../data/workflowDocument'
import { useWorkflowSession } from '../composables/useWorkflowSession'
import { canConnect, findNodePosition } from '../data/workflowGraph'

const {
  addEdges, addNodes, addSelectedNodes, connectionClickStartHandle, dimensions, edges, endConnection,
  findNode, fitView, getNodesInitialized, getSelectedEdges, getSelectedNodes, nodes, onClickConnectStart,
  onConnect, onConnectEnd, onConnectStart, onEdgeUpdate,
  onEdgeUpdateEnd, onEdgeUpdateStart, onNodeDragStart, onNodeDragStop, onNodesInitialized, project,
  removeEdges, removeNodes, removeSelectedElements, setEdges, setNodes, setViewport, updateEdge, updateNode,
  updateNodeData, updateNodeInternals, viewport, vueFlowRef, zoomIn, zoomOut,
} = useVueFlow()

const projectName = ref(untitled)
const architectView = ref(false)
const clientView = ref(false)
const presenting = defineModel<boolean>('presenting', { required: true })
const reviewOpen = ref(false)
const showReviewControls = computed(() => architectView.value && !clientView.value && !presenting.value)
const longReviewPromptThreshold = 50_000
const presentButton = ref<HTMLButtonElement>()
const exitPresentationButton = ref<HTMLButtonElement>()
const overview = shallowRef<ProjectOverview>()
const nodeDocumentation = reactive(new Map<string, NodeDocumentation>())
const edgeDescriptions = reactive(new Map<string, string>())
const pickerOpen = ref(false)
const picker = ref<InstanceType<typeof NodePicker>>()
const addButton = ref<HTMLButtonElement>()
const selectedNode = computed(() => getSelectedNodes.value.length === 1 && !getSelectedEdges.value.length
  ? getSelectedNodes.value[0] : undefined)
const selectedEdge = computed(() => getSelectedEdges.value.length === 1 && !getSelectedNodes.value.length
  ? getSelectedEdges.value[0] : undefined)
const zoomLabel = computed(() => `${Math.round(viewport.value.zoom * 100)}%`)
const fitOptions = { padding: 0.28, maxZoom: 1.2 }
const defaultEdgeOptions: DefaultEdgeOptions = {
  type: 'default', // Vue Flow's built-in cubic Bezier edge.
  animated: false,
  markerEnd: { type: MarkerType.ArrowClosed, color: '#8f8b82', width: 16, height: 16 },
  labelShowBg: true,
  labelBgPadding: [5, 3],
  labelBgBorderRadius: 4,
  labelStyle: { fill: '#ddd6ca', fontSize: '11px' },
  labelBgStyle: { fill: '#292722', stroke: '#494238', strokeWidth: 1 },
}

let nextNodeId = 1
let nextEdgeId = 1
let fitOnInitialize = false
let reconnectingEdgeId: string | undefined
let activeConnection: MouseTouchEvent | undefined
let connectionCancelled = false
const activeNodeDrag = shallowRef<{ event: MouseTouchEvent; positions: { id: string; position: XYPosition }[] }>()

const {
  busy, exporting, exportStatus, notice, recoveryError, recoveries, showRecovery, dirty, filePath, fileName, canUndo, canRedo,
  recordEdit, undo, redo, newProject, openProject, saveProject, exportProject, restore, discardRecovery,
  reviewMode, reviewPromptLength, copyReviewPrompt, saveReviewPrompt,
} = useWorkflowSession(
  () => captureWorkflow(
    { name: projectName.value, overview: overview.value }, nodes.value, edges.value, nodeDocumentation, edgeDescriptions,
  ),
  applyDocument,
  () => Boolean(activeNodeDrag.value),
)

function nextId(type: 'node' | 'edge') {
  let id: string
  do {
    id = type === 'node' ? `node-${nextNodeId++}` : `edge-${nextEdgeId++}`
  } while (findNode(id) || edges.value.some((edge) => edge.id === id))
  return id
}

function validConnection(connection: Connection) {
  // Vue Flow also validates stored edges when parsing graph updates.
  const existingId = 'id' in connection && typeof connection.id === 'string' ? connection.id : undefined
  return (Boolean(existingId) || (!clientView.value && !connectionCancelled))
    && canConnect(connection, nodes.value, edges.value, existingId ?? reconnectingEdgeId)
}

onConnectStart(({ event }) => {
  activeConnection = event
  connectionCancelled = false
})
onConnectEnd(() => { activeConnection = undefined })
onClickConnectStart(() => { connectionCancelled = false })
onConnect((connection) => {
  if (validConnection(connection)) addEdges({ ...connection, id: nextId('edge') })
})
onEdgeUpdateStart(({ edge }) => { reconnectingEdgeId = edge.id })
onEdgeUpdate(({ edge, connection }) => {
  if (validConnection(connection)) updateEdge(edge, connection, false)
})
onEdgeUpdateEnd(() => { reconnectingEdgeId = undefined })
onNodeDragStart(({ event, nodes }) => {
  recordEdit()
  activeNodeDrag.value = { event, positions: nodes.map(({ id, position }) => ({ id, position: { ...position } })) }
})
onNodeDragStop(() => {
  if (!activeNodeDrag.value) return
  activeNodeDrag.value = undefined
  recordEdit()
})
function fitInitializedGraph() {
  if (!fitOnInitialize || !nodes.value.length || getNodesInitialized.value.length !== nodes.value.length) return
  fitOnInitialize = false
  void fitView(fitOptions)
}

onNodesInitialized(fitInitializedGraph)

function closePicker(restoreFocus = true) {
  pickerOpen.value = false
  if (restoreFocus) addButton.value?.focus()
}

const pickerBlocked = computed(() => busy.value || exporting.value || clientView.value || presenting.value)
watch(pickerBlocked, (blocked) => { if (blocked) closePicker(false) })

function canUsePicker() {
  return !pickerBlocked.value && !activeNodeDrag.value && !activeConnection && !reconnectingEdgeId
    && !connectionClickStartHandle.value
}

function openPicker() {
  if (!canUsePicker()) return
  if (pickerOpen.value) picker.value?.focusSearch()
  else pickerOpen.value = true
}

function togglePicker() {
  if (pickerOpen.value) closePicker()
  else openPicker()
}

function addFromPicker(kind: NodeKind) {
  if (pickerOpen.value && canUsePicker()) void addNode(kind)
}

function switchView() {
  if (busy.value || activeNodeDrag.value || activeConnection || reconnectingEdgeId) return
  const focused = document.activeElement
  if (focused instanceof HTMLElement && focused.closest('input, textarea')) focused.blur()
  closePicker(false)
  endConnection(undefined, true)
  removeSelectedElements()
  clientView.value = !clientView.value
  void nextTick(() => updateNodeInternals())
}

function setPresentation(enabled: boolean) {
  if (!clientView.value) return
  presenting.value = enabled
  void nextTick(() => (enabled ? exitPresentationButton.value : presentButton.value)?.focus())
}

async function addNode(kind: NodeKind, copy?: WorkflowNodeData, preferred?: XYPosition, documentation?: NodeDocumentation) {
  const position = findNodePosition(project, dimensions.value, nodes.value, preferred)
  const node = createWorkflowNode(kind, nextId('node'), position)
  if (copy) {
    node.data = { ...copy, label: `${copy.label.slice(0, 75)} copy`, outputs: copy.outputs.map((port) => ({ ...port })) }
  }
  closePicker(false)
  removeSelectedElements()
  addNodes(node)
  if (documentation) nodeDocumentation.set(node.id, { ...documentation })
  const added = findNode(node.id)
  if (added) addSelectedNodes([added])
  await nextTick()
  vueFlowRef.value?.querySelector<HTMLElement>(`.vue-flow__node[data-id="${node.id}"]`)?.focus({ preventScroll: true })
}

function duplicateNode() {
  const node = selectedNode.value
  if (!node) return
  void addNode(node.data.kind, node.data, { x: node.position.x + 120, y: node.position.y + 24 }, nodeDocumentation.get(node.id))
}

function editNode(data: Partial<WorkflowNodeData>) {
  if (selectedNode.value) updateNodeData(selectedNode.value.id, data)
}

function editEdgeLabel(label: string) {
  if (selectedEdge.value) selectedEdge.value.label = label || undefined
}

function withNote<K extends string>(notes: Partial<Record<K, string>> | undefined, field: K, value: string | undefined) {
  const updated: Partial<Record<K, string>> = { ...notes }
  if (value === undefined) delete updated[field]
  else updated[field] = value
  return Object.keys(updated).length ? updated : undefined
}

function editNodeDocumentation(field: NodeDocumentationField, value: string | undefined) {
  if (!selectedNode.value) return
  const { id } = selectedNode.value
  const updated = withNote(nodeDocumentation.get(id), field, value)
  if (updated) nodeDocumentation.set(id, updated)
  else nodeDocumentation.delete(id)
  recordEdit()
}

function editEdgeDescription(value: string | undefined) {
  if (!selectedEdge.value) return
  const { id } = selectedEdge.value
  if (value === undefined) edgeDescriptions.delete(id)
  else edgeDescriptions.set(id, value)
  recordEdit()
}

function editOverview(field: OverviewField, value: string | undefined) {
  overview.value = withNote(overview.value, field, value)
  recordEdit()
}

function deleteSelection() {
  const selectedNodes = getSelectedNodes.value
  const selectedEdges = getSelectedEdges.value
  const nodeIds = new Set(selectedNodes.map(({ id }) => id))
  for (const id of nodeIds) nodeDocumentation.delete(id)
  for (const { id, source, target } of edges.value) {
    if (nodeIds.has(source) || nodeIds.has(target)) edgeDescriptions.delete(id)
  }
  for (const { id } of selectedEdges) edgeDescriptions.delete(id)
  removeEdges(selectedEdges)
  removeNodes(selectedNodes)
}

function closeInspector() {
  if (selectedNode.value || selectedEdge.value) removeSelectedElements()
  else architectView.value = false
}

function commitDocumentationBeforePointerAction(event: PointerEvent) {
  if (event.target instanceof Element && event.target.closest('[data-export-action]')) return
  const focused = document.activeElement
  // Canvas selection or dragging can take over before the browser moves focus.
  if (event.button === 0 && (focused instanceof HTMLTextAreaElement
    || (focused instanceof HTMLInputElement && focused.closest('.editor-documentation-field')))
    && event.target instanceof Node
    && !focused.closest('label')?.contains(event.target)) focused.blur()
}

function keepExportDraftFocused(event: MouseEvent) {
  // A pointer export reads the committed project without blurring a pending field edit.
  if (document.activeElement?.matches('input, textarea, select')) event.preventDefault()
}

function requestExport(action: () => Promise<void>) {
  if (!activeConnection && !reconnectingEdgeId) void action()
}

function releaseGesture(event: MouseTouchEvent) {
  // Vue Flow and D3 clean up their drag listeners and auto-pan on release.
  const release = event instanceof MouseEvent
    ? new MouseEvent('mouseup', {
      bubbles: true, view: window, clientX: event.clientX, clientY: event.clientY,
    })
    : new TouchEvent('touchend', { bubbles: true, changedTouches: Array.from(event.changedTouches) })
  event.target?.dispatchEvent(release)
}

function onEscape(event: KeyboardEvent) {
  if (event.target instanceof HTMLElement
    && event.target.closest('.editor-documentation-field, .review-prompt select')) return

  if (presenting.value) {
    setPresentation(false)
  } else if (clientView.value) {
    return
  } else if (activeConnection) {
    connectionCancelled = true
    releaseGesture(activeConnection)
    endConnection()
  } else if (connectionClickStartHandle.value) {
    endConnection(undefined, true)
  } else if (activeNodeDrag.value) {
    const { event: dragEvent, positions } = activeNodeDrag.value
    activeNodeDrag.value = undefined
    releaseGesture(dragEvent)
    for (const { id, position } of positions) updateNode(id, { position })
  } else if (pickerOpen.value) {
    closePicker()
  } else if (getSelectedNodes.value.length || getSelectedEdges.value.length) {
    if (event.target instanceof HTMLInputElement && event.target.closest('.graph-inspector')) {
      const label = selectedNode.value?.data.label ?? selectedEdge.value?.label
      event.target.value = typeof label === 'string' ? label : ''
    }
    removeSelectedElements()
    vueFlowRef.value?.focus({ preventScroll: true })
  } else if (architectView.value) {
    closeInspector()
  } else {
    return
  }
  event.preventDefault()
  event.stopPropagation()
}

function onShortcut(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing) return
  if (event.key === 'Escape') {
    onEscape(event)
    return
  }
  if (clientView.value || presenting.value || busy.value || activeNodeDrag.value || activeConnection || reconnectingEdgeId
    || (event.target instanceof HTMLElement
      && (event.target.isContentEditable || event.target.closest('input, textarea, select, .node-picker')))) return

  const key = event.key.toLowerCase()
  if (key === 'k' && event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
    if (!architectView.value || !canUsePicker()) return
    event.preventDefault()
    if (!event.repeat) openPicker()
  } else if (event.ctrlKey && !event.altKey && !event.metaKey && (key === 'z' || key === 'y')) {
    event.preventDefault()
    if (key === 'y' || event.shiftKey) redo()
    else undo()
  } else if (!event.ctrlKey && !event.altKey && !event.metaKey && (key === 'delete' || key === 'backspace')) {
    if (!getSelectedNodes.value.length && !getSelectedEdges.value.length) return
    event.preventDefault()
    deleteSelection()
  }
}

onMounted(() => document.addEventListener('keydown', onShortcut, true))
onUnmounted(() => document.removeEventListener('keydown', onShortcut, true))

function renameProject(event: Event) {
  const field = event.target as HTMLInputElement
  projectName.value = field.value.trim() || untitled
  field.value = projectName.value
}

function applyDocument(document: WorkflowDocument, fit = false) {
  closePicker(false)
  endConnection(undefined, true)
  removeSelectedElements()
  projectName.value = document.metadata.name
  overview.value = document.metadata.overview
  nodeDocumentation.clear()
  edgeDescriptions.clear()
  for (const { id, documentation } of document.nodes) {
    if (documentation) nodeDocumentation.set(id, documentation)
  }
  for (const { id, description } of document.edges) {
    if (description !== undefined) edgeDescriptions.set(id, description)
  }
  fitOnInitialize = fit && document.nodes.length > 0
  setEdges([])
  setNodes(document.nodes.map(materializeNode))
  setEdges(document.edges.map(materializeEdge))
  if (fit && !document.nodes.length) void setViewport({ x: 0, y: 0, zoom: 1 })
  if (fitOnInitialize) {
    void nextTick(() => {
      updateNodeInternals()
      fitInitializedGraph()
    })
  }
}
</script>

<template>
  <section
    class="workspace" :class="{ 'is-client-view': clientView, 'is-presenting': presenting }"
    :style="{ '--client-card-width': `${clientCard.width}px`, '--client-card-height': `${clientCard.height}px` }"
    :aria-label="clientView ? 'Client workflow canvas' : 'Workflow planning canvas'"
    @pointerdown.capture="commitDocumentationBeforePointerAction"
  >
    <div v-if="!presenting" class="workspace-heading">
      <div>
        <p class="eyebrow">{{ clientView ? 'CLIENT VIEW' : 'WORKFLOW' }}</p>
        <h1>
          <input
            v-if="!clientView" class="project-name" aria-label="Project name" maxlength="100" :value="projectName" :disabled="busy"
            @change="renameProject" @keydown.enter="($event.target as HTMLInputElement).blur()"
          />
          <span v-else class="client-project-name">{{ projectName }}</span>
        </h1>
      </div>
      <div class="workspace-actions">
        <template v-if="!clientView">
          <div class="project-actions" role="group" aria-label="Project file">
            <button class="reset-button" type="button" :disabled="busy" @click="newProject()">New Project</button>
            <button class="reset-button" type="button" :disabled="busy || !isDesktop" @click="openProject()">Open…</button>
            <button class="reset-button" type="button" :disabled="busy || !isDesktop" @click="saveProject()">Save</button>
            <button class="reset-button" type="button" :disabled="busy || !isDesktop" @click="saveProject(true)">Save As…</button>
          </div>
          <div class="history-actions" role="group" aria-label="Edit history">
            <button class="reset-button" type="button" :disabled="busy || !canUndo" title="Undo (Ctrl+Z)" aria-label="Undo" @click="undo">
              <Undo2 :size="15" aria-hidden="true" />
            </button>
            <button class="reset-button" type="button" :disabled="busy || !canRedo" title="Redo (Ctrl+Shift+Z or Ctrl+Y)" aria-label="Redo" @click="redo">
              <Redo2 :size="15" aria-hidden="true" />
            </button>
          </div>
          <div class="node-picker-anchor">
            <button
              ref="addButton" class="reset-button add-node-button" type="button"
              :disabled="pickerBlocked" aria-haspopup="dialog" :aria-expanded="pickerOpen" :aria-controls="pickerOpen ? 'node-picker' : undefined"
              :aria-keyshortcuts="architectView ? 'Control+K' : undefined" :title="architectView ? 'Add Node (Ctrl+K)' : undefined"
              @click="togglePicker"
            >
              <Plus :size="15" aria-hidden="true" />Add Node
            </button>
            <NodePicker v-if="pickerOpen" ref="picker" @add="addFromPicker" @close="closePicker()" />
          </div>
          <button class="reset-button" type="button" :disabled="busy" :aria-pressed="architectView" @click="architectView = !architectView">
            Architect View
          </button>
          <button class="reset-button" type="button" :disabled="busy" @click="newProject(true)">Load demo</button>
        </template>
        <button class="reset-button" type="button" :disabled="busy" @click="switchView">
          {{ clientView ? 'Back to Architect View' : 'Client View' }}
        </button>
        <button v-if="clientView" ref="presentButton" class="reset-button" type="button" @click="setPresentation(true)">
          Present
        </button>
        <div class="export-actions" role="group" aria-label="Export workflow">
          <button class="reset-button" type="button" data-export-action
            :disabled="busy || exporting || !isDesktop" @mousedown="keepExportDraftFocused" @click="requestExport(() => exportProject('png'))">
            Export PNG
          </button>
          <button class="reset-button" type="button" data-export-action
            :disabled="busy || exporting || !isDesktop" @mousedown="keepExportDraftFocused" @click="requestExport(() => exportProject('md'))">
            Export Markdown
          </button>
        </div>
        <button v-if="showReviewControls" class="reset-button" type="button" data-export-action
          :aria-controls="reviewOpen ? 'review-prompt' : undefined" :aria-expanded="reviewOpen"
          @mousedown="keepExportDraftFocused" @click="reviewOpen = !reviewOpen">
          AI Review Prompt
        </button>
      </div>
    </div>

    <section v-if="showReviewControls && reviewOpen" id="review-prompt" class="review-prompt" aria-label="AI review prompt">
      <div class="review-prompt-actions">
        <label>
          Review mode
          <select v-model="reviewMode" :disabled="busy || exporting">
            <option v-for="(mode, id) in reviewModes" :key="id" :value="id">{{ mode.label }}</option>
          </select>
        </label>
        <button class="reset-button" type="button" data-export-action :disabled="busy || exporting || !isDesktop"
          @mousedown="keepExportDraftFocused" @click="requestExport(copyReviewPrompt)">Copy Review Prompt</button>
        <button class="reset-button" type="button" data-export-action :disabled="busy || exporting || !isDesktop"
          @mousedown="keepExportDraftFocused" @click="requestExport(saveReviewPrompt)">Save Review Prompt as Markdown</button>
      </div>
      <p class="review-prompt-note">
        Generated locally. You choose where to submit the prompt.
        <span :class="{ 'review-prompt-long': reviewPromptLength >= longReviewPromptThreshold }">
          About {{ reviewPromptLength.toLocaleString() }} characters.
          <template v-if="reviewPromptLength >= longReviewPromptThreshold">This may exceed some model input limits.</template>
        </span>
      </p>
    </section>

    <div v-if="!clientView && recoveries.length" class="recovery-panel">
      <button class="reset-button" type="button" :aria-expanded="showRecovery" @click="showRecovery = !showRecovery">
        Recovery snapshots ({{ recoveries.length }})
      </button>
      <ul v-if="showRecovery">
        <li v-for="entry in recoveries" :key="entry.id">
          <span v-if="entry.document">{{ entry.document.metadata.name }} · {{ entry.document.nodes.length }} nodes</span>
          <span v-else>Unreadable snapshot</span>
          <button v-if="entry.document" class="reset-button" type="button" :disabled="busy" @click="restore(entry)">Restore as unsaved</button>
          <button class="reset-button" type="button" :disabled="busy" @click="discardRecovery(entry)">Discard snapshot</button>
        </li>
      </ul>
    </div>

    <p v-if="!presenting && (notice || recoveryError)" class="workspace-notice"
      :class="{ 'export-success': exportStatus === 'success' && !recoveryError, 'export-cancelled': exportStatus === 'cancelled' && !recoveryError }"
      role="status">{{ notice }} {{ recoveryError }}</p>

    <div class="canvas-frame" :inert="busy">
      <VueFlow
        :default-edge-options="defaultEdgeOptions"
        :connection-mode="ConnectionMode.Strict"
        :connection-line-options="{ type: ConnectionLineType.Bezier }"
        :is-valid-connection="validConnection"
        :edge-updater-radius="9"
        :edges-updatable="!clientView"
        :nodes-draggable="!clientView"
        :nodes-connectable="!clientView"
        :connect-on-click="!clientView"
        :elements-selectable="!clientView"
        :nodes-focusable="!clientView"
        :edges-focusable="!clientView"
        :disable-keyboard-a11y="clientView"
        :min-zoom="0.25"
        :max-zoom="2"
        :delete-key-code="null"
        :zoom-on-double-click="false"
        @pane-click="closePicker(false)"
        @node-click="closePicker(false)"
        @edge-click="closePicker(false)"
      >
        <template #node-workflow="nodeProps">
          <WorkflowNode :data="nodeProps.data" :selected="nodeProps.selected" :client="clientView" />
        </template>

        <Panel v-if="!clientView" position="top-left" class="canvas-note">
          <span class="canvas-note-dot" aria-hidden="true"></span>
          Sketch freely. Nothing runs here.
        </Panel>

        <Panel v-if="!clientView && !pickerOpen && (architectView || selectedNode || selectedEdge)" position="top-right" class="inspector-panel nopan nowheel">
          <GraphInspector
            :key="selectedNode?.id ?? selectedEdge?.id ?? ''"
            :node="selectedNode" :edge="selectedEdge" :architect="architectView"
            :node-documentation="selectedNode && nodeDocumentation.get(selectedNode.id)"
            :edge-description="selectedEdge && edgeDescriptions.get(selectedEdge.id)"
            :overview="overview"
            @close="closeInspector"
            @update-node="editNode"
            @update-label="editEdgeLabel"
            @update-node-documentation="editNodeDocumentation"
            @update-edge-description="editEdgeDescription"
            @update-overview="editOverview"
            @duplicate="duplicateNode"
            @delete="deleteSelection"
          />
        </Panel>

        <Panel v-if="presenting" position="top-right" class="presentation-controls nopan">
          <button ref="exitPresentationButton" class="reset-button" type="button" @click="setPresentation(false)">
            Exit Presentation
          </button>
        </Panel>

        <Panel position="bottom-left" class="canvas-controls">
          <div class="viewport-controls" role="group" aria-label="Canvas view">
            <button type="button" aria-label="Zoom out" title="Zoom out" @click="zoomOut()">
              <Minus :size="16" aria-hidden="true" />
            </button>
            <output aria-label="Zoom level">{{ zoomLabel }}</output>
            <button type="button" aria-label="Zoom in" title="Zoom in" @click="zoomIn()">
              <Plus :size="16" aria-hidden="true" />
            </button>
            <span class="control-divider" aria-hidden="true"></span>
            <button type="button" aria-label="Fit workflow to view" title="Fit workflow to view" @click="fitView(fitOptions)">
              <Maximize :size="15" aria-hidden="true" />
            </button>
          </div>
        </Panel>
      </VueFlow>
    </div>

    <footer v-if="!presenting" class="workspace-footer">
      <span v-if="!clientView" class="interaction-hint"><MousePointer2 :size="13" aria-hidden="true" />Drag nodes · Connect ports · Scroll to zoom · Drag canvas to pan</span>
      <span class="file-status" :title="filePath">
        {{ nodes.length }} nodes<span class="footer-separator">/</span>{{ edges.length }} connections<span class="footer-separator">/</span>
        {{ fileName ?? (isDesktop ? 'No project file' : 'Browser preview') }}{{ dirty ? ' · Unsaved changes' : '' }}
      </span>
    </footer>
  </section>
</template>
