#!/usr/bin/env node
/**
 * Безопасное обновление visbug-mcp-ru:
 * - git pull с autostash (локальные правки в репо не теряются)
 * - ~/.visbug-mcp/config.json и changes.json не перезаписываются
 * - команды и rule visbug-buffer-apply в workspace(ы) из config, если их нет
 */

import { spawn, spawnSync } from 'child_process'
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
} from 'fs'
import { homedir, platform } from 'os'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { loadConfig, saveConfig, DEFAULT_CONFIG } from '../src/config.js'
import { clearPendingUpdate } from '../src/update-check.js'
import { syncAllWorkspaceCursorArtifacts } from './sync-cursor-artifacts.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')
const STORE_DIR = join(homedir(), '.visbug-mcp')

function run(cmd, args, opts = {}) {
  const isWin = platform() === 'win32'
  const r = spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: opts.inherit ? 'inherit' : 'pipe',
    shell: isWin && (cmd === 'npm' || cmd === 'npx'),
    ...opts,
  })
  return r
}

function backupUserData() {
  mkdirSync(STORE_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupDir = join(STORE_DIR, 'backups', stamp)
  mkdirSync(backupDir, { recursive: true })
  for (const name of ['config.json', 'changes.json', 'update-check.json']) {
    const src = join(STORE_DIR, name)
    if (existsSync(src)) {
      copyFileSync(src, join(backupDir, name))
    }
  }
  return backupDir
}

function mergeConfigPreservingUser() {
  const before = loadConfig()
  const merged = {
    ...DEFAULT_CONFIG,
    ...before,
    repoRoot: REPO_ROOT,
    autoAgent: { ...DEFAULT_CONFIG.autoAgent, ...(before.autoAgent ?? {}) },
  }
  saveConfig(merged)
  return merged
}

function syncCursorArtifacts(config) {
  const totals = syncAllWorkspaceCursorArtifacts(config, REPO_ROOT, { log: true })
  if (totals.workspaces === 0) {
    console.log('○ Workspace не задан в config — rule/commands не копировались')
    return
  }
  if (totals.commands === 0 && totals.rules === 0) {
    console.log('○ Команды и rules уже есть во всех workspace из config')
  }
}

function restartDaemon() {
  const isWin = platform() === 'win32'
  if (isWin) {
    run('powershell', [
      '-ExecutionPolicy', 'Bypass',
      '-File', join(REPO_ROOT, 'scripts', 'start-ws-daemon.ps1'),
    ], { inherit: true })
    return
  }
  const child = spawn('node', [join(REPO_ROOT, 'src', 'ws-daemon.js')], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
  console.log('✅ Демон перезапущен')
}

function readVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'))
    return pkg.version
  } catch {
    return '?'
  }
}

async function main() {
  console.log('\n=== VisBug MCP — обновление ===\n')
  console.log(`Репо: ${REPO_ROOT}\n`)

  const backupDir = backupUserData()
  console.log(`Резервная копия настроек: ${backupDir}\n`)

  if (!existsSync(join(REPO_ROOT, '.git'))) {
    console.error('❌ Нет .git — обновляйте вручную или клонируйте репозиторий заново.')
    process.exit(1)
  }

  let r = run('git', ['fetch', 'origin', 'main'])
  if (r.status !== 0) {
    console.error('❌ git fetch не удался:', r.stderr || r.stdout)
    process.exit(1)
  }

  r = run('git', ['pull', '--rebase', '--autostash', 'origin', 'main'], { inherit: true })
  if (r.status !== 0) {
    console.error('\n❌ git pull остановился (конфликт или локальные коммиты).')
    console.error('   Разрешите конфликт вручную или: git stash → pull → git stash pop')
    console.error(`   Настройки сохранены в ${backupDir}`)
    process.exit(1)
  }

  r = run('npm', ['install'], { inherit: true })
  if (r.status !== 0) {
    console.error('❌ npm install не удался')
    process.exit(1)
  }

  const config = mergeConfigPreservingUser()
  syncCursorArtifacts(config)

  run('node', [join(REPO_ROOT, 'scripts', 'sync-extension-version.mjs')], { inherit: true })

  clearPendingUpdate()
  restartDaemon()

  const version = readVersion()
  console.log(`\n✅ Обновлено до v${version}`)
  console.log('   1. Chrome → chrome://extensions → ↻ на карточке «VisBug MCP Bridge»')
  console.log('      (кнопка «Обновить» в popup не перезагружает расширение — только ↻ в Chrome)')
  console.log('   2. Cursor → Reload Window')
  console.log('   3. Если rule visbug-buffer-apply ещё нет в проекте — он скопирован в .cursor/rules/ (или уже был)')
  console.log('\n   Ваш config.json и буфер правок не затронуты.\n')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
