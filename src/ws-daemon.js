/**
 * ws-daemon.js
 *
 * Serveur WebSocket autonome — à lancer une fois au démarrage.
 * Capture les mutations VisBug depuis l'extension Chrome.
 * Indépendant du serveur MCP (server.js).
 */

import { WebSocketServer } from 'ws'
import { parseMutationsToChanges, formatForClaude, clearSeen, restoreSeen } from './parser.js'
import { execSync } from 'child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const STORE_DIR = join(homedir(), '.visbug-mcp')
const STORE_FILE = join(STORE_DIR, 'changes.json')
const WS_PORT = 4844
const STARTUP_GRACE_MS = 2000

// ─── Store ────────────────────────────────────────────────────────────────────

const store = { changes: [] }

function loadStore() {
  try {
    mkdirSync(STORE_DIR, { recursive: true })
    const data = JSON.parse(readFileSync(STORE_FILE, 'utf8'))
    store.changes = data.changes ?? []
    restoreSeen(store.changes)
    process.stderr.write(`[ws-daemon] store restauré : ${store.changes.length} changement(s)\n`)
  } catch {
    // Fichier absent — store vide
  }
}

function saveStore() {
  try {
    mkdirSync(STORE_DIR, { recursive: true })
    writeFileSync(STORE_FILE, JSON.stringify({ changes: store.changes }, null, 2))
  } catch (err) {
    process.stderr.write(`[ws-daemon] erreur sauvegarde : ${err.message}\n`)
  }
}

function syncFromFile() {
  try {
    const data = JSON.parse(readFileSync(STORE_FILE, 'utf8'))
    const fileChanges = data.changes ?? []
    // Le fichier a été modifié externellement (MCP apply/clear)
    if (fileChanges.length !== store.changes.length) {
      store.changes = fileChanges
      clearSeen()
      restoreSeen(store.changes)
    } else {
      // Synchroniser les flags applied (MCP apply_changes)
      for (let i = 0; i < fileChanges.length; i++) {
        if (fileChanges[i].applied) store.changes[i].applied = true
      }
    }
  } catch {}
}

loadStore()

// ─── WebSocket ────────────────────────────────────────────────────────────────

function freePort(port) {
  try {
    const pids = execSync(`lsof -ti :${port} 2>/dev/null || true`).toString().trim()
    if (pids) {
      pids.split('\n').filter(Boolean).forEach(pid => {
        try { execSync(`kill ${pid}`) } catch {}
      })
      process.stderr.write(`[ws-daemon] freed port ${port} (killed: ${pids.replace(/\n/g, ' ')})\n`)
    }
  } catch {}
}

freePort(WS_PORT)

const wss = new WebSocketServer({ port: WS_PORT })

wss.on('listening', () => {
  process.stderr.write(`[ws-daemon] WebSocket listening on ws://127.0.0.1:${WS_PORT}\n`)
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
  let ignoreUntil = Date.now() + STARTUP_GRACE_MS

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString())

      if (msg.event === 'mutations') {
        if (Date.now() < ignoreUntil) return // ignore page-load noise
        const parsed = parseMutationsToChanges(msg.mutations)
        store.changes.push(...parsed)
        if (parsed.length > 0) saveStore()
      }

      if (msg.event === 'popup-ping') {
        syncFromFile() // récupère les changements apply/clear du MCP
        const pending = store.changes.filter(c => !c.applied)
        const changesText = pending.length === 0 ? '' : formatForClaude(pending)
        ws.send(JSON.stringify({ event: 'stats', total: pending.length, changesText }))
      }

      if (msg.event === 'popup-start-recording') {
        ignoreUntil = 0
        ws.send(JSON.stringify({ event: 'recording-started' }))
      }

      if (msg.event === 'popup-clear') {
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

process.stderr.write('[ws-daemon] démarré — en attente de connexions\n')