<p align="center">
  <img src="assets/cover-banner.png" alt="VisBug MCP Bridge — обложка репозитория" width="920">
</p>

<h1 align="center">VisBug MCP Bridge</h1>

<p align="center">
  Мост <strong>VisBug → Cursor</strong> через MCP: визуальные правки на <code>localhost</code> → Actions v2 → auto-apply в исходники (React AST или Tailwind на static HTML).
</p>

<p align="center">
  <img src="https://img.shields.io/badge/локаль-only-зелёный?style=flat-square" alt="только локально">
  <img src="https://img.shields.io/badge/MCP-Cursor-blue?style=flat-square" alt="MCP Cursor">
  <img src="https://img.shields.io/badge/язык-русский-red?style=flat-square" alt="русский">
</p>

---

## Архитектура

```
Chrome (VisBug + расширение)
        │  WebSocket ws://127.0.0.1:4844
        ▼
┌─────────────────┐      ~/.visbug-mcp/changes.json
│  ws-daemon.js   │ ◄──────────────────────────────►  src/server.js (MCP stdio)
│  (pm2 / фон)    │                                    └─ запускается Cursor
│                 │                                       по запросу
└─────────────────┘
```

- **`src/ws-daemon.js`** — автономный WebSocket-сервер. Работает в фоне (pm2 или PowerShell-скрипт). Принимает мутации от расширения и сохраняет их в `~/.visbug-mcp/changes.json`.
- **`src/server.js`** — MCP-сервер (stdio). Запускается Cursor по запросу. Читает и пишет общий файл store. WebSocket не открывает.
- **`extension/`** — расширение Chrome. Content-script на `localhost` наблюдает за DOM; popup показывает статус и кнопки управления.

### Безопасность

- WebSocket только `ws://127.0.0.1:4844` — данные не уходят в интернет
- Хранилище только `~/.visbug-mcp/changes.json` на вашем компьютере
- Внешних HTTP-запросов нет

---

## Установка

**Полная инструкция:** [docs/INSTALL.ru.md](docs/INSTALL.ru.md)  
**В Cursor:** команда `/visbug-mcp-start` (файл `.cursor/commands/visbug-mcp-start.md`).

```bash
git clone https://github.com/samsebeingener/visbug-mcp-ru.git
cd visbug-mcp-ru
npm install
npm run setup
```

`npm run setup` — добавляет проект и его `localhost` origin, запускает Bridge daemon и настраивает **auto-apply** после «Стоп». MCP в Cursor создаётся для ручного доступа, но запись от него не зависит.

**Cursor Agent CLI** (опционально, для сложных правок): `npm run ensure-cli` → `agent login`. На Windows ставится в `%LOCALAPPDATA%\cursor-agent\agent.cmd`.

### 1. Зависимости (ручной путь)

```bash
git clone https://github.com/samsebeingener/visbug-mcp-ru.git
cd visbug-mcp-ru
npm install
```

### 2. WebSocket-демон

**Windows (PowerShell):**

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-ws-daemon.ps1
```

**macOS / Linux (pm2):**

```bash
npm install -g pm2
pm2 start src/ws-daemon.js --name visbug-ws
pm2 startup
pm2 save
```

Демон слушает `ws://127.0.0.1:4844` и перезапускается при сбое.

### 3. Расширения Chrome

**VisBug (официальный):**  
https://chromewebstore.google.com/detail/visbug/cdockenadnadldjbbgcallicgledbeoc

**visbug-mcp (наше):**

1. В адресной строке Chrome откройте: `chrome://extensions`
2. Включите **режим разработчика** (переключатель справа вверху)
3. **«Загрузить распакованное расширение»**
4. Выберите папку **`extension/`** внутри клона репозитория

Полный путь печатает `npm run setup`, пример:

```
C:\Users\you\projects\visbug-mcp-ru\extension
```

Не ищите папку по всему диску — скопируйте путь из терминала после setup или из popup visbug-mcp.

### 4. MCP в Cursor

Добавьте в `~/.cursor/mcp.json`:

```json
"visbug-mcp": {
  "command": "node",
  "args": ["C:/путь/к/visbug-mcp-ru/src/server.js"]
}
```

После правок `mcp.json` — **Reload Window** в Cursor.

---

## Как пользоваться

### Режим «Запись» (v0.6.2+)

