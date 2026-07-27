/**
 * Snapshot до/после — diff DOM-состояния для режима «Запись».
 * Без фильтров шума: в буфер попадает всё, что реально изменилось в inline-стилях.
 */

if (!globalThis.VisbugMcpSnapshot) {

const MAX_ELEMENTS = 1200

function parseInlineStyle(styleAttr) {
  const map = {}
  if (!styleAttr) return map
  for (const decl of styleAttr.split(';')) {
    const idx = decl.indexOf(':')
    if (idx === -1) continue
    const prop = decl.slice(0, idx).trim()
    const value = decl.slice(idx + 1).trim()
    if (prop) map[prop] = value
  }
  return map
}

function captureElementStyles(el) {
  const cssText = el.style?.cssText || el.getAttribute('style') || ''
  return parseInlineStyle(cssText)
}

function shouldSkipElement(el) {
  const tag = el.tagName?.toLowerCase()
  if (!tag || tag === 'script' || tag === 'style' || tag === 'noscript') return true
  if (tag.startsWith('vis-') || tag === 'vis-bug' || tag.startsWith('eye-')) return true
  if (el.closest?.('vis-bug')) return true
  return false
}

function getDirectText(el) {
  let text = ''
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? ''
  }
  text = text.trim()
  if (!text || text.length > 150) return null
  return text
}

function captureSnapshot(rootEl, getSelector) {
  if (!rootEl || typeof getSelector !== 'function') return []

  const elements = [rootEl, ...rootEl.querySelectorAll('*')]
  const entries = []

  for (const el of elements) {
    if (entries.length >= MAX_ELEMENTS) break
    if (shouldSkipElement(el)) continue

    entries.push({
      selector: getSelector(el),
      tag: el.tagName.toLowerCase(),
      styles: captureElementStyles(el),
      className: el.getAttribute('class') ?? '',
      text: getDirectText(el),
    })
  }

  return entries
}

function diffSnapshots(beforeEntries, afterEntries, { url, timestamp = Date.now() } = {}) {
  const beforeMap = new Map(beforeEntries.map(e => [e.selector, e]))
  const changes = []

  for (const after of afterEntries) {
    const before = beforeMap.get(after.selector)
    if (!before) continue

    const props = new Set([...Object.keys(before.styles), ...Object.keys(after.styles)])
    for (const property of props) {
      const oldValue = before.styles[property] ?? null
      const newValue = after.styles[property] ?? null
      if (oldValue === newValue) continue

      changes.push({
        type: 'style',
        selector: after.selector,
        property,
        oldValue,
        newValue,
        tag: after.tag,
        url,
        timestamp,
        applied: false,
      })
    }

    if (before.className !== after.className) {
      changes.push({
        type: 'attribute',
        selector: after.selector,
        attribute: 'class',
        oldValue: before.className,
        newValue: after.className,
        tag: after.tag,
        url,
        timestamp,
        applied: false,
      })
    }

    if (before.text !== after.text && before.text !== null && after.text !== null && before.text !== after.text) {
      changes.push({
        type: 'text',
        selector: after.selector,
        oldValue: before.text,
        newValue: after.text,
        tag: after.tag,
        url,
        timestamp,
        applied: false,
      })
    }
  }

  return changes
}

function getDefaultSnapshotRoot(documentRef = globalThis.document) {
  return (
    documentRef.querySelector('#homepage-root')
    || documentRef.querySelector('main')
    || documentRef.body
  )
}

globalThis.VisbugMcpSnapshot = { parseInlineStyle, captureSnapshot, diffSnapshots, getDefaultSnapshotRoot }

} // VisbugMcpSnapshot
