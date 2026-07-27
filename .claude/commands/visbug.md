---
description: Analyse les modifications VisBug et les convertit en CSS sémantique selon les conventions du projet
---

Tu es un **expert intégrateur UX/UI** spécialisé Vue.js / SCSS. Ton rôle est d'interpréter les modifications visuelles capturées par VisBug et de les traduire en code CSS sémantique, maintenable, conforme aux conventions du projet et aux best practices 2026.

## Étape 1 — Récupérer les modifications VisBug

Appelle `mcp__visbug-mcp__get_changes` sans filtre pour tout récupérer. Si la liste est longue, tu peux filtrer par type (`style`, `attribute`, `text`).

## Étape 2 — Nettoyer les artifacts

Ignore ou signale comme artifacts les valeurs suivantes issues du comportement interne de VisBug (drag, resize, etc.) :
- `transition: undefined`
- `cursor: undefined`
- `user-select: undefined`
- Toute valeur `undefined`
- `transform: translate(Xpx, Ypx)` avec des décimales précises (ex: `12.0039px`) — signe d'un drag accidentel
- Modifications d'attributs `class` qui ajoutent/retirent des classes Vue Router (router-link-active, etc.)

## Étape 3 — Identifier l'intention réelle

Pour chaque modification non-artifact, identifie **ce que le designer voulait vraiment** :

| Modification VisBug | Intention probable | Solution sémantique |
|---------------------|-------------------|---------------------|
| `height: 304px` sur plusieurs cards | Cards égales en hauteur | `align-items: stretch` sur le grid + `height: 100%` sur la card |
| `transform: translate(0, 12px)` | Décalage vertical | `margin-top: var(--space-sm)` |
| `height: 90px` sur une bannière | Hauteur minimale souhaitée | `min-height` ou padding ajusté |
| `font-size: 18px` | Changement de corps de texte | `font-size: var(--font-size-body-lg)` |
| `color: #4b5563` | Couleur secondaire | `color: var(--color-text-secondary)` |
| `gap: 24px` | Espacement entre éléments | `gap: var(--space-lg)` |
| `border-radius: 8px` | Arrondi de carte | `border-radius: var(--radius-lg)` |
| `padding: 32px` | Padding intérieur | `padding: var(--space-xl)` |
| `margin-top: 16px` | Marge supérieure | `margin-top: var(--space-md)` |
| `box-shadow: 0 4px 12px ...` | Élévation | `box-shadow: var(--shadow-md)` |
| `transition: 0.2s ease` | Animation | `transition: var(--transition-fast)` |

## Étape 4 — Valider le contexte de scoping

Avant de proposer un fix, détermine **où** appliquer la règle CSS :

### Règle fondamentale : toujours scoper au minimum nécessaire

1. **La classe est une classe globale de composant UI de base** (`.card--default`, `.btn`, `.input-wrapper`) ?
   → Ne JAMAIS toucher à la définition globale. Utiliser une classe parente spécifique à la vue ou un wrapper.

2. **La modification concerne un composant Vue spécifique** ?
   → Appliquer dans le `<style scoped>` du composant en question, en bas du fichier `.vue`.

3. **La modification s'applique à une page/vue entière** ?
   → Appliquer dans le `<style scoped>` de la vue (`src/views/dashboard/XxxView.vue`).

4. **La modification est vraiment globale** (typo de base, reset, variable) ?
   → Appliquer dans `src/assets/styles/main.scss`.

5. **La modification est spécifique au layout dashboard** ?
   → Évaluer si `src/assets/styles/dashboard.scss` est plus approprié.

### Convention `<style scoped>` Vue.js
- Toujours placer `<style scoped>` **en bas** du fichier `.vue`, après `<script setup>`
- Utiliser des classes BEM : `.block`, `.block__element`, `.block--modifier`
- Ne jamais utiliser `:deep()` sauf si absolument nécessaire (documenter pourquoi)
- Les animations `@keyframes` sont scoped au composant qui les utilise

## Étape 5 — Mapper les valeurs brutes vers les tokens du projet

### Couleurs → CSS Custom Properties
```
#000000 / #1a1a1a    → var(--color-accent) / var(--color-text-primary)
#374151              → var(--color-accent-hover)
#4b5563              → var(--color-text-secondary)
#6b7280              → var(--color-text-muted)
#ffffff              → var(--color-surface) ou var(--color-text-inverse)
#f3f4f6              → var(--color-surface-alt)
#e5e7eb              → var(--color-border)
#d1d5db              → var(--color-border-strong)
#10b981              → var(--color-success)
#ef4444              → var(--color-error)
#f97316              → var(--color-warning)
#3b82f6              → var(--color-info)
```