1. Запустите сайт и откройте `http://localhost:…` в Chrome.
2. В Cursor запустите `/visbug-mcp-start`: команда спросит, использовать уже запущенный localhost-проект или поднять новый.
3. Popup на нужной localhost-странице покажет статус **Bridge daemon готов**, выбранный проект и auto-apply → **Начать запись**.
4. Правки в VisBug (стили, текст, layout).
5. **Стоп — завершить запись**.

**После «Стоп» команды в чате не нужны:**

1. **auto-apply** — Bridge сам пишет безопасные правки в исходники: CSS и текст в `src/` для приложений; CSS в `<style>` и уникальный видимый текст в корневой `index.html` для статичных лендингов.
2. **Cursor Agent fallback** — если остаётся сложная правка, Bridge скрытно запускает Cursor Agent CLI. Агент читает локальный run-packet и подтверждает только реально применённые изменения.
3. **MCP** — необязательный ручной доступ из Cursor к буферу правок; не нужен для записи и fallback.

Логи: `~/.visbug-mcp/auto-apply.log`, `~/.visbug-mcp/agent-runs.log`

**Важно:** жмите **Стоп** до закрытия VisBug.

### Статичные HTML-лендинги

Для проектов с корневым `index.html` auto-apply включается автоматически: стили сохраняются в существующий блок `<style>`, а уникальный текст — прямо в `index.html`. Запустите лендинг через localhost, затем зарегистрируйте папку и origin командой `/visbug-mcp-start`. Если один и тот же текст повторяется несколько раз или CSS-правка требует изменения классов Tailwind, её обработает Cursor Agent fallback.

### Несколько проектов

Bridge сопоставляет точный origin с папкой проекта. Например: `http://localhost:3001` → Next-проект, `http://localhost:3002` → статичный лендинг. В popup всегда видны выбранные папка и тип исходников; если origin не зарегистрирован, запись блокируется вместо риска записать правки в другой проект.

### Запасной путь (ручной)

- **Скопировать правки** в popup или MCP `get_changes` → `apply_changes` в Cursor
- Команда `/visbug-apply` в проекте с `.cursor/commands/` (если auto-apply не добил всё)

**Цикл записи:** «Начать запись» (буфер очищается) → правки в VisBug → «Стоп» → snapshot diff → auto-apply в файлы.

### Popup Chrome

| Индикатор | Значение |
|---|---|
| 🟢 Bridge daemon готов | Можно начать запись |
| 🔴 Bridge daemon не запущен | Перезапустите `start-ws-daemon.ps1` |
| ✓ Запись в файлы после Стоп | auto-apply включён, workspace задан |
| ○ CLI agent — не нужен | Норма: CSS уже пишется без CLI |
| ✓ CLI agent (доп.) | Fallback LLM для сложных правок |
| `N правок в буфере` | Неприменённых изменений |

| Кнопка | Действие |
|---|---|
| **Скопировать правки** | Копирует форматированный список в буфер обмена |
| **Очистить правки** | Сбрасывает store и storage VisBug |

### MCP-инструменты (v0.10+)

| Инструмент | Назначение |
|---|---|
| **`get_actions`** | JSON: pending MOVE/STYLE/TEXT, workspace, summary |
| **`apply_actions`** | Запись в файлы через auto-apply (`actionIds` / indices) |
| `get_changes` | [legacy] текстовый summary |
| `apply_changes` | [legacy] только пометка в буфере |
| `clear_changes` | Очистка store |

#### `get_actions` / `apply_actions`

Предпочтительный путь после «Стоп», если в буфере остались правки или нужен ручной apply из Cursor:

```
get_actions → apply_actions
```

`apply_actions` без `markOnly` вызывает тот же `auto-apply.js`, что и демон после записи.

#### `get_changes` (legacy)

Возвращает захваченные визуальные правки (ещё не применённые).

```
Параметры:
  filter  (опционально): "style" | "attribute" | "text" | "node-added" | "node-removed"
```

Пример вывода:

```
[0] .card > h2 → стиль: font-size = 18px (было: 16px)
[1] .btn--primary → стиль: background = rgb(59, 130, 246) (было: rgb(99, 102, 241))
[2] #hero-title → текст: «Новый заголовок» (было: «Старый заголовок»)
```

#### `apply_changes`

Помечает правки как применённые **в буфере** (после того как вы или auto-apply уже записали их в исходники).

```
Параметры:
  ids  (опционально): массив индексов — пусто = пометить все непомеченные
```

#### `clear_changes`

Полностью очищает буфер.

