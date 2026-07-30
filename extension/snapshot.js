/**
 * Snapshot до/после — diff DOM-состояния для режима «Запись».
 */

const SNAPSHOT_MODULE_VERSION = '0.6.0'

if (globalThis.VisbugMcpSnapshot?.version !== SNAPSHOT_MODULE_VERSION) {

const MAX_ELEMENTS = 1200
const MAX_TEXT_LENGTH = 4000

const TEXT_ELEMENT_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'span', 'a', 'li', 'label', 'button',
  'td', 'th', 'figcaption', 'blockquote',
  'dt', 'dd', 'caption', 'legend', 'summary',
  'small', 'strong', 'em', 'b', 'i', 'cite', 'q', 'mark', 'time', 'abbr',
])

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
  if (!tag || tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'svg') return true
  if (tag.startsWith('vis-') || tag === 'vis-bug' || tag.startsWith('eye-')) return true
  if (el.closest?.('vis-bug, #visbug-mcp-guides-root, #visbug-mcp-recording-badge')) return true
  return false
}

function normalizeText(text) {
  return (text || '').replace(/\s+/g, ' ').trim()
}

function hasNestedTextElement(el) {
  for (const child of el.children) {
    if (shouldSkipElement(child)) continue
    if (TEXT_ELEMENT_TAGS.has(child.tagName.toLowerCase())) {
      if (normalizeText(child.textContent)) return true
    }
    if (hasNestedTextElement(child)) return true
  }
  return false
}

function captureElementText(el) {
  if (shouldSkipElement(el)) return null

  const tag = el.tagName.toLowerCase()
  const isContentEditable = el.isContentEditable
    || el.getAttribute('contenteditable') === 'true'
    || el.getAttribute('contenteditable') === ''

  if (isContentEditable) {
    const text = normalizeText(el.innerText || el.textContent)
    if (!text || text.length > MAX_TEXT_LENGTH) return null
    return text
  }

  const isTextTag = TEXT_ELEMENT_TAGS.has(tag)
  const isLeafTextHost = el.children.length === 0

  if (!isTextTag && !isLeafTextHost) return null
  if (isTextTag && hasNestedTextElement(el)) return null

  const text = normalizeText(el.textContent)
  if (!text || text.length > MAX_TEXT_LENGTH) return null
  return text
}

function findTextOwnerElement(el) {
  let node = el
  while (node && node.nodeType === Node.ELEMENT_NODE) {
    if (shouldSkipElement(node)) return null
    const tag = node.tagName.toLowerCase()
    if (node.isContentEditable || node.getAttribute('contenteditable') != null) return node
    if (TEXT_ELEMENT_TAGS.has(tag)) return node
    node = node.parentElement
  }
  return null
}

function readVisbugSrc(el) {
  return el.getAttribute('data-visbug-src')
    || el.closest?.('[data-visbug-src]')?.getAttribute('data-visbug-src')
    || null
}

function readSourceRef(el) {
  const visbugSrc = el.getAttribute('data-visbug-src')
  const confidence = el.getAttribute('data-visbug-source-confidence') || 'none'
  const match = String(visbugSrc ?? '').match(/^(.*?):(\d+):(\d+)$/)
  if (!match || confidence !== 'exact') {
    return { v: 1, kind: 'react-debug-source', confidence: 'none' }
  }
  return {
    v: 1,
    kind: 'react-debug-source',
    file: match[1],
    line: Number(match[2]),
    column: Number(match[3]),
    origin: 'runtime-dev',
    confidence: 'exact',
  }
}

function readStableId(el) {
  return el.getAttribute('data-onlook-id')
    || el.getAttribute('data-visbug-id')
    || null
}

function captureRect(el) {
  const rect = el?.getBoundingClientRect?.()
  if (!rect) return null
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  }
}

function captureParentChain(el, maxDepth = 3) {
  const chain = []
  let node = el?.parentElement
  while (node && chain.length < maxDepth) {
    const style = globalThis.getComputedStyle?.(node)
    chain.push({
      tag: node.tagName?.toLowerCase() ?? '',
      classes: [...(node.classList ?? [])].slice(0, 12),
      display: style?.display ?? '',
      position: style?.position ?? '',
      gap: style?.gap ?? '',
    })
    node = node.parentElement
  }
  return chain
}

function captureDomContext(el) {
  const style = globalThis.getComputedStyle?.(el)
  return {
    rect: captureRect(el),
    computed: {
      display: style?.display ?? '',
      position: style?.position ?? '',
      marginTop: style?.marginTop ?? '',
      marginInlineStart: style?.marginInlineStart ?? '',
      transform: style?.transform ?? '',
      gap: style?.gap ?? '',
    },
    parentChain: captureParentChain(el),
  }
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
      text: captureElementText(el),
      visbugSrc: readVisbugSrc(el),
      sourceRef: readSourceRef(el),
      stableId: readStableId(el),
      domContext: captureDomContext(el),
    })
  }

  return entries
}

