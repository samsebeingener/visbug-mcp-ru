# Форк visbug-mcp-ru

- **Upstream:** https://github.com/mambari/visbug-mcp
- **Origin:** https://github.com/samsebeingener/visbug-mcp-ru
- **Локальный путь:** `C:\Users\nkoul\OneDrive\Документы\Cursor\projects\visbug-mcp-ru`
- **Версия:** 0.6.2 (auto-apply после «Стоп», fallback LLM через `agent`, npm run setup)
- **Язык:** русский UI (popup, MCP, формат diff), фильтры шума VisBug

## Возможности (0.6.2)

- **Auto-apply после «Стоп»** — демон сам пишет правки в файлы workspace (`src/auto-apply.js`): CSS (`left`→`margin-inline-start` в `sections.css`), простой текст в `.tsx`. Без команд в чате и без LLM.
- **Fallback LLM** — если auto-apply не справился и установлен Cursor Agent CLI (`agent`), headless `agent -p` добивает остаток (`src/auto-agent.js`).
- **CLI resolver** — поиск `agent.cmd` на Windows (`%LOCALAPPDATA%\cursor-agent\`), `npm run ensure-cli`.
- **Popup health** — «Запись в файлы после Стоп»; CLI показывается как опциональный, не как ошибка.

## Возможности (0.5.x)

- **Режим «Запись»** — snapshot DOM до/после сессии VisBug на localhost; правки попадают в буфер `~/.visbug-mcp/changes.json` и в MCP `get_changes`.
- **Бейдж REC** — фиксированный индикатор на странице, пока запись активна (`recording-badge.js`).
- **Направляющие (alignment guides)** — при записи: сетка колонок в покое; при drag — тонкие красные линии (v0.4.x+) к соседним элементам и **подписи расстояния** в px (`alignment-guides.js`).
- **MCP: группировка по секциям** — вывод `get_changes` с заголовками `## #section-id` (по первому `#id` в селекторе), блок «Прочее» в конце (`parser.js`).
- **MCP: подсказки apply** — под строками правок: артефакты VisBug (cursor/position/transition), замена `left`/`top` на margin в grid-контексте, указание `sections.css` где уместно.
- **Popup** — индикатор REC в шапке, пошаговые подсказки, копирование буфера, очистка.

## История версий

| Версия | Суть |
|--------|------|
| 0.1.x | Русский MCP-мост, формат правок, фильтр шума hero/glow/drag |
| 0.2.0 | Режим «Запись», snapshot до/после |
| 0.3.1 | Полностраничный snapshot, надёжный stop/start, меньше шума |
| 0.4.0 | Figma-like направляющие при записи |
| 0.4.x | Тонкие красные линии при выравнивании, подписи gap, доработка сетки |
| **0.6.2** | Auto-apply в файлы без LLM; popup health; CLI опционален |
| **0.6.1** | `auto-apply.js`, `ensure-agent-cli`, setup без обязательного CLI |
| **0.6.0** | auto-agent, `npm run setup`, захват текста, `/visbug-mcp-start` |
| **0.5.2** | Захват текста: h1–h6, p, span, a, contenteditable; text-watch только при записи; подсказки apply для текста |
| **0.5.0** | REC-бейдж на странице, bundle направляющих + parser (секции + apply hints), версии extension/npm 0.5.0 |

## Работа с репозиторием

```powershell
cd "C:\Users\nkoul\OneDrive\Документы\Cursor\projects\visbug-mcp-ru"
npm install
powershell -ExecutionPolicy Bypass -File scripts/start-ws-daemon.ps1
```

Cursor MCP (`~/.cursor/mcp.json`) → `projects/visbug-mcp-ru/src/server.js` → **Reload Window**.

После обновления extension в Chrome: **Обновить** на `chrome://extensions` (папка `extension/` в этом репо).

## Заметки релиза 0.5.0

- Инструменты MCP в Cursor по-прежнему три: `get_changes`, `apply_changes`, `clear_changes`; группировка и подсказки — в **тексте** ответа `get_changes`, не в отдельных tool annotations.
- Если параллельные правки не попали в коммит: проверьте `git status` (ожидаемые файлы: `extension/*`, `src/parser.js`, `FORK.ru.md`, `package.json`).