---

## Техническое поведение

### Режим «Запись» (snapshot, v0.2+)

Live-мутации **выключены намеренно** — иначе VisBug при перезагрузке страницы снова накатывает старые правки и засоряет буфер.

1. «Начать запись» — очистка буфера + снимок DOM «до» (вся страница / `main`)
2. Правки в VisBug
3. «Стоп» — снимок «после», diff → `changes.json`
4. `auto-apply.js` пишет простые CSS/текст в workspace
5. Сложный остаток — Cursor Agent CLI скрытно обрабатывает run-packet и подтверждает применённые файлы

### Дедупликация

Парсер (`src/parser.js`) хранит `Map` (`seen`) по ключу `selector|type|свойство`. Если одно свойство менялось несколько раз — сохраняется только последнее значение.

### Персистентность (file store)

Правки пишутся в `~/.visbug-mcp/changes.json` после «Стоп» (snapshot diff). Это **общий источник правды** между демоном и MCP-сервером.

```json
{
  "changes": [
    {
      "type": "style",
      "selector": ".card > h2",
      "property": "font-size",
      "oldValue": "16px",
      "newValue": "18px",
      "tag": "H2",
      "url": "http://localhost:3001/",
      "timestamp": 1711234567890,
      "applied": false
    }
  ]
}
```

### Фильтрация шума

Парсер автоматически игнорирует:

- внутренние селекторы VisBug (`#vibe-annotations-root`, `vis-bug` и т.д.)
- scoped CSS-переменные Vue (`--dc13a441-…`)
- классы Vue Router (`router-link-active`, transitions)
- мутации `node-added` / `node-removed` (рендер Vue)
- длинные начальные тексты (дамп первого рендера)
- атрибуты `contenteditable` (внутреннее использование VisBug)

---

## Полезные команды

```bash
# Проверка установки
npm run health

# Cursor Agent CLI (fallback LLM)
npm run ensure-cli
agent login

# Статус демона (pm2)
pm2 status visbug-ws

# Логи в реальном времени
pm2 logs visbug-ws

# Перезапуск
pm2 restart visbug-ws

# Разработка с автоперезагрузкой
npm run daemon:watch

# Очистить store вручную
echo '{"changes":[]}' > ~/.visbug-mcp/changes.json
```

---

## Структура проекта

```
visbug-mcp-ru/
├── assets/
│   ├── cover-banner.png     # обложка README
│   └── social-preview.jpg   # превью при шаринге (копия баннера)
├── src/
│   ├── ws-daemon.js         # WebSocket-демон (фон)
│   ├── server.js            # MCP stdio (Cursor)
│   ├── auto-apply.js        # запись правок в файлы без LLM
│   ├── auto-agent.js        # fallback: headless agent после auto-apply
│   ├── cli-resolver.js      # поиск agent / agent.cmd (Windows)
│   └── parser.js            # парсинг, дедупликация, формат
├── extension/
│   ├── manifest.json        # Chrome Manifest v3
│   ├── content-script.js    # DOM + WebSocket-клиент
│   ├── popup.html           # интерфейс popup (RU)
│   ├── popup.js
│   └── background.js
├── scripts/
│   ├── setup.mjs            # npm run setup
│   ├── ensure-agent-cli.mjs # npm run ensure-cli
│   ├── health-check.mjs     # npm run health
│   └── start-ws-daemon.ps1  # демон на Windows
├── README.md                # этот файл
├── README.ru.md             # краткая версия
└── FORK.ru.md               # заметки о форке
```

---

## Что переведено на русский

- Popup расширения Chrome
- Описания MCP-инструментов и ответы сервера
- Формат строк в `get_changes` и буфере обмена («было», «текст», «CSS»)

---

## Лицензия и upstream

Самостоятельная разработка на базе идей [mambari/visbug-mcp](https://github.com/mambari/visbug-mcp) (ранний upstream). VisBug — [GoogleChromeLabs/ProjectVisBug](https://github.com/GoogleChromeLabs/ProjectVisBug).

Архитектурные референсы (идеи, не копипаст кода): [Onlook](https://github.com/onlook-dev/onlook) (`data-visbug-src`, Actions, AST apply) — см. [ROADMAP](docs/ROADMAP-data-visbug-src-actions.md).

---

<p align="center">
  <strong>Никита Куликов</strong><br>
  <a href="https://samsebeingener.ru">samsebeingener.ru</a>
</p>
