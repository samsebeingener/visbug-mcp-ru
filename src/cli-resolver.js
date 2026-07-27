/**
 * Поиск Cursor Agent CLI — без всплывающих консолей на Windows.
 */

import { existsSync } from 'fs'
import { homedir, platform } from 'os'
import { join } from 'path'
import { spawnSync } from 'child_process'

const WIN = platform() === 'win32'
const CREATE_NO_WINDOW = 0x08000000

function spawnHidden(command, args) {
  const opts = {
    stdio: 'ignore',
    timeout: 8000,
    windowsHide: true,
    shell: false,
  }
  if (WIN) opts.creationFlags = CREATE_NO_WINDOW
  return spawnSync(command, args, opts)
}

function probeExecutable(command) {
  try {
    if (WIN && /\.(cmd|bat)$/i.test(command)) {
      return spawnHidden('cmd.exe', ['/c', command, '--version']).status === 0
    }
    return spawnHidden(command, ['--version']).status === 0
  } catch {
    return false
  }
}

/** @returns {string[]} */
export function getAgentCandidatePaths() {
  const home = homedir()
  const localAppData = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local')

  const paths = [
    join(home, '.local', 'bin', WIN ? 'agent.cmd' : 'agent'),
    join(home, '.cursor', 'bin', WIN ? 'agent.cmd' : 'agent'),
    join(localAppData, 'cursor-agent', WIN ? 'agent.cmd' : 'agent'),
    join(localAppData, 'cursor-agent', WIN ? 'cursor-agent.cmd' : 'cursor-agent'),
    join(localAppData, 'Programs', 'cursor-agent', WIN ? 'agent.cmd' : 'agent'),
  ]

  return paths.filter((p) => p && !p.includes('undefined'))
}

/**
 * @param {{ cursorCli?: string, cursorCliPath?: string, autoAgent?: { spawnCli?: boolean } }} [config]
 * @param {{ probe?: boolean }} [options] — probe=false: только existsSync, без запуска CLI
 */
export function resolveAgentCommand(config = {}, { probe = true } = {}) {
  const configuredPath = config.cursorCliPath?.trim()
  if (configuredPath && existsSync(configuredPath)) {
    if (!probe) return { ok: true, command: configuredPath, path: configuredPath }
    if (probeExecutable(configuredPath)) {
      return { ok: true, command: configuredPath, path: configuredPath }
    }
  }

  const name = config.cursorCli || 'agent'
  if (!probe) {
    return { ok: false, command: configuredPath || name }
  }

  if (probeExecutable(name)) {
    return { ok: true, command: name }
  }

  for (const candidate of getAgentCandidatePaths()) {
    if (!existsSync(candidate)) continue
    if (probeExecutable(candidate)) {
      return { ok: true, command: candidate, path: candidate }
    }
  }

  return { ok: false, command: name }
}

/** Для popup/health: не запускать agent, если spawnCli выключен. */
export function getCliHealthForUi(config = {}) {
  const spawnCli = config.autoAgent?.spawnCli === true
  if (!spawnCli) {
    const path = config.cursorCliPath?.trim()
    return {
      ok: Boolean(path && existsSync(path)),
      command: path || config.cursorCli || 'agent',
      spawnCli: false,
    }
  }
  const resolved = resolveAgentCommand(config, { probe: true })
  return { ...resolved, spawnCli: true }
}

export function checkCursorCliAvailable(config = {}) {
  return Promise.resolve(getCliHealthForUi(config))
}
