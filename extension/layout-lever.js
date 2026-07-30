/* AUTO-GENERATED from shared/layout-lever.js — do not edit; run npm run sync:extension */
/**
 * layout-lever.js — x + Δ = итог; выбор рычага (transform / margin).
 * Общая логика для extension (browser) и parser (Node).
 */

const LAYOUT_DELTA_MAX_RATIO = 0.75

function roundPx(value) {
  return Math.round(Number(value) || 0)
}

function parsePx(value) {
  if (value == null || value === '' || value === 'auto') return 0
  const n = parseFloat(String(value))
  return Number.isFinite(n) ? roundPx(n) : 0
}

/** @returns {{ tx: number, ty: number }} */
function parseTransformTranslate(transform) {
  if (!transform || transform === 'none') return { tx: 0, ty: 0 }
  const m2d = transform.match(/^matrix\(([^)]+)\)$/)
  if (m2d) {
    const p = m2d[1].split(',').map((s) => parseFloat(s.trim()))
    if (p.length >= 6) return { tx: roundPx(p[4]), ty: roundPx(p[5]) }
  }
  const m3d = transform.match(/^matrix3d\(([^)]+)\)$/)
  if (m3d) {
    const p = m3d[1].split(',').map((s) => parseFloat(s.trim()))
    if (p.length >= 16) return { tx: roundPx(p[12]), ty: roundPx(p[13]) }
  }
  const t = transform.match(/translate(?:3d)?\(([^)]+)\)/)
  if (t) {
    const parts = t[1].split(',').map((s) => s.trim())
    const tx = parsePx(parts[0])
    const ty = parts.length > 1 ? parsePx(parts[1]) : 0
    return { tx, ty }
  }
  return { tx: 0, ty: 0 }
}

/** Декомпозиция 2D-матрицы [a,b,c,d,e,f] в translate/scale/rotate. */
function decomposeMatrix2d(a, b, c, d, e, f) {
  const scaleX = Math.hypot(a, b) || 1
  const det = a * d - b * c
  const scaleY = det / scaleX
  const rotate = Math.atan2(b, a) * (180 / Math.PI)
  return {
    tx: roundPx(e),
    ty: roundPx(f),
    scaleX: roundFactor(scaleX),
    scaleY: roundFactor(scaleY),
    rotate: roundAngle(rotate),
  }
}

function roundFactor(n) {
  const r = Math.round(n * 10000) / 10000
  return Object.is(r, -0) ? 0 : r
}

function roundAngle(n) {
  const r = Math.round(n * 100) / 100
  return Object.is(r, -0) ? 0 : r
}

/** Перемножение 2D-матриц [a,b,c,d,e,f]: m1 * m2. */
function multiplyMatrix2d(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ]
}

const TRANSFORM_FN_RE = /(translate3d|translate|translateX|translateY|scale3d|scale|scaleX|scaleY|rotate)\(([^)]*)\)/g

/**
 * Разбор transform-строки в части: translate + scale + rotate.
 * Поддерживает matrix()/matrix3d() (computed style) и цепочки
 * translate()/scale()/rotate() в любой комбинации.
 * @param {string} transform
 * @returns {{ tx: number, ty: number, scaleX: number, scaleY: number, rotate: number }}
 */
