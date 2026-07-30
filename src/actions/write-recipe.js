/**
 * actions/write-recipe.js — одна готовая CSS-правка на узел (capture+compile).
 * v0.21: snap-meta + before/after + warnings + src (Code Connect lite)
 *        + stylesToSet/classesToRemove (Tailwind conflicts, recorder-only).
 * v0.25: P4 parent/child MOVE dedup — коррелированные Δ родителя и ребёнка
 *        схлопываются в один блок записи (child-suppressed warning).
 * v0.26: auto-stamp — узел без id получает vb-<tag>-<NN>; рецепт на #vb-*,
 *        confidence high, warning stamp-pending, секция stamps в буфере.
 */

import {
  formatApplyRecipe,
  formatTransformParts,
  hasNonTranslateParts,
  parseTransformParts,
  suggestLever,
  visualOffsetFromParts,
} from '../../shared/layout-lever.js'
import { findConflictingClasses } from './tw-conflicts.js'
import { flattenCssMap, snapDeclaration } from '../../shared/snap-meta.js'
import { enrichChangeSelectors } from '../selector-short.js'
import { resolveTargetFile } from '../target-resolver.js'
import { ACTIONS_SCHEMA_VERSION, buildActionTarget, styleOp } from './schema.js'

/** Drag-артефакты VisBug — никогда не пишем в файл (MOVE несёт intent). */
export const DRAG_ARTIFACT_PROPS = new Set([
  'cursor',
  'user-select',
  'transition',
  'will-change',
  'position',
  'left',
  'top',
  'right',
  'bottom',
])

const SIZE_PROPS = new Set(['width', 'height'])

/**
 * @param {string} prop
 * @returns {boolean}
 */
export function isDragArtifactProp(prop) {
  return DRAG_ARTIFACT_PROPS.has(prop)
}

function nodeKey(change) {
  return change.diagnosticSelector ?? change.selector ?? change.shortSelector ?? ''
}

function displaySelector(change) {
  if (change.stampId) return `#${change.stampId}`
  return change.shortSelector
    || change.stableId
    || change.diagnosticSelector
    || change.selector
    || 'unknown'
}

/**
 * @param {object} change
 * @returns {string | null}
 */
function readVisbugSrc(change) {
  return change.visbugSrc ?? change.target?.visbugSrc ?? null
}

/**
 * P3: confidence источника узла.
 * high = visbugSrc/data-vb-source; medium = короткий селектор; low = длинный DOM path.
 * @param {object} targetChange
 * @param {string | null} visbugSrc
 * @returns {'high' | 'medium' | 'low'}
 */
