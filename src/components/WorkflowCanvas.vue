<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { ConnectionLineType, ConnectionMode, MarkerType, Panel, VueFlow, useVueFlow } from '@vue-flow/core'
import type { Connection, DefaultEdgeOptions, MouseTouchEvent, XYPosition } from '@vue-flow/core'
import { Maximize, Minus, MousePointer2, Plus, RotateCcw } from 'lucide-vue-next'
import GraphInspector from './GraphInspector.vue'
import NodePicker from './NodePicker.vue'
import WorkflowNode from './WorkflowNode.vue'
import { createWorkflowNode } from '../data/nodeCatalog'
import type { NodeKind, WorkflowNodeData } from '../data/nodeCatalog'
import { createSampleEdges, createSampleNodes } from '../data/sampleWorkflow'
import { canConnect, findNodePosition } from '../data/workflowGraph'

const sampleNodes = createSampleNodes()
const sampleEdges = createSampleEdges()
const {
  addEdges, addNodes, addSelectedNodes, connectionClickStartHandle, dimensions, edges, endConnection,
  findNode, fitView, getNodesInitialized, getSelectedEdges, getSelectedNodes, nodes, onClickConnectStart,
  onConnect, onConnectEnd, onConnectStart, onEdgeUpdate,
  onEdgeUpdateEnd, onEdgeUpdateStart, onNodeDragStart, onNodeDragStop, onNodesInitialized,
  removeEdges, removeNodes, removeSelectedElements, setEdges, setNodes, updateEdge, updateNode,
  updateNodeData, viewport, vueFlowRef, zoomIn, zoomOut,
} = useVueFlow()

const pickerOpen = ref(false)
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
let fitOnInitialize = true
let reconnectingEdgeId: string | undefined
let activeConnection: MouseTouchEvent | undefined
let connectionCancelled = false
let activeNodeDrag: { event: MouseTouchEvent; positions: { id: string; position: XYPosition }[] } | undefined

function validConnection(connection: Connection) {
  // Vue Flow also validates stored edges when parsing graph updates.
  const existingId = 'id' in connection && typeof connection.id === 'string' ? connection.id : undefined
  return (Boolean(existingId) || !connectionCancelled)
    && canConnect(connection, nodes.value, edges.value, existingId ?? reconnectingEdgeId)
}

onConnectStart(({ event }) => {
  activeConnection = event
  connectionCancelled = false
})
onConnectEnd(() => { activeConnection = undefined })
onClickConnectStart(() => { connectionCancelled = false })
onConnect((connection) => {
  if (validConnection(connection)) addEdges({ ...connection, id: `edge-${nextEdgeId++}` })
})
onEdgeUpdateStart(({ edge }) => { reconnectingEdgeId = edge.id })
onEdgeUpdate(({ edge, connection }) => {
  if (validConnection(connection)) updateEdge(edge, connection, false)
})
onEdgeUpdateEnd(() => { reconnectingEdgeId = undefined })
onNodeDragStart(({ event, nodes }) => {
  activeNodeDrag = { event, positions: nodes.map(({ id, position }) => ({ id, position: { ...position } })) }
})
onNodeDragStop(() => { activeNodeDrag = undefined })
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

async function addNode(kind: NodeKind, copy?: WorkflowNodeData, preferred?: XYPosition) {
  const position = findNodePosition(viewport.value, dimensions.value, nodes.value, preferred)
  const node = createWorkflowNode(kind, `node-${nextNodeId++}`, position)
  if (copy) {
    node.data = { ...copy, label: `${copy.label.slice(0, 75)} copy`, outputs: copy.outputs.map((port) => ({ ...port })) }
  }
  closePicker(false)
  removeSelectedElements()
  addNodes(node)
  const added = findNode(node.id)
  if (added) addSelectedNodes([added])
  await nextTick()
  vueFlowRef.value?.querySelector<HTMLElement>(`.vue-flow__node[data-id="${node.id}"]`)?.focus({ preventScroll: true })
}

function duplicateNode() {
  const node = selectedNode.value
  if (!node) return
  void addNode(node.data.kind, node.data, { x: node.position.x + 120, y: node.position.y + 24 })
}

