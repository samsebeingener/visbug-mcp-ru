import test from 'node:test'
import assert from 'node:assert/strict'
import { findConflictingClasses } from '../src/actions/tw-conflicts.js'
import { compileWriteRecipes, formatWriteRecipesBuffer } from '../src/actions/write-recipe.js'

test('px-6 removes px-4 and px-5', () => {
  const out = findConflictingClasses('flex px-4 mt-2 px-5', ['px-6'])
  assert.deepEqual(out, ['px-4', 'px-5'])
})

test('translate-x-4 removes translate-x-2', () => {
  const out = findConflictingClasses('translate-x-2 text-white', ['translate-x-4'])
  assert.deepEqual(out, ['translate-x-2'])
})

test('col-span-7 conflicts with col-span-5', () => {
  const out = findConflictingClasses('grid col-span-5 gap-4', ['col-span-7'])
  assert.deepEqual(out, ['col-span-5'])
})

test('p-6 removes axis paddings (tailwind-merge style)', () => {
  const out = findConflictingClasses('px-4 pt-2 mb-3', ['p-6'])
  assert.deepEqual(out, ['px-4', 'pt-2'])
})

test('exact same class is kept (no self-removal)', () => {
  const out = findConflictingClasses('px-4 mt-2', ['px-4'])
  assert.deepEqual(out, [])
})

test('no className or no new classes → empty', () => {
  assert.deepEqual(findConflictingClasses('', ['px-6']), [])
  assert.deepEqual(findConflictingClasses('px-4', []), [])
})

test('write recipe carries stylesToSet + classesToRemove from class mutation', () => {
  const recipes = compileWriteRecipes([
    {
      type: 'style',
      selector: '.card',
      diagnosticSelector: '.card',
      property: 'color',
      newValue: 'red',
      className: 'flex px-4 mt-2 px-5',
      applied: false,
    },
    {
      type: 'attribute',
      attribute: 'class',
      selector: '.card',
      diagnosticSelector: '.card',
      oldValue: 'flex px-4 mt-2 px-5',
      newValue: 'flex px-6 mt-2',
      applied: false,
    },
  ])

  assert.equal(recipes.length, 1)
  assert.deepEqual(recipes[0].write.stylesToSet, recipes[0].write.declarations)
  assert.deepEqual(recipes[0].write.classesToRemove, ['px-4', 'px-5'])

  const buffer = formatWriteRecipesBuffer(recipes)
  assert.match(buffer, /remove-classes: px-4 px-5/)
})

test('recipe without className → classesToRemove = []', () => {
  const recipes = compileWriteRecipes([
    {
      type: 'style',
      selector: '.card',
      diagnosticSelector: '.card',
      property: 'color',
      newValue: 'red',
      applied: false,
    },
  ])
  assert.equal(recipes.length, 1)
  assert.deepEqual(recipes[0].write.classesToRemove, [])
  const buffer = formatWriteRecipesBuffer(recipes)
  assert.doesNotMatch(buffer, /remove-classes:/)
})
