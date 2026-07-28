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
import { buildActionsPayload } from './actions/export.js'
import { applyStoreActions } from './actions/apply-pipeline.js'
import { loadConfig } from './config.js'
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

function resolveWorkspace(store, override) {
  const fromArg = String(override ?? '').trim()
  if (fromArg) return fromArg
  const fromStore = String(store.workspace ?? '').trim()
  if (fromStore) return fromStore
  return String(loadConfig().autoAgent?.workspace ?? '').trim()
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

function jsonToolResult(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] }
}

// ─── MCP ──────────────────────────────────────────────────────────────────────

const mcpServer = new Server(
  { name: 'visbug-mcp', version: PACKAGE_VERSION },
  { capabilities: { tools: {} } },
)

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'get_actions',
      description:
        'Actions v2 (канон v1.0): JSON с pending MOVE/STYLE/TEXT/ATTRIBUTE, workspace, summary. '
        + 'Предпочитай этот инструмент вместо get_changes.',
      inputSchema: {
        type: 'object',
        properties: {
          includeApplied: {
            type: 'boolean',
            description: 'Включить уже применённые actions (по умолчанию false).',
          },
        },
      },
    },
    {
      name: 'apply_actions',
      description:
        'Применить pending actions в файлы workspace (auto-apply). '
        + 'По actionIds, indices или все pending. markOnly=true — только пометить в буфере.',
      inputSchema: {
        type: 'object',
        properties: {
          actionIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'UUID actions из get_actions. Пусто = все pending.',
          },
          indices: {
            type: 'array',
            items: { type: 'number' },
            description: 'Индексы pending actions [0] из summary get_actions.',
          },
          workspace: {
            type: 'string',
            description: 'Абсолютный путь проекта. По умолчанию store.workspace или config autoAgent.workspace.',
          },
          markOnly: {
            type: 'boolean',
            description: 'Только пометить applied в буфере, файлы не трогать.',
          },
        },
      },
    },
    {
      name: 'get_changes',
      description:
        '[legacy] Текстовый summary. Используй get_actions для структурированного JSON.',
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
        '[legacy] Помечает actions applied в буфере без записи в файлы. '
        + 'Для записи в файлы — apply_actions.',
      inputSchema: {
        type: 'object',
        properties: {
          ids: {
            type: 'array',
            items: { type: 'number' },
            description: 'Индексы в store.actions (не pending). Пусто = все pending.',
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

  if (name === 'get_actions') {
    const store = readStore()
    const payload = buildActionsPayload(store, {
      includeApplied: Boolean(args?.includeApplied),
    })
    return jsonToolResult(payload)
  }

  if (name === 'apply_actions') {
    const store = readStore()
    const workspace = resolveWorkspace(store, args?.workspace)
    const result = applyStoreActions(store, workspace, {
      actionIds: args?.actionIds,
      indices: args?.indices,
      markOnly: Boolean(args?.markOnly),
    })
    writeStore(result.store)
    return jsonToolResult({
      ok: result.ok,
      workspace,
      applied: result.applied,
      marked: result.marked ?? 0,
      skipped: result.skipped ?? 0,
      artifacts: result.artifacts ?? 0,
      files: result.files ?? [],
      writes: result.writes ?? [],
      failed: result.failed ?? [],
      summary: result.summary,
      pendingCount: result.store.actions.filter((a) => !a.applied).length,
    })
  }

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
