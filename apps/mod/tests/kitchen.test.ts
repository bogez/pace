import { expect, mock, test } from 'claude-code/testing'

// Thursday 2026-10-01 12:00 UTC; the week resets 84h later → 50% elapsed.
const NOW = Date.parse('2026-10-01T12:00:00Z')
const RESET = new Date(NOW + 84 * 36e5).toISOString()
const reading = (weekPct: number) => [
  { kind: 'seven_day', percentUsed: weekPct, resetsAt: RESET },
  { kind: 'five_hour', percentUsed: 12, resetsAt: new Date(NOW + 2 * 36e5).toISOString() },
]

const PANE = {
  plugin: 'pace-kitchen',
  component: 'Pane',
  requestId: 'pace-kitchen',
  viewport: { columns: 120, rows: 40 },
  props: {
    title: 'Pace kitchen',
    isFocused: false,
    bodyColumns: 60,
    placement: 'inline',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

function stubSession(on: any, writes: Map<string, string>, limits = reading(50)) {
  mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/home/cook' })
  on('session.start', () => ({ cwd: '/work' }))
  on('session.usage', () => ({ value: { startedAt: NOW, rateLimits: limits } }))
  on('session.measure', ($: any, e: any) => ({ changed: e.changed }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.blit', () => ({ value: {} }))
  on('fs.write', ($: any, e: any) => {
    writes.set(e.path, e.text)
    return { value: undefined }
  })
}

test('on pace, the terminal pane draws the chef cooking perfectly', async ($, on) => {
  stubSession(on, new Map())
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.command.run({ command: 'pace', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'chef' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^● in the zone — cooking perfectly$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /week 50% used · 50% of the week gone · 5h 12%/ })).toBeDefined()
})

test('Desktop gets an animated Svg instead of a Raster', async ($, on) => {
  stubSession(on, new Map())
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const svg = await ui.find({ type: 'Svg' })
  expect(svg).toBeDefined()
  expect(svg.props.isInteractive).toBe(true)
  expect(svg.props.source).toContain('<animate')
})

test('running far ahead of the clock burns the dish', async ($, on) => {
  const writes = new Map<string, string>()
  stubSession(on, writes, [])
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.session.measure({ context: { window: 200000 }, rateLimits: reading(90), changed: ['rateLimits'] })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^▲▲ overheating — it's burning/ })).toBeDefined()
})

test('a measurement is teed to ~/.pace/usage.json in the statusline format', async ($, on) => {
  const writes = new Map<string, string>()
  stubSession(on, writes, [])
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.session.measure({ context: { window: 200000 }, rateLimits: reading(50), changed: ['rateLimits'] })
  const doc = JSON.parse(writes.get('/home/cook/.pace/usage.json') ?? 'null')
  expect(doc.source).toBe('claude-code-mod')
  expect(doc.rate_limits.seven_day).toEqual({ used_percentage: 50, resets_at: (NOW + 84 * 36e5) / 1000 })
  expect(doc.rate_limits.five_hour.used_percentage).toBe(12)
})

test('/pace <mood> previews a mood with its real state words', async ($, on) => {
  stubSession(on, new Map())
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.command.run({ command: 'pace', args: 'cold' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^▼▼ cold — / })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\/pace live/ })).toBeDefined()
  const bad = await $.command.run({ command: 'pace', args: 'raw' })
  expect(bad.text).toMatch(/Unknown mood "raw"/)
})

test('the spinner carries the pace state while Claude works', async ($, on) => {
  stubSession(on, new Map())
  on('ui.render', ($: any, e: any) => ({ type: 'Text', props: {}, children: [e.props.word + e.props.suffix] }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const ui = await $.ui.mount({
    plugin: 'pace-kitchen',
    component: 'Spinner',
    requestId: 'main',
    surface: 'terminal',
    props: { word: 'Sauteing', message: null, suffix: '…', mode: 'requesting' },
  } as any)
  expect(await ui.find({ type: 'Text', text: 'Sauteing · pace ● in the zone…' })).toBeDefined()
})

test('the terminal chef animates by blitting frames at the mood tempo', async ($, on) => {
  const blits: string[] = []
  const writes = new Map<string, string>()
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/home/cook' })
  on('session.start', () => ({ cwd: '/work' }))
  on('session.usage', () => ({ value: { startedAt: NOW, rateLimits: reading(50) } }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.blit', ($: any, e: any) => {
    blits.push(e.cells)
    return { value: {} }
  })
  on('fs.write', ($: any, e: any) => (writes.set(e.path, e.text), { value: undefined }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.command.run({ command: 'pace', args: '' })
  await $.ui.mount({ ...PANE, surface: 'terminal' })
  // zone frames are 260ms on a 50ms tick: due at 300, 550, 800, 1050
  await clock.advance(1200)
  expect(blits.length).toBe(4)
  expect(new Set(blits).size).toBe(4) // four distinct frames
})
