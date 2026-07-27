// popup.js
const ws = new WebSocket('ws://127.0.0.1:4844')
const dot = document.getElementById('dot')
const statusEl = document.getElementById('status')
const count = document.getElementById('count')
const clearBtn = document.getElementById('clear-btn')
const copyBtn = document.getElementById('copy-btn')

let cachedChangesText = ''

ws.onopen = () => {
  dot.className = 'dot on'
  statusEl.textContent = 'Подключено к MCP-серверу'
  clearBtn.disabled = false
  copyBtn.disabled = false
  ws.send(JSON.stringify({ event: 'popup-ping' }))
}

ws.onmessage = (e) => {
  try {
    const data = JSON.parse(e.data)
    if (data.event === 'stats') {
      count.textContent = `Захвачено правок: ${data.total}`
      cachedChangesText = data.changesText ?? ''
    }
  } catch {}
}

ws.onerror = ws.onclose = () => {
  dot.className = 'dot off'
  statusEl.textContent = 'MCP-сервер не запущен'
  count.textContent = 'Запустите: powershell -File scripts/start-ws-daemon.ps1'
  clearBtn.disabled = true
  copyBtn.disabled = true
  cachedChangesText = ''
}

clearBtn.addEventListener('click', () => {
  ws.send(JSON.stringify({ event: 'popup-clear' }))
  count.textContent = 'Захвачено правок: 0'
  cachedChangesText = ''
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
