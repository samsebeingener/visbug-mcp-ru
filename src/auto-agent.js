/**
 * Запуск Cursor CLI agent после завершения записи VisBug.
 */

import { spawn } from 'child_process'
import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { loadConfig, getPromptPath, getStoreDir } from './config.js'

let agentRunning = false
let lastSpawnAt = 0
const DEBOUNCE_MS = 3000

function log(line) {
  const dir = getStoreDir()
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString()
  appendFileSync(join(dir, 'agent-runs.log'), `[${stamp}] ${line}\n`, 'utf8')
  process.stderr.write(`[auto-agent] ${line}\n`)
}

export function resolveCursorCli(config) {
  const cmd = config.cursorCli || 'agent'
  return cmd
}

export function readApplyPrompt(config) {
  const promptPath = getPromptPath(config)
  if (existsSync(promptPath)) {
    return readFileSync(promptPath, 'utf8').trim()
  }
  return [
    'Вызови MCP visbug-mcp get_changes без фильтра.',
    'Примени правки в workspace по смыслу (CSS/разметка), пропусти артефакты VisBug (cursor, position, transition).',
    'После записи в файлы вызови apply_changes для применённых индексов.',
  ].join('\n')
}

export function checkCursorCliAvailable(config = loadConfig()) {
  const cmd = resolveCursorCli(config)
  return new Promise((resolve) => {
    const probe = spawn(cmd, ['--version'], { shell: true, stdio: 'ignore' })
    probe.on('error', () => resolve({ ok: false, command: cmd }))
    probe.on('close', (code) => resolve({ ok: code === 0, command: cmd }))
    setTimeout(() => {
      probe.kill()
      resolve({ ok: false, command: cmd, timeout: true })
    }, 5000)
  })
}

/**
 * @param {{ total: number, url?: string }} meta
 */
export async function maybeSpawnAutoAgent(meta = {}) {
  const config = loadConfig()
  if (!config.autoAgent?.enabled) {
    return { spawned: false, reason: 'auto-agent disabled' }
  }

  const workspace = config.autoAgent.workspace?.trim()
  if (!workspace) {
    log('skip: workspace не задан (npm run setup)')
    return { spawned: false, reason: 'workspace missing' }
  }

  if (!existsSync(workspace)) {
    log(`skip: workspace не найден: ${workspace}`)
    return { spawned: false, reason: 'workspace not found' }
  }

  const now = Date.now()
  if (agentRunning) {
    return { spawned: false, reason: 'agent already running' }
  }
  if (now - lastSpawnAt < DEBOUNCE_MS) {
    return { spawned: false, reason: 'debounced' }
  }

  const cliCheck = await checkCursorCliAvailable(config)
  if (!cliCheck.ok) {
    log(`skip: Cursor CLI «${cliCheck.command}» недоступен. Установите CLI и выполните agent login`)
    return { spawned: false, reason: 'cli unavailable' }
  }

  const prompt = readApplyPrompt(config)
  const urlNote = meta.url ? `\n\nСтраница записи: ${meta.url}` : ''
  const countNote = `\n\nВ буфере правок после записи: ${meta.total ?? '?'}.`
  const fullPrompt = `${prompt}${urlNote}${countNote}`

  const args = ['-p', '--workspace', workspace]
  if (config.autoAgent.useForce !== false) args.push('--force')
  args.push(fullPrompt)

  const cmd = resolveCursorCli(config)
  lastSpawnAt = now
  agentRunning = true

  const child = spawn(cmd, args, {
    shell: true,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  })

  child.on('error', (err) => {
    agentRunning = false
    log(`error spawn: ${err.message}`)
  })

  child.on('close', (code) => {
    agentRunning = false
    log(`agent exit code=${code ?? '?'} workspace=${workspace}`)
  })

  child.unref()
  log(`spawned: ${cmd} workspace=${workspace} changes=${meta.total ?? 0}`)
  return { spawned: true, workspace, command: cmd }
}
