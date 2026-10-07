import { describe, expect, test } from 'claude-code/testing'

import { bandLayout, fit, priorityOf, statusOf, statusText, toBandCard, width } from '../hooks/band'
import { band, bandTarget, card, sync, world } from './world'

const END = (reason: string) => ({ reason, sessionId: 's1', resume: { id: 's1' } }) as any
const BROKEN_PAIR = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/

// A session bound to one card (matched by worktree), the band mounted above it.
async function bound($: any, on: any, over: object = {}, columns = 115, branch?: string) {
  const w = world(on, { branch, cards: [card('P-1', { worktree: '/work/x', title: 'Fix login redirect loop on mobile Safari', status: 'in_progress', priority: 'high', ...over })] })
  await $.session.start(w.start)
  const ui = await $.ui.mount(bandTarget(columns))
  return { w, ui }
}

describe('band: states, symbols and theme keys (D20)', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`linked on ${surface}: stripe, id, status, priority, title, then agent / branch on the right`, async ($, on) => {
      const w = world(on, { cards: [card('P-1', { worktree: '/work/x', title: 'Fix login', status: 'in_progress', priority: 'high' })] })
      await $.session.start(w.start)
      const ui = await $.ui.mount(bandTarget(115, {}, surface))
      const b = await band(ui)
      expect(b.shown).toEqual(['▌', 'P-1', ' ◐', ' in_progress', ' ▲', ' high', ' Fix login', 'claude · ⎇ feat/x'])
      expect(b.colorOf('◐')).toBe('warning')
      expect(b.colorOf('▲')).toBe('error')
      expect(b.colorOf('in_progress')).toBeUndefined() // words are plain text: only the symbols carry a theme color
      expect(b.colorOf('high')).toBeUndefined()
      expect(b.segs[6]!.color).toBeUndefined() // the title is plain text
      expect(b.segs.at(-1)).toMatchObject({ dim: true })
      await ui.unmount()
    })
  }

  test('status words and colors: backlog inactive, in_progress warning, review permission, done success', async ($, on) => {
    const w = world(on, { cards: [card('P-1'), card('P-2'), card('P-3'), card('P-4')] })
    await $.session.start(w.start)
    const ui = await $.ui.mount(bandTarget(115))
    const seen: Record<string, [string | undefined, string]> = {}
    for (const [id, status] of [['P-1', 'backlog'], ['P-2', 'in_progress'], ['P-3', 'review'], ['P-4', 'done']] as const) {
      w.cards.find((c) => c.id === id)!.status = status
      await sync($, `link ${id}`)
      const b = await band(ui)
      seen[status] = [b.segs[2]!.color, b.segs[2]!.text + b.segs[3]!.text]
    }
    expect(seen).toEqual({
      backlog: ['inactive', ' ○ backlog'], in_progress: ['warning', ' ◐ in_progress'],
      review: ['permission', ' ◑ review'], done: ['success', ' ● done'],
    })
  })

  test('only high priority is red; med and low have different shapes and no color', async ($, on) => {
    const w = world(on, { cards: [card('P-1', { priority: 'med' })] })
    await $.session.start(w.start)
    const ui = await $.ui.mount(bandTarget(115))
    await sync($, 'link P-1')
    let b = await band(ui)
    expect(b.segs[4]).toMatchObject({ text: ' ◆', color: undefined, dim: false })
    expect(b.segs[5]).toMatchObject({ text: ' med', color: undefined, dim: false })
    w.cards[0]!.priority = 'low'
    await sync($, 'link P-1')
    b = await band(ui)
    expect(b.segs[4]).toMatchObject({ text: ' ▽', color: undefined, dim: true })
    expect(b.segs[5]).toMatchObject({ text: ' low', color: undefined, dim: false })
  })

  test('no theme key outside the allowed names: no ansi:, no hex, no ansi256', async ($, on) => {
    const { w, ui } = await bound($, on)
    for (const cols of [115, 76, 50, 36]) await ui.redraw(bandTarget(cols).props)
    const colors = (await ui.findAll({ type: 'Text' })).map((t) => t.props.color).filter(Boolean)
    expect(colors.length).toBeGreaterThan(0)
    for (const c of colors) expect(['success', 'error', 'warning', 'permission', 'inactive', 'subtle']).toContain(c)
    expect(w.statusCalls).toEqual([])
  })

  const cases = [
      { cards: [card('P-1', { worktree: '/other' })], text: '▌ ? no card for this branch  → /board-sync new "title" | link <ID>' },
      { cards: [card('P-1', { worktree: '/work/x' }), card('P-2', { branch: 'feat/x' }), card('P-3', { branch: 'feat/x' }), card('P-4', { branch: 'feat/x' }), card('P-5', { branch: 'feat/x' })], text: '▌ ≡ 5 cards match: P-1 P-2 P-3 +2  → /board-sync link <ID>' },
      { cards: [card('P-1', { worktree: '/work/x', agent: 'codex' })], text: '▌ ⊘ P-1 is held by codex  → /board-sync link P-1 to take over' },
  ]
  cases.forEach((c, i) => {
    test(`notice ${['none', 'many', 'held'][i]}: symbol, text, warning color and the next command`, async ($, on) => {
      const w = world(on, { cards: c.cards })
      await $.session.start(w.start)
      const b = await band(await $.ui.mount(bandTarget(115)))
      expect(b.text).toBe(c.text)
      expect(b.segs[0]!.color).toBe('warning')
      expect(w.mutations()).toEqual([]) // D15/D16: no claim, no new card
      expect(w.toasts).toEqual([]) // the band replaces the toast on the terminal
    })
  })

  test('a notice stays until it is resolved: link turns it into the card line', async ($, on) => {
    const w = world(on, { cards: [card('P-1', { worktree: '/other' })] })
    await $.session.start(w.start)
    const ui = await $.ui.mount(bandTarget(115))
    expect((await band(ui)).text).toContain('no card for this branch')
    await sync($, 'link P-1')
    expect((await band(ui)).text).toContain('P-1')
    expect((await band(ui)).text).not.toContain('no card')
  })

  test('/board-sync new shows the new card (in progress)', async ($, on) => {
    const w = world(on, { cards: [] })
    await $.session.start(w.start)
    const ui = await $.ui.mount(bandTarget(115))
    await sync($, 'new "Do the thing"')
    const b = await band(ui)
    expect(b.shown.slice(0, 4)).toEqual(['▌', 'P-1', ' ◐', ' in_progress'])
    expect(b.text).toContain('Do the thing')
  })
})