function parseTransformParts(transform) {
  const identity = { tx: 0, ty: 0, scaleX: 1, scaleY: 1, rotate: 0 }
  if (!transform || transform === 'none') return identity
  const s = String(transform).trim()

  const m2d = s.match(/^matrix\(([^)]+)\)$/)
  if (m2d) {
    const p = m2d[1].split(',').map((v) => parseFloat(v.trim()))
    if (p.length >= 6 && p.every(Number.isFinite)) {
      return decomposeMatrix2d(p[0], p[1], p[2], p[3], p[4], p[5])
    }
    return identity
  }
  const m3d = s.match(/^matrix3d\(([^)]+)\)$/)
  if (m3d) {
    const p = m3d[1].split(',').map((v) => parseFloat(v.trim()))
    if (p.length >= 16 && p.every(Number.isFinite)) {
      // column-major: a,b = m11,m21; c,d = m12,m22; e,f = m41,m42
      return decomposeMatrix2d(p[0], p[1], p[4], p[5], p[12], p[13])
    }
    return identity
  }

  let matrix = [1, 0, 0, 1, 0, 0]
  let matched = false
  for (const m of s.matchAll(TRANSFORM_FN_RE)) {
    matched = true
    const fn = m[1]
    const args = m[2].split(',').map((v) => v.trim())
    const nums = args.map((v) => parseFloat(v))
    let local = [1, 0, 0, 1, 0, 0]
    if (fn === 'translate' || fn === 'translate3d') {
      local = [1, 0, 0, 1, nums[0] || 0, nums[1] || 0]
    } else if (fn === 'translateX') {
      local = [1, 0, 0, 1, nums[0] || 0, 0]
    } else if (fn === 'translateY') {
      local = [1, 0, 0, 1, 0, nums[0] || 0]
    } else if (fn === 'scale' || fn === 'scale3d') {
      const sx = Number.isFinite(nums[0]) ? nums[0] : 1
      const sy = Number.isFinite(nums[1]) ? nums[1] : sx
      local = [sx, 0, 0, sy, 0, 0]
    } else if (fn === 'scaleX') {
      local = [nums[0] || 1, 0, 0, 1, 0, 0]
    } else if (fn === 'scaleY') {
      local = [1, 0, 0, nums[0] || 1, 0, 0]
    } else if (fn === 'rotate') {
      const rad = ((nums[0] || 0) * Math.PI) / 180
      const cos = Math.cos(rad)
      const sin = Math.sin(rad)
      local = [cos, sin, -sin, cos, 0, 0]
    }
    matrix = multiplyMatrix2d(matrix, local)
  }
  if (!matched) return identity
  return decomposeMatrix2d(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5])
}

function formatFactor(n) {
  return String(roundFactor(n))
}

/**
 * Сборка CSS transform из частей с сохранением scale/rotate
 * (чтобы write не затирал scale() / hover:scale при merge Δ).
 * @param {{ tx?: number, ty?: number, scaleX?: number, scaleY?: number, rotate?: number }} parts
 * @returns {string}
 */
function formatTransformParts(parts) {
  const { tx = 0, ty = 0, scaleX = 1, scaleY = 1, rotate = 0 } = parts ?? {}
  const out = []
  if (tx || ty) out.push(formatTranslate(roundPx(tx), roundPx(ty)))
  if (scaleX !== 1 || scaleY !== 1) {
    out.push(scaleX === scaleY
      ? `scale(${formatFactor(scaleX)})`
      : `scale(${formatFactor(scaleX)}, ${formatFactor(scaleY)})`)
  }
  if (rotate) out.push(`rotate(${roundAngle(rotate)}deg)`)
  return out.length ? out.join(' ') : 'none'
}

/** Есть ли у transform части, которые потеряет голый translate-merge. */
function hasNonTranslateParts(parts) {
  if (!parts) return false
  return parts.scaleX !== 1 || parts.scaleY !== 1 || Boolean(parts.rotate)
}

/**
 * Рычаг для визуального сдвига (Position/Move drag).
 * Закон: визуальный сдвиг НЕ должен двигать соседей — а margin в потоке
 * толкает всех ниже/правее. Поэтому для layout-delta всегда transform.
 * Margin-рычаг допустим только из явных правок Margin-инструментом
 * (style-мутации, не layout-delta).
 * @param {object} parentLayout
 * @returns {'transform' | 'margin'}
 */
function suggestLever(parentLayout) {
  void parentLayout
  return 'transform'
}

