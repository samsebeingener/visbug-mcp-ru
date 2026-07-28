/**
 * visbug-mcp — content-script.js (режим «Запись» по умолчанию)
 */

if (globalThis.__visbugMcpContentScriptLoaded) {
  // уже загружен через manifest — не дублировать WS/listeners
} else {
  globalThis.__visbugMcpContentScriptLoaded = true

const WS_URL = 'ws://127.0.0.1:4844'
const RECONNECT_DELAY = 2000
const LIVE_OBSERVER_ENABLED = false // с v0.2.0 основной режим — snapshot по кнопке «Начать/Стоп»

const snap = () => globalThis.VisbugMcpSnapshot
const guides = () => globalThis.VisbugMcpAlignmentGuides
const badge = () => globalThis.VisbugMcpRecordingBadge
const textWatch = () => globalThis.VisbugMcpRecordingTextWatch
const uiTrim = () => globalThis.VisbugMcpUiTrim

let socket = null
let connected = false
let recordingBefore = null
let recordingRootSelector = null
let recordingScopeRoot = null

function clearVisbugPageState() {
  recordingBefore = null
  recordingRootSelector = null
  recordingScopeRoot = null
  globalThis.__visbugMcpRecordingActive = false
  globalThis.__visbugMcpRecordingRoot = null
  guides()?.stop()
  badge()?.stop()
  textWatch()?.stop()
  uiTrim()?.uninstall()
  const removed = Object.keys(localStorage).filter(k => /visbug|vis-bug/i.test(k))
  removed.forEach(k => localStorage.removeItem(k))
}

function showApplyToast(msg) {
  const text = String(msg?.summary || msg?.message || '').trim()
  if (!text) return
  const id = 'visbug-mcp-apply-toast'
  document.getElementById(id)?.remove()
  const el = document.createElement('div')
  el.id = id
  el.setAttribute('role', 'status')
  const ok = msg?.event === 'auto-applied' && !(msg?.failed?.length)
  el.style.cssText = [
    'position:fixed',
    'left:50%',
    'bottom:24px',
    'transform:translateX(-50%)',
    'z-index:2147483646',
    'max-width:min(520px,92vw)',
    'padding:14px 16px',
    'border-radius:12px',
    `background:${ok ? 'rgba(20,83,45,0.96)' : 'rgba(69,10,10,0.96)'}`,
    `border:1px solid ${ok ? '#4ade80' : '#f87171'}`,
    'color:#fff',
    'font:600 13px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif',
    'white-space:pre-wrap',
    'box-shadow:0 8px 28px rgba(0,0,0,0.35)',
    'pointer-events:none',
  ].join(';')
  el.textContent = text
  document.documentElement.appendChild(el)
  setTimeout(() => el.remove(), ok ? 6500 : 12000)
}

function connect() {
  socket = new WebSocket(WS_URL)

  socket.addEventListener('open', () => {
    connected = true
    console.debug('[visbug-mcp] connected')
  })

  socket.addEventListener('message', (e) => {
    try {
      const msg = JSON.parse(e.data)
      // Только чистим localStorage VisBug. Активную запись/badge НЕ трогаем —
      // иначе clear после «Начать запись» убивает снимок «до» и индикатор.
      if (msg.event === 'clear-visbug-storage') {
        const removed = Object.keys(localStorage).filter(k => /visbug|vis-bug/i.test(k))
        removed.forEach(k => localStorage.removeItem(k))
      }
      if (
        msg.event === 'auto-applied'
        || msg.event === 'apply-incomplete'
        || msg.event === 'auto-applied-partial'
        || msg.event === 'agent-fallback-finished'
      ) {
        showApplyToast(msg)
      }
    } catch {}
  })

  socket.addEventListener('close', () => {
    connected = false
    setTimeout(connect, RECONNECT_DELAY)
  })

  socket.addEventListener('error', () => {})
}

function send(payload) {
  if (connected && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload))
  }
}

