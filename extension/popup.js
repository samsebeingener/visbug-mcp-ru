// popup.js — режим «Запись» (snapshot до/после)
const WS_URL = 'ws://127.0.0.1:4844'
const RECONNECT_MS = 2000

const dot = document.getElementById('dot')
const statusEl = document.getElementById('status')
const count = document.getElementById('count')
const hint = document.getElementById('hint')
const updateBanner = document.getElementById('update-banner')
const healthEl = document.getElementById('health')
const projectEl = document.getElementById('project')
const pipelineEl = document.getElementById('pipeline')
const installHintEl = document.getElementById('install-hint')
const recordBtn = document.getElementById('record-btn')
const clearBtn = document.getElementById('clear-btn')
const copyBtn = document.getElementById('copy-btn')

let ws = null
let reconnectTimer = null
let cachedChangesText = ''
let recording = false
let connected = false
let activePageUrl = ''
let activeTabId = null
let lastHealth = null

function persistRecordingState(active) {
  chrome.storage.session.set({ visbugBridgeRecording: active })
}

chrome.storage.session.get('visbugBridgeRecording').then(({ visbugBridgeRecording }) => {
  if (visbugBridgeRecording === true) setRecording(true)
})

async function refreshActivePageUrl() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  activeTabId = tabs[0]?.id ?? null
  activePageUrl = tabs[0]?.url ?? ''
  return activePageUrl
}

function wsSend(payload) {
  if (connected && ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload))
  }
}

function setOfflineUi() {
  // Popup закрывается → WebSocket рвётся. Это НЕ остановка записи.
  // Нельзя сбрасывать recording / storage, иначе при повторном открытии
  // кажется, что запись «отменилась».
  connected = false
  if (recording) {
    dot.className = 'dot rec'
    statusEl.textContent = 'Идёт запись… (переподключение к Bridge)'
    recordBtn.textContent = 'Стоп — завершить запись'
    recordBtn.classList.add('recording')
  } else {
    dot.className = 'dot off'
    statusEl.textContent = 'Bridge daemon не запущен'
  }
  projectEl.textContent = 'Запустите Bridge daemon, затем откройте popup снова.'
  renderHealth(null)
  if (!recording) recordBtn.disabled = true
  clearBtn.disabled = true
  copyBtn.disabled = true
}

function setRecording(active) {
  recording = active
  persistRecordingState(active)
  recordBtn.textContent = active ? 'Стоп — завершить запись' : 'Начать запись'
  recordBtn.classList.toggle('recording', active)
  dot.className = active ? 'dot rec' : (connected ? 'dot on' : 'dot off')
  statusEl.textContent = active
    ? 'Идёт запись… правьте в VisBug'
    : (connected ? 'Bridge готов к записи' : 'Bridge daemon не запущен')
  hint.classList.toggle('show', active)
  if (active) {
    hint.textContent = 'REC на странице. После «Стоп» Bridge сначала применит безопасные правки, затем Cursor Agent разберёт остаток.'
  }
}

function showUpdateBanner(data) {
  if (!updateBanner || !data?.latest) return
  const changelog = String(data.changelog ?? '').trim()
  const shortLog = changelog.length > 280 ? `${changelog.slice(0, 277)}…` : changelog
  updateBanner.innerHTML = [
    `<strong>Обновление ${data.current} → ${data.latest}</strong>`,
    shortLog ? `<br>${shortLog.replace(/\n/g, '<br>')}` : '',
    '<br><br>В Cursor: <strong>/visbug-mcp-update</strong>',
  ].join('')
  updateBanner.classList.add('show')
}

function hideUpdateBanner() {
  if (updateBanner) {
    updateBanner.classList.remove('show')
    updateBanner.textContent = ''
  }
}

