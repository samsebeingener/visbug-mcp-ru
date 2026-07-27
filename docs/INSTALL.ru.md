# Установка VisBug MCP Bridge (полный стек)

Репозиторий: https://github.com/samsebeingener/visbug-mcp-ru

В Cursor откройте этот репо или выполните команду **`/visbug-mcp-start`** — агент проведёт по шагам.

## Быстрый старт

```bash
git clone https://github.com/samsebeingener/visbug-mcp-ru.git
cd visbug-mcp-ru
npm install
npm run setup
```

`npm run setup` спросит:
- путь к **вашему проекту сайта** (workspace для auto-agent);
- включить ли **auto-agent** (после «Стоп» в popup Cursor CLI применяет правки сам).

## Что установить вручную

1. **VisBug** — [Chrome Web Store](https://chromewebstore.google.com/detail/visbug/cdockenadnadldjbbgcallicgledbeoc)
2. **Расширение visbug-mcp** — `chrome://extensions` → распакованное → папка `extension/` этого репо
3. **Cursor CLI** — для auto-agent: [cursor.com/docs/cli](https://cursor.com/docs/cli/overview) → `agent login`
4. **Reload Window** в Cursor после setup

## Команда в проекте сайта

Скопируйте в корень **вашего** фронтенд-проекта:

```
visbug-mcp-ru/.cursor/commands/visbug-mcp-start.md
  → your-site/.cursor/commands/visbug-mcp-start.md
```

## Проверка

```bash
npm run health
```

Popup: зелёная точка = демон online.

## Auto-agent

Конфиг: `~/.visbug-mcp/config.json`  
Лог: `~/.visbug-mcp/agent-runs.log`

После «Стоп» в записи headless `agent` читает `get_changes` и правит файлы в workspace.

## Ежедневно

dev-сервер → VisBug → popup **Начать запись** → правки → **Стоп** → (auto) или `get_changes` в Cursor.
