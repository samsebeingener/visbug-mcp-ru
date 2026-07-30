---
description: Запустить VisBug Bridge и выбрать проект для записи
---

# VisBug Bridge — старт проекта

Работай по-русски. Сначала проверь Bridge и localhost-проекты, затем задай пользователю один вопрос через форму выбора.

## Принцип zero-config (обязательно)

**Пользователь не должен править код сайта** (next.config, Babel, плагины в package.json).

- Привязка DOM → исходник (если нужна) — через расширение в dev на localhost, **без** обязательной инструментации сайта.
- `npm run setup` / эта команда только регистрируют **workspace + origin** в `~/.visbug-mcp/config.json`.
- **Не предлагать** Babel-плагин и правки next.config по умолчанию.

## Обязательный порядок

1. В `projects/visbug-mcp-ru` запусти `npm run health`. Если daemon offline — `scripts/start-ws-daemon.ps1`.
2. Проверь localhost-порты и `~/.visbug-mcp/config.json`.
3. Спроси пользователя:
   - **Работать с запущенным проектом** — покажи только реальные localhost URL и зарегистрированные папки.
   - **Поднять новый проект** — путь к папке и желаемый порт.
4. Для нового проекта:
   - определи Next/static HTML;
   - **не** подключай Babel/SWC в проект пользователя без явной просьбы;
   - запусти dev-server (`npm run dev` или `python -m http.server PORT`);
   - зарегистрируй origin и workspace: `npm run setup:quick -- --workspace "<path>" --origin "http://localhost:PORT" --name "<имя>" -y`;
5. Подтверди URL, папку и готовность. Напомни цикл:
   - открыть страницу на localhost;
   - править в VisBug (красные направляющие с px — в расширении);
   - popup → **«Скопировать правки»** → вставить в чат Cursor (rule `visbug-buffer-apply` ставится при `npm run setup`);
   - Cursor сам вносит точные правки в исходники;
   - после применения — **«Очистить правки»** в popup.

## Правила

- Не убивай чужие dev-серверы.
- Не регистрируй origin, уже привязанный к другой папке.
- **Не вызывай** auto-apply, `apply_actions` с записью в файлы, headless CLI agent — это отключено с v0.12.
- MCP `get_changes` — опционально; основной путь — кнопка «Скопировать» в popup.

Если popup пишет «проект не назначен» — запусти эту команду снова.
