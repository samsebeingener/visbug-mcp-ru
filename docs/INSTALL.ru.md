# Установка VisBug MCP Bridge (полный стек)

Репозиторий: https://github.com/samsebeingener/visbug-mcp-ru  
Версия: **0.6.2+**

В Cursor: **`/visbug-mcp-start`** — краткая шпаргалка.

## Быстрый старт

```bash
git clone https://github.com/samsebeingener/visbug-mcp-ru.git
cd visbug-mcp-ru
npm install
npm run setup
```

`npm run setup` спросит путь к **проекту сайта** (workspace) и включит **auto-apply** после «Стоп».

## Что установить вручную

1. **VisBug** — https://chromewebstore.google.com/detail/visbug/cdockenadnadldjbbgcallicgledbeoc
2. **Расширение visbug-mcp**
   - В Chrome в адресной строке: `chrome://extensions`
   - Режим разработчика → **Загрузить распакованное**
   - Папка (полный путь после `npm run setup`):

     ```
     <путь-к-репо>/visbug-mcp-ru/extension
     ```

     Пример: `C:\Users\you\projects\visbug-mcp-ru\extension`  
     Тот же путь виден в **popup** visbug-mcp после setup.
3. **Reload Window** в Cursor после setup

## Cursor Agent CLI (опционально, fallback LLM)

Нужен только если auto-apply не смог применить часть правок (сложный текст, нестандартные селекторы).

```bash
npm run ensure-cli
agent login
agent status
```

Windows: `%LOCALAPPDATA%\cursor-agent\agent.cmd`  
Проверка: `npm run health` → `cursor cli: OK`

## Проверка

```bash
npm run health
```

Popup: зелёная точка = Bridge daemon online. MCP в Cursor для записи не требуется.

## Как работает после «Стоп»

```
Запись VisBug → Стоп
       ↓
  auto-apply (без LLM) → CSS/текст в файлы workspace
       ↓
  остались правки? → да → Cursor Agent CLI читает локальный run-packet
       ↓
  нет CLI → часть правок остаётся в буфере, popup покажет точную причину
```

Конфиг: `~/.visbug-mcp/config.json`  
Логи: `~/.visbug-mcp/auto-apply.log`, `~/.visbug-mcp/agent-runs.log`

## Ежедневно

`npm run dev` → VisBug → popup проверяет выбранный проект → **Начать запись** → правки → **Стоп** → смотри diff в редакторе.

Команды в чате Cursor **не обязательны**.

## Диагностика

| Симптом | Решение |
|---------|---------|
| Красная точка | `scripts/start-ws-daemon.ps1` |
| Нет правок | F5 → снова Запись → Стоп |
| Cursor Agent fallback готов | Сложный остаток будет обработан автоматически |
| Сложные правки не в файлах | `npm run ensure-cli`, `agent login` |
| MCP не видит tools | Reload Window |
