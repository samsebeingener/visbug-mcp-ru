# Буфер VisBug → исходники (recorder-only)

Буфер из popup — **write-recipes v0.26**: одна готовая CSS-правка на узел + **snap-meta**, **before/after**, **warnings**, **src** (Code Connect lite), **confidence**, **parent-child-dedup** и **auto-stamp** (`vb-*` id, §11). Сырой `left`/`top`/`cursor` в буфер **не попадает**.

**Стеки:** static HTML и Next.js — одна математика, разные пути к файлам.

**Как Cursor узнаёт:** футер в буфере + rule `.cursor/rules/visbug-buffer-apply.mdc`.

Связанные контракты:

- `shared/code-connect-lite-contract.md` — `data-visbug-src` / `data-visbug-id`
- `shared/html-stable-target-contract.md` — стабильные селекторы HTML
- `shared/snap-meta.js` — exact → threshold → arbitrary

---

## 1. Write-recipes (v0.26)

```text
=== VisBug session ===
mode: write-recipes
contract: v0.26 snap-meta + before/after + src + confidence + parent-child-dedup + auto-stamp

--- src/components/Hero.tsx ---
[0] #hero-photo-wrap
  file: src/components/Hero.tsx
  src: src/components/Hero.tsx:42:10
  from: x translate(17px, 0px) + Δ(0px, 15px)
  lever: transform
  before:
    transform: translate(17px, 0px);
  after:
    transform: translate(17px, 15px);  # snap:exact
  write:
    transform: translate(17px, 15px);
  warnings:
    - (optional) width: snapped 538.672px → 539px
```

Агент **не копирует `write:` вслепую**.  
Сначала читает **`x_file`** (текущий `transform` / `margin` рычага в репо), затем:

`итог = x_file + Δ` (Δ из `from:` / `delta` / JSON).

`write:` / `after:` — предложение из **x_computed** браузера; если `x_computed ≠ x_file` (другой breakpoint, VisBug сбросил стиль, media query), побеждает **репо + Δ**.

Внутри формулы буфера: `x_computed + Δ = write` (рычаг transform или margin). Width/height — из `write:` после сверки с файлом (resize обычно абсолютный).

---

## 1.1. Поля блока

| Поле | Назначение |
|------|------------|
| `file:` | Путь для записи (из `src` / URL) |
| `src:` | Code Connect lite: `path:line:col` из `data-visbug-src` |
| `from:` / `lever:` | `x … + Δ(…)` и рычаг — **Δ обязателен** для MOVE |
| `before:` | Flatten CSS по **computed** до правки (аудит; ≠ гарантия `x_file`) |
| `after:` / `write:` | Предложение `x_computed + Δ` + snap; писать только после сверки с репо |
| `warnings:` | Snap / нет `visbug-src` / неоднозначность — не игнорировать молча |

---

## 1.2. Snap pipeline

Для px-значений (и `translate` / простой `margin`):

1. **exact** — `|n − round(n)| ≤ 0.05` → целое px  
2. **snapped** — ближайший шаг шкалы (4/8/12/16…), если относительная ошибка ≤ 5%  
3. **arbitrary** — иначе очищенный float (`toFixed(2)`), без слепого nearest  

Тег `# snap:…` в `after:` — метаданные. Итоговое значение MOVE всё равно пересчитывается от `x_file + Δ`.

---

## 1.3. Закон x_file (обязательно)

1. Открыть `file:` / `src:` и найти правило для селектора (и нужный `@media`, если desktop).
2. Прочитать **`x_file`** того же рычага (`transform` или `margin*`), что в `lever:`.
3. Взять **Δ** из `from:` (`+ Δ(ax, ay)`) или `write.delta` / JSON.
4. Записать **`x_file + Δ`** (после snap к целым px при необходимости).
5. Если в файле свойства нет — тогда `x_file = 0` и можно опереться на `write:`.
6. Если `before:` совпал с `x_file` — `write:` совпадёт с итогom; всё равно проверить один раз.
7. Не затирать другие части того же `transform` (например `hover:scale`) — только translate/margin-сдвиг.

**Антипример:** в CSS уже `translate(17px, 15px)`, буфер `from: x translate(0px, 0px) + Δ(86px, 6px)` и `write: translate(86px, 6px)` → в файл идёт **`translate(103px, 21px)`**, не 86/6.

---

## 2. Алгоритм агента

1. Секция `--- file ---` + `[N] селектор`.
2. Если есть **`src:`** — открыть этот файл (line:col — якорь; править CSS/class рядом с компонентом).
3. Для **MOVE** (`lever:` + Δ): **сверить `x_file` в репо** → записать `x_file + Δ` (см. §1.3). Не вставлять `write:` без этой проверки.
4. Для **STYLE** (цвет, opacity…) / абсолютных size без накопления — можно брать `write:` после взгляда на файл.
5. Прочитать **`warnings:`** — учесть (токен, неоднозначный файл).
6. `from:` / `before:` / `after:` — пояснение и контроль расхождения computed≠file.
7. Один блок = один узел. Не дублировать parent+child.
8. Desktop: правила обычно в `@media (min-width: 768px)` если так в файле.

