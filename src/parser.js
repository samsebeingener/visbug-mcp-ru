/**
 * parser.js
 *
 * Transforme les mutations brutes reçues du content-script
 * en un tableau de changements propres et déduplicés.
 */

let seen = new Map()

export function clearSeen() {
  seen = new Map()
}

// Reconstruit le Map `seen` à partir de changements chargés depuis le disque
// pour que la déduplication reste cohérente après un redémarrage
export function restoreSeen(changes) {
  seen = new Map()
  for (const c of changes) {
    seen.set(buildKey(c), c)
  }
}

// ─── Filtres bruit ────────────────────────────────────────────────────────────

const NOISE_SELECTORS = [
  /^#vibe-annotations-root/,
  /vue-devtools/,
  /^body\s*>\s*visbug/,
  /^body\s*>\s*vis-bug/,
  /^#↑/,
]

const NOISE_CSS_PROPS = [
  /^--[a-f0-9]{8}-/i,   // CSS vars scopées Vue (ex: --dc13a441-Z_INDEX...)
]

const NOISE_CLASSES = [
  /router-link-(active|exact-active)/,
  /loading-fade-(enter|leave)-(active|from|to)/,
]

function isNoise(m) {
  if (NOISE_SELECTORS.some(r => r.test(m.selector ?? ''))) return true
  if (m.type === 'style' && NOISE_CSS_PROPS.some(r => r.test(m.property ?? ''))) return true
  if (m.type === 'text' && m.oldValue === null) {
    // Dump de rendu initial = newValue très long (tout le texte de la page concaténé)
    // Texte ajouté à un élément vide = newValue court = signal légitime à garder
    if (!m.newValue || m.newValue.trim().length > 150) return true
  }
  if (m.type === 'attribute' && m.attribute === 'contenteditable') return true  // VisBug interne
  if (m.type === 'attribute' && m.attribute === 'class') {
    // Filtrer seulement si le changement ne porte QUE sur des classes framework
    // (router-link-active, transitions) — pas si l'utilisateur a changé une vraie classe
    const addedClasses = (m.newValue ?? '').split(/\s+/).filter(c => c && !((m.oldValue ?? '').split(/\s+/).includes(c)))
    const removedClasses = (m.oldValue ?? '').split(/\s+/).filter(c => c && !((m.newValue ?? '').split(/\s+/).includes(c)))
    const delta = [...addedClasses, ...removedClasses]
    if (delta.length === 0) return true  // aucun changement réel
    if (delta.every(cls => NOISE_CLASSES.some(r => r.test(cls)))) return true  // que du framework
  }
  if (m.type === 'node-added' || m.type === 'node-removed') return true  // renders Vue
  return false
}

// ─── Parse ────────────────────────────────────────────────────────────────────

export function parseMutationsToChanges(mutations) {
  const result = []

  for (const m of mutations) {
    if (isNoise(m)) continue

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

export function formatForClaude(changes) {
  return changes
    .filter(c => !c.applied)
    .map((c, i) => {
      switch (c.type) {
        case 'style':
          return `[${i}] ${c.selector} → CSS: ${c.property}: ${c.newValue} (было: ${c.oldValue ?? 'не задано'})`
        case 'attribute':
          return `[${i}] ${c.selector} → attr[${c.attribute}]="${c.newValue}" (было: "${c.oldValue}")`
        case 'text':
          return `[${i}] ${c.selector} → текст: "${c.newValue}" (было: "${c.oldValue}")`
        case 'node-added':
          return `[${i}] ${c.parentSelector} → добавлен узел: ${c.html?.slice(0, 80)}…`
        case 'node-removed':
          return `[${i}] ${c.parentSelector} → удалён узел <${c.tag}>`
        default:
          return `[${i}] ${JSON.stringify(c)}`
      }
    })
    .join('\n')
}
