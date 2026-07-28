import { basename } from 'path'

export function normalizeOrigin(value) {
  try {
    const url = new URL(String(value).trim())
    if (!['http:', 'https:'].includes(url.protocol)) return ''
    return url.origin.toLowerCase()
  } catch {
    return ''
  }
}

function normalizeProject(project) {
  const workspace = String(project?.workspace ?? '').trim()
  if (!workspace) return null
  const origins = [...new Set(
    (Array.isArray(project.origins) ? project.origins : [])
      .map(normalizeOrigin)
      .filter(Boolean),
  )]
  return {
    id: String(project.id ?? workspace).trim(),
    name: String(project.name ?? basename(workspace)).trim() || basename(workspace),
    workspace,
    origins,
    kind: String(project.kind ?? ''),
    startCommand: String(project.startCommand ?? ''),
  }
}

export function getProjects(config = {}) {
  const configured = (Array.isArray(config.projects) ? config.projects : [])
    .map(normalizeProject)
    .filter(Boolean)
  if (configured.length > 0) return configured

  const legacyWorkspace = String(config.autoAgent?.workspace ?? '').trim()
  if (!legacyWorkspace) return []
  return [{
    id: 'legacy-default',
    name: basename(legacyWorkspace),
    workspace: legacyWorkspace,
    origins: [],
  }]
}

export function resolveProjectForUrl(config, url) {
  const origin = normalizeOrigin(url)
  if (!origin) return { project: null, origin: '', reason: 'invalid-origin' }
  const project = getProjects(config).find((candidate) => candidate.origins.includes(origin)) ?? null
  return { project, origin, reason: project ? '' : 'origin-unmapped' }
}
