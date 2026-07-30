/**
 * parser.js — дедуп мутаций VisBug и текст буфера для Cursor (модель mambari).
 */

import {
  formatLayoutDeltaBufferLine,
  isSuspiciousDelta,
} from '../shared/layout-lever.js'
import { enrichChangeSelectors } from './selector-short.js'
import { resolveTargetFile } from './target-resolver.js'
import {
  compileChangesToActions,
  formatActionsJsonBlock,
  formatWriteRecipesBuffer,
  compileWriteRecipes,
} from './actions/compile.js'
import { isDragArtifactProp } from './actions/write-recipe.js'
import { STORE_VERSION } from './actions/schema.js'

let seen = new Map()

export function clearSeen() {
  seen = new Map()
}

export function restoreSeen(changes) {
  seen = new Map()
  for (const c of changes) {
    seen.set(buildKey(c), c)
  }
}

const NOISE_SELECTORS = [
  /^#vibe-annotations-root/,
  /#visbug-mcp-guides-root/,
  /#visbug-mcp-apply-toast/,
  /#visbug-mcp-recording-badge/,
  /#scroll-progress\b/,
  /\[data-visbug-mcp\]/,
  /vue-devtools/,
  /^body\s*>\s*visbug/i,
  /^body\s*>\s*vis-bug/i,
  /^#↑/,
]

const NOISE_CSS_PROPS = [
  /^--[a-f0-9]{8}-/i,
]

const NOISE_CLASSES = [
  /router-link-(active|exact-active)/,
  /loading-fade-(enter|leave)-(active|from|to)/,
]

const TARGET_META_KEYS = [
  'visbugSrc',
  'stableId',
  'sourceRef',
  'userTarget',
  'align',
  'stampId',
]

/** Фильтр шума (mambari/visbug-mcp + overlay расширения). */
export function isMutationNoise(m) {
  const selector = m.selector ?? ''
  const parentSelector = m.parentSelector ?? ''
  if (NOISE_SELECTORS.some((r) => r.test(selector) || r.test(parentSelector))) return true
  if (m.type === 'layout-delta' && isSuspiciousLayoutDelta(m)) return true
  if (m.type === 'style' && NOISE_CSS_PROPS.some((r) => r.test(m.property ?? ''))) return true
  if (m.type === 'style' && isDragArtifactProp(m.property ?? '')) return true
  if (m.type === 'style' && (m.newValue === 'undefined' || m.newValue === 'null')) return true
  if (m.type === 'text' && m.oldValue === null) {
    if (!m.newValue || m.newValue.trim().length > 150) return true
  }
  if (m.type === 'attribute' && m.attribute === 'contenteditable') return true
  if (m.type === 'attribute' && m.attribute === 'class') {
    const oldClasses = (m.oldValue ?? '').split(/\s+/).filter(Boolean)
    const newClasses = (m.newValue ?? '').split(/\s+/).filter(Boolean)
    const addedClasses = newClasses.filter((c) => !oldClasses.includes(c))
    const removedClasses = oldClasses.filter((c) => !newClasses.includes(c))
    const delta = [...addedClasses, ...removedClasses]
    if (delta.length === 0) return true
    if (delta.every((cls) => NOISE_CLASSES.some((r) => r.test(cls)))) return true
  }
  if (m.type === 'node-added' || m.type === 'node-removed') return true
  return false
}

/** @deprecated используйте isMutationNoise */
export function isRecorderNoiseChange(m) {
  return isMutationNoise(m)
}

export function parseMutationsToChanges(mutations) {
  const result = []

  for (const m of mutations) {
    if (isMutationNoise(m)) continue

    const key = buildKey(m)

    if (seen.has(key)) {
      const existing = seen.get(key)
      if (m.type === 'layout-delta') {
        const next = normalize(m)
        Object.assign(existing, next)
      } else {
        existing.newValue = m.newValue ?? m.html ?? m.text
      }
      existing.timestamp = m.timestamp
      continue
    }

    const change = normalize(m)
    seen.set(key, change)
    result.push(change)
  }

  return result
}

function buildKey(m) {
  switch (m.type) {
    case 'style':        return `${m.selector}|style|${m.property}`
    case 'layout-delta': return `${m.selector}|layout-delta`
    case 'attribute':    return `${m.selector}|attr|${m.attribute}`
    case 'text':         return `${m.selector}|text`
    case 'node-added':   return `${m.selector}|added`
    case 'node-removed': return `${m.parentSelector ?? m.selector}|removed|${m.tag}`
    default:             return `${m.selector}|${m.type}`
  }
}

function attachTargetMeta(base, m) {
  for (const key of TARGET_META_KEYS) {
    if (m[key] !== undefined) base[key] = m[key]
  }
  if (m.lever) base.lever = m.lever
  if (m.parentLayout) base.parentLayout = m.parentLayout
  return base
}

