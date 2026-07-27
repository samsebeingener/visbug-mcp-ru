/**
 * ~/.visbug-mcp/config.json — настройки демона и auto-agent.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const STORE_DIR = join(homedir(), '.visbug-mcp')
const CONFIG_FILE = join(STORE_DIR, 'config.json')

const __dirname = dirname(fileURLToPath(import.meta.url))
export const DEFAULT_REPO_ROOT = join(__dirname, '..')

export const DEFAULT_CONFIG = {
  version: 1,
  repoRoot: DEFAULT_REPO_ROOT,
  autoAgent: {
    enabled: false,
    workspace: '',
    useForce: true,
    /** headless `agent` после «Стоп» — по умолчанию ВЫКЛ (мигает терминал на Windows). */
    spawnCli: false,
  },
  cursorCli: 'agent',
}

export function getStoreDir() {
  return STORE_DIR
}

export function getConfigPath() {
  return CONFIG_FILE
}

export function loadConfig() {
  mkdirSync(STORE_DIR, { recursive: true })
  if (!existsSync(CONFIG_FILE)) {
    return { ...DEFAULT_CONFIG, autoAgent: { ...DEFAULT_CONFIG.autoAgent } }
  }
  try {
    const raw = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'))
    return {
      ...DEFAULT_CONFIG,
      ...raw,
      autoAgent: { ...DEFAULT_CONFIG.autoAgent, ...(raw.autoAgent ?? {}) },
    }
  } catch {
    return { ...DEFAULT_CONFIG, autoAgent: { ...DEFAULT_CONFIG.autoAgent } }
  }
}

export function saveConfig(config) {
  mkdirSync(STORE_DIR, { recursive: true })
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8')
}

export function getPromptPath(config = loadConfig()) {
  const root = config.repoRoot || DEFAULT_REPO_ROOT
  return join(root, 'prompts', 'visbug-apply.md')
}
