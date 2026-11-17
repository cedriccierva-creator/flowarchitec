<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, shallowRef, watch } from 'vue'
import { ConnectionLineType, ConnectionMode, getTransformForBounds, MarkerType, Panel, VueFlow, useVueFlow } from '@vue-flow/core'
import type { Connection, DefaultEdgeOptions, MouseTouchEvent, XYPosition } from '@vue-flow/core'
import { Maximize, Minus, MousePointer2, Plus, Redo2, Search, Undo2 } from 'lucide-vue-next'
import FindNode from './FindNode.vue'
import ValidationPanel from './ValidationPanel.vue'
import { validateArchitecture } from '../data/architectureValidation'
import type { ArchitectureFinding } from '../data/architectureValidation'
import GraphInspector from './GraphInspector.vue'
import NodePicker from './NodePicker.vue'
import VisualSectionLayer from './VisualSectionLayer.vue'
import WorkflowNode from './WorkflowNode.vue'
import WorkflowMinimap from './WorkflowMinimap.vue'
import { architectTile, clientCard, createWorkflowNode, workflowNodeLabel } from '../data/nodeCatalog'
import type { NodeKind, WorkflowNodeData } from '../data/nodeCatalog'
import { isDesktop } from '../data/desktop'
import { reviewModes } from '../data/exportReviewPrompt'
import { captureWorkflow, materializeEdge, materializeNode, untitled } from '../data/workflowDocument'
import type { NodeDocumentation, NodeDocumentationField, OverviewField, ProjectOverview, WorkflowDocument } from '../data/workflowDocument'
import { useWorkflowSession } from '../composables/useWorkflowSession'
import { canConnect, findNodePosition } from '../data/workflowGraph'
import { createSection } from '../data/visualSections'
import type { VisualSection } from '../data/visualSections'

const {
  addEdges, addNodes, addSelectedEdges, addSelectedNodes, connectionClickStartHandle, dimensions, edges, endConnection,
  findNode, getNodesInitialized, getSelectedEdges, getSelectedNodes, nodes, onClickConnectStart,
  onConnect, onConnectEnd, onConnectStart, onEdgeUpdate,
  onEdgeUpdateEnd, onEdgeUpdateStart, onNodeDragStart, onNodeDragStop, onNodesInitialized, project,
  removeEdges, removeNodes, removeSelectedElements, screenToFlowCoordinate, setCenter, setEdges, setNodes, setViewport, updateEdge, updateNode,
  updateNodeData, updateNodeInternals, viewport, vueFlowRef, zoomIn, zoomOut, zoomTo,
} = useVueFlow()

const projectName = ref(untitled)
const architectView = ref(false)
const clientView = ref(false)
const presenting = defineModel<boolean>('presenting', { required: true })
const reviewOpen = ref(false)
const validationOpen = ref(false)
const showReviewControls = computed(() => architectView.value && !clientView.value && !presenting.value)
const longReviewPromptThreshold = 50_000
const presentButton = ref<HTMLButtonElement>()
const exitPresentationButton = ref<HTMLButtonElement>()
const overview = shallowRef<ProjectOverview>()
const nodeDocumentation = reactive(new Map<string, NodeDocumentation>())
const edgeDescriptions = reactive(new Map<string, string>())
const sections = shallowRef<readonly VisualSection[]>([])
const sectionLayer = ref<InstanceType<typeof VisualSectionLayer>>()
const selectedSectionId = ref<string>()
const selectedSection = computed(() => sections.value.find(({ id }) => id === selectedSectionId.value))
const sectionsEditable = computed(() => architectView.value && !clientView.value && !presenting.value)
const sectionGesture = ref(false)
const pickerOpen = ref(false)
const picker = ref<InstanceType<typeof NodePicker>>()
const addButton = ref<HTMLButtonElement>()
const findOpen = ref(false)
const autofocusFind = ref(true)
const findButton = ref<HTMLButtonElement>()
const focusedNodeId = ref<string>()
const selectedNode = computed(() => getSelectedNodes.value.length === 1 && !getSelectedEdges.value.length
  ? getSelectedNodes.value[0] : undefined)
