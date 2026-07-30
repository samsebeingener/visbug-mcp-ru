import test from 'node:test'
import assert from 'node:assert/strict'
import {
  formatTransformParts,
  hasNonTranslateParts,
  parseTransformParts,
  readOffsetFromComputedStyle,
} from '../shared/layout-lever.js'
import { compileWriteRecipes } from '../src/actions/write-recipe.js'

test('parseTransformParts decomposes matrix with scale and translate', () => {
  const parts = parseTransformParts('matrix(1.02, 0, 0, 1.02, 17, 0)')
  assert.equal(parts.tx, 17)
  assert.equal(parts.ty, 0)
  assert.equal(parts.scaleX, 1.02)
  assert.equal(parts.scaleY, 1.02)
  assert.equal(parts.rotate, 0)
  assert.equal(hasNonTranslateParts(parts), true)
})

test('parseTransformParts handles none and plain translate matrix', () => {
  assert.deepEqual(parseTransformParts('none'), { tx: 0, ty: 0, scaleX: 1, scaleY: 1, rotate: 0 })
  assert.deepEqual(parseTransformParts(null), { tx: 0, ty: 0, scaleX: 1, scaleY: 1, rotate: 0 })
  const plain = parseTransformParts('matrix(1, 0, 0, 1, 24, -65)')
  assert.deepEqual(plain, { tx: 24, ty: -65, scaleX: 1, scaleY: 1, rotate: 0 })
  assert.equal(hasNonTranslateParts(plain), false)
})

test('parseTransformParts decomposes rotate from matrix', () => {
  // rotate(30deg): cos≈0.8660, sin=0.5
  const parts = parseTransformParts('matrix(0.866025, 0.5, -0.5, 0.866025, 10, 20)')
  assert.equal(parts.rotate, 30)
  assert.equal(parts.scaleX, 1)
  assert.equal(parts.tx, 10)
  assert.equal(parts.ty, 20)
})

test('parseTransformParts composes translate/scale/rotate function chain', () => {
  const parts = parseTransformParts('translate(10px, 5px) scale(1.2) rotate(45deg)')
  assert.equal(parts.tx, 10)
  assert.equal(parts.ty, 5)
  assert.equal(parts.scaleX, 1.2)
  assert.equal(parts.scaleY, 1.2)
  assert.equal(parts.rotate, 45)
})

test('parseTransformParts reads matrix3d translate and scale', () => {
  const parts = parseTransformParts(
    'matrix3d(1.02, 0, 0, 0, 0, 1.02, 0, 0, 0, 0, 1, 0, 17, 15, 0, 1)',
  )
  assert.equal(parts.tx, 17)
  assert.equal(parts.ty, 15)
  assert.equal(parts.scaleX, 1.02)
})

test('formatTransformParts merges delta preserving scale', () => {
  const base = parseTransformParts('matrix(1.02, 0, 0, 1.02, 17, 0)')
  const merged = { ...base, tx: base.tx + 0, ty: base.ty + 15 }
  assert.equal(formatTransformParts(merged), 'translate(17px, 15px) scale(1.02)')
})

test('formatTransformParts omits identity parts', () => {
  assert.equal(formatTransformParts({ tx: 5, ty: -3, scaleX: 1, scaleY: 1, rotate: 0 }), 'translate(5px, -3px)')
  assert.equal(formatTransformParts({ tx: 0, ty: 0, scaleX: 1, scaleY: 1, rotate: 0 }), 'none')
  assert.equal(
    formatTransformParts({ tx: 4, ty: 0, scaleX: 1.1, scaleY: 0.9, rotate: 10 }),
    'translate(4px, 0px) scale(1.1, 0.9) rotate(10deg)',
  )
})

test('readOffsetFromComputedStyle captures transformRaw and transformParts', () => {
  const offset = readOffsetFromComputedStyle({
    transform: 'matrix(1.02, 0, 0, 1.02, 17, 0)',
    marginTop: '0px',
    marginInlineStart: '0px',
  })
  assert.equal(offset.transformRaw, 'matrix(1.02, 0, 0, 1.02, 17, 0)')
  assert.equal(offset.transformParts.scaleX, 1.02)
  assert.equal(offset.transform.tx, 17)
})

test('MOVE write recipe preserves scale from computed matrix', () => {
  const [recipe] = compileWriteRecipes([{
    type: 'layout-delta',
    selector: '#hero-card',
    shortSelector: '#hero-card',
    deltaX: 0,
    deltaY: 15,
    visbugSrc: 'src/styles/main.css:10:1',
    offsetBefore: {
      transform: { tx: 17, ty: 0 },
      transformRaw: 'matrix(1.02, 0, 0, 1.02, 17, 0)',
      transformParts: { tx: 17, ty: 0, scaleX: 1.02, scaleY: 1.02, rotate: 0 },
      margin: { x: 0, y: 0 },
      relative: { x: 0, y: 0 },
    },
    lever: 'transform',
    viewport: { width: 1440, height: 900 },
    applied: false,
  }])

  assert.equal(recipe.type, 'MOVE')
  const decl = recipe.write.declarations.find((d) => d.prop === 'transform')
  assert.equal(decl.value, 'translate(17px, 15px) scale(1.02)')
  assert.deepEqual(recipe.write.transformParts, { tx: 17, ty: 15, scaleX: 1.02, scaleY: 1.02, rotate: 0 })
  assert.match(recipe.write.before.transform ?? '', /matrix\(1\.02/)
})

test('MOVE write recipe without scale keeps plain translate (P0/P1 behaviour)', () => {
  const [recipe] = compileWriteRecipes([{
    type: 'layout-delta',
    selector: '#method-quote',
    shortSelector: '#method-quote',
    deltaX: 0,
    deltaY: -65,
    visbugSrc: 'src/styles/sections.css:120:1',
    offsetBefore: {
      transform: { tx: 24, ty: -65 },
      margin: { x: 0, y: 0 },
      relative: { x: 0, y: 0 },
    },
    lever: 'transform',
    viewport: { width: 1440, height: 900 },
    applied: false,
  }])

  const decl = recipe.write.declarations.find((d) => d.prop === 'transform')
  assert.equal(decl.value, 'translate(24px, -130px)')
  assert.deepEqual(recipe.write.transformParts, { tx: 24, ty: -130, scaleX: 1, scaleY: 1, rotate: 0 })
})

test('hover:scale case — scale survives write even when drag started mid-hover', () => {
  // acceptance: элемент со scale (hover:scale в computed) + drag Δ
  const base = parseTransformParts('matrix(1.05, 0, 0, 1.05, 0, 0)')
  const [recipe] = compileWriteRecipes([{
    type: 'layout-delta',
    selector: '.btn',
    shortSelector: '.btn',
    deltaX: 8,
    deltaY: 0,
    visbugSrc: 'src/styles/ui.css:42:1',
    offsetBefore: {
      transform: { tx: base.tx, ty: base.ty },
      transformRaw: 'matrix(1.05, 0, 0, 1.05, 0, 0)',
      transformParts: base,
      margin: { x: 0, y: 0 },
      relative: { x: 0, y: 0 },
    },
    lever: 'transform',
    viewport: { width: 1440, height: 900 },
    applied: false,
  }])

  const decl = recipe.write.declarations.find((d) => d.prop === 'transform')
  assert.equal(decl.value, 'translate(8px, 0px) scale(1.05)')
})
