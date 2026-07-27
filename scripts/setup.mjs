#!/usr/bin/env node
/**
 * Интерактивная установка visbug-mcp-ru (фазы 1–5).
 * npm run setup
 */

import { createInterface } from 'readline'
import { spawn, spawnSync } from 'child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { homedir, platform } from 'os'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { saveConfig, loadConfig } from '../src/config.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')
const MCP_FILE = join(homedir(), '.cursor', 'mcp.json')
const SERVER_JS = join(REPO_ROOT, 'src', 'server.js').replace(/\\/g, '/')

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

function probeCli(command) {
  const r = spawnSync(command, ['--version'], { shell: true, stdio: 'ignore' })
  return r.status === 0
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
  console.log('\n=== VisBug MCP Bridge — установка ===\n')
  console.log(`Репозиторий: ${REPO_ROOT}\n`)

  const rl = createInterface({ input: process.stdin, output: process.stdout })

  const workspaceRaw = await ask(
    rl,
    'Путь к вашему проекту сайта (workspace для auto-agent, Enter = пропустить): ',
  )
  const workspace = workspaceRaw.trim() ? resolve(workspaceRaw.trim()) : ''

  if (workspace && !existsSync(workspace)) {
    console.warn(`⚠️  Папка не найдена: ${workspace}`)
  }

  const autoAnswer = await ask(
    rl,
    'Включить auto-agent после «Стоп»? (y/N) — headless Cursor CLI пишет в файлы без подтверждения: ',
  )
  const enableAuto = /^y|yes|да$/i.test(autoAnswer.trim())

  rl.close()

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

  const cliOk = probeCli('agent')

  console.log('\n--- Следующие шаги вручную ---\n')
  console.log('1. VisBug — Chrome Web Store:')
  console.log('   https://chromewebstore.google.com/detail/visbug/cdockenadnadldjbbgcallicgledbeoc\n')
  console.log('2. Расширение visbug-mcp — chrome://extensions → Режим разработчика →')
  console.log(`   «Загрузить распакованное» → папка:\n   ${join(REPO_ROOT, 'extension')}\n`)
  console.log('3. Cursor → Reload Window (после правки mcp.json)\n')

  if (!cliOk) {
    console.log('4. Cursor CLI (для auto-agent):')
    console.log('   https://cursor.com/docs/cli/overview')
    console.log('   Затем в терминале: agent login\n')
  } else {
    console.log('4. Cursor CLI: обнаружен ✅ (agent --version)\n')
  }

  if (config.autoAgent.enabled) {
    console.log(`5. Auto-agent: ВКЛ → workspace: ${workspace}`)
    console.log('   После «Стоп» в popup агент запустится сам. Лог: ~/.visbug-mcp/agent-runs.log\n')
  } else {
    console.log('5. Auto-agent: ВЫКЛ. Включить позже: npm run setup\n')
  }

  console.log('6. В Cursor в проекте сайта: команда /visbug-mcp-start — полная инструкция.\n')
  console.log('   Скопируйте .cursor/commands/visbug-mcp-start.md в корень вашего проекта.\n')
  console.log('Готово.\n')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
