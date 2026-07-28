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
import { detectWorkspaceLayout } from './auto-apply.js'
import { getProjects, resolveProjectForUrl } from './projects.js'
import { execSync } from 'child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { PACKAGE_VERSION } from './version.js'
const STORE_DIR = join(homedir(), '.visbug-mcp')
const STORE_FILE = join(STORE_DIR, 'changes.json')
const WS_PORT = 4844
const LIVE_MUTATIONS_ENABLED = false

const store = { changes: [] }
let recordingActive = false
let recordingProject = null
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

function sendStats(ws, url = '') {
  syncFromFile()
  const pending = store.changes.filter(c => !c.applied)
  const changesText = pending.length === 0 ? '' : formatChangesFromStore(store.changes)
  const config = loadConfig()
  const cli = getCliHealthForUi(config)
  ws.send(JSON.stringify({
    event: 'stats',
    total: pending.length,
    changesText,
    recording: recordingActive,
    mode: 'record',
    health: {
      ...buildHealthSnapshot(config, url),
      cursorCli: cli.ok,
      cursorCliCommand: cli.command,
    },
  }))
}

function buildHealthSnapshot(config, url = '') {
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

  const routing = resolveProjectForUrl(config, url)
  const targetProject = routing.project
  const workspaceKind = targetProject ? detectWorkspaceLayout(targetProject.workspace) : 'unknown'
  return {
    autoAgentEnabled: Boolean(config.autoAgent?.enabled),
    spawnCli: config.autoAgent?.spawnCli === true,
    workspace: config.autoAgent?.workspace || '',
    mcpConfigured: mcpOk,
    mcpOptional: true,
    projects: getProjects(config).map(({ id, name, origins }) => ({ id, name, origins })),
    targetProject: targetProject
      ? { id: targetProject.id, name: targetProject.name, workspace: targetProject.workspace, origin: routing.origin }
      : null,
    targetProjectReason: routing.reason,
    workspaceKind,
    autoApplyReady: Boolean(config.autoAgent?.enabled && targetProject && workspaceKind !== 'unknown'),
    repoRoot: config.repoRoot || '',
    extensionPath: config.repoRoot ? join(config.repoRoot, 'extension') : '',
    visbugStoreUrl:
      'https://chromewebstore.google.com/detail/visbug/cdockenadnadldjbbgcallicgledbeoc',
    chromeExtensionsUrl: 'chrome://extensions',
  }
}

loadStore()

