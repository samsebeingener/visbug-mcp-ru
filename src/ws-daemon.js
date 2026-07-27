/**
 * ws-daemon.js — фоновый WebSocket-сервер (127.0.0.1:4844).
 * Режим по умолчанию: «Запись» (snapshot до/после).
 */

import { WebSocketServer } from 'ws'
import { parseMutationsToChanges, formatChangesFromStore, clearSeen, restoreSeen } from './parser.js'
import { loadConfig } from './config.js'
import { handlePostRecording } from './auto-agent.js'
import { getCliHealthForUi } from './cli-resolver.js'
import { checkForUpdatesIfDue } from './update-check.js'
import { execSync } from 'child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const DAEMON_VERSION = '0.6.9'
const STORE_DIR = join(homedir(), '.visbug-mcp')
const STORE_FILE = join(STORE_DIR, 'changes.json')
const WS_PORT = 4844
const LIVE_MUTATIONS_ENABLED = false

const store = { changes: [] }
let recordingActive = false
let stopWatchdog = null
const STOP_TIMEOUT_MS = 4000

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
  const config = loadConfig()
  ws.send(JSON.stringify({
    event: 'stats',
    total: pending.length,
    changesText,
    recording: recordingActive,
    mode: 'record',
    health: buildHealthSnapshot(config),
  }))
}

function buildHealthSnapshot(config) {
  const mcpPath = join(homedir(), '.cursor', 'mcp.json')
  let mcpOk = false
  try {
    if (existsSync(mcpPath)) {
      const mcp = JSON.parse(readFileSync(mcpPath, 'utf8'))
      const servers = mcp.mcpServers ?? mcp
      const entry = servers['visbug-mcp'] ?? servers.visbug_mcp
      mcpOk = Boolean(entry?.args?.some?.((a) => String(a).includes('server.js')))
    }
  } catch {}

  return {
    autoAgentEnabled: Boolean(config.autoAgent?.enabled),
    spawnCli: config.autoAgent?.spawnCli === true,
    workspace: config.autoAgent?.workspace || '',
    mcpConfigured: mcpOk,
    repoRoot: config.repoRoot || '',
    extensionPath: config.repoRoot ? join(config.repoRoot, 'extension') : '',
    visbugStoreUrl:
      'https://chromewebstore.google.com/detail/visbug/cdockenadnadldjbbgcallicgledbeoc',
    chromeExtensionsUrl: 'chrome://extensions',
  }
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
  process.stderr.write(`[ws-daemon] v${DAEMON_VERSION} ws://127.0.0.1:${WS_PORT} spawnCli=${loadConfig().autoAgent?.spawnCli === true}\n`)
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

function clearStopWatchdog() {
  if (stopWatchdog) {
    clearTimeout(stopWatchdog)
    stopWatchdog = null
  }
}

function failRecording(message) {
  recordingActive = false
  clearStopWatchdog()
  broadcast({ event: 'recording-error', message })
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

      if (msg.event === 'popup-health') {
        const config = loadConfig()
        const cli = getCliHealthForUi(config)
        ws.send(JSON.stringify({
          event: 'health',
          ...buildHealthSnapshot(config),
          cursorCli: cli.ok,
          cursorCliCommand: cli.command,
        }))
      }

      if (msg.event === 'popup-recording-start') {
        clearStopWatchdog()
        recordingActive = true
        ws.send(JSON.stringify({ event: 'recording-armed' }))
        const config = loadConfig()
        checkForUpdatesIfDue(config).then((u) => {
          if (u.notify && u.updateAvailable) {
            ws.send(JSON.stringify({
              event: 'update-available',
              current: u.current,
              latest: u.latest,
              changelog: u.changelog ?? '',
              message: `Доступно обновление ${u.current} → ${u.latest}. В Cursor: /visbug-mcp-update`,
            }))
          }
        }).catch(() => {})
      }

      if (msg.event === 'popup-recording-stop') {
        clearStopWatchdog()
        stopWatchdog = setTimeout(() => {
          if (!recordingActive) return
          failRecording(
            'Нет ответа от страницы. Обновите вкладку (F5), снова «Начать запись» → правки → «Стоп».',
          )
        }, STOP_TIMEOUT_MS)
      }

      if (msg.event === 'recording-started') {
        process.stderr.write(`[ws-daemon] запись: snapshot «до» (${msg.elementCount} элементов, ${msg.rootSelector})\n`)
      }

      if (msg.event === 'recording-result') {
        recordingActive = false
        clearStopWatchdog()
        setChangesFromRecording(msg.changes ?? [])
        const total = (msg.changes ?? []).filter(c => !c.applied).length
        process.stderr.write(`[ws-daemon] запись: ${msg.changes?.length ?? 0} правок после diff\n`)
        broadcast({ event: 'recording-finished', total })
        handlePostRecording({ total, url: msg.url }, store.changes).then((result) => {
          saveStore()
          if (result.action === 'auto-applied') {
            broadcast({
              event: 'auto-applied',
              applied: result.applied,
              skipped: result.skipped,
              files: result.files,
              remaining: 0,
            })
          } else if (result.action === 'auto-applied-partial') {
            broadcast({
              event: 'apply-incomplete',
              applied: result.applied,
              remaining: result.remaining,
              message: `В файлы: ${result.applied}. Осталось ${result.remaining} → /visbug-apply в Cursor (без терминала)`,
            })
          } else if (result.spawned) {
            broadcast({
              event: 'auto-agent-started',
              workspace: result.workspace,
              total: result.remaining ?? total,
              message: 'Агент обрабатывает остаток в фоне…',
            })
          } else if (result.action === 'failed') {
            broadcast({
              event: 'apply-incomplete',
              applied: result.applied ?? 0,
              remaining: result.remaining ?? total,
              message: `Не применено: ${result.remaining ?? total}. Cursor → /visbug-apply (терминал не нужен)`,
            })
          } else if (result.action !== 'disabled') {
            broadcast({ event: 'auto-agent-skipped', reason: result.reason ?? result.agentReason, total })
          }
        })
      }

      if (msg.event === 'recording-error') {
        failRecording(msg.message ?? 'Ошибка записи')
      }

      if (msg.event === 'popup-recording-cancel') {
        recordingActive = false
        clearStopWatchdog()
        sendStats(ws)
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