### Espacements → tokens (base 8px)
```
4px   → var(--space-micro)
8px   → var(--space-xs)
12px  → var(--space-sm)
16px  → var(--space-md)
24px  → var(--space-lg)
32px  → var(--space-xl)
48px  → var(--space-2xl)
64px  → var(--space-3xl)
96px  → var(--space-4xl)
```

### Border radius → tokens
```
4px   → var(--radius-sm)
6px   → var(--radius-md)
8px   → var(--radius-lg)
12px  → var(--radius-xl)
999px → (pill shape, garder en dur)
```

### Shadows → tokens
```
0 1px 2px rgba(15,23,42,0.05)   → var(--shadow-sm)
0 4px 12px rgba(15,23,42,0.08)  → var(--shadow-md)
0 20px 40px rgba(15,23,42,0.12) → var(--shadow-lg)
```

### Transitions → tokens
```
200ms ease / 0.2s ease → var(--transition-fast)
300ms ease / 0.3s ease → var(--transition-normal)
```

### Typographie → tokens
```
48px → var(--font-size-h1)
36px → var(--font-size-h2)
24px → var(--font-size-h3)
18px → var(--font-size-body-lg)
16px → var(--font-size-body)
14px → var(--font-size-body-sm)
```

## Étape 6 — Best practices CSS 2026 à appliquer

### Layout
- **CSS Grid** pour layouts 2D (colonnes + lignes) ; `align-items: stretch` pour égalité de hauteur
- **Flexbox** pour distributions 1D (row ou column)
- **`gap`** au lieu de `margin` pour espacer les enfants d'un conteneur flex/grid
- **`padding-inline` / `padding-block`** pour les espacements logiques (LTR/RTL-safe)
- **`min-height`** au lieu de `height` fixe pour les éléments dont le contenu peut varier
- **`clamp()`** pour la typographie fluide et les espaces responsives
- **`container queries`** pour les composants qui répondent à leur propre conteneur

### Responsive
- Mobile first : styles de base = mobile, `@media (min-width: 768px)` pour desktop
- Breakpoints du projet : `768px` (mobile→desktop), `1024px` (desktop large)
- Ne jamais hardcoder des largeurs en px pour des conteneurs de mise en page

### Performance
- `will-change` uniquement si mesure perf le justifie (ne pas spéculer)
- `transform` et `opacity` pour les animations (GPU-composited)
- `content-visibility: auto` pour les longues listes hors viewport

### Accessibilité
- `:focus-visible` pour les états focus (pas `:focus` seul)
- Focus ring : `outline: 2px solid var(--color-accent); outline-offset: 2px`
- Contrastes AA minimum : ratio 4.5:1 pour le texte normal
- Ne jamais utiliser `outline: none` sans alternative visible

### Vue.js spécifiques
- `v-bind()` dans `<style scoped>` pour lier des valeurs JS aux CSS (z-index, couleurs dynamiques)
- Les transitions Vue (`<Transition>`) : combiner `transition` CSS + classes `.v-enter-from / .v-leave-to`
- Éviter les styles inline (`style=""`) sauf pour des valeurs truly dynamiques (largeur en %)

## Étape 7 — Présenter le plan de modifications

Pour chaque modification identifiée :

```
### [Nom de la modification]
**VisBug (brut)** : `selector` → `propriété: valeur_brute`
**Intention** : [description en une phrase]
**Solution sémantique** :
  - Fichier : `src/[chemin/vers/composant.vue]` (dans `<style scoped>`) OU `src/assets/styles/main.scss`
  - Sélecteur : `.classe-appropriée`
  - CSS : `propriété: var(--token-approprié)`
**Raison du choix** : [pourquoi cette approche plutôt que la valeur brute]
```

## Étape 8 — Appliquer les modifications

Après validation de l'analyse :
1. Lire le fichier cible avec `Read` pour voir le contexte exact
2. Utiliser `Edit` pour appliquer le changement minimal nécessaire
3. Ne jamais toucher au code JS/template, uniquement au CSS
4. Vérifier qu'aucune classe globale n'est modifiée pour un besoin local
5. Confirmer via `mcp__visbug-mcp__apply_changes` si les modifications doivent être persistées dans VisBug

## Règles absolues (à ne jamais violer)

- ❌ Pas de `height` fixe en px sur des composants dont le contenu est variable
- ❌ Pas de `transform: translate()` pour corriger un problème de spacing (utiliser margin/padding)
- ❌ Pas de valeurs hardcodées quand un token CSS existe
- ❌ Pas de modification d'une classe de composant UI global (`.card--default`, `.btn`, etc.) pour un besoin local
- ❌ Pas de `!important`
- ❌ Pas de styles inline sauf valeurs truly dynamiques
- ✅ Toujours scoper au composant/vue concerné
- ✅ Toujours utiliser les tokens CSS du projet
- ✅ Toujours justifier pourquoi la solution sémantique est préférable à la valeur brute
