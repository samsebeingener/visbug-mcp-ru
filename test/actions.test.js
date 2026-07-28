import assert from 'node:assert/strict'
import test from 'node:test'
import { legacyChangesToActions } from '../src/actions/compile.js'
import { actionsToLegacyChanges } from '../src/actions/flatten.js'
import { ACTION_TYPES, validateAction } from '../src/actions/schema.js'
import {
  STORE_FORMAT,
  normalizeStore,
  getPendingChanges,
  setChangesFromRecording,
} from '../src/actions/store.js'

const selector = '.hero-section h1'

test('compile merges left+top into one MOVE action', () => {
  const changes = [
    { type: 'style', selector, property: 'left', newValue: '240px', tag: 'h1', applied: false },
    { type: 'style', selector, property: 'top', newValue: '-7px', tag: 'h1', applied: false },
  ]

  const { actions, artifacts } = legacyChangesToActions(changes)

  assert.equal(actions.length, 1)
  assert.equal(actions[0].type, ACTION_TYPES.MOVE)
  assert.equal(actions[0].delta.x, 240)
  assert.equal(actions[0].delta.y, -7)
  assert.equal(actions[0].target.selector, selector)
  assert.equal(actions[0].applied, false)
  assert.equal(artifacts.length, 0)
  assert.equal(validateAction(actions[0]).ok, true)
})

test('compile collects decorative styles into artifacts', () => {
  const changes = [
    { type: 'style', selector, property: 'position', newValue: 'relative', applied: false },
    { type: 'style', selector, property: 'cursor', newValue: 'move', applied: false },
    { type: 'style', selector, property: '--start', newValue: '0.4', applied: false },
    { type: 'style', selector, property: '--glow-mask', newValue: 'radial-gradient(...)', applied: false },
    { type: 'style', selector, property: 'transition', newValue: 'all 0.2s', applied: false },
    { type: 'style', selector, property: 'width', newValue: '552px', applied: false },
  ]

  const { actions, artifacts } = legacyChangesToActions(changes)

  assert.equal(actions.length, 1)
  assert.equal(actions[0].type, ACTION_TYPES.STYLE)
  assert.equal(actions[0].changes.length, 1)
  assert.equal(actions[0].changes[0].prop, 'width')
  assert.equal(artifacts.length, 5)
  assert.ok(artifacts.every((item) => item.type === 'VISBUG_NOISE'))
})

test('normalizeStore migrates v1 changes buffer to v2 actions', () => {
  const raw = {
    changes: [
      { type: 'text', selector, oldValue: 'Old', newValue: 'New', applied: false },
      { type: 'style', selector, property: 'left', newValue: '32px', applied: false },
      { type: 'style', selector, property: 'top', newValue: '0px', applied: false },
      { type: 'style', selector, property: 'cursor', newValue: 'move', applied: false },
    ],
    workspace: '/tmp/project',
  }

  const store = normalizeStore(raw)

  assert.equal(store.version, STORE_FORMAT)
  assert.equal(store.workspace, '/tmp/project')
  assert.equal(store.actions.length, 2)
  assert.equal(store.actions[0].type, ACTION_TYPES.TEXT)
  assert.equal(store.actions[1].type, ACTION_TYPES.MOVE)
  assert.equal(store.artifacts.length, 1)
})

test('flatten roundtrip preserves move and style changes', () => {
  const original = [
    { type: 'style', selector, property: 'left', newValue: '240px', tag: 'h1', applied: false },
    { type: 'style', selector, property: 'top', newValue: '-7px', tag: 'h1', applied: false },
    { type: 'style', selector, property: 'width', newValue: '552px', tag: 'h1', applied: false },
    { type: 'text', selector, oldValue: 'Title', newValue: 'New title', applied: false },
    { type: 'attribute', selector, attribute: 'class', oldValue: 'a', newValue: 'a b', applied: false },
    { type: 'style', selector, property: 'cursor', newValue: 'move', applied: false },
  ]

  const { actions } = legacyChangesToActions(original)
  const flattened = actionsToLegacyChanges(actions)

  assert.equal(flattened.length, 5)
  assert.deepEqual(
    flattened.map((change) => [change.type, change.property ?? change.attribute, change.newValue]),
    [
      ['style', 'left', '240px'],
      ['style', 'top', '-7px'],
      ['style', 'width', '552px'],
      ['text', undefined, 'New title'],
      ['attribute', 'class', 'a b'],
    ],
  )
})

test('setChangesFromRecording and getPendingChanges stay compatible with auto-apply', () => {
  const legacyChanges = [
    { type: 'style', selector, property: 'width', newValue: '400px', applied: false },
    { type: 'style', selector, property: 'position', newValue: 'relative', applied: false },
  ]

  const store = setChangesFromRecording({}, legacyChanges, { workspace: '/tmp/project' })
  const pending = getPendingChanges(store)

  assert.equal(store.actions.length, 1)
  assert.equal(store.artifacts.length, 1)
  assert.equal(pending.length, 1)
  assert.equal(pending[0].property, 'width')
  assert.equal(pending[0].newValue, '400px')
})

test('compile preserves align.reference on MOVE from legacy changes', () => {
  const refSelector = '#services > article:nth-of-type(2) > ul'
  const align = {
    mode: 'edge',
    edge: 'left',
    axis: 'x',
    distance: 0,
    reference: {
      selector: refSelector,
      edge: 'left',
      rect: { left: 120, top: 400, width: 280, height: 96 },
    },
  }

  const changes = [
    {
      type: 'style',
      selector,
      property: 'left',
      newValue: '32px',
      tag: 'p',
      align,
      applied: false,
    },
    { type: 'style', selector, property: 'top', newValue: '0px', tag: 'p', applied: false },
  ]

  const { actions } = legacyChangesToActions(changes)

  assert.equal(actions.length, 1)
  assert.equal(actions[0].type, ACTION_TYPES.MOVE)
  assert.equal(actions[0].align.reference.selector, refSelector)
  assert.equal(actions[0].align.reference.edge, 'left')
  assert.equal(validateAction(actions[0]).ok, true)
})

test('flatten roundtrip preserves align.reference on MOVE', () => {
  const align = {
    mode: 'edge',
    edge: 'left',
    axis: 'x',
    distance: 2,
    reference: {
      selector: '#services ul',
      edge: 'left',
      rect: { left: 80, top: 200, width: 300, height: 120 },
    },
  }

  const original = [
    { type: 'style', selector, property: 'left', newValue: '32px', align, applied: false },
    { type: 'style', selector, property: 'top', newValue: '0px', applied: false },
  ]

  const { actions } = legacyChangesToActions(original)
  const flattened = actionsToLegacyChanges(actions)
  const left = flattened.find((c) => c.property === 'left')

  assert.ok(left?.align)
  assert.equal(left.align.reference.selector, '#services ul')
})