function editNode(data: Partial<WorkflowNodeData>) {
  if (selectedNode.value) updateNodeData(selectedNode.value.id, data)
}

function editEdgeLabel(label: string) {
  if (selectedEdge.value) selectedEdge.value.label = label || undefined
}

function deleteSelection() {
  if (selectedNode.value) removeNodes(selectedNode.value)
  if (selectedEdge.value) removeEdges(selectedEdge.value)
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
  if (event.key !== 'Escape' || event.isComposing) return

  if (activeConnection) {
    connectionCancelled = true
    releaseGesture(activeConnection)
    endConnection()
  } else if (connectionClickStartHandle.value) {
    endConnection(undefined, true)
  } else if (activeNodeDrag) {
    const { event: dragEvent, positions } = activeNodeDrag
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
  } else {
    return
  }
  event.preventDefault()
  event.stopPropagation()
}

onMounted(() => document.addEventListener('keydown', onEscape, true))
onUnmounted(() => document.removeEventListener('keydown', onEscape, true))

async function resetDemo() {
  closePicker(false)
  endConnection(undefined, true)
  removeSelectedElements()
  fitOnInitialize = true
  setEdges([])
  setNodes(createSampleNodes())
  setEdges(createSampleEdges())
  await nextTick()
  fitInitializedGraph()
}
</script>

<template>
  <section class="workspace" aria-label="Workflow planning canvas">
    <div class="workspace-heading">
      <div>
        <p class="eyebrow">SAMPLE WORKFLOW</p>
        <h1>From event to action<span class="title-dot">.</span></h1>
        <p class="workspace-description">A little space to think through your automation.</p>
      </div>
      <div class="workspace-actions">
        <div class="node-picker-anchor">
          <button
            ref="addButton" class="reset-button add-node-button" type="button"
            aria-haspopup="dialog" :aria-expanded="pickerOpen" :aria-controls="pickerOpen ? 'node-picker' : undefined"
            @click="pickerOpen = !pickerOpen"
          >
            <Plus :size="15" aria-hidden="true" />Add Node
          </button>
          <NodePicker v-if="pickerOpen" @add="addNode" @close="closePicker()" />
        </div>
        <button class="reset-button" type="button" @click="resetDemo">
          <RotateCcw :size="14" aria-hidden="true" />Reset demo
        </button>
      </div>
    </div>

    <div class="canvas-frame">
      <VueFlow
        :nodes="sampleNodes"
        :edges="sampleEdges"
        :default-edge-options="defaultEdgeOptions"
        :connection-mode="ConnectionMode.Strict"
        :connection-line-options="{ type: ConnectionLineType.Bezier }"
        :is-valid-connection="validConnection"
        :edge-updater-radius="9"
        edges-updatable
        :min-zoom="0.25"
        :max-zoom="2"
        :delete-key-code="['Backspace', 'Delete']"
        :zoom-on-double-click="false"
        @pane-click="closePicker(false)"
        @node-click="closePicker(false)"
        @edge-click="closePicker(false)"
      >
        <template #node-workflow="nodeProps">
          <WorkflowNode :data="nodeProps.data" :selected="nodeProps.selected" />
        </template>

        <Panel position="top-left" class="canvas-note">
          <span class="canvas-note-dot" aria-hidden="true"></span>
          Sketch freely. Nothing runs here.
        </Panel>

        <Panel v-if="!pickerOpen && (selectedNode || selectedEdge)" position="top-right" class="inspector-panel nopan">
          <GraphInspector
            :key="selectedNode?.id ?? selectedEdge?.id"
            :node="selectedNode" :edge="selectedEdge"
            @close="removeSelectedElements()"
            @update-node="editNode"
            @update-label="editEdgeLabel"
            @duplicate="duplicateNode"
            @delete="deleteSelection"
          />
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

    <footer class="workspace-footer">
      <span class="interaction-hint"><MousePointer2 :size="13" aria-hidden="true" />Drag nodes · Connect ports · Scroll to zoom · Drag canvas to pan</span>
      <span>{{ nodes.length }} nodes<span class="footer-separator">/</span>{{ edges.length }} connections<span class="footer-separator">/</span>Session only</span>
    </footer>
  </section>
</template>
