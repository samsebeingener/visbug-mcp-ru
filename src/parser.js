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

export const AUTO_APPLY_BLOCKED_SELECTOR_RE =
  /editorial-card-glow|pointer-events-none|vibe-annotations|visbug-mcp-guides/i

/** Текстовые узлы — не «съедать» их Move как gutter grid-колонки. */
const TEXT_MOVE_TAGS = new Set([
  'p', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'a', 'li', 'label', 'small', 'blockquote',
])

/** Шум от hover/glow карточек — не ошибка, не пишем в CSS. */
export function isDecorativeStyleChange(change) {
  if (change?.type !== 'style') return false
  const prop = String(change.property ?? '')
  const sel = String(change.selector ?? '')
  if (AUTO_APPLY_BLOCKED_SELECTOR_RE.test(sel)) return true
  if (prop === '--start' || prop === '--glow-mask') return true
  if (prop.startsWith('--') && /editorial-card|glow/i.test(sel)) return true
  return false
}

export function tailwindGapClassToPx(unit) {
  const num = Number(unit)
  if (!Number.isFinite(num)) return null
  return num * 4
}

/** gap-12 → 48px и т.д. из классов в пути VisBug. */
export function parseGapPxFromSelector(selector) {
  const gaps = new Set()
  const s = String(selector ?? '')
  for (const m of s.matchAll(/(?:^|[.\s])(?:(?:sm|md|lg|xl|2xl):)?gap-(\d+)/g)) {
    const px = tailwindGapClassToPx(m[1])
    if (px != null) gaps.add(px)
  }
  return [...gaps]
}

export function isTextMoveTag(tag = '') {
  return TEXT_MOVE_TAGS.has(String(tag).toLowerCase())
}

/** Gutter-drop только для grid-колонок / карточек, не для абзацев. */
export function isGridColumnLeaf(selector, tag = '') {
  const { last, tagName } = parseSelectorLeaf(selector, tag)
  if (isTextMoveTag(tagName)) return false
  if (/col-span-|\\:col-span-/i.test(last)) return true
  if (/editorial-card|main-block-card/i.test(selector) && ['article', 'div'].includes(tagName)) {
    return true
  }
  return false
}

/** Классы, по которым строим короткий селектор для CSS. */
const MEANINGFUL_APPLY_CLASSES = [
  'builder-rich-text',
  'prose',
  'wysiwyg',
  'entry-content',
  'content-body',
  'article-body',
  'service-cell',
  'services-matrix',
  'service-title',
  'service-desc',
  'section-title',
  'hero-section',
  'hero-text-inner',
  'hero-text-col',
  'hero-copy',
  'hero-shell',
  'chapter',
  'dropcap',
  'main-block-card',
  'cards-scroll-rail',
  'pricing-scroll-rail',
  'faq-inner',
  'monochrom-content-section__inner',
]

/** Теги, которых в секции обычно много — нельзя сокращать до `.section tag`. */
const AMBIGUOUS_APPLY_TAGS = new Set(['p', 'span', 'a', 'li', 'button', 'label', 'small'])

const TAILWINDISH_CLASS_RE = /^(sm|md|lg|xl|2xl|hover|focus|group|peer|dark|text|font|leading|tracking|w|h|max|min|p|m|px|py|pt|pb|pl|pr|mx|my|mt|mb|ml|mr|gap|flex|grid|col|row|items|justify|self|place|overflow|relative|absolute|fixed|sticky|hidden|block|inline|rounded|border|bg|shadow|opacity|z|transition|duration|ease|scale|rotate|translate|drop|object|shrink|grow|basis|space|order|content|pointer|select|cursor|sr|antialiased|not|italic|underline|line|decoration|align|whitespace|break|truncate|uppercase|lowercase|capitalize|normal|tabular|ordinal|slashed|indent|list|appearance|outline|ring|mix|filter|backdrop|blur|brightness|contrast|grayscale|hue|invert|saturate|sepia|will|animate|origin|scroll|snap|touch|resize|fill|stroke|sr-only|not-italic)([:-]|$)/i

export function parseSelectorLeaf(selector, tag = '') {
  // VisBug: `a > b > c`; уже упрощённые: `.hero-section h1`
  const parts = String(selector).split(/\s*>\s*|\s+/).filter(Boolean)
  const last = parts[parts.length - 1] ?? ''
  const nth = last.match(/:nth-of-type\((\d+)\)/)?.[1]
    ?? last.match(/:nth-child\((\d+)\)/)?.[1]
  const tagName = (last.match(/^([a-z][\w-]*)/i)?.[1] || tag || '').toLowerCase()
  return { last, nth, tagName }
}

