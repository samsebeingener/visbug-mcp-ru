// popup.js — режим «Запись» (snapshot до/после)
const ws = new WebSocket('ws://127.0.0.1:4844')
const dot = document.getElementById('dot')
const statusEl = document.getElementById('status')
const count = document.getElementById('count')
const hint = document.getElementById('hint')
const healthEl = document.getElementById('health')
const recordBtn = document.getElementById('record-btn')
const clearBtn = document.getElementById('clear-btn')
const copyBtn = document.getElementById('copy-btn')

let cachedChangesText = ''
let recording = false
let connected = false

function setRecording(active) {
  recording = active
  recordBtn.textContent = active ? 'Стоп — завершить запись' : 'Начать запись'
  recordBtn.classList.toggle('recording', active)
  dot.className = active ? 'dot rec' : (connected ? 'dot on' : 'dot off')
  statusEl.textContent = active
    ? 'Идёт запись… правьте в VisBug'
    : (connected ? 'Подключено к MCP-серверу' : 'MCP-сервер не запущен')
  hint.textContent = active
    ? 'REC на странице. Пишутся стили и текст (заголовки, p, span). Стоп — в буфер MCP.'
    : '1. Начать запись → 2. Правки в VisBug → 3. Стоп → в файлы проекта'
}

function renderHealth(h) {
  if (!healthEl) return
  if (!h) {
    healthEl.textContent = 'Демон offline — npm run setup или start-ws-daemon.ps1'
    return
  }
  const line = (ok, label, neutral = false) => {
    const cls = ok ? 'ok' : (neutral ? 'opt' : 'bad')
    const mark = ok ? '✓' : (neutral ? '○' : '✗')
    return `<span class="${cls}">${mark}</span> ${label}`
  }
  const ws = h.workspace ? (h.workspace.length > 28 ? `…${h.workspace.slice(-26)}` : h.workspace) : 'не задан'
  const fileApplyOk = Boolean(h.autoAgentEnabled && h.workspace)
  const lines = [
    line(true, 'Демон'),
    line(h.mcpConfigured, 'MCP в Cursor'),
    line(fileApplyOk, `Запись в файлы после Стоп → ${ws}`),
  ]
  if (h.cursorCli) {
    lines.push(line(true, `CLI ${h.cursorCliCommand || 'agent'} (доп.)`))
  } else if (fileApplyOk) {
    lines.push(line(false, 'CLI agent — не нужен (есть auto-apply)', true))
  } else {
    lines.push(line(false, `CLI ${h.cursorCliCommand || 'agent'}`))
  }
  healthEl.innerHTML = lines.join('<br>')
}

function refreshHealth() {
  if (connected) ws.send(JSON.stringify({ event: 'popup-health' }))
}

function refreshStats() {
  if (connected) {
    ws.send(JSON.stringify({ event: 'popup-ping' }))
    refreshHealth()
  }
}

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
    if (data.event === 'stats') {
      count.textContent = `В буфере правок: ${data.total}`
      cachedChangesText = data.changesText ?? ''
      if (typeof data.recording === 'boolean') setRecording(data.recording)
      if (data.health) renderHealth({ ...data.health, cursorCli: data.health.cursorCli })
    }
    if (data.event === 'health') {
      renderHealth(data)
    }
    if (data.event === 'auto-applied') {
      const files = (data.files ?? []).length ? ` → ${data.files.join(', ')}` : ''
      statusEl.textContent = data.remaining
        ? `Применено ${data.applied} в файлы${files}; осталось ${data.remaining}`
        : `Готово: ${data.applied} правок в файлы${files}`
    }
    if (data.event === 'auto-agent-started') {
      statusEl.textContent = `Auto-agent запущен (${data.total} правок)`
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
      count.textContent = `В буфере правок: ${data.total ?? 0}`
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

ws.onerror = ws.onclose = () => {
  connected = false
  setRecording(false)
  dot.className = 'dot off'
  statusEl.textContent = 'MCP-сервер не запущен'
  count.textContent = 'Запустите: npm run setup'
  renderHealth(null)
  recordBtn.disabled = true
  clearBtn.disabled = true
  copyBtn.disabled = true
  cachedChangesText = ''
}

function notifyTabRecording(action) {
  return new Promise((resolve) => {
    const type = action === 'start' ? 'visbug-recording-start' : 'visbug-recording-stop'
    chrome.runtime.sendMessage({ type }, (res) => {
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
      ws.send(JSON.stringify({ event: 'popup-recording-cancel' }))
      recordBtn.disabled = false
      setRecording(false)
      statusEl.textContent = tabRes.error ?? 'Не удалось завершить запись'
      return
    }
    ws.send(JSON.stringify({ event: 'popup-recording-stop' }))
    return
  }

  recordBtn.disabled = true
  recordBtn.textContent = 'Подготовка…'
  const tabRes = await notifyTabRecording('start')
  if (!tabRes.ok) {
    recordBtn.disabled = false
    recordBtn.textContent = 'Начать запись'
    statusEl.textContent = tabRes.error ?? 'Не удалось начать запись'
    return
  }
  ws.send(JSON.stringify({ event: 'popup-recording-start' }))
})

clearBtn.addEventListener('click', () => {
  ws.send(JSON.stringify({ event: 'popup-clear' }))
  count.textContent = 'В буфере правок: 0'
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
