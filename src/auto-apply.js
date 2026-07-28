/**
 * Прямое применение правок VisBug в файлы workspace — без Cursor CLI и без команд в чате.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join, extname } from 'path'
import {
  getApplyHints,
  isVisbugArtifactProperty,
  isDecorativeStyleChange,
  parseGapPxFromSelector,
  isGridColumnLeaf,
  isTextMoveTag,
  parseSelectorLeaf,
  AUTO_APPLY_SAFE_PROPERTIES,
  AUTO_APPLY_BLOCKED_SELECTOR_RE,
  simplifySelectorForApply,
  extractSectionKey,
} from './parser.js'
import { getStoreDir } from './config.js'
import {
  parseVisbugSrc,
  resolveSourceFilePath,
  readRulePropFromCss,
  resolveApplySelectorWithVisbug,
  pickCssTargetForVisbug,
} from './visbug-src.js'

const CSS_EXT = new Set(['.css', '.scss'])

function log(line) {
  const dir = getStoreDir()
  const path = join(dir, 'auto-apply.log')
  const stamp = new Date().toISOString()
  try {
    writeFileSync(path, `[${stamp}] ${line}\n`, { flag: 'a' })
  } catch {}
  process.stderr.write(`[auto-apply] ${line}\n`)
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

function hasFrameworkSource(dir, depth = 0) {
  if (depth > 3 || !existsSync(dir)) return false
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const path = join(dir, name)
    let stat
    try { stat = statSync(path) } catch { continue }
    if (stat.isDirectory() && hasFrameworkSource(path, depth + 1)) return true
    if (stat.isFile() && new Set(['.tsx', '.ts', '.jsx', '.js', '.astro', '.mdx']).has(extname(name))) {
      return true
    }
  }
  return false
}

export function detectWorkspaceLayout(workspace) {
  if (hasFrameworkSource(join(workspace, 'src'))) return 'framework-src'
  if (hasFrameworkSource(join(workspace, 'app')) || hasFrameworkSource(join(workspace, 'pages'))) {
    return 'framework-src'
  }
  if (existsSync(join(workspace, 'index.html'))) return 'static-html'
  return 'unknown'
}

function normalizeSelector(selector) {
  return selector
    .replace(/\s+/g, ' ')
    .replace(/section#([a-zA-Z][\w-]*)/g, '#$1')
    .trim()
}

function mapProperty(change) {
  const prop = change.property
  if (!prop) return null
  if (prop.startsWith('--')) return null
  if (isVisbugArtifactProperty(prop)) return null
  // left/top обрабатываются отдельно → transform: translate(...)
  if (prop === 'left' || prop === 'top') return null
  if (AUTO_APPLY_SAFE_PROPERTIES.has(prop)) return prop
  return null
}

function formatLength(value) {
  const v = String(value ?? '').trim()
  if (!v) return '0px'
  if (/^-?\d+(\.\d+)?$/.test(v)) return `${v}px`
  return v
}

function parsePx(value) {
  const m = String(value ?? '').trim().match(/^(-?\d+(?:\.\d+)?)(px)?$/i)
  return m ? Number(m[1]) : NaN
}

function buildTranslateValue(leftChange, topChange) {
  const x = leftChange ? formatLength(leftChange.newValue) : '0px'
  const y = topChange ? formatLength(topChange.newValue) : '0px'
  if (x === '0px' && y === '0px') return null
  return `translate(${x}, ${y})`
}

/** Типичные Tailwind gap-* в px — только для grid-колонок и только если X ≈ gap из селектора. */
function shouldDropGutterX(selector, tag, x) {
  if (!Number.isFinite(x) || x === 0) return false
  if (!isGridColumnLeaf(selector, tag)) return false
  const gaps = parseGapPxFromSelector(selector)
  if (!gaps.length) return false
  const absX = Math.abs(x)
  return gaps.some((g) => Math.abs(absX - g) <= 6)
}

/**
 * Move по grid-ячейке: left ≈ −gap «склеивает» колонки; top при items-center
 * обычно значит «выровнять по низу» → items-end, без transform.
 * @returns {{ kind: 'items-end'|'transform'|'noop', value?: string|null, reason?: string }}
 */
