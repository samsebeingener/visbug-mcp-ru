import test from 'node:test'
import assert from 'node:assert/strict'
import {
  compileWriteRecipes,
  formatWriteRecipesBuffer,
} from '../src/actions/write-recipe.js'

const parentDrag = {
  type: 'layout-delta',
  selector: '#wrapper',
  diagnosticSelector: 'body > main > #wrapper',
  shortSelector: '#wrapper',
  deltaX: 24,
  deltaY: 0,
  offsetBefore: {
    transform: { tx: 0, ty: 0 },
    margin: { x: 0, y: 0 },
    relative: { x: 0, y: 0 },
  },
  lever: 'transform',
  viewport: { width: 1440, height: 900 },
  applied: false,
}

const childDrag = {
  type: 'layout-delta',
  selector: '#child',
  diagnosticSelector: 'body > main > #wrapper > #child',
  shortSelector: '#child',
  deltaX: 24,
  deltaY: 0,
  parentLayout: { selector: '#wrapper' },
  offsetBefore: {
    transform: { tx: 0, ty: 0 },
    margin: { x: 0, y: 0 },
    relative: { x: 0, y: 0 },
  },
  lever: 'transform',
  viewport: { width: 1440, height: 900 },
  applied: false,
}

test('P4: parent + child MOVE с коррелированным Δ схлопываются в один рецепт', () => {
  const recipes = compileWriteRecipes([parentDrag, childDrag])

  assert.equal(recipes.length, 1)
  assert.equal(recipes[0].type, 'MOVE')
  assert.equal(recipes[0].write.selector, '#wrapper')
  assert.ok(
    recipes[0].write.warnings.some((w) => w === 'child-suppressed: #child'),
    `warnings: ${recipes[0].write.warnings.join(', ')}`,
  )
})

test('P4: buffer note о подавленном дочернем MOVE', () => {
  const recipes = compileWriteRecipes([parentDrag, childDrag])
  const buffer = formatWriteRecipesBuffer(recipes)

  assert.match(buffer, /parent-child-dedup: suppressed 1 child MOVE \(#child\)/)
  assert.match(buffer, /child-suppressed: #child/)
})

test('P4: дочерний STYLE-рецепт НЕ подавляется', () => {
  const childStyle = {
    type: 'style',
    selector: '#child',
    diagnosticSelector: 'body > main > #wrapper > #child',
    shortSelector: '#child',
    property: 'color',
    oldValue: 'rgb(0, 0, 0)',
    newValue: 'rgb(255, 0, 0)',
    applied: false,
  }

  const recipes = compileWriteRecipes([parentDrag, childDrag, childStyle])

  assert.equal(recipes.length, 2)
  const parent = recipes.find((r) => r.write.selector === '#wrapper')
  const childStyleRecipe = recipes.find((r) => r.write.selector === '#child')
  assert.ok(parent, 'parent MOVE recipe')
  assert.equal(parent.type, 'MOVE')
  assert.ok(
    parent.write.warnings.some((w) => w === 'child-suppressed: #child'),
    'child MOVE suppressed with warning',
  )
  assert.ok(childStyleRecipe, 'child STYLE recipe preserved')
  assert.equal(childStyleRecipe.type, 'STYLE')
  assert.ok(
    childStyleRecipe.write.declarations.some((d) => d.prop === 'color'),
    'restyle is independent',
  )
})

test('P4: некоррелированные Δ не схлопываются', () => {
  const recipes = compileWriteRecipes([
    parentDrag,
    { ...childDrag, deltaX: 60, deltaY: -10 },
  ])

  assert.equal(recipes.length, 2)
  for (const r of recipes) {
    assert.ok(
      !r.write.warnings.some((w) => w.startsWith('child-suppressed:')),
      'no suppression for diverged deltas',
    )
  }
})
