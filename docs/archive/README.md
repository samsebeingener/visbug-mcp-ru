# Архив спецификаций (до v0.13)

Эти документы описывали **auto-apply**, Actions v2, layout-solver и React-bridge.  
В **v0.13** код удалён; актуальная модель — **recorder-only** + ручной patch по [`../shared/apply-buffer-contract.md`](../shared/apply-buffer-contract.md).

| Файл | Было | Статус |
|------|------|--------|
| `layout-solve-contract.md` | Авто-перевод MOVE → gap/margin | Не реализовано, код вырезан |
| `run-packet-contract.md` | Контекст для Cursor Agent CLI | Не используется |
| `onlook-bridge-contract.md` | `data-visbug-id` / Onlook bridge | Будущее, opt-in |

Вернуть в продукт — только с новым ADR и кодом, не копировать в `shared/` как будто уже работает.
