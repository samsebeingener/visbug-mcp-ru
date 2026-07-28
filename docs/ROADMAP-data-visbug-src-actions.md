# Roadmap: `data-visbug-src` + модель Actions

Версия черновика: 2026-03-28 · базовая линия: **v0.6.36**

Цель: убрать хрупкость «длинный CSS-селектор → угадывание файла → `sections.css` overlay» и перейти к точному DOM→код, сохранив VisBug + Cursor MCP как основной UX.

Референс: [Onlook architecture](https://docs.onlook.com/developers/architecture) (`data-onlook-id` + AST + Actions).

---

## Проблема сейчас

| Симптом | Причина |
|--------|---------|
| Margin «разъехался» (−136 → 32) | VisBug `left` = дельта сессии, auto-apply затирал старый margin |
| Запись в `sections.css`, не в компонент | Нет привязки DOM → `pricing.tsx` |
| Длинные селекторы ломаются | React hydration, `nth-of-type`, grid |
| Glow/`--start` шум в буфере | Декоративные inline-стили карточек |
| Align-to-element не переносится | В буфере только `left`, нет reference target |

**v0.6.36** закрывает накопление margin и часть эвристик; структурно нужны `data-visbug-src` и Actions.

---

## Фаза 0 — зафиксировано (v0.6.36)

- [x] Alignment guides: рамка + красные линии при drag, без синей сетки
- [x] `visbug-ui-trim`: скрытие `visbug-label` при записи
- [x] Auto-apply: gutter protection, builder-rich-text → margin, decorative `--*` skip
- [x] `resolveMoveCssValue`: **накопление** `margin-inline-start` / `margin-top`
- [x] Unit-тесты `test/auto-apply.test.js`

---

## Фаза 1 — модель Actions (4–6 дней)

### Зачем

Сырой буфер `{ type: 'style', property: 'left', selector: '...' }` плохо:

- сериализуется для undo/redo;
- передаётся в Cursor Agent;
- объединяется в один logical edit (два `p` + один сдвиг блока).

### Схема (TypeScript-совместимый JSON)

```json
{
  "version": 1,
  "sessionId": "uuid",
  "recordedAt": "ISO-8601",
  "workspace": "/abs/path",
  "actions": [
    {
      "id": "act_01",
      "type": "MOVE",
      "target": {
        "selector": "#services ... p:nth-of-type(1)",
        "tag": "p",
        "visbugSrc": null
      },
      "delta": { "x": 32, "y": 0, "unit": "px" },
      "align": {
        "mode": "edge",
        "edge": "left",
        "reference": {
          "selector": "#services ... article:nth-of-type(2) ul",
          "edge": "left"
        }
      },
      "applyPlan": {
        "strategy": "margin-inline-start",
        "cumulative": true
      }
    },
    {
      "id": "act_02",
      "type": "STYLE",
      "target": { "selector": "...", "visbugSrc": null },
      "changes": [{ "prop": "width", "value": "552px" }]
    },
    {
      "id": "act_03",
      "type": "TEXT",
      "target": { "selector": "...", "visbugSrc": null },
      "oldValue": "...",
      "newValue": "..."
    }
  ],
  "artifacts": [
    { "type": "VISBUG_NOISE", "property": "--start", "selector": "..." }
  ]
}
```

### Типы действий (v1)

| type | Источник VisBug | Apply |
|------|-----------------|-------|
| `MOVE` | `left`+`top` | margin / transform / items-end (как сейчас) |
| `STYLE` | width, opacity, color… | CSS prop / className (позже) |
| `TEXT` | text diff | TSX / HTML |
| `ALIGN` | snap в alignment-guides | опционально `reference` + computed offset |

### Задачи

1. **`src/actions/schema.js`** — валидация, миграция из legacy `changes[]`
2. **`extension/snapshot.js`** — emit Actions вместо плоского списка (legacy flag `format: 'actions'`)
3. **`src/ws-daemon.js`** — писать `changes.json` v2 + `changes-legacy.json` на переходный период
4. **`src/auto-apply.js`** — consume Actions pipeline (`planActionApply`)
5. **Alignment guides** — при snap записывать `align.reference` (selector + edge + rect)
6. **Тесты** — MOVE cumulative, ALIGN merge, TEXT unchanged

### Критерий готовности

- Stop recording → в store Actions v2
- Auto-apply проходит все текущие тесты + 3 новых на Actions
- Cursor MCP `get_changes` отдаёт Actions (с кратким human summary)

---

## Фаза 2 — `data-visbug-src` dev-only (1–2 недели)

### Зачем

Точный адрес в коде без угадывания селектора — как `data-onlook-id` у Onlook.

### Формат атрибута

```html
<p
  data-visbug-src="src/components/sections/pricing.tsx:59:17"
  data-visbug-oid="p_8f3a2c"
>
```

- **`data-visbug-src`** — `relativePath:startLine:startColumn` (от корня workspace)
- **`data-visbug-oid`** — стабильный id узла в файле (для повторных правок после HMR)
- Только **dev** (`NODE_ENV=development`), strip в production build

### Варианты внедрения

| Вариант | Плюсы | Минусы |
|---------|-------|--------|
| **A. Next.js/SWC plugin** | Точно, на все JSX | Нужен webpack/turbopack hook |
| **B. Babel plugin** (как Onlook `ids.ts`) | Проверенный паттерн | Дубли с SWC в Next 15+ |
| **C. React `__source` / `_debugSource`** | Без плагина | Нестабильно, не в prod |
| **D. Runtime preload script** | Быстрый spike | Пишет в DOM, не в исходники |

**Рекомендация:** A для `samsebeingener-web/frontend-new`, D как fallback для static HTML.

### Пакет `packages/visbug-instrument` (в monorepo или подпапка)

```
visbug-instrument/
  babel-plugin-visbug-src.js   # dev: inject attrs
  next-plugin.js               # wrap with @next/bundle-analyzer pattern
  strip-plugin.js              # prod: remove attrs
```

### Интеграция в visbug-mcp-ru

1. **Extension** — при записи читать `el.closest('[data-visbug-src]')` → класть в `action.target.visbugSrc`
2. **auto-apply** — если `visbugSrc` есть:
   - парсить path → открыть файл;
   - **Фаза 2a:** писать в `sections.css` с комментарием `/* visbug-src: ... */` (быстрый win);
   - **Фаза 3:** AST → className / inline style в TSX
3. **Fallback** — без атрибута → текущие эвристики (`simplifySelectorForApply`)

### Пилот

- Проект: `projects/samsebeingener-web/frontend-new`
- Секции: `#services`, `#method`, hero
- Opt-in: `visbug: { instrument: true }` в `next.config.ts`

### Критерий готовности

- В DevTools у `<p>` в pricing виден `data-visbug-src`
- Move в VisBug → auto-apply пишет в правильный файл (лог: `visbug-src hit`)
- Production build без атрибутов (grep = 0)

---

## Фаза 3 — AST apply в исходники (2–3 недели)

По мотивам `@onlook/parser` (`code-edit/style.ts`, `transform.ts`):

1. **`src/ast-apply.js`** — Babel: найти JSX по line/col или oid
2. **Tailwind** — `tailwind-merge` при правке `className` (spacing, translate)
3. **Layout move** — предпочитать `ml-*` / `-translate-x-*` в className, не overlay CSS
4. **CMS/HTML** — если узел из `dangerouslySetInnerHTML` → оставить `sections.css` + warning

Зависимости: `@babel/parser`, `@babel/traverse`, `@babel/generator`, `tailwind-merge`.

---

## Фаза 4 — Agent + MCP (параллельно с 2–3)

- MCP tool `get_actions` / `apply_actions`
- Prompt `visbug-apply.md`: Actions-first, legacy fallback
- Checkpoint: git stash / branch перед batch apply (опционально)

---

## Риски и митигация

| Риск | Митигация |
|------|-----------|
| Плагин ломает Next build | opt-in, отдельный PR, CI `next build` |
| Дубли oid после edit | пересчёт oid при save (как Onlook branch map) |
| Static HTML без React | оставить selector path + `index.html` |
| Конфликт Tailwind utilities | `tailwind-merge`, не сырые классы |

---

## Порядок работ (рекомендуемый)

```
v0.6.36 (tag) → v0.7.0 Actions schema + snapshot
             → v0.7.1 align.reference в guides
             → v0.8.0 data-visbug-src spike (frontend-new)
             → v0.9.0 ast-apply className
             → v1.0.0 Actions-only buffer, legacy deprecated
```

---

## Откат

- Git tag `v0.6.36` — последняя линия до Actions/src
- `changes.json` v1 остаётся читаемым через мигратор `migrateLegacyChanges()`
- `instrument: false` в next.config — мгновенный откат атрибутов

---

## Ссылки

- [onlook-dev/onlook](https://github.com/onlook-dev/onlook) — Apache 2.0, `packages/parser`, `data-onlook-id`
- [Onlook Architecture](https://docs.onlook.com/developers/architecture)
- Внутри: `src/auto-apply.js`, `extension/snapshot.js`, `extension/alignment-guides.js`