const selectedEdge = computed(() => getSelectedEdges.value.length === 1 && !getSelectedNodes.value.length
  ? getSelectedEdges.value[0] : undefined)
const zoomLabel = computed(() => viewport.value.zoom < 0.01 ? '<1%' : `${Math.round(viewport.value.zoom * 100)}%`)
const maxZoom = 2
const tile = computed(() => clientView.value ? clientCard : architectTile)
const visibleNodes = computed(() => nodes.value.filter(({ hidden }) => !hidden))
const findEntries = computed(() => visibleNodes.value.map(({ id, data }) => ({ id, label: workflowNodeLabel(data, clientView.value) })))
const workflowBounds = computed(() => {
  if (!visibleNodes.value.length && !sections.value.length) return
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  function include({ x, y }: XYPosition, width: number, height: number) {
    left = Math.min(left, x)
    top = Math.min(top, y)
    right = Math.max(right, x + width)
    bottom = Math.max(bottom, y + height)
  }
  for (const { position } of visibleNodes.value) include(position, tile.value.width, tile.value.height)
  for (const { position, width, height } of sections.value) include(position, width, height)
  return { x: left, y: top, width: right - left, height: bottom - top }
})
const fittedViewport = computed(() => {
  const { width, height } = dimensions.value
  if (workflowBounds.value && width > 0 && height > 0) {
    return getTransformForBounds(workflowBounds.value, width, height, Number.EPSILON, 1.2, 0.28)
  }
})
// Keep the usual zoom floor unless Fit View needs a wider overview.
const minZoom = computed(() => Math.min(0.25, fittedViewport.value?.zoom ?? 0.25, viewport.value.zoom))
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
let nextSectionId = 1
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
    sections.value,
  ),
  applyDocument,
  () => Boolean(activeNodeDrag.value || sectionGesture.value),
)

const validationFindings = computed(() => validateArchitecture(captureWorkflow(
  { name: projectName.value, overview: overview.value }, nodes.value, edges.value,
  nodeDocumentation, edgeDescriptions, sections.value,
)))

function focusFinding(finding: ArchitectureFinding) {
  if (!showReviewControls.value || !canNavigate()) return
  const target = finding.target
  const node = target.type === 'node' ? findNode(target.id!) : undefined
  const edge = target.type === 'edge' ? edges.value.find(({ id }) => id === target.id) : undefined
  if ((target.type === 'node' && !node) || (target.type === 'edge' && !edge)) return
  // Finish an inspector draft before changing its context.
  const active = document.activeElement
  if (active instanceof HTMLElement && textEntry(active)) active.blur()
  closePicker(false)
  closeFind(false)
  removeSelectedElements()
  selectedSectionId.value = undefined
  focusedNodeId.value = undefined
  if (node) {
    addSelectedNodes([node])
    focusNode(node.id)
  } else if (edge) {
    addSelectedEdges([edge])
    const source = findNode(edge.source)
    const destination = findNode(edge.target)
    if (source && destination) {
      void setCenter((source.position.x + destination.position.x + architectTile.width) / 2,
        (source.position.y + destination.position.y + architectTile.height) / 2, { zoom: Math.max(1, viewport.value.zoom) })
    }
  }
  void nextTick(() => vueFlowRef.value?.querySelector<HTMLElement>('.graph-inspector textarea')?.focus({ preventScroll: true }))
}

function nextId(type: 'node' | 'edge' | 'section') {
  let id: string
  do {
    if (type === 'node') id = `node-${nextNodeId++}`
    else if (type === 'edge') id = `edge-${nextEdgeId++}`
    else id = `section-${nextSectionId++}`
  } while (findNode(id) || edges.value.some((edge) => edge.id === id) || sections.value.some((section) => section.id === id))
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
  selectedSectionId.value = undefined
  recordEdit()
  activeNodeDrag.value = { event, positions: nodes.map(({ id, position }) => ({ id, position: { ...position } })) }
})
onNodeDragStop(() => {
  if (!activeNodeDrag.value) return
  activeNodeDrag.value = undefined
  recordEdit()
})
function fitInitializedGraph() {
  if (!fitOnInitialize || getNodesInitialized.value.length !== nodes.value.length) return
  fitOnInitialize = false
  void fitWorkflow()
}

