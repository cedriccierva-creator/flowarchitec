const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { test } = require('node:test')
const { JSDOM, VirtualConsole } = require('jsdom')

const dist = resolve(__dirname, '../dist')
const index = readFileSync(resolve(dist, 'index.html'), 'utf8')
const bundle = readFileSync(resolve(dist, index.match(/src="\/([^"]+\.js)"/)[1]), 'utf8')
const stylesheet = readFileSync(resolve(dist, index.match(/href="\/([^"]+\.css)"/)[1]), 'utf8')
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
    const client = node.closest('.is-client-view')
    const width = client ? 140 : 72
    const height = client ? 88 : 72
    if (this.matches('.vue-flow__handle')) {
      const center = (Number.parseFloat(this.style.top) || 50) / 100
      return rect(x + (this.classList.contains('source') ? width : -12), y + height * center - 6, 12, 12)
    }
    return rect(x, y, width, height)
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
  const style = document.createElement('style')
  style.textContent = stylesheet
  document.head.append(style)
  t.after(() => {
    window.close()
    assert.deepEqual(errors, [])
  })
  mockCanvas(window)

  const files = new Map()
  const exports = []
  const recoveryWrites = []
  let exportResponse = true
  let lastRaster
  window.Image = class {
    set src(url) {
      this.url = url
      window.queueMicrotask(() => this.onload())
    }
  }
  window.HTMLCanvasElement.prototype.getContext = function () {
    return {
      measureText: (text) => ({ width: Array.from(text).length * 6 }),
      fillRect() {},
      drawImage: (image) => {
        const svg = decodeURIComponent(image.url.split(',')[1])
        lastRaster = {
          scene: new window.DOMParser().parseFromString(svg, 'image/svg+xml').documentElement,
          width: this.width, height: this.height,
        }
      },
    }
  }
  window.HTMLCanvasElement.prototype.toDataURL = function () {
    const header = Buffer.alloc(24)
    Buffer.from('iVBORw0KGgo=', 'base64').copy(header)
    header.writeUInt32BE(13, 8)
    header.write('IHDR', 12)
    header.writeUInt32BE(this.width, 16)
    header.writeUInt32BE(this.height, 20)
    return 'data:image/png;base64,' + header.toString('base64')
  }
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
          case 'save_export':
            exports.push({ ...args })
            if (typeof exportResponse === 'string') throw exportResponse
            return exportResponse
          case 'list_recovery': return [...recoveries.keys()]
          case 'read_recovery': return recoveries.get(args.id)
          case 'write_recovery':
            recoveryWrites.push(command)
            return void recoveries.set(args.id, args.contents)
          case 'remove_recovery':
            recoveryWrites.push(command)
            return void recoveries.delete(args.id)
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
  async function drag(from, to, options = {}) {
    pointerTarget = from
    mouse(from, 'pointerdown')
    mouse(from, 'mousedown')
    pointerTarget = to
    mouse(to, 'mousemove', options)
    await tick()
    mouse(to, 'mouseup', options)
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
  return {
    query, all, button, node, edge, handle, field, isDirty, click, drag, key, type, edit, save, open, close,
    mouse, exports, recoveryWrites,
    raster: () => lastRaster,
    setExportResponse: (response) => { exportResponse = response },
  }
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
  await app.drag(app.edge('router-agent').querySelector('.vue-flow__edgeupdater-source'), app.handle('router', 'error'))
  assert.match(app.edge('router-agent').getAttribute('aria-label'), /from router to error/)
  await app.drag(app.edge('router-agent').querySelector('.vue-flow__edgeupdater-source'), app.handle('webhook', 'out'))
  assert.match(app.edge('router-agent').getAttribute('aria-label'), /from webhook to error/)
  const { edges } = await app.save()
  assert.equal(edges.length, 4)
  assert.deepEqual(edges.find(({ id }) => id === 'router-agent'), {
    id: 'router-agent', source: 'webhook', sourceHandle: 'out', target: 'error', targetHandle: 'in',
    label: 'Ready', description: 'Successful validation',
  })
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

test('switches the existing canvas to Client View and restores Architect View controls', async (t) => {
  const app = await demo(t)
  await app.click(app.node('http'))
  const node = app.node('http')
  const canvas = app.query('.vue-flow')
  const edge = app.edge('webhook-http')
  await app.click('Client View')
  assert.equal(app.query('.vue-flow'), canvas)
  assert.equal(app.node('http'), node)
  assert.equal(app.edge('webhook-http'), edge)
  assert.ok(app.query('.is-client-view'))
  assert.equal(app.query('.graph-inspector'), null)
  assert.equal(app.query('.project-name'), null)
  assert.equal(app.button('Add Node'), undefined)
  assert.equal(node.querySelector('.node-tile'), null)
  assert.ok(node.querySelector('.client-node-card'))
  await app.click('Back to Architect View')
  assert.equal(app.query('.is-client-view'), null)
  assert.equal(app.node('http'), node)
  assert.ok(node.querySelector('.node-tile'))
  assert.ok(app.button('Add Node'))
  assert.equal(app.button('Architect View').getAttribute('aria-pressed'), 'true')
  await app.click(node)
  assert.ok(app.field('Purpose'))
})

test('shows client text independently of technical labels and documentation, with technical fallback', async (t) => {
  const app = await demo(t)
  await app.click(app.node('http'))
  await app.edit('Client label', '  Retrieve Customer Details  ')
  await app.edit('Business description', 'Checks customer information.\nUpdates the CRM automatically.')
  await app.edit('Purpose', 'Fetch API resource')
  assert.equal(app.field('Name').value, 'HTTP Request')
  assert.doesNotMatch(app.node('http').textContent, /Retrieve Customer Details|Checks customer information/)
  await app.click('Client View')
  const card = app.node('http').querySelector('.client-node-card')
  assert.equal(card.querySelector('.client-node-label').textContent, 'Retrieve Customer Details')
  const description = card.querySelector('.client-node-description')
  assert.equal(description.textContent.trim(), 'Checks customer information.\nUpdates the CRM automatically.')
  assert.equal(description.title, description.textContent.trim())
  assert.doesNotMatch(card.textContent, /Fetch API resource|HTTP Request|Fetch the details/)
  assert.equal(app.node('webhook').querySelector('.client-node-label').textContent, 'Webhook Trigger')
  assert.equal(app.node('webhook').querySelector('.client-node-description'), null)
})

test('locks pointer and keyboard graph edits in Client View and preserves node positions and Bézier connections', async (t) => {
  const app = await demo(t)
  await app.click(app.edge('router-agent'))
  await app.edit('Label', 'Technical route label')
  const before = await app.save()
  const positions = app.all('.vue-flow__node').map((node) => [node.dataset.id, node.style.transform])
  const edge = app.edge('router-agent')
  const getStyle = edge.ownerDocument.defaultView.getComputedStyle
  const architectPath = edge.querySelector('.vue-flow__edge-path').getAttribute('d')
  await app.click('Client View')
  const node = app.node('http')
  assert.equal(node.classList.contains('draggable'), false)
  assert.equal(node.hasAttribute('tabindex'), false)
  assert.equal(edge.hasAttribute('tabindex'), false)
  assert.equal(edge.querySelector('.vue-flow__edgeupdater'), null)
  assert.equal(getStyle(app.handle('http', 'out')).visibility, 'hidden')
  assert.equal(getStyle(edge.querySelector('.vue-flow__edge-textwrapper')).display, 'none')
  const clientPath = edge.querySelector('.vue-flow__edge-path').getAttribute('d')
  assert.notEqual(clientPath, architectPath)
  assert.match(clientPath, /C/)
  await app.click(node)
  await app.click(edge)
  await app.drag(node, app.query('.vue-flow__pane'))
  await app.drag(app.handle('webhook', 'out'), app.handle('agent', 'in'))
  await app.click(app.handle('webhook', 'out'))
  await app.click(app.handle('agent', 'in'))
  for (const key of ['Enter', ' ', 'ArrowRight', 'Delete', 'Backspace']) app.key(key, {}, node)
  assert.equal(app.key('z', { ctrlKey: true }), true)
  assert.equal(app.key('y', { ctrlKey: true }), true)
  assert.equal(app.query('.vue-flow__node.selected, .vue-flow__edge.selected, .graph-inspector'), null)
  assert.equal(app.isDirty(), false)
  assert.deepEqual(app.all('.vue-flow__node').map((item) => [item.dataset.id, item.style.transform]), positions)
  await app.click('Back to Architect View')
  assert.equal(edge.querySelector('.vue-flow__edge-path').getAttribute('d'), architectPath)
  assert.deepEqual(await app.save(), before)
  await app.click(node)
  await app.edit('Name', 'Still editable')
  assert.equal(app.isDirty(), true)
  assert.match(node.textContent, /Still editable/)
})

test('Presentation Mode keeps the canvas and viewport controls and exits by Escape or button', async (t) => {
  const app = await demo(t)
  const canvas = app.query('.vue-flow')
  const viewport = app.query('.vue-flow__transformationpane')
  const before = () => viewport.style.transform
  await app.click('Client View')
  const controls = app.query('.viewport-controls')
  const initialTransform = before()
  await app.click('Present')
  assert.equal(app.query('.vue-flow'), canvas)
  assert.equal(app.query('.viewport-controls'), controls)
  assert.equal(before(), initialTransform)
  assert.equal(app.query('.app-header, .workspace-heading, .workspace-footer, .graph-inspector'), null)
  const exit = app.button('Exit Presentation')
  assert.equal(exit.ownerDocument.activeElement, exit)
  await app.click('Zoom in')
  assert.notEqual(before(), initialTransform)
  const zoomed = before()
  const pane = app.query('.vue-flow__pane')
  await app.drag(pane, pane, { clientX: 650, clientY: 440 })
  assert.notEqual(before(), zoomed)
  const panned = before()
  await app.click('Fit workflow to view')
  assert.notEqual(before(), panned)
  const fitted = before()
  assert.equal(app.key('Escape', { isComposing: true }, exit), true)
  assert.equal(app.key('Escape', {}, exit), false)
  await tick()
  assert.equal(app.query('.is-presenting'), null)
  assert.equal(before(), fitted)
  assert.ok(app.query('.is-client-view .workspace-heading'))
  assert.equal(exit.ownerDocument.activeElement, app.button('Present'))
  await app.click('Present')
  await app.click('Exit Presentation')
  assert.equal(app.query('.is-presenting'), null)
  assert.equal(app.isDirty(), false)
  await app.click('Back to Architect View')
  assert.equal(app.button('Undo').disabled, true)
  assert.equal(app.button('Redo').disabled, true)
})

test('Save, Save As, and Open preserve client and technical metadata together; blank client text is omitted', async (t) => {
  const app = await demo(t)
  await app.click(app.node('http'))
  await app.edit('Purpose', 'HTTP integration')
  await app.edit('Client label', 'Retrieve Customer Details')
  app.type('Business description', 'Checks customer information.')
  const saved = await app.save('/client.json', 'Save', false)
  const node = saved.nodes.find(({ id }) => id === 'http')
  assert.equal(saved.schemaVersion, 1)
  assert.equal(node.label, 'HTTP Request')
  assert.equal(node.clientLabel, 'Retrieve Customer Details')
  assert.equal(node.businessDescription, 'Checks customer information.')
  assert.deepEqual(node.documentation, { purpose: 'HTTP integration' })
  assert.deepEqual(await app.save('/client-copy.json', 'Save As…'), saved)
  await app.click('New Project')
  await app.open('/client-copy.json')
  await app.click(app.node('http'))
  assert.equal(app.field('Client label').value, node.clientLabel)
  assert.equal(app.field('Business description').value, node.businessDescription)
  assert.equal(app.field('Purpose').value, node.documentation.purpose)
  assert.equal(app.isDirty(), false)
  await app.edit('Client label', '  ')
  await app.edit('Business description', '\n\t')
  const cleared = (await app.save('/client-copy.json')).nodes.find(({ id }) => id === 'http')
  assert.equal(Object.hasOwn(cleared, 'clientLabel'), false)
  assert.equal(Object.hasOwn(cleared, 'businessDescription'), false)
  assert.deepEqual(cleared.documentation, node.documentation)
})

test('duplicates client metadata and supports one undo step per committed field across view changes', async (t) => {
  const app = await demo(t)
  await app.click(app.node('http'))
  app.type('Client label', 'Retrieve')
  const label = app.type('Client label', 'Retrieve Customer Details')
  for (const key of ['z', 'y']) assert.equal(app.key(key, { ctrlKey: true }, label), true)
  assert.equal(app.isDirty(), false)
  await app.click('Client View')
  assert.equal(app.isDirty(), true)
  await app.click('Back to Architect View')
  await app.click(app.node('http'))
  const draft = app.type('Client label', 'Discard draft')
  assert.equal(app.key('Escape', {}, draft), false)
  assert.equal(draft.value, 'Retrieve Customer Details')
  await app.edit('Business description', 'Checks information.')
  await app.click('Duplicate')
  assert.equal(app.field('Client label').value, 'Retrieve Customer Details')
  assert.equal(app.field('Business description').value, 'Checks information.')
  await app.edit('Client label', 'Partner details')
  await app.click(app.node('http'))
  assert.equal(app.field('Client label').value, 'Retrieve Customer Details')
  await app.click('Client View')
  await app.click('Back to Architect View')
  for (let step = 0; step < 3; step++) await app.click('Undo')
  assert.equal(app.node('node-1'), null)
  await app.click(app.node('http'))
  assert.equal(app.field('Client label').value, 'Retrieve Customer Details')
  assert.equal(app.field('Business description').value, '')
  await app.click('Undo')
  assert.equal(app.isDirty(), false)
  assert.equal(app.button('Undo').disabled, true)
  await app.click('Client View')
  await app.click('Present')
  await app.click('Exit Presentation')
  await app.click('Back to Architect View')
  await app.click('Redo')
  await app.click('Redo')
  await app.click(app.node('http'))
  assert.equal(app.field('Client label').value, 'Retrieve Customer Details')
  assert.equal(app.field('Business description').value, 'Checks information.')
})

test('recovers unsaved client metadata after the debounce and focused-field close flush', async (t) => {
  const recoveries = new Map()
  const first = await launch(t, recoveries)
  await first.click('Load demo')
  await first.click('Architect View')
  await first.click(first.node('http'))
  await first.edit('Client label', 'Retrieve Customer Details')
  await tick(600)
  const snapshot = JSON.parse([...recoveries.values()][0])
  assert.equal(snapshot.nodes.find(({ id }) => id === 'http').clientLabel, 'Retrieve Customer Details')
  first.type('Business description', 'Unsaved customer details')
  await first.close()
  const second = await launch(t, recoveries)
  await second.click('Restore as unsaved')
  assert.equal(second.isDirty(), true)
  await second.click('Client View')
  assert.equal(second.node('http').querySelector('.client-node-label').textContent, 'Retrieve Customer Details')
  assert.equal(second.node('http').querySelector('.client-node-description').textContent.trim(), 'Unsaved customer details')
})

test('opens Phase 2B and Phase 3A files with client fallbacks and rejects invalid client text', async (t) => {
  const app = await launch(t)
  const phase3a = structuredClone(legacyWorkflow)
  phase3a.nodes[0].documentation = { purpose: 'Documented trigger' }
  for (const [path, file] of [['/phase2b.json', legacyWorkflow], ['/phase3a.json', phase3a]]) {
    await app.open(path, file)
    await app.click('Client View')
    assert.equal(app.node('webhook').querySelector('.client-node-label').textContent, 'Webhook')
    assert.equal(app.node('webhook').querySelector('.client-node-description'), null)
    assert.equal(app.isDirty(), false)
    await app.click('Back to Architect View')
    assert.deepEqual(await app.save(path), file)
  }
  for (const [field, value] of [
    ['clientLabel', null], ['clientLabel', 'A\nB'], ['clientLabel', 'x'.repeat(81)],
    ['businessDescription', []], ['businessDescription', 'x'.repeat(241)],
  ]) {
    const invalid = structuredClone(legacyWorkflow)
    invalid.nodes[0][field] = value
    await app.open('/invalid.json', invalid)
    assert.match(app.query('[role="status"]').textContent, /client label|business description/i)
    assert.match(app.query('.file-status').textContent, /phase3a\.json/)
    assert.equal(app.isDirty(), false)
  }
  phase3a.nodes[0].clientLabel = '   '
  phase3a.nodes[0].businessDescription = ' Read request.\r\nCheck routing. '
  await app.open('/normalized.json', phase3a)
  assert.equal(app.isDirty(), false)
  const node = (await app.save('/normalized.json')).nodes[0]
  assert.equal(Object.hasOwn(node, 'clientLabel'), false)
  assert.equal(node.businessDescription, 'Read request.\nCheck routing.')
})

test('exports the complete client PNG from Architect View with curved edges and no editor UI', async (t) => {
  const app = await launch(t)
  const fixture = structuredClone(legacyWorkflow)
  fixture.metadata.name = 'Order / Review'
  fixture.nodes[0].position = { x: -300, y: -100 }
  fixture.nodes[1].position = { x: 1850, y: 450 }
  fixture.nodes[1].clientLabel = 'Review orders'
  fixture.nodes[1].businessDescription = 'Confirms order details from the request.'
  fixture.nodes[1].documentation = { purpose: 'Private technical purpose' }
  fixture.nodes.push({ id: 'router', kind: 'router', label: 'Route <tag>', position: { x: 275, y: 100 } })
  fixture.edges.push({
    id: 'router-http', source: 'router', target: 'http', sourceHandle: 'error',
    targetHandle: 'in', appearance: 'error', label: 'Private edge label',
  })
  await app.open('/private/project.json', fixture)
  await app.click('Architect View')
  await app.click(app.node('http'))
  await app.click('Zoom in')
  const pane = app.query('.vue-flow__pane')
  await app.drag(pane, pane, { clientX: 1800, clientY: 450 })
  await app.click(app.node('http'))
  const transforms = app.all('.vue-flow__node').map((node) => node.style.transform)
  const viewport = app.query('.vue-flow__transformationpane').style.transform
  const [viewportX, , zoom] = viewport.match(/-?[\d.]+/g).map(Number)
  assert.ok(viewportX + fixture.nodes[1].position.x * zoom > pane.clientWidth, 'HTTP node is off-screen')
  await app.click('Export PNG')

  assert.deepEqual(app.exports.at(-1), {
    format: 'png', suggestedName: 'Order  Review.png', contents: app.exports.at(-1).contents,
  })
  const { scene, width, height } = app.raster()
  assert.equal(scene.localName, 'svg')
  assert.deepEqual(scene.getAttribute('viewBox').split(' ').map(Number), [-340, -140, 2370, 718])
  assert.deepEqual([width, height], [4740, 1436])
  assert.equal(scene.querySelectorAll('g > rect').length, 3)
  assert.equal(scene.querySelectorAll('g > svg').length, 3)
  assert.equal(scene.querySelector('g > svg.lucide-mail-icon').getAttribute('stroke'), '#b4a3cc')
  assert.equal(scene.querySelectorAll('g > rect')[1].getAttribute('stroke'), '#60516f')
  assert.equal(scene.querySelectorAll('svg > path[marker-end]').length, 2)
  assert.equal(scene.querySelector('svg > path').getAttribute('d'), 'M-148,-56 C845,-56 845,494 1838,494')
  const errorPath = scene.querySelector('svg > path[stroke-dasharray]')
  assert.match(errorPath.getAttribute('d'), /^M427,158\.66\d* C.* 1838,494$/)
  assert.equal(errorPath.getAttribute('stroke'), '#ba8277')
  assert.equal(errorPath.getAttribute('marker-end'), 'url(#arrow)')
  const texts = [...scene.querySelectorAll('text')].map((text) => [...text.children].map((line) => line.textContent).join(' '))
  assert.deepEqual(texts.slice(0, 2), ['Webhook', 'Review orders'])
  assert.match(texts[2], /^Confirms order details from the/)
  assert.match(texts[2], /…$/)
  assert.equal(texts[3], 'Route <tag>')
  assert.equal(scene.querySelector('tag'), null)
  assert.ok([...scene.querySelectorAll('text')].every((text) => text.children.length <= 2))
  assert.doesNotMatch(scene.textContent, /HTTP Request|Private technical purpose|Private edge label|Add Node|Undo/)
  assert.equal(scene.querySelector('foreignObject, button, .vue-flow__handle, .is-selected, .graph-inspector'), null)
  assert.equal(app.button('Architect View').getAttribute('aria-pressed'), 'true')
  assert.ok(app.node('http').classList.contains('selected'))
  assert.equal(app.query('.vue-flow__transformationpane').style.transform, viewport)
  assert.deepEqual(app.all('.vue-flow__node').map((node) => node.style.transform), transforms)
  assert.match(app.query('[role="status"]').textContent, /PNG exported/)
  assert.equal(app.isDirty(), false)
  assert.deepEqual(await app.save('/private/project.json'), fixture)

  await app.click('Client View')
  await app.click('Export PNG')
  assert.equal(app.raster().scene.outerHTML, scene.outerHTML)
  assert.ok(app.query('.is-client-view'))
})

test('preserves dirty state, undo and redo, recovery, and a focused draft during exports', async (t) => {
  const app = await demo(t)
  const baseline = await app.save()
  await app.click(app.node('http'))
  await app.edit('Purpose', 'Committed purpose')
  await app.edit('Outputs', 'Second change')
  await app.click('Undo')
  await tick(570)
  assert.equal(app.isDirty(), true)
  assert.equal(app.button('Undo').disabled, false)
  assert.equal(app.button('Redo').disabled, false)
  const recoveryCount = app.recoveryWrites.length
  await app.click(app.node('http'))
  const draft = app.type('Purpose', 'Uncommitted draft')
  assert.equal(app.mouse(app.button('Export Markdown'), 'mousedown'), false)
  await app.click('Export Markdown')
  await app.click('Export PNG')
  assert.equal(draft.ownerDocument.activeElement, draft)
  assert.equal(draft.value, 'Uncommitted draft')
  assert.match(app.exports.find(({ format }) => format === 'md').contents, /Committed purpose/)
  assert.doesNotMatch(app.exports.find(({ format }) => format === 'md').contents, /Uncommitted draft|Second change/)
  app.key('Escape', {}, draft)
  draft.blur()
  await tick(570)
  assert.equal(app.recoveryWrites.length, recoveryCount)
  assert.equal(app.isDirty(), true)
  assert.equal(app.button('Redo').disabled, false)
  await app.click('Redo')
  await app.click(app.node('http'))
  assert.equal(app.field('Outputs').value, 'Second change')
  await app.click('Undo')
  await app.click('Undo')
  assert.equal(app.isDirty(), false)
  assert.deepEqual(await app.save(), baseline)
})

test('exports deterministic Markdown project, node, and connection documentation as plain text', async (t) => {
  const app = await launch(t)
  const fixture = structuredClone(legacyWorkflow)
  fixture.metadata = {
    name: 'Customers & [Orders] *v2*',
    overview: {
      summary: 'Receive & route\r\nSecond line\r\n\r\n<style>body {color:red}</style>',
      goals: '# Prepare orders\n- Collect details', assumptions: 'Consent exists', constraints: 'Local only',
    },
  }
  fixture.nodes[1].clientLabel = 'Order [review]'
  fixture.nodes[1].businessDescription = 'Check details.\n1. Continue'
  fixture.nodes[1].documentation = {
    purpose: 'Check *only* orders', inputs: 'Order _ID_', outputs: 'Order rows',
    configuration: 'Use \\ and \`literal\`', errorHandling: 'Leave retry to the operator',
  }
  fixture.edges[0].label = '[Payload](javascript:run())'
  fixture.edges[0].description = 'Pass order details.\n> Keep this as plain text.'
  await app.open('/private/workflow.json', fixture)
  await app.click('Export Markdown')

  const { contents } = app.exports.at(-1)
  assert.deepEqual(app.exports.at(-1), { format: 'md', suggestedName: 'Customers  Orders v2.md', contents })
  for (const heading of ['Project Overview', 'Workflow Summary', 'Node Documentation', 'Connection Documentation']) {
    assert.ok(contents.includes('## ' + heading + '\n'))
  }
  for (const [title, value] of Object.entries({
    'Project name': 'Customers \\& \\[Orders\\] \\*v2\\*',
    'Project summary': 'Receive \\& route  \nSecond line  \n\n\\<style\\>body \\{color:red\\}\\</style\\>',
    'Architecture goals': '\\# Prepare orders  \n\\- Collect details',
    Assumptions: 'Consent exists', Constraints: 'Local only',
    'Technical label': 'HTTP Request', 'Client-facing label': 'Order \\[review\\]',
    'Business description': 'Check details.  \n1\\. Continue',
    Purpose: 'Check \\*only\\* orders', Inputs: 'Order \\_ID\\_', Outputs: 'Order rows',
    'Configuration notes': 'Use \\\\ and \\\`literal\\\`', 'Error-handling strategy': 'Leave retry to the operator',
    'Source node': 'Node 1 · Webhook', 'Target node': 'Node 2 · HTTP Request',
    'Visible edge label': '\\[Payload\\](javascript:run())',
    'Technical description': 'Pass order details.  \n\\> Keep this as plain text.',
  })) assert.ok(contents.includes('**' + title + '**\n\n' + value + '\n'), title)
  assert.match(contents, /- Nodes: 2\n- Connections: 1/)
  assert.match(contents, /Nodes without incoming connections: 1/)
  assert.match(contents, /Not documented\./)
  assert.doesNotMatch(contents, /\/private\/workflow\.json|schemaVersion|recovery/)
  await app.click('Client View')
  await app.click('Export Markdown')
  assert.equal(app.exports.at(-1).contents, contents)
  assert.match(app.query('[role="status"]').textContent, /Markdown exported/)
})

test('exports empty workflows and handles native cancellation and write errors via mocked IPC', async (t) => {
  const app = await launch(t)
  app.setExportResponse(false)
  for (const action of ['Export PNG', 'Export Markdown']) {
    await app.click(action)
    assert.equal(app.query('[role="status"]'), null)
    assert.equal(app.button(action).disabled, false)
  }
  assert.equal(app.exports.length, 2)
  assert.match(app.raster().scene.textContent, /No nodes in this workflow/)
  assert.deepEqual([app.raster().width, app.raster().height], [640, 320])
  assert.match(app.exports.at(-1).contents, /- Nodes: 0\n- Connections: 0/)
  assert.match(app.exports.at(-1).contents, /No nodes\./)
  assert.match(app.exports.at(-1).contents, /No connections\./)

  for (const [action, extension] of [['Export PNG', 'png'], ['Export Markdown', 'md']]) {
    app.setExportResponse('Could not write the .' + extension + ' export. Permission denied.')
    await app.click(action)
    assert.match(app.query('[role="status"]').textContent, /Could not write.*Permission denied/)
    assert.equal(app.button(action).disabled, false)
  }
  assert.equal(app.isDirty(), false)
  assert.equal(app.button('Undo').disabled, true)
  assert.equal(app.button('Redo').disabled, true)
  assert.deepEqual(app.recoveryWrites, [])
})


test('caps a wide diagram at 8192 pixels while preserving its aspect ratio and full scene', async (t) => {
  const app = await launch(t)
  const fixture = structuredClone(legacyWorkflow)
  fixture.nodes[0].position = { x: -450, y: 0 }
  fixture.nodes[1].position = { x: 5740, y: 810 }
  await app.open('/wide.json', fixture)
  await app.click('Export PNG')
  const { scene, width, height } = app.raster()
  assert.deepEqual([width, height], [8192, 1249])
  assert.equal(scene.getAttribute('viewBox'), '-490 -40 6410 978')
  assert.equal(scene.querySelectorAll('g > rect').length, 2)
  assert.equal(scene.querySelectorAll('path[marker-end]').length, 1)
  const header = Buffer.from(app.exports.at(-1).contents, 'base64')
  assert.deepEqual([header.readUInt32BE(16), header.readUInt32BE(20)], [8192, 1249])
})

test('rejects an encoder that silently returns a smaller PNG', async (t) => {
  const app = await launch(t)
  const { HTMLCanvasElement } = app.query('.workspace').ownerDocument.defaultView
  const encode = HTMLCanvasElement.prototype.toDataURL
  HTMLCanvasElement.prototype.toDataURL = function () {
    return encode.call({ width: this.width / 2, height: this.height / 2 })
  }
  await app.click('Export PNG')
  assert.match(app.query('[role="status"]').textContent, /requested 640 × 320 image/)
  assert.equal(app.exports.length, 0)
})
