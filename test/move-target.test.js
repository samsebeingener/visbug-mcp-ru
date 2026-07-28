import test from 'node:test'
import assert from 'node:assert/strict'
import {
  collectRelatedMoveChanges,
  findRichTextContainerClass,
  marginFromAlignReference,
  pickBestMoveChange,
  resolveMoveApplySelector,
  resolveMoveContainerSelector,
  stripPerParagraphMarginRules,
} from '../src/move-target.js'

test('findRichTextContainerClass detects generic prose and rich-text patterns', () => {
  assert.equal(findRichTextContainerClass('#section-id .prose > p'), 'prose')
  assert.equal(findRichTextContainerClass('#hero .cms-content p:nth-of-type(2)'), 'cms-content')
  assert.equal(findRichTextContainerClass('#block .builder-rich-text > p'), 'builder-rich-text')
  assert.equal(findRichTextContainerClass('#block .card-title'), null)
})

test('resolveMoveContainerSelector promotes paragraph move to section container', () => {
  const selector = '#section-id .prose.text-base > p:nth-of-type(1)'
  assert.equal(resolveMoveContainerSelector(selector, 'p'), '#section-id .prose')
})

test('two paragraph drags map to one container apply selector', () => {
  const p1 = '#section-id .prose > p:nth-of-type(1)'
  const p2 = '#section-id .prose > p:nth-of-type(2)'
  const resolve = (c) => resolveMoveApplySelector(c, '/tmp', null)

  const pending = [
    { type: 'style', selector: p1, property: 'left', newValue: '10px', tag: 'p' },
    { type: 'style', selector: p2, property: 'left', newValue: '24px', tag: 'p' },
  ]

  const applySelector = resolve(pending[0])
  assert.equal(applySelector, '#section-id .prose')

  const related = collectRelatedMoveChanges(pending, applySelector, '/tmp', resolve)
  assert.equal(related.length, 2)
  assert.equal(pickBestMoveChange(related).newValue, '24px')
})

test('marginFromAlignReference computes edge delta from dragRect and reference', () => {
  const change = {
    property: 'left',
    newValue: '99px',
    align: {
      axis: 'x',
      edge: 'left',
      dragRect: { left: 200, top: 0, width: 100, height: 20 },
      reference: {
        edge: 'left',
        rect: { left: 260, top: 0, width: 80, height: 20 },
      },
    },
  }
  assert.equal(marginFromAlignReference(change, 0), 60)
  assert.equal(marginFromAlignReference(change, -10), 50)
})

test('pickBestMoveChange prefers align.reference over larger raw delta', () => {
  const withAlign = {
    property: 'left',
    newValue: '5px',
    align: { reference: { rect: { left: 1 } }, dragRect: { left: 1 } },
  }
  const bigger = { property: 'left', newValue: '80px' }
  assert.equal(pickBestMoveChange([bigger, withAlign]), withAlign)
})

test('stripPerParagraphMarginRules removes per-p margin blocks under container', () => {
  const css = `#section-id .prose {
  color: #111;
}
#section-id .prose p:nth-of-type(1) {
  margin-inline-start: 46px;
}
#section-id .prose p:nth-of-type(2) {
  margin-inline-start: 46px;
}
`
  const next = stripPerParagraphMarginRules(css, '#section-id .prose')
  assert.doesNotMatch(next, /p:nth-of-type/)
  assert.match(next, /#section-id \.prose/)
})