onNodesInitialized(fitInitializedGraph)

function closePicker(restoreFocus = true) {
  pickerOpen.value = false
  if (restoreFocus) addButton.value?.focus()
}

const pickerBlocked = computed(() => busy.value || exporting.value || clientView.value || presenting.value)
watch(pickerBlocked, (blocked) => { if (blocked) closePicker(false) })

const navigationBlocked = computed(() => busy.value || exporting.value || Boolean(activeNodeDrag.value) || sectionGesture.value)
watch(() => busy.value || exporting.value, (blocked) => { if (blocked) closeFind(false) })

function canNavigate() {
  return !navigationBlocked.value && !activeConnection && !reconnectingEdgeId && !connectionClickStartHandle.value
}

function canUsePicker() {
  return !pickerBlocked.value && !activeNodeDrag.value && !sectionGesture.value && !activeConnection && !reconnectingEdgeId
    && !connectionClickStartHandle.value
}

function canEditSection() {
  return sectionsEditable.value && canUsePicker()
}

function fitWorkflow() {
  return setViewport(fittedViewport.value ?? { x: 0, y: 0, zoom: 1 })
}

function navigate(action: () => unknown) {
  if (canNavigate()) void action()
}

function openFind() {
  if (!canNavigate()) return
  closePicker(false)
  autofocusFind.value = !textEntry(document.activeElement)
  findOpen.value = true
}

function closeFind(restoreFocus = true) {
  if (!findOpen.value) return
  findOpen.value = false
  const focused = document.activeElement
  if (restoreFocus && (!textEntry(focused) || focused?.closest('#find-node'))) {
    findButton.value?.focus({ preventScroll: true })
  }
}

function focusNode(id: string) {
  if (!canNavigate()) return
  const node = findNode(id)
  if (!node || node.hidden) return
  const { x, y } = node.position
  const { width, height } = tile.value
  void setCenter(x + width / 2, y + height / 2, { zoom: Math.max(1, viewport.value.zoom) })
  focusedNodeId.value = id
  closeFind()
}

function centerMinimap({ x, y }: XYPosition) {
  navigate(() => setCenter(x, y, { zoom: viewport.value.zoom }))
}

function selectSection(id: string) {
  if (!canEditSection()) return
  closePicker(false)
  removeSelectedElements()
  selectedSectionId.value = id
}

function clearCanvasOverlay() {
  closePicker(false)
  closeFind(false)
  focusedNodeId.value = undefined
  selectedSectionId.value = undefined
}

watch(() => getSelectedNodes.value.length + getSelectedEdges.value.length, (count) => {
  if (count) selectedSectionId.value = undefined
})
watch(sectionsEditable, (editable) => {
  if (editable) return
  sectionLayer.value?.cancelGesture()
  selectedSectionId.value = undefined
})

async function addSection() {
  if (!canEditSection()) return
  const section = createSection(nextId('section'), dimensions.value, viewport.value.zoom, project)
  sections.value = [...sections.value, section]
  selectSection(section.id)
  await nextTick()
  sectionLayer.value?.focusSection(section.id)
}

function updateSection(id: string | undefined, changes: Partial<Omit<VisualSection, 'id'>>) {
  if (!id) return
  sections.value = sections.value.map((section) => section.id === id ? { ...section, ...changes } : section)
}

function openPicker() {
  if (!canUsePicker()) return
  closeFind(false)
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
  if (busy.value || activeNodeDrag.value || sectionGesture.value || activeConnection || reconnectingEdgeId) return
  const focused = document.activeElement
  if (focused instanceof HTMLElement && focused.closest('input, textarea')) focused.blur()
  clearCanvasOverlay()
  endConnection(undefined, true)
  removeSelectedElements()
  clientView.value = !clientView.value
  void nextTick(() => updateNodeInternals())
}

