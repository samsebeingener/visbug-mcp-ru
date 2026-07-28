/**
 * flatten.js — Actions v2 → legacy changes[] (auto-apply backward compat).
 */

import { ACTION_TYPES } from './schema.js'

function formatPx(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) return String(value ?? '0px')
  if (String(value).includes('px')) return String(value)
  return `${num}px`
}

function baseChange(action) {
  return {
    selector: action.target?.selector ?? '',
    tag: action.target?.tag,
    url: action.target?.url,
    visbugSrc: action.target?.visbugSrc ?? null,
    applied: Boolean(action.applied),
    timestamp: action.timestamp,
  }
}

/**
 * @param {object[]} actions
 * @returns {object[]}
 */
export function actionsToLegacyChanges(actions) {
  const changes = []

  for (const action of actions ?? []) {
    const base = baseChange(action)

    switch (action.type) {
      case ACTION_TYPES.MOVE: {
        const delta = action.delta ?? {}
        const hasLeft = action.oldLeft !== undefined || delta.x !== 0
        const hasTop = action.oldTop !== undefined || delta.y !== 0
        const alignExtra = action.align ? { align: action.align } : {}

        if (hasLeft || delta.x !== 0) {
          changes.push({
            ...base,
            ...alignExtra,
            type: 'style',
            property: 'left',
            oldValue: action.oldLeft,
            newValue: formatPx(delta.x ?? 0),
          })
        }
        if (hasTop || delta.y !== 0) {
          changes.push({
            ...base,
            type: 'style',
            property: 'top',
            oldValue: action.oldTop,
            newValue: formatPx(delta.y ?? 0),
          })
        }
        break
      }
      case ACTION_TYPES.STYLE:
        for (const ch of action.changes ?? []) {
          changes.push({
            ...base,
            type: 'style',
            property: ch.prop,
            oldValue: ch.oldValue,
            newValue: ch.value,
          })
        }
        break
      case ACTION_TYPES.TEXT:
        changes.push({
          ...base,
          type: 'text',
          oldValue: action.oldValue,
          newValue: action.newValue,
        })
        break
      case ACTION_TYPES.ATTRIBUTE:
        changes.push({
          ...base,
          type: 'attribute',
          attribute: action.attribute,
          oldValue: action.oldValue,
          newValue: action.newValue,
        })
        break
      default:
        break
    }
  }

  return changes
}
