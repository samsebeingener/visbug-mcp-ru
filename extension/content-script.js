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

let socket = null
let connected = false
let recordingBefore = null
let recordingRootSelector = null
let recordingScopeRoot = null

function clearVisbugPageState() {
  recordingBefore = null
  recordingRootSelector = null
  recordingScopeRoot = null
  guides()?.stop()
  badge()?.stop()
  textWatch()?.stop()
  const removed = Object.keys(localStorage).filter(k => /visbug|vis-bug/i.test(k))
  removed.forEach(k => localStorage.removeItem(k))
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
      if (msg.event === 'clear-visbug-storage') {
        clearVisbugPageState()
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
  clearVisbugPageState()
  // Всегда снимаем всю главную — клики по article/section не сужают область
  recordingScopeRoot = snap().getDefaultSnapshotRoot(document)
  const root = recordingScopeRoot
  recordingRootSelector = getSelector(root)
  recordingBefore = snap().captureSnapshot(root, getSelector)
  globalThis.__visbugMcpRecordingBefore = recordingBefore
  guides()?.start(recordingScopeRoot)
  badge()?.start()
  textWatch()?.start(recordingScopeRoot, getSelector, { url: location.href })
  send({
    event: 'recording-started',
    url: location.href,
    rootSelector: recordingRootSelector,
    elementCount: recordingBefore.length,
  })
  console.debug('[visbug-mcp] snapshot before:', recordingRootSelector, recordingBefore.length, 'elements')
}

function finishRecordingSnapshot() {
  if (!recordingBefore) {
    guides()?.stop()
    badge()?.stop()
    textWatch()?.stop()
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
      guides()?.stop()
      badge()?.stop()
      console.debug('[visbug-mcp] snapshot diff:', changes.length, 'changes', changes)
    })
  })
}

// Live observer отключён — см. LIVE_MUTATIONS_ENABLED в ws-daemon.js

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
