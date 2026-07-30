import test from 'node:test'
import assert from 'node:assert/strict'
import {
  clearSeen,
  formatChangesFromStore,
  isMutationNoise,
  isSuspiciousLayoutDelta,
  parseMutationsToChanges,
} from '../src/parser.js'

test('parseMutationsToChanges stores layout-delta and replaces per selector', () => {
  clearSeen()
  const ts = Date.now()
  const selector = '#method-quote'
  const base = {
    type: 'layout-delta',
    selector,
    tag: 'div',
    timestamp: ts,
    viewport: { width: 1440, height: 900 },
  }

  parseMutationsToChanges([
    { ...base, deltaX: 0, deltaY: -40, rectBefore: { left: 100, top: 200, width: 480, height: 522 }, rectAfter: { left: 100, top: 160, width: 480, height: 522 } },
    { ...base, deltaX: 0, deltaY: -65, rectBefore: { left: 100, top: 200, width: 480, height: 522 }, rectAfter: { left: 100, top: 135, width: 480, height: 522 } },
  ])

  // top — drag artifact, не попадает в store
  const second = parseMutationsToChanges([
    { type: 'style', selector, property: 'top', oldValue: null, newValue: '-65px', tag: 'div', timestamp: ts + 1 },
  ])
  assert.equal(second.length, 0)

  const all = formatChangesFromStore([{
    type: 'layout-delta',
    selector: '#method-quote',
    diagnosticSelector: '#method-quote',
    shortSelector: '#method-quote',
    deltaX: 0,
    deltaY: -65,
    offsetBefore: {
      transform: { tx: 24, ty: -65 },
      margin: { x: 0, y: 0 },
      relative: { x: 0, y: 0 },
    },
    lever: 'transform',
    viewport: { width: 1440, height: 900 },
    applied: false,
  }], { includeActions: false })

  assert.match(all, /write:/)
  assert.match(all, /transform: translate\(24px, -130px\);/)
  assert.match(all, /from:.*Δ\(0px, -65px\)/)
})

test('formatChangesFromStore renders write recipe with file hint', () => {
  const text = formatChangesFromStore([{
    type: 'layout-delta',
    selector: '#method-quote',
    diagnosticSelector: 'body > main > #method-quote',
    shortSelector: '#method-quote',
    deltaX: 12,
    deltaY: -65,
    visbugSrc: 'src/styles/sections.css:120:1',
    offsetBefore: {
      transform: { tx: 24, ty: 0 },
      margin: { x: 0, y: 0 },
      relative: { x: 0, y: 0 },
    },
    lever: 'transform',
    parentLayout: { display: 'grid', alignItems: 'end' },
    rectBefore: { left: 100, top: 200, width: 480, height: 522 },
    rectAfter: { left: 112, top: 135, width: 480, height: 522 },
    viewport: { width: 1440, height: 900 },
    applied: false,
  }], { workspace: '/workspace', includeActions: false })

  assert.match(text, /mode: write-recipes/)
  assert.match(text, /file: src\/styles\/sections\.css/)
  assert.match(text, /transform: translate\(36px, -65px\);/)
  assert.match(text, /lever: transform/)
})

test('isSuspiciousLayoutDelta filters scroll artifacts', () => {
  const mutation = {
    type: 'layout-delta',
    deltaX: 0,
    deltaY: -3465,
    viewport: { width: 1920, height: 945 },
  }
  assert.equal(isSuspiciousLayoutDelta(mutation), true)
  assert.equal(isMutationNoise(mutation), true)
})

test('reasonable layout-delta is not noise', () => {
  const mutation = {
    type: 'layout-delta',
    deltaX: -49,
    deltaY: 0,
    viewport: { width: 1920, height: 945 },
  }
  assert.equal(isSuspiciousLayoutDelta(mutation), false)
  assert.equal(isMutationNoise(mutation), false)
})
