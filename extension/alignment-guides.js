/**
 * Figma-like alignment guides during recording.
 * Drag/resize: красные линии к соседям при сближении + px.
 * Overlay включается только на время drag/resize, не постоянно.
 */

const GUIDES_BUILD = 7

// Всегда переинициализируем модуль (reload расширения / F5) — иначе stop() без start().
globalThis.VisbugMcpAlignmentGuides?.stop?.()

;(function initAlignmentGuides() {
  const SNAP_THRESHOLD_PX = 4
  /** Красные линии к соседу — показывать заранее, не только в последние пиксели. */
  const PROXIMITY_PX = 120
  const PROXIMITY_SIBLING_PX = 200
  const COLOR_FRAME = 'rgba(148, 163, 184, 0.55)'
  const COLOR_FRAME_CENTER = 'rgba(148, 163, 184, 0.35)'
  const COLOR_NEAR = 'rgba(239, 68, 68, 0.82)'
  const COLOR_ACTIVE = '#ef4444'
  const Z_INDEX = 2147483645
  const MAX_NEAR_MATCHES = 16

  const LAYOUT_SELECTORS = [
    'section[id]',
    'section',
    'article.service-cell',
    'article',
    'h1',
    'h2',
    'h3',
    'h4',
    'p.chapter',
    '.chapter',
    '.hero-section',
    '.hero-shell',
    '.hero-grid',
    '.hero-text-inner',
    '.hero-visual',
    '.hero-copy',
    '.services-matrix',
    '.site-container',
    '.monochrom-content-section__inner',
    '.max-w-6xl',
    '.grid',
    '[class*="col-span-"]',
    '[class*="rounded-"]',
    '[class*="bg-parchment"]',
    '[class*="space-y-"]',
    '.p-6',
    '.p-8',
    'main > section > div',
    'blockquote',
    'figure',
    'aside',
  ].join(',')

  function shouldSkipElement(el) {
    const tag = el.tagName?.toLowerCase()
    if (!tag || tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'svg') return true
    if (tag.startsWith('vis-') || tag === 'vis-bug' || tag.startsWith('eye-')) return true
    if (el.closest?.('vis-bug, #visbug-mcp-guides-root, #visbug-mcp-recording-badge, #visbug-mcp-apply-toast')) {
      return true
    }
    if (
      el.id === 'visbug-mcp-guides-root'
      || el.id === 'visbug-mcp-recording-badge'
      || el.id === 'visbug-mcp-apply-toast'
    ) {
      return true
    }
    return false
  }

  function elementLabel(el) {
    const tag = el.tagName.toLowerCase()
    const id = el.id ? `#${el.id}` : ''
    const cls = el.classList?.length
      ? '.' + [...el.classList].slice(0, 2).map((c) => c.replace(/\s/g, '')).join('.')
      : ''
    const section = el.closest('section[id]')?.id
    const sectionPart = section && section !== el.id ? ` · #${section}` : ''
    return `${tag}${id || cls}${sectionPart}`.slice(0, 56)
  }

  function edgeLabel(kind) {
    const map = { left: 'левый', right: 'правый', center: 'центр', top: 'верх', bottom: 'низ' }
    return map[kind] ?? kind
  }

  function formatGapLabel(distance, snapped) {
    const px = Math.round(distance)
    return snapped ? `${px}px` : `~${px}px`
  }

  function collectLayoutElements(root, exclude) {
    const seen = new Set()
    const out = []

    const pushEl = (el) => {
      if (!(el instanceof HTMLElement) || el === exclude || seen.has(el)) return
      if (exclude && (el.contains(exclude) || exclude.contains(el))) return
      if (shouldSkipElement(el)) return
      const r = el.getBoundingClientRect()
      if (r.width < 16 || r.height < 10) return
      if (r.bottom < -40 || r.top > window.innerHeight + 40) return
      seen.add(el)
      out.push(el)
    }

    for (const el of root.querySelectorAll(LAYOUT_SELECTORS)) pushEl(el)

    // Соседние блоки в том же grid (карточка ↔ «Как мы работаем»)
    const grid = exclude?.closest?.('.grid, [class*="grid-cols"]')
    if (grid) {
      for (const el of grid.querySelectorAll('div, h1, h2, h3, h4, p, article, section, ul, ol')) {
        pushEl(el)
      }
    }

    return out
  }

  function buildEdges(rect, axis) {
    if (axis === 'x') {
      return [
        { kind: 'left', value: rect.left },
        { kind: 'right', value: rect.right },
        { kind: 'center', value: rect.left + rect.width / 2 },
      ]
    }
    return [
      { kind: 'top', value: rect.top },
      { kind: 'bottom', value: rect.bottom },
      { kind: 'center', value: rect.top + rect.height / 2 },
    ]
  }

  function collectFrameContainer(root) {
    const selectors = [
      '.max-w-6xl',
      '.site-container',
      '.monochrom-content-section__inner',
      '.hero-shell',
      'main',
    ]
    let best = null
    let bestW = 0
    for (const sel of selectors) {
      for (const el of (root?.querySelectorAll?.(sel) ?? [])) {
        if (!(el instanceof HTMLElement) || shouldSkipElement(el)) continue
        const r = el.getBoundingClientRect()
        if (r.width < 200 || r.height < 80) continue
        if (r.width > bestW) {
          bestW = r.width
          best = el
        }
      }
    }
    if (!best && root instanceof HTMLElement) best = root
    return best
  }

  function rectsOverlap(a, b, axis = 'y') {
    if (axis === 'y') {
      return a.bottom > b.top && a.top < b.bottom
    }
    return a.right > b.left && a.left < b.right
  }

  function collectGridSiblings(dragEl) {
    const grid = dragEl?.closest?.('.grid, [class*="grid-cols"]')
    if (!grid) return []
    const dragRect = dragEl.getBoundingClientRect()
    const out = []
    for (const el of grid.children) {
      if (!(el instanceof HTMLElement) || el === dragEl || shouldSkipElement(el)) continue
      const r = el.getBoundingClientRect()
      if (r.width < 16 || r.height < 10) continue
      if (!rectsOverlap(dragRect, r, 'y') && !rectsOverlap(dragRect, r, 'x')) continue
      out.push(el)
    }
    return out
  }

  function findAlignmentMatches(dragEl, dragRect, candidates) {
    const matches = []
    const seenKeys = new Set()

    for (const other of candidates) {
      const otherRect = other.getBoundingClientRect()
      const isSibling = dragEl.parentElement === other.parentElement
      const proximityLimit = isSibling ? PROXIMITY_SIBLING_PX : PROXIMITY_PX

      for (const axis of ['x', 'y']) {
        const dragEdges = buildEdges(dragRect, axis)
        const otherEdges = buildEdges(otherRect, axis)

        for (const de of dragEdges) {
          for (const oe of otherEdges) {
            const dist = Math.abs(de.value - oe.value)
            if (dist > proximityLimit) continue

            const key = `${axis}:${Math.round(oe.value)}:${other}`
            const snapped = dist <= SNAP_THRESHOLD_PX
            const existing = matches.find((m) => m.key === key)
            if (existing) {
              if (dist < existing.distance) {
                existing.distance = dist
                existing.dragKind = de.kind
              }
              if (snapped && !existing.snapped) {
                existing.snapped = true
                existing.dragKind = de.kind
              }
              continue
            }
            if (seenKeys.has(key)) continue
            seenKeys.add(key)

            matches.push({
              key,
              axis,
              position: oe.value,
              snapped,
              distance: dist,
              dragRect,
              otherRect,
              otherEl: other,
              label: elementLabel(other),
              dragKind: de.kind,
              refKind: oe.kind,
            })
          }
        }
      }
    }

    return matches
      .sort((a, b) => Number(b.snapped) - Number(a.snapped))
      .slice(0, 12)
  }

  function svgEl(name, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', name)
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v))
    return el
  }

  function buildAlignPayload(match, getSelector) {
    const refRect = match.otherRect
    const dragRect = match.dragRect
    return {
      mode: 'edge',
      edge: match.dragKind,
      axis: match.axis,
      distance: Math.round(match.distance),
      reference: {
        selector: getSelector(match.otherEl),
        tag: match.otherEl?.tagName?.toLowerCase?.() ?? '',
        edge: match.refKind,
        rect: {
          left: Math.round(refRect.left),
          top: Math.round(refRect.top),
          width: Math.round(refRect.width),
          height: Math.round(refRect.height),
        },
      },
      dragRect: {
        left: Math.round(dragRect.left),
        top: Math.round(dragRect.top),
        width: Math.round(dragRect.width),
        height: Math.round(dragRect.height),
      },
    }
  }

  function roundRect(rect) {
    return {
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    }
  }

  function readComputed(el, keys) {
    if (!el || !keys.length) return {}
    const cs = getComputedStyle(el)
    const out = {}
    for (const key of keys) {
      out[key] = cs[key] ?? ''
    }
    return out
  }

  const NEXT_WRAPPER_TAGS = new Set(['div', 'section'])

  function findNextWrapper(draggedEl, referenceEl, alignPayload) {
    if (!(draggedEl instanceof HTMLElement)) return null

    const draggedTag = draggedEl.tagName.toLowerCase()
    if (draggedTag === 'h1' && draggedEl.parentElement instanceof HTMLElement) {
      const parent = draggedEl.parentElement
      if (NEXT_WRAPPER_TAGS.has(parent.tagName.toLowerCase())) {
        return parent
      }
    }

    if (alignPayload?.axis !== 'y' || !(referenceEl instanceof HTMLElement)) return null

    const parent = referenceEl.parentElement
    if (!(parent instanceof HTMLElement)) return null

    let afterRef = false
    for (const child of parent.children) {
      if (child === referenceEl) {
        afterRef = true
        continue
      }
      if (!afterRef) continue
      if (!(child instanceof HTMLElement)) continue
      const childTag = child.tagName.toLowerCase()
      if (NEXT_WRAPPER_TAGS.has(childTag)) {
        return child
      }
    }
    return null
  }

  function buildLayoutIntent(draggedEl, getSelector, alignPayload, referenceEl) {
    if (!(draggedEl instanceof HTMLElement) || typeof getSelector !== 'function') return null

    const dragRectAfter = roundRect(draggedEl.getBoundingClientRect())
    let dragRectBefore
    if (alignPayload?.dragRect) {
      dragRectBefore = {
        left: alignPayload.dragRect.left,
        top: alignPayload.dragRect.top,
        width: alignPayload.dragRect.width ?? dragRectAfter.width,
        height: alignPayload.dragRect.height ?? dragRectAfter.height,
      }
    } else {
      dragRectBefore = { ...dragRectAfter }
    }

    const targetRect = { ...dragRectBefore }

    let parent = null
    const parentEl = draggedEl.parentElement
    if (parentEl instanceof HTMLElement) {
      parent = {
        selector: getSelector(parentEl),
        tag: parentEl.tagName.toLowerCase(),
        computed: readComputed(parentEl, [
          'display',
          'flexDirection',
          'gap',
          'alignItems',
          'justifyContent',
        ]),
      }
    }

    let prevSibling = null
    const prev = draggedEl.previousElementSibling
    if (prev instanceof HTMLElement) {
      prevSibling = {
        selector: getSelector(prev),
        tag: prev.tagName.toLowerCase(),
        rect: roundRect(prev.getBoundingClientRect()),
        computed: readComputed(prev, ['display', 'marginBottom']),
      }
    }

    const nextWrapperEl = findNextWrapper(draggedEl, referenceEl, alignPayload)
    let nextWrapper = null
    if (nextWrapperEl instanceof HTMLElement) {
      nextWrapper = {
        selector: getSelector(nextWrapperEl),
        tag: nextWrapperEl.tagName.toLowerCase(),
        rect: roundRect(nextWrapperEl.getBoundingClientRect()),
        computed: readComputed(nextWrapperEl, ['display', 'marginTop']),
        containsTarget: nextWrapperEl.contains(draggedEl),
      }
    }

    const align = alignPayload ? { ...alignPayload } : undefined

    return {
      version: 1,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1,
      },
      dragRectBefore,
      dragRectAfter,
      targetRect,
      ...(parent ? { parent } : {}),
      ...(prevSibling ? { prevSibling } : {}),
      ...(nextWrapper ? { nextWrapper } : {}),
      ...(align ? { align } : {}),
    }
  }

  function isAttachTarget(change) {
    if (change?.type === 'layout-delta') return true
    if (change?.type !== 'style') return false
    return change.property === 'left' || change.property === 'top'
  }

  function attachAlignToChanges(changes, alignRefs) {
    if (!Array.isArray(changes) || !Array.isArray(alignRefs)) return changes
    const map = new Map(alignRefs.map((entry) => [entry.draggedSelector, entry.align]))
    for (const change of changes) {
      if (!isAttachTarget(change)) continue
      const align = map.get(change.selector)
      if (align && !change.align) change.align = align
    }
    return changes
  }

  function attachLayoutIntentToChanges(changes, layoutIntents) {
    if (!Array.isArray(changes) || !Array.isArray(layoutIntents)) return changes
    const map = new Map(layoutIntents.map((entry) => [entry.draggedSelector, entry.layoutIntent]))
    for (const change of changes) {
      if (!isAttachTarget(change)) continue
      const layoutIntent = map.get(change.selector)
      if (layoutIntent && !change.layoutIntent) change.layoutIntent = layoutIntent
    }
    return changes
  }

  const guides = {
    root: null,
    host: null,
    svg: null,
    rafId: 0,
    draggedEl: null,
    dragIdleFrames: 0,
    candidates: [],
    observer: null,
    drawnNearLabelKeys: null,
    getSelector: null,
    alignBySelector: new Map(),
    layoutIntentBySelector: new Map(),

    onScroll: null,
    onResize: null,

    _clearCandidates() {
      this.candidates = []
    },

    createOverlay() {
      if (this.host) return
      const host = document.createElement('div')
      host.id = 'visbug-mcp-guides-root'
      host.setAttribute('data-visbug-mcp', 'guides')
      host.style.cssText = [
        'position: fixed',
        'inset: 0',
        'pointer-events: none',
        'z-index: ' + Z_INDEX,
        'overflow: hidden',
      ].join(';')

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('width', '100%')
      svg.setAttribute('height', '100%')
      svg.setAttribute('aria-hidden', 'true')
      svg.style.cssText = 'display:block;width:100%;height:100%;'

      host.appendChild(svg)
      document.documentElement.appendChild(host)
      this.host = host
      this.svg = svg
    },

    ensureVisible() {
      if (this.host) return
      this.createOverlay()
      if (!this.onScroll) {
        this.onScroll = () => this._clearCandidates()
        this.onResize = () => this._clearCandidates()
        window.addEventListener('scroll', this.onScroll, { passive: true, capture: true })
        window.addEventListener('resize', this.onResize, { passive: true })
      }
      if (!this.rafId) this.tick()
    },

    deactivateVisible() {
      cancelAnimationFrame(this.rafId)
      this.rafId = 0
      if (this.onScroll) {
        window.removeEventListener('scroll', this.onScroll, { capture: true })
        window.removeEventListener('resize', this.onResize)
        this.onScroll = null
        this.onResize = null
      }
      this.host?.remove()
      this.host = null
      this.svg = null
    },

    getCandidates() {
      if (!this.candidates.length) {
        const base = collectLayoutElements(this.root, this.draggedEl)
        const siblings = this.draggedEl ? collectGridSiblings(this.draggedEl) : []
        const seen = new Set(base)
        for (const el of siblings) {
          if (!seen.has(el)) {
            seen.add(el)
            base.push(el)
          }
        }
        this.candidates = base
      }
      return this.candidates
    },

    /** Fallback: VisBug иногда не триггерит MutationObserver во время drag. */
    findActiveDragElement() {
      if (!this.root) return null
      let best = null
      let bestScore = 0

      for (const el of this.root.querySelectorAll('[style]')) {
        if (!(el instanceof HTMLElement) || shouldSkipElement(el)) continue
        const s = el.style
        const hasMove = Boolean(s.left || s.top || s.transform || s.width || s.height)
        if (!hasMove) continue

        let score = 0
        if (s.cursor === 'move') score += 4
        if (s.position === 'relative' || s.position === 'absolute') score += 2
        if (s.left || s.top) score += 2
        if (s.transform) score += 1
        if (el.closest('.grid, [class*="grid-cols"]')) score += 1

        if (score > bestScore) {
          bestScore = score
          best = el
        }
      }
      return best
    },

    /**
     * Только рамка вёрстки: левый / центр / правый + верх / низ контейнера.
     * Без колоночного «леса».
     */
    drawFrameGuides() {
      const frame = collectFrameContainer(this.root)
      if (!frame) return
      const r = frame.getBoundingClientRect()
      if (r.width < 80) return

      const w = window.innerWidth
      const h = window.innerHeight
      const midX = r.left + r.width / 2
      const midY = r.top + r.height / 2

      const vLines = [
        { x: r.left, stroke: COLOR_FRAME, width: 1.25 },
        { x: midX, stroke: COLOR_FRAME_CENTER, width: 1, dash: '6 5' },
        { x: r.right, stroke: COLOR_FRAME, width: 1.25 },
      ]
      for (const line of vLines) {
        this.svg.appendChild(svgEl('line', {
          x1: line.x,
          x2: line.x,
          y1: 0,
          y2: h,
          stroke: line.stroke,
          'stroke-width': line.width,
          ...(line.dash ? { 'stroke-dasharray': line.dash } : {}),
        }))
      }

      const hLines = [
        { y: r.top, stroke: COLOR_FRAME, width: 1.25 },
        { y: midY, stroke: COLOR_FRAME_CENTER, width: 1, dash: '6 5' },
        { y: r.bottom, stroke: COLOR_FRAME, width: 1.25 },
      ]
      for (const line of hLines) {
        this.svg.appendChild(svgEl('line', {
          x1: 0,
          x2: w,
          y1: line.y,
          y2: line.y,
          stroke: line.stroke,
          'stroke-width': line.width,
          ...(line.dash ? { 'stroke-dasharray': line.dash } : {}),
        }))
      }
    },

    drawMatchLabel(text, x, y, { variant = 'active', anchor = 'start' } = {}) {
      const charW = 6
      const pad = 5
      const badgeW = text.length * charW + pad * 2
      const badgeH = 18
      let rectX = x
      if (anchor === 'middle') rectX = x - badgeW / 2

      const badgeFill = 'rgba(220, 38, 38, 0.94)'

      this.svg.appendChild(svgEl('rect', {
        x: rectX,
        y: y - badgeH / 2,
        width: badgeW,
        height: badgeH,
        fill: badgeFill,
        stroke: '#fecaca',
        'stroke-width': 0.75,
        rx: 4,
      }))
      const textAttrs = {
        x: anchor === 'middle' ? x : x + pad,
        y: y + 1,
        fill: '#ffffff',
        'font-size': 11,
        'font-weight': 600,
        'font-family': 'system-ui, -apple-system, sans-serif',
        'dominant-baseline': 'middle',
      }
      if (anchor === 'middle') textAttrs['text-anchor'] = 'middle'
      this.svg.appendChild(svgEl('text', textAttrs)).textContent = text
    },

    drawMatch(match) {
      const { axis, position, snapped, distance, dragRect, otherRect, dragKind } = match
      const stroke = snapped ? COLOR_ACTIVE : COLOR_NEAR
      const width = snapped ? 1.5 : 1.1
      const dash = snapped ? 'none' : '6 4'
      const gapLabel = formatGapLabel(distance, snapped)

      if (axis === 'x') {
        const y1 = Math.min(dragRect.top, otherRect.top) - 4
        const y2 = Math.max(dragRect.bottom, otherRect.bottom) + 4
        this.svg.appendChild(svgEl('line', {
          x1: position,
          x2: position,
          y1,
          y2,
          stroke,
          'stroke-width': width,
          'stroke-dasharray': dash,
        }))

        const midY = (Math.max(dragRect.top, otherRect.top) + Math.min(dragRect.bottom, otherRect.bottom)) / 2
        if (snapped) {
          this.drawMatchLabel(gapLabel, position + 6, midY, { variant: 'active' })
        } else if (!this.drawnNearLabelKeys?.has(`x:${Math.round(position)}`)) {
          this.drawnNearLabelKeys?.add(`x:${Math.round(position)}`)
          this.drawMatchLabel(gapLabel, position + 6, midY, { variant: 'near' })
        }
      } else {
        const x1 = Math.min(dragRect.left, otherRect.left) - 4
        const x2 = Math.max(dragRect.right, otherRect.right) + 4
        this.svg.appendChild(svgEl('line', {
          x1,
          x2,
          y1: position,
          y2: position,
          stroke,
          'stroke-width': width,
          'stroke-dasharray': dash,
        }))

        const midX = (Math.max(dragRect.left, otherRect.left) + Math.min(dragRect.right, otherRect.right)) / 2
        if (snapped) {
          this.drawMatchLabel(gapLabel, midX, position - 10, { variant: 'active', anchor: 'middle' })
        } else if (!this.drawnNearLabelKeys?.has(`y:${Math.round(position)}`)) {
          this.drawnNearLabelKeys?.add(`y:${Math.round(position)}`)
          this.drawMatchLabel(gapLabel, midX, position - 10, { variant: 'near', anchor: 'middle' })
        }
      }

      if (snapped) {
        const dotR = 2
        if (axis === 'x') {
          const y = dragRect.top + (dragRect.height * (dragKind === 'bottom' ? 1 : dragKind === 'center' ? 0.5 : 0))
          this.svg.appendChild(svgEl('circle', { cx: position, cy: y, r: dotR, fill: COLOR_ACTIVE }))
        } else {
          const x = dragRect.left + (dragRect.width * (dragKind === 'right' ? 1 : dragKind === 'center' ? 0.5 : 0))
          this.svg.appendChild(svgEl('circle', { cx: x, cy: position, r: dotR, fill: COLOR_ACTIVE }))
        }
      }
    },

    drawDragOutline(rect) {
      this.svg.appendChild(svgEl('rect', {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
        fill: 'none',
        stroke: COLOR_ACTIVE,
        'stroke-width': 0.75,
        'stroke-dasharray': '4 3',
        opacity: 0.65,
      }))
    },

    render() {
      if (!this.svg) return

      this.svg.innerHTML = ''
      this.drawnNearLabelKeys = new Set()

      if (!this.draggedEl?.isConnected) {
        const active = this.findActiveDragElement()
        if (active) {
          this.draggedEl = active
          this.dragIdleFrames = 0
          this.ensureVisible()
        } else {
          this.dragIdleFrames += 1
          if (this.dragIdleFrames > 45) {
            this.draggedEl = null
            this.candidates = []
            this.deactivateVisible()
          }
          return
        }
      }

      this.dragIdleFrames = 0
      const dragRect = this.draggedEl.getBoundingClientRect()

      // Рамка контейнера и красные линии — только пока элемент двигают
      this.drawFrameGuides()
      this.drawDragOutline(dragRect)

      const matches = findAlignmentMatches(
        this.draggedEl,
        dragRect,
        this.getCandidates(),
      )
        .sort((a, b) => {
          if (a.snapped !== b.snapped) return a.snapped ? -1 : 1
          return a.distance - b.distance
        })

      let nearCount = 0
      for (const match of matches) {
        if (!match.snapped) {
          nearCount += 1
          if (nearCount > MAX_NEAR_MATCHES) continue
        }
        this.drawMatch(match)
      }

      if (this.draggedEl && this.getSelector) {
        const snapped = matches.filter((m) => m.snapped)
        if (snapped.length) {
          const best = snapped.sort((a, b) => a.distance - b.distance)[0]
          const draggedSelector = this.getSelector(this.draggedEl)
          const align = buildAlignPayload(best, this.getSelector)
          this.alignBySelector.set(draggedSelector, align)
          const layoutIntent = buildLayoutIntent(
            this.draggedEl,
            this.getSelector,
            align,
            best.otherEl,
          )
          if (layoutIntent) {
            this.layoutIntentBySelector.set(draggedSelector, layoutIntent)
          }
        }
      }
    },

    tick() {
      this.render()
      this.rafId = requestAnimationFrame(() => this.tick())
    },

    start(root, getSelector) {
      this.stop()
      if (!root) return

      this.root = root
      this.getSelector = typeof getSelector === 'function' ? getSelector : null
      this.alignBySelector = new Map()
      this.layoutIntentBySelector = new Map()

      this.observer = new MutationObserver((records) => {
        for (const record of records) {
          if (record.type !== 'attributes' || record.attributeName !== 'style') continue
          const el = record.target
          if (!(el instanceof HTMLElement) || shouldSkipElement(el)) continue
          const style = el.style
          const moving = style.position || style.left || style.top || style.transform
            || style.right || style.bottom
          const resizing = style.height || style.width || style.minHeight || style.maxHeight
            || style.minWidth || style.maxWidth
          if (moving || resizing) {
            if (this.draggedEl !== el) this.candidates = []
            this.draggedEl = el
            this.dragIdleFrames = 0
            this.ensureVisible()
          }
        }
      })

      this.observer.observe(root, {
        attributes: true,
        attributeFilter: ['style'],
        subtree: true,
      })
    },

    stop() {
      this.deactivateVisible()
      this.observer?.disconnect()
      this.observer = null
      this.root = null
      this.draggedEl = null
      this.candidates = []
      this.getSelector = null
      this.alignBySelector = new Map()
      this.layoutIntentBySelector = new Map()
    },

    exportAlignReferences() {
      return [...this.alignBySelector.entries()].map(([draggedSelector, align]) => ({
        draggedSelector,
        align,
      }))
    },

    consumeAlignReferences() {
      const refs = this.exportAlignReferences()
      this.alignBySelector.clear()
      return refs
    },

    exportLayoutIntents() {
      return [...this.layoutIntentBySelector.entries()].map(([draggedSelector, layoutIntent]) => ({
        draggedSelector,
        layoutIntent,
      }))
    },

    consumeLayoutIntents() {
      const intents = this.exportLayoutIntents()
      this.layoutIntentBySelector.clear()
      return intents
    },
  }

  globalThis.VisbugMcpAlignmentGuides = {
    build: GUIDES_BUILD,
    version: '0.8.2',
    start: (root, getSelector) => guides.start(root, getSelector),
    stop: () => guides.stop(),
    consumeAlignReferences: () => guides.consumeAlignReferences(),
    attachAlignToChanges: (changes, alignRefs) => attachAlignToChanges(changes, alignRefs),
    consumeLayoutIntents: () => guides.consumeLayoutIntents(),
    attachLayoutIntentToChanges: (changes, layoutIntents) => attachLayoutIntentToChanges(changes, layoutIntents),
    captureLayoutContext: (draggedEl, getSelector, rectBefore) => {
      if (!(draggedEl instanceof HTMLElement) || typeof getSelector !== 'function') return null
      return buildLayoutIntent(
        draggedEl,
        getSelector,
        rectBefore ? { dragRect: rectBefore } : null,
        null,
      )
    },
  }
})()
