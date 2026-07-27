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

1. **VisBug** — [Chrome Web Store](https://chromewebstore.google.com/detail/visbug/cdockenadnadldjbbgcallicgledbeoc)
2. **Расширение visbug-mcp** — `chrome://extensions` → распакованное → папка `extension/`
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

Popup: зелёная точка = демон online.

## Как работает после «Стоп»

```
Запись VisBug → Стоп
       ↓
  auto-apply (без LLM) → CSS/текст в файлы workspace
       ↓
  остались правки? → да → headless `agent -p` (если CLI установлен)
       ↓
  нет CLI → часть правок остаётся в буфере (popup / get_changes)
```

Конфиг: `~/.visbug-mcp/config.json`  
Логи: `~/.visbug-mcp/auto-apply.log`, `~/.visbug-mcp/agent-runs.log`

## Ежедневно

`npm run dev` → VisBug → popup **Начать запись** → правки → **Стоп** → смотри diff в редакторе.

Команды в чате Cursor **не обязательны**.

## Диагностика

| Симптом | Решение |
|---------|---------|
| Красная точка | `scripts/start-ws-daemon.ps1` |
| Нет правок | F5 → снова Запись → Стоп |
| ○ CLI agent — не нужен | Норма, если CSS применился |
| Сложные правки не в файлах | `npm run ensure-cli`, `agent login` |
| MCP не видит tools | Reload Window |
