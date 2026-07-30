/**
 * react-source-bridge.js — dev-only: source resolve → data-visbug-src
 * Приоритет: data-vb-source (и алиасы data-visbug-src/data-vb) > React Fiber _debugSource.
 * Расхождение атрибут ↔ fiber → confidence "ambiguous" (manual_review downstream).
 * Code Connect lite (zero-config). Не требует правок next.config.
 */

if (!globalThis.__visbugMcpReactBridgeLoaded) {
  globalThis.__visbugMcpReactBridgeLoaded = true

  const BRIDGE_VERSION = '0.3.0'
  const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'svg', 'path', 'head', 'meta', 'link'])
  /** Приоритет атрибутов источника: data-vb-source > data-visbug-src > data-vb */
  const SOURCE_ATTRS = ['data-vb-source', 'data-visbug-src', 'data-vb']

  /** @type {MutationObserver | null} */
  let mo = null
  let stampScheduled = false

  function shouldSkipElement(el) {
    const tag = el.tagName?.toLowerCase()
    if (!tag || SKIP_TAGS.has(tag)) return true
    if (tag.startsWith('vis-') || tag === 'vis-bug' || tag.startsWith('eye-')) return true
    if (el.closest?.('vis-bug, #visbug-mcp-guides-root, #visbug-mcp-recording-badge, #visbug-mcp-apply-toast')) {
      return true
    }
    return false
  }

  function findFiber(el) {
    if (!el || typeof el !== 'object') return null
    const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'))
    return key ? el[key] : null
  }

  function readDebugSource(fiber) {
    let node = fiber
    while (node) {
      const source = node._debugSource
        || node._debugInfo?.source
        || node._debugOwner?._debugSource
      if (source?.fileName) {
        return {
          fileName: source.fileName,
          lineNumber: source.lineNumber ?? 1,
          columnNumber: source.columnNumber ?? 0,
        }
      }
      node = node.return
    }
    return null
  }

  function relativizePath(absPath) {
    const normalized = String(absPath).replace(/\\/g, '/')
    const markers = ['/src/', '/app/', '/components/', '/pages/']
    for (const marker of markers) {
      const idx = normalized.indexOf(marker)
      if (idx >= 0) return normalized.slice(idx + 1)
    }
    const parts = normalized.split('/')
    const srcIdx = parts.lastIndexOf('src')
    if (srcIdx >= 0 && srcIdx < parts.length - 1) {
      return parts.slice(srcIdx).join('/')
    }
    return parts.slice(-3).join('/')
  }

  /** Разобрать "file:line[:col]" → { file, line } для сравнения источников. */
  function parseSourceValue(value) {
    const m = String(value ?? '').replace(/\\/g, '/').match(/^(.*?):(\d+)(?::(\d+))?$/)
    if (!m) return null
    return { file: m[1], line: Number(m[2]) }
  }

  function sameFileLine(a, b) {
    const pa = parseSourceValue(a)
    const pb = parseSourceValue(b)
    if (!pa || !pb) return false
    return pa.file === pb.file && pa.line === pb.line
  }

  /** Атрибут источника на самом узле или ближайшем предке (walk up DOM). */
  function readSourceAttribute(el) {
    for (const attr of SOURCE_ATTRS) {
      const own = el.getAttribute?.(attr)
      if (own) return { value: own, attr }
    }
    for (const attr of SOURCE_ATTRS) {
      const host = el.closest?.(`[${attr}]`)
      if (host) return { value: host.getAttribute(attr), attr }
    }
    return null
  }

  /**
   * Resolve источника узла: data-vb-source (и алиасы) важнее React Fiber.
   * Расхождение атрибут ↔ fiber → ambiguous (manual_review на стороне recorder).
   * @param {Element} el
   * @returns {{ value: string, confidence: 'exact' | 'ambiguous', ambiguous: boolean, origin: string } | null}
   */
  function resolveSource(el) {
    const attrSrc = readSourceAttribute(el)
    const fiber = findFiber(el)
    const fiberSrc = fiber ? readDebugSource(fiber) : null
    const fiberValue = fiberSrc?.fileName
      ? `${relativizePath(fiberSrc.fileName)}:${fiberSrc.lineNumber}:${fiberSrc.columnNumber}`
      : null

    if (attrSrc?.value) {
      const ambiguous = Boolean(fiberValue) && !sameFileLine(attrSrc.value, fiberValue)
      return {
        value: attrSrc.value,
        confidence: ambiguous ? 'ambiguous' : 'exact',
        ambiguous,
        origin: attrSrc.attr,
      }
    }
    if (fiberValue) {
      return { value: fiberValue, confidence: 'exact', ambiguous: false, origin: 'fiber' }
    }
    return null
  }

  function stampElement(el) {
    if (!(el instanceof HTMLElement) || shouldSkipElement(el)) return false

    const resolved = resolveSource(el)
    if (!resolved) return false

    const prev = el.getAttribute('data-visbug-src')
    // Нормализуем в data-visbug-src для downstream (snapshot/readVisbugSrc)
    if (prev !== resolved.value) el.setAttribute('data-visbug-src', resolved.value)
    el.setAttribute('data-visbug-source-confidence', resolved.confidence)
    if (resolved.ambiguous) {
      el.setAttribute('data-vb-ambiguity', 'attribute-vs-fiber')
    } else {
      el.removeAttribute?.('data-vb-ambiguity')
    }
    return prev !== resolved.value
  }

  /**
   * Stamp узел и предков (для layout-delta commit).
   * @param {Element | null | undefined} el
   * @returns {string | null} data-visbug-src на el или ближайшем предке
   */
  function ensureStamped(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return null
    let node = el
    while (node && node !== document.documentElement) {
      if (node instanceof HTMLElement) stampElement(node)
      node = node.parentElement
    }
    const attrHit = readSourceAttribute(el)
    if (attrHit?.value) return attrHit.value
    return el.getAttribute?.('data-visbug-src')
      || el.closest?.('[data-visbug-src]')?.getAttribute('data-visbug-src')
      || null
  }

  function stampAll(root = document.body) {
    if (!root) return { stamped: 0, scanned: 0 }
    const elements = [root, ...root.querySelectorAll('*')]
    let stamped = 0
    for (const el of elements) {
      if (stampElement(el)) stamped += 1
    }
    return { stamped, scanned: elements.length }
  }

  function scheduleStampAll() {
    if (stampScheduled) return
    stampScheduled = true
    requestAnimationFrame(() => {
      stampScheduled = false
      stampAll(document.body)
    })
  }

  function startObserver() {
    if (mo || typeof MutationObserver === 'undefined') return
    mo = new MutationObserver((records) => {
      let needsFull = false
      for (const r of records) {
        if (r.type === 'childList' && r.addedNodes?.length) {
          for (const n of r.addedNodes) {
            if (n.nodeType !== Node.ELEMENT_NODE) continue
            stampElement(n)
            if (n.querySelectorAll) {
              for (const child of n.querySelectorAll('*')) stampElement(child)
            }
          }
        }
        // Fiber часто появляется после первой отрисовки без новых childList
        if (r.type === 'attributes' && r.attributeName === 'class') needsFull = true
      }
      if (needsFull) scheduleStampAll()
    })
    mo.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class'],
    })
  }

  function stopObserver() {
    mo?.disconnect()
    mo = null
  }

  // Late Fiber: повторный stamp после load / idle
  if (document.readyState === 'complete') {
    setTimeout(() => stampAll(document.body), 0)
  } else {
    window.addEventListener('load', () => {
      setTimeout(() => stampAll(document.body), 50)
      setTimeout(() => stampAll(document.body), 500)
    })
  }
  startObserver()

  globalThis.VisbugMcpReactBridge = {
    version: BRIDGE_VERSION,
    SOURCE_ATTRS,
    stampElement,
    stampAll,
    ensureStamped,
    resolveSource,
    readSourceAttribute,
    relativizePath,
    startObserver,
    stopObserver,
  }
}
