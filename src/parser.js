/**
 * parser.js — парсинг мутаций VisBug и форматирование правок для MCP / буфера.
 */

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

export function parseMutationsToChanges(mutations) {
  const result = []

  for (const m of mutations) {
    const key = buildKey(m)

    if (seen.has(key)) {
      const existing = seen.get(key)
      existing.newValue = m.newValue ?? m.html ?? m.text
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
    case 'attribute':    return `${m.selector}|attr|${m.attribute}`
    case 'text':         return `${m.selector}|text`
    case 'node-added':   return `${m.selector}|added`
    case 'node-removed': return `${m.parentSelector ?? m.selector}|removed|${m.tag}`
    default:             return `${m.selector}|${m.type}`
  }
}

function normalize(m) {
  const base = {
    type: m.type,
    selector: m.selector,
    tag: m.tag,
    url: m.url,
    timestamp: m.timestamp,
    applied: false,
  }

  switch (m.type) {
    case 'style':
      return { ...base, property: m.property, oldValue: m.oldValue, newValue: m.newValue }
    case 'attribute':
      return { ...base, attribute: m.attribute, oldValue: m.oldValue, newValue: m.newValue }
    case 'text':
      return { ...base, oldValue: m.oldValue, newValue: m.newValue }
    case 'node-added':
      return { ...base, parentSelector: m.parentSelector, html: m.html }
    case 'node-removed':
      return { ...base, parentSelector: m.parentSelector }
    default:
      return { ...base, raw: m }
  }
}

function formatOldValue(value) {
  if (value === null || value === undefined || value === '') return 'не задано'
  return String(value)
}

/** Свойства, которые VisBug пишет inline, но в исходный CSS не переносятся. */
export const VISBUG_ARTIFACT_PROPERTIES = new Set([
  'cursor',
  'position',
  'transition',
  'transition-property',
])

/** Не переносить в CSS через auto-apply (эффекты карточек, glow, inline-переменные). */
export const AUTO_APPLY_BLOCKED_PROPERTIES = new Set([
  ...VISBUG_ARTIFACT_PROPERTIES,
])

/** Только эти свойства auto-apply пишет сам; остальное — только через LLM. */
export const AUTO_APPLY_SAFE_PROPERTIES = new Set([
  'margin-inline-start',
  'margin-top',
  'margin-left',
  'margin-right',
  'margin-bottom',
  'font-size',
  'color',
  'padding',
  'padding-top',
  'padding-bottom',
  'padding-left',
  'padding-right',
  'gap',
  'row-gap',
  'column-gap',
  'width',
  'max-width',
  'min-width',
  'height',
  'line-height',
  'letter-spacing',
])

const AUTO_APPLY_BLOCKED_SELECTOR_RE =
  /editorial-card-glow|pointer-events-none|vibe-annotations|visbug-mcp-guides/i

const VISBUG_SECTION_IDS = new Set([
  'vibe-annotations-root',
  'visbug-mcp-guides-root',
])

const GRID_LAYOUT_SELECTOR_RE = /service-cell|services-matrix|grid|monochrom-content-section/i

/**
 * Первый #id секции в пути селектора (section#id или #podhod / #avtor / …).
 * @param {string} selector
 * @returns {string | null}
 */
export function extractSectionKey(selector) {
  if (!selector || typeof selector !== 'string') return null

  const sectionTag = selector.match(/section#([a-zA-Z][\w-]*)/)
  if (sectionTag && !VISBUG_SECTION_IDS.has(sectionTag[1])) {
    return sectionTag[1]
  }

  for (const match of selector.matchAll(/#([a-zA-Z][\w-]*)/g)) {
    const id = match[1]
    if (!VISBUG_SECTION_IDS.has(id)) return id
  }

  return null
}

/** @param {string} selector */
export function isGridLayoutContext(selector) {
  return Boolean(selector && GRID_LAYOUT_SELECTOR_RE.test(selector))
}

/** @param {string} property */
export function isVisbugArtifactProperty(property) {
  return VISBUG_ARTIFACT_PROPERTIES.has(property)
}

/**
 * Подсказки для переноса правки в исходники.
 * @param {{ type: string, selector?: string, property?: string }} change
 * @returns {string[]}
 */
export function getApplyHints(change) {
  const hints = []
  const selector = change.selector ?? ''

  if (change.type === 'text') {
    hints.push('💡 текст: править в компоненте/разметке (.tsx, .astro), не в CSS')
    if (/service-cell|service-title|service-desc|hero-copy|monochrom/i.test(selector)) {
      hints.push('💡 искать в frontend-new/src/components или page-content')
    }
    return hints
  }

  if (change.type !== 'style' || !change.property) return hints

  if (isVisbugArtifactProperty(change.property)) {
    hints.push('⏭ не применять в CSS')
    return hints
  }

  const prop = change.property

  if ((prop === 'left' || prop === 'top') && isGridLayoutContext(selector)) {
    const alt = prop === 'left' ? 'margin-inline-start' : 'margin-top'
    hints.push(`💡 подсказка: в исходниках лучше ${alt} вместо inline ${prop}`)
    if (prop === 'left' && /\.service-cell\b|service-cell/.test(selector)) {
      hints.push('💡 файл: sections.css')
    }
  }

  return hints
}

function formatChangeLine(index, c) {
  switch (c.type) {
    case 'style':
      return `[${index}] ${c.selector} → стиль: ${c.property} = ${c.newValue} (было: ${formatOldValue(c.oldValue)})`
    case 'attribute':
      return `[${index}] ${c.selector} → атрибут ${c.attribute} = "${c.newValue}" (было: "${formatOldValue(c.oldValue)}")`
    case 'text':
      return `[${index}] ${c.selector} → текст: "${c.newValue}" (было: "${formatOldValue(c.oldValue)}")`
    case 'node-added':
      return `[${index}] ${c.parentSelector ?? c.selector} → добавлен узел: ${(c.html ?? '').slice(0, 80)}…`
    case 'node-removed':
      return `[${index}] ${c.parentSelector ?? c.selector} → удалён узел <${c.tag}>`
    default:
      return `[${index}] ${JSON.stringify(c)}`
  }
}

/**
 * @param {number} index
 * @param {object} c
 * @param {{ hints?: boolean }} [options]
 */
export function formatChangeLineWithHints(index, c, { hints = true } = {}) {
  const lines = [formatChangeLine(index, c)]
  if (hints) {
    for (const hint of getApplyHints(c)) {
      lines.push(`  ${hint}`)
    }
  }
  return lines.join('\n')
}

const MISC_SECTION_LABEL = 'Прочее'

/**
 * @param {Array<{ c: object, index: number }>} items
 * @returns {Map<string, Array<{ c: object, index: number }>>}
 */
export function groupChangesBySection(items) {
  const groups = new Map()
  const order = []

  for (const item of items) {
    const key = extractSectionKey(item.c.selector ?? item.c.parentSelector ?? '') ?? MISC_SECTION_LABEL
    if (!groups.has(key)) {
      groups.set(key, [])
      order.push(key)
    }
    groups.get(key).push(item)
  }

  // «Прочее» всегда в конце
  const miscIdx = order.indexOf(MISC_SECTION_LABEL)
  if (miscIdx !== -1 && miscIdx !== order.length - 1) {
    order.splice(miscIdx, 1)
    order.push(MISC_SECTION_LABEL)
  }

  return { groups, order }
}

/**
 * @param {Array<{ c: object, index: number }>} items
 * @param {{ hints?: boolean }} [options]
 */
export function formatGroupedChanges(items, { hints = true } = {}) {
  if (items.length === 0) return ''

  const { groups, order } = groupChangesBySection(items)
  const blocks = []

  for (const key of order) {
    const sectionItems = groups.get(key) ?? []
    const header = key === MISC_SECTION_LABEL ? `## ${MISC_SECTION_LABEL}` : `## #${key}`
    const lines = sectionItems.map(({ c, index }) => formatChangeLineWithHints(index, c, { hints }))
    blocks.push([header, ...lines].join('\n'))
  }

  return blocks.join('\n\n')
}

export function formatChangesFromStore(changes, { type, grouped = true, hints = true } = {}) {
  const items = changes
    .map((c, index) => ({ c, index }))
    .filter(({ c }) => !c.applied && (!type || c.type === type))

  if (items.length === 0) return ''

  if (!grouped) {
    return items.map(({ c, index }) => formatChangeLineWithHints(index, c, { hints })).join('\n')
  }

  return formatGroupedChanges(items, { hints })
}

/** @deprecated используйте formatChangesFromStore */
export function formatForClaude(changes) {
  return formatChangesFromStore(changes)
}
