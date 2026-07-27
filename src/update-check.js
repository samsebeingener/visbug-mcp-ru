/**
 * Проверка обновлений visbug-mcp-ru (не чаще раза в сутки).
 * Вызывается при «Начать запись»; changelog — с GitHub compare / release.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { getStoreDir } from './config.js'

const DAY_MS = 24 * 60 * 60 * 1000
const GITHUB_REPO = 'samsebeingener/visbug-mcp-ru'
const REMOTE_PACKAGE_URL =
  `https://raw.githubusercontent.com/${GITHUB_REPO}/main/package.json`
const STATE_FILE = () => join(getStoreDir(), 'update-check.json')

function readState() {
  try {
    if (existsSync(STATE_FILE())) {
      return JSON.parse(readFileSync(STATE_FILE(), 'utf8'))
    }
  } catch {}
  return {}
}

function writeState(state) {
  mkdirSync(getStoreDir(), { recursive: true })
  writeFileSync(STATE_FILE(), JSON.stringify(state, null, 2), 'utf8')
}

function parseSemver(v) {
  return String(v ?? '')
    .replace(/^v/i, '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0)
}

export function semverGt(a, b) {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x > y) return true
    if (x < y) return false
  }
  return false
}

function readLocalVersion(repoRoot) {
  try {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
    return String(pkg.version ?? '0.0.0')
  } catch {
    return '0.0.0'
  }
}

async function fetchRemoteVersion() {
  const res = await fetch(REMOTE_PACKAGE_URL, {
    headers: { Accept: 'application/json', 'User-Agent': 'visbug-mcp-update-check' },
    signal: AbortSignal.timeout(12_000),
  })
  if (!res.ok) throw new Error(`remote package.json HTTP ${res.status}`)
  const pkg = await res.json()
  return String(pkg.version ?? '0.0.0')
}

async function fetchChangelog(current, latest) {
  const lines = []
  try {
    const releaseRes = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/tags/v${latest}`,
      {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'visbug-mcp-update-check' },
        signal: AbortSignal.timeout(12_000),
      },
    )
    if (releaseRes.ok) {
      const release = await releaseRes.json()
      const body = String(release.body ?? '').trim()
      if (body) return body.slice(0, 1200)
    }
  } catch {}

  try {
    const compareRes = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/compare/v${current}...main`,
      {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'visbug-mcp-update-check' },
        signal: AbortSignal.timeout(12_000),
      },
    )
    if (compareRes.ok) {
      const data = await compareRes.json()
      for (const c of (data.commits ?? []).slice(0, 12)) {
        const msg = String(c.commit?.message ?? '').split('\n')[0].trim()
        if (msg) lines.push(`• ${msg}`)
      }
    }
  } catch {}

  if (lines.length === 0) {
    return `Доступна версия ${latest} (у вас ${current}). Подробности: /visbug-mcp-update в Cursor.`
  }
  return lines.join('\n')
}

function shouldFetchRemote(state) {
  const last = state.lastCheckedAt ? Date.parse(state.lastCheckedAt) : 0
  return !last || Date.now() - last >= DAY_MS
}

function shouldNotify(state, pending) {
  if (!pending?.latest) return false
  const lastShown = state.lastShownAt ? Date.parse(state.lastShownAt) : 0
  if (state.lastShownVersion === pending.latest && lastShown && Date.now() - lastShown < DAY_MS) {
    return false
  }
  return semverGt(pending.latest, pending.current)
}

/**
 * @param {{ repoRoot?: string }} config
 * @returns {Promise<{
 *   checked: boolean,
 *   updateAvailable: boolean,
 *   notify: boolean,
 *   current?: string,
 *   latest?: string,
 *   changelog?: string,
 * }>}
 */
export async function checkForUpdatesIfDue(config) {
  const repoRoot = config?.repoRoot
  if (!repoRoot || !existsSync(join(repoRoot, 'package.json'))) {
    return { checked: false, updateAvailable: false, notify: false }
  }

  const current = readLocalVersion(repoRoot)
  let state = readState()
  let pending = state.pendingUpdate ?? null

  if (shouldFetchRemote(state)) {
    try {
      const latest = await fetchRemoteVersion()
      state = {
        ...state,
        lastCheckedAt: new Date().toISOString(),
      }
      if (semverGt(latest, current)) {
        const changelog = await fetchChangelog(current, latest)
        pending = { current, latest, changelog, checkedAt: state.lastCheckedAt }
        state.pendingUpdate = pending
      } else {
        pending = null
        state.pendingUpdate = null
      }
      writeState(state)
    } catch (err) {
      process.stderr.write(`[update-check] ${err.message}\n`)
      return {
        checked: false,
        updateAvailable: Boolean(pending && semverGt(pending.latest, pending.current)),
        notify: shouldNotify(state, pending),
        current: pending?.current ?? current,
        latest: pending?.latest,
        changelog: pending?.changelog,
      }
    }
  }

  const updateAvailable = Boolean(pending && semverGt(pending.latest, pending.current))
  const notify = updateAvailable && shouldNotify(state, pending)

  if (notify) {
    state.lastShownAt = new Date().toISOString()
    state.lastShownVersion = pending.latest
    writeState(state)
  }

  return {
    checked: true,
    updateAvailable,
    notify,
    current: pending?.current ?? current,
    latest: pending?.latest,
    changelog: pending?.changelog,
  }
}

export function clearPendingUpdate() {
  const state = readState()
  writeState({
    ...state,
    pendingUpdate: null,
    lastShownVersion: null,
  })
}
