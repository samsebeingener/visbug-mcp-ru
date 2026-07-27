---
description: VisBug MCP — шпаргалка и диагностика (v0.6.2)
---

# VisBug MCP — для пользователя

**Ответь коротко, по-русски, 5–8 строк.** Не вываливай фазы установки, если пользователь уже работает.

## Что это

VisBug в Chrome → правишь сайт визуально → **Стоп** в popup → правки **сами попадают в файлы** проекта (`frontend-new`, CSS и т.д.). **Команды в чате не нужны.** Cursor CLI (`agent`) **не обязателен**.

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
| ○ CLI agent — не нужен | Это норма, не ошибка |
| MCP не видит tools | Cursor → Reload Window |

Полный сброс: `cd projects/visbug-mcp-ru && npm run setup`

---

## Для агента (не показывать пользователю целиком)

Пути Никиты (если workspace = Cursor root):

- Репо: `projects/visbug-mcp-ru`
- Сайт: `projects/samsebeingener-web/frontend-new`
- Расширение: `projects/visbug-mcp-ru/extension`
- Логи: `~/.visbug-mcp/auto-apply.log`, `~/.visbug-mcp/agent-runs.log`

**Не предлагай** ставить Cursor CLI, если auto-apply уже включён. **Не предлагай** `get_changes` как основной путь.

По запросу: проверь `npm run health`, перезапусти демон, версию расширения **0.6.2+**.
