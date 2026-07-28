import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, rmSync } from 'node:fs'
import { completeAgentRun, createAgentRun, readAgentRunCompletion } from '../src/agent-run.js'

test('accepts completion indexes only from its own run-packet', () => {
  const run = createAgentRun({
    workspace: 'C:/example',
    url: 'http://localhost:3001/',
    changes: [{ type: 'style' }, { type: 'text' }],
  })
  try {
    const completion = completeAgentRun({
      runId: run.runId,
      appliedIds: [0, 1, 99, 1],
      files: ['src/a.css', 'src/a.css', '../outside.css'],
    })

    assert.deepEqual(completion.appliedIds, [0, 1])
    assert.deepEqual(completion.files, ['src/a.css'])
    assert.deepEqual(readAgentRunCompletion(run)?.appliedIds, [0, 1])
  } finally {
    for (const path of [run.path, run.completionPath]) {
      if (existsSync(path)) rmSync(path)
    }
  }
})