function renderInstallHint(h) {
  if (!installHintEl) return
  if (!h) {
    installHintEl.innerHTML = [
      '<strong>Запуск Bridge daemon</strong><br>',
      'В PowerShell из папки visbug-mcp-ru:<br>',
      '<code>powershell -ExecutionPolicy Bypass -File scripts/start-ws-daemon.ps1</code>',
    ].join('')
    return
  }
  const store = h?.visbugStoreUrl
    || 'https://chromewebstore.google.com/detail/visbug/cdockenadnadldjbbgcallicgledbeoc'
  const extPage = h?.chromeExtensionsUrl || 'chrome://extensions'
  const folder = h?.extensionPath || ''
  installHintEl.innerHTML = [
    '<strong>Chrome (один раз)</strong><br>',
    `1. VisBug: <a href="${store}" target="_blank" rel="noopener">Chrome Web Store</a><br>`,
    `2. Откройте в адресной строке: <code>${extPage}</code><br>`,
    '3. Режим разработчика → «Загрузить распакованное»<br>',
    folder
      ? `4. Папка расширения visbug-mcp:<br><code>${folder}</code>`
      : '4. Папка: <code>&lt;репо&gt;/extension</code> (путь печатает npm run setup)',
  ].join('')
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function renderHealth(h) {
  if (!healthEl) return
  if (!h) {
    healthEl.textContent = 'Bridge daemon offline — npm run setup или start-ws-daemon.ps1'
    renderInstallHint(null)
    return
  }
  lastHealth = h
  renderInstallHint(h)
  const line = (ok, label, neutral = false) => {
    const cls = ok ? 'ok' : (neutral ? 'opt' : 'bad')
    const mark = ok ? '✓' : (neutral ? '○' : '✗')
    return `<span class="${cls}">${mark}</span> ${label}`
  }
  const target = h.targetProject
  const targetName = target?.name || 'не назначен'
  const targetPath = target?.workspace
    ? (target.workspace.length > 32 ? `…${target.workspace.slice(-30)}` : target.workspace)
    : 'для этого localhost'
  const fileApplyOk = Boolean(h.autoApplyReady)
  const lines = [
    line(true, 'Bridge daemon'),
    line(fileApplyOk, `Auto-apply → ${escapeHtml(targetName)}`),
    line(h.cursorCli, h.cursorCli ? 'Cursor Agent fallback готов' : 'Cursor Agent fallback недоступен', !h.cursorCli),
    line(h.mcpConfigured, h.mcpConfigured ? 'Cursor MCP подключён (ручной доступ)' : 'Cursor MCP не подключён (не обязателен)', !h.mcpConfigured),
  ]
  healthEl.innerHTML = lines.join('<br>')
  projectEl.innerHTML = target
    ? `<strong>Текущий проект:</strong> ${escapeHtml(targetName)}<br><span>${escapeHtml(target.origin)}</span><br><code>${escapeHtml(targetPath)}</code><br><span>${h.workspaceKind === 'static-html' ? 'Static HTML: index.html' : 'Приложение: src/'}</span>`
    : '<strong>Проект не назначен.</strong><br>В Cursor запустите <code>/visbug-mcp-start</code>: команда спросит, использовать запущенный проект или поднять новый.'
  recordBtn.disabled = recording ? !connected : (!connected || !fileApplyOk)
}

function refreshHealth() {
  wsSend({ event: 'popup-health', url: activePageUrl })
}

async function refreshStats() {
  await refreshActivePageUrl()
  if (connected) {
    wsSend({ event: 'popup-ping', url: activePageUrl })
    refreshHealth()
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connectWs()
  }, RECONNECT_MS)
}

