/**
 * Snapshot РґРѕ/РїРѕСЃР»Рµ вЂ” diff DOM-СЃРѕСЃС‚РѕСЏРЅРёСЏ РґР»СЏ СЂРµР¶РёРјР° В«Р—Р°РїРёСЃСЊВ».
 */

const MAX_ELEMENTS = 1200

const NOISE_SELECTORS = [
  /^#vibe-annotations-root/,
  /vue-devtools/,
  /^body\s*>\s*visbug/,
  /^body\s*>\s*vis-bug/,
  /^#в†‘/,
]

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

    const selector = getSelector(el)
    if (NOISE_SELECTORS.some(r => r.test(selector))) continue

    entries.push({
      selector,
      tag: el.tagName.toLowerCase(),
      styles: parseInlineStyle(el.getAttribute('style')),
      className: el.getAttribute('class') ?? '',
      text: getDirectText(el),
    })
  }

  return entries
}

function isNoiseStyleChange(change) {
  const prop = change.property ?? ''
  const oldV = change.oldValue ?? ''
  const newV = change.newValue ?? ''

  if (oldV === newV) return true

  if (prop === 'cursor' || prop === 'user-select') {
    if (!newV || newV === 'undefined') return true
  }
  if (prop === 'transition' && (!newV || newV === 'undefined' || (newV === 'none' && !oldV))) return true

  if (prop === 'position' && newV === 'relative' && !oldV) return true
  if ((prop === 'left' || prop === 'top' || prop === 'right' || prop === 'bottom') && !oldV) return true
  if (prop === 'width' && !oldV && /^\d+(\.\d+)?px$/.test(String(newV))) return true

  if (prop.startsWith('--hero-')) return true
  if (['--active', '--start', '--glow-mask'].includes(prop)) return true
  if ((change.selector ?? '').includes('scroll-progress')) return true
  if ((change.selector ?? '').includes('hero-dual-portrait')) return true
  if ((change.selector ?? '').includes('editorial-card-glow')) return true

  return false
}

function isNoiseChange(change) {
  if (NOISE_SELECTORS.some(r => r.test(change.selector ?? ''))) return true
  if (change.type === 'style' && isNoiseStyleChange(change)) return true
  if (change.type === 'attribute' && change.attribute === 'contenteditable') return true
  if (change.type === 'text') {
    if (!change.oldValue && (!change.newValue || change.newValue.length > 150)) return true
  }
  return false
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

  return changes.filter(c => !isNoiseChange(c))
}

function getDefaultSnapshotRoot(documentRef = globalThis.document) {
  return (
    documentRef.querySelector('#homepage-root')
    || documentRef.querySelector('main')
    || documentRef.body
  )
}

globalThis.VisbugMcpSnapshot = { parseInlineStyle, captureSnapshot, isNoiseStyleChange, diffSnapshots, getDefaultSnapshotRoot }

