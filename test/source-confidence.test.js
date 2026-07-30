import test from 'node:test'
import assert from 'node:assert/strict'
import { compileWriteRecipes, formatWriteRecipesBuffer } from '../src/actions/write-recipe.js'

// --- react-source-bridge: data-vb-source > fiber, ambiguity при расхождении ---

globalThis.HTMLElement = class HTMLElement {}
globalThis.Node = { ELEMENT_NODE: 1 }
globalThis.document = { readyState: 'complete', documentElement: {}, body: null }
globalThis.requestAnimationFrame = () => {}

await import('../extension/react-source-bridge.js')
const { VisbugMcpReactBridge } = globalThis

function makeEl(attrs = {}, { parent = null, fiber = null } = {}) {
  const el = new globalThis.HTMLElement()
  el.tagName = 'div'
  el.parentElement = parent
  el._attrs = { ...attrs }
  el.getAttribute = (n) => (n in el._attrs ? el._attrs[n] : null)
  el.setAttribute = (n, v) => { el._attrs[n] = String(v) }
  el.hasAttribute = (n) => n in el._attrs
  el.removeAttribute = (n) => { delete el._attrs[n] }
  el.closest = (sel) => {
    const attr = sel.replace(/^\[|\]$/g, '')
    let node = el.parentElement
    while (node) {
      if (node._attrs && attr in node._attrs) return node
      node = node.parentElement
    }
    return null
  }
  if (fiber) el.__reactFiber$test = fiber
  return el
}

const fiberOf = (file, line) => ({ _debugSource: { fileName: file, lineNumber: line, columnNumber: 0 } })

test('bridge: data-vb-source бьет fiber; расхождение помечается ambiguous', () => {
  const el = makeEl(
    { 'data-vb-source': 'src/pages/Hero.tsx:12:4' },
    { fiber: fiberOf('/repo/app/components/Other.tsx', 99) },
  )
  const resolved = VisbugMcpReactBridge.resolveSource(el)
  assert.equal(resolved.value, 'src/pages/Hero.tsx:12:4')
  assert.equal(resolved.origin, 'data-vb-source')
  assert.equal(resolved.ambiguous, true)
  assert.equal(resolved.confidence, 'ambiguous')
})

test('bridge: совпадающие fiber и атрибут → exact, без ambiguity', () => {
  const el = makeEl(
    { 'data-vb-source': 'src/pages/Hero.tsx:12:4' },
    { fiber: fiberOf('/repo/src/pages/Hero.tsx', 12) },
  )
  const resolved = VisbugMcpReactBridge.resolveSource(el)
  assert.equal(resolved.value, 'src/pages/Hero.tsx:12:4')
  assert.equal(resolved.ambiguous, false)
  assert.equal(resolved.confidence, 'exact')
})

test('bridge: walk up DOM — атрибут на предке; алиасы data-visbug-src/data-vb; fiber fallback', () => {
  const parent = makeEl({ 'data-visbug-src': 'src/components/Card.tsx:7:0' })
  const el = makeEl({}, { parent })
  const resolved = VisbugMcpReactBridge.resolveSource(el)
  assert.equal(resolved.value, 'src/components/Card.tsx:7:0')
  assert.equal(resolved.origin, 'data-visbug-src')

  const elVb = makeEl({ 'data-vb': 'src/components/Btn.tsx:3:1' })
  assert.equal(VisbugMcpReactBridge.resolveSource(elVb).value, 'src/components/Btn.tsx:3:1')

  const elFiber = makeEl({}, { fiber: fiberOf('/repo/src/components/Only.tsx', 42) })
  const fiberResolved = VisbugMcpReactBridge.resolveSource(elFiber)
  assert.equal(fiberResolved.value, 'src/components/Only.tsx:42:0')
  assert.equal(fiberResolved.origin, 'fiber')
})

// --- write-recipe: confidence + manual_review ---

const styleChange = (extra) => ({
  type: 'style',
  property: 'color',
  oldValue: 'rgb(0, 0, 0)',
  newValue: 'rgb(255, 0, 0)',
  applied: false,
  ...extra,
})

test('recipe: visbugSrc → confidence high, без manual_review', () => {
  const recipes = compileWriteRecipes([
    styleChange({ selector: '#btn', shortSelector: '#btn', visbugSrc: 'src/pages/Hero.tsx:12:4' }),
  ])
  assert.equal(recipes[0].write.confidence, 'high')
  assert.ok(!recipes[0].write.warnings.includes('manual_review'))
  assert.doesNotMatch(formatWriteRecipesBuffer(recipes), /confidence:/)
})

test('recipe: только короткий селектор → confidence medium', () => {
  const recipes = compileWriteRecipes([
    styleChange({ selector: '#btn', shortSelector: '#btn' }),
  ])
  assert.equal(recipes[0].write.confidence, 'medium')
  assert.ok(!recipes[0].write.warnings.includes('manual_review'))
  assert.match(formatWriteRecipesBuffer(recipes), /confidence: medium/)
})

test('recipe: длинный DOM path → confidence low + manual_review в JSON и буфере', () => {
  const recipes = compileWriteRecipes([
    styleChange({ selector: 'body > main > section > div:nth-child(3) > p' }),
  ])
  assert.equal(recipes[0].write.confidence, 'low')
  assert.ok(recipes[0].write.warnings.includes('manual_review'))
  assert.match(formatWriteRecipesBuffer(recipes), /confidence: low \(manual_review\)/)
})

test('recipe: ambiguity источника → manual_review даже при high confidence', () => {
  const recipes = compileWriteRecipes([
    styleChange({
      selector: '#btn',
      shortSelector: '#btn',
      visbugSrc: 'src/pages/Hero.tsx:12:4',
      sourceConfidence: 'ambiguous',
    }),
  ])
  assert.equal(recipes[0].write.confidence, 'high')
  assert.ok(recipes[0].write.warnings.includes('manual_review'))
})
