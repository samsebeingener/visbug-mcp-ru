# Code Connect lite — DOM → файл без Figma

Аналог [figma/code-connect](https://github.com/figma/code-connect) для VisBug Bridge: **явная связка узла DOM с исходником**, чтобы агент не угадывал файл по длинному селектору.

Zero-config: код сайта **не** правится. Stamp делает companion extension в **dev** на localhost.

---

## 1. Атрибуты

| Атрибут | Кто ставит | Пример | Приоритет |
|---------|------------|--------|-----------|
| `data-visbug-src` | `react-source-bridge.js` (Fiber `_debugSource`) | `src/components/Hero.tsx:42:10` | 1 — точный файл |
| `data-visbug-source-confidence` | bridge | `exact` | мета |
| `data-visbug-id` / `id` | автор HTML (opt-in) | `hero-portrait` | 2 — стабильный селектор |
| короткий селектор | `selector-short.js` | `#hero-portrait` | 3 — fallback |

В буфере:

```text
  file: src/components/Hero.tsx
  src: src/components/Hero.tsx:42:10
```

`file:` — куда писать; `src:` — якорь line:col (Code Connect lite).

---

## 2. React / Next (dev)

1. Daemon online → content-script `armGuides` → `VisbugMcpReactBridge.stampAll(root)`.
2. Перед commit layout-delta — `ensureStamped(el)` (узел + предки).
3. MutationObserver — stamp новых узлов после hydration / client navigate.
4. Чтение: `snapshot.readVisbugSrc(el)` → поле `visbugSrc` в mutation → `write.src` в рецепте.

**Не требует** Babel / next.config. Плагин `instrument/babel-plugin-visbug-src.js` — только fallback для CI без Fiber debug source.

---

## 3. Static HTML

Fiber нет → `data-visbug-src` обычно пуст. Используй:

- `id="…"` или `data-visbug-id="…"` (см. `html-stable-target-contract.md`);
- регистрацию workspace в `~/.visbug-mcp/config.json` → `file: index.html`.

Warning в буфере: `no-visbug-src: file inferred — prefer data-visbug-src / data-visbug-id`.

---

## 4. Правила для агента

1. Есть `src:` → открыть этот path; не искать файл по селектору.
2. Line:col — ориентир; правка часто в CSS рядом / `className` / `<style>`, не обязательно в той же строке JSX.
3. Нет `src:` → `file:` + селектор; не изобретать новый компонент.
4. Не снимать `data-visbug-*` в prod-сборке сайта (их ставит только extension на localhost).

---

## 5. Связанные файлы

- `extension/react-source-bridge.js` — stamp
- `extension/snapshot.js` — `readVisbugSrc` / `readStableId`
- `src/target-resolver.js` — `visbugSrc` → `file`
- `src/actions/write-recipe.js` — `write.src` + warning
- `shared/apply-buffer-contract.md` — §9
