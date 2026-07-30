/**
 * Копирует команды и rules Cursor в workspace проекта (если файла ещё нет).
 */

import { existsSync, mkdirSync, copyFileSync } from 'fs'
import { join, resolve } from 'path'

const COMMAND_NAMES = ['visbug-mcp-update.md', 'visbug-mcp-start.md']
const RULE_NAMES = ['visbug-buffer-apply.mdc']

export function collectWorkspaces(config) {
  const set = new Set()
  if (config?.autoAgent?.workspace) {
    set.add(resolve(config.autoAgent.workspace))
  }
  for (const project of config?.projects ?? []) {
    if (project?.workspace) set.add(resolve(project.workspace))
  }
  return [...set]
}

/**
 * @param {string} workspace
 * @param {string} repoRoot
 * @param {{ log?: boolean }} [opts]
 */
export function syncWorkspaceCursorArtifacts(workspace, repoRoot, opts = {}) {
  const log = opts.log ?? false
  if (!workspace || !existsSync(workspace)) return { commands: 0, rules: 0 }

  let commands = 0
  let rules = 0

  const cmdDir = join(workspace, '.cursor', 'commands')
  mkdirSync(cmdDir, { recursive: true })
  for (const name of COMMAND_NAMES) {
    const src = join(repoRoot, '.cursor', 'commands', name)
    const dest = join(cmdDir, name)
    if (!existsSync(src)) continue
    if (!existsSync(dest)) {
      copyFileSync(src, dest)
      commands += 1
      if (log) console.log(`✅ Команда /${name.replace('.md', '')} → ${dest}`)
    } else if (log) {
      console.log(`○ Команда уже есть: ${dest}`)
    }
  }

  const rulesDir = join(workspace, '.cursor', 'rules')
  mkdirSync(rulesDir, { recursive: true })
  for (const name of RULE_NAMES) {
    const src = join(repoRoot, '.cursor', 'rules', name)
    const dest = join(rulesDir, name)
    if (!existsSync(src)) continue
    if (!existsSync(dest)) {
      copyFileSync(src, dest)
      rules += 1
      if (log) console.log(`✅ Rule ${name} → ${dest}`)
    } else if (log) {
      console.log(`○ Rule уже есть: ${dest}`)
    }
  }

  return { commands, rules }
}

export function syncAllWorkspaceCursorArtifacts(config, repoRoot, opts = {}) {
  const totals = { commands: 0, rules: 0, workspaces: 0 }
  for (const workspace of collectWorkspaces(config)) {
    const r = syncWorkspaceCursorArtifacts(workspace, repoRoot, opts)
    totals.commands += r.commands
    totals.rules += r.rules
    totals.workspaces += 1
  }
  return totals
}
