# Установка VisBug MCP Bridge

Репозиторий: https://github.com/samsebeingener/visbug-mcp-ru  
Версия: **0.19** (recorder-only, Onlook patterns)

В Cursor: **`/visbug-mcp-start`** — краткая шпаргалка.

## Быстрый старт

```bash
git clone https://github.com/samsebeingener/visbug-mcp-ru.git
cd visbug-mcp-ru
npm install
npm run setup
```

`npm run setup` спросит путь к **проекту сайта** (workspace) и скопирует в него:

- команды `/visbug-mcp-start`, `/visbug-mcp-update`;
- rule **`visbug-buffer-apply.mdc`** — подсказка Cursor при вставке буфера VisBug.

## Что установить вручную

1. **VisBug** — https://chromewebstore.google.com/detail/visbug/cdockenadnadldjbbgcallicgledbeoc
2. **Расширение visbug-mcp**
   - Chrome → `chrome://extensions` → режим разработчика → **Загрузить распакованное**
   - Папка: `<путь-к-репо>/extension`
3. **Reload Window** в Cursor после setup

## Как Cursor узнаёт, что делать с буфером

Три слоя (из коробки после `npm run setup`):

| Слой | Где | Когда срабатывает |
|------|-----|-------------------|
| **Футер в буфере** | popup «Скопировать правки» | Всегда при копировании (после ↻ расширения) |
| **Rule** | `<workspace>/.cursor/rules/visbug-buffer-apply.mdc` | Агент подтягивает при паттерне `[N] … → стиль:` |
| **Контракт** | `visbug-mcp-ru/shared/apply-buffer-contract.md` | Агент читает по rule или футеру |

Расширение Chrome **не** ставит rule в Cursor — это делает `npm run setup` / `npm run update`.

## Обновление

```bash
npm run update
```

Копирует недостающие команды и rule во **все workspace** из `~/.visbug-mcp/config.json` (не перезаписывает существующие файлы).

### Обновление (v0.19)

После `npm run update`: ↻ расширение в Chrome + Reload Window в Cursor.

- `react-source-bridge.js` — `data-visbug-src` на Next dev (Fiber `_debugSource`)
- Буфер: per-file summary, короткий селектор, `actions.json`
- E2E чеклист: `docs/acceptance-checklist.md`

### Источник узла: `data-vb-source` (v0.24, Next.js / React dev)

Приоритет определения файла:строки узла:

1. **`data-vb-source`** — атрибут на элементе или предке (ставит babel-плагин, см. ниже)
2. `data-visbug-src` / `data-vb` — legacy-алиасы, тоже принимаются
3. **React Fiber `_debugSource`** — fallback (react-source-bridge, zero-config)

Если атрибут и fiber указывают на разные файлы/строки, узел помечается
`data-visbug-source-confidence="ambiguous"`, а в write-recipe уходит warning
`manual_review` — агент должен проверить target вручную.

**Babel-плагин (dev-only):** `instrument/babel-plugin-visbug-src.js` инжектит
`data-vb-source="<file>:<line>:<col>"` на JSX-элементы. Подключение в Next.js
(классический `.babelrc` / `babel.config.js`, не SWC-by-default проекты):

```js
// babel.config.js — только development
module.exports = {
  plugins: [
    process.env.NODE_ENV === 'development'
      ? ['visbug-mcp-ru/instrument/babel-plugin-visbug-src', { env: 'development' }]
      : null,
  ].filter(Boolean),
}
```

Для static HTML (без React) используйте `data-vb-source` или `data-visbug-id`
вручную — см. `shared/html-stable-target-contract.md`.

**Confidence в рецептах:** `high` — есть `data-vb-source`/visbugSrc; `medium` —
только короткий селектор; `low` — длинный DOM path. При `low` или ambiguity в
буфере пишется `confidence: low (manual_review)`.

### Auto-stamp (v0.26)

Ручная разметка больше не обязательна: если у элемента, получившего записанную
мутацию, нет `id`/`data-vb*`, content-script сам ставит `data-visbug-id="vb-<tag>-<NN>"`
и передаёт карту `stamps:` в буфер. Рецепт идёт на стабильный `#vb-*`
(confidence high, warning `stamp-pending`). При первом apply агент переносит
этот id в исходный HTML и пишет CSS под `#vb-*` — цель становится стабильной
навсегда. Правила для агента: §11 `shared/apply-buffer-contract.md`.

## Проверка

```bash
npm run health
```

Popup: зелёная точка = Bridge daemon online.

## Рабочий цикл

```
VisBug на localhost → двигать элементы
       ↓
popup «Скопировать правки» → вставить в чат Cursor
       ↓
агент правит исходники по apply-buffer-contract.md
       ↓
popup «Очистить правки» (опционально)
```

Auto-apply и запись в файлы через daemon **отключены** в v0.13.

Конфиг: `~/.visbug-mcp/config.json`  
Буфер: `~/.visbug-mcp/projects/<id>/changes.json`

## Диагностика

| Симптом | Решение |
|---------|---------|
| Красная точка | `scripts/start-ws-daemon.ps1` или `npm run daemon` |
| Нет правок в буфере | F5 → снова двигать в VisBug → «Скопировать» |
| Cursor не читает контракт | Проверь `.cursor/rules/visbug-buffer-apply.mdc` в workspace; `npm run setup` |
| Старый буфер без футера | Обнови расширение (↻) и скопируй заново |
| MCP tools не видны | Reload Window (MCP опционален для записи) |