---

## 3. Шум (не попадает в буфер)

`cursor`, `user-select`, `transition`, `will-change`, `position`, `left`, `top`, `right`, `bottom`, `undefined`/`null`.

**Подозрительный Δ:** `|Δ| > 75%` viewport — scroll; extension не пишет.

---

## 4. Рычаг (lever)

| Родитель | Рычаг |
|----------|-------|
| flex/grid с center/end | `transform` |
| обычный block | `margin` или `transform` (что уже в файле) |

---

## 5–6. (legacy) left/top без layout-delta

Если в буфере только color/text — писать как `write:`. left/top больше не приходят.

---

## 7. Single-node policy

Один drag = один write-блок. Не дублировать transform на parent+child.

---

## 8. HTML local dev

Без `<base href="/portfolio/...">` на localhost. Opt-in `id` / `data-visbug-id`.

---

## 9. Next.js + Code Connect lite

При `src: src/...tsx:L:C` — это точный якорь (Fiber `_debugSource` → `data-visbug-src` в dev).  
При только `file: src/...tsx` — править указанный файл / CSS рядом.  
Без `src:` в warnings будет `no-visbug-src`.

Подробности: `shared/code-connect-lite-contract.md`.

---

## 10. Tailwind

При `translate` + `hover:scale` — один `transform` с обоими. Не дублировать parent+child.

---

## 11. Auto-stamp (v0.26): `#vb-*` — перенести id в исходники при apply

Content-script автоматически штампует элемент, получивший записанную мутацию, если у него **нет** `id` / `data-vb*` / `data-visbug-*`: ставит в живой DOM `data-visbug-id="vb-<tag>-<NN>"` (`vb-div-01`, `vb-p-02`…). В буфере это выглядит так:

```text
=== VisBug session ===
files: index.html (1)
stamps:
  vb-div-01 → #hero-text-col > .hero-text-inner > div:nth-of-type(2)
mode: write-recipes

--- index.html ---
[0] #vb-div-01
  file: index.html
  write:
    transform: translate(0px, 12px);
  warnings:
    - stamp-pending: id exists in DOM only — persist to source on apply
```

- Рецепт идёт на **`#vb-<id>`** (stableSelector), `confidence: high`, в JSON — `stamp: {id, pending: true}`.
- `stamps:` секция — карта `id → исходный DOM-path на момент штампа`; по ней находите элемент в исходном HTML.

**Закон apply при stamp-pending:**

1. Найти в исходном HTML элемент по `originalSelector` из секции `stamps:` (или по контексту файла).
2. **Обязательно** добавить этому элементу `id="vb-…"` (допустимо `data-visbug-id="vb-…"`, если id уже занят логикой).
3. Правку CSS записывать под селектором **`#vb-…`**, а не под хрупким DOM-path.
4. После apply штамп становится постоянным: следующие сессии сразу получают стабильную цель без warnings.

Warning `stamp-pending` **заменяет** `no-visbug-src` / `manual_review` для проштампованных узлов — это не неоднозначность, а одноразовое действие «persist id».

---

## 12. JS-инлайн конфликт (v0.26): скрипты страницы, перезаписывающие наши свойства

**Симптом:** рецепт применён в CSS, но после reload элемент «не там» или «не того размера». Computed style показывает другое значение, а в DevTools у элемента виден **inline `style=""`**, которого нет в исходнике.

**Причина:** JS страницы (layout-скрипты, ресайзеры, галереи, слайдеры) пишет `el.style.width/transform/...` инлайном. Inline всегда сильнее любого CSS-правила — рецепт проигрывает.

**Закон apply:**

1. Перед записью рецепта проверить: не пишет ли JS страницы инлайн в те же свойства этого элемента. Как искать: grep по проекту — `.style.<prop>`, `style.setProperty`, `setAttribute('style'` рядом с селектором цели (типичные места: `syncLayout`, `onResize`, `window.addEventListener('resize'|'load')`).
2. Если конфликт есть — **не надеяться на CSS**. Варианты по приоритету:
   a. Пометить элемент `data-vb-lock` и научить конфликтный скрипт пропускать его (минимальная правка JS: early-skip при `hasAttribute('data-vb-lock')`, заодно очистить старые inline-значения один раз).
   b. Если JS трогает только при `resize`/мобильном брейкпоинте — можно оставить, но явно записать это в комментарии к правилу.
3. **После любого такого фикса база элемента меняется** — старые translate-рецепты съезжают. Пересчитать по `getBoundingClientRect()` (желаемый rect из dragRect буфера минус текущий untransformed rect), а не копировать прежний translate.
4. Проверка результата — только измерением в браузере: `getComputedStyle(el).transform/width` и `el.getBoundingClientRect()` против `dragRect` из буфера. Совпадение в пределах 1–2px = PASS.

**Backlog (продукт):** детект на стороне расширения — при flush сверять `el.getAttribute('style')` с ожидаемым после reload; при расхождении добавлять warning `js-inline-conflict: страница перезаписывает <prop> инлайном`.