export function planGridAwareMove(selector, leftChange, topChange, tag = '') {
  const raw = String(selector ?? '')
  const x = leftChange ? parsePx(leftChange.newValue) : 0
  const y = topChange ? parsePx(topChange.newValue) : 0
  const inGrid = /\.grid\b|grid-cols-|col-span-|lg\\:col-span-/i.test(raw)
  const hasItemsCenter = /\bitems-center\b/.test(raw)

  if (!inGrid) {
    return { kind: 'transform', value: buildTranslateValue(leftChange, topChange) }
  }

  const dropX = shouldDropGutterX(raw, tag, x)
  const wantsBottomAlign = hasItemsCenter && Number.isFinite(y) && Math.abs(y) >= 24

  if (wantsBottomAlign) {
    return {
      kind: 'items-end',
      value: null,
      reason: 'grid bottom-align → items-end (не трогаем gap)',
    }
  }

  if (dropX) {
    const yOnly = topChange && Number.isFinite(y) && Math.abs(y) >= 1
      ? topChange
      : null
    const value = buildTranslateValue(null, yOnly)
    if (!value) {
      return { kind: 'noop', reason: 'отброшен translateX ≈ gap (сохраняем gutter)' }
    }
    return {
      kind: 'transform',
      value,
      reason: 'отброшен translateX ≈ gap (сохраняем gutter)',
    }
  }

  return { kind: 'transform', value: buildTranslateValue(leftChange, topChange) }
}

/**
 * Куда писать Move: transform или margin-* (Next.js builder-rich-text).
 */
export function planMoveApply(selector, tag, leftChange, topChange) {
  const plan = planGridAwareMove(selector, leftChange, topChange, tag)
  if (plan.kind === 'items-end' || plan.kind === 'noop') return plan

  const { tagName } = parseSelectorLeaf(selector, tag)
  const x = leftChange ? parsePx(leftChange.newValue) : NaN
  const y = topChange ? parsePx(topChange.newValue) : NaN
  const xOnly = Boolean(leftChange) && (!topChange || !Number.isFinite(y) || Math.abs(y) < 1)
  const yOnly = Boolean(topChange) && (!leftChange || !Number.isFinite(x) || Math.abs(x) < 1)

  if (/builder-rich-text/i.test(selector) && isTextMoveTag(tagName)) {
    if (xOnly) {
      return {
        kind: 'css-prop',
        prop: 'margin-inline-start',
        value: formatLength(leftChange.newValue),
      }
    }
    if (yOnly) {
      return {
        kind: 'css-prop',
        prop: 'margin-top',
        value: formatLength(topChange.newValue),
      }
    }
  }

  if (!plan.value) return { kind: 'noop', reason: 'пустой Move' }
  return { kind: 'css-prop', prop: 'transform', value: plan.value, reason: plan.reason }
}

function removeStyleDecl(target, selector, prop) {
  if (target.type === 'file') {
    const css = readFileSync(target.path, 'utf8')
    const next = stripRuleProp(css, selector, prop)
    if (next === css) return false
    writeFileSync(target.path, next, 'utf8')
    return true
  }
  return stripStyleFromInlineHtml(target.path, selector, prop)
}

function stripRuleProp(css, selector, prop) {
  const sel = normalizeSelector(selector)
  const blockRe = new RegExp(`(${escapeRe(sel)}\\s*\\{)([^}]*)(\\})`, 'm')
  const m = css.match(blockRe)
  if (!m) return css
  const propRe = new RegExp(`\\s*${escapeRe(prop)}\\s*:[^;]+;?`)
  if (!propRe.test(m[2])) return css
  const body = m[2].replace(propRe, '\n')
  if (!body.replace(/\s/g, '')) {
    return css.replace(blockRe, '')
  }
  return css.replace(blockRe, `${m[1]}${body}${m[3]}`)
}

