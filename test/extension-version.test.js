import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('extension manifest version matches package.json', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const manifest = JSON.parse(readFileSync(join(ROOT, 'extension', 'manifest.json'), 'utf8'))
  assert.equal(manifest.version, pkg.version, 'run: npm run sync:extension')
})
