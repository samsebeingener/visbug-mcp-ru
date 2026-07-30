#!/usr/bin/env node
import WebSocket from 'ws'
import { loadConfig, getConfigPath } from '../src/config.js'
import { PACKAGE_VERSION } from '../src/version.js'
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

function pingDaemon(timeoutMs = 2500) {
  return new Promise((resolve) => {
    const ws = new WebSocket('ws://127.0.0.1:4844')
    const timer = setTimeout(() => {
      try { ws.terminate() } catch {}
      resolve(false)
    }, timeoutMs)
    ws.once('open', () => {
      clearTimeout(timer)
      ws.close()
      resolve(true)
    })
    ws.once('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
  })
}

const config = loadConfig()
const mcpPath = join(homedir(), '.cursor', 'mcp.json')
let mcpOk = false
try {
  const mcp = JSON.parse(readFileSync(mcpPath, 'utf8'))
  const servers = mcp.mcpServers ?? mcp
  const entry = servers['visbug-mcp']
  mcpOk = Boolean(entry?.args?.some?.((a) => String(a).includes('server.js')))
} catch {}

const daemonOk = await pingDaemon()
const workspace = config.autoAgent?.workspace || config.projects?.[0]?.workspace || ''

const lines = [
  'VisBug Bridge — health check',
  `version: ${PACKAGE_VERSION}`,
  `config: ${getConfigPath()}`,
  `daemon ws://127.0.0.1:4844: ${daemonOk ? 'OK' : 'НЕТ (npm run setup или start-ws-daemon.ps1)'}`,
  `MCP в Cursor (необязательно): ${mcpOk ? 'OK' : 'НЕТ'}`,
  `workspace: ${workspace || '(не задан)'}`,
  `repoRoot: ${config.repoRoot || '(не задан)'}`,
  `режим: recorder-only (буфер → Cursor, без auto-apply)`,
]

if (workspace && !existsSync(workspace)) {
  lines.push('⚠️  workspace не существует на диске')
}

console.log(lines.join('\n'))
process.exit(daemonOk ? 0 : 1)