describe('band: width tiers', () => {
  const at = async ($: any, on: any, cols: number, over: object = {}, branch?: string) => {
    const { ui } = await bound($, on, over, cols, branch)
    return band(ui)
  }

  test('>= 100: full status word, priority word, agent, branch and note count', async ($, on) => {
    const { w, ui } = await bound($, on, { notes: 'a\nb\nc' })
    await sync($, 'link P-1') // refresh the snapshot so notes are counted
    expect((await band(ui)).shown).toEqual(['▌', 'P-1', ' ◐', ' in_progress', ' ▲', ' high', ' Fix login redirect loop on mobile Safari', 'claude · ⎇ feat/x · 3 notes'])
    expect(w.statusCalls).toEqual([])
  })

  test('64-99: short status word, priority symbol only, agent only', async ($, on) => {
    const b = await at($, on, 76)
    expect(b.shown).toEqual(['▌', 'P-1', ' ◐', ' doing', ' ▲', ' Fix login redirect loop on mobile Safari', 'claude'])
  })

  test('40-63: short status, priority symbol, title only; the title is cut to fit', async ($, on) => {
    const b = await at($, on, 50)
    expect(b.shown.slice(0, 5)).toEqual(['▌', 'P-1', ' ◐', ' doing', ' ▲'])
    expect(b.segs).toHaveLength(6)
    expect(b.shown[5]!.endsWith('…')).toBe(true)
    expect(width(b.text)).toBeLessThanOrEqual(50 - 4) // 4 cells stay free for the engine's [-]
  })

  test('< 40: stripe, id, status symbol and title; priority and words are gone', async ($, on) => {
    const b = await at($, on, 36)
    expect(b.shown.slice(0, 3)).toEqual(['▌', 'P-1', ' ◐'])
    expect(b.segs).toHaveLength(4)
    expect(width(b.text)).toBeLessThanOrEqual(36 - 4)
  })

  test('a short title leaves the meta alone', async ($, on) => {
    const b = await at($, on, 100, { title: 'Short' })
    expect(b.segs.at(-1)!.text).toBe('claude · ⎇ feat/x')
  })

  test('a long branch name is cut so the title keeps its room', async ($, on) => {
    const c = await at($, on, 100, { title: 'x'.repeat(100) }, 'feature/' + 'y'.repeat(60))
    expect(c.segs.at(-1)!.text).toMatch(/^claude · ⎇ feature\/y+…$/)
    expect(width(c.text)).toBeLessThanOrEqual(100 - 4)
  })

  test('a drawn line leaves the engine [-] button free, at every width from 20 to 200', async ($, on) => {
    const { ui } = await bound($, on, { title: '修正手機版登入頁面無限重新導向的問題 and then English mixed in 🔥 後面還有很多字' })
    for (let cols = 20; cols <= 200; cols++) {
      await ui.redraw(bandTarget(cols).props)
      expect(width((await band(ui)).text), `bodyColumns ${cols}`).toBeLessThanOrEqual(cols - 4)
    }
  })

  test('Chinese titles are cut by cell width (two per character) and never mid-character', async ($, on) => {
    const title = '修正手機版登入頁面無限重新導向的問題'
    const { ui } = await bound($, on, { title }, 50)
    const text = (await band(ui)).text
    const shown = text.slice(text.indexOf('修')).trimEnd()
    expect(width(text)).toBeLessThanOrEqual(46)
    expect(shown.endsWith('…')).toBe(true)
    expect(title.startsWith(shown.slice(0, -1))).toBe(true) // a clean prefix, no half characters
    expect(shown.length).toBeLessThan(title.length)
  })

  test('fit(): wide characters and emoji are never split', async () => {
    for (let max = 1; max < 12; max++) {
      for (const s of ['一二三四五六七八九十', '🔥🔥🔥🔥🔥🔥', 'ab一cd二ef三']) {
        const out = fit(s, max)
        expect(width(out), `${s} @${max}`).toBeLessThanOrEqual(max)
        expect(out).not.toMatch(BROKEN_PAIR)
      }
    }
    expect(fit('short', 10)).toBe('short')
    expect(fit('一二三', 6)).toBe('一二三')
    expect(fit('一二三四', 6)).toBe('一二…')
  })

  for (const title of ['Short', '修正登入', 'x'.repeat(200)]) {
    test(`the line ends exactly 4 cells before the band edge: ${title.slice(0, 8)}`, async ($, on) => {
      const w = world(on, { cards: [card('P-1', { worktree: '/work/x', title })] })
      await $.session.start(w.start)
      const ui = await $.ui.mount(bandTarget(115))
      expect(width((await band(ui)).text)).toBe(115 - 4)
      for (const cols of [100, 76]) {
        await ui.redraw(bandTarget(cols).props)
        expect(width((await band(ui)).text), `@${cols}`).toBe(cols - 4)
      }
    })
  }

  test('a newline in a title does not break the single line', async ($, on) => {
    const { ui } = await bound($, on, { title: 'first\nsecond   third' })
    await sync($, 'link P-1')
    expect((await band(ui)).text).toContain('first second third')
  })
})

