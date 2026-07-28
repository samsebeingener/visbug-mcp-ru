/**
 * move-target.js — универсальная маршрутизация Move (без id секций конкретного сайта).
 */

import {
  extractSectionKey,
  findMeaningfulClassInSelector,
  isTextMoveTag,
  parseSelectorLeaf,
  simplifySelectorForApply,
} from './parser.js'

/** Классы-обёртки для потокового текста (CMS, prose, rich text). */
const RICH_TEXT_CONTAINER_CLASS_RE =
  /^(?:[\w-]*rich[\w-]*text[\w-]*|prose(?:-[\w-]+)?|wysiwyg|entry-content|content-body|article-body|cms-content|formatted-body)$/i

export function isRichTextContainerClass(className) {
  return RICH_TEXT_CONTAINER_CLASS_RE.test(String(className ?? '').replace(/\\/g, ''))
}

/**
 * Ищет в длинном VisBug-селекторе класс текстового блока (не leaf p).
 */
export function findRichTextContainerClass(selector) {
  const fromMeaningful = findMeaningfulClassInSelector(selector, { richTextOnly: true })
  if (fromMeaningful) return fromMeaningful

  const classes = [...String(selector ?? '').matchAll(/\.((?:\\.|[a-zA-Z0-9_-])+)/g)]
    .map((m) => m[1].replace(/\\/g, ''))

  for (const cls of classes) {
    if (isRichTextContainerClass(cls)) return cls
  }
  return null
}

export function isPerParagraphTextSelector(selector, tag = '') {
  if (!isTextMoveTag(parseSelectorLeaf(selector, tag).tagName)) return false
  const s = String(selector ?? '')
  return />\s*p\b|(?:^|\s)p:nth-of-type|\sp:nth-of-type/i.test(s)
}

/**
 * Move на строке внутри rich-text/prose → один селектор контейнера.
 * @returns {string|null}
 */
export function resolveMoveContainerSelector(selector, tag = '') {
  const containerClass = findRichTextContainerClass(selector)
  if (!containerClass) return null
  if (!isTextMoveTag(parseSelectorLeaf(selector, tag).tagName)) return null

  const section = extractSectionKey(selector)
  const escaped = containerClass.replace(/([.*+?^${}()|[\]\\])/g, '\\$1')
  if (section) return `#${section} .${containerClass}`
  return `.${containerClass}`
}

/**
 * @param {object} change
 * @param {string|null} simplified
 */
export function shouldPromoteTextMoveToContainer(change, simplified) {
  if (!change || change.type !== 'style') return false
  if (change.property !== 'left' && change.property !== 'top') return false
  const raw = change.selector ?? ''
  const probe = simplified || raw
  return Boolean(resolveMoveContainerSelector(raw, change.tag))
    && isPerParagraphTextSelector(probe, change.tag)
}

/**
 * @param {object[]} pending
 * @param {string} applySelector
 * @param {string} workspace
 * @param {(change: object) => (string|null)} resolveApply
 */
export function collectRelatedMoveChanges(pending, applySelector, workspace, resolveApply) {
  const related = []
  for (const item of pending) {
    if (item.type !== 'style') continue
    if (item.property !== 'left' && item.property !== 'top') continue
    const resolved = resolveApply(item)
    if (resolved === applySelector) related.push(item)
  }
  return related
}

function parsePx(value) {
  const m = String(value ?? '').trim().match(/^(-?\d+(?:\.\d+)?)(px)?$/i)
  return m ? Number(m[1]) : NaN
}

/**
 * При нескольких drag одного блока — align.reference или наибольшая дельта.
 */
export function pickBestMoveChange(candidates) {
  if (!candidates?.length) return null
  const withAlign = candidates.find((c) => c.align?.reference?.rect)
  if (withAlign) return withAlign
  return candidates.reduce((best, c) => {
    const a = Math.abs(parsePx(c.newValue))
    const b = Math.abs(parsePx(best.newValue))
    return a >= b ? c : best
  })
}

/**
 * Snap к reference: сдвиг margin = refEdge − dragEdge (viewport px в момент записи).
 */
export function marginFromAlignReference(change, baseMargin = 0) {
  const align = change?.align
  const ref = align?.reference?.rect
  const drag = align?.dragRect
  if (!align || !ref || !drag) return null

  const base = Number.isFinite(baseMargin) ? baseMargin : 0

  if (align.axis === 'x') {
    const dragEdge = align.edge === 'right'
      ? drag.left + drag.width
      : align.edge === 'center'
        ? drag.left + drag.width / 2
        : drag.left
    const refEdge = align.reference.edge === 'right'
      ? ref.left + ref.width
      : align.reference.edge === 'center'
        ? ref.left + ref.width / 2
        : ref.left
    if (![dragEdge, refEdge].every(Number.isFinite)) return null
    return Math.round(base + (refEdge - dragEdge))
  }

  if (align.axis === 'y') {
    const dragEdge = align.edge === 'bottom'
      ? drag.top + drag.height
      : align.edge === 'center'
        ? drag.top + drag.height / 2
        : drag.top
    const refEdge = align.reference.edge === 'bottom'
      ? ref.top + ref.height
      : align.reference.edge === 'center'
        ? ref.top + ref.height / 2
        : ref.top
    if (![dragEdge, refEdge].every(Number.isFinite)) return null
    return Math.round(base + (refEdge - dragEdge))
  }

  return null
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Удаляет ошибочные per-paragraph margin после группового apply.
 */
export function stripPerParagraphMarginRules(css, containerSelector) {
  const containerClass = findRichTextContainerClass(containerSelector)
  if (!containerClass) return css

  const section = extractSectionKey(containerSelector)
  const prefix = section
    ? `#${escapeRe(section)}\\s+\\.${escapeRe(containerClass)}`
    : `\\.${escapeRe(containerClass)}`

  const blockRe = new RegExp(
    `${prefix}\\s+p(?:\\[[^\\]]+\\])?(?::nth-of-type\\(\\d+\\))?\\s*\\{[^}]*\\}`,
    'g',
  )
  return css.replace(blockRe, '')
}

/**
 * Полный resolve apply selector для Move (после simplify).
 */
export function resolveMoveApplySelector(change, workspace, resolveWithVisbug) {
  const raw = change.selector ?? ''
  const simplified = simplifySelectorForApply(raw, change.tag)
  let applySelector = simplified && shouldPromoteTextMoveToContainer(change, simplified)
    ? resolveMoveContainerSelector(raw, change.tag)
    : simplified

  if (!applySelector && isPerParagraphTextSelector(raw, change.tag)) {
    applySelector = resolveMoveContainerSelector(raw, change.tag)
  }

  if (!applySelector) applySelector = simplified
  if (!applySelector) return null

  if (typeof resolveWithVisbug === 'function') {
    applySelector = resolveWithVisbug(change, applySelector, workspace)
  }

  if (shouldPromoteTextMoveToContainer(change, applySelector)) {
    const container = resolveMoveContainerSelector(raw, change.tag)
    if (container) applySelector = container
  }

  return applySelector
}
