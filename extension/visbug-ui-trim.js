/**
 * Убирает шумный UI нативного VisBug во время записи моста.
 * Фиолетовая плашка = visbug-label (tag + #id + .классы) — для dev, не для вёрстки.
 */

const VISBUG_UI_TRIM_BUILD = 1
const STYLE_ID = 'visbug-mcp-hide-visbug-labels'

globalThis.VisbugMcpUiTrim?.uninstall?.()

globalThis.VisbugMcpUiTrim = {
  build: VISBUG_UI_TRIM_BUILD,
  install() {
    if (document.getElementById(STYLE_ID)) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.setAttribute('data-visbug-mcp', 'ui-trim')
    style.textContent = `
      /* Селектор VisBug — не наш overlay */
      visbug-label {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
        opacity: 0 !important;
      }
    `
    document.documentElement.appendChild(style)
  },
  uninstall() {
    document.getElementById(STYLE_ID)?.remove()
  },
}
