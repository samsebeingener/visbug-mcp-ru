import assert from 'node:assert/strict'
import test from 'node:test'
import { getProjects, normalizeOrigin, resolveProjectForUrl } from '../src/projects.js'

test('normalizes localhost origins and matches projects exactly', () => {
  const config = {
    projects: [{
      id: 'site',
      name: 'Site',
      workspace: 'C:/site',
      origins: ['http://localhost:3001/'],
    }],
  }

  assert.equal(normalizeOrigin('http://LOCALHOST:3001/path'), 'http://localhost:3001')
  assert.equal(resolveProjectForUrl(config, 'http://localhost:3001/about').project?.id, 'site')
  assert.equal(resolveProjectForUrl(config, 'http://localhost:3002/').reason, 'origin-unmapped')
})

test('exposes a legacy workspace only when no projects exist', () => {
  const projects = getProjects({ autoAgent: { workspace: 'C:/legacy-project' } })
  assert.deepEqual(projects, [{
    id: 'legacy-default',
    name: 'legacy-project',
    workspace: 'C:/legacy-project',
    origins: [],
  }])
})