function computeSourceConfidence(targetChange, visbugSrc) {
  if (visbugSrc) return 'high'
  const short = String(targetChange.shortSelector ?? '').trim()
  const isLongPath = !short || short.includes(' > ') || /:nth-(?:of-type|child)\(/.test(short)
  return isLongPath ? 'low' : 'medium'
}

/**
 * P3: ambiguity — атрибут источника и fiber разошлись (react-source-bridge).
 * @param {object} targetChange
 * @returns {boolean}
 */
function hasSourceAmbiguity(targetChange) {
  return targetChange.ambiguity === true
    || targetChange.sourceConfidence === 'ambiguous'
    || targetChange.sourceRef?.confidence === 'ambiguous'
}

/**
 * formatMargin возвращает полную декларацию ("margin-top: 92px") —
 * нельзя класть её как value у prop "margin".
 * @param {string} hint
 * @returns {{ prop: string, value: string }[] | null}
 */
function parseMarginHintToDeclarations(hint) {
  const s = String(hint ?? '').trim().replace(/;$/, '')
  if (!s) return null
  if (s.startsWith('margin-top:')) {
    return [{ prop: 'margin-top', value: s.replace(/^margin-top:\s*/, '') }]
  }
  if (s.startsWith('margin-inline-start:')) {
    return [{ prop: 'margin-inline-start', value: s.replace(/^margin-inline-start:\s*/, '') }]
  }
  if (s.startsWith('margin:')) {
    return [{ prop: 'margin', value: s.replace(/^margin:\s*/, '') }]
  }
  return [{ prop: 'margin-top', value: s }]
}

/**
 * @param {string} xFileHint
 * @param {string} prop
 */
function marginBeforeValue(xFileHint, prop) {
  const decls = parseMarginHintToDeclarations(xFileHint)
  const hit = decls?.find((d) => d.prop === prop)
  return hit?.value ?? xFileHint
}

/**
 * P4: допуск корреляции Δ родителя и ребёнка (px по обеим осям).
 */
const PARENT_CHILD_DELTA_TOLERANCE_PX = 2

/**
 * P4: собрать множество селекторов, которыми может быть описан узел рецепта.
 * @param {object} recipe
 * @param {object} change
 * @returns {Set<string>}
 */
function recipeSelectorSet(recipe, change) {
  return new Set([
    recipe.write?.selector,
    recipe.target?.stableSelector,
    change?.diagnosticSelector,
    change?.selector,
    change?.shortSelector,
  ].filter((s) => typeof s === 'string' && s.trim()))
}

/**
 * P4: является ли parent-предком child в DOM по данным layout-delta.
 * Источники истины: child.parentLayout.selector / layoutContext.parent.selector
 * (точное совпадение с селектором родителя) либо prefix-match DOM path
 * ("parentPath > childPath") по diagnosticSelector/selector.
 * @param {object} parentRecipe
 * @param {object} parentChange
 * @param {object} childChange
 * @returns {boolean}
 */
function isAncestorPair(parentRecipe, parentChange, childChange) {
  const parentSelectors = recipeSelectorSet(parentRecipe, parentChange)
  const childParentSelector = childChange?.parentLayout?.selector
    ?? childChange?.layoutContext?.parent?.selector
    ?? null
  if (childParentSelector && parentSelectors.has(childParentSelector)) return true

  const childPath = String(childChange?.diagnosticSelector ?? childChange?.selector ?? '')
  if (!childPath.includes(' > ')) return false
  for (const p of [parentChange?.diagnosticSelector, parentChange?.selector]) {
    if (typeof p === 'string' && p && p !== childPath && childPath.startsWith(`${p} > `)) {
      return true
    }
  }
  return false
}

/**
 * P4: схлопнуть коррелированные parent/child MOVE-рецепты.
 * Δ родителя и ребёнка совпадают (±2px по обеим осям) → ребёнок дублирует
 * родительский сдвиг: дропаем дочерний MOVE, родителю — warning
 * `child-suppressed: <childSelector>`. STYLE-рецепты не трогаем.
 * @param {object[]} recipes
 * @param {Map<object, object>} moveChanges — recipe → исходный layout-delta change
 * @returns {object[]}
 */
/** Пропсы, которые пишет сам displacement-рычаг (не независимый рестайл). */
const MOVE_WRITE_PROPS = new Set(['transform', 'margin', 'margin-inline-start', 'margin-top', 'margin-left'])

function collapseCorrelatedParentChildMoves(recipes, moveChanges) {
  const moveRecipes = recipes.filter((r) => moveChanges.has(r))
  if (moveRecipes.length < 2) return recipes

  const dropped = new Set()
  for (const parent of moveRecipes) {
    if (dropped.has(parent)) continue
    const parentChange = moveChanges.get(parent)
    const parentDelta = parent.write?.delta ?? { x: 0, y: 0 }
    for (const child of moveRecipes) {
      if (child === parent || dropped.has(child)) continue
      const childChange = moveChanges.get(child)
      if (!isAncestorPair(parent, parentChange, childChange)) continue
      const childDelta = child.write?.delta ?? { x: 0, y: 0 }
      if (
        Math.abs(parentDelta.x - childDelta.x) > PARENT_CHILD_DELTA_TOLERANCE_PX
        || Math.abs(parentDelta.y - childDelta.y) > PARENT_CHILD_DELTA_TOLERANCE_PX
      ) continue
      const childSelector = child.write?.selector ?? 'unknown'
      parent.write.warnings.push(`child-suppressed: ${childSelector}`)
      // Дочерний MOVE с собственным рестайлом (color/font/…): не дропаем рецепт,
      // а демотируем в STYLE — displacement покрывает родитель, рестайл остаётся.
      const restDecl = (child.write?.declarations ?? []).filter((d) => !MOVE_WRITE_PROPS.has(d.prop))
      if (restDecl.length) {
        child.type = 'STYLE'
        child.write.declarations = restDecl
        child.write.stylesToSet = restDecl
        child.write.css = restDecl.map((d) => `${d.prop}: ${d.value};`).join('\n')
        child.write.from = null
        child.write.lever = null
        child.write.delta = null
        child.write.transformParts = null
        child.write.xComputed = null
        child.layoutIntent = null
        moveChanges.delete(child)
        continue
      }
      dropped.add(child)
    }
  }

  if (!dropped.size) return recipes
  return recipes.filter((r) => !dropped.has(r))
}

/**
 * Собрать write-рецепты: 1 узел = 1 блок с готовым CSS.
 * @param {object[]} changes
 * @returns {object[]}
 */
export function compileWriteRecipes(changes) {
  /** @type {Map<string, { move?: object, sizes: Map<string, { old, new }>, styles: Map<string, { old, new }>, meta: object }>} */
  const byNode = new Map()

  for (const raw of changes) {
    if (raw.applied) continue
    const change = enrichChangeSelectors({
      ...raw,
      fileHint: raw.fileHint ?? resolveTargetFile(raw),
    })
    const key = nodeKey(change)
    if (!key) continue

    if (!byNode.has(key)) {
      byNode.set(key, {
        move: null,
        sizes: new Map(),
        styles: new Map(),
        meta: change,
        className: null,
        newClasses: [],
      })
    }
    const bucket = byNode.get(key)
    bucket.meta = { ...bucket.meta, ...change }

    if (typeof change.className === 'string' && change.className.trim()) {
      bucket.className = change.className
    }

    if (change.type === 'attribute' && change.attribute === 'class') {
      bucket.className = bucket.className ?? change.oldValue ?? null
      bucket.newClasses = String(change.newValue ?? '').split(/\s+/).filter(Boolean)
      continue
    }

    if (change.type === 'layout-delta') {
      bucket.move = change
      continue
    }

    if (change.type === 'style') {
      const prop = change.property
      if (isDragArtifactProp(prop)) continue
      if (prop === 'transform') {
        // MOVE важнее inline transform VisBug
        if (!bucket.move) {
          bucket.styles.set('transform', {
            old: change.oldValue,
            new: change.newValue,
          })
        }
        continue
      }
      if (SIZE_PROPS.has(prop) && styleOp(prop, change.newValue) === 'set') {
        bucket.sizes.set(prop, {
          old: change.oldValue ?? null,
          new: change.newValue,
        })
        continue
      }
      if (styleOp(prop, change.newValue) === 'set') {
        bucket.styles.set(prop, {
          old: change.oldValue,
          new: change.newValue,
        })
      }
    }

    if (change.type === 'text') {
      bucket.styles.set('__text__', {
        old: change.oldValue,
        new: change.newValue,
      })
    }
  }

  const recipes = []
  /** @type {Map<object, object>} recipe → layout-delta change (P4) */
  const moveChanges = new Map()

  for (const [, bucket] of byNode) {
    /** @type {{ prop: string, value: string, snap?: object }[]} */
    const declarations = []
    /** @type {Record<string, string>} */
    const beforeMap = {}
    /** @type {Record<string, string>} */
    const afterMap = {}
    /** @type {Record<string, object>} */
    const snapMeta = {}
    /** @type {string[]} */
    const warnings = []

    let lever = null
    let delta = null
    let xBefore = null
    let fromHint = null
    let transformParts = null
    let type = 'STYLE'

    if (bucket.move) {
      type = 'MOVE'
      const parent = bucket.move.parentLayout ?? bucket.move.layoutContext?.parent
      lever = bucket.move.lever ?? suggestLever(parent)
      const xComputed = bucket.move.offsetBefore
        ? visualOffsetFromParts(bucket.move.offsetBefore)
        : { tx: 0, ty: 0 }
      xBefore = xComputed
      delta = { x: bucket.move.deltaX ?? 0, y: bucket.move.deltaY ?? 0 }
      const recipe = formatApplyRecipe({
        lever,
        xComputed,
        deltaX: delta.x,
        deltaY: delta.y,
      })
      // P2: сохранить scale()/rotate() из computed transform при merge Δ
      const baseParts = bucket.move.offsetBefore?.transformParts
        ?? (bucket.move.offsetBefore?.transformRaw
          ? parseTransformParts(bucket.move.offsetBefore.transformRaw)
          : {
              tx: bucket.move.offsetBefore?.transform?.tx ?? 0,
              ty: bucket.move.offsetBefore?.transform?.ty ?? 0,
              scaleX: 1,
              scaleY: 1,
              rotate: 0,
            })
      transformParts = {
        tx: baseParts.tx + delta.x,
        ty: baseParts.ty + delta.y,
        scaleX: baseParts.scaleX,
        scaleY: baseParts.scaleY,
        rotate: baseParts.rotate,
      }
      const preserveParts = lever === 'transform' && hasNonTranslateParts(baseParts)
      const marginDecls = lever === 'margin'
        ? parseMarginHintToDeclarations(recipe.resultHint)
        : null
      if (marginDecls) {
        for (const d of marginDecls) {
          const snapped = snapDeclaration(d.prop, d.value)
          declarations.push({
            prop: snapped.prop,
            value: snapped.value,
            snap: snapped.snap,
          })
          beforeMap[d.prop] = marginBeforeValue(recipe.xFileHint, d.prop)
          afterMap[d.prop] = snapped.value
          snapMeta[d.prop] = snapped.snap
          if (snapped.warning) warnings.push(snapped.warning)
        }
      } else {
        const prop = 'transform'
        const transformValue = preserveParts
          ? formatTransformParts(transformParts)
          : recipe.resultHint
        const snapped = snapDeclaration(prop, transformValue)
        declarations.push({
          prop,
          value: snapped.value,
          snap: snapped.snap,
        })
        beforeMap[prop] = preserveParts
          ? (bucket.move.offsetBefore?.transformRaw ?? recipe.xFileHint)
          : recipe.xFileHint
        afterMap[prop] = snapped.value
        snapMeta[prop] = snapped.snap
        if (snapped.warning) warnings.push(snapped.warning)
      }
      fromHint = `x ${recipe.xFileHint} + Δ(${delta.x}px, ${delta.y}px)`
      bucket.styles.delete('transform')

      // resize (в т.ч. resize-only без сдвига позиции)
      const intent = bucket.move.editIntent
      if (intent === 'resize' || intent === 'move+resize') {
        const rb = bucket.move.rectBefore
        const ra = bucket.move.rectAfter
        if (rb && ra) {
          for (const prop of ['width', 'height']) {
            if (rb[prop] == null || ra[prop] == null || rb[prop] === ra[prop]) continue
            const snapped = snapDeclaration(prop, `${ra[prop]}px`)
            declarations.push({ prop, value: snapped.value, snap: snapped.snap })
            beforeMap[prop] = `${rb[prop]}px`
            afterMap[prop] = snapped.value
            snapMeta[prop] = snapped.snap
            if (snapped.warning) warnings.push(snapped.warning)
          }
        }
      }
    }

    for (const [prop, pair] of bucket.sizes) {
      const snapped = snapDeclaration(prop, pair.new)
      declarations.push({ prop, value: snapped.value, snap: snapped.snap })
      if (pair.old != null) beforeMap[prop] = String(pair.old)
      afterMap[prop] = snapped.value
      snapMeta[prop] = snapped.snap
      if (snapped.warning) warnings.push(snapped.warning)
    }

    for (const [prop, pair] of bucket.styles) {
      if (prop === '__text__') continue
      const snapped = snapDeclaration(prop, pair.new)
      declarations.push({ prop, value: snapped.value, snap: snapped.snap })
      if (pair.old != null) beforeMap[prop] = String(pair.old)
      afterMap[prop] = snapped.value
      snapMeta[prop] = snapped.snap
      if (snapped.warning) warnings.push(snapped.warning)
    }

    const textPair = bucket.styles.get('__text__')
    if (textPair && declarations.length === 0 && !bucket.move) {
      type = 'TEXT'
    }

    if (declarations.length === 0 && !textPair) continue

    const css = declarations
      .map((d) => `${d.prop}: ${d.value};`)
      .join('\n')

    const targetChange = bucket.move ?? bucket.meta
    const stampId = targetChange.stampId ?? null
    const visbugSrc = readVisbugSrc(targetChange)
    let confidence
    if (stampId) {
      // v0.26 auto-stamp: id уже в DOM (pending) — заменяет no-visbug-src/manual_review
      confidence = 'high'
      warnings.push('stamp-pending: id exists in DOM only — persist to source on apply')
    } else {
      if (!visbugSrc) {
        warnings.push('no-visbug-src: file inferred — prefer data-vb-source / data-visbug-src / data-visbug-id')
      }
      confidence = computeSourceConfidence(targetChange, visbugSrc)
      const ambiguity = hasSourceAmbiguity(targetChange)
      if (ambiguity || confidence === 'low') {
        warnings.push('manual_review')
      }
    }

    const before = flattenCssMap(beforeMap)
    const after = flattenCssMap(afterMap)

    const capturedClassName = bucket.className ?? targetChange.className ?? ''
    const classesToRemove = bucket.newClasses.length
      ? findConflictingClasses(capturedClassName, bucket.newClasses)
      : []

    const recipe = {
      type,
      schemaVersion: ACTIONS_SCHEMA_VERSION,
      target: buildActionTarget({
        ...targetChange,
        shortSelector: displaySelector(targetChange),
        fileHint: targetChange.fileHint ?? resolveTargetFile(targetChange),
      }),
      write: {
        selector: displaySelector(targetChange),
        file: targetChange.fileHint ?? resolveTargetFile(targetChange),
        src: visbugSrc,
        confidence,
        css,
        declarations,
        stylesToSet: declarations,
        classesToRemove,
        from: fromHint,
        lever,
        delta,
        transformParts,
        xComputed: xBefore,
        before,
        after,
        snap: snapMeta,
        warnings,
      },
      text: textPair
        ? { oldValue: textPair.old, newValue: textPair.new }
        : undefined,
      align: bucket.move?.align ?? null,
      editIntent: bucket.move?.editIntent ?? null,
      layoutIntent: bucket.move?.layoutIntent ?? null,
      stamp: stampId ? { id: stampId, pending: true } : undefined,
      applied: false,
      timestamp: targetChange.timestamp ?? null,
    }
    recipes.push(recipe)
    if (type === 'MOVE') moveChanges.set(recipe, bucket.move)
  }

  // P4: коррелированные Δ родителя и ребёнка — один блок записи (child-suppressed)
  return collapseCorrelatedParentChildMoves(recipes, moveChanges)
}

/**
 * v0.26: собрать карту штампов для секции `stamps:` буфера.
 * Приоритет — stamps из extension (originalSelector на момент штампа);
 * иначе derive из рецептов (diagnosticSelector).
 * @param {object[]} recipes
 * @param {object[]} stamps
 * @returns {{ id: string, originalSelector: string }[]}
 */
function collectStampLines(recipes, stamps) {
  const byId = new Map()
  for (const s of stamps ?? []) {
    if (s?.id) byId.set(s.id, { id: s.id, originalSelector: s.originalSelector ?? '' })
  }
  for (const r of recipes) {
    const id = r.stamp?.id
    if (!id || byId.has(id)) continue
    byId.set(id, {
      id,
      originalSelector: r.target?.diagnosticSelector ?? r.target?.stableSelector ?? '',
    })
  }
  return [...byId.values()]
}

/**
 * Человекочитаемый буфер: только write-рецепты.
 * @param {object[]} recipes
 * @param {{ workspace?: string | null, stamps?: object[] }} [opts]
 */
export function formatWriteRecipesBuffer(recipes, { workspace, stamps = [] } = {}) {
  if (!recipes.length) return ''

  const fileGroups = new Map()
  for (const r of recipes) {
    const file = r.write?.file ?? r.target?.fileHint ?? 'index.html'
    if (!fileGroups.has(file)) fileGroups.set(file, [])
    fileGroups.get(file).push(r)
  }

  const header = ['=== VisBug session ===']
  if (workspace) header.push(`workspace: ${workspace}`)
  header.push(
    `files: ${[...fileGroups.entries()].map(([f, items]) => `${f} (${items.length})`).join(', ')}`,
  )
  // v0.26: auto-stamp — новые vb-* id (в DOM, pending до apply в исходники)
  const stampLines = collectStampLines(recipes, stamps)
  if (stampLines.length) {
    header.push('stamps:')
    for (const s of stampLines) {
      header.push(`  ${s.id} → ${s.originalSelector || '(selector unknown)'}`)
    }
  }
  header.push('mode: write-recipes')
  header.push('contract: v0.26 snap-meta + before/after + src + confidence + parent-child-dedup + auto-stamp')
  // P4 buffer note: какие дочерние MOVE подавлены корреляцией с родителем
  const suppressedChildren = recipes.flatMap((r) => (r.write?.warnings ?? [])
    .filter((w) => w.startsWith('child-suppressed:'))
    .map((w) => w.slice('child-suppressed:'.length).trim()))
  if (suppressedChildren.length) {
    header.push(`parent-child-dedup: suppressed ${suppressedChildren.length} child MOVE (${suppressedChildren.join(', ')})`)
  }
  header.push('')

  const sections = []
  let index = 0
  for (const [file, items] of fileGroups) {
    sections.push(`--- ${file} ---`)
    for (const r of items) {
      const sel = r.write?.selector ?? r.target?.stableSelector ?? '?'
      const lines = [
        `[${index}] ${sel}`,
        `  file: ${file}`,
      ]
      if (r.write?.src) {
        lines.push(`  src: ${r.write.src}`)
      }
      if (r.write?.confidence && r.write.confidence !== 'high') {
        const mr = (r.write?.warnings ?? []).includes('manual_review') ? ' (manual_review)' : ''
        lines.push(`  confidence: ${r.write.confidence}${mr}`)
      }
      if (r.write?.from) lines.push(`  from: ${r.write.from}`)
      if (r.write?.lever) lines.push(`  lever: ${r.write.lever}`)
      if (r.editIntent) lines.push(`  intent: ${r.editIntent}`)

      const before = r.write?.before ?? {}
      const after = r.write?.after ?? {}
      const beforeKeys = Object.keys(before)
      if (beforeKeys.length) {
        lines.push('  before:')
        for (const k of beforeKeys) {
          lines.push(`    ${k}: ${before[k]};`)
        }
      }
      if (Object.keys(after).length) {
        lines.push('  after:')
        for (const [k, v] of Object.entries(after)) {
          const match = r.write?.snap?.[k]?.match
          const tag = match && match !== 'passthrough' ? `  # snap:${match}` : ''
          lines.push(`    ${k}: ${v};${tag}`)
        }
      }

      lines.push('  write:')
      for (const decl of r.write?.declarations ?? []) {
        lines.push(`    ${decl.prop}: ${decl.value};`)
      }
      const classesToRemove = r.write?.classesToRemove ?? []
      if (classesToRemove.length) {
        lines.push(`  remove-classes: ${classesToRemove.join(' ')}`)
      }
      if (r.text) {
        lines.push(`  text: "${r.text.newValue}" (было: "${r.text.oldValue ?? ''}")`)
      }
      if (r.align?.reference?.selector) {
        lines.push(
          `  align-hint: ${r.align.reference.selector} (${r.align.reference.edge ?? r.align.edge ?? 'edge'})`,
        )
      }
      if (r.layoutIntent) {
        lines.push(`  layout-intent: ${JSON.stringify(r.layoutIntent)}`)
      }
      const warnings = r.write?.warnings ?? []
      if (warnings.length) {
        lines.push('  warnings:')
        for (const w of warnings) {
          lines.push(`    - ${w}`)
        }
      }
      sections.push(lines.join('\n'))
      index += 1
    }
    sections.push('')
  }

  return [...header, ...sections].join('\n').trimEnd()
}

/**
 * @param {object[]} changes
 * @returns {string}
 */
export function formatWriteRecipesJsonBlock(changes) {
  const recipes = compileWriteRecipes(changes)
  if (!recipes.length) return ''
  return `--- write-recipes.json ---\n${JSON.stringify(recipes, null, 0)}`
}
