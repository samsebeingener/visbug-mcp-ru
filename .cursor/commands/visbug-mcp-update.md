---
description: VisBug MCP — безопасное обновление до последней версии с GitHub
---

# VisBug MCP — обновление

**Ответь коротко, по-русски.** Покажи версию до/после и 2–3 шага после обновления.

## Что делает команда

Обновляет `visbug-mcp-ru` с GitHub **без потери** пользовательских настроек:

- `~/.visbug-mcp/config.json` — workspace, spawnCli, auto-agent **сохраняются**
- `~/.visbug-mcp/changes.json` — буфер правок **сохраняется**
- Локальные правки в репо — `git pull --rebase --autostash` (stash/pop автоматически)
- Файл `/visbug-mcp-update` в workspace **не перезаписывается**, если уже есть

## Выполни

Из корня workspace (если путь другой — найди `projects/visbug-mcp-ru`):

```bash
cd projects/visbug-mcp-ru && npm run update
```

На Windows, если `cd` с кириллицей ломается:

```powershell
Set-Location "c:\Users\nkoul\OneDrive\Документы\Cursor\projects\visbug-mcp-ru"
npm run update
```

## После успеха — скажи пользователю

1. Chrome → `chrome://extensions` → перезагрузить visbug-mcp (↻)
2. Cursor → **Reload Window**
3. Popup — зелёная точка; версия в расширении совпадает с `package.json`

## Если ошибка

| Ситуация | Действие |
|----------|----------|
| git pull / конфликт | Показать вывод; настройки в `~/.visbug-mcp/backups/<timestamp>/` |
| Нет сети | Повторить позже; демон работает на текущей версии |
| Не git-клон | `git clone` в новую папку + `npm run setup` с тем же workspace |

**Не** перезаписывай `config.json` вручную. **Не** удаляй `changes.json` без запроса.

## Для агента

- Репо: `projects/visbug-mcp-ru`
- Скрипт: `scripts/update.mjs`
- Бэкапы: `~/.visbug-mcp/backups/`
