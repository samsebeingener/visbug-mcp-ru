// background.js — service worker расширения
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'status') {
    sendResponse({ ok: true })
  }
})