function normalize(m) {
  const base = attachTargetMeta({
    type: m.type,
    selector: m.selector,
    diagnosticSelector: m.selector,
    tag: m.tag,
    url: m.url,
    timestamp: m.timestamp,
    applied: false,
  }, m)

  switch (m.type) {
    case 'style':
      return { ...base, property: m.property, oldValue: m.oldValue, newValue: m.newValue }
    case 'attribute':
      return { ...base, attribute: m.attribute, oldValue: m.oldValue, newValue: m.newValue }
    case 'text':
      return { ...base, oldValue: m.oldValue, newValue: m.newValue }
    case 'node-added':
      return { ...base, parentSelector: m.parentSelector, html: m.html }
    case 'layout-delta':
      return {
        ...base,
        deltaX: m.deltaX,
        deltaY: m.deltaY,
        rectBefore: m.rectBefore,
        rectAfter: m.rectAfter,
        offsetBefore: m.offsetBefore,
        offsetAfter: m.offsetAfter,
        lever: m.lever,
        parentLayout: m.parentLayout,
        layoutContext: m.layoutContext,
        viewport: m.viewport,
      }
    case 'node-removed':
      return { ...base, parentSelector: m.parentSelector, tag: m.tag }
    default:
      return { ...base, raw: m }
  }
}

function formatOldValue(value) {
  if (value === null || value === undefined || value === '') return 'не задано'
  return String(value)
}

export function isSuspiciousLayoutDelta(m) {
  if (m?.type !== 'layout-delta') return false
  return isSuspiciousDelta(m.deltaX ?? 0, m.deltaY ?? 0, m.viewport)
}

function formatSelectorLines(c) {
  const enriched = enrichChangeSelectors(c)
  const lines = [`селектор (короткий): ${enriched.shortSelector}`]
  if (enriched.diagnosticSelector && enriched.diagnosticSelector !== enriched.shortSelector) {
    lines.push(`селектор (диагностика): ${enriched.diagnosticSelector}`)
  }
  return lines
}

function formatChangeLine(index, c) {
  const enriched = enrichChangeSelectors({
    ...c,
    fileHint: c.fileHint ?? resolveTargetFile(c),
  })
  const selectorPrefix = formatSelectorLines(enriched).join('\n  ')

  switch (enriched.type) {
    case 'style':
      return [
        `[${index}]`,
        `  ${selectorPrefix}`,
        `  → стиль: ${enriched.property} = ${enriched.newValue} (было: ${formatOldValue(enriched.oldValue)})`,
      ].join('\n')
    case 'attribute':
      return [
        `[${index}]`,
        `  ${selectorPrefix}`,
        `  → атрибут ${enriched.attribute} = "${enriched.newValue}" (было: "${formatOldValue(enriched.oldValue)}")`,
      ].join('\n')
    case 'text':
      return [
        `[${index}]`,
        `  ${selectorPrefix}`,
        `  → текст: "${enriched.newValue}" (было: "${formatOldValue(enriched.oldValue)}")`,
      ].join('\n')
    case 'layout-delta':
      return formatLayoutDeltaBufferLine(index, enriched)
    case 'node-added':
      return `[${index}] ${enriched.parentSelector ?? enriched.selector} → добавлен узел: ${(enriched.html ?? '').slice(0, 80)}…`
    case 'node-removed':
      return `[${index}] ${enriched.parentSelector ?? enriched.selector} → удалён узел <${enriched.tag}>`
    default:
      return `[${index}] ${JSON.stringify(enriched)}`
  }
}

/**
 * @param {object[]} changes
 * @param {{ type?: string, workspace?: string | null, includeActions?: boolean, legacy?: boolean, stamps?: object[] }} [opts]
 */
export function formatChangesFromStore(changes, { type, workspace, includeActions = true, legacy = false, stamps = [] } = {}) {
  const pending = changes
    .filter((c) => !c.applied && (!type || c.type === type))
    .map((c) => enrichChangeSelectors({
      ...c,
      fileHint: c.fileHint ?? resolveTargetFile(c),
    }))

  if (!pending.length) return ''

  // Default: write-recipes (одна готовая CSS-правка на узел)
  if (!legacy) {
    const recipes = compileWriteRecipes(pending)
    if (!recipes.length) return ''
    const body = formatWriteRecipesBuffer(recipes, { workspace, stamps })
    if (!includeActions) return body
    const jsonBlock = formatActionsJsonBlock(pending)
    return jsonBlock ? `${body}\n\n${jsonBlock}` : body
  }

  const fileGroups = new Map()
  for (const change of pending) {
    const file = change.fileHint ?? resolveTargetFile(change)
    if (!fileGroups.has(file)) fileGroups.set(file, [])
    fileGroups.get(file).push(change)
  }

  const header = ['=== VisBug session ===']
  if (workspace) header.push(`workspace: ${workspace}`)
  const fileSummary = [...fileGroups.entries()]
    .map(([file, items]) => `${file} (${items.length})`)
    .join(', ')
  header.push(`files: ${fileSummary}`)
  header.push(`store: v${STORE_VERSION}`)
  header.push('')

  const sections = []
  let globalIndex = 0
  for (const [file, items] of fileGroups) {
    sections.push(`--- ${file} ---`)
    for (const item of items) {
      sections.push(formatChangeLine(globalIndex, item))
      globalIndex += 1
    }
    sections.push('')
  }

  const body = [...header, ...sections].join('\n').trimEnd()
  if (!includeActions) return body

  const actionsBlock = formatActionsJsonBlock(pending)
  return actionsBlock ? `${body}\n\n${actionsBlock}` : body
}

export { compileChangesToActions, compileWriteRecipes, STORE_VERSION }
