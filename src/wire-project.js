/**
 * Регистрация проекта: zero-config — сайт пользователя не трогаем.
 */

import { existsSync } from 'fs'
import { join } from 'path'

/**
 * @param {string} workspace
 */
export function detectWorkspaceLayout(workspace) {
  if (!workspace || !existsSync(workspace)) return 'unknown'
  if (existsSync(join(workspace, 'package.json'))) return 'framework-src'
  if (existsSync(join(workspace, 'index.html'))) return 'static-html'
  return 'unknown'
}

/**
 * @param {string} workspace
 */
export function describeProjectInstrumentation(workspace) {
  if (!workspace || !existsSync(workspace)) {
    return {
      layout: 'unknown',
      instrumentation: 'selector',
      siteChangesRequired: false,
      userMessage: 'Проект не найден — привязка по CSS-селектору.',
    }
  }

  const layout = detectWorkspaceLayout(workspace)

  if (layout === 'framework-src') {
    const hasNext = existsSync(join(workspace, 'next.config.mjs'))
      || existsSync(join(workspace, 'next.config.js'))
      || existsSync(join(workspace, 'next.config.ts'))

    return {
      layout: hasNext ? 'nextjs' : 'react',
      instrumentation: 'selector',
      siteChangesRequired: false,
      userMessage: 'React/Next: правки вносятся вручную в Cursor по буферу VisBug.',
    }
  }

  if (layout === 'static-html') {
    return {
      layout: 'static-html',
      instrumentation: 'selector',
      siteChangesRequired: false,
      userMessage: 'Static HTML: правки в index.html / <style> по селектору из буфера.',
    }
  }

  return {
    layout: 'unknown',
    instrumentation: 'selector',
    siteChangesRequired: false,
    userMessage: 'Привязка по CSS-селектору (без изменений в коде сайта).',
  }
}

/**
 * @param {object} project
 * @param {string} workspace
 */
export function enrichProjectRegistration(project, workspace) {
  const info = describeProjectInstrumentation(workspace)
  return {
    ...project,
    kind: info.layout,
    instrumentation: info.instrumentation,
    siteChangesRequired: info.siteChangesRequired,
  }
}
