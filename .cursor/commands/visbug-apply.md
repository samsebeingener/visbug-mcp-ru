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

1. Вызови MCP **visbug-mcp** → `get_changes` (без фильтра).
2. Примени правки в workspace из `~/.visbug-mcp/config.json` → `autoAgent.workspace`.
3. **Не применяй** артефакты VisBug: `cursor`, `position`, `transition`, `--start`, `--glow-mask`, `editorial-card-glow`.
4. `left`/`top` в grid → `margin-inline-start` / `margin-top` в `sections.css`.
5. Текст из CMS — скажи пользователю, что править в Directus, не в `.tsx`.
6. После записи в файлы — `apply_changes` с индексами применённых `[N]`.

Промпт-подсказки: `projects/visbug-mcp-ru/prompts/visbug-apply.md`.

## Для агента

- Репо моста: `projects/visbug-mcp-ru`
- Буфер: `~/.visbug-mcp/changes.json`
- Лог auto-apply: `~/.visbug-mcp/auto-apply.log`
- Cursor Agent fallback запускается автоматически только для сложного остатка и не открывает терминал.
