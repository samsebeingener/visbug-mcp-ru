/**
 * format.js — человекочитаемый вывод Actions для MCP.
 */

import { ACTION_TYPES } from './schema.js'
import { extractSectionKey } from '../parser.js'

const MISC_SECTION_LABEL = 'Прочее'

function formatOldValue(value) {
  if (value === null || value === undefined || value === '') return 'не задано'
  return String(value)
}

function shortSelector(selector) {
  const s = String(selector ?? '')
  if (s.length <= 72) return s
  return `${s.slice(0, 69)}…`
}

function formatMove(action, index) {
  const { x = 0, y = 0, unit = 'px' } = action.delta ?? {}
  const src = action.target?.visbugSrc ? ` (${action.target.visbugSrc})` : ''
  const ref = action.align?.reference
  const alignNote = ref
    ? `, выравнивание: ${shortSelector(ref.selector)} (${ref.edge})`
    : ''
  return `[${index}] ${shortSelector(action.target.selector)}${src} → сдвиг: x=${x}${unit}, y=${y}${unit}${alignNote}`
}

function formatStyle(action, index) {
  const parts = (action.changes ?? []).map((ch) => `${ch.prop}=${ch.value}`)
  return `[${index}] ${shortSelector(action.target.selector)} → стили: ${parts.join(', ')}`
}

function formatText(action, index) {
  return `[${index}] ${shortSelector(action.target.selector)} → текст: "${action.newValue}" (было: "${formatOldValue(action.oldValue)}")`
}

function formatAttribute(action, index) {
  return `[${index}] ${shortSelector(action.target.selector)} → атрибут ${action.attribute}="${action.newValue}" (было: "${formatOldValue(action.oldValue)}")`
}

function formatActionLine(action, index) {
  switch (action.type) {
    case ACTION_TYPES.MOVE:
      return formatMove(action, index)
    case ACTION_TYPES.STYLE:
      return formatStyle(action, index)
    case ACTION_TYPES.TEXT:
      return formatText(action, index)
    case ACTION_TYPES.ATTRIBUTE:
      return formatAttribute(action, index)
    default:
      return `[${index}] ${JSON.stringify(action)}`
  }
}

function groupActionsBySection(actions) {
  const groups = new Map()
  const order = []

  for (const action of actions) {
    const key = extractSectionKey(action.target?.selector ?? '') ?? MISC_SECTION_LABEL
    if (!groups.has(key)) {
      groups.set(key, [])
      order.push(key)
    }
    groups.get(key).push(action)
  }

  const miscIdx = order.indexOf(MISC_SECTION_LABEL)
  if (miscIdx !== -1 && miscIdx !== order.length - 1) {
    order.splice(miscIdx, 1)
    order.push(MISC_SECTION_LABEL)
  }

  return { groups, order }
}

/**
 * @param {{ actions?: object[], artifacts?: object[] }} store
 * @returns {string}
 */
export function formatActionsForMcp(store) {
  const pending = (store?.actions ?? []).filter((action) => !action.applied)
  if (!pending.length) return ''

  const { groups, order } = groupActionsBySection(pending)
  const blocks = []
  let index = 0

  for (const key of order) {
    const sectionActions = groups.get(key) ?? []
    const header = key === MISC_SECTION_LABEL ? `## ${MISC_SECTION_LABEL}` : `## #${key}`
    const lines = sectionActions.map((action) => formatActionLine(action, index++))
    blocks.push([header, ...lines].join('\n'))
  }

  const artifacts = store?.artifacts ?? []
  if (artifacts.length) {
    blocks.push(`🛈 Пропущен шум VisBug: ${artifacts.length}`)
  }

  return blocks.join('\n\n')
}
