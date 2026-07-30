# HTML stable target contract (opt-in)

Для static HTML кейсов (portfolio, лендинги) VisBug recorder может стабильно указывать узел агенту без длинного `body > main > …`.

Для React/Next см. **Code Connect lite**: `shared/code-connect-lite-contract.md` (`data-visbug-src`).

## Рекомендации

1. **Приоритет идентификаторов**
   - `id` на hero-узлах (`#hero-portrait`)
   - или `data-visbug-id="hero-portrait"` (читается в `extension/snapshot.js` → `stableId`)
   - Next/React: `data-visbug-src` ставит extension автоматически в dev
   - **Приоритет источника (v0.24):** `data-vb-source` (атрибут или предок) > `data-visbug-src` / `data-vb` > React Fiber `_debugSource`; расхождение атрибут ↔ fiber → `confidence: ambiguous` + warning `manual_review` в write-recipe

2. **Не засорять prod**
   - Не инжектить id на все страницы автоматически
   - Только на узлы, которые часто правят в VisBug (hero image, CTA, quote block)

3. **Классы**
   - Семантический класс (`.hero-portrait`) — fallback для короткого селектора
   - Utility-only классы Tailwind не использовать как единственный target

4. **Локальная разработка**
   - Избегать `<base href="/portfolio/...">` при `python -m http.server` на `localhost`
   - Пути к `uploads/` должны быть относительными от корня dev-сервера

## Пример (tatiana-tihomirova)

```html
<img
  id="hero-portrait"
  class="hero-portrait"
  src="uploads/hero-tatiana.png"
  alt="…"
/>
```

Буфер после drag:

```text
селектор (короткий): #hero-portrait
| stable: #hero-portrait
--- index.html ---
```

**Не схлопывать** child в родительский `#id`: путь `#hero-text-col > … > p:nth-of-type(2)` → короткий `#hero-text-col > p:nth-of-type(2)`, не `#hero-text-col`.

## Связанные файлы

- `extension/snapshot.js` — `readStableId`, `readVisbugSrc`
- `extension/react-source-bridge.js` — stamp `data-visbug-src`
- `src/selector-short.js` — короткий селектор (leaf-first)
- `shared/apply-buffer-contract.md` — §7–§9
- `shared/code-connect-lite-contract.md` — DOM→файл
