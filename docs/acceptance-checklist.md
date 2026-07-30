# E2E acceptance checklist — Onlook patterns (v0.19)

Ручная проверка после обновления extension + daemon. Режим: **recorder-only**.

## Prerequisites

1. `npm run daemon` в `projects/visbug-mcp-ru`
2. Extension reloaded в `chrome://extensions`
3. Проекты в `config.json` / `/visbug-mcp-start`

---

## Static HTML — `projects/portfolio/tatiana-tihomirova` @ `:3002`

```bash
cd projects/portfolio/tatiana-tihomirova
python -m http.server 3002
```

| # | Шаг | Ожидание |
|---|-----|----------|
| 1 | Record → drag `.hero-portrait` | Буфер: `--- index.html ---`, короткий селектор |
| 2 | Проверить шапку | `files: index.html (1)` |
| 3 | Agent apply (single-node) | Один `transform` на `img`, не на колонке |
| 4 | Hover `scale(1.02)` | Не ломается — один combined `transform` |
| 5 | `<base href>` | В локальном `index.html` нет — `uploads/` грузится |

---

## Next.js — `projects/samsebeingener-web/frontend-new` @ `:3001`

```bash
cd projects/samsebeingener-web/frontend-new
npm run dev
```

| # | Шаг | Ожидание |
|---|-----|----------|
| 1 | Record → drag hero block | `data-visbug-src` на узле (dev) |
| 2 | Буфер MOVE | `\| файл: src/...tsx` + `actions.json` MOVE |
| 3 | Agent | Правит указанный TSX/CSS, не overlay без причины |
| 4 | `align:` hint | При snap к соседу — `align: ul... (left)` в строке |

---

## Machine checks (automated)

```bash
cd projects/visbug-mcp-ru
npm test
```

Тесты: `target-fidelity`, `selector-short`, `layout-delta`, `actions-compile`.
