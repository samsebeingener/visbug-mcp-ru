// popup.js — только копирование и очистка буфера (модель mambari)
const WS_URL = 'ws://127.0.0.1:4844'
const RECONNECT_MS = 2000

const dot = document.getElementById('dot')
const statusEl = document.getElementById('status')
const count = document.getElementById('count')
const projectEl = document.getElementById('project')
const clearBtn = document.getElementById('clear-btn')
const copyBtn = document.getElementById('copy-btn')
const extVersionEl = document.getElementById('ext-version')

try {
  const v = chrome.runtime.getManifest().version
  if (extVersionEl) extVersionEl.textContent = `v${v}`
} catch {}

let ws = null
let reconnectTimer = null
let cachedChangesText = ''
let connected = false
let activePageUrl = ''

async function refreshActivePageUrl() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  activePageUrl = tabs[0]?.url ?? ''
  return activePageUrl
}

function wsSend(payload) {
  if (connected && ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload))
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function renderProject(health) {
  const target = health?.targetProject
  if (!target) {
    projectEl.innerHTML = '<strong>Проект не назначен.</strong><br>Запустите <code>/visbug-mcp-start</code> в Cursor.'
    return
  }
  const path = target.workspace?.length > 36
    ? `…${target.workspace.slice(-34)}`
    : target.workspace
  projectEl.innerHTML = [
    `<strong>${escapeHtml(target.name)}</strong>`,
    `<span>${escapeHtml(target.origin)}</span>`,
    `<code>${escapeHtml(path || '')}</code>`,
  ].join('<br>')
}

function setOfflineUi() {
  connected = false
  dot.className = 'dot off'
  statusEl.textContent = 'Bridge daemon не запущен'
  count.textContent = 'Запустите: npm run daemon'
  projectEl.textContent = 'В папке visbug-mcp-ru: scripts/start-ws-daemon.ps1'
  clearBtn.disabled = true
  copyBtn.disabled = true
  cachedChangesText = ''
}

function connectWs() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return

  ws = new WebSocket(WS_URL)

  ws.onopen = async () => {
    connected = true
    dot.className = 'dot on'
    statusEl.textContent = 'Bridge подключён — правьте в VisBug'
    clearBtn.disabled = false
    copyBtn.disabled = false
    await refreshActivePageUrl()
    wsSend({ event: 'popup-ping', url: activePageUrl })
    wsSend({ event: 'popup-health', url: activePageUrl })
  }

  ws.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data)
      if (data.event === 'stats') {
        count.textContent = `Правок в буфере: ${data.total}`
        cachedChangesText = data.changesText ?? ''
        if (data.health) renderProject(data.health)
      }
      if (data.event === 'health') {
        renderProject(data)
      }
    } catch {}
  }

  ws.onerror = () => {}

  ws.onclose = () => {
    setOfflineUi()
    scheduleReconnect()
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connectWs()
  }, RECONNECT_MS)
}

connectWs()

clearBtn.addEventListener('click', async () => {
  await refreshActivePageUrl()
  wsSend({ event: 'popup-clear', url: activePageUrl })
  count.textContent = 'Правок в буфере: 0'
  cachedChangesText = ''
})

const CLIPBOARD_FOOTER = `

---
Подсказка для Cursor: v0.26 — MOVE: x_file(репо)+Δ, не копируй write: вслепую; stamps vb-*: перенеси id в исходник при apply; §1.3/§11 apply-buffer-contract.md`

copyBtn.addEventListener('click', () => {
  const body = cachedChangesText || 'Нет правок.'
  const text = body === 'Нет правок.' ? body : body + CLIPBOARD_FOOTER
  navigator.clipboard.writeText(text).then(() => {
    copyBtn.textContent = 'Скопировано!'
    copyBtn.classList.add('copied')
    setTimeout(() => {
      copyBtn.textContent = 'Скопировать правки'
      copyBtn.classList.remove('copied')
    }, 2000)
  })
})
