/**
 * server.js — MCP-сервер (stdio)
 *
 * Запускается Cursor по запросу.
 * Читает и пишет ~/.visbug-mcp/changes.json.
 * WebSocket — отдельно в ws-daemon.js.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { formatChangesFromStore } from './parser.js'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const STORE_DIR = join(homedir(), '.visbug-mcp')
const STORE_FILE = join(STORE_DIR, 'changes.json')

function readStore() {
  try {
    mkdirSync(STORE_DIR, { recursive: true })
    const data = JSON.parse(readFileSync(STORE_FILE, 'utf8'))
    return data.changes ?? []
  } catch {
    return []
  }
}

function writeStore(changes) {
  mkdirSync(STORE_DIR, { recursive: true })
  writeFileSync(STORE_FILE, JSON.stringify({ changes }, null, 2))
}

// ─── MCP ──────────────────────────────────────────────────────────────────────

const mcpServer = new Server(
  { name: 'visbug-mcp', version: '0.1.0' },
  { capabilities: { tools: {} } }
)

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'get_changes',
      description:
        'Возвращает визуальные правки, захваченные VisBug на localhost. '
        + 'Для каждой записи: CSS-селектор, свойство, старое и новое значение, HTML-тег, URL страницы.',
      inputSchema: {
        type: 'object',
        properties: {
          filter: {
            type: 'string',
            description: 'Фильтр по типу: "style" | "attribute" | "text" | "node-added" | "node-removed". Необязательно.',
          },
        },
      },
    },
    {
      name: 'apply_changes',
      description: 'Помечает правки как применённые после записи в исходники.',
      inputSchema: {
        type: 'object',
        properties: {
          ids: {
            type: 'array',
            items: { type: 'number' },
            description: 'Индексы правок для пометки. Пусто = все.',
          },
        },
      },
    },
    {
      name: 'clear_changes',
      description: 'Полностью очищает буфер захваченных правок.',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
}))

mcpServer.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params

  if (name === 'get_changes') {
    const changes = readStore()
    const filter = args?.filter
    const hasPending = changes.some(c => !c.applied && (!filter || c.type === filter))
    const text = hasPending ? formatChangesFromStore(changes, { type: filter }) : 'Нет правок.'
    return { content: [{ type: 'text', text }] }
  }

  if (name === 'apply_changes') {
    const changes = readStore()
    const ids = args?.ids
    if (!ids || ids.length === 0) {
      changes.forEach(c => { c.applied = true })
    } else {
      ids.forEach(i => { if (changes[i]) changes[i].applied = true })
    }
    writeStore(changes)
    return { content: [{ type: 'text', text: `Помечено как применённое: ${ids?.length ?? changes.length} правок` }] }
  }

  if (name === 'clear_changes') {
    const changes = readStore()
    const count = changes.length
    writeStore([])
    return { content: [{ type: 'text', text: `Буфер очищен (удалено правок: ${count})` }] }
  }

  throw new Error(`Неизвестный инструмент: ${name}`)
})

const transport = new StdioServerTransport()
await mcpServer.connect(transport)
process.stderr.write('[visbug-mcp] MCP server ready (stdio)\n')