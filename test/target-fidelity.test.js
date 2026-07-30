import test from 'node:test'
import assert from 'node:assert/strict'
import {
  clearSeen,
  formatChangesFromStore,
  parseMutationsToChanges,
} from '../src/parser.js'

test('visbugSrc survives parseMutationsToChanges and appears in write recipe', () => {
  clearSeen()
  const mutations = [{
    type: 'layout-delta',
    selector: 'body > main > img.hero-portrait',
    tag: 'img',
    deltaX: 12,
    deltaY: -8,
    visbugSrc: 'src/components/Hero.tsx:42:10',
    stableId: 'hero-portrait',
    sourceRef: {
      v: 1,
      kind: 'react-debug-source',
      file: 'src/components/Hero.tsx',
      line: 42,
      column: 10,
      confidence: 'exact',
    },
    offsetBefore: {
      transform: { tx: 0, ty: 0 },
      margin: { x: 0, y: 0 },
      relative: { x: 0, y: 0 },
    },
    lever: 'transform',
    viewport: { width: 1440, height: 900 },
    timestamp: Date.now(),
  }]

  const changes = parseMutationsToChanges(mutations)
  assert.equal(changes.length, 1)
  assert.equal(changes[0].visbugSrc, 'src/components/Hero.tsx:42:10')
  assert.equal(changes[0].stableId, 'hero-portrait')

  const text = formatChangesFromStore(changes, {
    workspace: '/projects/samsebeingener-web/frontend-new',
    includeActions: true,
  })

  assert.match(text, /=== VisBug session ===/)
  assert.match(text, /mode: write-recipes/)
  assert.match(text, /files: src\/components\/Hero\.tsx \(1\)/)
  assert.match(text, /file: src\/components\/Hero\.tsx/)
  assert.match(text, /src: src\/components\/Hero\.tsx:42:10/)
  assert.match(text, /#hero-portrait|\.hero-portrait/)
  assert.match(text, /transform: translate\(12px, -8px\);/)
  assert.match(text, /before:/)
  assert.match(text, /contract: v0\.26/)
  assert.match(text, /--- write-recipes\.json ---/)
})
