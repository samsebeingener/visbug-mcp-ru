/**
 * Прямое применение правок VisBug в файлы workspace — без Cursor CLI и без команд в чате.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join, extname } from 'path'
import {
  getApplyHints,
  isVisbugArtifactProperty,
  isGridLayoutContext,
} from './parser.js'
import { getStoreDir } from './config.js'

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

function normalizeSelector(selector) {
  return selector
    .replace(/\s+/g, ' ')
    .replace(/section#([a-zA-Z][\w-]*)/g, '#$1')
    .trim()
}

function mapProperty(change) {
  const prop = change.property
  if (!prop) return null
  if (isVisbugArtifactProperty(prop)) return null

  if ((prop === 'left' || prop === 'top') && isGridLayoutContext(change.selector ?? '')) {
    return prop === 'left' ? 'margin-inline-start' : 'margin-top'
  }
  return prop
}

function formatCssValue(prop, value) {
  const v = String(value ?? '').trim()
  if (!v) return v
  if (/^-?\d+(\.\d+)?$/.test(v) && !prop.includes('opacity') && prop !== 'z-index') {
    return `${v}px`
  }
  return v
}

function upsertRule(css, selector, prop, value) {
  const sel = normalizeSelector(selector)
  const decl = `  ${prop}: ${value};`
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
  const insert = `\n${sel} {\n${decl}\n}\n`
  const idx = css.indexOf(marker)
  if (idx !== -1) {
    return css.slice(0, idx) + insert + css.slice(idx)
  }
  return css.trimEnd() + `\n\n/* VisBug layout — auto-apply */\n${insert}`
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function pickCssFile(workspace, selector) {
  const files = walkCssFiles(join(workspace, 'src'))
  const prefer = files.filter((f) => /sections\.css$/i.test(f))
  const pool = prefer.length ? prefer : files
  const sel = normalizeSelector(selector)

  for (const file of pool) {
    const css = readFileSync(file, 'utf8')
    if (css.includes(sel.split(' ')[0])) return file
  }
  return pool[0] || null
}

function replaceTextInWorkspace(workspace, change) {
  const oldT = String(change.oldValue ?? '').trim()
  const newT = String(change.newValue ?? '').trim()
  if (!oldT || oldT === newT) return null

  const dirs = [join(workspace, 'src')]
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

/**
 * @param {string} workspace
 * @param {object[]} changes
 */
export function autoApplyWorkspace(workspace, changes) {
  if (!workspace || !existsSync(workspace)) {
    return { applied: 0, skipped: 0, files: [], reason: 'workspace missing' }
  }

  const pending = changes.filter((c) => !c.applied)
  let applied = 0
  let skipped = 0
  const files = new Set()

  for (const change of pending) {
    if (change.type === 'text') {
      const file = replaceTextInWorkspace(workspace, change)
      if (file) {
        change.applied = true
        applied++
        files.add(file)
        log(`text OK ${file}`)
      } else {
        skipped++
        log(`text skip ${change.selector}`)
      }
      continue
    }

    if (change.type !== 'style' || !change.property) {
      skipped++
      continue
    }

    const hints = getApplyHints(change)
    if (hints.some((h) => h.includes('не применять'))) {
      skipped++
      continue
    }

    const prop = mapProperty(change)
    if (!prop) {
      skipped++
      continue
    }

    const file = pickCssFile(workspace, change.selector ?? '')
    if (!file) {
      skipped++
      continue
    }

    const value = formatCssValue(prop, change.newValue)
    const css = readFileSync(file, 'utf8')
    const next = upsertRule(css, change.selector, prop, value)
    if (next !== css) {
      writeFileSync(file, next, 'utf8')
      change.applied = true
      applied++
      files.add(file)
      log(`style OK ${prop}=${value} → ${file}`)
    } else {
      skipped++
    }
  }

  return { applied, skipped, files: [...files] }
}
