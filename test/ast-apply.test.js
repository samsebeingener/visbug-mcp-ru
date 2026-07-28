import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  mergeMarginUtility,
  readMarginUtilityPx,
  resolveMoveTargetPx,
  tryApplyMoveAst,
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

test('auto-apply prefers AST className when visbugSrc present (no CSS write)', () => {
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
