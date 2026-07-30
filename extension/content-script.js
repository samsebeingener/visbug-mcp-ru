/**
 * visbug-mcp — content-script.js (live mutations, модель mambari)
 */

if (globalThis.__visbugMcpContentScriptLoaded) {
  // уже загружен
} else {
  globalThis.__visbugMcpContentScriptLoaded = true

  const WS_URL = 'ws://127.0.0.1:4844'
  const RECONNECT_DELAY = 2000
  const VISBUG_ATTR = ['style', 'class', 'src', 'href', 'alt', 'title', 'contenteditable']
  const BRIDGE_OVERLAY_SELECTOR =
    '#visbug-mcp-guides-root, #visbug-mcp-recording-badge, #visbug-mcp-apply-toast, [data-visbug-mcp]'

  const snap = () => globalThis.VisbugMcpSnapshot
  const guides = () => globalThis.VisbugMcpAlignmentGuides
  const lever = () => globalThis.VisbugMcpLayoutLever
  const autoStamp = () => globalThis.VisbugMcpAutoStamp

  let socket = null
  let connected = false
  let guidesArmed = false
  let flushTimer = null

  /** Дебаунс-flush: клавиатурные сдвиги (стрелки VisBug) не дают pointerup. */
  function scheduleFlush() {
    if (flushTimer) clearTimeout(flushTimer)
    flushTimer = setTimeout(() => {
      flushTimer = null
      flushDragSessions()
    }, 600)
  }

  function armGuides() {
    if (guidesArmed) return
    const root = snap()?.getDefaultSnapshotRoot?.(document) ?? document.body
    globalThis.VisbugMcpReactBridge?.stampAll?.(root)
    guides()?.start?.(root, getSelector)
    guidesArmed = Boolean(guides())
  }

  function disarmGuides() {
    guides()?.stop?.()
    guidesArmed = false
  }

  function getSelector(el) {
    try {
      if (!el || el.nodeType !== Node.ELEMENT_NODE) return 'body'
      if (el === document.body || el === document.documentElement) return 'body'
      if (el.id) return `#${CSS.escape(el.id)}`

      const attrs = el.attributes ? Array.from(el.attributes) : []
      const vueAttr = attrs.find((a) => a.name.startsWith('data-v-'))
      if (vueAttr) {
        const tag = el.tagName.toLowerCase()
        const cls = el.classList?.length ? `.${[...el.classList].map(CSS.escape).join('.')}` : ''
        return `${tag}[${vueAttr.name}]${cls}`
      }

      const tag = el.tagName.toLowerCase()
      const parent = el.parentElement
      if (!parent || parent === document.documentElement) return tag
      const siblings = Array.from(parent?.children || []).filter((c) => c.tagName === el.tagName)
      const idx = siblings.indexOf(el) + 1
      const nthPart = siblings.length > 1 ? `:nth-of-type(${idx})` : ''
      const cls = el.classList?.length ? `.${[...el.classList].map(CSS.escape).join('.')}` : ''
      return `${getSelector(parent)} > ${tag}${cls}${nthPart}`
    } catch {
      return 'body'
    }
  }

  function connect() {
    socket = new WebSocket(WS_URL)

    socket.addEventListener('open', () => {
      connected = true
      armGuides()
      socket.send(JSON.stringify({ event: 'popup-start-editing', url: location.href }))
      console.log('[visbug-mcp] connected, guides armed')
    })

    socket.addEventListener('message', (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.event === 'clear-visbug-storage') {
          const removed = Object.keys(localStorage).filter((k) => /visbug|vis-bug/i.test(k))
          removed.forEach((k) => localStorage.removeItem(k))
        }
      } catch {}
    })

    socket.addEventListener('close', () => {
      connected = false
      disarmGuides()
      setTimeout(connect, RECONNECT_DELAY)
    })

    socket.addEventListener('error', () => {})
  }

  function send(payload) {
    if (connected && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload))
    }
  }

  /** Отправить мутации вместе с новыми auto-stamp штампами (v0.26). */
  function sendMutations(mutations) {
    const stamps = autoStamp()?.consumeStamps?.() ?? []
    send({ event: 'mutations', url: location.href, mutations, stamps })
  }

  /**
   * v0.26: проштамповать элемент, получивший записанную мутацию,
   * и прикрепить stampId к его мутациям.
   * @param {Element | null} el
   * @param {object[]} mutations
   */
  function stampMutationTarget(el, mutations) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE || !mutations.length) return
    if (isBridgeOverlayNode(el) || isVisBugDomNode(el)) return
    const stampId = autoStamp()?.ensureStamped?.(el, getSelector)
    if (!stampId) return
    mutations.forEach((m) => { m.stampId = stampId })
  }

  function parseCSSChanges(oldStyle, newStyle) {
    const parse = (s) => {
      const map = {}
      if (!s) return map
      s.split(';').forEach((decl) => {
        const [prop, ...rest] = decl.split(':')
        if (prop && rest.length) map[prop.trim()] = rest.join(':').trim()
      })
      return map
    }
    const oldMap = parse(oldStyle)
    const newMap = parse(newStyle)
    const allProps = new Set([...Object.keys(oldMap), ...Object.keys(newMap)])
    const changes = []
    allProps.forEach((prop) => {
      if (oldMap[prop] !== newMap[prop]) {
        changes.push({ property: prop, old: oldMap[prop] || null, new: newMap[prop] || null })
      }
    })
    return changes
  }

  function isVisBugDomNode(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false
    const tag = node.tagName?.toLowerCase() ?? ''
    if (tag === 'vis-bug' || tag.startsWith('vis-') || tag.startsWith('visbug') || tag.startsWith('eye-')) {
      return true
    }
    if (tag === 'script') {
      const src = node.getAttribute?.('src') ?? ''
      if (/^chrome-extension:\/\//i.test(src)) return true
    }
    return false
  }

  function isVisBugDomChildList(record) {
    if (record.type !== 'childList') return false
    const elements = [...record.addedNodes, ...record.removedNodes].filter(
      (n) => n.nodeType === Node.ELEMENT_NODE,
    )
    return elements.length > 0 && elements.every((n) => isVisBugDomNode(n))
  }

  function isBridgeOverlayNode(node) {
    if (!node) return false
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement
    if (!el?.closest) return false
    if (el.closest(BRIDGE_OVERLAY_SELECTOR) || el.closest('vis-bug')) return true
    const tag = (node.nodeType === Node.ELEMENT_NODE ? node : el)?.tagName?.toLowerCase()
    if (tag && ['svg', 'g', 'line', 'text', 'rect', 'circle', 'path'].includes(tag)) {
      return Boolean(el.closest('#visbug-mcp-guides-root'))
    }
    return false
  }

  function parseMutation(record) {
    if (isBridgeOverlayNode(record.target)) return []
    const el = record.target
    const selector = getSelector(el)
    const timestamp = Date.now()

    if (record.type === 'attributes') {
      const attr = record.attributeName
      if (attr === 'style') {
        const DRAG_NOISE = new Set([
          'cursor', 'user-select', 'transition', 'will-change',
          'position', 'left', 'top', 'right', 'bottom',
        ])
        return parseCSSChanges(record.oldValue, el.getAttribute(attr))
          .filter((c) => !DRAG_NOISE.has(c.property))
          .filter((c) => c.new !== 'undefined' && c.new !== 'null')
          .map((c) => ({
            type: 'style',
            selector,
            property: c.property,
            oldValue: c.old,
            newValue: c.new,
            tag: el.tagName.toLowerCase(),
            timestamp,
          }))
      }
      return [{
        type: 'attribute',
        selector,
        attribute: attr,
        oldValue: record.oldValue,
        newValue: el.getAttribute(attr),
        tag: el.tagName.toLowerCase(),
        timestamp,
      }]
    }

    if (record.type === 'characterData') {
      return [{
        type: 'text',
        selector: getSelector(el.parentElement),
        oldValue: record.oldValue,
        newValue: el.textContent,
        tag: el.parentElement?.tagName.toLowerCase(),
        timestamp,
      }]
    }

    if (record.type === 'childList') {
      const mutations = []
      const removedTexts = [...record.removedNodes].filter((n) => n.nodeType === Node.TEXT_NODE)
      const addedTexts = [...record.addedNodes].filter((n) => n.nodeType === Node.TEXT_NODE)
      if (removedTexts.length > 0 || addedTexts.length > 0) {
        const oldValue = removedTexts.map((n) => n.textContent).join('') || null
        const newValue = addedTexts.map((n) => n.textContent).join('')
          || (el.nodeType === Node.ELEMENT_NODE ? el.textContent : null)
        if (oldValue !== newValue) {
          mutations.push({
            type: 'text',
            selector,
            oldValue,
            newValue,
            tag: el.tagName?.toLowerCase(),
            timestamp,
          })
        }
      }
      record.addedNodes.forEach((node) => {
        if (node.nodeType !== Node.ELEMENT_NODE || isVisBugDomNode(node)) return
        mutations.push({
          type: 'node-added',
          selector: getSelector(node),
          parentSelector: selector,
          html: node.outerHTML?.slice(0, 300),
          tag: node.tagName.toLowerCase(),
          timestamp,
        })
      })
      record.removedNodes.forEach((node) => {
        if (node.nodeType !== Node.ELEMENT_NODE || isVisBugDomNode(node)) return
        mutations.push({
          type: 'node-removed',
          selector,
          parentSelector: selector,
          tag: node.tagName.toLowerCase(),
          timestamp,
        })
      })
      return mutations
    }

    return []
  }

  function isVisBugInternal(record) {
    if (isBridgeOverlayNode(record.target)) return true
    if (isVisBugDomChildList(record)) return true
    if (record.target?.nodeType === Node.ELEMENT_NODE && isVisBugDomNode(record.target)) return true
    const tag = record.target?.tagName?.toLowerCase()
    return tag?.startsWith('vis-') || tag?.startsWith('visbug') || tag?.startsWith('eye-') || tag === 'visbug'
  }

  const POSITION_PROPS = new Set([
    'top', 'left', 'right', 'bottom', 'transform', 'width', 'height',
  ])

  /** @type {Map<string, { el: Element, selector: string, rectBefore: DOMRectReadOnly, viewport: { width: number, height: number } }>} */
  const dragSessions = new Map()
  let commitScheduled = false

  function roundPx(value) {
    return Math.round(value)
  }

  const LAYOUT_DELTA_MAX_RATIO = 0.75

  function isSuspiciousLayoutDelta(deltaX, deltaY, viewport) {
    const lib = lever()
    if (lib?.isSuspiciousDelta) return lib.isSuspiciousDelta(deltaX, deltaY, viewport)
    const vw = viewport?.width ?? window.innerWidth
    const vh = viewport?.height ?? window.innerHeight
    const limit = Math.max(vw, vh) * LAYOUT_DELTA_MAX_RATIO
    return Math.abs(deltaX) > limit || Math.abs(deltaY) > limit
  }

  function captureParentLayout(el) {
    const parentEl = el?.parentElement
    if (!(parentEl instanceof HTMLElement)) return null
    const cs = getComputedStyle(parentEl)
    return {
      selector: getSelector(parentEl),
      display: cs.display,
      flexDirection: cs.flexDirection,
      justifyContent: cs.justifyContent,
      alignItems: cs.alignItems,
      gap: cs.gap,
      gridTemplateColumns: cs.gridTemplateColumns,
    }
  }

  function beginDragSession(el, selector) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE || isBridgeOverlayNode(el)) return
    if (dragSessions.has(selector)) return
    console.log('[visbug-mcp] drag-session begin', selector)
    const rect = el.getBoundingClientRect()
    const lib = lever()
    const offsetBefore = lib?.readOffsetFromComputedStyle
      ? lib.readOffsetFromComputedStyle(getComputedStyle(el))
      : null
    dragSessions.set(selector, {
      el,
      selector,
      rectBefore: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      },
      offsetBefore,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    })
  }

  function flushDragSessions() {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    if (dragSessions.size === 0 || commitScheduled) return
    console.log('[visbug-mcp] flush start, sessions ×' + dragSessions.size)
    commitScheduled = true
    const sessions = [...dragSessions.values()]
    dragSessions.clear()

    requestAnimationFrame(() => {
      commitScheduled = false
      const layoutMutations = []
      const timestamp = Date.now()

      for (const session of sessions) {
        const { el, selector, rectBefore, offsetBefore, viewport } = session
        if (!el?.isConnected) continue
        const rectAfter = el.getBoundingClientRect()
        const deltaX = roundPx(rectAfter.left - rectBefore.left)
        const deltaY = roundPx(rectAfter.top - rectBefore.top)
        const deltaW = roundPx(rectAfter.width - rectBefore.width)
        const deltaH = roundPx(rectAfter.height - rectBefore.height)
        if (deltaX === 0 && deltaY === 0 && deltaW === 0 && deltaH === 0) {
          console.log('[visbug-mcp] flush skip (delta 0)', selector)
          continue
        }
        const moved = deltaX !== 0 || deltaY !== 0
        const resized = deltaW !== 0 || deltaH !== 0
        const editIntent = moved ? (resized ? 'move+resize' : 'move') : 'resize'
        if (isSuspiciousLayoutDelta(deltaX, deltaY, viewport)) {
          console.log('[visbug-mcp] flush skip suspicious layout-delta', selector, deltaX, deltaY)
          continue
        }

        const rectBeforeRounded = {
          left: roundPx(rectBefore.left),
          top: roundPx(rectBefore.top),
          width: roundPx(rectBefore.width),
          height: roundPx(rectBefore.height),
        }
        const rectAfterRounded = {
          left: roundPx(rectAfter.left),
          top: roundPx(rectAfter.top),
          width: roundPx(rectAfter.width),
          height: roundPx(rectAfter.height),
        }

        const layoutContext = guides()?.captureLayoutContext?.(el, getSelector, rectBeforeRounded)
          ?? null
        const parentLayout = layoutContext?.parent ?? captureParentLayout(el)
        const lib = lever()
        const offsetAfter = lib?.readOffsetFromComputedStyle
          ? lib.readOffsetFromComputedStyle(getComputedStyle(el))
          : null
        const leverHint = lib?.suggestLever
          ? lib.suggestLever(parentLayout)
          : 'transform'

        // Code Connect lite: stamp Fiber → data-visbug-src before read
        globalThis.VisbugMcpReactBridge?.ensureStamped?.(el)
        const snapApi = snap()
        const visbugSrc = snapApi?.readVisbugSrc?.(el)
          ?? globalThis.VisbugMcpReactBridge?.ensureStamped?.(el)
          ?? null
        const stableId = snapApi?.readStableId?.(el) ?? null
        const sourceRef = snapApi?.readSourceRef?.(el) ?? null
        // v0.26: auto-stamp для узла без стабильного id
        const stampId = autoStamp()?.ensureStamped?.(el, getSelector) ?? null

        layoutMutations.push({
          type: 'layout-delta',
          selector,
          tag: el.tagName.toLowerCase(),
          deltaX,
          deltaY,
          deltaW,
          deltaH,
          editIntent,
          rectBefore: rectBeforeRounded,
          rectAfter: rectAfterRounded,
          offsetBefore,
          offsetAfter,
          lever: leverHint,
          parentLayout,
          layoutContext: layoutContext ?? undefined,
          viewport,
          visbugSrc,
          stableId,
          sourceRef,
          stampId,
          timestamp,
        })
      }

      if (layoutMutations.length > 0) {
        const alignRefs = guides()?.consumeAlignReferences?.() ?? []
        guides()?.attachAlignToChanges?.(layoutMutations, alignRefs)
        const layoutIntents = guides()?.consumeLayoutIntents?.() ?? []
        guides()?.attachLayoutIntentToChanges?.(layoutMutations, layoutIntents)
        console.log('[visbug-mcp] flush layout-delta ×' + layoutMutations.length, layoutMutations.map((m) => m.selector))
        sendMutations(layoutMutations)
      }
    })
  }

  window.addEventListener('pointerup', flushDragSessions, true)
  window.addEventListener('mouseup', flushDragSessions, true)

  const observer = new MutationObserver((records) => {
    const mutations = []
    records.forEach((record) => {
      if (isVisBugInternal(record)) return
      if (record.type === 'attributes' && !VISBUG_ATTR.includes(record.attributeName)) return

      if (record.type === 'attributes' && record.attributeName === 'style') {
        const el = record.target
        if (el?.nodeType === Node.ELEMENT_NODE) {
          const selector = getSelector(el)
          const styleChanges = parseCSSChanges(record.oldValue, el.getAttribute('style'))
          if (styleChanges.some((c) => POSITION_PROPS.has(c.property))) {
            beginDragSession(el, selector)
            scheduleFlush()
          }
        }
      }

      const parsed = parseMutation(record)
      if (parsed.length) {
        const targetEl = record.type === 'characterData' ? record.target?.parentElement : record.target
        stampMutationTarget(targetEl, parsed)
        mutations.push(...parsed)
      }
    })
    if (mutations.length === 0) return
    sendMutations(mutations)
  })

  observer.observe(document.documentElement, {
    attributes: true,
    attributeOldValue: true,
    characterData: true,
    characterDataOldValue: true,
    childList: true,
    subtree: true,
    attributeFilter: VISBUG_ATTR,
  })

  connect()
  document.documentElement.setAttribute('data-visbug-mcp-live', '1')
  console.log('[visbug-mcp] live observer on', location.href)
}
