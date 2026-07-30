/**
 * actions/tw-conflicts.js — минимальная карта конфликт-групп Tailwind
 * (tailwind-merge style). Recorder-only: только подсказка classesToRemove,
 * никакого auto-apply.
 */

function baseClass(cls) {
  // md:hover:px-4 → px-4; !px-4 → px-4
  const last = String(cls).split(':').pop() ?? ''
  return last.replace(/^!/, '')
}

function axisTags(prefix, cls) {
  // prefix = 'p' | 'm'
  const re = new RegExp(`^${prefix}([xytrbl])?-`)
  const m = baseClass(cls).match(re)
  if (!m) return null
  const axis = m[1]
  if (!axis) return new Set([prefix])
  if (axis === 'x') return new Set([prefix, `${prefix}x`])
  if (axis === 'y') return new Set([prefix, `${prefix}y`])
  if (axis === 't' || axis === 'b') return new Set([prefix, `${prefix}y`, `${prefix}${axis}`])
  return new Set([prefix, `${prefix}x`, `${prefix}${axis}`]) // l / r
}

/**
 * Набор конфликт-тегов класса. Два класса конфликтуют,
 * если пересечение их тегов непустое.
 * @param {string} cls
 * @returns {Set<string> | null}
 */
export function conflictTags(cls) {
  const base = baseClass(cls).replace(/^-/, '')
  if (!base) return null

  let m
  if ((m = base.match(/^translate-x-/))) return new Set(['translate', 'translate-x'])
  if ((m = base.match(/^translate-y-/))) return new Set(['translate', 'translate-y'])
  if (base.startsWith('translate-')) return new Set(['translate', 'translate-x', 'translate-y'])

  if (base.startsWith('scale-x-')) return new Set(['scale', 'scale-x'])
  if (base.startsWith('scale-y-')) return new Set(['scale', 'scale-y'])
  if (base.startsWith('scale-')) return new Set(['scale'])

  if (base.startsWith('rotate-')) return new Set(['rotate'])

  if (base.startsWith('col-span-')) return new Set(['col-span'])

  if (base.startsWith('max-w-')) return new Set(['max-w'])
  if (base.startsWith('w-')) return new Set(['w'])

  if (base.startsWith('inset-x-')) return new Set(['inset', 'inset-x'])
  if (base.startsWith('inset-y-')) return new Set(['inset', 'inset-y'])
  if (base.startsWith('inset-')) return new Set(['inset'])
  if (base.startsWith('left-')) return new Set(['inset', 'inset-x', 'left'])
  if (base.startsWith('right-')) return new Set(['inset', 'inset-x', 'right'])
  if (base.startsWith('top-')) return new Set(['inset', 'inset-y', 'top'])
  if (base.startsWith('bottom-')) return new Set(['inset', 'inset-y', 'bottom'])

  if (base.startsWith('gap-x-')) return new Set(['gap', 'gap-x'])
  if (base.startsWith('gap-y-')) return new Set(['gap', 'gap-y'])
  if (base.startsWith('gap-')) return new Set(['gap'])

  const pad = axisTags('p', base)
  if (pad) return pad
  const marg = axisTags('m', base)
  if (marg) return marg

  if (base === 'transform' || base.startsWith('transform-')) return new Set(['transform'])

  return null
}

/**
 * Классы из className, которые конфликтуют с newClasses (их надо удалить).
 * Точные совпадения с newClasses не удаляем.
 * @param {string} className — захваченный class-атрибут узла
 * @param {string[] | string} newClasses — новые классы из мутации
 * @returns {string[]}
 */
export function findConflictingClasses(className, newClasses) {
  const existing = String(className ?? '').split(/\s+/).filter(Boolean)
  const fresh = Array.isArray(newClasses)
    ? newClasses
    : String(newClasses ?? '').split(/\s+/).filter(Boolean)
  if (!existing.length || !fresh.length) return []

  const freshSet = new Set(fresh)
  const freshTags = fresh
    .map((c) => conflictTags(c))
    .filter(Boolean)

  const out = []
  for (const cls of existing) {
    if (freshSet.has(cls)) continue
    const tags = conflictTags(cls)
    if (!tags) continue
    const hit = freshTags.some((ft) => [...tags].some((t) => ft.has(t)))
    if (hit) out.push(cls)
  }
  return out
}
