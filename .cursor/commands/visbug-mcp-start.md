---
description: Запустить VisBug Bridge и выбрать проект для записи
---

# VisBug Bridge — старт проекта

Работай по-русски. Сначала проверь Bridge и localhost-проекты, затем задай пользователю один вопрос через форму выбора.

## Принцип zero-config (обязательно)

**Пользователь не должен править код сайта** (next.config, Babel, плагины в package.json).

- `npm run setup` / эта команда только регистрируют **workspace + origin** в `~/.visbug-mcp/config.json`.
- **Не предлагать** Babel-плагин и правки next.config по умолчанию.

## Обязательный порядок

0. **Первый запуск — установка расширений в Chrome** (проверь один раз; если расширения уже установлены, пропусти):
   - Официальный Google VisBug — дай ссылку на Chrome Web Store:
     https://chromewebstore.google.com/detail/visbug/cdockenadnadldjbbgcallicgledbeoc
   - Наш мост VisBug MCP Bridge ставится вручную. Напомни:
     1. Открыть `chrome://extensions`
     2. Включить **«Режим разработчика»** (тумблер справа вверху)
     3. Нажать **«Загрузить распакованное расширение»**
     4. Указать папку (дай полный путь):
        `c:\Users\nkoul\OneDrive\Документы\Cursor\projects\visbug-mcp-ru\extension`
1. В `projects/visbug-mcp-ru` запусти `npm run health`. Если daemon offline — `scripts/start-ws-daemon.ps1`.
2. Проверь localhost-порты и `~/.visbug-mcp/config.json`.
3. Спроси пользователя:
   - **Работать с запущенным проектом** — покажи только реальные localhost URL и зарегистрированные папки.
   - **Поднять новый проект** — путь к папке и желаемый порт.
4. Для нового проекта:
   - определи Next/static HTML;
   - запусти dev-server (`npm run dev` или `python -m http.server PORT`);
   - зарегистрируй origin и workspace: `npm run setup:quick -- --workspace "<path>" --origin "http://localhost:PORT" --name "<имя>" -y`;
5. Подтверди URL, папку и готовность. Напомни цикл:
   - открыть страницу на localhost;
   - править в VisBug (красные направляющие с px — в расширении);
   - popup → **«Скопировать правки»** → вставить в чат Cursor;
   - Cursor сам вносит точные правки в исходники;
   - после применения — **«Очистить правки»** в popup.

## Правила

- Не убивай чужие dev-серверы.
- Не регистрируй origin, уже привязанный к другой папке.
- **Не вызывай** auto-apply, запись в файлы через daemon, headless CLI agent — отключено с v0.12.
- MCP `get_changes` — опционально; основной путь — кнопка «Скопировать» в popup.

Если popup пишет «проект не назначен» — запусти эту команду снова.
