/**
 * selector-short.js — короткий селектор для агента (target ≠ diagnostic path).
 *
 * Закон: #id в середине пути — якорь предка, НЕ цель. Цель = последний сегмент.
 */

const UTILITY_CLASS_RE = /^(p-|m-|px-|py-|mx-|my-|gap-|space-[xy]-|flex|grid|col-|row-|w-|h-|min-|max-|text-|bg-|border-|rounded-|shadow-|opacity-|z-|top-|left-|right-|bottom-|translate-|scale-|rotate-|hover:|md:|lg:|xl:|sm:|relative|absolute|fixed|sticky|block|inline|items-|justify-|self-|object-|overflow-|pointer-|transition-|duration-|leading-|tracking-|font-|italic|not-italic|uppercase|max-w-|pr-|pl-|py-|pt-|pb-)/

/**
 * Класс, который оставляем в коротком пути даже если utility (структура).
 * @param {string} seg
 * @returns {string | null}
 */
function structuralClassIn(seg) {
  const classes = [...String(seg).matchAll(/\.([^.\s#:>[]+)/g)].map((m) =>
    m[1].replace(/\\/g, ''),
  )
  for (const cls of classes) {
    const bare = cls.replace(/^(sm|md|lg|xl):/, '')
    if (/^space-[xy]-/.test(bare)) return bare
  }
  return null
}

/**
 * @param {string} seg
 * @returns {string[]}
 */
function semanticClassesIn(seg) {
  return [...String(seg).matchAll(/\.([a-zA-Z_][\w-]*)/g)]
    .map((m) => m[1])
    .filter((cls) => !UTILITY_CLASS_RE.test(cls) && cls.length > 2)
}

/**
 * @param {string[]} ancestorSegs
 * @returns {string | null}
 */
function nearestAncestorId(ancestorSegs) {
  for (let i = ancestorSegs.length - 1; i >= 0; i -= 1) {
    const m = ancestorSegs[i].match(/#([a-zA-Z][\w-]*)/)
    if (m) return m[1]
  }
  return null
}

/**
 * @param {string} seg
 * @returns {string | null}
 */
function formatMiddleBit(seg) {
  const id = seg.match(/#([a-zA-Z][\w-]*)/)
  if (id) return `#${id[1]}`
  const sem = semanticClassesIn(seg)
  if (sem.length === 1) return `.${sem[0]}`
  const structural = structuralClassIn(seg)
  if (structural) return `.${structural.replace(/\\/g, '')}`
  const t = seg.match(/^([a-z][a-z0-9-]*)/i)?.[1]
  const nth = seg.match(/:nth-of-type\(\d+\)/)?.[0] ?? ''
  if (t && nth) return `${t}${nth}`
  if (t) return t
  return null
}

/**
 * Короткий хвост для leaf-сегмента (tag + semantic / nth).
 * @param {string} lastSeg
 * @param {string} [tag]
 * @returns {string}
 */
function formatLeafBit(lastSeg, tag) {
  const t = lastSeg.match(/^([a-z][a-z0-9-]*)/i)?.[1] ?? tag ?? 'div'
  const nth = lastSeg.match(/:nth-of-type\(\d+\)/)?.[0] ?? ''
  const sem = semanticClassesIn(lastSeg)
  if (sem.length === 1) return `${t}.${sem[0]}${nth}`
  if (nth) return `${t}${nth}`
  // h2 / h1 без semantic — достаточно тега под уникальным родителем
  return t
}

/**
 * @param {string} selector — длинный VisBug path
 * @param {{ stableId?: string | null, tag?: string }} [opts]
 * @returns {string}
 */
export function deriveShortSelector(selector, { stableId, tag } = {}) {
  if (!selector) return 'body'

  const segments = String(selector).split(/\s*>\s*/).filter(Boolean)
  const lastSeg = segments[segments.length - 1] ?? String(selector)

  // stableId / data-visbug-id — доверяем, если относится к leaf;
  // игнорируем, если это только #id предка в пути
  if (stableId) {
    const s = String(stableId).trim()
    const bare = s.replace(/^[#.]/, '')
    const lastHas =
      lastSeg.includes(`#${bare}`)
      || lastSeg.includes(`.${bare}`)
      || new RegExp(`(?:^|[\\s.>])${bare}(?:$|[\\s.>:])`).test(lastSeg)
    const ancestorHas = segments.slice(0, -1).some((seg) => seg.includes(`#${bare}`))
    const alone = segments.length === 1
    if (alone || lastHas || !ancestorHas) {
      if (s.startsWith('#') || s.startsWith('.')) return s
      if (/^[a-zA-Z][\w-]*$/.test(s)) return `#${s}`
      return s
    }
  }

  // Leaf сам с #id
  const lastId = lastSeg.match(/#([a-zA-Z][\w-]*)/)
  if (lastId) return `#${lastId[1]}`

  // Один semantic class на leaf
  const lastSemantic = semanticClassesIn(lastSeg)
  if (lastSemantic.length === 1 && !lastSeg.match(/:nth-of-type\(\d+\)/)) {
    return `.${lastSemantic[0]}`
  }
  if (lastSemantic.length === 1) {
    const t = lastSeg.match(/^([a-z][a-z0-9-]*)/i)?.[1] ?? tag
    const nth = lastSeg.match(/:nth-of-type\(\d+\)/)?.[0] ?? ''
    return t ? `${t}.${lastSemantic[0]}${nth}` : `.${lastSemantic[0]}${nth}`
  }

  // Предок с #id + все промежуточные якоря + leaf
  const ancestorId = nearestAncestorId(segments.slice(0, -1))
  if (ancestorId) {
    const parts = [`#${ancestorId}`]
    for (const seg of segments.slice(1, -1)) {
      const mid = formatMiddleBit(seg)
      if (mid) parts.push(mid)
    }
    parts.push(formatLeafBit(lastSeg, tag))
    return parts.join(' > ')
  }

  // Несколько semantic в пути — предпочесть leaf / parent>child
  const allSemantic = []
  for (const seg of segments) {
    for (const cls of semanticClassesIn(seg)) {
      allSemantic.push(`.${cls}`)
    }
  }

  if (allSemantic.length === 1) {
    return allSemantic[0]
  }

  if (allSemantic.length > 1) {
    const lastSemanticClass = allSemantic[allSemantic.length - 1]
    const parentSeg = segments[segments.length - 2] ?? ''
    const parentTag = parentSeg.match(/^([a-z][a-z0-9-]*)/i)?.[1]
    const childTag = lastSeg.match(/^([a-z][a-z0-9-]*)/i)?.[1] ?? tag
    if (parentTag && childTag) {
      const parentSem = semanticClassesIn(parentSeg)
      const parentBit = parentSem.length === 1
        ? `${parentTag}.${parentSem[0]}`
        : parentTag
      return `${parentBit} > ${childTag}${lastSemanticClass}`
    }
    return lastSemanticClass
  }

  if (segments.length >= 2) {
    return segments.slice(-2).map((seg, i, arr) => {
      if (i === arr.length - 1) return formatLeafBit(seg, tag)
      const id = seg.match(/#([a-zA-Z][\w-]*)/)
      if (id) return `#${id[1]}`
      const sem = semanticClassesIn(seg)
      const t = seg.match(/^([a-z][a-z0-9-]*)/i)?.[1]
      if (sem.length === 1 && t) return `${t}.${sem[0]}`
      return formatLeafBit(seg, tag)
    }).join(' > ')
  }

  return formatLeafBit(lastSeg, tag)
}

/**
 * @param {object} change
 * @returns {object}
 */
export function enrichChangeSelectors(change) {
  const diagnosticSelector = change.diagnosticSelector ?? change.selector
  const shortSelector = change.shortSelector
    ?? deriveShortSelector(diagnosticSelector, {
      stableId: change.stableId,
      tag: change.tag,
    })

  return {
    ...change,
    diagnosticSelector,
    shortSelector,
    selector: shortSelector,
  }
}
