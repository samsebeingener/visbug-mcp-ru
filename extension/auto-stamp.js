/**
 * visbug-mcp — auto-stamp.js
 * v0.26: элемент без стабильного id, получивший записанную мутацию,
 * автоматически получает data-visbug-id="vb-<tag>-<NN>" (recorder-only).
 * Атрибут вне attributeFilter обсервера — петли мутаций нет.
 */
;(function attachAutoStamp() {
  const STAMP_ATTR = 'data-visbug-id'
  const STABLE_ATTRS = ['data-vb', 'data-vb-source', 'data-visbug-src', 'data-visbug-source', STAMP_ATTR]

  /** @type {Map<string, number>} tag → последний номер */
  const counters = new Map()
  /** @type {{ id: string, tag: string, originalSelector: string }[]} */
  const pendingStamps = []
  /** @type {WeakSet<Element>} элементы, проштампованные в этой сессии */
  const stampedThisSession = new WeakSet()

  function hasDataVbPrefixedAttr(el) {
    try {
      const attrs = el.attributes ? Array.from(el.attributes) : []
      return attrs.some((a) => a.name.startsWith('data-vb'))
    } catch {
      return false
    }
  }

  /** Есть ли у элемента собственный стабильный якорь (id / data-vb*). */
  function hasStableId(el) {
    if (!el) return false
    if (el.id) return true
    for (const attr of STABLE_ATTRS) {
      try {
        if (el.hasAttribute?.(attr) ?? el.getAttribute?.(attr) != null) return true
      } catch {}
    }
    return hasDataVbPrefixedAttr(el)
  }

  function nextId(tag) {
    const n = (counters.get(tag) ?? 0) + 1
    counters.set(tag, n)
    return `vb-${tag}-${String(n).padStart(2, '0')}`
  }

  /**
   * Проштамповать элемент, записавший мутацию, если у него нет стабильного id.
   * @param {Element | null} el
   * @param {(el: Element) => string} selectorFn — селектор/путь на момент штампа
   * @returns {string | null} id штампа (новый или ранее выданный в сессии)
   */
  function ensureStamped(el, selectorFn) {
    if (!el || el.nodeType !== 1) return null
    const tag = String(el.tagName ?? '').toLowerCase()
    if (!tag) return null

    if (stampedThisSession.has(el)) {
      return el.getAttribute(STAMP_ATTR) ?? null
    }
    if (hasStableId(el)) return null

    const id = nextId(tag)
    try {
      el.setAttribute(STAMP_ATTR, id)
    } catch {
      return null
    }
    stampedThisSession.add(el)
    const originalSelector = (() => {
      try {
        return selectorFn ? selectorFn(el) : tag
      } catch {
        return tag
      }
    })()
    pendingStamps.push({ id, tag, originalSelector })
    return id
  }

  /** id штампа, если элемент был проштампован в этой сессии. */
  function stampIdOf(el) {
    if (!el || !stampedThisSession.has(el)) return null
    try {
      return el.getAttribute(STAMP_ATTR) ?? null
    } catch {
      return null
    }
  }

  /** Забрать накопленные штампы (и очистить очередь) для flush. */
  function consumeStamps() {
    if (!pendingStamps.length) return []
    return pendingStamps.splice(0, pendingStamps.length)
  }

  function reset() {
    counters.clear()
    pendingStamps.length = 0
  }

  globalThis.VisbugMcpAutoStamp = {
    STAMP_ATTR,
    hasStableId,
    ensureStamped,
    stampIdOf,
    consumeStamps,
    reset,
  }
})()
