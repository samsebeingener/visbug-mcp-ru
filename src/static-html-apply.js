/**
 * Static HTML (Tailwind CDN): width/height → patch class on the matching tag.
 * CSS in <style> loses to runtime Tailwind utilities (h-11, w-full, …).
 */

import { readFileSync, writeFileSync } from 'fs'
import { mergeArbitraryUtility, mergeTranslateUtilities, parseTransformTranslate } from './ast-apply.js'

function parsePx(value) {
  const n = parseFloat(String(value ?? '').replace(/px$/i, '').trim())
  return Number.isFinite(n) ? n : null
}

/** Tailwind arbitrary utilities — целые px, без 159.906. */
export function roundPxForUtility(value) {
  const n = parsePx(value)
  if (!Number.isFinite(n)) return null
  return Math.round(n)
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function classAttrHasToken(classAttr, token) {
  return new RegExp(`(?:^|\\s)${escapeRe(token)}(?:\\s|$)`).test(classAttr)
}

function findTagWithClassInScope(html, scopeHtml, classToken, tagName = null) {
  const tagPattern = tagName ? escapeRe(tagName) : '\\w+'
  const re = new RegExp(`<(${tagPattern})\\b([^>]*)>`, 'gi')
  let match
  while ((match = re.exec(scopeHtml))) {
    const attrs = match[2]
    const classM = attrs.match(/\bclass=(["'])([^"']*)\1/i)
    if (!classM) continue
    if (classAttrHasToken(classM[2], classToken)) {
      return {
        index: match.index,
        full: match[0],
        tagName: match[1],
      }
    }
  }
  return null
}

/**
 * @param {string} html
 * @param {string} applySelector
 * @returns {{ index: number, full: string } | null}
 */
export function findStaticHtmlOpeningTag(html, applySelector) {
  const sel = String(applySelector ?? '').trim()
  if (!sel) return null

  const idOnly = sel.match(/^#([a-zA-Z][\w-]*)$/)
  if (idOnly) {
    const id = idOnly[1]
    const re = new RegExp(`<(\\w+)\\b[^>]*\\bid=["']${escapeRe(id)}["'][^>]*>`, 'i')
    const m = html.match(re)
    if (!m || m.index === undefined) return null
    return { index: m.index, full: m[0] }
  }

  const headerAnchor = sel.match(/^header\s+a\.([\w-]+)$/)
  if (headerAnchor) {
    const cls = headerAnchor[1]
    const headerM = html.match(/<header\b[\s\S]*?<\/header>/i)
    if (!headerM || headerM.index === undefined) return null
    const inner = findTagWithClassInScope(html, headerM[0], cls, 'a')
    if (!inner) return null
    return { index: headerM.index + inner.index, full: inner.full }
  }

  const sectionLeaf = sel.match(/^#([a-zA-Z][\w-]*)\s+\.([\w-]+)$/)
  if (sectionLeaf) {
    const [, sectionId, leafCls] = sectionLeaf
    const sectionRe = new RegExp(
      `<section\\b[^>]*\\bid=["']${escapeRe(sectionId)}["'][^>]*>[\\s\\S]*?</section>`,
      'i',
    )
    const sm = html.match(sectionRe)
    if (!sm || sm.index === undefined) return null
    const inner = findTagWithClassInScope(html, sm[0], leafCls)
    if (!inner) return null
    return { index: sm.index + inner.index, full: inner.full }
  }

  const clsOnly = sel.match(/^\.([\w-]+)$/)
  if (clsOnly) {
    const cls = clsOnly[1]
    const re = new RegExp(
      `<(\\w+)\\b([^>]*)\\bclass=(["'])([^"']*)\\3[^>]*>`,
      'gi',
    )
    const hits = []
    let m
    while ((m = re.exec(html))) {
      if (classAttrHasToken(m[4], cls)) {
        hits.push({ index: m.index, full: m[0] })
      }
    }
    if (hits.length !== 1) return null
    return hits[0]
  }

  return null
}

function patchOpeningTagClass(openingTag, updater) {
  const classRe = /\bclass=(["'])([^"']*)\1/i
  const m = openingTag.match(classRe)
  if (!m) return null
  const nextClass = updater(m[2]).trim()
  if (!nextClass || nextClass === m[2]) return null
  return openingTag.replace(classRe, `class=${m[1]}${nextClass}${m[1]}`)
}

/**
 * @param {string} htmlPath
 * @param {string} applySelector
 * @param {'width' | 'height'} prop
 * @param {string} value
 */
export function tryApplyStaticHtmlDimension(htmlPath, applySelector, prop, value) {
  const utilityPrefix = prop === 'width' ? 'w' : prop === 'height' ? 'h' : null
  if (!utilityPrefix) return { ok: false, reason: 'bad-dimension-prop' }

  const targetPx = roundPxForUtility(value)
  if (!Number.isFinite(targetPx)) return { ok: false, reason: 'bad-px' }

  const html = readFileSync(htmlPath, 'utf8')
  const found = findStaticHtmlOpeningTag(html, applySelector)
  if (!found) return { ok: false, reason: 'tag-not-found' }

  const patched = patchOpeningTagClass(found.full, (className) => (
    mergeArbitraryUtility(className, utilityPrefix, targetPx)
  ))
  if (!patched) return { ok: false, reason: 'class-unchanged' }

  const nextHtml = `${html.slice(0, found.index)}${patched}${html.slice(found.index + found.full.length)}`
  writeFileSync(htmlPath, nextHtml, 'utf8')

  return {
    ok: true,
    file: htmlPath,
    prop,
    value: `${targetPx}px`,
    strategy: 'static-html-className',
  }
}

/**
 * VisBug resize/move иногда пишет transform: translate(x,y) вместо left/top.
 * @param {string} htmlPath
 * @param {string} applySelector
 * @param {string} value CSS transform, e.g. translate(-32px, 0px)
 */
export function tryApplyStaticHtmlTransform(htmlPath, applySelector, value) {
  const delta = parseTransformTranslate(value)
  if (!delta) return { ok: false, reason: 'bad-transform' }

  const x = roundPxForUtility(delta.x)
  const y = roundPxForUtility(delta.y)
  if (x === 0 && y === 0) return { ok: false, reason: 'zero-transform' }

  const html = readFileSync(htmlPath, 'utf8')
  const found = findStaticHtmlOpeningTag(html, applySelector)
  if (!found) return { ok: false, reason: 'tag-not-found' }

  const patched = patchOpeningTagClass(found.full, (className) => (
    mergeTranslateUtilities(className, {
      x: x === 0 ? null : x,
      y: y === 0 ? null : y,
    })
  ))
  if (!patched) return { ok: false, reason: 'class-unchanged' }

  const nextHtml = `${html.slice(0, found.index)}${patched}${html.slice(found.index + found.full.length)}`
  writeFileSync(htmlPath, nextHtml, 'utf8')

  return {
    ok: true,
    file: htmlPath,
    prop: 'transform',
    value: `translate(${x ?? 0}px, ${y ?? 0}px)`,
    strategy: 'static-html-className',
  }
}
