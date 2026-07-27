// background.js — запись только на активной вкладке (manifest content scripts, без повторной инъекции)

function isDevPageUrl(url) {
  if (!url) return false
  try {
    const { hostname, protocol } = new URL(url)
    if (protocol !== 'http:' && protocol !== 'https:') return false
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') return true
    if (hostname.endsWith('.local')) return true
    if (/^192\.168\.\d+\.\d+$/.test(hostname)) return true
    if (/^10\.\d+\.\d+\.\d+$/.test(hostname)) return true
    return false
  } catch {
    return false
  }
}

function sendToTab(tabId, payload) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, payload, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message })
        return
      }
      resolve(response ?? { ok: true })
    })
  })
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForContentScript(tabId, attempts = 8) {
  for (let i = 0; i < attempts; i++) {
    const ping = await sendToTab(tabId, { type: 'visbug-ping' })
    if (ping.ok) return ping
    await sleep(120)
  }
  return { ok: false, error: 'Content script не найден. Обновите страницу (F5) и попробуйте снова.' }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'status') {
    sendResponse({ ok: true })
    return
  }

  if (msg.type === 'visbug-recording-start' || msg.type === 'visbug-recording-stop') {
    const action = msg.type === 'visbug-recording-start' ? 'start' : 'stop'

    ;(async () => {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
      const tab = tabs[0]
      if (!tab?.id) {
        sendResponse({ ok: false, error: 'Нет активной вкладки.' })
        return
      }

      if (!isDevPageUrl(tab.url)) {
        sendResponse({
          ok: false,
          error: 'Запись только на dev-странице (localhost / 127.0.0.1). Откройте dev-сервер и обновите F5.',
        })
        return
      }

      const ready = await waitForContentScript(tab.id)
      if (!ready.ok) {
        sendResponse({ ok: false, error: ready.error })
        return
      }

      const result = await sendToTab(tab.id, { type: 'visbug-recording', action })
      sendResponse(result)
    })()

    return true
  }
})