function dedupeNestedTextChanges(changes) {
  const text = changes.filter((c) => c.type === 'text')
  const rest = changes.filter((c) => c.type !== 'text')
  const kept = []

  for (const change of text.sort((a, b) => b.selector.length - a.selector.length)) {
    const hasMoreSpecific = kept.some(
      (k) => k.selector.startsWith(`${change.selector} >`) || k.selector.startsWith(`${change.selector}>`),
    )
    if (!hasMoreSpecific) kept.push(change)
  }

  return [...rest, ...kept]
}

function mergeTextChanges(snapshotChanges, watchedTextChanges) {
  const bySelector = new Map()

  for (const change of snapshotChanges) {
    if (change.type === 'text') bySelector.set(change.selector, change)
  }

  for (const change of watchedTextChanges) {
    bySelector.set(change.selector, change)
  }

  const nonText = snapshotChanges.filter((c) => c.type !== 'text')
  return dedupeNestedTextChanges([...nonText, ...bySelector.values()])
}

function diffSnapshots(beforeEntries, afterEntries, { url, timestamp = Date.now() } = {}) {
  const beforeMap = new Map(beforeEntries.map((e) => [e.selector, e]))
  const changes = []

  const isDecorativeNoise = (property, selector) => {
    if (property === '--start' || property === '--glow-mask') return true
    if (String(property).startsWith('--') && /editorial-card-glow|pointer-events-none/i.test(selector)) {
      return true
    }
    return false
  }

  for (const after of afterEntries) {
    const before = beforeMap.get(after.selector)
    if (!before) continue

    const props = new Set([...Object.keys(before.styles), ...Object.keys(after.styles)])
    for (const property of props) {
      const oldValue = before.styles[property] ?? null
      const newValue = after.styles[property] ?? null
      if (oldValue === newValue) continue
      if (isDecorativeNoise(property, after.selector)) continue

      changes.push({
        type: 'style',
        selector: after.selector,
        property,
        oldValue,
        newValue,
        tag: after.tag,
        visbugSrc: after.visbugSrc ?? null,
        sourceRef: after.sourceRef,
        userTarget: {
          selector: after.selector,
          tag: after.tag,
          label: `${after.tag}${after.className ? ` · ${after.className.split(/\s+/).slice(0, 2).join(' ')}` : ''}`,
          rect: after.domContext?.rect ?? null,
          stableId: after.stableId ?? null,
        },
        domContext: after.domContext ?? null,
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
        visbugSrc: after.visbugSrc ?? null,
        sourceRef: after.sourceRef,
        userTarget: {
          selector: after.selector,
          tag: after.tag,
          label: `${after.tag}${after.className ? ` · ${after.className.split(/\s+/).slice(0, 2).join(' ')}` : ''}`,
          rect: after.domContext?.rect ?? null,
          stableId: after.stableId ?? null,
        },
        domContext: after.domContext ?? null,
        url,
        timestamp,
        applied: false,
      })
    }

    if (before.text !== after.text) {
      const oldValue = before.text ?? null
      const newValue = after.text ?? null
      if (oldValue !== newValue) {
        changes.push({
          type: 'text',
          selector: after.selector,
          oldValue,
          newValue,
          tag: after.tag,
          visbugSrc: after.visbugSrc ?? null,
          sourceRef: after.sourceRef,
          userTarget: {
            selector: after.selector,
            tag: after.tag,
            label: `${after.tag}${after.className ? ` · ${after.className.split(/\s+/).slice(0, 2).join(' ')}` : ''}`,
            rect: after.domContext?.rect ?? null,
            stableId: after.stableId ?? null,
          },
          domContext: after.domContext ?? null,
          url,
          timestamp,
          applied: false,
        })
      }
    }
  }

  return dedupeNestedTextChanges(changes)
}

function getDefaultSnapshotRoot(documentRef = globalThis.document) {
  const doc = documentRef ?? globalThis.document
  const homepage = doc.querySelector('#homepage-root')
  if (homepage) return homepage

  const main = doc.querySelector('main')
  const header = doc.querySelector('header')
  // Статические лендинги: header/nav снаружи <main> — иначе resize шапки не попадает в diff.
  if (main && header && !main.contains(header)) {
    return doc.body
  }

  return main || doc.body
}

globalThis.VisbugMcpSnapshot = {
  version: SNAPSHOT_MODULE_VERSION,
  parseInlineStyle,
  captureSnapshot,
  diffSnapshots,
  mergeTextChanges,
  dedupeNestedTextChanges,
  captureElementText,
  normalizeText,
  findTextOwnerElement,
  readVisbugSrc,
  readSourceRef,
  readStableId,
  captureDomContext,
  getDefaultSnapshotRoot,
  TEXT_ELEMENT_TAGS,
}

} // VisbugMcpSnapshot version