describe('band: silence, switches and the server (D3)', () => {
  test('yields to a survey', async ($, on) => {
    const { ui } = await bound($, on)
    expect((await band(ui)).text).not.toBe('')
    await ui.redraw(bandTarget(115, { hasSurvey: true }).props)
    expect((await band(ui)).text).toBe('')
  })

  test('server not running and nothing bound: nothing is drawn, not even a notice', async ($, on) => {
    const w = world(on, { cards: [card('P-1', { worktree: '/work/x' })] })
    w.mode = 'down'
    await $.session.start(w.start)
    const ui = await $.ui.mount(bandTarget(115))
    expect((await band(ui)).text).toBe('')
    await $.turn.complete(w.complete('t1'))
    expect((await band(ui)).text).toBe('')
  })

  test('the server goes away after a card is bound: red "board offline", back to the card on recovery', async ($, on) => {
    const { w, ui } = await bound($, on)
    expect((await band(ui)).text).toContain('P-1')
    w.mode = 'down'
    await $.turn.complete(w.complete('t1'))
    let b = await band(ui)
    expect(b.text).toBe('▌ ✗ board offline  → P-1 last known, retrying')
    expect(b.segs[0]!.color).toBe('error')
    w.mode = 'ok'
    await w.clock.advance(20_000)
    await $.turn.complete(w.complete('t2'))
    b = await band(ui)
    expect(b.text).toContain('◐ in_progress')
    expect(b.text).not.toContain('offline')
  })

  test('/board-sync off removes the band; on brings it back', async ($, on) => {
    const { ui } = await bound($, on)
    await sync($, 'off')
    expect((await band(ui)).text).toBe('')
    await sync($, 'on')
    expect((await band(ui)).text).toContain('P-1')
  })

  test('enabled=false: no band at all', { options: { enabled: false } }, async ($, on) => {
    const w = world(on, { cards: [card('P-1', { worktree: '/work/x' })] })
    await $.session.start(w.start)
    expect((await band(await $.ui.mount(bandTarget(115)))).text).toBe('')
    expect(w.requests).toEqual([])
  })

  test('a hot-reloaded session.start keeps the line without claiming twice', async ($, on) => {
    const { w, ui } = await bound($, on)
    const claims = w.mutations().length
    await $.session.start(w.start)
    expect(w.mutations()).toHaveLength(claims)
    expect((await band(ui)).text).toContain('P-1')
  })
})

