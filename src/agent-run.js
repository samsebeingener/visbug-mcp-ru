import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { isAbsolute, join, relative, resolve } from 'path'
import { randomUUID } from 'crypto'
import { getStoreDir } from './config.js'

function getRunsDir() {
  const dir = join(getStoreDir(), 'runs')
  mkdirSync(dir, { recursive: true })
  return dir
}

function getPacketPath(runId) {
  return join(getRunsDir(), `${runId}.json`)
}

function getCompletionPath(runId) {
  return join(getRunsDir(), `${runId}.completed.json`)
}

export function createAgentRun({ workspace, url, changes, project = null, server = null }) {
  const runId = randomUUID()
  const packet = {
    runId,
    createdAt: new Date().toISOString(),
    workspace,
    url,
    project: project ? { id: project.id, name: project.name, kind: project.kind ?? '' } : null,
    server: server ? { origin: server.origin ?? '', profile: server.profile ?? '' } : null,
    changes: changes.map((change, index) => ({ index, change })),
  }
  const path = getPacketPath(runId)
  writeFileSync(path, JSON.stringify(packet, null, 2), 'utf8')
  return { runId, path, completionPath: getCompletionPath(runId) }
}

export function completeAgentRun({ runId, appliedIds, files }) {
  const packetPath = getPacketPath(runId)
  if (!existsSync(packetPath)) throw new Error(`run не найден: ${runId}`)
  const packet = JSON.parse(readFileSync(packetPath, 'utf8'))
  const validIds = new Set(packet.changes.map(({ index }) => index))
  const applied = [...new Set(appliedIds)].filter((id) => validIds.has(id))
  const workspace = resolve(packet.workspace)
  const safeFiles = [...new Set(files.map(String).filter(Boolean))].filter((file) => {
    const resolved = resolve(isAbsolute(file) ? file : join(workspace, file))
    const relativePath = relative(workspace, resolved)
    return relativePath && !relativePath.startsWith('..') && !isAbsolute(relativePath)
  })
  const completion = {
    runId,
    completedAt: new Date().toISOString(),
    appliedIds: applied,
    files: safeFiles,
  }
  writeFileSync(getCompletionPath(runId), JSON.stringify(completion, null, 2), 'utf8')
  return completion
}

export function readAgentRunCompletion(run) {
  if (!existsSync(run.completionPath)) return null
  try {
    const completion = JSON.parse(readFileSync(run.completionPath, 'utf8'))
    if (completion.runId !== run.runId || !Array.isArray(completion.appliedIds) || !Array.isArray(completion.files)) {
      return null
    }
    return completion
  } catch {
    return null
  }
}
