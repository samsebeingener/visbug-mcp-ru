// popup.js — режим «Запись» (snapshot до/после)
const ws = new WebSocket('ws://127.0.0.1:4844')
const dot = document.getElementById('dot')
const statusEl = document.getElementById('status')
const count = document.getElementById('count')
const hint = document.getElementById('hint')
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
    ? 'Скролл и hover не пишутся в буфер. Меняйте стили, затем нажмите «Стоп».'
    : '1. Начать запись → 2. Правки в VisBug → 3. Стоп → 4. Скопировать / MCP'
}

function refreshStats() {
  if (connected) ws.send(JSON.stringify({ event: 'popup-ping' }))
}

ws.onopen = () => {
  connected = true
  setRecording(false)
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
    }
    if (data.event === 'recording-armed') {
      setRecording(true)
    }
    if (data.event === 'recording-finished') {
      setRecording(false)
      count.textContent = `В буфере правок: ${data.total ?? 0}`
      refreshStats()
    }
    if (data.event === 'recording-error') {
      setRecording(false)
      count.textContent = data.message ?? 'Ошибка записи'
    }
  } catch {}
}

ws.onerror = ws.onclose = () => {
  connected = false
  setRecording(false)
  dot.className = 'dot off'
  statusEl.textContent = 'MCP-сервер не запущен'
  count.textContent = 'Запустите: powershell -File scripts/start-ws-daemon.ps1'
  recordBtn.disabled = true
  clearBtn.disabled = true
  copyBtn.disabled = true
  cachedChangesText = ''
}

recordBtn.addEventListener('click', () => {
  if (!connected) return
  if (recording) {
    ws.send(JSON.stringify({ event: 'popup-recording-stop' }))
  } else {
    ws.send(JSON.stringify({ event: 'popup-recording-start' }))
  }
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