describe('band: toast fallback when nothing draws the band', () => {
  const none = [card('P-1', { worktree: '/other' })]

  test('no terminal or desktop surface: the three notices go back to a toast', async ($, on) => {
    const w = world(on, { cards: none, surfaces: ['vscode'] })
    await $.session.start(w.start)
    expect(w.toasts[0]).toContain('no card matches')
    expect(w.toastMs[0]).toBe(10_000)
  })

  for (const surfaces of [['terminal'], ['desktop'], ['mobile', 'terminal']] as const) {
    test(`surfaces ${surfaces.join('+')}: no toast`, async ($, on) => {
      const w = world(on, { cards: none, surfaces: [...surfaces] })
      await $.session.start(w.start)
      expect(w.toasts).toEqual([])
    })
  }

  test('held and many also fall back', async ($, on) => {
    const held = world(on, { cards: [card('P-1', { worktree: '/work/x', agent: 'codex' })], surfaces: ['mobile'] })
    await $.session.start(held.start)
    expect(held.toasts[0]).toContain('held by codex')
  })
})

describe('band: the snapshot follows the card', () => {
  test('each turn refreshes it: a status moved elsewhere shows up after the next note', async ($, on) => {
    const { w, ui } = await bound($, on)
    w.cards[0]!.status = 'review'
    await $.turn.complete(w.complete('t1'))
    expect((await band(ui)).text).toContain('◑ review')
  })

  test('a turn with no note to write still refreshes it (list read)', async ($, on) => {
    const { w, ui } = await bound($, on)
    w.cards[0]!.status = 'done'
    await $.turn.complete(w.complete('t1', { answer: '' }))
    expect(w.notes('P-1')).toHaveLength(0)
    expect((await band(ui)).text).toContain('● done')
  })

  test('the note count grows with each turn', async ($, on) => {
    const { ui } = await bound($, on)
    await $.turn.complete(w_complete('t1'))
    await $.turn.complete(w_complete('t2'))
    expect((await band(ui)).segs.at(-1)!.text).toContain('2 notes')
  })

  test('session.end writes one note and does not touch the band state', async ($, on) => {
    const { w, ui } = await bound($, on)
    await $.session.end(END('other'))
    expect(w.cards[0]).toMatchObject({ agent: 'claude', status: 'in_progress' })
    expect((await band(ui)).text).toContain('P-1')
  })
})

const w_complete = (turnId: string) => ({ answer: 'Fixed the bug.', durationMs: 5, isAborted: false, turnId, reason: 'answer' }) as any

