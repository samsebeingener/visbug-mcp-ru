import test from 'node:test'
import assert from 'node:assert/strict'
import { compileWriteRecipes, formatWriteRecipesBuffer } from '../src/actions/write-recipe.js'

test('resize-only layout-delta (dx=0, dy=0, Δw=40) → recipe intent resize + write width', () => {
  const recipes = compileWriteRecipes([
    {
      type: 'layout-delta',
      selector: '#card',
      diagnosticSelector: '#card',
      shortSelector: '#card',
      deltaX: 0,
      deltaY: 0,
      deltaW: 40,
      deltaH: 0,
      editIntent: 'resize',
      lever: 'transform',
      offsetBefore: {
        transform: { tx: 0, ty: 0 },
        margin: { x: 0, y: 0 },
        relative: { x: 0, y: 0 },
      },
      rectBefore: { left: 100, top: 50, width: 300, height: 200 },
      rectAfter: { left: 100, top: 50, width: 340, height: 200 },
      applied: false,
    },
  ])

  assert.equal(recipes.length, 1)
  assert.equal(recipes[0].editIntent, 'resize')
  const widthDecl = recipes[0].write.declarations.find((d) => d.prop === 'width')
  assert.equal(widthDecl?.value, '340px')
  assert.equal(recipes[0].write.before.width, '300px')

  const buffer = formatWriteRecipesBuffer(recipes)
  assert.match(buffer, /intent: resize/)
  assert.match(buffer, /width: 340px;/)
})

test('move+resize layout-delta → intent move+resize with transform and width', () => {
  const recipes = compileWriteRecipes([
    {
      type: 'layout-delta',
      selector: '#box',
      diagnosticSelector: '#box',
      deltaX: 10,
      deltaY: 5,
      deltaW: 40,
      deltaH: -20,
      editIntent: 'move+resize',
      lever: 'transform',
      offsetBefore: {
        transform: { tx: 0, ty: 0 },
        margin: { x: 0, y: 0 },
        relative: { x: 0, y: 0 },
      },
      rectBefore: { left: 10, top: 10, width: 100, height: 100 },
      rectAfter: { left: 20, top: 15, width: 140, height: 80 },
      applied: false,
    },
  ])

  assert.equal(recipes.length, 1)
  assert.equal(recipes[0].editIntent, 'move+resize')
  const props = recipes[0].write.declarations.map((d) => `${d.prop}:${d.value}`)
  assert.ok(props.some((p) => p.startsWith('transform:')))
  assert.ok(props.includes('width:140px'))
  assert.ok(props.includes('height:80px'))
})

test('align and layoutIntent from layout-delta reach recipe and buffer', () => {
  const recipes = compileWriteRecipes([
    {
      type: 'layout-delta',
      selector: '#item',
      diagnosticSelector: '#item',
      deltaX: 12,
      deltaY: 0,
      lever: 'transform',
      offsetBefore: {
        transform: { tx: 0, ty: 0 },
        margin: { x: 0, y: 0 },
        relative: { x: 0, y: 0 },
      },
      align: { reference: { selector: 'ul.list', edge: 'left' }, edge: 'left' },
      layoutIntent: { parent: { display: 'flex' }, axis: 'x' },
      applied: false,
    },
  ])

  assert.equal(recipes.length, 1)
  assert.equal(recipes[0].align.reference.selector, 'ul.list')
  assert.equal(recipes[0].layoutIntent.axis, 'x')

  const buffer = formatWriteRecipesBuffer(recipes)
  assert.match(buffer, /align-hint: ul\.list/)
  assert.match(buffer, /layout-intent: /)
})
