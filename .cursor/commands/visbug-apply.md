---
description: VisBug MCP — применить оставшиеся правки из буфера в файлы проекта
---

# VisBug MCP — применить правки

**Ответь коротко, по-русски.** Покажи, что применил и в каких файлах.

## Когда вызывать

После «Стоп» в popup, если:
- в буфере остались правки (текст из CMS, сложный CSS, glow-карточки);
- auto-apply написал «осталось N → /visbug-apply».

**Не нужен**, если popup показал «Готово: N правок в файлы» и буфер пуст.

## Шаги

1. Вызови MCP **visbug-mcp** → **`get_actions`** (JSON: `actions`, `workspace`, `summary`).
2. Примени остаток машиной: **`apply_actions`** (без `markOnly`) — пишет в файлы через auto-apply.
3. Если правил вручную в редакторе — **`apply_actions`** с `markOnly: true` или `actionIds` только для пометки.
4. **Не применяй** артефакты VisBug: `cursor`, `position`, `transition`, `--start`, `--glow-mask` (они в `artifacts`, не в `actions`).
5. `left`/`top` → MOVE; static HTML width/transform → Tailwind-классы в `index.html`; React → `data-visbug-src` + AST.
6. Текст из CMS — скажи пользователю, что править в Directus, не в `.tsx`.

Legacy: `get_changes` / `apply_changes` (только пометка в буфере) — устаревают в v1.0.

Промпт-подсказки: `projects/visbug-mcp-ru/prompts/visbug-apply.md`.

## Для агента

- Репо моста: `projects/visbug-mcp-ru`
- Буфер: `~/.visbug-mcp/changes.json`
- Лог auto-apply: `~/.visbug-mcp/auto-apply.log`
- Cursor Agent fallback запускается автоматически только для сложного остатка и не открывает терминал.