describe('/board-sync status layout', () => {
  const lines = (t: string) => t.split('\n')

  test('linked: labelled rows, card detail, last note, commands', async ($, on) => {
    const { w } = await bound($, on)
    await $.turn.complete(w.complete('t1'))
    const text = (await sync($, 'status')).text
    expect(lines(text)).toEqual([
      'Agent Board  ● reporting on',
      '  server     http://localhost:4317   ● up',
      '  workspace  default',
      '  card       P-1  ◐ in_progress  ▲ high',
      '             Fix login redirect loop on mobile Safari',
      '  owner      claude  ⎇ feat/x',
      '  last note  14:02  Fixed the bug.',
      '  commands   on | off | link <ID> | new "title"',
    ])
  })

  test('not bound: why, and the next command', async ($, on) => {
    world(on, { cards: [card('P-1', { worktree: '/other' })] })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work/x' })
    expect(lines((await sync($, 'status')).text).slice(3)).toEqual([
      '  card       none  ? no open card matches this worktree or branch',
      '  next       /board-sync link <ID>  or  /board-sync new "title"',
    ])
  })

  test('held and many name the cards', async ($, on) => {
    const w = world(on, { cards: [card('P-1', { worktree: '/work/x', agent: 'codex' })] })
    await $.session.start(w.start)
    expect((await sync($, 'status')).text).toContain('card       none  ⊘ P-1 is held by codex')
    expect((await sync($, 'status')).text).toContain('next       /board-sync link P-1  to take it')
  })

  test('server offline: marker with the retry time, last known card, how to start it', async ($, on) => {
    const { w } = await bound($, on)
    w.mode = 'down'
    await $.turn.complete(w.complete('t1'))
    const text = (await sync($, 'status')).text
    expect(text).toMatch(/server {5}http:\/\/localhost:4317 {3}✗ offline, retrying in 15s/)
    expect(text).toContain('(last known)')
    expect(text).toContain('next       start the board: agent-board')
    expect(text).not.toContain('● up')
    await w.clock.advance(20_000) // past the backoff: no countdown left to show
    expect((await sync($, 'status')).text).toMatch(/✗ offline, will retry/)
  })

  test('off: says so and points at on', async ($, on) => {
    await bound($, on)
    await sync($, 'off')
    const text = (await sync($, 'status')).text
    expect(lines(text)[0]).toBe('Agent Board  ○ reporting off')
    expect(text).toContain('card       P-1  (bound, not reporting)')
    expect(text).toContain('next       /board-sync on')
    expect(text).not.toContain('● up')
  })

  test('every state: no ANSI, no line wider than 70 cells, the server shown as an origin', async ($, on) => {
    const long = '修正手機版登入頁面無限重新導向的問題'.repeat(5)
    const { w } = await bound($, on, { title: long })
    const seen = [(await sync($, 'status')).text]
    w.mode = 'down'
    await $.turn.complete(w.complete('t1'))
    seen.push((await sync($, 'status')).text)
    await sync($, 'off')
    seen.push((await sync($, 'status')).text)
    for (const text of seen) {
      expect(text).not.toContain('\u001b')
      for (const l of lines(text)) expect(width(l), l).toBeLessThanOrEqual(70)
      expect(text).toContain('http://localhost:4317')
      expect(text).not.toContain('/api')
    }
  })

  test('pure: a long server URL is cut inside 70 cells', () => {
    const text = statusText({ isOn: true, server: 'http://' + 'a'.repeat(100) + '.example:4317', workspace: 'w', retryInS: null, bound: null, state: null })
    for (const l of text.split('\n')) expect(width(l)).toBeLessThanOrEqual(70)
  })
})

// ---- 1. emoji / symbols drawn two cells wide ---------------------------------
describe('width(): emoji and wide symbols are 2 cells', () => {
  test('concrete cases', () => {
    for (const e of ['🚀', '✅', '⚡', '⭐', '🚗', '😀', '❌', '⌚', '🇹'] ) expect(width(e)).toBe(2)
    expect(width('修正')).toBe(4)
    expect(width('ab')).toBe(2)
    expect(width('▲◐')).toBe(2) // ambiguous-width symbols stay 1 (documented limit)
    expect(width('é')).toBe(1)
  })
  test('fit() with emoji never exceeds the limit', () => {
    for (let max = 1; max < 14; max++) expect(width(fit('🚀✅ab⚡⭐cd🚗', max))).toBeLessThanOrEqual(max)
  })
})

