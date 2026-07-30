import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveShortSelector, enrichChangeSelectors } from '../src/selector-short.js'

test('deriveShortSelector prefers stableId on leaf', () => {
  const long = 'body > main > section.hero-section > img.hero-portrait'
  assert.equal(deriveShortSelector(long, { stableId: 'hero-portrait' }), '#hero-portrait')
})

test('deriveShortSelector extracts id on leaf segment', () => {
  const sel = 'body > main > #method-quote'
  assert.equal(deriveShortSelector(sel), '#method-quote')
})

test('deriveShortSelector picks semantic class on leaf', () => {
  const sel = 'body > main > section.hero-section > img.hero-portrait'
  assert.equal(deriveShortSelector(sel), '.hero-portrait')
})

test('deriveShortSelector does not collapse child to ancestor #id', () => {
  const sel =
    '#hero-text-col > div.hero-text-inner.w-full.flex.flex-col.gap-6 > p.text-base.sm\\:text-lg.lg\\:text-xl.text-ink-muted.max-w-xl.leading-relaxed:nth-of-type(2)'
  assert.equal(
    deriveShortSelector(sel, { tag: 'p' }),
    '#hero-text-col > .hero-text-inner > p:nth-of-type(2)',
  )
})

test('deriveShortSelector keeps quote leaf under column id', () => {
  const sel =
    '#hero-text-col > div.hero-text-inner.w-full.flex.flex-col.gap-6 > div.relative.pl-6.py-2.lg\\:py-3.border-l-2.border-terracotta\\/40.bg-parchment\\/30.rounded-r-2xl.pr-4:nth-of-type(2)'
  assert.equal(
    deriveShortSelector(sel, { tag: 'div' }),
    '#hero-text-col > .hero-text-inner > div:nth-of-type(2)',
  )
})

test('deriveShortSelector keeps space-y wrapper for h2', () => {
  const sel =
    '#hero-text-col > div.hero-text-inner.w-full.flex.flex-col.gap-6 > div.space-y-2.sm\\:space-y-3:nth-of-type(1) > h2.font-display.text-2xl'
  assert.equal(
    deriveShortSelector(sel, { tag: 'h2' }),
    '#hero-text-col > .hero-text-inner > .space-y-2 > h2',
  )
})

test('deriveShortSelector ignores ancestor-only stableId', () => {
  const sel = '#hero-text-col > div.hero-text-inner > p:nth-of-type(2)'
  assert.equal(
    deriveShortSelector(sel, { stableId: 'hero-text-col', tag: 'p' }),
    '#hero-text-col > .hero-text-inner > p:nth-of-type(2)',
  )
})

test('enrichChangeSelectors keeps diagnostic path', () => {
  const diagnostic = 'body > main > img.hero-portrait'
  const enriched = enrichChangeSelectors({
    selector: diagnostic,
    stableId: 'hero-portrait',
    tag: 'img',
  })
  assert.equal(enriched.shortSelector, '#hero-portrait')
  assert.equal(enriched.diagnosticSelector, diagnostic)
  assert.equal(enriched.selector, '#hero-portrait')
})

test('enrichChangeSelectors hero text leaf stays leaf', () => {
  const diagnostic =
    '#hero-text-col > div.hero-text-inner > p.text-ink-muted:nth-of-type(2)'
  const enriched = enrichChangeSelectors({
    selector: diagnostic,
    tag: 'p',
  })
  assert.equal(enriched.shortSelector, '#hero-text-col > .hero-text-inner > p:nth-of-type(2)')
  assert.notEqual(enriched.shortSelector, '#hero-text-col')
})
