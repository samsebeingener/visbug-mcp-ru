/**
 * ast-apply.js — правки className в TSX/JSX по visbug-src (Babel + tailwind-merge).
 * v0.9.0: margin, translate, width/height → arbitrary Tailwind utilities.
 * CSS fallback остаётся в auto-apply.js.
 */

import { readFileSync, writeFileSync } from 'fs'
import { extname } from 'path'
import { parse } from '@babel/parser'
import _traverse from '@babel/traverse'
import _generate from '@babel/generator'
import * as t from '@babel/types'
import { twMerge } from 'tailwind-merge'
import { parseVisbugSrc, resolveSourceFilePath, readRulePropFromCss, findRuleBodyByVisbugSrc } from './visbug-src.js'
import { marginFromAlignReference } from './move-target.js'

const traverse = _traverse.default ?? _traverse
const generate = _generate.default ?? _generate

const CODE_EXT = new Set(['.tsx', '.ts', '.jsx', '.js'])

/** Причины отказа AST — для логов и CSS fallback. */
export const AST_BLOCK_REASONS = {
  INNER_HTML: 'dangerously-set-inner-html',
  NO_LITERAL_CLASS: 'className-not-literal',
}

const MARGIN_UTILITY = {
  'margin-inline-start': 'ml',
  'margin-top': 'mt',
}

const DIMENSION_UTILITY = {
  width: 'w',
  height: 'h',
}

function parsePx(value) {
  const m = String(value ?? '').trim().match(/^(-?\d+(?:\.\d+)?)(px)?$/i)
  return m ? Number(m[1]) : NaN
}

function parseSource(code, filename) {
  const ext = extname(filename).toLowerCase()
  const plugins = ['jsx']
  if (ext === '.tsx' || ext === '.ts') plugins.push('typescript')
  return parse(code, {
    sourceType: 'module',
    plugins,
    sourceFilename: filename,
  })
}

function findJsxOpeningAt(ast, line, column = 1) {
  let best = null
  let bestDist = Infinity

  traverse(ast, {
    JSXOpeningElement(path) {
      const loc = path.node.loc
      if (!loc || loc.start.line !== line) return
      const dist = Math.abs(loc.start.column - column)
      if (dist < bestDist) {
        bestDist = dist
        best = path
      }
    },
  })

  return best
}

function getStringClassNameValue(attr) {
  if (!attr || !t.isJSXAttribute(attr)) return null
  const val = attr.value
  if (t.isStringLiteral(val)) return val.value
  if (t.isJSXExpressionContainer(val) && t.isStringLiteral(val.expression)) {
    return val.expression.value
  }
  return null
}

function setStringClassNameValue(attr, newValue) {
  if (t.isStringLiteral(attr.value)) {
    attr.value.value = newValue
    return
  }
  if (t.isJSXExpressionContainer(attr.value) && t.isStringLiteral(attr.value.expression)) {
    attr.value.expression.value = newValue
  }
}

