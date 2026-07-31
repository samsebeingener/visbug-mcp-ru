<p align="center">
  <img src="assets/cover-banner.png" alt="VisBug MCP Bridge — обложка репозитория" width="920">
</p>

<h1 align="center">VisBug MCP Bridge</h1>

<p align="center">
  Мост <strong>VisBug → Cursor</strong>: визуальные правки на <code>localhost</code> → буфер → вставка в чат → patch в исходниках агентом Cursor.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/v0.26.4-write--recipes-зелёный?style=flat-square" alt="write-recipes">
  <img src="https://img.shields.io/badge/локально-only-зелёный?style=flat-square" alt="только локально">
  <img src="https://img.shields.io/badge/MCP-опционально-blue?style=flat-square" alt="MCP опционально">
  <img src="https://img.shields.io/badge/язык-русский-red?style=flat-square" alt="русский">
</p>

---

## Что это

**Recorder-only** (модель [mambari/visbug-mcp](https://github.com/mambari/visbug-mcp)): расширение **не пишет** в файлы проекта. VisBug меняет DOM на странице → bridge сохраняет сырые мутации → вы копируете буфер → Cursor вносит правки в код по контракту.

| Было (до v0.13) | Сейчас (v0.26) |
|-----------------|----------------|
| auto-apply, Actions v2, undo | Удалено (recorder-only) |
| «Начать запись» / «Стоп» | Не нужно — live-захват при drag |
| Только inline `top`/`left` | + **`layout-delta`** + **`visbugSrc`** / **`src:`** + per-file summary |
| Длинный селектор | Короткий селектор + **write-recipes v0.26** (`before`/`after`/`snap`) + **auto-stamp `vb-*`** |
| `/visbug-apply` | Не нужно — вставка буфера в чат |

---

## Архитектура

```
Chrome (VisBug + расширение)
        │  WebSocket ws://127.0.0.1:4844
        ▼
┌─────────────────┐      ~/.visbug-mcp/projects/<id>/changes.json
│  ws-daemon.js   │ ◄──────────────────────────────►  src/server.js (MCP stdio)
│  (фон)          │                                    └─ опционально в Cursor
└─────────────────┘
```

- **`src/ws-daemon.js`** — WebSocket на `127.0.0.1:4844`. Принимает live-мутации от content-script, дедуплирует, пишет в per-project store.
- **`src/server.js`** — MCP (stdio): `get_changes` / `apply_changes` / `clear_changes`. Запись в файлы **не выполняет**.
- **`extension/`** — Chrome MV3: observer на `localhost`, popup «Скопировать» / «Очистить», красные направляющие с px.

### Безопасность

- WebSocket только `127.0.0.1` — данные не уходят в интернет
- Store: `~/.visbug-mcp/projects/<projectId>/changes.json` на вашем ПК
- Внешних HTTP-запросов нет

---

## Установка

**Полная инструкция:** [docs/INSTALL.ru.md](docs/INSTALL.ru.md)  
**В Cursor:** `/visbug-mcp-start`

```bash
git clone https://github.com/samsebeingener/visbug-mcp-ru.git
cd visbug-mcp-ru
npm install
npm run setup
```

`npm run setup` регистрирует workspace + `localhost` origin, запускает daemon и копирует в проект:

- команды `/visbug-mcp-start`, `/visbug-mcp-update`;
- rule **`.cursor/rules/visbug-buffer-apply.mdc`** — подсказка агенту при вставке буфера.

### Расширения Chrome

1. [VisBug](https://chromewebstore.google.com/detail/visbug/cdockenadnadldjbbgcallicgledbeoc) (официальный)
2. **visbug-mcp** — `chrome://extensions` → режим разработчика → **Загрузить распакованное** → папка `extension/` в клоне репо

### Демон (если setup не запустил)

**Windows:**

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-ws-daemon.ps1
```

**macOS / Linux:**

```bash
npm run daemon
# или pm2 start src/ws-daemon.js --name visbug-ws
```

### MCP в Cursor (опционально)

`npm run setup` добавляет запись в `~/.cursor/mcp.json`. Для записи VisBug MCP **не обязателен** — достаточно popup «Скопировать».

После правок — **Reload Window** в Cursor.

### Обновление

```bash
npm run update
```

`git pull`, `npm install`, перезапуск daemon, копирование недостающих команд и rule во все workspace из config (без перезаписи существующих).

---

## Как пользоваться

### Рабочий цикл (v0.26)

1. Запустите сайт на `http://localhost:…`, откройте в Chrome.
2. Убедитесь, что origin зарегистрирован (`/visbug-mcp-start` или `npm run setup`).
3. Popup: зелёная точка = daemon online.
4. Правьте layout в **VisBug** (красные направляющие с px — в расширении).
5. Popup → **«Скопировать правки»** → вставьте в чат Cursor.
6. Агент правит исходники (см. [apply-buffer-contract](shared/apply-buffer-contract.md)).
7. Popup → **«Очистить правки»** (опционально).

Отдельная команда для apply **не нужна**.

### Как Cursor понимает буфер

| Слой | Где |
|------|-----|
| Футер в буфере | Добавляется при «Скопировать» (путь к контракту) |
| Rule | `<workspace>/.cursor/rules/visbug-buffer-apply.mdc` (из `setup` / `update`) |
| Контракт | [`shared/apply-buffer-contract.md`](shared/apply-buffer-contract.md) |

Кратко для агента: контейнер vs ребёнок, фильтр шума VisBug, **bake** `left`/`top`/`transform`, не копировать `left` 1:1 в `transform`.

### Несколько проектов

Bridge сопоставляет **точный origin** с workspace. Пример: `localhost:3001` → Next, `localhost:3002` → static HTML. Незарегистрированный origin — запись блокируется.

### Popup

| Индикатор | Значение |
|-----------|----------|
| 🟢 Bridge подключён | Можно править в VisBug |
| 🔴 Daemon не запущен | `start-ws-daemon.ps1` или `npm run daemon` |
| `N правок в буфере` | Накопленные мутации |

| Кнопка | Действие |
|--------|----------|
| **Скопировать правки** | Буфер + футер для Cursor |
| **Очистить правки** | Сброс store текущего проекта |

### MCP-инструменты (опционально)

| Инструмент | Назначение |
|------------|------------|
| `get_changes` | Текст буфера (как в popup) |
| `apply_changes` | Пометить индексы как применённые **в store** (после ручного patch в коде) |
| `clear_changes` | Очистить буфер |

Пример строки в буфере:

```
[0] section.hero-section … > h1… → стиль: left = -163px (было: не задано)
```

---

## Техническое поведение

### Live-захват + layout-delta (v0.14)

Content-script пишет inline-мутации VisBug. При **отпускании** drag дополнительно:

```text
[#method-quote] → смещение: Δx=0px Δy=-65px (viewport 1440×900)
```

Δ — разница `getBoundingClientRect()` до/после drag; не зависит от того, писал ли VisBug только `top` без `left`. Агент: [`apply-buffer-contract.md`](shared/apply-buffer-contract.md).

### Auto-stamp (v0.26)

Если у элемента, получившего записанную мутацию, нет ни `id`, ни `data-vb*`, content-script сам ставит ему `data-visbug-id="vb-<tag>-<NN>"` (например `vb-div-01`) — атрибут вне фильтра обсервера, петли нет. В буфере появляется секция `stamps:` (`vb-div-01 → исходный DOM-path`), рецепт идёт на стабильный `#vb-div-01` с confidence high и warning `stamp-pending`. При первом apply агент **обязан** перенести этот id в исходный HTML (и использовать `#vb-*` в CSS) — с этого момента цель стабильна навсегда, без ручной разметки. Подробности: §11 [`apply-buffer-contract.md`](shared/apply-buffer-contract.md).

### Store (v2)

`~/.visbug-mcp/projects/<projectId>/changes.json`:

```json
{
  "version": 2,
  "workspace": "/abs/path/to/site",
  "changes": [ … ]
}
```

### Парсер и шум

`src/parser.js` — дедуп по `selector|type|property`, фильтр overlay `#visbug-mcp-guides-root` и UI VisBug. Сырые `left`/`top`/`transform` **не переводятся** автоматически — bake делает агент по контракту.

---

## Полезные команды

```bash
npm run health          # daemon, extension version, config
npm run setup           # первичная настройка + rule в workspace
npm run update          # git pull + sync commands/rule
npm run daemon          # foreground daemon
npm run daemon:watch    # разработка с --watch
npm test                # unit-тесты
```

---

## Структура проекта

```
visbug-mcp-ru/
├── src/
│   ├── ws-daemon.js           # WebSocket, буфер
│   ├── server.js              # MCP stdio
│   ├── parser.js              # мутации → changes, формат буфера
│   ├── project-store.js       # per-project store v2
│   └── config.js
├── extension/                 # Chrome: content-script, popup, guides
├── shared/
│   └── apply-buffer-contract.md   # контракт для Cursor-агента
├── prompts/
│   └── buffer-for-cursor.md
├── .cursor/
│   ├── commands/              # visbug-mcp-start, visbug-mcp-update
│   └── rules/                 # visbug-buffer-apply.mdc → копируется в workspace
├── scripts/
│   ├── setup.mjs
│   ├── update.mjs
│   ├── sync-cursor-artifacts.mjs
│   └── start-ws-daemon.ps1
├── docs/
│   └── INSTALL.ru.md
└── test/
```

---

## Roadmap

Идеи auto-apply, layout-solver — в архиве спецификаций (не в репо). Актуальные планы: точность записи (transition, keyboard, JS-inline) и предсказуемость применения через Cursor.

---

## Что на русском

- Popup расширения
- Строки буфера («стиль», «было», «текст»)
- Описания MCP-инструментов

---

## Лицензия и upstream

Разработка [Никита Куликов](https://samsebeingener.ru) на базе идей [mambari/visbug-mcp](https://github.com/mambari/visbug-mcp).  
VisBug — [GoogleChromeLabs/ProjectVisBug](https://github.com/GoogleChromeLabs/ProjectVisBug).

---

<p align="center">
  <strong>Никита Куликов</strong><br>
  <a href="https://samsebeingener.ru">samsebeingener.ru</a> ·
  <a href="https://github.com/samsebeingener/visbug-mcp-ru">GitHub</a>
</p>