function getSelector(el) {
  try {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return 'body'
    if (el === document.body || el === document.documentElement) return 'body'
    if (el.id) return `#${CSS.escape(el.id)}`

    const attrs = el.attributes ? Array.from(el.attributes) : []
    const vueAttr = attrs.find(a => a.name.startsWith('data-v-'))
    if (vueAttr) {
      const tag = el.tagName.toLowerCase()
      const cls = el.classList?.length ? '.' + [...el.classList].map(CSS.escape).join('.') : ''
      return `${tag}[${vueAttr.name}]${cls}`
    }

    const tag = el.tagName.toLowerCase()
    const parent = el.parentElement
    if (!parent || parent === document.documentElement) return tag
    const siblings = Array.from(parent?.children || []).filter(c => c.tagName === el.tagName)
    const idx = siblings.indexOf(el) + 1
    const nthPart = siblings.length > 1 ? `:nth-of-type(${idx})` : ''
    const cls = el.classList?.length ? '.' + [...el.classList].map(CSS.escape).join('.') : ''
    return `${getSelector(parent)} > ${tag}${cls}${nthPart}`
  } catch {
    return 'body'
  }
}

function startRecordingSnapshot() {
  // Не вызываем полный clearVisbugPageState() — он гасит badge до старта.
  // Сбрасываем только предыдущую сессию записи.
  recordingBefore = null
  recordingRootSelector = null
  recordingScopeRoot = null
  guides()?.stop()
  textWatch()?.stop()

  recordingScopeRoot = snap().getDefaultSnapshotRoot(document)
  const root = recordingScopeRoot
  globalThis.__visbugMcpRecordingActive = true
  globalThis.__visbugMcpRecordingRoot = root
  recordingRootSelector = getSelector(root)
  recordingBefore = snap().captureSnapshot(root, getSelector)
  globalThis.__visbugMcpRecordingBefore = recordingBefore
  guides()?.start(recordingScopeRoot)
  uiTrim()?.install()
  badge()?.start()
  textWatch()?.start(recordingScopeRoot, getSelector, { url: location.href })
  console.debug('[visbug-mcp] alignment guides ON', Boolean(guides()))
  send({
    event: 'recording-started',
    url: location.href,
    rootSelector: recordingRootSelector,
    elementCount: recordingBefore.length,
    guides: true,
  })
  console.debug('[visbug-mcp] snapshot before:', recordingRootSelector, recordingBefore.length, 'elements')
}

function finishRecordingSnapshot() {
  if (!recordingBefore) {
    guides()?.stop()
    badge()?.stop()
    textWatch()?.stop()
    uiTrim()?.uninstall()
    send({ event: 'recording-error', url: location.href, message: 'Снимок «до» не найден. Нажмите «Начать запись» ещё раз.' })
    return
  }

  // Дать VisBug дописать inline-стили после drag
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const root = recordingScopeRoot ?? snap().getDefaultSnapshotRoot(document)
      const after = snap().captureSnapshot(root, getSelector)
      const snapshotChanges = snap().diffSnapshots(recordingBefore, after, { url: location.href })
      const watchedText = textWatch()?.drainChanges?.() ?? []
      textWatch()?.stop()
      const changes = snap().mergeTextChanges
        ? snap().mergeTextChanges(snapshotChanges, watchedText)
        : snapshotChanges

      send({
        event: 'recording-result',
        url: location.href,
        rootSelector: recordingRootSelector,
        changes,
      })

      recordingBefore = null
      globalThis.__visbugMcpRecordingBefore = null
      recordingScopeRoot = null
      globalThis.__visbugMcpRecordingActive = false
      globalThis.__visbugMcpRecordingRoot = null
      guides()?.stop()
      badge()?.stop()
      uiTrim()?.uninstall()
      console.debug('[visbug-mcp] snapshot diff:', changes.length, 'changes', changes)
    })
  })
}

// Live observer отключён — см. LIVE_MUTATIONS_ENABLED в ws-daemon.js

window.addEventListener('visbug-mcp-recording-control', (event) => {
  if (event.detail?.action === 'stop') finishRecordingSnapshot()
})

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'visbug-ping') {
    sendResponse({ ok: true })
    return true
  }

  if (msg.type !== 'visbug-recording') return

  try {
    if (msg.action === 'start') {
      startRecordingSnapshot()
      sendResponse({ ok: true })
    } else if (msg.action === 'stop') {
      finishRecordingSnapshot()
      sendResponse({ ok: true })
    } else {
      sendResponse({ ok: false, error: 'Неизвестное действие записи.' })
    }
  } catch (err) {
    sendResponse({ ok: false, error: err?.message ?? 'Ошибка записи.' })
  }
  return true
})

connect()
console.debug('[visbug-mcp] режим «Запись» (snapshot), live observer:', LIVE_OBSERVER_ENABLED)

} // __visbugMcpContentScriptLoaded