function stripStyleFromInlineHtml(htmlPath, selector, prop) {
  const html = readFileSync(htmlPath, 'utf8')
  const styleRe = /<style\b[^>]*>([\s\S]*?)<\/style>/gi
  const blocks = []
  let match
  while ((match = styleRe.exec(html))) {
    blocks.push({
      css: match[1],
      cssStart: match.index + match[0].indexOf(match[1]),
      cssEnd: match.index + match[0].indexOf(match[1]) + match[1].length,
    })
  }
  if (!blocks.length) return false
  const normalized = normalizeSelector(selector)
  const block = blocks.find(({ css }) => css.includes(normalized))
    ?? blocks.find(({ css }) => css.includes('/* VisBug layout'))
    ?? blocks[0]
  const nextCss = stripRuleProp(block.css, selector, prop)
  if (nextCss === block.css) return false
  writeFileSync(
    htmlPath,
    `${html.slice(0, block.cssStart)}${nextCss}${html.slice(block.cssEnd)}`,
    'utf8',
  )
  return true
}

/**
 * В секции (или во всём HTML) заменить items-center → items-end на grid.
 */
function rewriteGridItemsCenterToEnd(workspace, selector) {
  const htmlPath = join(workspace, 'index.html')
  if (!existsSync(htmlPath)) return null
  let html = readFileSync(htmlPath, 'utf8')
  const section = extractSectionKey(selector)

  const swap = (chunk) => chunk.replace(
    /(class=["'][^"']*\bgrid\b[^"']*)\bitems-center\b([^"']*["'])/,
    '$1items-end$2',
  )

  let next = html
  if (section) {
    const sectionRe = new RegExp(
      `(<section\\b[^>]*\\bid=["']${escapeRe(section)}["'][^>]*>)([\\s\\S]*?)(</section>)`,
      'i',
    )
    const m = html.match(sectionRe)
    if (m) {
      const inner = swap(m[2])
      if (inner === m[2]) return null
      next = html.replace(sectionRe, `${m[1]}${inner}${m[3]}`)
    } else {
      next = swap(html)
    }
  } else {
    next = swap(html)
  }

  if (next === html) return null
  writeFileSync(htmlPath, next, 'utf8')
  return htmlPath
}

function writeStyleDecl(target, selector, prop, value) {
  const visbugSrc = target.visbugSrc ?? null
  if (target.type === 'file') {
    const css = readFileSync(target.path, 'utf8')
    const next = upsertRule(css, selector, prop, value, { visbugSrc })
    if (next === css) return false
    writeFileSync(target.path, next, 'utf8')
    return true
  }
  return applyStyleToInlineHtml(target.path, selector, prop, value)
}


function isAutoApplySelector(selector) {
  if (!selector) return false
  if (AUTO_APPLY_BLOCKED_SELECTOR_RE.test(selector)) return false
  return selector.length <= 240
}

function resolveApplySelector(change) {
  const raw = change.selector ?? ''
  // Сначала короткий безопасный селектор — иначе длинный путь VisBug
  // с несколькими `p` превращается в `.hero-section p` и красит всё подряд.
  const simplified = simplifySelectorForApply(raw, change.tag)
  if (simplified && isAutoApplySelector(simplified)) return simplified
  if (isAutoApplySelector(raw)) return raw
  return null
}

function formatCssValue(prop, value) {
  const v = String(value ?? '').trim()
  if (!v) return v
  if (/^-?\d+(\.\d+)?$/.test(v) && !prop.includes('opacity') && prop !== 'z-index') {
    return `${v}px`
  }
  return v
}

/** Читает числовое значение px из существующего CSS-правила (для накопления margin). */
export function readRulePropPx(css, selector, prop, visbugSrc) {
  return readRulePropFromCss(css, selector, prop, visbugSrc)
}

/**
 * VisBug left/top — дельта от текущей вёрстки; margin в файле нужно накапливать, не затирать.
 */
export function resolveMoveCssValue(target, applySelector, plan, leftChange, topChange) {
  if (plan.kind !== 'css-prop' || !plan.value || target.type !== 'file') return plan

  const css = readFileSync(target.path, 'utf8')
  const visbugSrc = target.visbugSrc ?? null

  if (plan.prop === 'margin-inline-start' && leftChange) {
    const existing = readRulePropPx(css, applySelector, 'margin-inline-start', visbugSrc)
    const delta = parsePx(leftChange.newValue)
    if (Number.isFinite(delta)) {
      const base = Number.isFinite(existing) ? existing : 0
      return {
        ...plan,
        value: formatLength(base + delta),
        reason: `${plan.reason ? `${plan.reason}; ` : ''}margin-inline-start ${base}px + ${delta}px`,
      }
    }
  }

  if (plan.prop === 'margin-top' && topChange) {
    const existing = readRulePropPx(css, applySelector, 'margin-top', visbugSrc)
    const delta = parsePx(topChange.newValue)
    if (Number.isFinite(delta)) {
      const base = Number.isFinite(existing) ? existing : 0
      return {
        ...plan,
        value: formatLength(base + delta),
        reason: `${plan.reason ? `${plan.reason}; ` : ''}margin-top ${base}px + ${delta}px`,
      }
    }
  }

  return plan
}

function upsertRule(css, selector, prop, value, { visbugSrc } = {}) {
  const sel = normalizeSelector(selector)
  const decl = `  ${prop}: ${value};`
  const parsed = parseVisbugSrc(visbugSrc)

  if (parsed) {
    for (const needle of [parsed.raw, parsed.relativePath]) {
      const commentRe = new RegExp(
        `(/\\*\\s*visbug-src:\\s*${escapeRe(needle)}\\s*\\*/\\s*)([^{]*)(\\{)([^}]*)(\\})`,
        'm',
      )
      const cm = css.match(commentRe)
      if (cm) {
        let body = cm[4]
        const propRe = new RegExp(`\\s*${escapeRe(prop)}\\s*:[^;]+;?`)
        if (propRe.test(body)) {
          body = body.replace(propRe, `\n${decl}`)
        } else {
          body = `${body.trimEnd()}\n${decl}\n`
        }
        return css.replace(commentRe, `${cm[1]}${sel} ${cm[3]}${body}${cm[5]}`)
      }
    }
  }

  const blockRe = new RegExp(
    `(${escapeRe(sel)}\\s*\\{)([^}]*)(\\})`,
    'm',
  )
  const m = css.match(blockRe)
  if (m) {
    let body = m[2]
    const propRe = new RegExp(`\\s*${escapeRe(prop)}\\s*:[^;]+;?`)
    if (propRe.test(body)) {
      body = body.replace(propRe, `\n${decl}`)
    } else {
      body = `${body.trimEnd()}\n${decl}\n`
    }
    return css.replace(blockRe, `${m[1]}${body}${m[3]}`)
  }

  const marker = '/* VisBug layout'
  const header = visbugSrc ? `/* visbug-src: ${visbugSrc} */\n` : ''
  const insert = `\n${header}${sel} {\n${decl}\n}\n`
  const idx = css.indexOf(marker)
  if (idx !== -1) {
    return css.slice(0, idx) + insert + css.slice(idx)
  }
  return css.trimEnd() + `\n\n/* VisBug layout — auto-apply */\n${insert}`
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function pickCssTarget(workspace, selector, layout, visbugSrc) {
  const fromSrc = pickCssTargetForVisbug(workspace, selector, layout, { visbugSrc })
  if (fromSrc) return fromSrc

  const cssRoot = workspace
  const files = walkCssFiles(cssRoot)
  const prefer = files.filter((f) => /sections\.css$/i.test(f))
  const pool = prefer.length ? prefer : files
  const sel = normalizeSelector(selector)
  const section = extractSectionKey(sel)

  if (section) {
    for (const file of pool) {
      const css = readFileSync(file, 'utf8')
      if (css.includes(`#${section}`)) return { type: 'file', path: file }
    }
  }

  for (const file of pool) {
    const css = readFileSync(file, 'utf8')
    if (css.includes(sel.split(' ')[0])) return { type: 'file', path: file }
  }
  if (pool[0]) return { type: 'file', path: pool[0] }
  if (layout === 'static-html') return { type: 'inline-style', path: join(workspace, 'index.html') }
  return null
}

function applyStyleToInlineHtml(htmlPath, selector, prop, value) {
  const html = readFileSync(htmlPath, 'utf8')
  const styleRe = /<style\b[^>]*>([\s\S]*?)<\/style>/gi
  const blocks = []
  let match

  while ((match = styleRe.exec(html))) {
    blocks.push({
      css: match[1],
      cssStart: match.index + match[0].indexOf(match[1]),
      cssEnd: match.index + match[0].indexOf(match[1]) + match[1].length,
    })
  }

  if (blocks.length === 0) return false

  const normalized = normalizeSelector(selector)
  const section = extractSectionKey(normalized)
  const block = blocks.find(({ css }) => css.includes(normalized))
    ?? (section ? blocks.find(({ css }) => css.includes(`#${section}`)) : null)
    ?? blocks.find(({ css }) => css.includes('/* VisBug layout'))
    ?? blocks.reduce((largest, candidate) => (
      candidate.css.length > largest.css.length ? candidate : largest
    ))
  const nextCss = upsertRule(block.css, selector, prop, value)
  if (nextCss === block.css) return false

  writeFileSync(
    htmlPath,
    `${html.slice(0, block.cssStart)}${nextCss}${html.slice(block.cssEnd)}`,
    'utf8',
  )
  return true
}

function replaceTextInStaticHtml(workspace, oldT, newT) {
  const path = join(workspace, 'index.html')
  if (!existsSync(path)) return null

  const html = readFileSync(path, 'utf8')
  const visibleHtml = html.replace(
    /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,
    (block) => ' '.repeat(block.length),
  )
  const firstIndex = visibleHtml.indexOf(oldT)
  if (firstIndex === -1 || visibleHtml.indexOf(oldT, firstIndex + oldT.length) !== -1) {
    log(`text skip ambiguous or missing in ${path}`)
    return null
  }

  writeFileSync(path, `${html.slice(0, firstIndex)}${newT}${html.slice(firstIndex + oldT.length)}`, 'utf8')
  return path
}

function replaceTextInWorkspace(workspace, change, layout) {
  const oldT = String(change.oldValue ?? '').trim()
  const newT = String(change.newValue ?? '').trim()
  if (!oldT || oldT === newT) return null
  if (layout === 'static-html') return replaceTextInStaticHtml(workspace, oldT, newT)

  const srcFile = resolveSourceFilePath(workspace, change.visbugSrc)
  if (srcFile && existsSync(srcFile)) {
    const src = readFileSync(srcFile, 'utf8')
    const count = src.split(oldT).length - 1
    if (count === 1) {
      writeFileSync(srcFile, src.replace(oldT, newT), 'utf8')
      return srcFile
    }
    if (count > 1) {
      log(`text skip ambiguous in visbug-src ${srcFile}`)
    }
  }

  const dirs = [join(workspace, 'src'), join(workspace, 'app'), join(workspace, 'pages')]
  const exts = new Set(['.tsx', '.ts', '.jsx', '.js', '.astro', '.html', '.mdx'])
  const stack = [...dirs]

  while (stack.length) {
    const dir = stack.pop()
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules') continue
      const full = join(dir, name)
      let st
      try { st = statSync(full) } catch { continue }
      if (st.isDirectory()) stack.push(full)
      else if (exts.has(extname(name))) {
        const src = readFileSync(full, 'utf8')
        if (src.includes(oldT)) {
          writeFileSync(full, src.replace(oldT, newT), 'utf8')
          return full
        }
      }
    }
  }
  return null
}

function shortPath(filePath) {
  if (!filePath) return ''
  const parts = String(filePath).replace(/\\/g, '/').split('/')
  return parts.slice(-2).join('/')
}

function formatApplySummary({ applied, artifacts, writes, failed, files }) {
  const lines = []
  if (writes.length) {
    lines.push(`✅ В файлы: ${writes.length}`)
    for (const w of writes.slice(0, 5)) {
      lines.push(`  • ${w.selector} → ${w.prop}: ${w.value}`)
    }
    if (writes.length > 5) lines.push(`  • …ещё ${writes.length - 5}`)
    if (files.length) lines.push(`  📄 ${files.map(shortPath).join(', ')}`)
  } else {
    lines.push('⚠️ В файлы ничего не записано')
  }
  if (artifacts > 0) {
    lines.push(`🛈 Пропущен шум VisBug / glow: ${artifacts}`)
  }
  if (failed.length) {
    lines.push(`❌ Не удалось: ${failed.length}`)
    for (const f of failed.slice(0, 4)) {
      lines.push(`  • ${f.reason}${f.selector ? ` (${String(f.selector).slice(0, 48)})` : ''}`)
    }
  }
  if (applied > 0 && failed.length === 0) {
    lines.push('Можно не перепроверять вручную — правки уже в исходниках. Обнови страницу (Ctrl+F5).')
  }
  return lines.join('\n')
}

/**
 * @param {string} workspace
 * @param {object[]} changes
 */
export function autoApplyWorkspace(workspace, changes) {
  if (!workspace || !existsSync(workspace)) {
    return {
      applied: 0,
      skipped: 0,
      artifacts: 0,
      files: [],
      writes: [],
      failed: [{ reason: 'workspace missing' }],
      summary: '❌ Workspace не найден — правки не записаны',
      reason: 'workspace missing',
    }
  }

  const pending = changes.filter((c) => !c.applied)
  const layout = detectWorkspaceLayout(workspace)
  let applied = 0
  let skipped = 0
  let artifacts = 0
  const files = new Set()
  const writes = []
  const failed = []

  const dragHandled = new Set()

  for (const change of pending) {
    if (change.type === 'text') {
      const file = replaceTextInWorkspace(workspace, change, layout)
      if (file) {
        change.applied = true
        applied++
        files.add(file)
        writes.push({
          type: 'text',
          selector: simplifySelectorForApply(change.selector, change.tag) || change.selector,
          prop: 'text',
          value: String(change.newValue ?? '').slice(0, 40),
          file,
        })
        log(`text OK ${file}`)
      } else {
        skipped++
        failed.push({ reason: 'текст не найден/неоднозначен', selector: change.selector })
        log(`text skip ${change.selector}`)
      }
      continue
    }

    if (change.type !== 'style' || !change.property) {
      skipped++
      failed.push({ reason: `тип ${change.type} не auto-apply`, selector: change.selector })
      continue
    }

    if (isDecorativeStyleChange(change)) {
      change.applied = true
      artifacts++
      continue
    }

    const hints = getApplyHints(change)
    if (hints.some((h) => h.includes('не применять'))) {
      change.applied = true
      artifacts++
      continue
    }

    if (change.property === 'left' || change.property === 'top') {
      const key = change.selector
      if (dragHandled.has(key)) {
        change.applied = true
        continue
      }
      dragHandled.add(key)

      let applySelector = resolveApplySelector(change)
      if (!applySelector) {
        skipped++
        failed.push({ reason: 'селектор слишком общий/небезопасный', selector: change.selector })
        log(`style skip selector ${change.selector?.slice(0, 60)}…`)
        continue
      }
      applySelector = resolveApplySelectorWithVisbug(change, applySelector, workspace)

      const leftChange = pending.find((c) => c.selector === key && c.property === 'left')
      const topChange = pending.find((c) => c.selector === key && c.property === 'top')
      const visbugSrc = change.visbugSrc ?? null
      const target = pickCssTarget(workspace, applySelector, layout, visbugSrc)
      if (!target) {
        skipped++
        failed.push({ reason: 'нет CSS/HTML цели', selector: applySelector })
        continue
      }
      if (visbugSrc && !target.visbugSrc) target.visbugSrc = visbugSrc

      const plan = resolveMoveCssValue(
        target,
        applySelector,
        planMoveApply(change.selector, change.tag, leftChange, topChange),
        leftChange,
        topChange,
      )

      if (plan.kind === 'items-end') {
        const file = rewriteGridItemsCenterToEnd(workspace, change.selector)
        if (file) {
          removeStyleDecl(target, applySelector, 'transform')
          if (leftChange) leftChange.applied = true
          if (topChange) topChange.applied = true
          applied += (leftChange ? 1 : 0) + (topChange ? 1 : 0)
          files.add(file)
          writes.push({
            type: 'style',
            selector: applySelector,
            prop: 'align-items',
            value: 'end (items-end, gap сохранён)',
            file,
          })
          log(`style OK items-end (${plan.reason}) → ${file}`)
        } else {
          // fallback: только Y, без gutter-X
          const yOnly = buildTranslateValue(null, topChange)
          if (yOnly && writeStyleDecl(target, applySelector, 'transform', yOnly)) {
            if (leftChange) leftChange.applied = true
            if (topChange) topChange.applied = true
            applied += (leftChange ? 1 : 0) + (topChange ? 1 : 0)
            files.add(target.path)
            writes.push({
              type: 'style',
              selector: applySelector,
              prop: 'transform',
              value: yOnly,
              file: target.path,
            })
            log(`style OK transform=${yOnly} (items-end fallback, X dropped) → ${target.path}`)
          } else {
            skipped++
            failed.push({ reason: 'не удалось items-end / transform', selector: applySelector })
          }
        }
        continue
      }

      if (plan.kind === 'noop' || (plan.kind === 'css-prop' && !plan.value)) {
        if (leftChange) leftChange.applied = true
        if (topChange) topChange.applied = true
        artifacts++
        log(`style skip transform (${plan.reason || 'noop'})`)
        continue
      }

      if (plan.kind !== 'css-prop') {
        skipped++
        failed.push({ reason: 'неизвестный план Move', selector: applySelector })
        continue
      }

      const wrote = writeStyleDecl(target, applySelector, plan.prop, plan.value)
      if (wrote) {
        if (leftChange) leftChange.applied = true
        if (topChange) topChange.applied = true
        applied += (leftChange ? 1 : 0) + (topChange ? 1 : 0)
        files.add(target.path)
        writes.push({
          type: 'style',
          selector: applySelector,
          prop: plan.prop,
          value: plan.value,
          file: target.path,
        })
        const note = applySelector !== change.selector ? ` (${applySelector})` : ''
        const why = plan.reason ? ` [${plan.reason}]` : ''
        log(`style OK ${plan.prop}=${plan.value}${note}${why} → ${target.path}`)
      } else {
        skipped++
        failed.push({ reason: `не удалось записать ${plan.prop}`, selector: applySelector })
      }
      continue
    }

    // Раньше width/height в пачке с Move отбрасывались как «хром ручек» —
    // это ломало осознанный resize. Пишем size всегда, если он в буфере.
    // (cursor/transition по-прежнему артефакты VisBug — см. getApplyHints)

    const prop = mapProperty(change)
    if (!prop) {
      if (String(change.property ?? '').startsWith('--')) {
        change.applied = true
        artifacts++
        continue
      }
      skipped++
      failed.push({ reason: `свойство ${change.property} не в safe-list`, selector: change.selector })
      continue
    }

    let applySelector = resolveApplySelector(change)
    if (!applySelector) {
      skipped++
      failed.push({ reason: 'селектор слишком общий/небезопасный', selector: change.selector })
      log(`style skip selector ${change.selector?.slice(0, 60)}…`)
      continue
    }
    applySelector = resolveApplySelectorWithVisbug(change, applySelector, workspace)

    const visbugSrc = change.visbugSrc ?? null
    const target = pickCssTarget(workspace, applySelector, layout, visbugSrc)
    if (!target) {
      skipped++
      failed.push({ reason: 'нет CSS/HTML цели', selector: applySelector })
      continue
    }
    if (visbugSrc && !target.visbugSrc) target.visbugSrc = visbugSrc

    const value = formatCssValue(prop, change.newValue)
    const wrote = writeStyleDecl(target, applySelector, prop, value)

    if (wrote) {
      change.applied = true
      applied++
      files.add(target.path)
      writes.push({
        type: 'style',
        selector: applySelector,
        prop,
        value,
        file: target.path,
      })
      const note = applySelector !== change.selector ? ` (${applySelector})` : ''
      log(`style OK ${prop}=${value}${note} → ${target.path}`)
    } else {
      skipped++
      failed.push({ reason: `не записалось ${prop}`, selector: applySelector })
    }
  }

  const fileList = [...files]
  const summary = formatApplySummary({
    applied,
    artifacts,
    writes,
    failed,
    files: fileList,
  })

  return {
    applied,
    skipped,
    artifacts,
    files: fileList,
    writes,
    failed,
    summary,
  }
}
