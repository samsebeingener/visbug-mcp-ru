/**
 * Dev-only: data-visbug-src из React _debugSource — без правок проекта пользователя.
 * Работает на localhost при npm run dev (Next/React включают source в development).
 */

const BRIDGE_VERSION = '0.1.0'

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

function annotateElement(el, stats) {
  if (!el?.getAttribute || el.hasAttribute('data-visbug-src')) return
  const fiberKey = getFiberKey(el)
  if (!fiberKey) return
  const source = getDebugSourceFromFiber(el[fiberKey])
  if (!source) return
  const value = toVisbugSrc(source)
  el.setAttribute('data-visbug-src', value)
  stats.annotated++
}

/**
 * Проставляет data-visbug-src на DOM перед snapshot — только localhost dev.
 * @param {Element|null} root
 */
function annotateRecordingRoot(root) {
  const stats = { annotated: 0, skipped: 0 }
  if (!root || root.nodeType !== Node.ELEMENT_NODE) return stats

  annotateElement(root, stats)
  for (const el of root.querySelectorAll('*')) {
    annotateElement(el, stats)
  }

  return stats
}

globalThis.VisbugMcpReactSourceBridge = {
  version: BRIDGE_VERSION,
  annotateRecordingRoot,
  getDebugSourceFromFiber,
  toVisbugSrc,
}

} // VisbugMcpReactSourceBridge version
