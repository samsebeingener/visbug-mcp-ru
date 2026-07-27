/**
 * ws-daemon.js — фоновый WebSocket-сервер (127.0.0.1:4844).
 * Режим по умолчанию: «Запись» (snapshot до/после).
 */

import { WebSocketServer } from 'ws'
import { parseMutationsToChanges, formatChangesFromStore, clearSeen, restoreSeen } from './parser.js'
import { execSync } from 'child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const STORE_DIR = join(homedir(), '.visbug-mcp')
const STORE_FILE = join(STORE_DIR, 'changes.json')
const WS_PORT = 4844
const LIVE_MUTATIONS_ENABLED = false

const store = { changes: [] }
let recordingActive = false

function loadStore() {
  try {
    mkdirSync(STORE_DIR, { recursive: true })
    const data = JSON.parse(readFileSync(STORE_FILE, 'utf8'))
    store.changes = data.changes ?? []
    restoreSeen(store.changes)
    process.stderr.write(`[ws-daemon] store загружен: ${store.changes.length} правок\n`)
  } catch {
    // файла нет — пустой буфер
  }
}

function saveStore() {
  try {
    mkdirSync(STORE_DIR, { recursive: true })
    writeFileSync(STORE_FILE, JSON.stringify({ changes: store.changes }, null, 2))
  } catch (err) {
    process.stderr.write(`[ws-daemon] ошибка сохранения: ${err.message}\n`)
  }
}

function syncFromFile() {
  try {
    const data = JSON.parse(readFileSync(STORE_FILE, 'utf8'))
    const fileChanges = data.changes ?? []
    if (fileChanges.length !== store.changes.length) {
      store.changes = fileChanges
      clearSeen()
      restoreSeen(store.changes)
    } else {
      for (let i = 0; i < fileChanges.length; i++) {
        if (fileChanges[i].applied) store.changes[i].applied = true
      }
    }
  } catch {}
}

function setChangesFromRecording(changes) {
  store.changes = changes
  clearSeen()
  restoreSeen(store.changes)
  saveStore()
}

function sendStats(ws) {
  syncFromFile()
  const pending = store.changes.filter(c => !c.applied)
  const changesText = pending.length === 0 ? '' : formatChangesFromStore(store.changes)
  ws.send(JSON.stringify({
    event: 'stats',
    total: pending.length,
    changesText,
    recording: recordingActive,
    mode: 'record',
  }))
}

loadStore()

function freePort(port) {
  try {
    const pids = execSync(`lsof -ti :${port} 2>/dev/null || true`).toString().trim()
    if (pids) {
      pids.split('\n').filter(Boolean).forEach(pid => {
        try { execSync(`kill ${pid}`) } catch {}
      })
    }
  } catch {}
}

freePort(WS_PORT)

const wss = new WebSocketServer({ port: WS_PORT })

wss.on('listening', () => {
  process.stderr.write(`[ws-daemon] WebSocket ws://127.0.0.1:${WS_PORT} (режим: запись/snapshot)\n`)
})

wss.on('error', (err) => {
  process.stderr.write(`[ws-daemon] WebSocket error: ${err.message}\n`)
})

function broadcast(payload) {
  const msg = JSON.stringify(payload)
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg)
  })
}

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString())

      if (msg.event === 'mutations' && LIVE_MUTATIONS_ENABLED) {
        const parsed = parseMutationsToChanges(msg.mutations)
        store.changes.push(...parsed)
        if (parsed.length > 0) saveStore()
      }

      if (msg.event === 'popup-ping') {
        sendStats(ws)
      }

      if (msg.event === 'popup-recording-start') {
        recordingActive = true
        broadcast({ event: 'recording-capture-before' })
        ws.send(JSON.stringify({ event: 'recording-armed' }))
      }

      if (msg.event === 'popup-recording-stop') {
        broadcast({ event: 'recording-capture-after' })
      }

      if (msg.event === 'recording-started') {
        process.stderr.write(`[ws-daemon] запись: snapshot «до» (${msg.elementCount} элементов, ${msg.rootSelector})\n`)
      }

      if (msg.event === 'recording-result') {
        recordingActive = false
        setChangesFromRecording(msg.changes ?? [])
        process.stderr.write(`[ws-daemon] запись: ${msg.changes?.length ?? 0} правок после diff\n`)
        broadcast({ event: 'recording-finished', total: msg.changes?.length ?? 0 })
      }

      if (msg.event === 'recording-error') {
        recordingActive = false
        ws.send(JSON.stringify({ event: 'recording-error', message: msg.message }))
      }

      if (msg.event === 'popup-clear') {
        recordingActive = false
        store.changes = []
        clearSeen()
        saveStore()
        broadcast({ event: 'clear-visbug-storage' })
      }
    } catch (err) {
      process.stderr.write(`[ws-daemon] parse error: ${err.message}\n`)
    }
  })
})

process.stderr.write('[ws-daemon] запущен — ожидание подключений\n')
