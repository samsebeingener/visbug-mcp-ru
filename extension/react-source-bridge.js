/**
 * Dev-only: data-visbug-src из React _debugSource — без правок проекта пользователя.
 * Работает на localhost при npm run dev (Next/React включают source в development).
 */

const BRIDGE_VERSION = '0.2.0'

if (globalThis.VisbugMcpReactSourceBridge?.version !== BRIDGE_VERSION) {

function getFiberKey(el) {
  if (!el || typeof el !== 'object') return null
  return Object.keys(el).find(
    (key) => key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$'),
  ) ?? null
}

function getDebugSourceFromFiber(fiber) {
  let node = fiber
  while (node) {
    const source = node._debugSource
      || node._debugOwner?._debugSource
      || node.elementType?.__source
      || node.type?.__source
    if (source?.fileName) return source
    node = node.return
  }
  return null
}

function toVisbugSrc(source) {
  const fileName = String(source.fileName || '').replace(/\\/g, '/')
  const line = source.lineNumber ?? source.line ?? 1
  const column = source.columnNumber ?? source.column ?? 1
  const srcIdx = fileName.indexOf('/src/')
  const rel = srcIdx >= 0
    ? fileName.slice(srcIdx + 1)
    : fileName.split('/').slice(-4).join('/')
  return `${rel}:${line}:${column}`
}

function annotateSubtree(el, inheritedSrc, stats) {
  if (!el?.getAttribute) return inheritedSrc

  let src = el.getAttribute('data-visbug-src')
  if (!src) {
    const fiberKey = getFiberKey(el)
    if (fiberKey) {
      const source = getDebugSourceFromFiber(el[fiberKey])
      if (source) {
        src = toVisbugSrc(source)
        el.setAttribute('data-visbug-src', src)
        stats.annotated++
      }
    }
  }

  if (!src && inheritedSrc) {
    el.setAttribute('data-visbug-src', inheritedSrc)
    stats.inherited++
    src = inheritedSrc
  }

  const passDown = src || inheritedSrc
  for (const child of el.children) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      annotateSubtree(child, passDown, stats)
    }
  }
  return passDown
}

function annotateElement(el, stats) {
  annotateSubtree(el, null, stats)
}

/**
 * Проставляет data-visbug-src на DOM перед snapshot — только localhost dev.
 * @param {Element|null} root
 */
function annotateRecordingRoot(root) {
  const stats = { annotated: 0, inherited: 0, skipped: 0 }
  if (!root || root.nodeType !== Node.ELEMENT_NODE) return stats

  annotateSubtree(root, null, stats)
  return stats
}

globalThis.VisbugMcpReactSourceBridge = {
  version: BRIDGE_VERSION,
  annotateRecordingRoot,
  getDebugSourceFromFiber,
  toVisbugSrc,
}

} // VisbugMcpReactSourceBridge version
