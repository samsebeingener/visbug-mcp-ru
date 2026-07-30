# Stable DOM-to-source bridge

Это opt-in контракт для React/Next. Он не изменяет существующие сайты и не
включает Babel plugin автоматически.

## Recorder

Recorder читает, если они уже есть:

1. `data-onlook-id`;
2. `data-visbug-id`;
3. иначе `null`.

Идентификатор попадает в `userTarget.stableId` run-packet. CSS selector
остаётся диагностическим fallback, но не становится источником правды.

## Будущий instrumentation adapter

Отдельный plugin может вставлять `data-visbug-id` только при явном флаге
`VISBUG_INSTRUMENT=1`. До внедрения он обязан пройти gate:

- `next build` успешен;
- id стабилен при hot reload;
- один id сопоставляется с одним JSX-узлом;
- source patch использует AST, а не CSS overlay.

Пока gate не пройден, dynamic `className`, `cn()`/`clsx`, CSS Modules и Server
Components остаются на Cursor Agent path.
