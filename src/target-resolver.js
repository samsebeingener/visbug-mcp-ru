/**
 * target-resolver.js — определение файла-цели для правки.
 */

/**
 * @param {object} change
 * @returns {string}
 */
export function resolveTargetFile(change) {
  const visbugSrc = change.visbugSrc ?? change.target?.visbugSrc
  if (visbugSrc) {
    const match = String(visbugSrc).match(/^(.*?):\d+:\d+$/)
    if (match?.[1]) return normalizePath(match[1])
  }

  const sourceRef = change.sourceRef ?? change.target?.sourceRef
  if (sourceRef?.file) return normalizePath(sourceRef.file)

  const url = change.url ?? ''
  if (/\.css(?:\?|$)/i.test(url)) {
    try {
      const u = new URL(url)
      const base = u.pathname.split('/').pop()
      if (base?.endsWith('.css')) return base
    } catch {}
  }

  if (/portfolio|tatiana|\.html(?:\?|$)/i.test(url)) {
    return 'index.html'
  }

  if (/localhost:\d+|127\.0\.0\.1:\d+/.test(url)) {
    return 'index.html'
  }

  return 'index.html'
}

function normalizePath(filePath) {
  return String(filePath).replace(/\\/g, '/').replace(/^\.\//, '')
}

/**
 * @param {string} visbugSrc
 * @returns {string | null}
 */
export function formatVisbugSrcFileHint(visbugSrc) {
  if (!visbugSrc) return null
  const match = String(visbugSrc).match(/^(.*?):\d+:\d+$/)
  if (!match?.[1]) return null
  return normalizePath(match[1])
}
