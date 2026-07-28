/**
 * Поиск Cursor Agent CLI — без всплывающих консолей на Windows.
 */

import { existsSync, readdirSync } from 'fs'
import { homedir, platform } from 'os'
import { dirname, join } from 'path'
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

function parseVersionKey(name) {
  const date = String(name).split('-')[0]
  const parts = date.split('.')
  if (parts.length !== 3) return 0
  return Number(`${parts[0]}${parts[1].padStart(2, '0')}${parts[2].padStart(2, '0')}`) || 0
}

/**
 * agent.cmd → powershell → node.exe. На Windows это открывает консоль.
 * Резолвим прямой node.exe + index.js и спавним без cmd/powershell.
 */
export function resolveDirectAgentEntry(wrapperPath) {
  if (!wrapperPath || !existsSync(wrapperPath)) return null
  const root = dirname(wrapperPath)
  const localNode = join(root, 'node.exe')
  const localIndex = join(root, 'index.js')
  if (existsSync(localNode) && existsSync(localIndex)) {
    return { node: localNode, script: localIndex, root }
  }

  const versionsDir = join(root, 'versions')
  if (!existsSync(versionsDir)) return null
  const versions = readdirSync(versionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => /^\d{4}\.\d{1,2}\.\d{1,2}/.test(name))
    .sort((a, b) => parseVersionKey(b) - parseVersionKey(a))

  for (const version of versions) {
    const node = join(versionsDir, version, 'node.exe')
    const script = join(versionsDir, version, 'index.js')
    if (existsSync(node) && existsSync(script)) {
      return { node, script, root, version }
    }
  }
  return null
}

function probeExecutable(command) {
  try {
    const direct = resolveDirectAgentEntry(command)
    // Только прямой node.exe — cmd/powershell всегда мигают окном на Windows.
    if (direct) {
      return spawnHidden(direct.node, [direct.script, '--version']).status === 0
    }
    if (WIN && /\.(cmd|bat)$/i.test(command)) {
      // Не запускаем .cmd: это открывает консоль. Достаточно existsSync + direct.
      return Boolean(resolveDirectAgentEntry(command))
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
    const direct = resolveDirectAgentEntry(configuredPath)
    if (!probe) {
      return {
        ok: true,
        command: configuredPath,
        path: configuredPath,
        direct,
      }
    }
    if (probeExecutable(configuredPath)) {
      return { ok: true, command: configuredPath, path: configuredPath, direct }
    }
  }

  const name = config.cursorCli || 'agent'
  if (!probe) {
    return { ok: false, command: configuredPath || name }
  }

  if (probeExecutable(name)) {
    return { ok: true, command: name, direct: resolveDirectAgentEntry(name) }
  }

  for (const candidate of getAgentCandidatePaths()) {
    if (!existsSync(candidate)) continue
    if (probeExecutable(candidate)) {
      return {
        ok: true,
        command: candidate,
        path: candidate,
        direct: resolveDirectAgentEntry(candidate),
      }
    }
  }

  return { ok: false, command: name }
}

/** Для popup/health: без запуска CLI (иначе на Windows мигают окна при каждом ping). */
export function getCliHealthForUi(config = {}) {
  const spawnCli = config.autoAgent?.spawnCli === true
  const resolved = resolveAgentCommand(config, { probe: false })
  const path = resolved.path || config.cursorCliPath?.trim() || ''
  const direct = resolved.direct || (path ? resolveDirectAgentEntry(path) : null)
  const ok = Boolean(direct?.node || (path && existsSync(path)))
  return {
    ok,
    command: path || resolved.command || config.cursorCli || 'agent',
    path: path || undefined,
    direct,
    spawnCli,
  }
}

export function checkCursorCliAvailable(config = {}) {
  return Promise.resolve(getCliHealthForUi(config))
}
