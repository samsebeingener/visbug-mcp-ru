import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildActionsPayload } from '../src/actions/export.js'
import { applyStoreActions, pickActionsForApply } from '../src/actions/apply-pipeline.js'
import { ACTION_TYPES } from '../src/actions/schema.js'
import { setChangesFromRecording } from '../src/actions/store.js'

function makeWorkspace() {
  const workspace = mkdtempSync(join(tmpdir(), 'visbug-mcp-actions-'))
  writeFileSync(join(workspace, 'index.html'), `<!doctype html>
<html><body><header>
<a id="header-booking-btn" class="h-11 px-5">Book</a>
</header></body></html>`, 'utf8')
  return workspace
}

test('buildActionsPayload returns structured pending actions', () => {
  const store = setChangesFromRecording({}, [
    {
      type: 'style',
      selector: '#header-booking-btn',
      property: 'width',
      newValue: '160px',
      tag: 'a',
      applied: false,
    },
    { type: 'style', selector: '#x', property: 'cursor', newValue: 'move', applied: false },
  ], { workspace: '/tmp/project' })

  const payload = buildActionsPayload(store)

  assert.equal(payload.format, 2)
  assert.equal(payload.pendingCount, 1)
  assert.equal(payload.actions.length, 1)
  assert.equal(payload.actions[0].type, ACTION_TYPES.STYLE)
  assert.equal(payload.artifacts.length, 1)
  assert.match(payload.summary, /#header-booking-btn/)
})

test('pickActionsForApply resolves indices in pending list', () => {
  const store = setChangesFromRecording({}, [
    { type: 'style', selector: '#a', property: 'width', newValue: '10px', applied: false },
    { type: 'style', selector: '#b', property: 'width', newValue: '20px', applied: false },
  ], {})

  const picked = pickActionsForApply(store, { indices: [1] })
  assert.equal(picked.length, 1)
  assert.equal(picked[0].target.selector, '#b')
})

test('applyStoreActions writes static-html width from STYLE action', () => {
  const workspace = makeWorkspace()
  const store = setChangesFromRecording({}, [
    {
      type: 'style',
      selector: '#header-booking-btn',
      property: 'width',
      newValue: '160px',
      tag: 'a',
      applied: false,
    },
  ], { workspace })

  try {
    const result = applyStoreActions(store, workspace, {})
    const html = readFileSync(join(workspace, 'index.html'), 'utf8')

    assert.equal(result.applied, 1)
    assert.match(html, /w-\[160px\]/)
    assert.equal(result.store.actions[0].applied, true)
    assert.match(result.summary, /В файлы: 1/)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})