export function readArbitraryUtilityPx(className, utilityPrefix) {
  const escaped = String(utilityPrefix).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(?:^|\\s)(-?)${escaped}-\\[(\\d+(?:\\.\\d+)?)px\\]`)
  const m = String(className ?? '').match(re)
  if (!m) return null
  const sign = m[1] === '-' ? -1 : 1
  return sign * Number(m[2])
}

export function stripArbitraryUtility(className, utilityPrefix) {
  const escaped = String(utilityPrefix).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return String(className ?? '')
    .replace(new RegExp(`\\s*-?${escaped}-\\[\\d+(?:\\.\\d+)?px\\]`, 'g'), '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function formatArbitraryUtility(px, utilityPrefix) {
  if (!Number.isFinite(px) || px === 0) return ''
  if (px < 0) return `-${utilityPrefix}-[${Math.abs(px)}px]`
  return `${utilityPrefix}-[${px}px]`
}

export function mergeArbitraryUtility(className, utilityPrefix, targetPx) {
  const stripped = stripArbitraryUtility(className, utilityPrefix)
  const utility = formatArbitraryUtility(targetPx, utilityPrefix)
  return twMerge(stripped, utility).trim()
}

const marginPrefix = (prop) => MARGIN_UTILITY[prop] ?? 'ml'

export function readMarginUtilityPx(className, prop) {
  return readArbitraryUtilityPx(className, marginPrefix(prop))
}

export function stripMarginUtility(className, prop) {
  return stripArbitraryUtility(className, marginPrefix(prop))
}

export function formatMarginUtility(px, prop) {
  return formatArbitraryUtility(px, marginPrefix(prop))
}

export function mergeMarginUtility(className, prop, targetPx) {
  return mergeArbitraryUtility(className, marginPrefix(prop), targetPx)
}

export function readTranslateUtilityPx(className, axis) {
  const prefix = axis === 'y' ? 'translate-y' : 'translate-x'
  return readArbitraryUtilityPx(className, prefix)
}

export function mergeTranslateUtilities(className, { x, y }) {
  let next = className
  if (Number.isFinite(x)) next = mergeArbitraryUtility(next, 'translate-x', x)
  if (Number.isFinite(y)) next = mergeArbitraryUtility(next, 'translate-y', y)
  return twMerge(next).trim()
}

export function parseTransformTranslate(value) {
  const m = String(value ?? '').trim().match(/translate\(\s*([^,)]+)\s*,\s*([^)]+)\s*\)/i)
  if (!m) return null
  const x = parsePx(m[1])
  const y = parsePx(m[2])
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x, y }
}

function openingHasDangerousInnerHtml(openingPath) {
  for (const attr of openingPath.node.attributes) {
    if (!t.isJSXAttribute(attr) || !t.isJSXIdentifier(attr.name)) continue
    if (attr.name.name === 'dangerouslySetInnerHTML') return true
  }
  return false
}

function hasDangerousInnerHtml(path) {
  if (openingHasDangerousInnerHtml(path)) return true
  let found = false
  path.findParent((parent) => {
    if (!parent.isJSXOpeningElement()) return false
    if (openingHasDangerousInnerHtml(parent)) {
      found = true
      return true
    }
    return false
  })
  return found
}

function patchJsxClassName(ast, line, column, updater) {
  const opening = findJsxOpeningAt(ast, line, column)
  if (!opening) return { ok: false, reason: 'jsx-not-found' }

  if (hasDangerousInnerHtml(opening)) {
    return { ok: false, reason: AST_BLOCK_REASONS.INNER_HTML }
  }

  const attrs = opening.node.attributes
  const classAttr = attrs.find(
    (a) => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name) && a.name.name === 'className',
  )

  const current = classAttr ? getStringClassNameValue(classAttr) : ''
  if (classAttr && current === null) {
    return { ok: false, reason: AST_BLOCK_REASONS.NO_LITERAL_CLASS }
  }

  const next = updater(current ?? '')
  if (next === (current ?? '')) return { ok: false, reason: 'no-change' }

  if (!classAttr) {
    opening.node.attributes.push(
      t.jsxAttribute(t.jsxIdentifier('className'), t.stringLiteral(next)),
    )
  } else if (!classAttr.value) {
    classAttr.value = t.stringLiteral(next)
  } else {
    setStringClassNameValue(classAttr, next)
  }

  return { ok: true, opening, nextClassName: next }
}

function readClassNameAtVisbugSrc(filePath, parsed) {
  const code = readFileSync(filePath, 'utf8')
  const ast = parseSource(code, filePath)
  const opening = findJsxOpeningAt(ast, parsed.line, parsed.column)
  if (!opening) return null
  const classAttr = opening.node.attributes.find(
    (a) => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name) && a.name.name === 'className',
  )
  if (!classAttr) return ''
  const current = getStringClassNameValue(classAttr)
  if (current === null) return null
  return current
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function readRuleRawProp(css, selector, prop, visbugSrc) {
  if (visbugSrc) {
    const body = findRuleBodyByVisbugSrc(css, visbugSrc)
    if (body) {
      const pm = body.match(new RegExp(`${escapeRe(prop)}\\s*:\\s*([^;]+)`, 'i'))
      if (pm) return String(pm[1]).trim()
    }
  }
  const sel = String(selector ?? '').replace(/\s+/g, ' ').trim()
  const blockRe = new RegExp(`(${escapeRe(sel)}\\s*\\{)([^}]*)(\\})`, 'm')
  const m = css.match(blockRe)
  if (!m) return null
  const pm = m[2].match(new RegExp(`${escapeRe(prop)}\\s*:\\s*([^;]+)`, 'i'))
  return pm ? String(pm[1]).trim() : null
}

function readTransformPxFromCss(css, selector, visbugSrc) {
  const raw = readRuleRawProp(css, selector, 'transform', visbugSrc)
  if (!raw) return null
  return parseTransformTranslate(raw)
}

function resolveAxisTargetPx(change, axis, base, deltaChange) {
  const alignTarget = marginFromAlignReference(deltaChange, base)
  if (alignTarget !== null) return alignTarget
  const delta = parsePx(deltaChange?.newValue)
  if (!Number.isFinite(delta)) return null
  return base + delta
}

function hasVisbugSrcTarget(change, layout) {
  if (layout !== 'framework-src') return false
  if (!change?.visbugSrc) return false
  const parsed = parseVisbugSrc(change.visbugSrc)
  if (!parsed) return false
  return CODE_EXT.has(extname(parsed.relativePath))
}

/**
 * Целевой margin: className utility + CSS overlay (visbug-src) + дельта VisBug.
 */
export function resolveMoveTargetPx(workspace, change, plan, applySelector, target, leftChange, topChange) {
  const filePath = resolveSourceFilePath(workspace, change.visbugSrc)
  const parsed = parseVisbugSrc(change.visbugSrc)
  if (!filePath || !parsed) return null

  let className
  try {
    className = readClassNameAtVisbugSrc(filePath, parsed)
  } catch {
    return null
  }
  if (className === null) return null

  const cssProp = plan.prop === 'margin-top' ? 'margin-top' : 'margin-inline-start'
  let base = readMarginUtilityPx(className, plan.prop)
  if (base === null && target?.type === 'file') {
    try {
      const css = readFileSync(target.path, 'utf8')
      const cssPx = readRulePropFromCss(
        css,
        applySelector,
        cssProp,
        change.visbugSrc ?? target.visbugSrc,
      )
      if (Number.isFinite(cssPx)) base = cssPx
    } catch {}
  }
  if (base === null) base = 0

  const deltaChange = plan.prop === 'margin-top' ? topChange : leftChange
  return resolveAxisTargetPx(change, plan.prop === 'margin-top' ? 'y' : 'x', base, deltaChange)
}

/**
 * Целевые translate-x/y: utilities + CSS transform overlay + дельта / align.reference.
 */
export function resolveTranslateTargets(
  workspace,
  change,
  plan,
  applySelector,
  target,
  leftChange,
  topChange,
) {
  const filePath = resolveSourceFilePath(workspace, change.visbugSrc)
  const parsed = parseVisbugSrc(change.visbugSrc)
  if (!filePath || !parsed) return null

  let className
  try {
    className = readClassNameAtVisbugSrc(filePath, parsed)
  } catch {
    return null
  }
  if (className === null) return null

  let baseX = readTranslateUtilityPx(className, 'x')
  let baseY = readTranslateUtilityPx(className, 'y')
  if (baseX === null) baseX = 0
  if (baseY === null) baseY = 0

  if (target?.type === 'file' && (baseX === 0 && baseY === 0)) {
    try {
      const css = readFileSync(target.path, 'utf8')
      const fromCss = readTransformPxFromCss(
        css,
        applySelector,
        change.visbugSrc ?? target.visbugSrc,
      )
      if (fromCss) {
        baseX = fromCss.x
        baseY = fromCss.y
      }
    } catch {}
  }

  let targetX = leftChange ? resolveAxisTargetPx(change, 'x', baseX, leftChange) : null
  let targetY = topChange ? resolveAxisTargetPx(change, 'y', baseY, topChange) : null

  if (targetX === null && targetY === null && plan?.value) {
    const delta = parseTransformTranslate(plan.value)
    if (delta) {
      targetX = baseX + delta.x
      targetY = baseY + delta.y
    }
  }

  if (targetX === null && targetY === null) return null
  return {
    x: Number.isFinite(targetX) ? targetX : baseX,
    y: Number.isFinite(targetY) ? targetY : baseY,
  }
}

export function canTryAstMoveApply(change, plan, layout) {
  if (!hasVisbugSrcTarget(change, layout)) return false
  if (plan?.kind !== 'css-prop') return false
  return plan.prop === 'margin-inline-start' || plan.prop === 'margin-top'
}

export function canTryAstTransformApply(change, plan, layout) {
  if (!hasVisbugSrcTarget(change, layout)) return false
  if (plan?.kind !== 'css-prop') return false
  return plan.prop === 'transform'
}

export function canTryAstDimensionApply(change, prop, layout) {
  if (!hasVisbugSrcTarget(change, layout)) return false
  return prop === 'width' || prop === 'height'
}

function writePatchedClassName(filePath, parsed, updater) {
  const code = readFileSync(filePath, 'utf8')
  let ast
  try {
    ast = parseSource(code, filePath)
  } catch (err) {
    return { ok: false, reason: `parse-error: ${err.message}` }
  }

  const result = patchJsxClassName(ast, parsed.line, parsed.column, updater)
  if (!result.ok) return result

  const { code: nextCode } = generate(ast, { retainLines: true }, code)
  writeFileSync(filePath, nextCode, 'utf8')

  return {
    ok: true,
    file: filePath,
    className: result.nextClassName,
    strategy: 'className',
  }
}

export function tryApplyMoveAst(workspace, change, plan) {
  const filePath = resolveSourceFilePath(workspace, change.visbugSrc)
  if (!filePath || !CODE_EXT.has(extname(filePath))) {
    return { ok: false, reason: 'no-source-file' }
  }

  const parsed = parseVisbugSrc(change.visbugSrc)
  if (!parsed) return { ok: false, reason: 'bad-visbug-src' }

  const targetPx = parsePx(plan.value)
  if (!Number.isFinite(targetPx)) return { ok: false, reason: 'bad-target-px' }

  const result = writePatchedClassName(filePath, parsed, (className) => (
    mergeMarginUtility(className, plan.prop, targetPx)
  ))

  if (!result.ok) return result

  return {
    ...result,
    prop: plan.prop,
    value: plan.value,
  }
}

export function tryApplyTranslateAst(workspace, change, targets) {
  const filePath = resolveSourceFilePath(workspace, change.visbugSrc)
  if (!filePath || !CODE_EXT.has(extname(filePath))) {
    return { ok: false, reason: 'no-source-file' }
  }

  const parsed = parseVisbugSrc(change.visbugSrc)
  if (!parsed) return { ok: false, reason: 'bad-visbug-src' }
  if (!targets || (!Number.isFinite(targets.x) && !Number.isFinite(targets.y))) {
    return { ok: false, reason: 'bad-translate-targets' }
  }

  const result = writePatchedClassName(filePath, parsed, (className) => (
    mergeTranslateUtilities(className, targets)
  ))

  if (!result.ok) return result

  return {
    ...result,
    prop: 'transform',
    value: `translate(${targets.x ?? 0}px, ${targets.y ?? 0}px)`,
    targets,
  }
}

export function tryApplyDimensionAst(workspace, change, prop, value) {
  const utilityPrefix = DIMENSION_UTILITY[prop]
  if (!utilityPrefix) return { ok: false, reason: 'bad-dimension-prop' }

  const filePath = resolveSourceFilePath(workspace, change.visbugSrc)
  if (!filePath || !CODE_EXT.has(extname(filePath))) {
    return { ok: false, reason: 'no-source-file' }
  }

  const parsed = parseVisbugSrc(change.visbugSrc)
  if (!parsed) return { ok: false, reason: 'bad-visbug-src' }

  const targetPx = parsePx(value)
  if (!Number.isFinite(targetPx)) return { ok: false, reason: 'bad-target-px' }

  const result = writePatchedClassName(filePath, parsed, (className) => (
    mergeArbitraryUtility(className, utilityPrefix, targetPx)
  ))

  if (!result.ok) return result

  return {
    ...result,
    prop,
    value: `${targetPx}px`,
  }
}
