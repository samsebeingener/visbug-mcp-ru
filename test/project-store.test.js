import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('getProjectStorePath and load/save per project', async () => {
  const prev = process.env.VISBUG_MCP_STORE_DIR
  const storeRoot = mkdtempSync(join(tmpdir(), 'visbug-project-store-'))
  process.env.VISBUG_MCP_STORE_DIR = storeRoot

  try {
    const {
      getProjectStorePath,
      loadProjectStore,
      saveProjectStore,
      ensureProjectsRoot,
    } = await import('../src/project-store.js')

    ensureProjectsRoot()
    const path = getProjectStorePath('demo-site')
    assert.match(path.replace(/\\/g, '/'), /projects\/demo-site\/changes\.json$/)

    const saved = saveProjectStore('demo-site', {
      workspace: '/tmp/demo',
      changes: [{ type: 'style', selector: 'h1', property: 'left', newValue: '10px', applied: false }],
    })
    assert.equal(saved.version, 2)
    assert.equal(saved.projectId, 'demo-site')
    assert.equal(saved.changes.length, 1)

    const loaded = loadProjectStore('demo-site')
    assert.equal(loaded.workspace, '/tmp/demo')
    assert.equal(loaded.changes.length, 1)
  } finally {
    if (prev === undefined) delete process.env.VISBUG_MCP_STORE_DIR
    else process.env.VISBUG_MCP_STORE_DIR = prev
    rmSync(storeRoot, { recursive: true, force: true })
  }
})

test('migrateLegacyGlobalStore moves global changes.json once', async () => {
  const prev = process.env.VISBUG_MCP_STORE_DIR
  const storeRoot = mkdtempSync(join(tmpdir(), 'visbug-legacy-migrate-'))
  process.env.VISBUG_MCP_STORE_DIR = storeRoot

  const legacy = {
    version: 2,
    workspace: '/abs/my-workspace',
    changes: [{ type: 'text', selector: 'h1', oldValue: 'A', newValue: 'B', applied: false }],
  }
  writeFileSync(join(storeRoot, 'changes.json'), JSON.stringify(legacy), 'utf8')

  try {
    const {
      migrateLegacyGlobalStore,
      loadProjectStore,
      getLegacyMigratedFile,
    } = await import('../src/project-store.js')

    const config = { projects: [{ id: 'my-workspace', workspace: '/abs/my-workspace', origins: [] }] }
    const first = migrateLegacyGlobalStore(config)
    assert.equal(first.migrated, true)

    const loaded = loadProjectStore(first.projectId)
    assert.equal(loaded.workspace, '/abs/my-workspace')
    assert.equal(loaded.changes.length, 1)

    assert.equal(existsSync(getLegacyMigratedFile()), true)
    assert.equal(existsSync(join(storeRoot, 'changes.json')), false)

    const second = migrateLegacyGlobalStore(config)
    assert.equal(second.migrated, false)
  } finally {
    if (prev === undefined) delete process.env.VISBUG_MCP_STORE_DIR
    else process.env.VISBUG_MCP_STORE_DIR = prev
    rmSync(storeRoot, { recursive: true, force: true })
  }
})
