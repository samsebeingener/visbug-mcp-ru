import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** Единая версия пакета — читать отсюда, не хардкодить в daemon/server. */
export const PACKAGE_VERSION = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf8'),
).version