function extractLeafSemanticClass(lastSegment) {
  const withoutPseudo = String(lastSegment).replace(/:(?:nth-of-type|nth-child)\([^)]+\)/g, '')
  const classes = [...withoutPseudo.matchAll(/\.((?:\\.|[a-zA-Z0-9_-])+)/g)].map((m) => m[1])
  for (const cls of classes) {
    const plain = cls.replace(/\\/g, '')
    // Сетка Tailwind: lg:col-span-5 — структурный якорь карточки
    if (/^(?:sm|md|lg|xl|2xl):col-span-\d+$/.test(plain) || /^col-span-\d+$/.test(plain)) {
      return cls
    }
    if (cls.includes('\\')) continue
    if (TAILWINDISH_CLASS_RE.test(cls)) continue
    return cls
  }
  return null
}

function findMeaningfulClass(selector) {
  return MEANINGFUL_APPLY_CLASSES.find((cls) => {
    const re = new RegExp(`(?:^|[.\\s>#])${cls}(?:[.\\s:>\\[]|$)`)
    return re.test(selector) || selector.includes(`.${cls}`) || selector.includes(`${cls}.`)
  })
}

/**
 * @param {string} selector
 * @param {{ richTextOnly?: boolean }} [options]
 */
export function findMeaningfulClassInSelector(selector, options = {}) {
  const { richTextOnly = false } = options
  for (const cls of MEANINGFUL_APPLY_CLASSES) {
    const re = new RegExp(`(?:^|[.\\s>#])${cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[.\\s:>\\[]|$)`)
    if (!re.test(selector) && !selector.includes(`.${cls}`)) continue
    if (richTextOnly && !/rich.?text|prose|wysiwyg|entry-content|content-body|article-body|cms-content|formatted-body/i.test(cls)) {
      continue
    }
    return cls
  }
  return null
}

function selectorTargetsSectionRoot(selector, section) {
  const s = String(selector).trim()
  return (
    s === `#${section}`
    || s === `section#${section}`
    || new RegExp(`^section#${section}(?:\\.|:|$)`).test(s)
  )
}

/**
 * Длинный путь VisBug → короткий селектор для CSS.
 * Приоритет: класс на самом элементе (`.chapter` / `.lg\:col-span-5`).
 * НИКОГДА не схлопывать до голого `#section`, если двигали ребёнка внутри.
 */
export function simplifySelectorForApply(selector, tag = '') {
  if (!selector || typeof selector !== 'string') return null
  if (AUTO_APPLY_BLOCKED_SELECTOR_RE.test(selector)) return null

  const { last, nth, tagName } = parseSelectorLeaf(selector, tag)
  const section = extractSectionKey(selector)
  const sectionClass = selector.match(/section\.([a-zA-Z][\w-]*)/)?.[1]
  const anchorClass = findMeaningfulClass(selector)
  const leafClass = extractLeafSemanticClass(last)
  const rootClass = sectionClass || (anchorClass && !['chapter', 'dropcap'].includes(anchorClass) ? anchorClass : null)

  // 1) Уникальный/структурный класс на leaf
  if (leafClass) {
    if (section) return `#${section} .${leafClass}`
    if (rootClass && rootClass !== leafClass) return `.${rootClass} .${leafClass}`
    return `.${leafClass}`
  }

  if (section) {
    // Целимся в саму секцию — ок
    if (selectorTargetsSectionRoot(selector, section)) return `#${section}`

    let short = `#${section}`
    if (anchorClass && !anchorClass.includes('__inner') && anchorClass !== section) {
      short += ` .${anchorClass}`
    }

    if (tagName && tagName !== 'div' && tagName !== 'section') {
      short += ` ${tagName}`
      if (nth && AMBIGUOUS_APPLY_TAGS.has(tagName)) short += `:nth-of-type(${nth})`
      return short.length <= 240 ? short : null
    }

    // div/section-ребёнок без своего класса — только с nth, иначе отказ (не двигать весь #method)
    if ((tagName === 'div' || !tagName) && nth) {
      short += ` div:nth-of-type(${nth})`
      return short.length <= 240 ? short : null
    }

    return null
  }

  // Static HTML / Tailwind: section.hero-section без #id
  if (rootClass && tagName && tagName !== 'div' && tagName !== 'section') {
    if (AMBIGUOUS_APPLY_TAGS.has(tagName)) {
      if (nth) return `.${rootClass} ${tagName}:nth-of-type(${nth})`
      return null
    }
    const short = `.${rootClass} ${tagName}`
    return short.length <= 240 ? short : null
  }
  if (rootClass && selectorTargetsSectionRoot(selector, rootClass)) {
    return `.${rootClass}`
  }
  if (rootClass && (selector.includes('>') || selector.includes(' '))) {
    return null
  }
  if (rootClass) {
    return `.${rootClass}`
  }

  return selector.length <= 240 ? selector : null
}

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

  if (prop === 'left' || prop === 'top') {
    hints.push('💡 Move VisBug → в исходниках transform: translate(x, y), не margin/left')
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
