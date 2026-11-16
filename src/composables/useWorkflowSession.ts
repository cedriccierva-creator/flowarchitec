import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { closeDesktopWindow, invoke, isDesktop, onDesktopClose } from '../data/desktop'
import { exportMarkdown } from '../data/exportMarkdown'
import { exportPng } from '../data/exportPng'
import { exportReviewPrompt } from '../data/exportReviewPrompt'
import type { ReviewMode } from '../data/exportReviewPrompt'
import { demoWorkflow, parseWorkflow, untitled } from '../data/workflowDocument'
import type { WorkflowDocument } from '../data/workflowDocument'

const historyLimit = 80
const recoveryDelay = 500

function newRecoveryId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function messageFor(error: unknown) {
  if (typeof error === 'string') return error
  return error instanceof Error ? error.message : 'Could not complete the workflow operation.'
}

interface RecoveryEntry {
  id: string
  document?: WorkflowDocument
}

export function useWorkflowSession(
  capture: () => WorkflowDocument,
  apply: (document: WorkflowDocument, fit?: boolean) => void,
  gestureInProgress: () => boolean,
) {
  const past = ref<string[]>([])
  const future = ref<string[]>([])
  const current = ref(JSON.stringify(capture()))
  const saved = ref(current.value)
  const filePath = ref<string>()
  const busy = ref(false)
  const exporting = ref(false)
  const exportStatus = ref<'success' | 'cancelled'>()
  const reviewMode = ref<ReviewMode>('architecture')
  const reviewPrompt = computed(() => {
    const snapshot = capture()
    return { name: snapshot.metadata.name, contents: exportReviewPrompt(snapshot, reviewMode.value) }
  })
  const reviewPromptLength = computed(() => reviewPrompt.value.contents.length)
  const notice = ref('')
  const recoveryError = ref('')
  const recoveries = shallowRef<RecoveryEntry[]>([])
  const showRecovery = ref(false)
  const dirty = computed(() => current.value !== saved.value)
  const fileName = computed(() => filePath.value?.split('/').at(-1))
  let recoveryId = newRecoveryId()
  let timer: ReturnType<typeof setTimeout> | undefined
  let writes = Promise.resolve()

  function flushRecovery() {
    clearTimeout(timer)
    if (!isDesktop) return Promise.resolve()
    const id = recoveryId
    const args = dirty.value ? { id, contents: current.value } : { id }
    const command = dirty.value ? 'write_recovery' : 'remove_recovery'
    const result = writes.then(() => invoke<void>(command, args))
    writes = result.catch(() => {})
    void result.then(
      () => { recoveryError.value = '' },
      () => { recoveryError.value = 'Could not update the recovery snapshot.' },
    )
    return result
  }

  function scheduleRecovery() {
    if (!isDesktop) return
    clearTimeout(timer)
    timer = setTimeout(() => { void flushRecovery().catch(() => {}) }, recoveryDelay)
  }

  function recordEdit(next = JSON.stringify(capture())) {
    if (gestureInProgress()) return
    if (next === current.value) return
    past.value.push(current.value)
    if (past.value.length > historyLimit) past.value.shift()
    current.value = next
    future.value = []
    scheduleRecovery()
  }

  watch(
    () => gestureInProgress() ? undefined : JSON.stringify(capture()),
    (snapshot) => { if (snapshot !== undefined) recordEdit(snapshot) },
  )

  function travel(direction: 'undo' | 'redo') {
    if (busy.value || gestureInProgress()) return
    recordEdit()
    const [from, to] = direction === 'undo' ? [past.value, future.value] : [future.value, past.value]
    const next = from.pop()
    if (next === undefined) return
    to.push(current.value)
    current.value = next
    apply(JSON.parse(next) as WorkflowDocument)
    scheduleRecovery()
  }

  function undo() { travel('undo') }
  function redo() { travel('redo') }

  function activate(document: WorkflowDocument, path?: string, recoveredId?: string) {
    recoveryId = recoveredId ?? newRecoveryId()
    current.value = JSON.stringify(document)
    saved.value = recoveredId ? '' : current.value
    filePath.value = path
    past.value = []
    future.value = []
    apply(document, true)
  }

  async function run(action: () => Promise<void>) {
    if (busy.value || gestureInProgress()) return
    const focused = document.activeElement
    if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) focused.blur()
    notice.value = ''
    exportStatus.value = undefined
    recordEdit()
    busy.value = true
    try {
      await action()
    } catch (error) {
      notice.value = messageFor(error)
    } finally {
      busy.value = false
    }
  }

  function mayLeave() {
    return !dirty.value || window.confirm(isDesktop
      ? 'Leave this workflow without saving the project file? FlowArchitect will keep a recovery snapshot.'
      : 'Discard unsaved changes to this workflow?')
  }

  function openProject() {
    return run(async () => {
      const result = await invoke<[string, string] | null>('open_workflow')
      if (!result) return
      const [path, contents] = result
      const document = parseWorkflow(contents)
      if (!mayLeave()) return
      await flushRecovery()
      activate(document, path)
    })
  }

  function saveProject(saveAs = false) {
    return run(async () => {
      const snapshot = current.value
      const document = JSON.parse(snapshot) as WorkflowDocument
      const contents = JSON.stringify(document, null, 2) + '\n'
      const path = filePath.value
      if (path && !saveAs) {
        await invoke('save_workflow', { path, contents })
      } else {
        const suggestedName = suggestedFileName(document.metadata.name, '.json')
        const selectedPath = await invoke<string | null>('save_workflow_as', { suggestedName, contents })
        if (!selectedPath) return
        filePath.value = selectedPath
      }
      saved.value = snapshot
      await flushRecovery().catch(() => {})
    })
  }

  function suggestedFileName(projectName: string, suffix: string) {
    const name = projectName.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'workflow'
    return name + suffix
  }

  async function runExport(action: () => Promise<string | undefined>, cancelNotice = '') {
    if (busy.value || exporting.value || gestureInProgress()) return
    notice.value = ''
    exportStatus.value = undefined
    exporting.value = true
    try {
      const successNotice = await action()
      notice.value = successNotice ?? cancelNotice
      exportStatus.value = successNotice ? 'success' : 'cancelled'
    } catch (error) {
      notice.value = messageFor(error)
    } finally {
      exporting.value = false
    }
  }

  function saveExport(format: 'png' | 'md', suggestedName: string, contents: string) {
    return invoke<boolean>('save_export', { format, suggestedName, contents })
  }

  function exportProject(format: 'png' | 'md') {
    return runExport(async () => {
      const snapshot = capture()
      const contents = format === 'png' ? await exportPng(snapshot) : exportMarkdown(snapshot)
      const saved = await saveExport(format, suggestedFileName(snapshot.metadata.name, '.' + format), contents)
      if (saved) return format === 'png' ? 'PNG exported.' : 'Markdown exported.'
    })
  }

  function saveReviewPrompt() {
    return runExport(async () => {
      const { name, contents } = reviewPrompt.value
      const saved = await saveExport('md', suggestedFileName(name, ' - Review Prompt.md'), contents)
      if (saved) return 'Review prompt saved.'
    }, 'Review prompt save cancelled.')
  }

  function copyReviewPrompt() {
    return runExport(async () => {
      try {
        await invoke<void>('copy_review_prompt', { contents: reviewPrompt.value.contents })
      } catch {
        throw new Error('Could not copy the review prompt to the clipboard. Try saving it as Markdown.')
      }
      return 'Review prompt copied.'
    })
  }

  function newProject(demo = false) {
    return run(async () => {
      if (!mayLeave()) return
      await flushRecovery()
      activate(demo ? demoWorkflow() : { schemaVersion: 1, metadata: { name: untitled }, nodes: [], edges: [] })
    })
  }

  function restore(entry: RecoveryEntry) {
    return run(async () => {
      if (!entry.document || !mayLeave()) return
      await flushRecovery()
      activate(entry.document, undefined, entry.id)
      recoveries.value = recoveries.value.filter(({ id }) => id !== entry.id)
    })
  }

  function discardRecovery(entry: RecoveryEntry) {
    return run(async () => {
      if (!window.confirm('Permanently discard this recovery snapshot?')) return
      await invoke('remove_recovery', { id: entry.id })
      recoveries.value = recoveries.value.filter(({ id }) => id !== entry.id)
    })
  }

  async function loadRecovery() {
    const ids = await invoke<string[]>('list_recovery')
    recoveries.value = await Promise.all(ids.map(async (id): Promise<RecoveryEntry> => {
      try {
        return { id, document: parseWorkflow(await invoke<string>('read_recovery', { id })) }
      } catch {
        return { id }
      }
    }))
    showRecovery.value = recoveries.value.length > 0
  }

  let unsubscribe: Promise<() => void> | undefined
  onMounted(() => {
    if (!isDesktop) return
    unsubscribe = onDesktopClose((event) => {
      event.preventDefault()
      void run(async () => {
        try {
          await flushRecovery()
        } catch {
          if (!window.confirm('The recovery snapshot could not be updated. Close anyway?')) return
        }
        await closeDesktopWindow()
      })
    })
    void unsubscribe?.catch(() => { notice.value = 'Could not set up recovery on window close.' })
    void run(loadRecovery)
  })
  onUnmounted(() => {
    clearTimeout(timer)
    void unsubscribe?.then((stop) => stop()).catch(() => {})
  })

  return {
    busy, exporting, exportStatus, notice, recoveryError, recoveries, showRecovery, dirty, filePath, fileName, recordEdit,
    canUndo: computed(() => past.value.length > 0), canRedo: computed(() => future.value.length > 0),
    undo, redo, newProject, openProject, saveProject, exportProject, restore, discardRecovery,
    reviewMode, reviewPromptLength, copyReviewPrompt, saveReviewPrompt,
  }
}
