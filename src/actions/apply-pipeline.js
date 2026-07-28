/**
 * apply-pipeline.js — Actions v2 → auto-apply в workspace (MCP apply_actions).
 */

import { existsSync } from 'fs'
import { autoApplyWorkspace } from '../auto-apply.js'
import { actionsToLegacyChanges } from './flatten.js'
import { normalizeStore, syncAppliedFromLegacy } from './store.js'

/**
 * @param {object} store
 * @param {{ actionIds?: string[], indices?: number[] }} options
 * @returns {object[]}
 */
export function pickActionsForApply(store, options = {}) {
  const normalized = normalizeStore(store)
  const pending = normalized.actions.filter((action) => !action.applied)
  const { actionIds, indices } = options

  if (Array.isArray(actionIds) && actionIds.length > 0) {
    const idSet = new Set(actionIds.map(String))
    return pending.filter((action) => idSet.has(action.id))
  }

  if (Array.isArray(indices) && indices.length > 0) {
    return indices
      .map((i) => pending[Number(i)])
      .filter(Boolean)
  }

  return pending
}

/**
 * @param {object} store
 * @param {string} workspace
 * @param {{
 *   actionIds?: string[],
 *   indices?: number[],
 *   markOnly?: boolean,
 * }} [options]
 */
export function applyStoreActions(store, workspace, options = {}) {
  const normalized = normalizeStore(store)
  const selected = pickActionsForApply(normalized, options)

  if (!workspace?.trim()) {
    return {
      ok: false,
      reason: 'workspace missing',
      store: normalized,
      applied: 0,
      marked: 0,
      files: [],
      writes: [],
      failed: [{ reason: 'workspace missing' }],
      summary: '❌ workspace не задан',
    }
  }

  if (!existsSync(workspace)) {
    return {
      ok: false,
      reason: 'workspace not found',
      store: normalized,
      applied: 0,
      marked: 0,
      files: [],
      writes: [],
      failed: [{ reason: `workspace не найден: ${workspace}` }],
      summary: `❌ workspace не найден: ${workspace}`,
    }
  }

  if (!selected.length) {
    return {
      ok: true,
      reason: 'nothing to apply',
      store: normalized,
      applied: 0,
      marked: 0,
      files: [],
      writes: [],
      failed: [],
      summary: 'Нет pending actions для применения.',
    }
  }

  if (options.markOnly) {
    for (const action of selected) {
      action.applied = true
    }
    return {
      ok: true,
      reason: 'mark-only',
      store: normalized,
      applied: 0,
      marked: selected.length,
      files: [],
      writes: [],
      failed: [],
      summary: `Помечено как применённое: ${selected.length} actions (файлы не менялись)`,
    }
  }

  const legacyChanges = actionsToLegacyChanges(selected)
  const result = autoApplyWorkspace(workspace, legacyChanges)
  const nextStore = syncAppliedFromLegacy(normalized, legacyChanges)

  return {
    ok: result.failed.length === 0 && result.applied > 0,
    reason: result.applied > 0 ? 'applied' : 'apply-failed',
    store: nextStore,
    applied: result.applied,
    marked: 0,
    skipped: result.skipped,
    artifacts: result.artifacts,
    files: result.files,
    writes: result.writes,
    failed: result.failed,
    summary: result.summary,
  }
}
