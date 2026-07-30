import test from 'node:test'
import assert from 'node:assert/strict'
import {
  addVisualDelta,
  formatApplyRecipe,
  formatLayoutDeltaBufferLine,
  parseTransformTranslate,
  suggestLever,
  visualOffsetFromParts,
} from '../shared/layout-lever.js'

test('parseTransformTranslate reads matrix translate', () => {
  assert.deepEqual(parseTransformTranslate('matrix(1, 0, 0, 1, 24, -65)'), { tx: 24, ty: -65 })
  assert.deepEqual(parseTransformTranslate('none'), { tx: 0, ty: 0 })
})

test('suggestLever picks transform for flex center', () => {
  assert.equal(suggestLever({ display: 'flex', justifyContent: 'center' }), 'transform')
  assert.equal(suggestLever({ display: 'block' }), 'margin')
})

test('formatApplyRecipe is x + Δ = итог', () => {
  const recipe = formatApplyRecipe({
    lever: 'transform',
    xComputed: { tx: 24, ty: -65 },
    deltaX: -112,
    deltaY: 2,
  })
  assert.equal(recipe.xFileHint, 'translate(24px, -65px)')
  assert.equal(recipe.resultHint, 'translate(-88px, -63px)')
})

test('formatLayoutDeltaBufferLine v0.16', () => {
  const line = formatLayoutDeltaBufferLine(0, {
    selector: '#rezultat article:nth-of-type(2)',
    deltaX: -64,
    deltaY: 0,
    offsetBefore: {
      transform: { tx: 0, ty: 0 },
      margin: { x: 0, y: 0 },
      relative: { x: 0, y: 0 },
    },
    lever: 'transform',
    parentLayout: { display: 'flex', justifyContent: 'center' },
    viewport: { width: 1920, height: 945 },
    rectBefore: { left: 100, top: 200, width: 326, height: 190 },
    rectAfter: { left: 36, top: 200, width: 326, height: 190 },
  })

  assert.match(line, /→ x: translate\(0px, 0px\)/)
  assert.match(line, /\+ Δ: \(-64px, 0px\)/)
  assert.match(line, /= translate\(-64px, 0px\)/)
  assert.match(line, /\| рычаг: transform/)
  assert.match(line, /x_file \+ Δ/)
})

test('visualOffsetFromParts sums transform margin relative', () => {
  const v = visualOffsetFromParts({
    transform: { tx: 10, ty: 20 },
    margin: { x: 5, y: 0 },
    relative: { x: 0, y: 3 },
  })
  assert.deepEqual(v, { tx: 15, ty: 23 })
  assert.deepEqual(addVisualDelta(v, -5, 2), { tx: 10, ty: 25 })
})
