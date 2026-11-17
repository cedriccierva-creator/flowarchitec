const assert = require('node:assert/strict')
const { test } = require('node:test')
const { readFileSync } = require('node:fs')
const ts = require('typescript')
// Load the actual TypeScript data modules without adding a test dependency.
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename)
const { validateArchitecture } = require('../src/data/architectureValidation.ts')
const { nodeDocumentationFields, overviewFields } = require('../src/data/workflowDocument.ts')
const node = (id, kind = 'http') => ({ id, kind, label: id, position: { x: 0, y: 0 } })
const edge = (id, source, target, sourceHandle = 'out') => ({ id, source, target, sourceHandle, targetHandle: 'in' })
const workflow = (nodes = [], edges = []) => ({ schemaVersion: 1, metadata: { name: 'Validation' }, nodes, edges })

test('validation is deterministic, immutable, ordered and gives stable unique IDs', () => {
  const doc = workflow([node('a'), node('router', 'router')], [])
  const before = JSON.stringify(doc)
  const first = validateArchitecture(doc)
  assert.deepEqual(validateArchitecture(doc), first)
  assert.equal(JSON.stringify(doc), before)
  assert.equal(new Set(first.map(({ id }) => id)).size, first.length)
  assert.deepEqual(first.map(({ rule }) => rule), ['project-documentation', 'disconnected-node', 'node-documentation', 'disconnected-node', 'node-documentation', 'unconnected-error-output'])
  doc.nodes[0].label = 'Renamed'
  assert.deepEqual(validateArchitecture(doc).map(({ id }) => id), first.map(({ id }) => id))
})

test('connection checks use incidence and port evidence, permit terminal nodes and triggers', () => {
  const doc = workflow([node('start', 'webhook'), node('branch', 'router'), node('sink'), node('orphan')], [edge('a', 'start', 'branch'), edge('b', 'branch', 'sink', 'success'), edge('c', 'orphan', 'sink')])
  const findings = validateArchitecture(doc)
  assert.deepEqual(findings.filter(({ severity }) => severity === 'warning').map(({ rule, target }) => [rule, target.id]), [['unconnected-error-output', 'branch'], ['missing-incoming', 'orphan']])
  doc.edges.push(edge('failure', 'branch', 'sink', 'error'))
  assert.equal(validateArchitecture(doc).some(({ rule }) => rule === 'unconnected-error-output'), false)
  // A red-looking edge or words in notes cannot substitute for an actual Error port.
  doc.edges.pop()
  doc.edges[1].appearance = 'error'
  doc.nodes[1].documentation = { errorHandling: 'Everything is handled' }
  assert.equal(validateArchitecture(doc).some(({ rule }) => rule === 'unconnected-error-output'), true)
})

test('blank documentation is grouped by target; complete documentation has no findings', () => {
  const doc = workflow([node('trigger', 'webhook'), node('sink')], [edge('handoff', 'trigger', 'sink')])
  doc.metadata.overview = Object.fromEntries(overviewFields.map((field) => [field, 'Documented']))
  for (const item of doc.nodes) item.documentation = Object.fromEntries(nodeDocumentationFields.map((field) => [field, 'Documented']))
  doc.edges[0].description = 'Data contract'
  assert.deepEqual(validateArchitecture(doc), [])
  doc.nodes[0].documentation.purpose = ' \n '
  doc.edges[0].description = ' '
  const findings = validateArchitecture(doc)
  assert.deepEqual(findings.map(({ rule }) => rule), ['node-documentation', 'connection-documentation'])
  assert.match(findings[0].evidence, /purpose/)
  assert.match(findings[1].evidence, /trigger.out → sink.in/)
  assert.deepEqual(findings[1].target, { type: 'edge', id: 'handoff' })
})

test('empty and sections-only workflows do not invent graph failures', () => {
  const doc = workflow()
  assert.deepEqual(validateArchitecture(doc).map(({ rule }) => rule), ['project-documentation'])
  doc.sections = [{ id: 'section', title: 'Visual only' }]
  assert.deepEqual(validateArchitecture(doc), validateArchitecture(workflow()))
})
