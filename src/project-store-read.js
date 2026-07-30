/**
 * Чтение буфера проекта (recorder-only).
 */

import { loadProjectStore } from './project-store.js'

export { loadProjectStore }

export function getLegacyChanges(store) {
  return Array.isArray(store?.changes) ? store.changes : []
}
