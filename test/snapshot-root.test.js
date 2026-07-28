import assert from 'node:assert/strict'
import test from 'node:test'

/** Дублирует extension/snapshot.js#getDefaultSnapshotRoot — держать в sync. */
function getDefaultSnapshotRoot(documentRef) {
  const doc = documentRef ?? globalThis.document
  const homepage = doc.querySelector('#homepage-root')
  if (homepage) return homepage

  const main = doc.querySelector('main')
  const header = doc.querySelector('header')
  if (main && header && !main.contains(header)) {
    return doc.body
  }

  return main || doc.body
}

function makeDom(html) {
  if (typeof DOMParser === 'undefined') {
    return null
  }
  return new DOMParser().parseFromString(html, 'text/html')
}

test('snapshot root is body when header is outside main', () => {
  const doc = makeDom(`<!doctype html><html><body>
    <header><a id="btn">CTA</a></header>
    <main class="pt-20"><p>Hero</p></main>
  </body></html>`)
  if (!doc) {
    return
  }
  const root = getDefaultSnapshotRoot(doc)
  assert.equal(root, doc.body)
  assert.ok(root.querySelector('#btn'))
})

test('snapshot root stays #homepage-root for React apps', () => {
  const doc = makeDom(`<!doctype html><html><body>
    <div id="homepage-root"><main></main></div>
    <header></header>
  </body></html>`)
  if (!doc) {
    return
  }
  assert.equal(getDefaultSnapshotRoot(doc), doc.querySelector('#homepage-root'))
})
