/**
 * ws-daemon.js — фоновый WebSocket (127.0.0.1:4844).
 * Модель mambari: live-захват мутаций VisBug → буфер → копирование в Cursor.
 * Файлы проекта не меняет.
 */

import { WebSocketServer } from 'ws'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { execSync } from 'child_process'
import { parseMutationsToChanges, formatChangesFromStore, clearSeen, restoreSeen } from './parser.js'
import { compileChangesToActions } from './actions/compile.js'
import { STORE_VERSION } from './actions/schema.js'
import { loadConfig } from './config.js'
import { getProjects, resolveProjectForUrl } from './projects.js'
import {
  ensureProjectsRoot,
  getProjectStorePath,
  migrateLegacyGlobalStore,
  resolveProjectId,
  sanitizeProjectId,
} from './project-store.js'
import { getLegacyChanges, loadProjectStore } from './project-store-read.js'
import { PACKAGE_VERSION } from './version.js'

const WS_PORT = 4844
const STARTUP_GRACE_MS = 2000

ensureProjectsRoot()
migrateLegacyGlobalStore(loadConfig())

/** @type {Map<string, { changes: object[], stamps: object[], workspace: string | null }>} */
const buffers = new Map()
let currentProjectId = null

function loadBuffer(projectId) {
  const id = sanitizeProjectId(projectId)
  if (buffers.has(id)) return buffers.get(id)

  const path = getProjectStorePath(id)
  let changes = []
  let stamps = []
  let workspace = null

  if (existsSync(path)) {
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8'))
      if (Array.isArray(raw.changes)) {
        changes = raw.changes
        workspace = raw.workspace ?? null
        stamps = Array.isArray(raw.stamps) ? raw.stamps : []
      } else {
        changes = getLegacyChanges(loadProjectStore(id))
        workspace = raw.workspace ?? loadProjectStore(id).workspace ?? null
      }
    } catch {
      changes = []
    }
  }

  const entry = { changes, stamps, workspace }
  buffers.set(id, entry)
  clearSeen()
  restoreSeen(changes)
  return entry
}

function saveBuffer(projectId) {
  const id = sanitizeProjectId(projectId)
  const entry = buffers.get(id)
  if (!entry) return
  const path = getProjectStorePath(id)
  const pending = entry.changes.filter((c) => !c.applied)
  writeFileSync(path, JSON.stringify({
    version: STORE_VERSION,
    changes: entry.changes,
    stamps: entry.stamps ?? [],
    actions: compileChangesToActions(pending),
    workspace: entry.workspace,
    projectId: id,
  }, null, 2), 'utf8')
}

function resolveProjectIdFromUrl(url = '') {
  const config = loadConfig()
  const routing = resolveProjectForUrl(config, url)
  if (routing.project?.id) return sanitizeProjectId(routing.project.id)
  return resolveProjectId({ workspace: config.autoAgent?.workspace }, config)
}

function ensureProject(url = '') {
  const projectId = resolveProjectIdFromUrl(url)
  if (projectId !== currentProjectId) {
    currentProjectId = projectId
    loadBuffer(projectId)
  }
  return projectId
}

function syncBufferFromFile(projectId = currentProjectId) {
  if (!projectId) return
  const path = getProjectStorePath(projectId)
  if (!existsSync(path)) return
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    const fileChanges = Array.isArray(raw.changes) ? raw.changes : getLegacyChanges(loadProjectStore(projectId))
    const entry = loadBuffer(projectId)
    if (fileChanges.length !== entry.changes.length) {
      entry.changes = fileChanges
      clearSeen()
      restoreSeen(fileChanges)
      return
    }
    for (let i = 0; i < fileChanges.length; i++) {
      if (fileChanges[i]?.applied) entry.changes[i].applied = true
    }
  } catch {}
}

function pendingChanges(projectId) {
  return loadBuffer(projectId).changes.filter((c) => !c.applied)
}

function formatBufferText(projectId) {
  const pending = pendingChanges(projectId)
  if (!pending.length) return ''
  const entry = loadBuffer(projectId)
  return formatChangesFromStore(pending, { workspace: entry.workspace ?? null, stamps: entry.stamps ?? [] })
}

