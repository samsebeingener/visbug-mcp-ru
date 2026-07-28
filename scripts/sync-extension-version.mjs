#!/usr/bin/env node
/**
 * Держит extension/manifest.json.version в sync с package.json.
 * Chrome показывает версию только из manifest — без этого popup/git pull ≠ chrome://extensions.
 */

import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkgPath = join(ROOT, 'package.json')
const manifestPath = join(ROOT, 'extension', 'manifest.json')

const checkOnly = process.argv.includes('--check')

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
