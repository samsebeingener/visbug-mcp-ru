// background.js — service worker de l'extension
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'status') {
    sendResponse({ ok: true })
  }
})
