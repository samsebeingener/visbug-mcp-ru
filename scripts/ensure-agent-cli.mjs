#!/usr/bin/env node
/**
 * Ставит Cursor Agent CLI, если `agent` не найден. Вызывается из setup и после «Стоп».
 */

import { spawnSync } from 'child_process'
import { platform } from 'os'
import { resolveAgentCommand } from '../src/cli-resolver.js'
import { loadConfig, saveConfig } from '../src/config.js'

export async function ensureAgentCli({ install = true, quiet = false } = {}) {
  const config = loadConfig()
  let resolved = resolveAgentCommand(config)

  if (resolved.ok) {
    if (resolved.path && resolved.path !== config.cursorCliPath) {
      saveConfig({ ...config, cursorCliPath: resolved.path })
    }
    return { ...resolved, installed: false }
  }

  if (!install) {
    return { ...resolved, installed: false, reason: 'not found' }
  }

  if (!quiet) {
    console.log('Cursor Agent CLI не найден — ставлю автоматически (один раз)…')
  }

  const isWin = platform() === 'win32'
  const installCmd = isWin
    ? "irm 'https://cursor.com/install?win32=true' | iex"
    : 'curl -fsS https://cursor.com/install | bash'

  const r = spawnSync(isWin ? 'powershell' : 'bash', isWin
    ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', installCmd]
    : ['-lc', installCmd],
  { stdio: quiet ? 'ignore' : 'inherit', timeout: 120000 })

  if (r.error && !quiet) {
    console.warn('⚠️  Автоустановка CLI не удалась:', r.error.message)
  }

  resolved = resolveAgentCommand(loadConfig())
  if (resolved.ok) {
    const fresh = loadConfig()
    saveConfig({ ...fresh, cursorCliPath: resolved.path || fresh.cursorCliPath })
    if (!quiet) console.log('✅ Cursor Agent CLI готов:', resolved.command)
    return { ...resolved, installed: true }
  }

  return { ...resolved, installed: false, reason: 'install failed' }
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('ensure-agent-cli.mjs')
if (isMain) {
  ensureAgentCli({ install: true, quiet: false }).then((r) => {
    process.exit(r.ok ? 0 : 1)
  })
}
