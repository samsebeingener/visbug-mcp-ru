import test from 'node:test'
import assert from 'node:assert/strict'
import { compileWriteRecipes } from '../src/actions/write-recipe.js'
import { compileChangesToActions } from '../src/actions/compile.js'
import { STORE_VERSION } from '../src/actions/schema.js'
import { formatChangesFromStore, clearSeen, parseMutationsToChanges } from '../src/parser.js'

test('compileWriteRecipes merges MOVE + size into one write block', () => {
  const recipes = compileWriteRecipes([
    {
      type: 'layout-delta',
      selector: '#hero-photo-wrap',
      diagnosticSelector: '#hero-photo-wrap',
      shortSelector: '#hero-photo-wrap',
      deltaX: 0,
      deltaY: 15,
      lever: 'transform',
      offsetBefore: {
        transform: { tx: 17, ty: 0 },
        margin: { x: 0, y: 0 },
        relative: { x: 0, y: 0 },
      },
      applied: false,
    },
    {
      type: 'style',
      selector: '#hero-photo-wrap',
      diagnosticSelector: '#hero-photo-wrap',
      property: 'left',
      newValue: '115px',
      applied: false,
    },
    {
      type: 'style',
      selector: '#hero-photo-wrap',
      diagnosticSelector: '#hero-photo-wrap',
      property: 'cursor',
      newValue: 'move',
      applied: false,
    },
    {
      type: 'style',
      selector: '#hero-photo-wrap',
      diagnosticSelector: '#hero-photo-wrap',
      property: 'width',
      newValue: '538.672px',
      applied: false,
    },
    {
      type: 'style',
      selector: '#hero-photo-wrap',
      diagnosticSelector: '#hero-photo-wrap',
      property: 'transform',
      newValue: 'translate(17px, 9px)',
      applied: false,
    },
  ])

  assert.equal(recipes.length, 1)
  assert.equal(recipes[0].type, 'MOVE')
  assert.deepEqual(
    recipes[0].write.declarations.map((d) => `${d.prop}:${d.value}`),
    ['transform:translate(17px, 15px)', 'width:539px'],
  )
  assert.match(recipes[0].write.from, /Δ\(0px, 15px\)/)
})

test('compileChangesToActions equals write recipes', () => {
  const changes = [{
    type: 'layout-delta',
    selector: 'li',
    diagnosticSelector: 'body > ul > li',
    shortSelector: 'li',
    deltaX: 10,
    deltaY: 0,
    lever: 'transform',
    visbugSrc: 'src/app/page.tsx:18:4',
    align: { reference: { selector: 'ul.services', edge: 'left' }, edge: 'left' },
    applied: false,
  }]
  const actions = compileChangesToActions(changes)
  assert.equal(actions.length, 1)
  assert.equal(actions[0].write.declarations[0].value, 'translate(10px, 0px)')
  assert.equal(actions[0].target.visbugSrc, 'src/app/page.tsx:18:4')
})

test('formatChangesFromStore shows write block not noise', () => {
  const text = formatChangesFromStore([
    {
      type: 'layout-delta',
      selector: '#hero-photo-wrap',
      diagnosticSelector: '#hero-photo-wrap',
      shortSelector: '#hero-photo-wrap',
      deltaX: 0,
      deltaY: 15,
      lever: 'transform',
      offsetBefore: {
        transform: { tx: 17, ty: 0 },
        margin: { x: 0, y: 0 },
        relative: { x: 0, y: 0 },
      },
      applied: false,
    },
    {
      type: 'style',
      selector: '#hero-photo-wrap',
      property: 'cursor',
      newValue: 'move',
      applied: false,
    },
  ], { workspace: '/tmp/site' })

  assert.match(text, /mode: write-recipes/)
  assert.match(text, /write:/)
  assert.match(text, /transform: translate\(17px, 15px\);/)
  assert.doesNotMatch(text, /cursor/)
  assert.match(text, /--- write-recipes\.json ---/)
})

test('parse drops drag artifact props', () => {
  clearSeen()
  const result = parseMutationsToChanges([
    { type: 'style', selector: '#a', property: 'left', newValue: '10px', timestamp: 1 },
    { type: 'style', selector: '#a', property: 'cursor', newValue: 'move', timestamp: 1 },
    { type: 'style', selector: '#a', property: 'color', newValue: 'red', timestamp: 1 },
  ])
  assert.equal(result.length, 1)
  assert.equal(result[0].property, 'color')
})

test('STORE_VERSION is 5', () => {
  assert.equal(STORE_VERSION, 5)
})
