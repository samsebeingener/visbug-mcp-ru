import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  mergeMarginUtility,
  mergeTranslateUtilities,
  parseTransformTranslate,
  readMarginUtilityPx,
  readTranslateUtilityPx,
  resolveMoveTargetPx,
  resolveTranslateTargets,
  tryApplyDimensionAst,
  tryApplyMoveAst,
  tryApplyTranslateAst,
} from '../src/ast-apply.js'
import { autoApplyWorkspace } from '../src/auto-apply.js'

function makeWorkspace(files) {
  const workspace = mkdtempSync(join(tmpdir(), 'visbug-ast-'))
  for (const [relativePath, contents] of Object.entries(files)) {
    const path = join(workspace, relativePath)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, contents)
  }
  return workspace
}

test('mergeMarginUtility uses tailwind-merge for ml utilities', () => {
  const next = mergeMarginUtility('text-sm p-4 ml-[10px]', 'margin-inline-start', -104)
  assert.match(next, /-ml-\[104px\]/)
  assert.doesNotMatch(next, /ml-\[10px\]/)
  assert.match(next, /text-sm/)
})

test('readMarginUtilityPx parses arbitrary ml classes', () => {
  assert.equal(readMarginUtilityPx('foo -ml-[136px] bar', 'margin-inline-start'), -136)
  assert.equal(readMarginUtilityPx('ml-[32px]', 'margin-inline-start'), 32)
  assert.equal(readMarginUtilityPx('text-sm', 'margin-inline-start'), null)
})