function setPresentation(enabled: boolean) {
  if (!clientView.value) return
  closeFind(false)
  presenting.value = enabled
  void nextTick(() => (enabled ? exitPresentationButton.value : presentButton.value)?.focus())
}

async function addNode(kind: NodeKind, copy?: WorkflowNodeData, preferred?: XYPosition, documentation?: NodeDocumentation) {
  const position = findNodePosition(project, dimensions.value, nodes.value, preferred)
  const node = createWorkflowNode(kind, nextId('node'), position)
  if (copy) {
    node.data = { ...copy, label: `${copy.label.slice(0, 75)} copy`, outputs: copy.outputs.map((port) => ({ ...port })) }
  }
  clearCanvasOverlay()
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
  if (sectionGesture.value) return
  if (selectedSection.value) {
    sections.value = sections.value.filter(({ id }) => id !== selectedSectionId.value)
    selectedSectionId.value = undefined
    vueFlowRef.value?.focus({ preventScroll: true })
    return
  }
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
  if (sectionGesture.value) return
  if (selectedSection.value) selectedSectionId.value = undefined
  else if (selectedNode.value || selectedEdge.value) removeSelectedElements()
  else architectView.value = false
}

function commitDocumentationBeforePointerAction(event: PointerEvent) {
  if (event.target instanceof Element && event.target.closest('[data-export-action], [data-viewport-action]')) return
  const focused = document.activeElement
  // Canvas selection or dragging can take over before the browser moves focus.
  if (event.button === 0 && (focused instanceof HTMLTextAreaElement
    || (focused instanceof HTMLInputElement && focused.closest('.editor-documentation-field')))
    && event.target instanceof Node
    && !focused.closest('label')?.contains(event.target)) focused.blur()
}

function keepFieldFocused(event: MouseEvent) {
  // Clicking the Find field explicitly transfers focus. Other navigation preserves a focused draft.
  if (event.target instanceof HTMLInputElement && event.target.closest('#find-node')) return
  if (document.activeElement?.matches('input, textarea, select')) event.preventDefault()
}

