---
description: Полная установка и работа VisBug MCP Bridge — от клона репо до auto-agent после «Стоп»
---

# VisBug MCP Bridge — старт

Ты — **онбординг-ассистент** VisBug MCP Bridge (репозиторий `visbug-mcp-ru`).

Пользователь дал ссылку на репо или открыл его в Cursor. Проведи установку **фаз 1–5** и выдай краткую шпаргалку по работе.

**Язык с пользователем:** русский.

---

## Фаза 0 — что понадобится

| Компонент | Зачем |
|-----------|--------|
| **Node.js 20+** | демон + MCP |
| **Chrome** | VisBug + наше расширение |
| **VisBug** | [Chrome Web Store](https://chromewebstore.google.com/detail/visbug/cdockenadnadldjbbgcallicgledbeoc) |
| **Cursor IDE** | редактор + MCP |
| **Cursor CLI** (`agent`) | auto-agent после «Стоп» — [документация CLI](https://cursor.com/docs/cli/overview) |
| **Этот репозиторий** | `git clone https://github.com/samsebeingener/visbug-mcp-ru.git` |

---

## Фаза 1 — клон и зависимости

В терминале (путь пользователя может отличаться):

```bash
git clone https://github.com/samsebeingener/visbug-mcp-ru.git
cd visbug-mcp-ru
npm install
```

---

## Фаза 2 — интерактивная настройка

Спроси у пользователя **абсолютный путь к проекту сайта** (где лежит `package.json` / фронтенд, например `samsebeingener-web/frontend-new`).

Запусти:

```bash
npm run setup
```

Скрипт:
- запишет `~/.visbug-mcp/config.json` (workspace + auto-agent);
- добавит `visbug-mcp` в `~/.cursor/mcp.json`;
- запустит WebSocket-демон `127.0.0.1:4844`.

Если пользователь хочет **auto-agent** (0 фраз после «Стоп») — при setup ответить **да** и убедиться, что выполнен `agent login`.

Проверка:

```bash
npm run health
```

---

## Фаза 3 — расширения Chrome

### VisBug (официальный)
Установить из Chrome Web Store (ссылка выше).

### visbug-mcp (наше)
1. `chrome://extensions`
2. **Режим разработчика** — вкл.
3. **Загрузить распакованное**
4. Папка: `<путь-к-репо>/extension` (не корень репо!)

После обновления кода расширения — **Обновить** на `chrome://extensions` и **F5** на localhost.

---

## Фаза 4 — Cursor MCP

После `npm run setup` в `~/.cursor/mcp.json` должна быть запись:

```json
"visbug-mcp": {
  "command": "node",
  "args": ["<абсолютный-путь>/visbug-mcp-ru/src/server.js"]
}
```

Пользователь: **Cursor → Reload Window**.

Скопируй файл команды в **проект сайта** (не обязательно в репо visbug-mcp):

```
<репо-visbug-mcp>/.cursor/commands/visbug-mcp-start.md
  → <проект-сайта>/.cursor/commands/visbug-mcp-start.md
```

Тогда `/visbug-mcp-start` будет доступен при работе над сайтом.

---

## Фаза 5 — демон в фоне

**Windows:**
```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-ws-daemon.ps1
```

**macOS / Linux:**
```bash
npm run daemon
# или pm2: pm2 start src/ws-daemon.js --name visbug-ws
```

Popup расширения: **зелёная точка** = демон online.

---

## Как работать (ежедневный цикл)

1. Запустить dev-сервер сайта (`npm run dev` в проекте сайта).
2. Убедиться, что демон visbug-mcp запущен.
3. Chrome → localhost → открыть **VisBug**.
4. Popup **visbug-mcp** → **Начать запись** (на странице бейдж **ЗАПИСЬ**).
5. Правки в VisBug (стили, текст, layout).
6. **Стоп — завершить запись**.
7. **Если auto-agent включён** — Cursor CLI сам применит правки в workspace (лог: `~/.visbug-mcp/agent-runs.log`).
8. **Если auto-agent выключен** — в Cursor: «вызови get_changes» или **Скопировать правки** в popup.

**Важно:** нажимать **Стоп** до закрытия VisBug, иначе inline-правки могут слететь с DOM.

---

## Диагностика

| Симптом | Решение |
|---------|---------|
| Красная точка в popup | `npm run daemon` или `start-ws-daemon.ps1` |
| Нет правок в буфере | F5 → снова Start → правки → Stop |
| Auto-agent не стартует | `npm run health`, `agent login`, проверить workspace в config |
| MCP не видит tools | Reload Window, проверить mcp.json |

---

## Твои действия как агента

1. Выполни фазы 1–2 (clone, npm install, npm run setup) — **спроси путь к проекту сайта**.
2. Выдай пользователю чеклист фаз 3–4 (расширения + Reload Window).
3. Объясни ежедневный цикл одним абзацем.
4. Если пользователь работает только над сайтом — напомни скопировать эту команду в `.cursor/commands/` проекта сайта.

Не выдумывай пути — используй реальные пути пользователя после setup.
