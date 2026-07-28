/**
 * compile.js — legacy changes[] → Actions v2.
 */

import {
  isDecorativeStyleChange,
  isVisbugArtifactProperty,
} from '../parser.js'
import { ACTION_TYPES, createActionId, normalizeTarget } from './schema.js'

const ARTIFACT_PROPERTIES = new Set([
  'cursor',
  'position',
  'transition',
  'transition-property',
  '--start',
  '--glow-mask',
])

function parseDeltaPx(value) {
  const m = String(value ?? '').trim().match(/^(-?\d+(?:\.\d+)?)(px)?$/i)
  return m ? Number(m[1]) : 0
}

function pickTarget(change) {
  return normalizeTarget({
    selector: change.selector,
    tag: change.tag,
    visbugSrc: change.visbugSrc,
    url: change.url,
  })
}

function isCompileArtifact(change) {
  if (change?.type !== 'style' || !change.property) return false
  if (isDecorativeStyleChange(change)) return true
  if (isVisbugArtifactProperty(change.property)) return true
  if (ARTIFACT_PROPERTIES.has(change.property)) return true
  if (String(change.property).startsWith('--')) return true
  return false
}

function toArtifact(change) {
  return {
    type: 'VISBUG_NOISE',
    selector: change.selector ?? '',
    property: change.property,
    tag: change.tag,
    oldValue: change.oldValue,
    newValue: change.newValue,
  }
}

function moveApplied({ left, top }) {
  const parts = [left, top].filter(Boolean)
  if (!parts.length) return false
  return parts.every((part) => part.applied)
}

function styleApplied(items) {
  if (!items.length) return false
  return items.every((item) => item.applied)
}

function makeMoveAction(bucket) {
  const { target, left, top } = bucket
  const delta = {
    x: left ? parseDeltaPx(left.newValue) : 0,
    y: top ? parseDeltaPx(top.newValue) : 0,
    unit: 'px',
  }

  const align = left?.align ?? top?.align ?? undefined

  return {
    id: createActionId(),
    type: ACTION_TYPES.MOVE,
    target,
    applied: moveApplied({ left, top }),
    delta,
    ...(align ? { align } : {}),
    oldLeft: left?.oldValue,
    oldTop: top?.oldValue,
    timestamp: left?.timestamp ?? top?.timestamp,
  }
}

function makeStyleAction(bucket) {
  return {
    id: createActionId(),
    type: ACTION_TYPES.STYLE,
    target: bucket.target,
    applied: styleApplied(bucket.items),
    changes: bucket.changes,
    timestamp: bucket.items[0]?.timestamp,
  }
}

function makeTextAction(change) {
  return {
    id: createActionId(),
    type: ACTION_TYPES.TEXT,
    target: pickTarget(change),
    applied: Boolean(change.applied),
    oldValue: change.oldValue,
    newValue: change.newValue,
    timestamp: change.timestamp,
  }
}

function makeAttributeAction(change) {
  return {
    id: createActionId(),
    type: ACTION_TYPES.ATTRIBUTE,
    target: pickTarget(change),
    applied: Boolean(change.applied),
    attribute: change.attribute,
    oldValue: change.oldValue,
    newValue: change.newValue,
    timestamp: change.timestamp,
  }
}

/**
 * @param {object[]} changes
 * @param {object} [meta]
 * @returns {{ actions: object[], artifacts: object[], meta?: object }}
 */
export function legacyChangesToActions(changes, meta = {}) {
  const artifacts = []
  const filtered = []

  for (const change of changes ?? []) {
    if (isCompileArtifact(change)) {
      artifacts.push(toArtifact(change))
      continue
    }
    filtered.push(change)
  }

  const moveBySelector = new Map()
  const styleBySelector = new Map()

  for (const change of filtered) {
    if (change.type !== 'style' || !change.property) continue

    const selector = change.selector
    if (change.property === 'left' || change.property === 'top') {
      if (!moveBySelector.has(selector)) {
        moveBySelector.set(selector, { target: pickTarget(change), left: null, top: null })
      }
      const bucket = moveBySelector.get(selector)
      if (change.property === 'left') bucket.left = change
      else bucket.top = change
      continue
    }

    if (!styleBySelector.has(selector)) {
      styleBySelector.set(selector, {
        target: pickTarget(change),
        changes: [],
        items: [],
      })
    }
    const bucket = styleBySelector.get(selector)
    bucket.changes.push({
      prop: change.property,
      value: change.newValue,
      oldValue: change.oldValue,
    })
    bucket.items.push(change)
  }

  const actions = []
  const emittedMove = new Set()
  const emittedStyle = new Set()

  for (const change of filtered) {
    if (change.type === 'text') {
      actions.push(makeTextAction(change))
      continue
    }

    if (change.type === 'attribute') {
      actions.push(makeAttributeAction(change))
      continue
    }

    if (change.type !== 'style' || !change.property) continue

    if (change.property === 'left' || change.property === 'top') {
      if (emittedMove.has(change.selector)) continue
      emittedMove.add(change.selector)
      actions.push(makeMoveAction(moveBySelector.get(change.selector)))
      continue
    }

    if (emittedStyle.has(change.selector)) continue
    emittedStyle.add(change.selector)
    actions.push(makeStyleAction(styleBySelector.get(change.selector)))
  }

  return {
    actions,
    artifacts,
    meta,
  }
}
