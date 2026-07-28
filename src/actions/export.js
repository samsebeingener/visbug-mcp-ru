/**
 * export.js — структурированный payload Actions для MCP get_actions.
 */

import { formatActionsForMcp } from './format.js'
import { normalizeStore, STORE_FORMAT } from './store.js'

/**
 * @param {object} store
 * @param {{ includeApplied?: boolean }} [options]
 */
export function buildActionsPayload(store, options = {}) {
  const normalized = normalizeStore(store)
  const { includeApplied = false } = options
  const pending = normalized.actions.filter((action) => !action.applied)
  const actions = includeApplied ? normalized.actions : pending

  return {
    format: STORE_FORMAT,
    workspace: normalized.workspace,
    sessionId: normalized.sessionId,
    recordedAt: normalized.recordedAt,
    pendingCount: pending.length,
    actions,
    artifacts: normalized.artifacts ?? [],
    summary: formatActionsForMcp(normalized) || 'Нет правок.',
  }
}
