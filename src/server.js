/**
 * server.js — MCP-сервер (stdio)
 *
 * Запускается Cursor по запросу.
 * Читает и пишет ~/.visbug-mcp/changes.json (Actions v2).
 * WebSocket — отдельно в ws-daemon.js.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { formatChangesFromStore } from './parser.js'
import {
  loadStore,
  saveStore,
  getLegacyChanges,
  getPendingChanges,
  normalizeStore,
} from './actions/store.js'
import { formatActionsForMcp } from './actions/format.js'
import { homedir } from 'os'
import { join } from 'path'
import { PACKAGE_VERSION } from './version.js'

const STORE_DIR = join(homedir(), '.visbug-mcp')
const STORE_FILE = join(STORE_DIR, 'changes.json')

function readStore() {
  try {
    return loadStore(STORE_FILE)
  } catch {
    return normalizeStore({})
  }
}

function writeStore(store) {
  saveStore(STORE_FILE, store)
}

function formatStoreText(store, filter) {
  const actionText = formatActionsForMcp(store)
  if (actionText) {
    if (!filter) return actionText
    const legacy = getLegacyChanges(store).filter((c) => !c.applied && c.type === filter)
    return legacy.length ? formatChangesFromStore(legacy, { type: filter }) : ''
  }
  const legacy = getLegacyChanges(store).filter((c) => !c.applied && (!filter || c.type === filter))
  if (!legacy.length) return ''
  return formatChangesFromStore(legacy, { type: filter })
}

// ─── MCP ──────────────────────────────────────────────────────────────────────

const mcpServer = new Server(
  { name: 'visbug-mcp', version: PACKAGE_VERSION },
  { capabilities: { tools: {} } },
)

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'get_changes',
      description:
        'Возвращает визуальные правки VisBug (Actions v2: MOVE/STYLE/TEXT). '
        + 'Для каждой записи: селектор, data-visbug-src если есть, дельта/стили, URL.',
      inputSchema: {
        type: 'object',
        properties: {
          filter: {
            type: 'string',
            description: 'Фильтр legacy-типа: "style" | "attribute" | "text". Необязательно.',
          },
        },
      },
    },
    {
      name: 'apply_changes',
      description:
        'Помечает actions как применённые в буфере (~/.visbug-mcp/changes.json). '
        + 'Файлы проекта не меняет — их пишет auto-apply после «Стоп» или вы через /visbug-apply.',
      inputSchema: {
        type: 'object',
        properties: {
          ids: {
            type: 'array',
            items: { type: 'number' },
            description: 'Индексы actions для пометки. Пусто = все pending.',
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
    const store = readStore()
    const filter = args?.filter
    const pendingCount = getPendingChanges(store).length
    const text = pendingCount === 0 ? 'Нет правок.' : (formatStoreText(store, filter) || 'Нет правок.')
    return { content: [{ type: 'text', text }] }
  }

  if (name === 'apply_changes') {
    const store = readStore()
    const ids = args?.ids
    let marked = 0

    if (!ids || ids.length === 0) {
      for (const action of store.actions) {
        if (!action.applied) {
          action.applied = true
          marked++
        }
      }
    } else {
      ids.forEach((i) => {
        if (store.actions[i] && !store.actions[i].applied) {
          store.actions[i].applied = true
          marked++
        }
      })
    }

    writeStore(store)
    return { content: [{ type: 'text', text: `Помечено как применённое: ${marked} actions` }] }
  }

  if (name === 'clear_changes') {
    const store = readStore()
    const count = store.actions.length
    writeStore(normalizeStore({}))
    return { content: [{ type: 'text', text: `Буфер очищен (удалено actions: ${count})` }] }
  }

  throw new Error(`Неизвестный инструмент: ${name}`)
})

const transport = new StdioServerTransport()
await mcpServer.connect(transport)
process.stderr.write('[visbug-mcp] MCP server ready (stdio)\n')
