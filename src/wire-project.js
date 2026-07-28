/**
 * Регистрация проекта: zero-config — сайт пользователя не трогаем.
 */

import { existsSync } from 'fs'
import { join } from 'path'
import { detectWorkspaceLayout } from './auto-apply.js'

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
      instrumentation: 'extension-runtime',
      siteChangesRequired: false,
      userMessage:
        'Next/React: расширение само проставит data-visbug-src в dev (npm run dev). '
        + 'Правки в next.config и Babel не нужны.',
    }
  }

  if (layout === 'static-html') {
    return {
      layout: 'static-html',
      instrumentation: 'selector',
      siteChangesRequired: false,
      userMessage: 'Static HTML: правки пишутся в index.html / <style> по селектору.',
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
