/**
 * project-store.js — per-project буфер { changes, workspace }.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getStoreDir } from './config.js'
import { getProjects } from './projects.js'

export const STORE_FORMAT = 2

function getLegacyStoreFile() {
  return join(getStoreDir(), 'changes.json')
}

function getLegacyMigratedFile() {
  return join(getStoreDir(), 'changes.json.migrated')
}

export function getProjectsRoot() {
  return join(getStoreDir(), 'projects')
}

export function sanitizeProjectId(projectId) {
  return String(projectId ?? 'default')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'default'
}

export function getProjectStorePath(projectId) {
  const id = sanitizeProjectId(projectId)
  return join(getProjectsRoot(), id, 'changes.json')
}

/**
 * @param {string} workspace
 * @param {object} [config]
 */
export function findProjectIdByWorkspace(workspace, config = {}) {
  const ws = String(workspace ?? '').trim().replace(/\\/g, '/')
  if (!ws) return null
  const project = getProjects(config).find(
    (p) => p.workspace.replace(/\\/g, '/') === ws,
  )
  return project?.id ?? null
}

/**
 * @param {{ project?: { id?: string }, workspace?: string, projectId?: string }} input
 * @param {object} [config]
 */
export function resolveProjectId(input = {}, config = {}) {
  if (input.projectId) return sanitizeProjectId(input.projectId)
  if (input.project?.id) return sanitizeProjectId(input.project.id)
  const ws = input.workspace ?? input.project?.workspace
  const fromWs = findProjectIdByWorkspace(ws, config)
  if (fromWs) return sanitizeProjectId(fromWs)
  if (ws) return sanitizeProjectId(ws.split(/[/\\]/).filter(Boolean).pop())
  return 'default'
}

function normalizeStore(raw, projectId) {
  if (!raw || typeof raw !== 'object') {
    return { version: STORE_FORMAT, projectId, changes: [], workspace: null }
  }

  if (Array.isArray(raw.changes)) {
    return {
      version: STORE_FORMAT,
      projectId: sanitizeProjectId(raw.projectId ?? projectId),
      changes: raw.changes,
      workspace: raw.workspace ?? null,
    }
  }

  // legacy v3 actions store — не конвертируем, только сохраняем workspace
  return {
    version: STORE_FORMAT,
    projectId: sanitizeProjectId(raw.projectId ?? projectId),
    changes: [],
    workspace: raw.workspace ?? null,
    legacyFormat: raw.version === 3 ? 'actions-v3' : null,
  }
}

/**
 * @param {string} projectId
 */
export function loadProjectStore(projectId) {
  const id = sanitizeProjectId(projectId)
  const path = getProjectStorePath(id)
  if (!existsSync(path)) {
    return normalizeStore(null, id)
  }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    return normalizeStore(raw, id)
  } catch {
    return normalizeStore(null, id)
  }
}

/**
 * @param {string} projectId
 * @param {{ changes?: object[], workspace?: string | null }} store
 */
export function saveProjectStore(projectId, store) {
  const id = sanitizeProjectId(projectId)
  const path = getProjectStorePath(id)
  const normalized = normalizeStore({
    version: STORE_FORMAT,
    projectId: id,
    changes: store.changes ?? [],
    workspace: store.workspace ?? null,
  }, id)
  mkdirSync(getProjectsRoot(), { recursive: true })
  mkdirSync(join(getProjectsRoot(), id), { recursive: true })
  writeFileSync(path, JSON.stringify(normalized, null, 2), 'utf8')
  return normalized
}

/**
 * Однократная миграция ~/.visbug-mcp/changes.json → projects/<id>/changes.json
 * @param {object} [config]
 */
export function migrateLegacyGlobalStore(config = {}) {
  const legacyStoreFile = getLegacyStoreFile()
  const legacyMigrated = getLegacyMigratedFile()
  if (!existsSync(legacyStoreFile) || existsSync(legacyMigrated)) {
    return { migrated: false, reason: 'no-legacy' }
  }

  let raw
  try {
    raw = JSON.parse(readFileSync(legacyStoreFile, 'utf8'))
  } catch {
    return { migrated: false, reason: 'parse-error' }
  }

  const store = normalizeStore(raw, resolveProjectId({ workspace: raw.workspace }, config))
  const projectId = store.projectId
  const targetPath = getProjectStorePath(projectId)

  if (!existsSync(targetPath)) {
    saveProjectStore(projectId, store)
  }

  try {
    renameSync(legacyStoreFile, legacyMigrated)
  } catch {
    writeFileSync(legacyMigrated, readFileSync(legacyStoreFile, 'utf8'), 'utf8')
  }

  return { migrated: true, projectId, targetPath }
}

export function ensureProjectsRoot() {
  mkdirSync(getProjectsRoot(), { recursive: true })
}

export { getLegacyStoreFile, getLegacyMigratedFile }
