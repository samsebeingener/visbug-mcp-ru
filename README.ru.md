# VisBug MCP Bridge (кратко)

Полное описание — в [README.md](./README.md).

Мост **VisBug → Cursor**: запись на `localhost`, Actions v2, auto-apply в React/static HTML.

## Быстрый старт

```powershell
npm install
npm run setup
powershell -ExecutionPolicy Bypass -File scripts/start-ws-daemon.ps1
```

Chrome → `chrome://extensions` → **Загрузить распакованное** → папка `extension/`.

Cursor → Reload Window (MCP: `get_actions`, `apply_actions`).

---

**Никита Куликов** · [samsebeingener.ru](https://samsebeingener.ru)

История: форк [mambari/visbug-mcp](https://github.com/mambari/visbug-mcp) → самостоятельный продукт.