function buildHealthSnapshot(config, url = '') {
  const routing = resolveProjectForUrl(config, url)
  const targetProject = routing.project
  return {
    mcpConfigured: true,
    mcpOptional: true,
    projects: getProjects(config).map(({ id, name, origins }) => ({ id, name, origins })),
    targetProject: targetProject
      ? {
        id: targetProject.id,
        name: targetProject.name,
        workspace: targetProject.workspace,
        origin: routing.origin,
      }
      : null,
    targetProjectReason: routing.reason,
    projectReady: Boolean(targetProject),
    repoRoot: config.repoRoot || '',
    extensionPath: config.repoRoot ? `${config.repoRoot}/extension`.replace(/\\/g, '/') : '',
    visbugStoreUrl:
      'https://chromewebstore.google.com/detail/visbug/cdockenadnadldjbbgcallicgledbeoc',
    chromeExtensionsUrl: 'chrome://extensions',
  }
}

function freePort(port) {
  if (process.platform === 'win32') return
  try {
    const pids = execSync(`lsof -ti :${port} 2>/dev/null || true`).toString().trim()
    if (pids) {
      pids.split('\n').filter(Boolean).forEach((pid) => {
        try { execSync(`kill ${pid}`) } catch {}
      })
    }
  } catch {}
}

freePort(WS_PORT)

const wss = new WebSocketServer({ port: WS_PORT })

wss.on('listening', () => {
  process.stderr.write(`[ws-daemon] v${PACKAGE_VERSION} ws://127.0.0.1:${WS_PORT} (recorder-only)\n`)
})

wss.on('error', (err) => {
  process.stderr.write(`[ws-daemon] WebSocket error: ${err.message}\n`)
})

function broadcast(payload) {
  const msg = JSON.stringify(payload)
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(msg)
  })
}

function sendStats(ws, url = '') {
  const projectId = ensureProject(url)
  syncBufferFromFile(projectId)
  const pending = pendingChanges(projectId).length
  const config = loadConfig()
  ws.send(JSON.stringify({
    event: 'stats',
    total: pending,
    changesText: pending === 0 ? '' : formatBufferText(projectId),
    projectId,
    health: buildHealthSnapshot(config, url),
  }))
}

wss.on('connection', (ws) => {
  let ignoreUntil = Date.now() + STARTUP_GRACE_MS

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString())

      if (msg.event === 'mutations') {
        if (Date.now() < ignoreUntil) return
        const projectId = ensureProject(msg.url)
        const routing = resolveProjectForUrl(loadConfig(), msg.url)
        if (!routing.project) return

        const parsed = parseMutationsToChanges(msg.mutations)
        if (!parsed.length) return

        const entry = loadBuffer(projectId)
        entry.workspace = routing.project.workspace
        entry.changes.push(...parsed)
        // v0.26: auto-stamp штампы (dedup по id)
        if (Array.isArray(msg.stamps) && msg.stamps.length) {
          entry.stamps = entry.stamps ?? []
          const known = new Set(entry.stamps.map((s) => s?.id))
          for (const s of msg.stamps) {
            if (s?.id && !known.has(s.id)) {
              entry.stamps.push({ id: s.id, tag: s.tag, originalSelector: s.originalSelector })
              known.add(s.id)
            }
          }
        }
        saveBuffer(projectId)
        process.stderr.write(`[ws-daemon] +${parsed.length} mutation(s), pending=${pendingChanges(projectId).length}\n`)
      }

      if (msg.event === 'popup-ping') {
        sendStats(ws, msg.url)
      }

      if (msg.event === 'popup-health') {
        ensureProject(msg.url)
        const config = loadConfig()
        ws.send(JSON.stringify({
          event: 'health',
          ...buildHealthSnapshot(config, msg.url),
        }))
      }

      if (msg.event === 'popup-start-editing') {
        ignoreUntil = 0
        ws.send(JSON.stringify({ event: 'editing-armed' }))
      }

      if (msg.event === 'popup-clear') {
        const projectId = ensureProject(msg.url)
        const entry = loadBuffer(projectId)
        entry.changes = []
        entry.stamps = []
        clearSeen()
        saveBuffer(projectId)
        broadcast({ event: 'clear-visbug-storage' })
        sendStats(ws, msg.url)
        process.stderr.write('[ws-daemon] буфер очищен\n')
      }
    } catch (err) {
      process.stderr.write(`[ws-daemon] parse error: ${err.message}\n`)
    }
  })
})

process.stderr.write('[ws-daemon] запущен — ожидание подключений\n')
