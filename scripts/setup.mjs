#!/usr/bin/env node
/**
 * Интерактивная установка visbug-mcp-ru (фазы 1–5).
 * npm run setup
 * npm run setup:quick -- --workspace "C:/path/to/frontend"
 */

import { createInterface } from 'readline'
import { spawn, spawnSync } from 'child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { homedir, platform } from 'os'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { saveConfig, loadConfig } from '../src/config.js'
import { ensureAgentCli } from './ensure-agent-cli.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')
const MCP_FILE = join(homedir(), '.cursor', 'mcp.json')
const SERVER_JS = join(REPO_ROOT, 'src', 'server.js').replace(/\\/g, '/')

function parseArgs(argv) {
  const out = { yes: false, workspace: '' }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--yes' || a === '-y') out.yes = true
    else if (a === '--workspace' || a === '-w') out.workspace = resolve(argv[++i] || '')
  }
  return out
}

function ask(rl, question) {
  return new Promise((res) => rl.question(question, res))
}

function mergeMcpConfig() {
  mkdirSync(dirname(MCP_FILE), { recursive: true })
  let data = { mcpServers: {} }
  if (existsSync(MCP_FILE)) {
    try {
      data = JSON.parse(readFileSync(MCP_FILE, 'utf8'))
      if (!data.mcpServers && typeof data === 'object') {
        const { mcpServers, ...rest } = data
        data = { mcpServers: rest }
      }
      if (!data.mcpServers) data.mcpServers = {}
    } catch {
      console.warn('⚠️  Не удалось прочесть mcp.json — будет создан новый фрагмент.')
      data = { mcpServers: {} }
    }
  }

  data.mcpServers['visbug-mcp'] = {
    command: 'node',
    args: [SERVER_JS],
  }

  writeFileSync(MCP_FILE, JSON.stringify(data, null, 2), 'utf8')
  console.log(`✅ MCP: запись visbug-mcp в ${MCP_FILE}`)
}

function startDaemon() {
  const isWin = platform() === 'win32'
  if (isWin) {
    spawnSync('powershell', [
      '-ExecutionPolicy', 'Bypass',
      '-File', join(REPO_ROOT, 'scripts', 'start-ws-daemon.ps1'),
    ], { stdio: 'inherit', cwd: REPO_ROOT })
  } else {
    const child = spawn('node', ['src/ws-daemon.js'], {
      cwd: REPO_ROOT,
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
    console.log('✅ Демон запущен: node src/ws-daemon.js (фон)')
  }
}

async function main() {
  const args = parseArgs(process.argv)
  console.log('\n=== VisBug MCP Bridge — установка ===\n')
  console.log(`Репозиторий: ${REPO_ROOT}\n`)

  let workspace = args.workspace
  let enableAuto = args.yes

  if (!args.yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const workspaceRaw = await ask(
      rl,
      'Путь к проекту сайта (workspace для auto-agent после «Стоп», Enter = пропустить): ',
    )
    workspace = workspaceRaw.trim() ? resolve(workspaceRaw.trim()) : workspace

    const autoAnswer = await ask(
      rl,
      'Включить auto-agent после «Стоп»? (Y/n) — правки применятся сами, без команд в чате: ',
    )
    enableAuto = !/^n|no|нет$/i.test(autoAnswer.trim())
    rl.close()
  } else if (!workspace) {
    workspace = process.env.VISBUG_WORKSPACE ? resolve(process.env.VISBUG_WORKSPACE) : ''
  }

  if (workspace && !existsSync(workspace)) {
    console.warn(`⚠️  Папка не найдена: ${workspace}`)
  }

  const config = {
    ...loadConfig(),
    version: 1,
    repoRoot: REPO_ROOT,
    autoAgent: {
      enabled: enableAuto && Boolean(workspace),
      workspace: workspace || '',
      useForce: true,
    },
    cursorCli: 'agent',
  }
  saveConfig(config)

  mergeMcpConfig()
  startDaemon()

  console.log('\n--- Cursor Agent CLI (для «Стоп» без команд) ---\n')
  const cli = await ensureAgentCli({ install: true, quiet: false })
  if (!cli.ok) {
    console.log('⚠️  CLI не установился. Повторите: npm run ensure-cli\n')
  } else if (!cli.installed) {
    console.log('✅ CLI уже был на месте\n')
  }

  console.log('--- Осталось вручную (один раз) ---\n')
  console.log('1. VisBug — Chrome Web Store:')
  console.log('   https://chromewebstore.google.com/detail/visbug/cdockenadnadldjbbgcallicgledbeoc\n')
  console.log('2. Расширение visbug-mcp — chrome://extensions →')
  console.log(`   «Загрузить распакованное» → ${join(REPO_ROOT, 'extension')}\n`)
  console.log('3. Cursor → Reload Window\n')

  if (config.autoAgent.enabled) {
    console.log(`Auto-agent: ВКЛ → ${workspace}`)
    console.log('Цикл: Запись → правки VisBug → Стоп → агент сам пишет в файлы.')
    console.log('Лог: ~/.visbug-mcp/agent-runs.log\n')
  } else {
    console.log('Auto-agent: ВЫКЛ. Запустите npm run setup с путём к проекту.\n')
  }

  console.log('Готово.\n')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
