import test from 'node:test'
import assert from 'node:assert/strict'
import {
  clearSeen,
  formatChangesFromStore,
  isMutationNoise,
  parseMutationsToChanges,
} from '../src/parser.js'

test('isMutationNoise drops guide overlay and drag artifacts', () => {
  assert.equal(
    isMutationNoise({ selector: '#visbug-mcp-guides-root > svg > text:nth-of-type(1)', type: 'text' }),
    true,
  )
  assert.equal(isMutationNoise({ selector: '#scroll-progress', type: 'style', property: 'width' }), true)
  assert.equal(isMutationNoise({ type: 'node-added', selector: 'body', tag: 'visbug-hover' }), true)
  assert.equal(isMutationNoise({ type: 'style', selector: '#hero h1', property: 'left' }), true)
  assert.equal(isMutationNoise({ type: 'style', selector: '#hero h1', property: 'cursor' }), true)
  assert.equal(isMutationNoise({ type: 'style', selector: '#hero h1', property: 'color' }), false)
})

test('parseMutationsToChanges drops drag artifacts keeps real styles', () => {
  clearSeen()
  const ts = Date.now()
  const selector = '#hero h1'
  const result = parseMutationsToChanges([
    { type: 'style', selector, property: 'cursor', oldValue: null, newValue: 'move', tag: 'h1', timestamp: ts },
    { type: 'style', selector, property: 'left', oldValue: null, newValue: '163px', tag: 'h1', timestamp: ts },
    { type: 'style', selector, property: 'color', oldValue: null, newValue: '#111', tag: 'h1', timestamp: ts },
    { type: 'node-added', selector: 'body', parentSelector: 'body', tag: 'visbug-hover', html: '<visbug-hover>', timestamp: ts },
  ])

  assert.equal(result.length, 1)
  assert.equal(result[0].property, 'color')
})

test('formatChangesFromStore emits write recipe for color', () => {
  const text = formatChangesFromStore([
    {
      type: 'style',
      selector: '#hero h1',
      shortSelector: '#hero h1',
      diagnosticSelector: '#hero h1',
      property: 'color',
      oldValue: null,
      newValue: '#111',
      applied: false,
    },
  ], {})

  assert.match(text, /write:/)
  assert.match(text, /color: #111;/)
  assert.doesNotMatch(text, /left =/)
})
