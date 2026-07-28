import assert from 'node:assert/strict'
import test from 'node:test'
import { formatActionsForMcp } from '../src/actions/format.js'
import { legacyChangesToActions } from '../src/actions/compile.js'
import { ACTION_TYPES } from '../src/actions/schema.js'

function attachAlignToChanges(changes, alignRefs) {
  const map = new Map(alignRefs.map((entry) => [entry.draggedSelector, entry.align]))
  for (const change of changes) {
    if (change?.type !== 'style' || change.property !== 'left') continue
    const align = map.get(change.selector)
    if (align && !change.align) change.align = align
  }
  return changes
}

test('attachAlignToChanges links snap metadata to move changes', () => {
  const dragged = '#services .builder-rich-text > p:nth-of-type(1)'
  const changes = [
    { type: 'style', selector: dragged, property: 'left', newValue: '32px' },
    { type: 'style', selector: dragged, property: 'top', newValue: '0px' },
  ]
  const alignRefs = [{
    draggedSelector: dragged,
    align: {
      mode: 'edge',
      edge: 'left',
      axis: 'x',
      distance: 1,
      reference: {
        selector: '#services article:nth-of-type(2) ul',
        edge: 'left',
        rect: { left: 96, top: 512, width: 240, height: 88 },
      },
    },
  }]

  attachAlignToChanges(changes, alignRefs)

  assert.equal(changes[0].align.reference.selector, '#services article:nth-of-type(2) ul')
  assert.equal(changes[1].align, undefined)
})

test('formatActionsForMcp mentions align reference on MOVE', () => {
  const { actions } = legacyChangesToActions([
    {
      type: 'style',
      selector: '#services p',
      property: 'left',
      newValue: '32px',
      align: {
        mode: 'edge',
        edge: 'left',
        axis: 'x',
        distance: 0,
        reference: { selector: '#services ul', edge: 'left', rect: { left: 0, top: 0, width: 1, height: 1 } },
      },
      applied: false,
    },
  ])

  const text = formatActionsForMcp({ actions, artifacts: [] })

  assert.match(text, /выравнивание:.*#services ul/)
  assert.equal(actions[0].type, ACTION_TYPES.MOVE)
})
