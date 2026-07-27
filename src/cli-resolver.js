/**
 * Поиск исполняемого Cursor Agent CLI (`agent`) — PATH и типичные пути установки.
 */

import { existsSync } from 'fs'
import { homedir, platform } from 'os'
import { join } from 'path'
import { spawnSync } from 'child_process'

function probeExecutable(command) {
  try {
    const r = spawnSync(command, ['--version'], {
      shell: true,
      stdio: 'ignore',
      timeout: 8000,
    })
    return r.status === 0
  } catch {
    return false
  }
}

/** @returns {string[]} */
export function getAgentCandidatePaths() {
  const home = homedir()
  const win = platform() === 'win32'
  const localAppData = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local')

  const paths = [
    join(home, '.local', 'bin', win ? 'agent.exe' : 'agent'),
    join(home, '.cursor', 'bin', win ? 'agent.exe' : 'agent'),
    join(localAppData, 'cursor-agent', win ? 'agent.exe' : 'agent'),
    join(localAppData, 'Programs', 'cursor-agent', win ? 'agent.exe' : 'agent'),
  ]

  if (win) {
    paths.push(
      join(localAppData, 'Microsoft', 'WindowsApps', 'agent.exe'),
      'C:\\Program Files\\cursor-agent\\agent.exe',
    )
  }

  return paths.filter((p) => p && !p.includes('undefined'))
}

/**
 * @param {{ cursorCli?: string, cursorCliPath?: string }} [config]
 * @returns {{ ok: boolean, command: string, path?: string }}
 */
export function resolveAgentCommand(config = {}) {
  const configuredPath = config.cursorCliPath?.trim()
  if (configuredPath && existsSync(configuredPath) && probeExecutable(configuredPath)) {
    return { ok: true, command: configuredPath, path: configuredPath }
  }

  const name = config.cursorCli || 'agent'
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

export function checkCursorCliAvailable(config = {}) {
  return Promise.resolve(resolveAgentCommand(config))
}
