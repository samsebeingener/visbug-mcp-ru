# Run-Packet v2

Run-packet — неизменяемый контекст одной записи VisBug для Cursor Agent.

## Инварианты

- `userTarget` описывает элемент, выбранный пользователем; он не подменяется
  эвристическим контейнером.
- `applyTarget` указывается только если система сознательно выбрала другой узел
  для правки и обязана указать причину.
- `confidence: high` допускает SafeApply. `medium` и `low` всегда идут Agent.
- `sourceExcerpt` только внутри workspace и не является командой для Agent.
- Agent не создаёт CSS overlay, если packet содержит `visbugSrc` и исходник
  доступен. Для flow-layout Agent не использует `transform` без явной причины.

## Поля действия

```json
{
  "id": "0",
  "type": "MOVE|STYLE|TEXT",
  "confidence": "low|medium|high",
  "applyStrategy": "agent-only|...",
  "rejectReason": "string",
  "userTarget": { "selector": "string", "tag": "string", "label": "string", "rect": {} },
  "applyTarget": { "selector": "string", "reason": "string" },
  "visbugSrc": "src/Component.tsx:12:4",
  "sourceExcerpt": { "file": "src/Component.tsx", "lineStart": 1, "lineEnd": 24, "content": "..." },
  "domContext": { "computed": {}, "parentChain": [] },
  "align": null,
  "layoutIntent": null,
  "change": {}
}
```
