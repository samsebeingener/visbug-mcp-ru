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

export function formatChangesFromStore(changes, { type } = {}) {
  return changes
    .map((c, index) => ({ c, index }))
    .filter(({ c }) => !c.applied && (!type || c.type === type))
    .map(({ c, index }) => formatChangeLine(index, c))
    .join('\n')
}

/** @deprecated используйте formatChangesFromStore */
export function formatForClaude(changes) {
  return formatChangesFromStore(changes)
}
