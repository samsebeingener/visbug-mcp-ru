/**
 * ast-apply.js — правки className в TSX/JSX по visbug-src (Babel + tailwind-merge).
 * CSS fallback остаётся в auto-apply.js.
 */

import { readFileSync, writeFileSync } from 'fs'
import { extname } from 'path'
import { parse } from '@babel/parser'
import _traverse from '@babel/traverse'
import _generate from '@babel/generator'
import * as t from '@babel/types'
import { twMerge } from 'tailwind-merge'
import { parseVisbugSrc, resolveSourceFilePath, readRulePropFromCss } from './visbug-src.js'
import { marginFromAlignReference } from './move-target.js'

const traverse = _traverse.default ?? _traverse
const generate = _generate.default ?? _generate

const CODE_EXT = new Set(['.tsx', '.ts', '.jsx', '.js'])

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

const marginPrefix = (prop) => (prop === 'margin-top' ? 'mt' : 'ml')

export function readMarginUtilityPx(className, prop) {
  const prefix = marginPrefix(prop)
  const re = new RegExp(`(?:^|\\s)(-?)${prefix}-\\[(\\d+(?:\\.\\d+)?)px\\]`)
  const m = String(className ?? '').match(re)
  if (!m) return null
  const sign = m[1] === '-' ? -1 : 1
  return sign * Number(m[2])
}

export function stripMarginUtility(className, prop) {
  const prefix = marginPrefix(prop)
  return String(className ?? '')
    .replace(new RegExp(`\\s*-?${prefix}-\\[\\d+(?:\\.\\d+)?px\\]`, 'g'), '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function formatMarginUtility(px, prop) {
  const prefix = marginPrefix(prop)
  if (!Number.isFinite(px) || px === 0) return ''
  if (px < 0) return `-${prefix}-[${Math.abs(px)}px]`
  return `${prefix}-[${px}px]`
}

export function mergeMarginUtility(className, prop, targetPx) {
  const stripped = stripMarginUtility(className, prop)
  const utility = formatMarginUtility(targetPx, prop)
  return twMerge(stripped, utility).trim()
}

function hasDangerousInnerHtml(path) {
  let found = false
  path.findParent((parent) => {
    if (!parent.isJSXOpeningElement()) return false
    for (const attr of parent.node.attributes) {
      if (!t.isJSXAttribute(attr) || !t.isJSXIdentifier(attr.name)) continue
      if (attr.name.name === 'dangerouslySetInnerHTML') {
        found = true
        return true
      }
    }
    return false
  })
  return found
}

function patchJsxClassName(ast, line, column, updater) {
  const opening = findJsxOpeningAt(ast, line, column)
  if (!opening) return { ok: false, reason: 'jsx-not-found' }

  if (hasDangerousInnerHtml(opening)) {
    return { ok: false, reason: 'dangerously-set-inner-html' }
  }

  const attrs = opening.node.attributes
  const classAttr = attrs.find(
    (a) => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name) && a.name.name === 'className',
  )

  const current = classAttr ? getStringClassNameValue(classAttr) : ''
  if (classAttr && current === null) {
    return { ok: false, reason: 'className-not-literal' }
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
  const alignTarget = marginFromAlignReference(deltaChange, base)
  if (alignTarget !== null) return alignTarget

  const delta = parsePx(deltaChange?.newValue)
  if (!Number.isFinite(delta)) return null
  return base + delta
}

/**
 * @param {string} layout
 * @param {object} change
 * @param {{ kind: string, prop?: string, value?: string }} plan
 */
export function canTryAstMoveApply(change, plan, layout) {
  if (layout !== 'framework-src') return false
  if (!change?.visbugSrc) return false
  if (plan?.kind !== 'css-prop') return false
  if (plan.prop !== 'margin-inline-start' && plan.prop !== 'margin-top') return false
  const parsed = parseVisbugSrc(change.visbugSrc)
  if (!parsed) return false
  return CODE_EXT.has(extname(parsed.relativePath))
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

  const code = readFileSync(filePath, 'utf8')
  let ast
  try {
    ast = parseSource(code, filePath)
  } catch (err) {
    return { ok: false, reason: `parse-error: ${err.message}` }
  }

  const result = patchJsxClassName(ast, parsed.line, parsed.column, (className) => (
    mergeMarginUtility(className, plan.prop, targetPx)
  ))

  if (!result.ok) return result

  const { code: nextCode } = generate(ast, { retainLines: true }, code)
  writeFileSync(filePath, nextCode, 'utf8')

  return {
    ok: true,
    file: filePath,
    prop: plan.prop,
    value: plan.value,
    className: result.nextClassName,
    strategy: 'className',
  }
}
