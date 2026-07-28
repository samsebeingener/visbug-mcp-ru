/**
 * Fixed "REC" badge while VisBug recording is active.
 */

const RECORDING_BADGE_VERSION = '0.6.35'

if (globalThis.VisbugMcpRecordingBadge?.version !== RECORDING_BADGE_VERSION) {
  globalThis.VisbugMcpRecordingBadge?.stop?.()

  const Z_INDEX = 2147483644
  const ROOT_ID = 'visbug-mcp-recording-badge'

  const badge = {
    host: null,
    dot: null,
    timer: null,
    startedAt: 0,
    pulseRaf: 0,

    _ensureHost() {
      if (this.host?.isConnected) return

      const host = document.createElement('div')
      host.id = ROOT_ID
      host.setAttribute('aria-label', 'Запись VisBug')
      host.style.cssText = [
        'position:fixed',
        'top:12px',
        'right:12px',
        'z-index:' + Z_INDEX,
        'display:flex',
        'align-items:center',
        'gap:9px',
        'padding:10px 12px',
        'border-radius:10px',
        'background:rgba(69,10,10,0.96)',
        'border:1px solid #ef4444',
        'color:#fff',
        'font:800 13px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif',
        'letter-spacing:0.04em',
        'text-transform:uppercase',
        'box-shadow:0 2px 10px rgba(0,0,0,0.22)',
        'pointer-events:auto',
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
      label.textContent = 'ЗАПИСЬ ИДЁТ'

      const timer = document.createElement('span')
      timer.textContent = '00:00'
      timer.style.cssText = 'color:#fecaca;font:600 12px/1 system-ui'

      const stop = document.createElement('button')
      stop.type = 'button'
      stop.textContent = '■ Стоп'
      stop.style.cssText = 'border:1px solid #fecaca;border-radius:6px;background:#991b1b;color:#fff;padding:6px 8px;font:700 12px/1 system-ui;cursor:pointer'
      stop.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('visbug-mcp-recording-control', { detail: { action: 'stop' } }))
      })

      host.append(dot, label, timer, stop)
      document.documentElement.appendChild(host)

      this.host = host
      this.dot = dot
      this.timer = timer
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
      this.startedAt = Date.now()
      this.timerInterval = setInterval(() => {
        const seconds = Math.floor((Date.now() - this.startedAt) / 1000)
        this.timer.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
      }, 1000)
      this._startPulse()
    },

    stop() {
      cancelAnimationFrame(this.pulseRaf)
      clearInterval(this.timerInterval)
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