function connectWs() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    return
  }

  ws = new WebSocket(WS_URL)

  ws.onopen = () => {
    connected = true
    recordBtn.disabled = false
    clearBtn.disabled = false
    copyBtn.disabled = false
    refreshStats()
  }

  ws.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data)
      if (data.event === 'update-available') {
        showUpdateBanner(data)
        if (data.message) statusEl.textContent = data.message
      }
      if (data.event === 'stats') {
        count.textContent = `Правок текущей записи: ${data.total}`
        cachedChangesText = data.changesText ?? ''
        // Daemon — источник правды о записи; не даём offline/close сбросить её.
        if (typeof data.recording === 'boolean') setRecording(data.recording)
        if (data.health) renderHealth({ ...data.health, cursorCli: data.health.cursorCli })
        if (data.recording) {
          recordBtn.disabled = false
          clearBtn.disabled = false
          copyBtn.disabled = false
        }
      }
      if (data.event === 'health') {
        renderHealth(data)
      }
      if (data.event === 'auto-applied-partial' || data.event === 'apply-incomplete') {
        pipelineEl.classList.add('show')
        const text = data.summary || data.message || 'Не все правки удалось применить автоматически.'
        pipelineEl.textContent = text
        statusEl.textContent = data.failed?.length
          ? `Частично / ошибки: ${data.applied ?? 0} ок, ${data.failed.length} нет`
          : (data.message || text.split('\n')[0])
      }
      if (data.event === 'auto-applied') {
        pipelineEl.classList.add('show')
        const text = data.summary
          || (data.remaining
            ? `Применено ${data.applied}; осталось ${data.remaining}`
            : `Готово: ${data.applied} правок в файлы`)
        pipelineEl.textContent = text
        statusEl.textContent = data.writes?.length
          ? `✅ Записано: ${data.writes.map((w) => w.selector).slice(0, 2).join(', ')}`
          : text.split('\n')[0]
      }
      if (data.event === 'auto-apply-started') {
        pipelineEl.classList.add('show')
        pipelineEl.textContent = 'Применяю безопасные правки в исходники…'
      }
      if (data.event === 'agent-fallback-started') {
        pipelineEl.classList.add('show')
        pipelineEl.textContent = data.message || `Cursor Agent разбирает ${data.total} сложных правок…`
        statusEl.textContent = 'Cursor Agent работает в фоне'
      }
      if (data.event === 'agent-fallback-finished') {
        pipelineEl.classList.add('show')
        const files = (data.files ?? []).length ? ` → ${data.files.join(', ')}` : ''
        pipelineEl.textContent = data.message + files
        statusEl.textContent = data.completion
          ? `Cursor Agent завершил обработку: ${data.applied} правок`
          : 'Cursor Agent не подтвердил применённые правки'
      }
      if (data.event === 'auto-agent-skipped') {
        statusEl.textContent = `Запись OK; auto-agent: ${data.reason}`
      }
      if (data.event === 'recording-armed') {
        setRecording(true)
        recordBtn.disabled = false
      }
      if (data.event === 'recording-finished') {
        setRecording(false)
        recordBtn.disabled = false
        count.textContent = `Правок текущей записи: ${data.total ?? 0}`
        refreshStats()
      }
      if (data.event === 'recording-error') {
        setRecording(false)
        recordBtn.disabled = false
        statusEl.textContent = data.message ?? 'Ошибка записи'
        refreshStats()
      }
    } catch {}
  }

  ws.onerror = () => {}

  ws.onclose = () => {
    setOfflineUi()
    scheduleReconnect()
  }
}

connectWs()

function notifyTabRecording(action) {
  return new Promise((resolve) => {
    const type = action === 'start' ? 'visbug-recording-start' : 'visbug-recording-stop'
    chrome.runtime.sendMessage({ type, tabId: activeTabId }, (res) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message })
        return
      }
      resolve(res ?? { ok: true })
    })
  })
}

recordBtn.addEventListener('click', async () => {
  if (!connected || recordBtn.disabled) return

  if (recording) {
    recordBtn.disabled = true
    recordBtn.textContent = 'Завершение…'
    const tabRes = await notifyTabRecording('stop')
    if (!tabRes.ok) {
      wsSend({ event: 'popup-recording-cancel' })
      recordBtn.disabled = false
      setRecording(false)
      statusEl.textContent = tabRes.error ?? 'Не удалось завершить запись'
      return
    }
    wsSend({ event: 'popup-recording-stop' })
    return
  }

  recordBtn.disabled = true
  recordBtn.textContent = 'Подготовка…'
  await refreshActivePageUrl()
  if (!lastHealth?.autoApplyReady) {
    recordBtn.disabled = false
    statusEl.textContent = 'Для этой страницы не назначена папка проекта.'
    return
  }
  wsSend({ event: 'popup-recording-start', url: activePageUrl })
  count.textContent = 'Правок текущей записи: 0'
  cachedChangesText = ''
  const tabRes = await notifyTabRecording('start')
  if (!tabRes.ok) {
    recordBtn.disabled = false
    recordBtn.textContent = 'Начать запись'
    statusEl.textContent = tabRes.error ?? 'Не удалось начать запись'
    wsSend({ event: 'popup-recording-cancel' })
    return
  }
})


clearBtn.addEventListener('click', () => {
  wsSend({ event: 'popup-clear' })
  count.textContent = 'Правок текущей записи: 0'
  cachedChangesText = ''
  setRecording(false)
})

copyBtn.addEventListener('click', () => {
  const text = cachedChangesText || 'Нет правок.'
  navigator.clipboard.writeText(text).then(() => {
    copyBtn.textContent = 'Скопировано!'
    copyBtn.classList.add('copied')
    setTimeout(() => {
      copyBtn.textContent = 'Скопировать правки'
      copyBtn.classList.remove('copied')
    }, 2000)
  })
})
