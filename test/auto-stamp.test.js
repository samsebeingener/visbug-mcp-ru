import test from 'node:test'
import assert from 'node:assert/strict'
import { compileWriteRecipes, formatWriteRecipesBuffer } from '../src/actions/write-recipe.js'
import { parseMutationsToChanges, clearSeen, formatChangesFromStore } from '../src/parser.js'

// --- extension/auto-stamp.js: штамп элементов без стабильного id ---

globalThis.HTMLElement = class HTMLElement {}
globalThis.Node = { ELEMENT_NODE: 1 }

await import('../extension/auto-stamp.js')
const { VisbugMcpAutoStamp } = globalThis

function makeEl(tag = 'div', attrs = {}) {
  const el = new globalThis.HTMLElement()
  el.nodeType = 1
  el.tagName = tag.toUpperCase()
  el._attrs = { ...attrs }
  el.getAttribute = (n) => (n in el._attrs ? el._attrs[n] : null)
  el.setAttribute = (n, v) => { el._attrs[n] = String(v) }
  el.hasAttribute = (n) => n in el._attrs
  Object.defineProperty(el, 'attributes', {
    get: () => Object.keys(el._attrs).map((name) => ({ name, value: el._attrs[name] })),
  })
  Object.defineProperty(el, 'id', {
    get: () => el._attrs.id ?? '',
  })
  return el
}

const selectorOf = () => '#hero-text-col > .hero-text-inner > div:nth-of-type(2)'

test('auto-stamp: элемент без id получает vb-<tag>-<NN>, атрибут ставится в DOM', () => {
  VisbugMcpAutoStamp.reset()
  const el = makeEl('div')
  const id = VisbugMcpAutoStamp.ensureStamped(el, selectorOf)
  assert.equal(id, 'vb-div-01')
  assert.equal(el.getAttribute('data-visbug-id'), 'vb-div-01')

  const stamps = VisbugMcpAutoStamp.consumeStamps()
  assert.equal(stamps.length, 1)
  assert.equal(stamps[0].id, 'vb-div-01')
  assert.equal(stamps[0].tag, 'div')
  assert.equal(stamps[0].originalSelector, selectorOf())
  assert.equal(VisbugMcpAutoStamp.consumeStamps().length, 0)
})

test('auto-stamp: счётчик per-tag, повторный вызов на том же элементе — тот же id', () => {
  VisbugMcpAutoStamp.reset()
  const div = makeEl('div')
  const p = makeEl('p')
  assert.equal(VisbugMcpAutoStamp.ensureStamped(div, selectorOf), 'vb-div-01')
  assert.equal(VisbugMcpAutoStamp.ensureStamped(p, selectorOf), 'vb-p-01')
  assert.equal(VisbugMcpAutoStamp.ensureStamped(div, selectorOf), 'vb-div-01')
  assert.equal(VisbugMcpAutoStamp.stampIdOf(div), 'vb-div-01')
})

test('auto-stamp: элемент с существующим id / data-vb* НЕ штампуется', () => {
  VisbugMcpAutoStamp.reset()
  assert.equal(VisbugMcpAutoStamp.ensureStamped(makeEl('div', { id: 'hero' }), selectorOf), null)
  assert.equal(VisbugMcpAutoStamp.ensureStamped(makeEl('div', { 'data-vb-source': 'a.tsx:1:0' }), selectorOf), null)
  assert.equal(VisbugMcpAutoStamp.ensureStamped(makeEl('div', { 'data-visbug-src': 'a.tsx:1:0' }), selectorOf), null)
  assert.equal(VisbugMcpAutoStamp.ensureStamped(makeEl('div', { 'data-visbug-id': 'vb-x-99' }), selectorOf), null)
  assert.equal(VisbugMcpAutoStamp.consumeStamps().length, 0)
})

// --- parser: stampId проходит в change ---

test('parser: stampId сохраняется в change из мутации', () => {
  clearSeen()
  const changes = parseMutationsToChanges([{
    type: 'style',
    selector: 'body > main > div:nth-of-type(2)',
    property: 'color',
    oldValue: 'rgb(0, 0, 0)',
    newValue: 'rgb(255, 0, 0)',
    tag: 'div',
    stampId: 'vb-div-01',
    timestamp: 1,
  }])
  assert.equal(changes[0].stampId, 'vb-div-01')
})

// --- write-recipe: #vb-* stableSelector, confidence high, stamp-pending ---

const stampedStyle = (extra = {}) => ({
  type: 'style',
  property: 'color',
  oldValue: 'rgb(0, 0, 0)',
  newValue: 'rgb(255, 0, 0)',
  applied: false,
  ...extra,
})

test('recipe: stamped узел → #vb-*, confidence high, stamp-pending вместо no-visbug-src/manual_review', () => {
  const recipes = compileWriteRecipes([
    stampedStyle({
      selector: 'body > main > section > div:nth-of-type(2)',
      stampId: 'vb-div-01',
    }),
  ])
  assert.equal(recipes.length, 1)
  const r = recipes[0]
  assert.equal(r.write.selector, '#vb-div-01')
  assert.equal(r.target.stableSelector, '#vb-div-01')
  assert.equal(r.write.confidence, 'high')
  assert.deepEqual(r.stamp, { id: 'vb-div-01', pending: true })
  assert.ok(r.write.warnings.some((w) => w.startsWith('stamp-pending:')))
  assert.ok(!r.write.warnings.some((w) => w.startsWith('no-visbug-src')))
  assert.ok(!r.write.warnings.includes('manual_review'))
})

test('recipe: узел с обычным id НЕ получает stamp и ведёт себя как раньше', () => {
  const recipes = compileWriteRecipes([stampedStyle({ selector: '#btn', shortSelector: '#btn' })])
  assert.equal(recipes[0].write.selector, '#btn')
  assert.equal(recipes[0].stamp, undefined)
  assert.ok(recipes[0].write.warnings.some((w) => w.startsWith('no-visbug-src')))
})

test('buffer: секция stamps (из daemon) + контракт v0.26', () => {
  clearSeen()
  const changes = parseMutationsToChanges([{
    type: 'style',
    selector: 'body > main > div:nth-of-type(2)',
    property: 'color',
    oldValue: 'rgb(0, 0, 0)',
    newValue: 'rgb(255, 0, 0)',
    tag: 'div',
    stampId: 'vb-div-01',
    timestamp: 1,
  }])
  const text = formatChangesFromStore(changes, {
    stamps: [{ id: 'vb-div-01', tag: 'div', originalSelector: '#hero-text-col > .hero-text-inner > div:nth-of-type(2)' }],
  })
  assert.match(text, /contract: v0\.26/)
  assert.match(text, /stamps:\n {2}vb-div-01 → #hero-text-col > \.hero-text-inner > div:nth-of-type\(2\)/)
  // секция stamps идёт после files, до блока рецептов
  assert.ok(text.indexOf('stamps:') < text.indexOf('--- index.html ---') || text.indexOf('stamps:') < text.indexOf('--- '))
})

test('buffer: stamps derive из рецептов, если карта из daemon не передана', () => {
  const recipes = compileWriteRecipes([
    stampedStyle({
      selector: 'body > main > div:nth-of-type(2)',
      stampId: 'vb-div-01',
    }),
  ])
  const text = formatWriteRecipesBuffer(recipes)
  assert.match(text, /stamps:\n {2}vb-div-01 → body > main > div:nth-of-type\(2\)/)
})
