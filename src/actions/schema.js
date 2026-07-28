/**
 * schema.js — типы Actions, target и валидация.
 */

import { randomUUID } from 'node:crypto'

export const ACTION_TYPES = {
  MOVE: 'MOVE',
  STYLE: 'STYLE',
  TEXT: 'TEXT',
  ATTRIBUTE: 'ATTRIBUTE',
}

const ACTION_TYPE_SET = new Set(Object.values(ACTION_TYPES))

export function createActionId() {
  return randomUUID()
}

/**
 * @param {{ selector?: string, tag?: string, visbugSrc?: string | null, url?: string | null }} input
 */
export function normalizeTarget({ selector, tag, visbugSrc, url } = {}) {
  const target = {
    selector: String(selector ?? '').trim(),
    visbugSrc: visbugSrc ?? null,
    url: url ?? null,
  }
  if (tag) target.tag = String(tag).toLowerCase()
  return target
}

/**
 * @param {object} action
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateAction(action) {
  const errors = []

  if (!action || typeof action !== 'object') {
    return { ok: false, errors: ['action must be an object'] }
  }

  if (!action.id) errors.push('missing id')
  if (!ACTION_TYPE_SET.has(action.type)) errors.push(`invalid type: ${action.type}`)
  if (!action.target || typeof action.target !== 'object') {
    errors.push('missing target')
  } else if (!action.target.selector) {
    errors.push('missing target.selector')
  }

  switch (action.type) {
    case ACTION_TYPES.MOVE:
      if (!action.delta || typeof action.delta !== 'object') {
        errors.push('MOVE missing delta')
      } else {
        if (action.delta.x == null && action.delta.y == null) {
          errors.push('MOVE delta must include x and/or y')
        }
      }
      break
    case ACTION_TYPES.STYLE:
      if (!Array.isArray(action.changes) || action.changes.length === 0) {
        errors.push('STYLE missing changes')
      } else {
        for (const [i, ch] of action.changes.entries()) {
          if (!ch?.prop) errors.push(`STYLE changes[${i}] missing prop`)
          if (ch?.value === undefined) errors.push(`STYLE changes[${i}] missing value`)
        }
      }
      break
    case ACTION_TYPES.TEXT:
      if (action.newValue === undefined) errors.push('TEXT missing newValue')
      break
    case ACTION_TYPES.ATTRIBUTE:
      if (!action.attribute) errors.push('ATTRIBUTE missing attribute')
      if (action.newValue === undefined) errors.push('ATTRIBUTE missing newValue')
      break
    default:
      break
  }

  return { ok: errors.length === 0, errors }
}
