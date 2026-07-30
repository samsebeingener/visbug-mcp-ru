/**
 * actions/schema.js — typed Actions v1 (Onlook-adjacent, recorder-only).
 */

export const ACTIONS_SCHEMA_VERSION = 1

/** v5: write-recipes — одна готовая CSS-правка на узел */
export const STORE_VERSION = 5

/** @typedef {'MOVE' | 'STYLE' | 'TEXT'} ActionType */

/**
 * @typedef {object} ActionTarget
 * @property {string | null} [visbugSrc]
 * @property {string | null} [stableSelector]
 * @property {string | null} [diagnosticSelector]
 * @property {string | null} [tag]
 * @property {string | null} [fileHint]
 */

/**
 * @typedef {object} StyleChange
 * @property {string} prop
 * @property {string | null} old
 * @property {string | null} new
 * @property {'set' | 'remove'} op
 */

const NOISE_STYLE_PROPS = new Set([
  'cursor',
  'user-select',
  'transition',
  'will-change',
  'position',
  'left',
  'top',
  'right',
  'bottom',
])

/**
 * @param {string} prop
 * @param {string | null | undefined} value
 * @returns {'set' | 'remove'}
 */
export function styleOp(prop, value) {
  if (value == null || value === '' || value === 'undefined' || value === 'null') {
    return 'remove'
  }
  if (NOISE_STYLE_PROPS.has(prop)) return 'remove'
  return 'set'
}

/**
 * @param {object} change — normalized store change
 * @returns {ActionTarget}
 */
export function buildActionTarget(change) {
  return {
    visbugSrc: change.visbugSrc ?? null,
    stableSelector: change.shortSelector ?? change.stableId ?? null,
    diagnosticSelector: change.diagnosticSelector ?? change.selector ?? null,
    tag: change.tag ?? null,
    fileHint: change.fileHint ?? null,
  }
}