// ---- 3. unknown priority / status ----------------------------------------------
describe('unknown priority and status get a safe symbol', () => {
  const row = (priority: any, status = 'in_progress') => toBandCard({ id: 'P-1', title: 'T', status, priority, agent: 'claude', branch: null, notes: '' } as any)
  const text = (c: any, cols: number) => { const l = bandLayout({ kind: 'linked', card: c }, false, cols)!; return [...l.left, ...l.tail, ...l.right].map((s) => s.text).join('') }
  for (const p of ['urgent', 'critical', 'HIGH', 'constructor', '__proto__', 'toString', 'a\nb', 'x'.repeat(80)]) {
    test(`priority ${JSON.stringify(p).slice(0, 20)}`, () => {
      expect(priorityOf(p).glyph).toBe('?')
      for (const cols of [120, 80, 50]) {
        const t = text(row(p), cols)
        expect(t).not.toContain('undefined')
        expect(t).not.toContain('function')
        expect(t).not.toContain('\n')
        expect(t).toContain(' ?')
        expect(width(t)).toBeLessThanOrEqual(cols - 4)
      }
    })
  }
  test('known priorities keep their symbols; null/empty draw none', () => {
    expect(['high', 'med', 'low'].map((p) => priorityOf(p).glyph)).toEqual(['▲', '◆', '▽'])
    expect(text(row(null), 120)).not.toContain('?')
    expect(text(row(''), 120)).not.toContain('?')
  })
  test('unknown status keeps working, "constructor" included', () => {
    expect(statusOf('constructor')).toMatchObject({ glyph: '○', short: 'constructor' })
    expect(text(row('high', 'constructor'), 120)).not.toContain('function')
  })
  test('/board-sync status shows the fallback symbol too', () => {
    const t = statusText({ isOn: true, server: 'http://x', workspace: 'w', retryInS: null, bound: 'P-1', state: { kind: 'linked', card: row('urgent') } })
    expect(t).toContain('? urgent')
    expect(t).not.toContain('undefined')
  })
})

// ---- 2. contrast ------------------------------------------------------------------
// The band's own theme keys, with the RGB the engine gives them (read from Claude Code 2.1.288's theme
// tables: "light" and "dark"). Only symbols are colored (asserted below), so a glyph needs 3:1 (WCAG 1.4.11).
const THEMES: Record<string, { bg: number[][]; keys: Record<string, number[]> }> = {
  light: { bg: [[255, 255, 255], [238, 238, 238]], keys: { success: [44, 122, 57], error: [171, 43, 63], warning: [150, 108, 30], permission: [87, 105, 247], inactive: [102, 102, 102] } },
  dark: { bg: [[0, 0, 0], [28, 28, 28]], keys: { success: [78, 186, 101], error: [255, 107, 128], warning: [255, 193, 7], permission: [177, 185, 249], inactive: [153, 153, 153] } },
}
const lum = (c: number[]) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! }
const ratio = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05) }

describe('band colors: only symbols are colored, and they are readable on light and dark', () => {
  test('no colored segment contains a letter or digit (words and the title use the default text color)', () => {
    const states = ['backlog', 'in_progress', 'review', 'done', 'weird']
    for (const status of states) for (const priority of ['high', 'med', 'low', 'urgent']) for (const cols of [120, 80, 50, 30]) {
      const l = bandLayout({ kind: 'linked', card: toBandCard({ id: 'P-1', title: 'Fix', status, priority, agent: 'claude', branch: 'b', notes: 'x' } as any) }, false, cols)!
      for (const s of [...l.left, ...l.tail, ...l.right]) if (s.color && s.text.trim() !== '▌') expect(s.text).not.toMatch(/[\p{L}\p{N}]/u)
    }
  })
  for (const [theme, { bg, keys }] of Object.entries(THEMES)) {
    test(`${theme} theme: every colored symbol is >= 3:1 on its backgrounds`, () => {
      const used = new Set<string>()
      for (const status of ['backlog', 'in_progress', 'review', 'done']) used.add(statusOf(status).color)
      used.add('error') // high priority and the offline notice
      for (const k of used) for (const b of bg) expect([theme, k, ratio(keys[k]!, b) >= 3]).toEqual([theme, k, true])
    })
  }
})
