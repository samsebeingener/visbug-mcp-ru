#!/usr/bin/env node
/**
 * Держит extension/manifest.json.version в sync с package.json
 * и копирует shared/layout-lever.js → extension/ без ESM `export`
 * (Chrome content scripts = classic scripts).
 */

import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkgPath = join(ROOT, 'package.json')
const manifestPath = join(ROOT, 'extension', 'manifest.json')
const layoutLeverSrc = join(ROOT, 'shared', 'layout-lever.js')
const layoutLeverDest = join(ROOT, 'extension', 'layout-lever.js')

const checkOnly = process.argv.includes('--check')

function toContentScriptSource(src) {
  const body = src
    .replace(/^export const /gm, 'const ')
    .replace(/^export function /gm, 'function ')
    .replace(/^export \{[^}]+\}\s*;?\s*$/gm, '')
  const banner =
    '/* AUTO-GENERATED from shared/layout-lever.js — do not edit; run npm run sync:extension */\n'
  if (body.startsWith('/* AUTO-GENERATED')) return body
  return banner + body
}

function syncLayoutLever() {
  const src = readFileSync(layoutLeverSrc, 'utf8')
  const expected = toContentScriptSource(src)
  let dest = ''
  try {
    dest = readFileSync(layoutLeverDest, 'utf8')
  } catch {}
  if (dest !== expected) {
    if (checkOnly) {
      process.stderr.write(
        '❌ extension/layout-lever.js не синхронизирован с shared/layout-lever.js (classic)\n',
      )
      process.exit(1)
    }
    writeFileSync(layoutLeverDest, expected, 'utf8')
    process.stdout.write('✅ extension/layout-lever.js ← shared/layout-lever.js (без export)\n')
  }
}

syncLayoutLever()

const pkgVersion = JSON.parse(readFileSync(pkgPath, 'utf8')).version
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const manifestVersion = String(manifest.version ?? '')

if (manifestVersion === pkgVersion) {
  if (!checkOnly) {
    process.stdout.write(`extension/manifest.json уже v${pkgVersion}\n`)
  }
  process.exit(0)
}

if (checkOnly) {
  process.stderr.write(
    `❌ Версии расходятся: package.json v${pkgVersion}, extension/manifest.json v${manifestVersion}\n`,
  )
  process.stderr.write('   Запустите: npm run sync:extension\n')
  process.exit(1)
}

manifest.version = pkgVersion
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
process.stdout.write(`✅ extension/manifest.json → v${pkgVersion}\n`)
