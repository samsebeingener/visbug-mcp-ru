/**
 * Запуск Cursor CLI agent после завершения записи VisBug.
 */

import { spawn } from 'child_process'
import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { loadConfig, getPromptPath, getStoreDir } from './config.js'
import { resolveAgentCommand, resolveDirectAgentEntry } from './cli-resolver.js'
import { autoApplyWorkspace } from './auto-apply.js'
import { ensureAgentCli } from '../scripts/ensure-agent-cli.mjs'
import { createAgentRun, readAgentRunCompletion } from './agent-run.js'

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
    'Прочитай локальный run-packet с правками VisBug.',
    'Примени правки в workspace по смыслу (CSS/разметка). Move left/top → transform: translate; width/height пиши даже вместе с Move; пропусти только cursor/position/transition.',
    'После записи в файлы заверши run через локальный completion script.',
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

  const workspace = meta.project?.workspace?.trim() || config.autoAgent.workspace?.trim()
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
    log(`осталось ${remaining} правок — Cursor Agent CLI выключен (spawnCli=false). Остаток в буфере / /visbug-apply`)
    return {
      action: applyResult.applied > 0 ? 'auto-applied-partial' : 'failed',
      spawned: false,
      ...applyResult,
      remaining,
      reason: 'spawnCli disabled',
    }
  }

  const agentResult = await maybeSpawnAutoAgent({ ...meta, workspace, total: remaining }, changes)
  if (agentResult.spawned) {
    return {
      action: agentResult.applied > 0 ? 'agent-applied' : 'agent-incomplete',
      ...applyResult,
      remaining: remaining - agentResult.applied,
      ...agentResult,
    }
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
  if (config.autoAgent.spawnCli !== true) {
    return { spawned: false, reason: 'spawnCli disabled' }
  }

  const workspace = meta.workspace?.trim() || config.autoAgent.workspace?.trim()
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

  const pendingChanges = changes.filter((change) => !change.applied)
  const run = createAgentRun({
    workspace,
    url: meta.url,
    changes: pendingChanges,
    project: meta.project,
    server: meta.server,
  })
  const completeScript = join(config.repoRoot, 'scripts', 'complete-agent-run.mjs')
  const prompt = readApplyPrompt(config)
  const urlNote = meta.url ? `\n\nСтраница записи: ${meta.url}` : ''
  const runNote = [
    `\n\nRun-packet: ${run.path}`,
    `Workspace: ${workspace}`,
    `После успешного применения вызови: node "${completeScript}" --run ${run.runId} --applied <индексы_из_packet> --files <пути_через_запятую>.`,
  ].join('\n')
  const fullPrompt = `${prompt}${urlNote}${runNote}`

  const cmd = cliCheck.command || resolveCursorCli(config)
  const direct = cliCheck.direct || resolveDirectAgentEntry(cmd)
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
    // CREATE_NO_WINDOW — без мигающего cmd/powershell
    spawnOpts.creationFlags = 0x08000000
  }

  let child
  if (direct?.node && direct?.script) {
    // Прямой node.exe + index.js: agent.cmd → powershell открывает консоль.
    child = spawn(direct.node, [direct.script, ...args], spawnOpts)
  } else if (process.platform === 'win32' && /\.cmd$/i.test(cmd)) {
    child = spawn('cmd.exe', ['/d', '/c', cmd, ...args], spawnOpts)
  } else {
    child = spawn(cmd, args, spawnOpts)
  }

  meta.onAgentStarted?.({ workspace, runId: run.runId, total: pendingChanges.length })
  log(`spawned: ${direct ? `${direct.node} ${direct.script}` : cmd} workspace=${workspace} changes=${meta.total ?? 0}`)
  return await new Promise((resolve) => {
    child.on('error', (err) => {
      agentRunning = false
      log(`error spawn: ${err.message}`)
      resolve({ spawned: false, reason: 'agent spawn failed' })
    })
    child.on('close', (code) => {
      agentRunning = false
      const completion = readAgentRunCompletion(run)
      const applied = completion?.appliedIds ?? []
      for (const index of applied) {
        if (pendingChanges[index]) pendingChanges[index].applied = true
      }
      log(`agent exit code=${code ?? '?'} workspace=${workspace} applied=${applied.length}`)
      resolve({
        spawned: true,
        workspace,
        command: cmd,
        runId: run.runId,
        applied: applied.length,
        files: completion?.files ?? [],
        completion: Boolean(completion),
      })
    })
    child.unref()
  })
}