function freePort(port) {
  if (process.platform === 'win32') return
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
  process.stderr.write(`[ws-daemon] v${PACKAGE_VERSION} ws://127.0.0.1:${WS_PORT} spawnCli=${loadConfig().autoAgent?.spawnCli === true}\n`)
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

function clearChangesBuffer({ keepRecording = false } = {}) {
  if (!keepRecording) recordingActive = false
  store.changes = []
  clearSeen()
  saveStore()
  // clear-visbug-storage только когда запись НЕ идёт.
  // На старте записи keepRecording=true — иначе content-script сносит badge и snapshot «до».
  if (!keepRecording) {
    broadcast({ event: 'clear-visbug-storage' })
  }
  const config = loadConfig()
  broadcast({
    event: 'stats',
    total: 0,
    changesText: '',
    recording: keepRecording ? true : recordingActive,
    mode: 'record',
    health: buildHealthSnapshot(config),
  })
  process.stderr.write('[ws-daemon] буфер правок очищен\n')
}

function failRecording(message) {
  recordingActive = false
  recordingProject = null
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
        sendStats(ws, msg.url)
      }

      if (msg.event === 'popup-health') {
        const config = loadConfig()
        const cli = getCliHealthForUi(config)
        ws.send(JSON.stringify({
          event: 'health',
          ...buildHealthSnapshot(config, msg.url),
          cursorCli: cli.ok,
          cursorCliCommand: cli.command,
        }))
      }

      if (msg.event === 'popup-recording-start') {
        clearStopWatchdog()
        const routing = resolveProjectForUrl(loadConfig(), msg.url)
        if (!routing.project) {
          ws.send(JSON.stringify({
            event: 'recording-error',
            message: routing.reason === 'origin-unmapped'
              ? `Для ${routing.origin || 'этой страницы'} не назначена папка проекта. Запустите npm run setup и добавьте origin.`
              : 'Не удалось определить адрес страницы для записи.',
          }))
          return
        }
        clearChangesBuffer({ keepRecording: true })
        recordingActive = true
        recordingProject = routing.project
        ws.send(JSON.stringify({
          event: 'recording-armed',
          project: { name: routing.project.name, workspace: routing.project.workspace, origin: routing.origin },
        }))
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
        if (!recordingActive || !recordingProject) {
          process.stderr.write('[ws-daemon] ignored recording-result outside active session\n')
          return
        }
        const route = resolveProjectForUrl(loadConfig(), msg.url)
        if (route.project?.id !== recordingProject.id) {
          failRecording('Адрес результата не совпадает с проектом активной записи. Правки не применены.')
          return
        }
        const project = recordingProject
        recordingActive = false
        recordingProject = null
        clearStopWatchdog()
        setChangesFromRecording(msg.changes ?? [])
        const total = (msg.changes ?? []).filter(c => !c.applied).length
        process.stderr.write(`[ws-daemon] запись: ${msg.changes?.length ?? 0} правок после diff\n`)
        broadcast({ event: 'recording-finished', total })
        if (total > 0) broadcast({ event: 'auto-apply-started', total })
        handlePostRecording({
          total,
          url: msg.url,
          project,
          onAgentStarted: ({ workspace, total: agentTotal }) => broadcast({
            event: 'agent-fallback-started',
            workspace,
            total: agentTotal,
            message: `Cursor Agent разбирает ${agentTotal} сложных правок…`,
          }),
        }, store.changes).then((result) => {
          saveStore()
          const summary = result.summary
            || (result.applied > 0
              ? `Готово: ${result.applied} в файлы`
              : `Не применено: ${result.remaining ?? total}`)
          const payload = {
            applied: result.applied ?? 0,
            skipped: result.skipped ?? 0,
            artifacts: result.artifacts ?? 0,
            remaining: result.remaining ?? 0,
            files: result.files ?? [],
            writes: result.writes ?? [],
            failed: result.failed ?? [],
            summary,
            message: summary,
          }
          if (result.action === 'auto-applied') {
            broadcast({ event: 'auto-applied', ...payload, remaining: 0 })
          } else if (result.action === 'auto-applied-partial') {
            broadcast({
              event: 'apply-incomplete',
              ...payload,
              message: `${summary}\n\nОсталось ${result.remaining} → /visbug-apply в Cursor`,
            })
          } else if (result.spawned) {
            broadcast({
              event: 'agent-fallback-finished',
              workspace: result.workspace,
              total: result.remaining ?? total,
              applied: result.applied ?? 0,
              files: result.files ?? [],
              completion: result.completion === true,
              summary,
              message: result.completion
                ? `${summary}\n\nCursor Agent подтвердил ${result.applied ?? 0} правок.`
                : `${summary}\n\nCursor Agent без подтверждённого отчёта.`,
            })
          } else if (result.action === 'failed') {
            broadcast({
              event: 'apply-incomplete',
              ...payload,
              remaining: result.remaining ?? total,
              message: summary || `Не применено: ${result.remaining ?? total}. Cursor → /visbug-apply`,
            })
          } else if (result.action === 'disabled') {
            broadcast({
              event: 'auto-agent-skipped',
              reason: 'auto-agent выключен (npm run setup)',
              total,
              summary,
              message: summary,
            })
          } else {
            broadcast({
              event: 'auto-agent-skipped',
              reason: result.reason ?? result.agentReason ?? 'пропущено',
              total,
              summary,
              message: summary || result.reason,
            })
          }
        }).catch((err) => {
          process.stderr.write(`[ws-daemon] post-recording: ${err.message}\n`)
          broadcast({
            event: 'apply-incomplete',
            applied: 0,
            remaining: total,
            summary: `❌ Ошибка auto-apply: ${err.message}`,
            message: `Ошибка auto-apply: ${err.message}. Попробуйте /visbug-apply в Cursor.`,
          })
        })
      }

      if (msg.event === 'recording-error') {
        failRecording(msg.message ?? 'Ошибка записи')
      }

      if (msg.event === 'popup-recording-cancel') {
        recordingActive = false
        recordingProject = null
        clearStopWatchdog()
        sendStats(ws)
      }

      if (msg.event === 'popup-clear') {
        clearChangesBuffer({ keepRecording: false })
      }
    } catch (err) {
      process.stderr.write(`[ws-daemon] parse error: ${err.message}\n`)
    }
  })
})

process.stderr.write('[ws-daemon] запущен — ожидание подключений\n')
