# Форк visbug-mcp-ru

- **Upstream:** https://github.com/mambari/visbug-mcp
- **Origin:** https://github.com/samsebeingener/visbug-mcp-ru
- **Локальный путь:** `C:\Users\nkoul\OneDrive\Документы\Cursor\projects\visbug-mcp-ru`
- **Версия:** 0.2.0 (режим «Запись», snapshot до/после)
- **Изменения:** русский UI (popup, MCP, формат diff), фильтры шума, запись правок

## Работа с репозиторием

```powershell
cd "C:\Users\nkoul\OneDrive\Документы\Cursor\projects\visbug-mcp-ru"
npm install
powershell -ExecutionPolicy Bypass -File scripts/start-ws-daemon.ps1
```

Cursor MCP (`~/.cursor/mcp.json`) → `projects/visbug-mcp-ru/src/server.js` → **Reload Window**.

После обновления extension в Chrome: **Обновить** на `chrome://extensions` (папка `extension/` в этом репо).
