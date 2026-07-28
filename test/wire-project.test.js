import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describeProjectInstrumentation, enrichProjectRegistration } from '../src/wire-project.js'

test('framework project does not require site changes', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'visbug-wire-'))
  try {
    mkdirSync(join(workspace, 'src'), { recursive: true })
    writeFileSync(join(workspace, 'src', 'page.tsx'), 'export default function Page() { return null }')
    writeFileSync(join(workspace, 'next.config.mjs'), 'export default {}')

    const info = describeProjectInstrumentation(workspace)
    assert.equal(info.siteChangesRequired, false)
    assert.equal(info.instrumentation, 'extension-runtime')
    assert.match(info.userMessage, /не нужны/)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('enrichProjectRegistration stores instrumentation metadata', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'visbug-wire-'))
  try {
    writeFileSync(join(workspace, 'index.html'), '<!doctype html><html></html>')
    const project = enrichProjectRegistration({
      id: workspace,
      name: 'demo',
      workspace,
      origins: ['http://localhost:3000'],
    }, workspace)

    assert.equal(project.instrumentation, 'selector')
    assert.equal(project.kind, 'static-html')
    assert.equal(project.siteChangesRequired, false)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})
