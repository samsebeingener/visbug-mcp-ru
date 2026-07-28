import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseVisbugSrc,
  resolveSourceFilePath,
  readRulePropFromCss,
  resolveApplySelectorWithVisbug,
} from '../src/visbug-src.js'
import { autoApplyWorkspace } from '../src/auto-apply.js'

function makeWorkspace(files) {
  const workspace = mkdtempSync(join(tmpdir(), 'visbug-src-'))
  for (const [relativePath, contents] of Object.entries(files)) {
    const path = join(workspace, relativePath)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, contents)
  }
  return workspace
}

test('parseVisbugSrc splits path:line:column', () => {
  const parsed = parseVisbugSrc('src/components/sections/pricing.tsx:59:17')
  assert.equal(parsed.relativePath, 'src/components/sections/pricing.tsx')
  assert.equal(parsed.line, 59)
  assert.equal(parsed.column, 17)
  assert.equal(parsed.raw, 'src/components/sections/pricing.tsx:59:17')
})

test('readRulePropFromCss prefers visbug-src comment block', () => {
  const css = `/* visbug-src: src/components/sections/pricing.tsx:59:17 */
#services .builder-rich-text {
  margin-inline-start: -136px;
}
#services .builder-rich-text p { margin-inline-start: 32px; }
`
  assert.equal(
    readRulePropFromCss(css, '#services .builder-rich-text', 'margin-inline-start', 'src/components/sections/pricing.tsx:59:17'),
    -136,
  )
})

test('resolveApplySelectorWithVisbug upgrades p to builder-rich-text block', () => {
  const workspace = makeWorkspace({
    'src/components/sections/pricing.tsx': [
      'export function Pricing() {',
      '  return (',
      '    <section id="services">',
      '      <BuilderRichText html={copy} />',
      '    </section>',
      '  )',
      '}',
    ].join('\n'),
  })
  try {
    const change = {
      visbugSrc: 'src/components/sections/pricing.tsx:4:7',
      selector: '#services .builder-rich-text p:nth-of-type(1)',
      tag: 'p',
    }
    const next = resolveApplySelectorWithVisbug(
      change,
      '#services .builder-rich-text p:nth-of-type(1)',
      workspace,
    )
    assert.equal(next, '#services .builder-rich-text')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('auto-apply with visbugSrc writes linked CSS block and accumulates margin', () => {
  const longSelector = [
    '#services > div.site-container',
    '> div.builder-rich-text.text-sm > p:nth-of-type(1)',
  ].join(' ')

  const workspace = makeWorkspace({
    'src/components/sections/pricing.tsx': [
      'export function Pricing() {',
      '  return (',
      '    <section id="services">',
      '      <BuilderRichText html={copy} />',
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
    const css = readFileSync(join(workspace, 'src/styles/monochrom/sections.css'), 'utf8')
    const tsx = readFileSync(join(workspace, 'src/components/sections/pricing.tsx'), 'utf8')

    assert.equal(result.applied, 1)
    assert.match(tsx, /-ml-\[104px\]/)
    assert.match(css, /margin-inline-start:\s*-136px/)
    assert.doesNotMatch(css, /margin-inline-start:\s*-104px/)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('text replace prefers visbugSrc file when unique', () => {
  const workspace = makeWorkspace({
    'src/components/Hero.tsx': 'export const Hero = () => <h1>Old title</h1>\n',
    'src/components/Footer.tsx': 'export const Footer = () => <p>Old title elsewhere</p>\n',
  })
  try {
    const changes = [
      {
        type: 'text',
        selector: '#hero h1',
        oldValue: 'Old title',
        newValue: 'New title',
        visbugSrc: 'src/components/Hero.tsx:1:35',
        applied: false,
      },
    ]
    const result = autoApplyWorkspace(workspace, changes)
    const hero = readFileSync(join(workspace, 'src/components/Hero.tsx'), 'utf8')
    const footer = readFileSync(join(workspace, 'src/components/Footer.tsx'), 'utf8')

    assert.equal(result.applied, 1)
    assert.match(hero, /New title/)
    assert.match(footer, /Old title elsewhere/)
    assert.equal(resolveSourceFilePath(workspace, 'src/components/Hero.tsx:1:35'), join(workspace, 'src/components/Hero.tsx'))
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})
