#!/usr/bin/env node
import { loadConfig, getConfigPath } from '../src/config.js'
import { resolveAgentCommand } from '../src/cli-resolver.js'
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const config = loadConfig()
const cli = resolveAgentCommand(config)
const mcpPath = join(homedir(), '.cursor', 'mcp.json')
let mcpOk = false
try {
  const mcp = JSON.parse(readFileSync(mcpPath, 'utf8'))
  const servers = mcp.mcpServers ?? mcp
  const entry = servers['visbug-mcp']
  mcpOk = Boolean(entry?.args?.some?.((a) => String(a).includes('server.js')))
} catch {}

const lines = [
  'VisBug MCP — health check',
  `config: ${getConfigPath()}`,
  `daemon: проверьте popup (зелёная точка) или ws://127.0.0.1:4844`,
  `mcp.json visbug-mcp: ${mcpOk ? 'OK' : 'НЕТ'}`,
  `cursor cli (${cli.command}): ${cli.ok ? 'OK' : 'НЕТ'}`,
  `auto-agent: ${config.autoAgent?.enabled ? 'ВКЛ' : 'ВЫКЛ'}`,
  `workspace: ${config.autoAgent?.workspace || '(не задан)'}`,
  `repoRoot: ${config.repoRoot || '(не задан)'}`,
]

if (config.autoAgent?.workspace && !existsSync(config.autoAgent.workspace)) {
  lines.push('⚠️  workspace не существует на диске')
}

console.log(lines.join('\n'))
