/**
 * snap-meta.js — exact → threshold → arbitrary (FigmaToCode-inspired).
 * Node + browser-safe ESM.
 */

/** Common spacing / size scale (px). */
export const DEFAULT_PX_SCALE = Object.freeze([
  0, 1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48,
  56, 64, 72, 80, 96, 112, 128, 144, 160, 192, 224, 256, 288, 320, 384,
])

/** Absolute epsilon for "exact" integer px (FigmaToCode ~0.05). */
export const EXACT_EPS = 0.05

/** Max relative distance to scale step to count as snapped (5%). */
export const SNAP_THRESHOLD_RATIO = 0.05

/**
 * @param {string | number | null | undefined} raw
 * @returns {number | null}
 */
export function parseCssNumber(raw) {
  if (raw == null || raw === '') return null
  const m = String(raw).trim().match(/^(-?[\d.]+)(px)?$/i)
  if (!m) return null
  const n = parseFloat(m[1])
  return Number.isFinite(n) ? n : null
}

/**
 * Strip float noise: 538.672 → keep; 16.000 → 16; 16.02 near 16 → exact path.
 * @param {number} n
 * @returns {string}
 */
export function formatPxClean(n) {
  const rounded = Math.round(n)
  if (Math.abs(n - rounded) <= EXACT_EPS) return `${rounded}px`
  return `${Number(n.toFixed(2))}px`
}

/**
 * Snap a single px value.
 * @param {string | number | null | undefined} raw
 * @param {{ scale?: number[], thresholdRatio?: number }} [opts]
 * @returns {{
 *   match: 'exact' | 'snapped' | 'arbitrary' | 'passthrough',
 *   raw: string | null,
 *   value: string | null,
 *   numeric: number | null,
 *   scaleStep: number | null,
 * }}
 */
export function snapCssPx(raw, opts = {}) {
  const scale = opts.scale ?? DEFAULT_PX_SCALE
  const thresholdRatio = opts.thresholdRatio ?? SNAP_THRESHOLD_RATIO
  const rawStr = raw == null ? null : String(raw).trim()
  const n = parseCssNumber(rawStr)
  if (n == null) {
    return {
      match: 'passthrough',
      raw: rawStr,
      value: rawStr,
      numeric: null,
      scaleStep: null,
    }
  }

  const nearestInt = Math.round(n)
  if (Math.abs(n - nearestInt) <= EXACT_EPS) {
    return {
      match: 'exact',
      raw: rawStr,
      value: `${nearestInt}px`,
      numeric: nearestInt,
      scaleStep: scale.includes(Math.abs(nearestInt)) ? Math.abs(nearestInt) : null,
    }
  }

  let best = null
  let bestDist = Infinity
  for (const step of scale) {
    const signed = n < 0 ? -step : step
    const dist = Math.abs(n - signed)
    if (dist < bestDist) {
      bestDist = dist
      best = signed
    }
  }

  const denom = Math.max(Math.abs(n), 1)
  if (best != null && bestDist / denom <= thresholdRatio) {
    return {
      match: 'snapped',
      raw: rawStr,
      value: `${best}px`,
      numeric: best,
      scaleStep: Math.abs(best),
    }
  }

  return {
    match: 'arbitrary',
    raw: rawStr,
    value: formatPxClean(n),
    numeric: n,
    scaleStep: null,
  }
}

/**
 * Snap declaration value; handles plain px and translate(…).
 * width/height: subpixel → nearest integer (VisBug getBoundingClientRect).
 * @param {string} prop
 * @param {string | null | undefined} rawValue
 * @returns {{
 *   prop: string,
 *   value: string,
 *   snap: object,
 *   warning: string | null,
 * }}
 */
export function snapDeclaration(prop, rawValue) {
  const raw = rawValue == null ? '' : String(rawValue)

  if (prop === 'width' || prop === 'height') {
    const n = parseCssNumber(raw)
    if (n != null) {
      const rounded = Math.round(n)
      const value = `${rounded}px`
      const warning = Math.abs(n - rounded) > EXACT_EPS
        ? `${prop}: subpixel ${raw} → ${value}`
        : null
      return {
        prop,
        value,
        snap: {
          match: 'exact',
          raw,
          value,
          numeric: rounded,
          scaleStep: null,
          reason: 'size-round',
        },
        warning,
      }
    }
  }

  if (/^translate\(/i.test(raw)) {
    const m = raw.match(/translate\(\s*([^,]+)\s*,\s*([^)]+)\)(\s*.*)?$/i)
    if (m) {
      const sx = snapCssPx(m[1].trim())
      const sy = snapCssPx(m[2].trim())
      // хвост после translate() (scale()/rotate()) не затираем — P2
      const suffix = (m[3] ?? '').trim()
      const value = `translate(${sx.value}, ${sy.value})${suffix ? ` ${suffix}` : ''}`
      const matches = [sx.match, sy.match]
      let match = 'exact'
      if (matches.includes('arbitrary')) match = 'arbitrary'
      else if (matches.includes('snapped')) match = 'snapped'
      else if (matches.includes('passthrough')) match = 'passthrough'

      let warning = null
      if (match === 'snapped') {
        warning = `${prop}: snapped ${raw} → ${value}`
      } else if (match === 'arbitrary' && (sx.raw !== sx.value || sy.raw !== sy.value)) {
        warning = `${prop}: float cleaned ${raw} → ${value}`
      }

      return {
        prop,
        value,
        snap: { match, x: sx, y: sy, raw },
        warning,
      }
    }
  }

  if (prop === 'margin' && /\d/.test(raw) && !raw.includes('(')) {
    // "15px 0 0 10px" or "margin-top style single value already handled"
    const parts = raw.trim().split(/\s+/)
    if (parts.every((p) => parseCssNumber(p) != null || p === '0' || p === 'auto')) {
      const snappedParts = parts.map((p) => (p === 'auto' ? { match: 'passthrough', value: 'auto', raw: p } : snapCssPx(p)))
      const value = snappedParts.map((s) => s.value).join(' ')
      const matches = snappedParts.map((s) => s.match)
      let match = 'exact'
      if (matches.includes('arbitrary')) match = 'arbitrary'
      else if (matches.includes('snapped')) match = 'snapped'
      const warning = match === 'snapped' ? `${prop}: snapped ${raw} → ${value}` : null
      return { prop, value, snap: { match, parts: snappedParts, raw }, warning }
    }
  }

  const pxSnap = snapCssPx(raw)
  if (pxSnap.match !== 'passthrough') {
    let warning = null
    if (pxSnap.match === 'snapped') {
      warning = `${prop}: snapped ${raw} → ${pxSnap.value}`
    } else if (pxSnap.match === 'arbitrary' && pxSnap.raw !== pxSnap.value) {
      warning = `${prop}: float cleaned ${raw} → ${pxSnap.value}`
    }
    return {
      prop,
      value: pxSnap.value,
      snap: pxSnap,
      warning,
    }
  }

  return {
    prop,
    value: raw,
    snap: { match: 'passthrough', raw, value: raw },
    warning: null,
  }
}

/**
 * Flatten before/after CSS maps for buffer / JSON.
 * @param {Record<string, string | null | undefined>} map
 * @returns {Record<string, string>}
 */
export function flattenCssMap(map) {
  /** @type {Record<string, string>} */
  const out = {}
  for (const [k, v] of Object.entries(map ?? {})) {
    if (v == null || v === '') continue
    out[k] = String(v)
  }
  return out
}