/**
 * Снимок offset из computed style (x_computed до/после drag).
 * @param {CSSStyleDeclaration | object} cs
 */
function readOffsetFromComputedStyle(cs) {
  const transformRaw = cs.transform ?? 'none'
  const transform = parseTransformTranslate(transformRaw)
  const transformParts = parseTransformParts(transformRaw)
  const marginX = parsePx(cs.marginInlineStart ?? cs.marginLeft)
  const marginY = parsePx(cs.marginTop)
  const relativeX = cs.position === 'relative' ? parsePx(cs.left) : 0
  const relativeY = cs.position === 'relative' ? parsePx(cs.top) : 0

  return {
    transform,
    transformRaw: transformRaw === 'none' ? null : String(transformRaw),
    transformParts,
    margin: { x: marginX, y: marginY },
    relative: { x: relativeX, y: relativeY },
  }
}

/** Визуальный x как единый translate-эквивалент (для формулы в буфере). */
function visualOffsetFromParts(parts) {
  const t = parts?.transform ?? { tx: 0, ty: 0 }
  const m = parts?.margin ?? { x: 0, y: 0 }
  const r = parts?.relative ?? { x: 0, y: 0 }
  return {
    tx: roundPx(t.tx + m.x + r.x),
    ty: roundPx(t.ty + m.y + r.y),
  }
}

function addVisualDelta(visual, deltaX, deltaY) {
  return {
    tx: roundPx(visual.tx + deltaX),
    ty: roundPx(visual.ty + deltaY),
  }
}

function formatTranslate(tx, ty) {
  return `translate(${tx}px, ${ty}px)`
}

function formatMargin(x, y) {
  if (x && y) return `margin: ${y}px 0 0 ${x}px`
  if (x) return `margin-inline-start: ${x}px`
  if (y) return `margin-top: ${y}px`
  return 'margin: 0'
}

/** Строка x для буфера (computed в браузере). */
function formatXComputed(parts) {
  const v = visualOffsetFromParts(parts)
  if (v.tx === 0 && v.ty === 0) return '0'
  return formatTranslate(v.tx, v.ty)
}

function formatApplyRecipe({ lever, xComputed, deltaX, deltaY }) {
  const x = typeof xComputed === 'object' && 'tx' in xComputed
    ? xComputed
    : visualOffsetFromParts(xComputed)
  const result = addVisualDelta(x, deltaX, deltaY)

  if (lever === 'margin') {
    return {
      lever,
      xFileHint: formatMargin(x.tx, x.ty),
      deltaHint: `Δ margin (${deltaX}px, ${deltaY}px)`,
      resultHint: formatMargin(result.tx, result.ty),
      resultTransform: formatTranslate(result.tx, result.ty),
    }
  }

  return {
    lever: 'transform',
    xFileHint: formatTranslate(x.tx, x.ty),
    deltaHint: `Δ (${deltaX}px, ${deltaY}px)`,
    resultHint: formatTranslate(result.tx, result.ty),
    resultTransform: formatTranslate(result.tx, result.ty),
  }
}

function isSuspiciousDelta(deltaX, deltaY, viewport) {
  const vw = viewport?.width ?? 0
  const vh = viewport?.height ?? 0
  if (!vw || !vh) return false
  const limit = Math.max(vw, vh) * LAYOUT_DELTA_MAX_RATIO
  return Math.abs(deltaX) > limit || Math.abs(deltaY) > limit
}

function formatParentLayoutShort(parentLayout) {
  if (!parentLayout) return ''
  const display = parentLayout.display ?? parentLayout.computed?.display ?? ''
  const justify = parentLayout.justifyContent ?? parentLayout.computed?.justifyContent ?? ''
  const align = parentLayout.alignItems ?? parentLayout.computed?.alignItems ?? ''
  const gap = parentLayout.gap ?? parentLayout.computed?.gap ?? ''
  const parts = []
  if (display) parts.push(`display:${display}`)
  if (justify && justify !== 'normal') parts.push(`justify:${justify}`)
  if (align && align !== 'normal' && align !== 'stretch') parts.push(`align:${align}`)
  if (gap && gap !== 'normal' && gap !== '0px') parts.push(`gap:${gap}`)
  return parts.join(' ')
}

