/**
 * Figma-like alignment guides during recording.
 * Gray grid + edge lines; orange when dragged element aligns with another.
 */

if (!globalThis.VisbugMcpAlignmentGuides) {
  const SNAP_THRESHOLD_PX = 4
  const MAX_LINES_PER_AXIS = 72
  const GRID_COLUMNS = 12
  const COLOR_GRID = 'rgba(148, 163, 184, 0.22)'
  const COLOR_LINE = 'rgba(148, 163, 184, 0.42)'
  const COLOR_ACTIVE = '#f59e0b'
  const Z_INDEX = 2147483645

  function shouldSkipElement(el) {
    const tag = el.tagName?.toLowerCase()
    if (!tag || tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'svg') return true
    if (tag.startsWith('vis-') || tag === 'vis-bug' || tag.startsWith('eye-')) return true
    if (el.closest?.('vis-bug, #visbug-mcp-guides-root')) return true
    if (el.id === 'visbug-mcp-guides-root') return true
    return false
  }

  function dedupeSorted(values, tolerance = 2) {
    const sorted = [...values].map((v) => Math.round(v)).sort((a, b) => a - b)
    const out = []
    for (const v of sorted) {
      if (!out.length || Math.abs(out[out.length - 1] - v) > tolerance) out.push(v)
    }
    return out.slice(0, MAX_LINES_PER_AXIS)
  }

  function collectAlignableElements(root) {
    const out = []
    const walk = (el) => {
      if (!el || el.nodeType !== Node.ELEMENT_NODE) return
      if (shouldSkipElement(el)) {
        for (const child of el.children) walk(child)
        return
      }
      const r = el.getBoundingClientRect()
      if (r.width >= 12 && r.height >= 8 && r.bottom > 0 && r.top < window.innerHeight) {
        out.push(el)
      }
      if (out.length < 500) {
        for (const child of el.children) walk(child)
      }
    }
    walk(root)
    return out
  }

  function rectEdges(rect) {
    return {
      x: [rect.left, rect.right, rect.left + rect.width / 2],
      y: [rect.top, rect.bottom, rect.top + rect.height / 2],
    }
  }

  function findActiveLines(dragRect, xs, ys) {
    const activeX = new Set()
    const activeY = new Set()
    const drag = rectEdges(dragRect)

    for (const x of xs) {
      for (const dx of drag.x) {
        if (Math.abs(dx - x) <= SNAP_THRESHOLD_PX) activeX.add(x)
      }
    }
    for (const y of ys) {
      for (const dy of drag.y) {
        if (Math.abs(dy - y) <= SNAP_THRESHOLD_PX) activeY.add(y)
      }
    }

    return { activeX, activeY }
  }

  const guides = {
    root: null,
    host: null,
    svg: null,
    rafId: 0,
    draggedEl: null,
    dragIdleFrames: 0,
    edgeX: [],
    edgeY: [],
    observer: null,

    onScroll() {
      this.rebuildEdges()
    },

    onResize() {
      this.rebuildEdges()
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

    rebuildEdges() {
      if (!this.root?.isConnected) return

      const xs = []
      const ys = []

      for (const el of collectAlignableElements(this.root)) {
        if (el === this.draggedEl) continue
        const r = el.getBoundingClientRect()
        xs.push(r.left, r.right, r.left + r.width / 2)
        ys.push(r.top, r.bottom, r.top + r.height / 2)
      }

      this.edgeX = dedupeSorted(xs)
      this.edgeY = dedupeSorted(ys)
    },

    drawColumnGrid(w, h) {
      const containers = this.root.querySelectorAll('.site-container, [class*="site-container"]')
      const seen = new Set()

      for (const container of containers) {
        if (shouldSkipElement(container)) continue
        const r = container.getBoundingClientRect()
        if (r.width < 120 || r.bottom < 0 || r.top > h) continue

        const key = `${Math.round(r.left)}:${Math.round(r.width)}`
        if (seen.has(key)) continue
        seen.add(key)

        const colW = r.width / GRID_COLUMNS
        for (let i = 0; i <= GRID_COLUMNS; i++) {
          const x = r.left + colW * i
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
          line.setAttribute('x1', String(x))
          line.setAttribute('x2', String(x))
          line.setAttribute('y1', '0')
          line.setAttribute('y2', String(h))
          line.setAttribute('stroke', COLOR_GRID)
          line.setAttribute('stroke-width', '1')
          this.svg.appendChild(line)
        }
      }
    },

    render() {
      if (!this.svg) return

      const w = window.innerWidth
      const h = window.innerHeight
      this.svg.innerHTML = ''

      this.drawColumnGrid(w, h)

      let activeX = new Set()
      let activeY = new Set()

      if (this.draggedEl?.isConnected) {
        const dragRect = this.draggedEl.getBoundingClientRect()
        const active = findActiveLines(dragRect, this.edgeX, this.edgeY)
        activeX = active.activeX
        activeY = active.activeY
        this.dragIdleFrames = 0
      } else {
        this.dragIdleFrames += 1
        if (this.dragIdleFrames > 45) this.draggedEl = null
      }

      for (const x of this.edgeX) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
        const isActive = activeX.has(x)
        line.setAttribute('x1', String(x))
        line.setAttribute('x2', String(x))
        line.setAttribute('y1', '0')
        line.setAttribute('y2', String(h))
        line.setAttribute('stroke', isActive ? COLOR_ACTIVE : COLOR_LINE)
        line.setAttribute('stroke-width', isActive ? '1.5' : '1')
        if (isActive) line.setAttribute('stroke-dasharray', 'none')
        this.svg.appendChild(line)
      }

      for (const y of this.edgeY) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
        const isActive = activeY.has(y)
        line.setAttribute('x1', '0')
        line.setAttribute('x2', String(w))
        line.setAttribute('y1', String(y))
        line.setAttribute('y2', String(y))
        line.setAttribute('stroke', isActive ? COLOR_ACTIVE : COLOR_LINE)
        line.setAttribute('stroke-width', isActive ? '1.5' : '1')
        this.svg.appendChild(line)
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
      this.rebuildEdges()

      this.observer = new MutationObserver((records) => {
        for (const record of records) {
          if (record.type !== 'attributes' || record.attributeName !== 'style') continue
          const el = record.target
          if (!(el instanceof HTMLElement) || shouldSkipElement(el)) continue
          const style = el.style
          if (
            style.position === 'relative' ||
            style.left ||
            style.top ||
            style.transform
          ) {
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
      this.host?.remove()
      this.host = null
      this.svg = null
      this.root = null
      this.draggedEl = null
      this.edgeX = []
      this.edgeY = []
    },
  }

  globalThis.VisbugMcpAlignmentGuides = {
    start: (root) => guides.start(root),
    stop: () => guides.stop(),
  }
}
