import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { autoApplyWorkspace, detectWorkspaceLayout } from '../src/auto-apply.js'

function makeWorkspace(files) {
  const workspace = mkdtempSync(join(tmpdir(), 'visbug-auto-apply-'))
  for (const [relativePath, contents] of Object.entries(files)) {
    const path = join(workspace, relativePath)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, contents)
  }
  return workspace
}

test('applies style and unique visible text to a static index.html', () => {
  const workspace = makeWorkspace({
    'index.html': `<!doctype html>
<html><head><style>#hero .title { color: #111; }</style>
<script>const copy = 'Old headline';</script></head>
<body><main id="hero"><h1 class="title">Old headline</h1></main></body></html>`,
  })
  try {
    const changes = [
      { type: 'style', selector: '#hero .title', property: 'font-size', newValue: '42', applied: false },
      { type: 'text', selector: '#hero .title', oldValue: 'Old headline', newValue: 'New headline', applied: false },
    ]
    const result = autoApplyWorkspace(workspace, changes)
    const html = readFileSync(join(workspace, 'index.html'), 'utf8')

    assert.equal(detectWorkspaceLayout(workspace), 'static-html')
    assert.equal(result.applied, 2)
    assert.match(html, /font-size:\s*42px;/)
    assert.match(html, /<h1 class="title">New headline<\/h1>/)
    assert.match(html, /const copy = 'Old headline'/)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('applies drag left/top as transform and also writes width from same batch', () => {
  const longSelector = [
    'body > main.pt-20 > section.hero-section.relative.overflow-hidden.py-12.md\\:py-0:nth-of-type(1)',
    '> div.hero-shell.max-w-6xl.mx-auto.px-6:nth-of-type(3)',
    '> div.hero-grid.grid.grid-cols-1.md\\:grid-cols-12.gap-12',
    '> div.hero-text-col.md\\:col-span-7:nth-of-type(1)',
    '> div.hero-text-inner.w-full > div.space-y-2:nth-of-type(1)',
    '> h1.font-display.text-5xl.sm\\:text-6xl.font-semibold',
  ].join(' ')

  const workspace = makeWorkspace({
    'index.html': `<!doctype html>
<html><head><style>
.hero-section h1 { color: #111; }
</style></head>
<body><main><section class="hero-section"><h1 class="font-display">Title</h1></section></main></body></html>`,
  })
  try {
    const changes = [
      { type: 'style', selector: longSelector, property: 'position', newValue: 'relative', tag: 'h1', applied: false },
      { type: 'style', selector: longSelector, property: 'left', newValue: '240px', tag: 'h1', applied: false },
      { type: 'style', selector: longSelector, property: 'top', newValue: '-7px', tag: 'h1', applied: false },
      { type: 'style', selector: longSelector, property: 'width', newValue: '552px', tag: 'h1', applied: false },
      { type: 'style', selector: longSelector, property: 'cursor', newValue: 'move', tag: 'h1', applied: false },
    ]
    const result = autoApplyWorkspace(workspace, changes)
    const html = readFileSync(join(workspace, 'index.html'), 'utf8')

    assert.equal(result.applied, 3) // left+top + width
    assert.match(html, /transform:\s*translate\(240px,\s*-7px\);/)
    assert.match(html, /width:\s*552px/)
    assert.doesNotMatch(html, /margin-inline-start/)
    assert.equal(changes[1].applied, true)
    assert.equal(changes[2].applied, true)
    assert.equal(changes[3].applied, true)
    assert.equal(changes[0].applied, true) // position artifact
    assert.equal(changes[4].applied, true) // cursor artifact
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('applies explicit width when there is no Move in the batch', () => {
  const workspace = makeWorkspace({
    'index.html': `<!doctype html>
<html><head><style>.hero-section h1 { color: #111; }</style></head>
<body><main><section class="hero-section"><h1>Title</h1></section></main></body></html>`,
  })
  try {
    const changes = [
      { type: 'style', selector: '.hero-section h1', property: 'width', newValue: '400px', tag: 'h1', applied: false },
    ]
    const result = autoApplyWorkspace(workspace, changes)
    assert.equal(result.applied, 1)
    assert.match(readFileSync(join(workspace, 'index.html'), 'utf8'), /width:\s*400px;/)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('Move on eyebrow uses .chapter not all .hero-section p', () => {
  const longSelector = [
    'body > main.pt-20 > section.hero-section.relative:nth-of-type(1)',
    '> div.hero-shell > div.hero-grid > div.hero-text-col > div.hero-text-inner',
    '> p.chapter.mb-0',
  ].join(' ')

  const workspace = makeWorkspace({
    'index.html': `<!doctype html>
<html><head><style>.chapter { color: #B85C38; }</style></head>
<body><main><section class="hero-section">
  <p class="chapter">Глава</p>
  <h1>Name</h1>
  <p class="body">Other paragraph</p>
</section></main></body></html>`,
  })
  try {
    const changes = [
      { type: 'style', selector: longSelector, property: 'left', newValue: '0px', tag: 'p', applied: false },
      { type: 'style', selector: longSelector, property: 'top', newValue: '-63px', tag: 'p', applied: false },
    ]
    const result = autoApplyWorkspace(workspace, changes)
    const html = readFileSync(join(workspace, 'index.html'), 'utf8')

    assert.equal(result.applied, 2)
    assert.match(html, /\.hero-section \.chapter\s*\{[^}]*transform:\s*translate\(0px,\s*-63px\);/s)
    assert.doesNotMatch(html, /\.hero-section p\s*\{/)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('Move on #method card targets .lg\\:col-span-5 not whole #method', () => {
  const longSelector = [
    '#method > div.max-w-6xl.mx-auto.px-6',
    '> div.grid.grid-cols-1.lg\\:grid-cols-12.gap-12.items-center',
    '> div.lg\\:col-span-5.bg-parchment\\/30.p-8.rounded-\\[2rem\\].border.border-ink\\/5.relative.overflow-hidden:nth-of-type(2)',
  ].join(' ')

  const workspace = makeWorkspace({
    'index.html': `<!doctype html>
<html><head><style>#method { color: #111; }</style></head>
<body><section id="method"><div class="grid gap-12 items-center">
  <div class="lg:col-span-7">text</div>
  <div class="lg:col-span-5 bg-parchment/30">card</div>
</div></section></body></html>`,
  })
  try {
    const changes = [
      { type: 'style', selector: longSelector, property: 'left', newValue: '-48px', tag: 'div', applied: false },
      { type: 'style', selector: longSelector, property: 'top', newValue: '134px', tag: 'div', applied: false },
      { type: 'style', selector: longSelector, property: 'cursor', newValue: 'move', tag: 'div', applied: false },
      { type: 'style', selector: longSelector, property: 'transition', newValue: 'none', tag: 'div', applied: false },
    ]
    const result = autoApplyWorkspace(workspace, changes)
    const html = readFileSync(join(workspace, 'index.html'), 'utf8')

    assert.equal(result.applied, 2)
    // bottom-align intent → items-end, gap не трогаем transform'ом
    assert.match(html, /items-end/)
    assert.doesNotMatch(html, /items-center/)
    assert.doesNotMatch(html, /translate\(-48px/)
    assert.doesNotMatch(html, /#method\s*\{\s*transform:/)
    assert.equal(changes[2].applied, true)
    assert.equal(changes[3].applied, true)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('grid Move with left≈gap drops X and keeps gutter (no items-center path)', () => {
  const selector = [
    '#method > div.grid.gap-12',
    '> div.lg\\:col-span-5',
  ].join(' ')

  const workspace = makeWorkspace({
    'index.html': `<!doctype html>
<html><head><style>#method { color: #111; }</style></head>
<body><section id="method"><div class="grid gap-12">
  <div class="lg:col-span-5">card</div>
</div></section></body></html>`,
  })
  try {
    const changes = [
      { type: 'style', selector, property: 'left', newValue: '-47px', tag: 'div', applied: false },
      { type: 'style', selector, property: 'top', newValue: '10px', tag: 'div', applied: false },
    ]
    const result = autoApplyWorkspace(workspace, changes)
    const html = readFileSync(join(workspace, 'index.html'), 'utf8')

    assert.equal(result.applied, 2)
    assert.match(html, /transform:\s*translate\(0px,\s*10px\);/)
    assert.doesNotMatch(html, /translate\(-47px/)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('builder-rich-text p move accumulates existing margin-inline-start on container', () => {
  const longSelector = [
    '#services > div.site-container.monochrom-content-section__inner',
    '> div.mb-10.grid.grid-cols-1.gap-10.lg\\:mb-12.lg\\:grid-cols-12.lg\\:gap-16:nth-of-type(1)',
    '> div.flex.flex-col.justify-end.lg\\:col-span-5:nth-of-type(2)',
    '> div.builder-rich-text.text-sm > p:nth-of-type(1)',
  ].join(' ')

  const workspace = makeWorkspace({
    'src/styles/monochrom/sections.css': `#services .builder-rich-text {
  margin-inline-start: -136px;
}
`,
  })
  try {
    const changes = [
      { type: 'style', selector: longSelector, property: 'left', newValue: '32px', tag: 'p', applied: false },
    ]
    const result = autoApplyWorkspace(workspace, changes)
    const css = readFileSync(join(workspace, 'src/styles/monochrom/sections.css'), 'utf8')

    assert.equal(result.applied, 1)
    assert.match(css, /#services \.builder-rich-text[\s\S]*margin-inline-start:\s*-104px/)
    assert.doesNotMatch(css, /p:nth-of-type/)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('builder-rich-text p move writes container margin and strips per-paragraph rules', () => {
  const longSelector = [
    '#services > div.site-container.monochrom-content-section__inner',
    '> div.mb-10.grid.grid-cols-1.gap-10.lg\\:mb-12.lg\\:grid-cols-12.lg\\:gap-16:nth-of-type(1)',
    '> div.flex.flex-col.justify-end.lg\\:col-span-5:nth-of-type(2)',
    '> div.builder-rich-text.text-sm > p:nth-of-type(1)',
  ].join(' ')

  const workspace = makeWorkspace({
    'src/styles/monochrom/sections.css': `#services { color: #111; }
#services .builder-rich-text p:nth-of-type(1) { margin-inline-start: 12px; }
`,
  })
  try {
    const changes = [
      { type: 'style', selector: longSelector, property: 'left', newValue: '32px', tag: 'p', applied: false },
      { type: 'style', selector: longSelector, property: 'cursor', newValue: 'move', tag: 'p', applied: false },
    ]
    const result = autoApplyWorkspace(workspace, changes)
    const css = readFileSync(join(workspace, 'src/styles/monochrom/sections.css'), 'utf8')

    assert.equal(result.applied, 1)
    assert.equal(result.failed.length, 0)
    assert.match(css, /#services \.builder-rich-text[\s\S]*margin-inline-start:\s*32px/)
    assert.doesNotMatch(css, /p:nth-of-type\(1\)/)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('glow --start/--glow-mask are decorative artifacts not failures', () => {
  const workspace = makeWorkspace({
    'src/styles/monochrom/sections.css': '#rezultat { color: #111; }\n',
  })
  try {
    const changes = [
      {
        type: 'style',
        selector: '#rezultat > div.editorial-card-glow',
        property: '--start',
        newValue: '10deg',
        tag: 'div',
        applied: false,
      },
      {
        type: 'style',
        selector: '#rezultat > div.editorial-card-glow',
        property: '--glow-mask',
        newValue: 'linear-gradient(...)',
        tag: 'div',
        applied: false,
      },
    ]
    const result = autoApplyWorkspace(workspace, changes)
    assert.equal(result.applied, 0)
    assert.equal(result.failed.length, 0)
    assert.equal(result.artifacts, 2)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('keeps framework-src behavior for CSS and TSX text', () => {
  const workspace = makeWorkspace({
    'src/styles/sections.css': '#services { color: #111; }\n',
    'src/components/Hero.tsx': 'export const Hero = () => <h1>Old title</h1>\n',
  })
  try {
    const changes = [
      { type: 'style', selector: '#services .title', property: 'margin-top', newValue: '20', applied: false },
      { type: 'text', selector: '#services .title', oldValue: 'Old title', newValue: 'New title', applied: false },
    ]
    const result = autoApplyWorkspace(workspace, changes)

    assert.equal(detectWorkspaceLayout(workspace), 'framework-src')
    assert.equal(result.applied, 2)
    assert.match(readFileSync(join(workspace, 'src/styles/sections.css'), 'utf8'), /margin-top:\s*20px;/)
    assert.match(readFileSync(join(workspace, 'src/components/Hero.tsx'), 'utf8'), /New title/)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})
