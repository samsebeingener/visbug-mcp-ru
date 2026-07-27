/**
 * Figma-like alignment guides during recording.
 * Idle: только лёгкая колоночная сетка.
 * Drag: короткие линии между перетаскиваемым и целевым элементом + подпись.
 */

const ALIGNMENT_GUIDES_VERSION = '0.6.1'

if (globalThis.VisbugMcpAlignmentGuides?.version !== ALIGNMENT_GUIDES_VERSION) {
  globalThis.VisbugMcpAlignmentGuides?.stop?.()
  const SNAP_THRESHOLD_PX = 4
  const PROXIMITY_PX = 96
  const GRID_COLUMNS = 12
  const COLOR_GRID = 'rgba(148, 163, 184, 0.14)'
  const COLOR_NEAR = 'rgba(239, 68, 68, 0.45)'
  const COLOR_ACTIVE = '#ef4444'
  const Z_INDEX = 2147483645

  const LAYOUT_SELECTORS = [
    'section[id]',
    'section',
    'article.service-cell',
    'article',
    'h1',
    'h2',
    'h3',
    '.hero-visual',
    '.services-matrix',
    '.site-container',
    '.hero-copy',
    '.monochrom-content-section__inner',
  ].join(',')

  function shouldSkipElement(el) {
    const tag = el.tagName?.toLowerCase()
    if (!tag || tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'svg') return true
    if (tag.startsWith('vis-') || tag === 'vis-bug' || tag.startsWith('eye-')) return true
    if (el.closest?.('vis-bug, #visbug-mcp-guides-root')) return true
    if (el.id === 'visbug-mcp-guides-root') return true
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

    for (const el of root.querySelectorAll(LAYOUT_SELECTORS)) {
      if (!(el instanceof HTMLElement) || el === exclude || seen.has(el)) continue
      if (shouldSkipElement(el)) continue
      const r = el.getBoundingClientRect()
      if (r.width < 16 || r.height < 10) continue
      if (r.bottom < 0 || r.top > window.innerHeight) continue
      seen.add(el)
      out.push(el)
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

  function findAlignmentMatches(dragEl, dragRect, candidates) {
    const matches = []
    const seenKeys = new Set()

    for (const other of candidates) {
      const otherRect = other.getBoundingClientRect()

      for (const axis of ['x', 'y']) {
        const dragEdges = buildEdges(dragRect, axis)
        const otherEdges = buildEdges(otherRect, axis)

        for (const de of dragEdges) {
          for (const oe of otherEdges) {
            const dist = Math.abs(de.value - oe.value)
            if (dist > PROXIMITY_PX) continue

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

    onScroll: null,
    onResize: null,

    _clearCandidates() {
      this.candidates = []
    },

    createOverlay() {
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

    getCandidates() {
      if (!this.candidates.length) {
        this.candidates = collectLayoutElements(this.root, this.draggedEl)
      }
      return this.candidates
    },

    drawColumnGrid(h) {
      const containers = this.root.querySelectorAll('.site-container')
      const seen = new Set()

      for (const container of containers) {
        if (shouldSkipElement(container)) continue
        const r = container.getBoundingClientRect()
        if (r.width < 120 || r.bottom < 0 || r.top > h) continue

        const key = `${Math.round(r.left)}:${Math.round(r.width)}`
        if (seen.has(key)) continue
        seen.add(key)

        const colW = r.width / GRID_COLUMNS
        const y1 = Math.max(0, r.top)
        const y2 = Math.min(h, r.bottom)

        for (let i = 0; i <= GRID_COLUMNS; i++) {
          const x = r.left + colW * i
          this.svg.appendChild(svgEl('line', {
            x1: x,
            x2: x,
            y1,
            y2,
            stroke: COLOR_GRID,
            'stroke-width': 1,
          }))
        }
      }
    },

    drawMatchLabel(text, x, y, { variant = 'active', anchor = 'start' } = {}) {
      const charW = 6
      const pad = 5
      const badgeW = text.length * charW + pad * 2
      const badgeH = 18
      let rectX = x
      if (anchor === 'middle') rectX = x - badgeW / 2

      const badgeFill = variant === 'active'
        ? 'rgba(220, 38, 38, 0.94)'
        : 'rgba(15, 23, 42, 0.92)'

      this.svg.appendChild(svgEl('rect', {
        x: rectX,
        y: y - badgeH / 2,
        width: badgeW,
        height: badgeH,
        fill: badgeFill,
        stroke: variant === 'active' ? '#fecaca' : 'rgba(248, 250, 252, 0.35)',
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
      const { axis, position, snapped, distance, dragRect, otherRect, label, dragKind, refKind } = match
      const stroke = snapped ? COLOR_ACTIVE : COLOR_NEAR
      const width = snapped ? 1 : 0.75
      const dash = snapped ? 'none' : '5 4'
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
          const text = `${label} · ${edgeLabel(refKind)} · ${gapLabel}`
          this.drawMatchLabel(text, position + 6, midY, { variant: 'active' })
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
          const text = `${label} · ${edgeLabel(refKind)} · ${gapLabel}`
          this.drawMatchLabel(text, midX, position - 10, { variant: 'active', anchor: 'middle' })
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

      const h = window.innerHeight
      this.svg.innerHTML = ''
      this.drawnNearLabelKeys = new Set()

      this.drawColumnGrid(h)

      if (!this.draggedEl?.isConnected) {
        this.dragIdleFrames += 1
        if (this.dragIdleFrames > 30) {
          this.draggedEl = null
          this.candidates = []
        }
        return
      }

      this.dragIdleFrames = 0
      const dragRect = this.draggedEl.getBoundingClientRect()
      this.drawDragOutline(dragRect)

      const matches = findAlignmentMatches(
        this.draggedEl,
        dragRect,
        this.getCandidates(),
      )

      for (const match of matches) {
        this.drawMatch(match)
      }
    },

    tick() {
      this.render()
      this.rafId = requestAnimationFrame(() => this.tick())
    },

    start(root) {
      this.stop()
      if (!root) return

      this.root = root
      this.createOverlay()

      this.observer = new MutationObserver((records) => {
        for (const record of records) {
          if (record.type !== 'attributes' || record.attributeName !== 'style') continue
          const el = record.target
          if (!(el instanceof HTMLElement) || shouldSkipElement(el)) continue
          const style = el.style
          if (style.position || style.left || style.top || style.transform) {
            if (this.draggedEl !== el) this.candidates = []
            this.draggedEl = el
            this.dragIdleFrames = 0
          }
        }
      })

      this.observer.observe(root, {
        attributes: true,
        attributeFilter: ['style'],
        subtree: true,
      })

      this.onScroll = () => this._clearCandidates()
      this.onResize = () => this._clearCandidates()

      window.addEventListener('scroll', this.onScroll, { passive: true, capture: true })
      window.addEventListener('resize', this.onResize, { passive: true })
      this.tick()
    },

    stop() {
      cancelAnimationFrame(this.rafId)
      this.rafId = 0
      this.observer?.disconnect()
      this.observer = null
      window.removeEventListener('scroll', this.onScroll, { capture: true })
      window.removeEventListener('resize', this.onResize)
      this.onScroll = null
      this.onResize = null
      this.host?.remove()
      this.host = null
      this.svg = null
      this.root = null
      this.draggedEl = null
      this.candidates = []
    },
  }

  globalThis.VisbugMcpAlignmentGuides = {
    version: ALIGNMENT_GUIDES_VERSION,
    start: (root) => guides.start(root),
    stop: () => guides.stop(),
  }
}
