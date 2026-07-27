---
description: VisBug MCP — шпаргалка и диагностика (v0.6.2)
---

# VisBug MCP — для пользователя

**Ответь коротко, по-русски, 5–8 строк.** Не вываливай фазы установки, если пользователь уже работает.

## Что это

VisBug в Chrome → правишь сайт визуально → **Стоп** в popup → правки **сами попадают в файлы** проекта. **Команды в чате не нужны.**

**Cursor Agent CLI** (`agent`) — **опционально**: если auto-apply не смог применить сложные правки, headless agent добивает остаток. Установка: `npm run ensure-cli`, `agent login`.

## Ежедневный цикл

1. `npm run dev` в `frontend-new`
2. Popup visbug-mcp: **зелёная точка** (демон запущен)
3. VisBug → popup **Начать запись** → правки → **Стоп**
4. В popup: «Готово: N правок в файлы» — смотри diff в редакторе

**Важно:** жми **Стоп** до закрытия VisBug.

## Если сломалось

| Симптом | Что сделать |
|---------|-------------|
| Красная точка | `powershell -ExecutionPolicy Bypass -File projects/visbug-mcp-ru/scripts/start-ws-daemon.ps1` |
| Нет правок | F5 на localhost → снова Запись → правки → Стоп |
| ○ CLI agent — не нужен | Норма, если всё применилось в файлы |
| Сложные правки не в файлах | `npm run ensure-cli` → `agent login` |
| MCP не видит tools | Cursor → Reload Window |

Полный сброс: `cd projects/visbug-mcp-ru && npm run setup`

---

## Для агента (не показывать пользователю целиком)

Пути Никиты (если workspace = Cursor root):

- Репо: `projects/visbug-mcp-ru`
- Сайт: `projects/samsebeingener-web/frontend-new`
- Расширение: `projects/visbug-mcp-ru/extension`
- Логи: `~/.visbug-mcp/auto-apply.log`, `~/.visbug-mcp/agent-runs.log`

**Не предлагай** `get_changes` как основной путь. CLI предлагай только если auto-apply не справился или пользователь просит fallback.

По запросу: проверь `npm run health`, перезапусти демон, версию расширения **0.6.2+**.
