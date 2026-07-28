/**
 * visbug-src — parse data-visbug-src и маршрутизация auto-apply.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join, extname, normalize } from 'path'
import { extractSectionKey } from './parser.js'

const CODE_EXT = new Set(['.tsx', '.ts', '.jsx', '.js', '.astro', '.mdx'])
const CSS_EXT = new Set(['.css', '.scss'])

/**
 * @param {string} visbugSrc e.g. "src/components/sections/pricing.tsx:59:17"
 */
export function parseVisbugSrc(visbugSrc) {
  const raw = String(visbugSrc ?? '').trim()
  if (!raw) return null

  const match = raw.match(/^(.+?):(\d+):(\d+)$/)
  if (!match) return null

  const relativePath = match[1].replace(/\\/g, '/')
  const line = Number(match[2])
  const column = Number(match[3])
  if (!relativePath || !Number.isFinite(line) || line < 1) return null

  return { relativePath, line, column, raw }
}

/**
 * @param {string} workspace
 * @param {string|null|undefined} visbugSrc
 */
export function resolveSourceFilePath(workspace, visbugSrc) {
  const parsed = parseVisbugSrc(visbugSrc)
  if (!parsed || !workspace) return null

  const candidates = [
    join(workspace, parsed.relativePath),
    join(workspace, parsed.relativePath.replace(/^src\//, '')),
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) return normalize(candidate)
  }
  return null
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Тело CSS-правила сразу после комментария visbug-src.
 * @param {string} css
 * @param {string} visbugSrc
 */
export function findRuleBodyByVisbugSrc(css, visbugSrc) {
  const parsed = parseVisbugSrc(visbugSrc)
  if (!parsed) return null

  const patterns = [parsed.raw, parsed.relativePath]
  for (const needle of patterns) {
    const re = new RegExp(
      `/\\*\\s*visbug-src:\\s*${escapeRe(needle)}\\s*\\*/\\s*[^{]*\\{([^}]*)\\}`,
      'm',
    )
    const m = css.match(re)
    if (m) return m[1]
  }
  return null
}

/**
 * @param {string} css
 * @param {string} selector
 * @param {string} prop
 * @param {string|null|undefined} visbugSrc
 */
export function readRulePropFromCss(css, selector, prop, visbugSrc) {
  if (visbugSrc) {
    const body = findRuleBodyByVisbugSrc(css, visbugSrc)
    if (body) {
      const propRe = new RegExp(`${escapeRe(prop)}\\s*:\\s*([^;]+)`, 'i')
      const pm = body.match(propRe)
      if (pm) {
        const m = String(pm[1]).trim().match(/^(-?\d+(?:\.\d+)?)(px)?$/i)
        if (m) return Number(m[1])
      }
    }
  }

  const sel = selector.replace(/\s+/g, ' ').trim()
  const blockRe = new RegExp(`(${escapeRe(sel)}\\s*\\{)([^}]*)(\\})`, 'm')
  const m = css.match(blockRe)
  if (!m) return null
  const propRe = new RegExp(`${escapeRe(prop)}\\s*:\\s*([^;]+)`, 'i')
  const pm = m[2].match(propRe)
  if (!pm) return null
  const px = String(pm[1]).trim().match(/^(-?\d+(?:\.\d+)?)(px)?$/i)
  return px ? Number(px[1]) : null
}

/**
 * Уточняет селектор по строке исходника (BuilderRichText → блок, не каждый p).
 */
export function resolveApplySelectorWithVisbug(change, applySelector, workspace) {
  const visbugSrc = change?.visbugSrc
  const parsed = parseVisbugSrc(visbugSrc)
  if (!parsed || !workspace) return applySelector

  const filePath = resolveSourceFilePath(workspace, visbugSrc)
  if (!filePath) return applySelector

  let line = ''
  try {
    const lines = readFileSync(filePath, 'utf8').split(/\r?\n/)
    line = lines[parsed.line - 1] ?? ''
  } catch {
    return applySelector
  }

  const isRichTextHost = /BuilderRichText|builder-rich-text/i.test(line)
  const isPerParagraph = /p:nth-of-type|> p\b/i.test(applySelector)

  if (isRichTextHost && isPerParagraph && /builder-rich-text/i.test(applySelector)) {
    const section = extractSectionKey(applySelector)
    return section ? `#${section} .builder-rich-text` : '.builder-rich-text'
  }

  return applySelector
}

/**
 * @param {string} workspace
 * @param {string} selector
 * @param {string} layout
 * @param {{ visbugSrc?: string|null }} [options]
 */
export function pickCssTargetForVisbug(workspace, selector, layout, options = {}) {
  const { visbugSrc } = options
  const parsed = parseVisbugSrc(visbugSrc)

  if (parsed && workspace) {
    const sourcePath = resolveSourceFilePath(workspace, visbugSrc)
    if (sourcePath && CSS_EXT.has(extname(sourcePath))) {
      return { type: 'file', path: sourcePath, visbugSrc: parsed.raw }
    }

    const cssFiles = walkCssFiles(workspace)
    for (const file of cssFiles) {
      const css = readFileSync(file, 'utf8')
      if (css.includes(`/* visbug-src: ${parsed.raw} */`)
        || css.includes(`/* visbug-src: ${parsed.relativePath} */`)) {
        return { type: 'file', path: file, visbugSrc: parsed.raw }
      }
    }

    if (sourcePath && CODE_EXT.has(extname(sourcePath))) {
      const componentBase = parsed.relativePath.split('/').pop() ?? ''
      for (const file of cssFiles) {
        const css = readFileSync(file, 'utf8')
        if (componentBase && css.includes(componentBase)) {
          return { type: 'file', path: file, visbugSrc: parsed.raw }
        }
      }
    }
  }

  return null
}

function walkCssFiles(dir, out = [], depth = 0) {
  if (depth > 8 || !existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = join(dir, name)
    let st
    try { st = statSync(full) } catch { continue }
    if (st.isDirectory()) walkCssFiles(full, out, depth + 1)
    else if (CSS_EXT.has(extname(name))) out.push(full)
  }
  return out
}
