/**
 * Запуск Cursor CLI agent после завершения записи VisBug.
 */

import { spawn } from 'child_process'
import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { loadConfig, getPromptPath, getStoreDir } from './config.js'
import { resolveAgentCommand } from './cli-resolver.js'
import { autoApplyWorkspace } from './auto-apply.js'
import { ensureAgentCli } from '../scripts/ensure-agent-cli.mjs'

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
  const resolved = resolveAgentCommand(config)
  return resolved.ok ? resolved.command : (config.cursorCli || 'agent')
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
  return Promise.resolve(resolveAgentCommand(config))
}

/**
 * После «Стоп»: сначала пишем в файлы сами (без CLI), остаток — в headless agent если есть.
 * @param {{ total?: number, url?: string }} meta
 * @param {object[]} changes — мутабельный массив правок
 */
export async function handlePostRecording(meta = {}, changes = []) {
  const config = loadConfig()
  if (!config.autoAgent?.enabled) {
    return { action: 'disabled', spawned: false, reason: 'auto-agent disabled' }
  }

  const workspace = config.autoAgent.workspace?.trim()
  if (!workspace) {
    log('skip: workspace не задан (npm run setup)')
    return { action: 'skipped', spawned: false, reason: 'workspace missing' }
  }

  if (!existsSync(workspace)) {
    log(`skip: workspace не найден: ${workspace}`)
    return { action: 'skipped', spawned: false, reason: 'workspace not found' }
  }

  const applyResult = autoApplyWorkspace(workspace, changes)
  const remaining = changes.filter((c) => !c.applied).length

  if (applyResult.applied > 0) {
    log(`auto-apply: ${applyResult.applied} в файлы (${applyResult.files.join(', ') || '—'})`)
  }

  if (remaining === 0) {
    return { action: 'auto-applied', spawned: false, ...applyResult, remaining: 0 }
  }

  if (config.autoAgent.spawnCli !== true) {
    log(`осталось ${remaining} правок — CLI не запускаем (spawnCli=false). /visbug-apply в Cursor`)
    return {
      action: applyResult.applied > 0 ? 'auto-applied-partial' : 'failed',
      spawned: false,
      ...applyResult,
      remaining,
      reason: 'use-visbug-apply',
    }
  }

  const agentResult = await maybeSpawnAutoAgent({ ...meta, total: remaining }, changes)
  if (agentResult.spawned) {
    return { action: 'agent-spawned', ...applyResult, remaining, ...agentResult }
  }

  if (applyResult.applied > 0) {
    return {
      action: 'auto-applied-partial',
      spawned: false,
      ...applyResult,
      remaining,
      agentReason: agentResult.reason,
    }
  }

  return { action: 'failed', spawned: false, ...applyResult, remaining, reason: agentResult.reason }
}

/**
 * @param {{ total: number, url?: string }} meta
 * @param {object[]} [changes]
 */
export async function maybeSpawnAutoAgent(meta = {}, changes = []) {
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

  let cliCheck = await checkCursorCliAvailable(config)
  if (!cliCheck.ok) {
    log('CLI не найден — пробую автоустановку…')
    const ensured = await ensureAgentCli({ install: true, quiet: true })
    cliCheck = ensured.ok ? ensured : await checkCursorCliAvailable(loadConfig())
  }
  if (!cliCheck.ok) {
    log(`skip: Cursor Agent CLI недоступен (${cliCheck.command}). Перезапустите терминал или: npm run ensure-cli`)
    return { spawned: false, reason: 'cli unavailable' }
  }

  const prompt = readApplyPrompt(config)
  const urlNote = meta.url ? `\n\nСтраница записи: ${meta.url}` : ''
  const countNote = `\n\nВ буфере правок после записи: ${meta.total ?? '?'}.`
  const fullPrompt = `${prompt}${urlNote}${countNote}`

  const cmd = resolveCursorCli(config)
  lastSpawnAt = now
  agentRunning = true

  const args = ['-p', '--workspace', workspace]
  if (config.autoAgent.useForce !== false) args.push('--force')
  args.push(fullPrompt)

  const spawnOpts = {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    shell: false,
    env: { ...process.env },
  }
  if (process.platform === 'win32') {
    spawnOpts.creationFlags = 0x08000000
  }

  let child
  if (process.platform === 'win32' && /\.cmd$/i.test(cmd)) {
    // Без shell: true — иначе на Windows всплывает консоль
    child = spawn('cmd.exe', ['/c', cmd, ...args], {
      ...spawnOpts,
      shell: false,
    })
  } else {
    child = spawn(cmd, args, { ...spawnOpts, shell: false })
  }

  child.on('error', (err) => {
    agentRunning = false
    log(`error spawn: ${err.message}`)
  })

  child.on('close', (code) => {
    agentRunning = false
    const stillPending = changes.filter((c) => !c.applied).length
    log(`agent exit code=${code ?? '?'} workspace=${workspace} pending=${stillPending}`)
    if (stillPending > 0) {
      log(`agent не применил ${stillPending} правок — используйте /visbug-apply в Cursor`)
    }
  })

  child.unref()
  log(`spawned: ${cmd} workspace=${workspace} changes=${meta.total ?? 0}`)
  return { spawned: true, workspace, command: cmd }
}
