/**
 * server.js — MCP-сервер (stdio), модель mambari.
 *
 * Только буфер: get_changes / apply_changes / clear_changes.
 * Файлы проекта не меняет — правки вносит пользователь через Cursor.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { formatChangesFromStore } from './parser.js'
import { compileChangesToActions } from './actions/compile.js'
import { STORE_VERSION } from './actions/schema.js'
import { loadConfig } from './config.js'
import {
  ensureProjectsRoot,
  getProjectStorePath,
  migrateLegacyGlobalStore,
  resolveProjectId,
  sanitizeProjectId,
} from './project-store.js'
import { getLegacyChanges, loadProjectStore } from './project-store-read.js'
import { PACKAGE_VERSION } from './version.js'

ensureProjectsRoot()
migrateLegacyGlobalStore(loadConfig())

function resolveContext(args = {}) {
  const config = loadConfig()
  const projectId = sanitizeProjectId(resolveProjectId({
    projectId: args?.projectId,
    workspace: args?.workspace,
  }, config))
  return { config, projectId, path: getProjectStorePath(projectId) }
}

function readChanges(args = {}) {
  const { path, projectId } = resolveContext(args)
  if (!existsSync(path)) return { projectId, changes: [] }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    if (Array.isArray(raw.changes)) {
      return { projectId, changes: raw.changes }
    }
    return { projectId, changes: getLegacyChanges(loadProjectStore(projectId)) }
  } catch {
    return { projectId, changes: [] }
  }
}

function writeChanges(projectId, changes, workspace = null) {
  const path = getProjectStorePath(projectId)
  const pending = changes.filter((c) => !c.applied)
  writeFileSync(path, JSON.stringify({
    version: STORE_VERSION,
    changes,
    actions: compileChangesToActions(pending),
    workspace,
    projectId: sanitizeProjectId(projectId),
  }, null, 2), 'utf8')
}

const mcpServer = new Server(
  { name: 'visbug-mcp', version: PACKAGE_VERSION },
  { capabilities: { tools: {} } },
)

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'get_changes',
      description:
        'Возвращает захваченные правки VisBug (селектор, свойство, старое/новое значение, tag, url). '
        + 'Для ручного применения через Cursor — не пишет в файлы.',
      inputSchema: {
        type: 'object',
        properties: {
          filter: {
            type: 'string',
            description: 'Фильтр: "style" | "attribute" | "text" | "node-added" | "node-removed". Необязательно.',
          },
          projectId: { type: 'string', description: 'ID проекта из config.json.' },
          workspace: { type: 'string', description: 'Путь workspace для выбора project store.' },
        },
      },
    },
    {
      name: 'apply_changes',
      description: 'Помечает правки как применённые после записи в исходники (Cursor Agent).',
      inputSchema: {
        type: 'object',
        properties: {
          ids: {
            type: 'array',
            items: { type: 'number' },
            description: 'Индексы в буфере. Пусто = все pending.',
          },
          projectId: { type: 'string' },
          workspace: { type: 'string' },
        },
      },
    },
    {
      name: 'clear_changes',
      description: 'Полностью очищает буфер правок текущего проекта.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          workspace: { type: 'string' },
        },
      },
    },
  ],
}))

mcpServer.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params

  if (name === 'get_changes') {
    const { projectId, changes } = readChanges(args)
    let pending = changes.filter((c) => !c.applied)
    if (args?.filter) pending = pending.filter((c) => c.type === args.filter)
    const { path } = resolveContext(args)
    let workspace = null
    if (existsSync(path)) {
      try {
        workspace = JSON.parse(readFileSync(path, 'utf8')).workspace ?? null
      } catch {}
    }
    const text = pending.length === 0
      ? 'Нет правок.'
      : formatChangesFromStore(pending, { workspace })
    return { content: [{ type: 'text', text: `projectId: ${projectId}\n\n${text}` }] }
  }

  if (name === 'apply_changes') {
    const { projectId, changes } = readChanges(args)
    const ids = args?.ids
    let marked = 0
    if (!ids || ids.length === 0) {
      changes.forEach((c) => {
        if (!c.applied) {
          c.applied = true
          marked++
        }
      })
    } else {
      ids.forEach((i) => {
        if (changes[i] && !changes[i].applied) {
          changes[i].applied = true
          marked++
        }
      })
    }
    writeChanges(projectId, changes)
    return { content: [{ type: 'text', text: `Помечено как применённое: ${marked} правок` }] }
  }

  if (name === 'clear_changes') {
    const { projectId } = readChanges(args)
    const count = readChanges(args).changes.length
    writeChanges(projectId, [])
    return { content: [{ type: 'text', text: `Буфер очищен (${count} правок удалено)` }] }
  }

  throw new Error(`Неизвестный инструмент: ${name}`)
})

const transport = new StdioServerTransport()
await mcpServer.connect(transport)
process.stderr.write('[visbug-mcp] MCP server ready (stdio)\n')