function textEntry(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || Boolean(target.closest('input, textarea, select')))
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
  } else if (sectionGesture.value) {
    sectionLayer.value?.cancelGesture()
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
  } else if (selectedSection.value) {
    closeInspector()
    vueFlowRef.value?.focus({ preventScroll: true })
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
  const key = event.key.toLowerCase()
  const target = event.target instanceof Element ? event.target : undefined
  const dialog = target?.closest('[role="dialog"], dialog')
  if (key === 'f' && event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
    if (textEntry(event.target) || dialog || pickerOpen.value || !canNavigate()) return
    event.preventDefault()
    if (!event.repeat) openFind()
    return
  }
  if (event.key === 'Escape') {
    if (findOpen.value && (dialog?.id === 'find-node' || (!dialog && !textEntry(event.target)))) {
      event.preventDefault()
      event.stopPropagation()
      closeFind()
    } else {
      onEscape(event)
    }
    return
  }
  if (clientView.value || presenting.value || busy.value || activeNodeDrag.value || sectionGesture.value || activeConnection || reconnectingEdgeId
    || (event.target instanceof HTMLElement
      && (event.target.isContentEditable || event.target.closest('input, textarea, select, .node-picker')))) return

  if (key === 'k' && event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
    if (!architectView.value || !canUsePicker()) return
    event.preventDefault()
    if (!event.repeat) openPicker()
  } else if (event.ctrlKey && !event.altKey && !event.metaKey && (key === 'z' || key === 'y')) {
    event.preventDefault()
    if (key === 'y' || event.shiftKey) redo()
    else undo()
  } else if (!event.ctrlKey && !event.altKey && !event.metaKey && (key === 'delete' || key === 'backspace')) {
    if (!selectedSection.value && !getSelectedNodes.value.length && !getSelectedEdges.value.length) return
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
  clearCanvasOverlay()
  endConnection(undefined, true)
  removeSelectedElements()
  projectName.value = document.metadata.name
  overview.value = document.metadata.overview
  sections.value = document.sections ?? []
  nodeDocumentation.clear()
  edgeDescriptions.clear()
  for (const { id, documentation } of document.nodes) {
    if (documentation) nodeDocumentation.set(id, documentation)
  }
  for (const { id, description } of document.edges) {
    if (description !== undefined) edgeDescriptions.set(id, description)
  }
  fitOnInitialize = fit && (document.nodes.length > 0 || sections.value.length > 0)
  setEdges([])
  setNodes(document.nodes.map(materializeNode))
  setEdges(document.edges.map(materializeEdge))
  if (fit && !fitOnInitialize) void fitWorkflow()
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
    :style="{
      '--client-card-width': `${clientCard.width}px`, '--client-card-height': `${clientCard.height}px`,
      '--architect-tile-width': `${architectTile.width}px`, '--architect-tile-height': `${architectTile.height}px`,
    }"
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
          <button v-if="sectionsEditable" class="reset-button" type="button" :disabled="pickerBlocked || sectionGesture" @click="addSection">
            <Plus :size="15" aria-hidden="true" />Add Section
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
            :disabled="busy || exporting || !isDesktop" @mousedown="keepFieldFocused" @click="requestExport(() => exportProject('png'))">
            Export PNG
          </button>
          <button class="reset-button" type="button" data-export-action
            :disabled="busy || exporting || !isDesktop" @mousedown="keepFieldFocused" @click="requestExport(() => exportProject('md'))">
            Export Markdown
          </button>
        </div>
        <button v-if="showReviewControls" class="reset-button" type="button" data-viewport-action
          :aria-expanded="validationOpen" :aria-controls="validationOpen ? 'architecture-validation' : undefined"
          :disabled="navigationBlocked" @mousedown="keepFieldFocused" @click="validationOpen = !validationOpen">
          Validate Architecture
        </button>
        <button v-if="showReviewControls" class="reset-button" type="button" data-export-action
          :aria-controls="reviewOpen ? 'review-prompt' : undefined" :aria-expanded="reviewOpen"
          @mousedown="keepFieldFocused" @click="reviewOpen = !reviewOpen">
          AI Review Prompt
        </button>
      </div>
    </div>

    <ValidationPanel v-if="showReviewControls && validationOpen" :findings="validationFindings"
      :blocked="navigationBlocked" :empty="!nodes.length" @focus="focusFinding" @close="validationOpen = false" />

    <section v-if="showReviewControls && reviewOpen" id="review-prompt" class="review-prompt" aria-label="AI review prompt">
      <div class="review-prompt-actions">
        <label>
          Review mode
          <select v-model="reviewMode" :disabled="busy || exporting">
            <option v-for="(mode, id) in reviewModes" :key="id" :value="id">{{ mode.label }}</option>
          </select>
        </label>
        <button class="reset-button" type="button" data-export-action :disabled="busy || exporting || !isDesktop"
          @mousedown="keepFieldFocused" @click="requestExport(copyReviewPrompt)">Copy Review Prompt</button>
        <button class="reset-button" type="button" data-export-action :disabled="busy || exporting || !isDesktop"
          @mousedown="keepFieldFocused" @click="requestExport(saveReviewPrompt)">Save Review Prompt as Markdown</button>
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
        :min-zoom="minZoom"
        :max-zoom="maxZoom"
        :delete-key-code="null"
        :zoom-on-double-click="false"
        @pane-click="clearCanvasOverlay"
        @node-click="clearCanvasOverlay"
        @edge-click="clearCanvasOverlay"
      >
        <template #node-workflow="nodeProps">
          <WorkflowNode
            :data="nodeProps.data" :selected="nodeProps.selected" :client="clientView"
            :find-focused="nodeProps.id === focusedNodeId"
          />
        </template>

        <template #zoom-pane>
          <VisualSectionLayer
            v-if="sections.length" ref="sectionLayer" :sections="sections" :selected-id="selectedSectionId"
            :editable="sectionsEditable" :can-start="canEditSection" :project="screenToFlowCoordinate"
            @select="selectSection" @gesture="sectionGesture = $event" @update="updateSection"
          />
        </template>

        <Panel v-if="!clientView" position="top-left" class="canvas-note">
          <span class="canvas-note-dot" aria-hidden="true"></span>
          Sketch freely. Nothing runs here.
        </Panel>

        <Panel v-if="!clientView && !pickerOpen && (architectView || selectedNode || selectedEdge)" position="top-right" class="inspector-panel nopan nowheel">
          <GraphInspector
            :key="selectedSection?.id ?? selectedNode?.id ?? selectedEdge?.id ?? ''"
            :node="selectedNode" :edge="selectedEdge" :section="selectedSection" :architect="architectView"
            :node-documentation="selectedNode && nodeDocumentation.get(selectedNode.id)"
            :edge-description="selectedEdge && edgeDescriptions.get(selectedEdge.id)"
            :overview="overview"
            @close="closeInspector"
            @update-node="editNode"
            @update-label="editEdgeLabel"
            @update-node-documentation="editNodeDocumentation"
            @update-edge-description="editEdgeDescription"
            @update-overview="editOverview"
            @update-section="updateSection(selectedSectionId, $event)"
            @duplicate="duplicateNode"
            @delete="deleteSelection"
          />
        </Panel>

        <Panel v-if="presenting" position="top-right" class="presentation-controls nopan">
          <button ref="exitPresentationButton" class="reset-button" type="button" @click="setPresentation(false)">
            Exit Presentation
          </button>
        </Panel>

        <Panel position="bottom-left" class="canvas-controls nopan nowheel nokey">
          <FindNode v-if="findOpen" :nodes="findEntries" :autofocus="autofocusFind" data-viewport-action
            @mousedown="keepFieldFocused" @focus="focusNode" @close="closeFind()" />
          <WorkflowMinimap
            v-else-if="workflowBounds" :bounds="workflowBounds" :nodes="visibleNodes" :sections="sections"
            :tile="tile" :viewport="viewport" :dimensions="dimensions" :disabled="navigationBlocked"
            data-viewport-action @mousedown="keepFieldFocused" @center="centerMinimap" @fit="navigate(fitWorkflow)"
          />
          <div class="viewport-controls" role="group" aria-label="Canvas view" data-viewport-action @mousedown="keepFieldFocused">
            <button type="button" aria-label="Zoom out" title="Zoom out" :disabled="navigationBlocked" @click="navigate(zoomOut)">
              <Minus :size="16" aria-hidden="true" />
            </button>
            <button class="zoom-reset" type="button" aria-label="Reset zoom to 100%" title="Reset zoom to 100%" aria-describedby="zoom-level"
              :disabled="navigationBlocked" @click="navigate(() => zoomTo(1))">
              <span id="zoom-level">{{ zoomLabel }}</span>
            </button>
            <button type="button" aria-label="Zoom in" title="Zoom in" :disabled="navigationBlocked" @click="navigate(zoomIn)">
              <Plus :size="16" aria-hidden="true" />
            </button>
            <span class="control-divider" aria-hidden="true"></span>
            <button type="button" aria-label="Fit workflow to view" title="Fit workflow to view" :disabled="navigationBlocked"
              @click="navigate(fitWorkflow)">
              <Maximize :size="15" aria-hidden="true" />
            </button>
            <button ref="findButton" type="button" aria-label="Find node" title="Find node (Ctrl+F)" aria-keyshortcuts="Control+F"
              aria-haspopup="dialog" :aria-expanded="findOpen" :aria-controls="findOpen ? 'find-node' : undefined"
              :disabled="navigationBlocked" @click="findOpen ? closeFind() : openFind()">
              <Search :size="15" aria-hidden="true" />
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