test('tryApplyMoveAst patches string className on JSX at visbug-src line', () => {
  const workspace = makeWorkspace({
    'src/components/sections/pricing.tsx': [
      'export function Pricing() {',
      '  return (',
      '    <section id="services">',
      '      <BuilderRichText html={copy} className="text-sm builder-rich-text" />',
      '    </section>',
      '  )',
      '}',
    ].join('\n'),
  })
  try {
    const result = tryApplyMoveAst(workspace, {
      visbugSrc: 'src/components/sections/pricing.tsx:4:7',
    }, {
      prop: 'margin-inline-start',
      value: '-104px',
    })
    const tsx = readFileSync(join(workspace, 'src/components/sections/pricing.tsx'), 'utf8')

    assert.equal(result.ok, true)
    assert.match(tsx, /className="[^"]*-ml-\[104px\][^"]*"/)
    assert.doesNotMatch(tsx, /sections\.css/)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('resolveMoveTargetPx accumulates CSS visbug-src block + delta', () => {
  const workspace = makeWorkspace({
    'src/components/sections/pricing.tsx': [
      'export function Pricing() {',
      '  return <BuilderRichText className="text-sm" />',
      '}',
    ].join('\n'),
    'src/styles/sections.css': `/* visbug-src: src/components/sections/pricing.tsx:2:10 */
#services .builder-rich-text {
  margin-inline-start: -136px;
}
`,
  })
  try {
    const targetPx = resolveMoveTargetPx(
      workspace,
      { visbugSrc: 'src/components/sections/pricing.tsx:2:10' },
      { prop: 'margin-inline-start' },
      '#services .builder-rich-text',
      { type: 'file', path: join(workspace, 'src/styles/sections.css') },
      { newValue: '32px' },
      null,
    )
    assert.equal(targetPx, -104)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('parseTransformTranslate reads translate() CSS values', () => {
  assert.deepEqual(parseTransformTranslate('translate(240px, -7px)'), { x: 240, y: -7 })
  assert.equal(parseTransformTranslate('none'), null)
})

test('mergeTranslateUtilities uses tailwind-merge for translate utilities', () => {
  const next = mergeTranslateUtilities('text-lg translate-x-[10px]', { x: 240, y: -7 })
  assert.match(next, /translate-x-\[240px\]/)
  assert.match(next, /-translate-y-\[7px\]/)
  assert.doesNotMatch(next, /translate-x-\[10px\]/)
})

test('tryApplyTranslateAst patches translate-x/y on JSX at visbug-src', () => {
  const workspace = makeWorkspace({
    'src/components/Hero.tsx': [
      'export function Hero() {',
      '  return <h1 className="hero-title text-4xl">Title</h1>',
      '}',
    ].join('\n'),
  })
  try {
    const result = tryApplyTranslateAst(workspace, {
      visbugSrc: 'src/components/Hero.tsx:2:10',
    }, { x: 240, y: -7 })
    const tsx = readFileSync(join(workspace, 'src/components/Hero.tsx'), 'utf8')

    assert.equal(result.ok, true)
    assert.match(tsx, /translate-x-\[240px\]/)
    assert.match(tsx, /-translate-y-\[7px\]/)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('tryApplyDimensionAst patches w-[Npx] on JSX at visbug-src', () => {
  const workspace = makeWorkspace({
    'src/components/Hero.tsx': [
      'export function Hero() {',
      '  return <h1 className="hero-title">Title</h1>',
      '}',
    ].join('\n'),
  })
  try {
    const result = tryApplyDimensionAst(workspace, {
      visbugSrc: 'src/components/Hero.tsx:2:10',
    }, 'width', '552px')
    const tsx = readFileSync(join(workspace, 'src/components/Hero.tsx'), 'utf8')

    assert.equal(result.ok, true)
    assert.match(tsx, /w-\[552px\]/)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('tryApplyDimensionAst blocks dangerouslySetInnerHTML hosts', () => {
  const workspace = makeWorkspace({
    'src/components/Rich.tsx': [
      'export function Rich({ html }) {',
      '  return <div dangerouslySetInnerHTML={{ __html: html }} className="prose" />',
      '}',
    ].join('\n'),
  })
  try {
    const result = tryApplyDimensionAst(workspace, {
      visbugSrc: 'src/components/Rich.tsx:2:10',
    }, 'width', '400px')
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'dangerously-set-inner-html')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('resolveTranslateTargets accumulates CSS transform overlay + delta', () => {
  const workspace = makeWorkspace({
    'src/components/Hero.tsx': [
      'export function Hero() {',
      '  return <h1 className="hero-title">Title</h1>',
      '}',
    ].join('\n'),
    'src/styles/hero.css': `/* visbug-src: src/components/Hero.tsx:2:10 */
.hero-title {
  transform: translate(100px, 0px);
}
`,
  })
  try {
    const targets = resolveTranslateTargets(
      workspace,
      { visbugSrc: 'src/components/Hero.tsx:2:10' },
      { prop: 'transform', value: 'translate(40px, -7px)' },
      '.hero-title',
      { type: 'file', path: join(workspace, 'src/styles/hero.css') },
      { newValue: '40px' },
      { newValue: '-7px' },
    )
    assert.deepEqual(targets, { x: 140, y: -7 })
    assert.equal(readTranslateUtilityPx('translate-x-[10px]', 'x'), 10)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('auto-apply prefers AST translate className when visbugSrc present', () => {
  const longSelector = '#hero > h1.hero-title'
  const workspace = makeWorkspace({
    'src/components/Hero.tsx': [
      'export function Hero() {',
      '  return (',
      '    <section id="hero">',
      '      <h1 className="hero-title">Old</h1>',
      '    </section>',
      '  )',
      '}',
    ].join('\n'),
    'src/styles/hero.css': '#hero .hero-title { color: #111; }\n',
  })
  try {
    const changes = [
      {
        type: 'style',
        selector: longSelector,
        property: 'left',
        newValue: '240px',
        tag: 'h1',
        visbugSrc: 'src/components/Hero.tsx:4:7',
        applied: false,
      },
      {
        type: 'style',
        selector: longSelector,
        property: 'top',
        newValue: '-7px',
        tag: 'h1',
        visbugSrc: 'src/components/Hero.tsx:4:7',
        applied: false,
      },
    ]
    const result = autoApplyWorkspace(workspace, changes)
    const tsx = readFileSync(join(workspace, 'src/components/Hero.tsx'), 'utf8')
    const css = readFileSync(join(workspace, 'src/styles/hero.css'), 'utf8')

    assert.equal(result.applied, 2)
    assert.match(tsx, /translate-x-\[240px\]/)
    assert.match(tsx, /-translate-y-\[7px\]/)
    assert.doesNotMatch(css, /transform:\s*translate/)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('auto-apply prefers AST width className when visbugSrc present', () => {
  const workspace = makeWorkspace({
    'src/components/Hero.tsx': [
      'export function Hero() {',
      '  return <h1 className="hero-title">Title</h1>',
      '}',
    ].join('\n'),
    'src/styles/hero.css': '.hero-title { color: #111; }\n',
  })
  try {
    const changes = [
      {
        type: 'style',
        selector: '.hero-title',
        property: 'width',
        newValue: '552px',
        tag: 'h1',
        visbugSrc: 'src/components/Hero.tsx:2:10',
        applied: false,
      },
    ]
    const result = autoApplyWorkspace(workspace, changes)
    const tsx = readFileSync(join(workspace, 'src/components/Hero.tsx'), 'utf8')
    const css = readFileSync(join(workspace, 'src/styles/hero.css'), 'utf8')

    assert.equal(result.applied, 1)
    assert.match(tsx, /w-\[552px\]/)
    assert.doesNotMatch(css, /width:\s*552px/)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('auto-apply prefers AST margin className when visbugSrc present (no CSS write)', () => {
  const longSelector = '#services .builder-rich-text > p:nth-of-type(1)'
  const workspace = makeWorkspace({
    'src/components/sections/pricing.tsx': [
      'export function Pricing() {',
      '  return (',
      '    <section id="services">',
      '      <BuilderRichText html={copy} className="text-sm builder-rich-text" />',
      '    </section>',
      '  )',
      '}',
    ].join('\n'),
    'src/styles/monochrom/sections.css': `/* visbug-src: src/components/sections/pricing.tsx:4:7 */
#services .builder-rich-text {
  margin-inline-start: -136px;
}
`,
  })
  try {
    const changes = [
      {
        type: 'style',
        selector: longSelector,
        property: 'left',
        newValue: '32px',
        tag: 'p',
        visbugSrc: 'src/components/sections/pricing.tsx:4:7',
        applied: false,
      },
    ]
    const result = autoApplyWorkspace(workspace, changes)
    const tsx = readFileSync(join(workspace, 'src/components/sections/pricing.tsx'), 'utf8')
    const css = readFileSync(join(workspace, 'src/styles/monochrom/sections.css'), 'utf8')

    assert.equal(result.applied, 1)
    assert.match(tsx, /-ml-\[104px\]/)
    assert.match(css, /margin-inline-start:\s*-136px/)
    assert.doesNotMatch(css, /margin-inline-start:\s*-104px/)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})
