const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { test } = require('node:test')
const { JSDOM, VirtualConsole } = require('jsdom')

const dist = resolve(__dirname, '../dist')
const index = readFileSync(resolve(dist, 'index.html'), 'utf8')
const bundle = readFileSync(resolve(dist, index.match(/src="\/([^"]+\.js)"/)[1]), 'utf8')
const tick = (ms = 0) => new Promise((done) => setTimeout(done, ms))

const legacyWorkflow = {
  schemaVersion: 1,
  metadata: { name: 'Phase 2B workflow' },
  nodes: [
    { id: 'webhook', kind: 'webhook', position: { x: 0, y: 100 }, label: 'Webhook' },
    { id: 'http', kind: 'http', position: { x: 180, y: 100 }, label: 'HTTP Request', icon: 'mail', color: 'violet' },
  ],
  edges: [
    { id: 'webhook-http', source: 'webhook', sourceHandle: 'out', target: 'http', targetHandle: 'in', label: 'Payload' },
  ],
}

function rect(x, y, width, height) {
  return { x, y, width, height, left: x, top: y, right: x + width, bottom: y + height }
}

function mockCanvas(window) {
  window.Element.prototype.getBoundingClientRect = function () {
    const node = this.closest('.vue-flow__node')
    if (!node) return rect(20, 130, 1080, 490)
    const [x, y] = node.style.transform.match(/[-.\d]+(?=px)/g)?.map(Number) ?? [0, 0]
    if (this.matches('.vue-flow__handle')) {
      return rect(x + (this.classList.contains('source') ? 72 : -12), y + 30, 12, 12)
    }
    return rect(x, y, 72, 72)
  }
  for (const [key, axis] of [['Width', 'width'], ['Height', 'height']]) {
    for (const prefix of ['offset', 'client']) {
      Object.defineProperty(window.HTMLElement.prototype, prefix + key, {
        get() { return this.getBoundingClientRect()[axis] },
      })
    }
  }
  window.SVGElement.prototype.getBBox = function () { return rect(0, 0, this.textContent.length * 6, 11) }
  window.DOMMatrixReadOnly = class {
    constructor(transform) { this.m22 = Number(String(transform).match(/scale\(([-.\d]+)\)/)?.[1] ?? 1) }
  }
  window.ResizeObserver = class {
    constructor(listener) { this.listener = listener }
    observe(target) {
      window.queueMicrotask(() => this.listener([{ target, contentRect: target.getBoundingClientRect() }]))
    }
    unobserve() {}
    disconnect() {}
  }
}

async function launch(t, recoveries = new Map()) {
  const errors = []
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('error', (error) => errors.push(String(error)))
  virtualConsole.on('warn', (warning) => errors.push(String(warning)))
  virtualConsole.on('jsdomError', (error) => errors.push(error.stack))
  const { window } = new JSDOM('<!doctype html><div id="app"></div>', {
    url: 'https://flowarchitect.invalid/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole,
  })
  const { document } = window
  t.after(() => {
    window.close()
    assert.deepEqual(errors, [])
  })
  mockCanvas(window)

  const files = new Map()
  let chosenFile
  let closeHandler
  let destroyed = false
  let pointerTarget
  document.elementFromPoint = () => pointerTarget ?? document.querySelector('.vue-flow__pane')
  window.confirm = () => true
  window.__TAURI__ = {
    core: {
      async invoke(command, args) {
        switch (command) {
          case 'open_workflow': return [chosenFile, files.get(chosenFile)]
          case 'save_workflow_as':
            if (!chosenFile) return null
            files.set(chosenFile, args.contents)
            return chosenFile
          case 'save_workflow': return void files.set(args.path, args.contents)
          case 'list_recovery': return [...recoveries.keys()]
          case 'read_recovery': return recoveries.get(args.id)
          case 'write_recovery': return void recoveries.set(args.id, args.contents)
          case 'remove_recovery': return void recoveries.delete(args.id)
          default: throw new Error('Unexpected command ' + command)
        }
      },
    },
    window: {
      getCurrentWindow: () => ({
        onCloseRequested: async (handler) => { closeHandler = handler; return () => {} },
        destroy: async () => { destroyed = true },
      }),
    },
  }

  const query = (selector) => document.querySelector(selector)
  const all = (selector) => [...document.querySelectorAll(selector)]
  const button = (label) => all('button').find((el) => el.textContent.trim() === label || el.getAttribute('aria-label') === label)
  const node = (id) => query('.vue-flow__node[data-id="' + id + '"]')
  const edge = (id) => query('.vue-flow__edge[data-id="' + id + '"]')
  const handle = (id, port) => node(id).querySelector('.vue-flow__handle[data-handleid="' + port + '"]')
  const field = (label) => {
    const wrapper = all('.graph-inspector label').find((el) => el.textContent.trim().startsWith(label))
    assert.ok(wrapper, 'Missing inspector field ' + label)
    return wrapper.querySelector('textarea, input, select')
  }
  const isDirty = () => query('.file-status').textContent.includes('Unsaved changes')

  function mouse(target, type, options = {}) {
    assert.ok(target, 'Missing pointer target for ' + type)
    const { x, y, width, height } = target.getBoundingClientRect()
    return target.dispatchEvent(new window.MouseEvent(type, {
      bubbles: true, cancelable: true, view: window, button: 0,
      buttons: type === 'mouseup' ? 0 : 1, clientX: x + width / 2, clientY: y + height / 2, ...options,
    }))
  }
  async function click(target) {
    const element = typeof target === 'string' ? button(target) : target
    mouse(element, 'pointerdown')
    mouse(element, 'click')
    await tick()
  }
  async function drag(from, to) {
    pointerTarget = from
    mouse(from, 'pointerdown')
    mouse(from, 'mousedown')
    pointerTarget = to
    mouse(to, 'mousemove')
    await tick()
    mouse(to, 'mouseup')
    pointerTarget = undefined
    await tick()
  }
  function key(key, options = {}, target = document.body) {
    const event = { key, bubbles: true, cancelable: true, ...options }
    const unhandled = target.dispatchEvent(new window.KeyboardEvent('keydown', event))
    target.dispatchEvent(new window.KeyboardEvent('keyup', event))
    return unhandled
  }
  function type(label, value) {
    const input = field(label)
    input.focus()
    input.value = value
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
    return input
  }
  async function edit(label, value) {
    const input = type(label, value)
    if (input.tagName !== 'TEXTAREA') input.dispatchEvent(new window.Event('change', { bubbles: true }))
    input.blur()
    await tick()
  }
  async function save(path = '/project.json', action = 'Save', withPointer = true) {
    chosenFile = path
    if (withPointer) await click(action)
    else {
      button(action).click()
      await tick()
    }
    return JSON.parse(files.get(path))
  }
  async function open(path, contents) {
    if (contents) files.set(path, JSON.stringify(contents))
    chosenFile = path
    await click('Open…')
  }
  async function close() {
    closeHandler({ preventDefault() {} })
    await tick()
    assert.ok(destroyed)
  }

  window.eval(bundle)
  await tick()
  return { query, button, node, edge, handle, field, isDirty, click, drag, key, type, edit, save, open, close }
}

async function demo(t) {
  const app = await launch(t)
  await app.click('Load demo')
  await app.click('Architect View')
  return app
}

test('edits all five node notes as multiline text in the inspector', async (t) => {
  const app = await demo(t)
  assert.equal(app.button('Architect View').getAttribute('aria-pressed'), 'true')
  await app.click(app.node('http'))
  const fields = { Purpose: 'Fetch details', Inputs: 'order ID', Outputs: 'details', 'Configuration notes': 'timeout 2 s', 'Error-handling strategy': 'retry twice' }
  for (const [label, note] of Object.entries(fields)) {
    assert.equal(app.field(label).value, '')
    assert.ok(app.field(label).placeholder)
    await app.edit(label, note + '\nSecond line')
  }
  assert.doesNotMatch(app.node('http').textContent, /Fetch details/)
  await app.click('Architect View')
  assert.equal(app.query('.graph-inspector textarea'), null)
  assert.ok(app.field('Name'))
  await app.click('Architect View')
  assert.equal(app.field('Purpose').value, 'Fetch details\nSecond line')
  const saved = await app.save()
  assert.deepEqual(saved.nodes.find(({ id }) => id === 'http').documentation, {
    purpose: 'Fetch details\nSecond line', inputs: 'order ID\nSecond line', outputs: 'details\nSecond line',
    configuration: 'timeout 2 s\nSecond line', errorHandling: 'retry twice\nSecond line',
  })
})

test('edits edge descriptions independently of visible labels', async (t) => {
  const app = await demo(t)
  await app.click(app.edge('router-error'))
  await app.edit('Label', 'Retry route')
  await app.edit('Technical description', '429 or timeout\nRetry once')
  assert.match(app.edge('router-error').textContent, /Retry route/)
  assert.doesNotMatch(app.edge('router-error').textContent, /Retry once/)
  const saved = await app.save()
  const edge = saved.edges.find(({ id }) => id === 'router-error')
  assert.equal(edge.description, '429 or timeout\nRetry once')
  assert.equal(edge.label, 'Retry route')
  await app.edit('Technical description', '  \n')
  assert.equal((await app.save()).edges.find(({ id }) => id === 'router-error').description, undefined)
})

test('edits all four project overview fields and returns to them after changing selection', async (t) => {
  const app = await demo(t)
  for (const [label, note] of [
    ['Project summary', 'Route orders\nReview exceptions'], ['Architecture goals', 'Idempotency'],
    ['Assumptions', 'Stable IDs'], ['Constraints', 'Local processing'],
  ]) await app.edit(label, note)
  await app.click(app.node('http'))
  await app.click('Close inspector')
  assert.equal(app.field('Project summary').value, 'Route orders\nReview exceptions')
  assert.deepEqual((await app.save()).metadata.overview, {
    summary: 'Route orders\nReview exceptions', goals: 'Idempotency', assumptions: 'Stable IDs', constraints: 'Local processing',
  })
})

test('Save commits a focused field; Save As and Open round-trip all three documentation scopes', async (t) => {
  const app = await demo(t)
  await app.edit('Project summary', 'Architecture sketch')
  await app.click(app.edge('router-error'))
  await app.edit('Technical description', 'Record failures')
  await app.click(app.node('http'))
  const draft = app.type('Purpose', 'Read details\nValidate fields')
  // Dispatch click without pointerdown so the session itself must commit the focused draft.
  const saved = await app.save('/documented.json', 'Save', false)
  assert.equal(draft.ownerDocument.activeElement === draft, false)
  assert.equal(saved.nodes.find(({ id }) => id === 'http').documentation.purpose, 'Read details\nValidate fields')
  await app.click('New Project')
  await app.open('/documented.json')
  assert.equal(app.field('Project summary').value, 'Architecture sketch')
  await app.click(app.node('http'))
  assert.equal(app.field('Purpose').value, 'Read details\nValidate fields')
  await app.click(app.edge('router-error'))
  assert.equal(app.field('Technical description').value, 'Record failures')
  assert.equal(app.isDirty(), false)
  assert.deepEqual(await app.save('/copy.json', 'Save As…'), saved)
})

test('opens Phase 2B files with empty optional notes and preserves the graph', async (t) => {
  const app = await launch(t)
  await app.open('/legacy.json', legacyWorkflow)
  await app.click('Architect View')
  assert.equal(app.field('Project summary').value, '')
  await app.click(app.node('http'))
  assert.equal(app.field('Purpose').value, '')
  await app.click(app.edge('webhook-http'))
  assert.equal(app.field('Technical description').value, '')
  assert.equal(app.isDirty(), false)
  assert.deepEqual(await app.save('/legacy.json'), legacyWorkflow)
})

test('duplicates notes independently and removes notes for deleted nodes and incident edges', async (t) => {
  const app = await demo(t)
  await app.click(app.edge('webhook-http'))
  await app.edit('Technical description', 'JSON body')
  await app.click(app.node('http'))
  app.type('Purpose', 'Original note')
  await app.click('Duplicate')
  assert.equal(app.field('Purpose').value, 'Original note')
  await app.edit('Purpose', 'Copied note')
  await app.click(app.node('http'))
  assert.equal(app.field('Purpose').value, 'Original note')
  app.key('Delete', {}, app.node('http'))
  await tick()
  assert.equal(app.node('http'), null)
  assert.equal(app.edge('webhook-http'), null)
  const saved = await app.save()
  assert.deepEqual(saved.nodes.find(({ id }) => id === 'node-1').documentation, { purpose: 'Copied note' })
  assert.ok(saved.nodes.every(({ id }) => id !== 'http'))
  assert.ok(saved.edges.every(({ id }) => id !== 'webhook-http'))
  await app.click('Undo')
  await app.click(app.node('http'))
  assert.equal(app.field('Purpose').value, 'Original note')
  await app.click(app.edge('webhook-http'))
  assert.equal(app.field('Technical description').value, 'JSON body')
})

test('records one undo step per field commit across all three scopes', async (t) => {
  const app = await demo(t)
  await app.edit('Project summary', 'Order routing')
  await app.click(app.node('http'))
  app.type('Purpose', 'F')
  app.type('Purpose', 'Fetch')
  await app.edit('Purpose', 'Fetch orders')
  await app.click(app.edge('router-error'))
  await app.edit('Technical description', 'Report error')
  assert.equal(app.key('z', { ctrlKey: true }), false)
  await tick()
  await app.click(app.edge('router-error'))
  assert.equal(app.field('Technical description').value, '')
  await app.click('Undo')
  await app.click(app.node('http'))
  assert.equal(app.field('Purpose').value, '')
  await app.click('Undo')
  assert.equal(app.field('Project summary').value, '')
  assert.equal(app.button('Undo').disabled, true)
  for (let step = 0; step < 3; step++) {
    assert.equal(app.key('Z', { ctrlKey: true, shiftKey: true }), false)
    await tick()
  }
  assert.equal(app.field('Project summary').value, 'Order routing')
  await app.click(app.node('http'))
  assert.equal(app.field('Purpose').value, 'Fetch orders')
  await app.click(app.edge('router-error'))
  assert.equal(app.field('Technical description').value, 'Report error')
})

test('autosaves committed notes and flushes a focused draft on normal close for recovery', async (t) => {
  const recoveries = new Map()
  const first = await launch(t, recoveries)
  await first.click('Load demo')
  await first.click('Architect View')
  await first.edit('Project summary', 'Unsaved overview')
  await first.click(first.edge('router-error'))
  await first.edit('Technical description', 'Unsaved connection')
  await tick(550)
  assert.equal(JSON.parse([...recoveries.values()][0]).metadata.overview.summary, 'Unsaved overview')

  await first.click(first.node('http'))
  first.type('Purpose', 'Unsaved focused note')
  await first.close()

  const second = await launch(t, recoveries)
  await second.click('Restore as unsaved')
  await second.click('Architect View')
  assert.equal(second.field('Project summary').value, 'Unsaved overview')
  await second.click(second.edge('router-error'))
  assert.equal(second.field('Technical description').value, 'Unsaved connection')
  await second.click(second.node('http'))
  assert.equal(second.field('Purpose').value, 'Unsaved focused note')
  assert.equal(second.isDirty(), true)
  await second.save()
  assert.equal(recoveries.size, 0)
})

test('tracks dirty state from committed content, through save, undo, redo, and clearing a note', async (t) => {
  const app = await demo(t)
  assert.equal(app.isDirty(), false)
  app.type('Project summary', 'Draft')
  assert.equal(app.isDirty(), false)
  await app.edit('Project summary', 'Committed')
  assert.equal(app.isDirty(), true)
  await app.save()
  assert.equal(app.isDirty(), false)
  await app.click('Undo')
  assert.equal(app.isDirty(), true)
  await app.click('Redo')
  assert.equal(app.isDirty(), false)
  await app.edit('Project summary', ' \n\t')
  assert.equal(app.isDirty(), true)
  assert.equal((await app.save()).metadata.overview, undefined)
})

test('leaves standard textarea shortcuts and IME Escape to the browser, with Escape reverting the draft', async (t) => {
  const app = await demo(t)
  await app.click(app.node('http'))
  await app.edit('Purpose', 'Saved note')
  const text = app.type('Purpose', 'Draft note')
  for (const [key, options] of [
    ['z', { ctrlKey: true }], ['Z', { ctrlKey: true, shiftKey: true }], ['y', { ctrlKey: true }],
    ['Delete', {}], ['Backspace', {}], ['Enter', {}], ['Escape', { isComposing: true }],
  ]) assert.equal(app.key(key, options, text), true)
  assert.ok(app.node('http').classList.contains('selected'))
  assert.equal(text.value, 'Draft note')
  assert.equal(app.key('Escape', {}, text), false)
  assert.equal(text.value, 'Saved note')
  text.blur()
  await app.click('Undo')
  await app.click(app.node('http'))
  assert.equal(app.field('Purpose').value, '')
})

test('preserves node appearance, Bézier connections, edge labels, and descriptions when reconnecting', async (t) => {
  const app = await demo(t)
  await app.click(app.node('http'))
  await app.edit('Name', 'Fetch orders')
  await app.edit('Icon', 'mail')
  await app.edit('Color', 'violet')
  await app.edit('Purpose', 'Prepare routing')
  assert.match(app.node('http').textContent, /Fetch orders/)
  assert.ok(app.node('http').querySelector('.lucide-mail-icon'))
  assert.equal(app.node('http').querySelector('.workflow-node').style.getPropertyValue('--node-accent'), '#b4a3cc')
  await app.click(app.edge('router-agent'))
  await app.edit('Label', 'Ready')
  app.type('Technical description', 'Successful validation')
  await app.drag(app.edge('router-agent').querySelector('.vue-flow__edgeupdater-target'), app.handle('error', 'in'))
  assert.match(app.edge('router-agent').getAttribute('aria-label'), /to error/)
  assert.match(app.edge('router-agent').querySelector('.vue-flow__edge-path').getAttribute('d'), /C/)
  assert.match(app.edge('router-agent').textContent, /Ready/)
  await app.click(app.edge('router-agent'))
  assert.equal(app.field('Technical description').value, 'Successful validation')
})

test('rejects malformed documentation and normalizes line endings, empty notes, and unknown keys', async (t) => {
  const app = await launch(t)
  await app.open('/legacy.json', legacyWorkflow)
  const malformed = [
    (file) => { file.metadata.overview = null },
    (file) => { file.metadata.overview = { summary: 42 } },
    (file) => { file.nodes[0].documentation = [] },
    (file) => { file.nodes[0].documentation = { inputs: false } },
    (file) => { file.edges[0].description = {} },
    (file) => { file.edges[0].description = 'x'.repeat(8001) },
  ]
  for (const change of malformed) {
    const invalid = structuredClone(legacyWorkflow)
    invalid.metadata.name = 'Invalid project'
    change(invalid)
    await app.open('/malformed.json', invalid)
    assert.match(app.query('[role="status"]').textContent, /documentation/i)
    assert.equal(app.query('.project-name').value, legacyWorkflow.metadata.name)
    assert.match(app.query('.file-status').textContent, /legacy\.json/)
  }

  const valid = structuredClone(legacyWorkflow)
  valid.metadata.overview = { summary: 'Listen\r\nRoute\rConfirm', goals: '\t ', futureField: true }
  valid.nodes[0].documentation = { purpose: '<b>Text only</b>', inputs: '' }
  await app.open('/normalized.json', valid)
  assert.equal(app.isDirty(), false)
  await app.click('Architect View')
  assert.equal(app.field('Project summary').value, 'Listen\nRoute\nConfirm')
  await app.click(app.node('webhook'))
  assert.equal(app.field('Purpose').value, '<b>Text only</b>')
  assert.equal(app.query('.graph-inspector textarea b'), null)
  const saved = await app.save('/normalized.json')
  assert.deepEqual(saved.metadata.overview, { summary: 'Listen\nRoute\nConfirm' })
  assert.deepEqual(saved.nodes[0].documentation, { purpose: '<b>Text only</b>' })
})
