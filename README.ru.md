# VisBug MCP Bridge (кратко)

Полное описание — в [README.md](./README.md).

Мост **VisBug → Cursor**: запись на `localhost`, буфер правок → ручное применение в чате (**recorder-only**, v0.13+).

## Применение буфера в Cursor

1. Popup → **«Скопировать правки»** → вставить в чат Cursor (отдельная команда не нужна).
2. В конце буфера — подсказка агенту; rule `visbug-buffer-apply.mdc` в `.cursor/rules/` (ставится `npm run setup` / `npm run update`).
3. Полный контракт: [`shared/apply-buffer-contract.md`](./shared/apply-buffer-contract.md).

## Быстрый старт

```powershell
npm install
npm run setup
powershell -ExecutionPolicy Bypass -File scripts/start-ws-daemon.ps1
```

Chrome → `chrome://extensions` → **Загрузить распакованное** → папка `extension/`.

**v0.14:** recorder-only + `layout-delta` в буфере при отпускании drag.

---

**Никита Куликов** · [samsebeingener.ru](https://samsebeingener.ru)

История: форк [mambari/visbug-mcp](https://github.com/mambari/visbug-mcp) → самостоятельный продукт.
