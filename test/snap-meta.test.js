import test from 'node:test'
import assert from 'node:assert/strict'
import {
  snapCssPx,
  snapDeclaration,
  formatPxClean,
  EXACT_EPS,
} from '../shared/snap-meta.js'
import { compileWriteRecipes, formatWriteRecipesBuffer } from '../src/actions/write-recipe.js'

test('snapCssPx exact within epsilon', () => {
  const s = snapCssPx('16.02px')
  assert.ok(Math.abs(16.02 - 16) <= EXACT_EPS || s.match === 'exact' || s.match === 'snapped')
  const exact = snapCssPx('16.00px')
  assert.equal(exact.match, 'exact')
  assert.equal(exact.value, '16px')
})

test('snapCssPx snaps near scale step', () => {
  const s = snapCssPx('15.4px') // ~3.75% from 16
  assert.equal(s.match, 'snapped')
  assert.equal(s.value, '16px')
})

test('snapCssPx arbitrary when far from scale', () => {
  const s = snapCssPx('21.5px')
  assert.equal(s.match, 'arbitrary')
  assert.equal(s.value, formatPxClean(21.5))
})

test('snapDeclaration translate', () => {
  const d = snapDeclaration('transform', 'translate(17.01px, 15px)')
  assert.equal(d.value, 'translate(17px, 15px)')
  assert.equal(d.snap.match, 'exact')
})

test('compileWriteRecipes emits before/after/src/warnings', () => {
  const recipes = compileWriteRecipes([
    {
      type: 'layout-delta',
      selector: '#hero',
      diagnosticSelector: '#hero',
      shortSelector: '#hero',
      deltaX: 0,
      deltaY: 15,
      lever: 'transform',
      visbugSrc: 'src/components/Hero.tsx:10:2',
      offsetBefore: {
        transform: { tx: 17, ty: 0 },
        margin: { x: 0, y: 0 },
        relative: { x: 0, y: 0 },
      },
      applied: false,
    },
    {
      type: 'style',
      selector: '#hero',
      diagnosticSelector: '#hero',
      property: 'width',
      oldValue: '538.672px',
      newValue: '538.672px',
      applied: false,
    },
  ])

  assert.equal(recipes.length, 1)
  assert.equal(recipes[0].write.src, 'src/components/Hero.tsx:10:2')
  assert.equal(recipes[0].write.before.transform, 'translate(17px, 0px)')
  assert.equal(recipes[0].write.after.transform, 'translate(17px, 15px)')
  assert.equal(recipes[0].write.after.width, '539px')
  assert.equal(recipes[0].write.snap.width.match, 'exact')
  assert.ok(recipes[0].write.warnings.some((w) => /subpixel.*width|width: subpixel/.test(w)))
  assert.ok(recipes[0].write.declarations.some((d) => d.prop === 'width' && d.value === '539px'))

  const text = formatWriteRecipesBuffer(recipes, { workspace: '/tmp/site' })
  assert.match(text, /contract: v0\.26 snap-meta \+ before\/after \+ src \+ confidence \+ parent-child-dedup \+ auto-stamp/)
  assert.match(text, /src: src\/components\/Hero\.tsx:10:2/)
  assert.match(text, /before:/)
  assert.match(text, /after:/)
  assert.match(text, /# snap:exact/)
})

test('compileWriteRecipes warns without visbugSrc', () => {
  const recipes = compileWriteRecipes([
    {
      type: 'layout-delta',
      selector: '#a',
      diagnosticSelector: '#a',
      shortSelector: '#a',
      deltaX: 4,
      deltaY: 0,
      lever: 'transform',
      offsetBefore: {
        transform: { tx: 0, ty: 0 },
        margin: { x: 0, y: 0 },
        relative: { x: 0, y: 0 },
      },
      applied: false,
    },
  ])
  assert.match(recipes[0].write.warnings[0], /no-visbug-src/)
  const text = formatWriteRecipesBuffer(recipes)
  assert.match(text, /warnings:/)
  assert.match(text, /no-visbug-src/)
})
