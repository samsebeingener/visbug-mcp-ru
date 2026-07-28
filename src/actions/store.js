/**
 * store.js — загрузка/сохранение буфера Actions v2.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { legacyChangesToActions } from './compile.js'
import { actionsToLegacyChanges } from './flatten.js'

export const STORE_FORMAT = 2

function emptyStore(meta = {}) {
  return {
    version: STORE_FORMAT,
    sessionId: meta.sessionId ?? null,
    recordedAt: meta.recordedAt ?? null,
    workspace: meta.workspace ?? null,
    actions: [],
    artifacts: [],
  }
}

/**
 * @param {object} raw
 */
export function normalizeStore(raw) {
  if (!raw || typeof raw !== 'object') return emptyStore()

  if (raw.version === STORE_FORMAT && Array.isArray(raw.actions)) {
    return {
      version: STORE_FORMAT,
      sessionId: raw.sessionId ?? null,
      recordedAt: raw.recordedAt ?? null,
      workspace: raw.workspace ?? null,
      actions: raw.actions,
      artifacts: Array.isArray(raw.artifacts) ? raw.artifacts : [],
    }
  }

  if (Array.isArray(raw.changes)) {
    const meta = {
      sessionId: raw.sessionId,
      recordedAt: raw.recordedAt,
      workspace: raw.workspace,
    }
    const compiled = legacyChangesToActions(raw.changes, meta)
    return {
      version: STORE_FORMAT,
      sessionId: meta.sessionId ?? null,
      recordedAt: meta.recordedAt ?? null,
      workspace: meta.workspace ?? null,
      actions: compiled.actions,
      artifacts: compiled.artifacts,
    }
  }

  return emptyStore(raw)
}

/**
 * @param {string} filePath
 */
export function loadStore(filePath) {
  if (!existsSync(filePath)) return emptyStore()
  const raw = JSON.parse(readFileSync(filePath, 'utf8'))
  return normalizeStore(raw)
}

/**
 * @param {string} filePath
 * @param {object} data
 */
export function saveStore(filePath, data) {
  const normalized = normalizeStore(data)
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(normalized, null, 2), 'utf8')
  return normalized
}

/**
 * @param {object} store
 * @returns {object[]}
 */
export function getLegacyChanges(store) {
  const normalized = normalizeStore(store)
  return actionsToLegacyChanges(normalized.actions)
}

/**
 * @param {object} store
 * @returns {object[]}
 */
export function getPendingChanges(store) {
  return getLegacyChanges(store).filter((change) => !change.applied)
}

/**
 * После auto-apply: переносит applied с legacy changes обратно в actions.
 * @param {object} store
 * @param {object[]} legacyChanges
 */
export function syncAppliedFromLegacy(store, legacyChanges) {
  const normalized = normalizeStore(store)

  for (const action of normalized.actions) {
    const slices = actionsToLegacyChanges([action])
    if (!slices.length) {
      action.applied = true
      continue
    }
    action.applied = slices.every((slice) => {
      const match = legacyChanges.find(
        (legacy) => legacy.type === slice.type
          && legacy.selector === slice.selector
          && (slice.type !== 'style' || legacy.property === slice.property)
          && (slice.type !== 'attribute' || legacy.attribute === slice.attribute),
      )
      return match ? Boolean(match.applied) : Boolean(slice.applied)
    })
  }

  return normalized
}

/**
 * @param {object} store
 * @param {object[]} legacyChanges
 * @param {object} [meta]
 */
export function setChangesFromRecording(store, legacyChanges, meta = {}) {
  const compiled = legacyChangesToActions(legacyChanges, meta)
  const base = normalizeStore(store)

  return {
    ...base,
    version: STORE_FORMAT,
    sessionId: meta.sessionId ?? base.sessionId ?? null,
    recordedAt: meta.recordedAt ?? new Date().toISOString(),
    workspace: meta.workspace ?? base.workspace ?? null,
    actions: compiled.actions,
    artifacts: compiled.artifacts,
  }
}
