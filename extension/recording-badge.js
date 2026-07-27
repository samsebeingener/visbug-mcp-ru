/**
 * Fixed "REC" badge while VisBug recording is active.
 */

const RECORDING_BADGE_VERSION = '0.6.1'

if (globalThis.VisbugMcpRecordingBadge?.version !== RECORDING_BADGE_VERSION) {
  globalThis.VisbugMcpRecordingBadge?.stop?.()

  const Z_INDEX = 2147483644
  const ROOT_ID = 'visbug-mcp-recording-badge'

  const badge = {
    host: null,
    dot: null,
    pulseRaf: 0,

    _ensureHost() {
      if (this.host?.isConnected) return

      const host = document.createElement('div')
      host.id = ROOT_ID
      host.setAttribute('aria-hidden', 'true')
      host.style.cssText = [
        'position:fixed',
        'top:12px',
        'right:12px',
        'z-index:' + Z_INDEX,
        'display:flex',
        'align-items:center',
        'gap:6px',
        'padding:4px 10px 4px 8px',
        'border-radius:999px',
        'background:rgba(15,23,42,0.82)',
        'color:#fff',
        'font:600 11px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif',
        'letter-spacing:0.04em',
        'text-transform:uppercase',
        'box-shadow:0 2px 10px rgba(0,0,0,0.22)',
        'pointer-events:none',
        'user-select:none',
        '-webkit-user-select:none',
      ].join(';')

      const dot = document.createElement('span')
      dot.style.cssText = [
        'width:8px',
        'height:8px',
        'border-radius:50%',
        'background:#ef4444',
        'box-shadow:0 0 0 0 rgba(239,68,68,0.55)',
        'flex-shrink:0',
      ].join(';')

      const label = document.createElement('span')
      label.textContent = 'ЗАПИСЬ'

      host.append(dot, label)
      document.documentElement.appendChild(host)

      this.host = host
      this.dot = dot
    },

    _startPulse() {
      cancelAnimationFrame(this.pulseRaf)
      const start = performance.now()

      const tick = (now) => {
        if (!this.dot) return
        const phase = (now - start) / 1000
        const alpha = 0.35 + 0.25 * (0.5 + 0.5 * Math.sin(phase * Math.PI * 2))
        this.dot.style.opacity = String(0.75 + 0.25 * (0.5 + 0.5 * Math.sin(phase * Math.PI * 2)))
        this.dot.style.boxShadow = `0 0 0 ${2 + alpha * 2}px rgba(239,68,68,${alpha})`
        this.pulseRaf = requestAnimationFrame(tick)
      }

      this.pulseRaf = requestAnimationFrame(tick)
    },

    start() {
      this._ensureHost()
      this.host.style.display = 'flex'
      this._startPulse()
    },

    stop() {
      cancelAnimationFrame(this.pulseRaf)
      this.pulseRaf = 0
      if (this.host) this.host.style.display = 'none'
    },
  }

  globalThis.VisbugMcpRecordingBadge = {
    version: RECORDING_BADGE_VERSION,
    start: () => badge.start(),
    stop: () => badge.stop(),
  }
}