function formatVisbugFileHint(c) {
  const visbugSrc = c.visbugSrc ?? c.target?.visbugSrc
  if (!visbugSrc) return null
  const match = String(visbugSrc).match(/^(.*?):\d+:\d+$/)
  return match?.[1]?.replace(/\\/g, '/') ?? null
}

function formatStableHint(c) {
  if (c.stableId) {
    const s = String(c.stableId)
    if (s.startsWith('#') || s.startsWith('.')) return s
    return `#${s}`
  }
  return c.shortSelector ?? null
}

/**
 * v0.17+ строка буфера для layout-delta.
 */
function formatLayoutDeltaBufferLine(index, c) {
  const parent = c.parentLayout ?? c.layoutContext?.parent
  const lever = c.lever ?? suggestLever(parent)
  const xBefore = c.offsetBefore
    ? visualOffsetFromParts(c.offsetBefore)
    : visualOffsetFromParts({ transform: { tx: 0, ty: 0 } })
  const recipe = formatApplyRecipe({
    lever,
    xComputed: xBefore,
    deltaX: c.deltaX ?? 0,
    deltaY: c.deltaY ?? 0,
  })

  const parentPart = formatParentLayoutShort(parent)
  const rectPart = c.rectBefore && c.rectAfter
    ? ` | rect: (${c.rectBefore.left},${c.rectBefore.top})→(${c.rectAfter.left},${c.rectAfter.top})`
    : ''
  const fileHint = c.fileHint ?? formatVisbugFileHint(c)
  const stableHint = formatStableHint(c)
  const shortSelector = c.shortSelector ?? c.selector
  const diagnostic = c.diagnosticSelector
  const alignRef = c.align?.reference?.selector

  const lines = [
    `[${index}]`,
    `  селектор (короткий): ${shortSelector}`,
  ]
  if (diagnostic && diagnostic !== shortSelector) {
    lines.push(`  селектор (диагностика): ${diagnostic}`)
  }
  lines.push(
    `  → x: ${recipe.xFileHint}`,
    `  + Δ: (${c.deltaX}px, ${c.deltaY}px)`,
    `  = ${recipe.resultHint}`,
    `  | рычаг: ${lever}`,
  )
  if (fileHint) lines.push(`  | файл: ${fileHint}`)
  if (stableHint && stableHint !== shortSelector) lines.push(`  | stable: ${stableHint}`)
  if (parentPart) lines.push(`  | родитель: ${parentPart}`)
  if (alignRef) lines.push(`  | align: ${alignRef} (${c.align?.reference?.edge ?? c.align?.edge ?? 'edge'})`)
  lines.push(
    `  | в файле: x_file + Δ тем же рычагом (HTML <style> / CSS / Next globals)${rectPart}`,
    `  (viewport ${c.viewport?.width ?? '?'}×${c.viewport?.height ?? '?'})`,
  )

  return lines.join('\n')
}

if (typeof globalThis !== 'undefined') {
  globalThis.VisbugMcpLayoutLever = {
    LAYOUT_DELTA_MAX_RATIO,
    roundPx,
    parsePx,
    parseTransformTranslate,
    parseTransformParts,
    formatTransformParts,
    hasNonTranslateParts,
    suggestLever,
    readOffsetFromComputedStyle,
    visualOffsetFromParts,
    addVisualDelta,
    formatTranslate,
    formatMargin,
    formatXComputed,
    formatApplyRecipe,
    isSuspiciousDelta,
    formatParentLayoutShort,
    formatLayoutDeltaBufferLine,
  }
}
