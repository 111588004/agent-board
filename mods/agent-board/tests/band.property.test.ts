// Property tests for the band layout (hooks/band.ts): seeded random inputs, invariants that must hold for all of them.
// Display width here is an INDEPENDENT model (not band.ts's width()), so a wrong width table cannot vouch for itself.
// Run: claude plugin test mods/agent-board   (fixed seed, repeatable)
import { describe, expect, test } from 'claude-code/testing'

import type { BandState } from '../types'
import { bandLayout, statusText, toBandCard } from '../hooks/band'

// ---- independent display width -------------------------------------------
const ZERO = /^[\p{M}\p{Cf}]$/u // combining marks, ZWJ/ZWSP, variation selectors
const WIDE = /^(?:[ᄀ-ᅟ⌚⌛⏩-⏬⏰⏳◽◾☔☕♈-♓♿⚓⚡⚪⚫⚽⚾⛄⛅⛎⛔⛪⛲⛳⛵⛺⛽✅✊✋✨❌❎❓-❕❗➕-➗➰➿⬛⬜⭐⭕⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹯！-｠￠-￦]|\p{Emoji_Presentation}|[\u{1f1e6}-\u{1f1ff}\u{20000}-\u{3fffd}])$/u
// East Asian Ambiguous characters the band itself draws (checked with Python unicodedata): the pessimistic model.
const AMBIGUOUS = new Set([...'▌●○◐◑▲▽◆≡…·→'])

function w2(s: string, ambiguous = 1): number {
  let n = 0
  for (const ch of s) n += ZERO.test(ch) ? 0 : WIDE.test(ch) ? 2 : AMBIGUOUS.has(ch) ? ambiguous : 1
  return n
}

// ---- seeded random --------------------------------------------------------
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const SEED = 20261007 // fixed: edit to explore other inputs
const rnd = rng(SEED)
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1))
const pick = <T,>(xs: readonly T[]): T => xs[int(0, xs.length - 1)]!

const WORDS = ['Fix', 'login', 'redirect', 'loop', 'on', 'mobile', 'Safari', 'refactor', 'api', 'v2', 'dark-mode', 'toggle', 'cache', 'migrate', 'DB', 'flaky', 'test']
const ZH = [...'修正登入重導迴圈手機版使用者回報無法登出看板卡片任務測試資料庫']
const SAFE_EMOJI = ['😀', '🎉', '🔥', '😎'] // inside band.ts's wide table
const OUTSIDE_EMOJI = ['🚀', '✅', '⚡', '⭐', '🚗'] // emoji-presentation (2 cells in terminals) outside band.ts's wide table
const words = (n: number) => Array.from({ length: n }, () => pick(WORDS)).join(' ')
const zh = (n: number) => Array.from({ length: n }, () => pick(ZH)).join('')

const TITLE_CLASSES = {
  ascii: () => words(int(1, 12)),
  chinese: () => zh(int(1, 30)),
  mixed: () => `${zh(int(1, 8))} ${words(int(1, 4))} ${zh(int(1, 8))}，${words(1)}`,
  emoji: () => `${pick(SAFE_EMOJI)} ${words(int(1, 5))} ${pick(SAFE_EMOJI)}${zh(int(0, 4))}`,
  long: () => words(60) + zh(80),
  messy: () => `  ${words(2)}\n\n  ${words(2)}\t\t${zh(2)}  \r\n `,
  empty: () => '',
} as const
type TitleClass = keyof typeof TITLE_CLASSES

const STATUSES = ['backlog', 'in_progress', 'review', 'done', 'weird_unknown_status'] as const
const PRIORITIES = [null, undefined, 'high', 'med', 'low', 'urgent?'] as const
const AGENTS = [null, 'claude', 'codex', 'gemini-cli-with-a-very-long-name', '代理人小明', 'pi'] as const
const BRANCHES = [null, 'feat/try-mod', 'feat/some-really-long-branch-name-with-ticket-AB-1234-and-more', 'fix/登入'] as const
const id = () => `${pick(['AB', 'SB', 'PROJ', 'X'])}-${int(1, 9999)}`

function randomRow(cls: TitleClass) {
  const n = int(0, 120)
  return {
    id: id(), title: TITLE_CLASSES[cls](), status: pick(STATUSES), agent: pick(AGENTS), worktree: null, branch: pick(BRANCHES),
    priority: pick(PRIORITIES), notes: n === 0 ? null : Array.from({ length: n }, (_, i) => `[2026-10-07 10:00 · claude] note ${i}`).join('\n'),
  }
}

type L = NonNullable<ReturnType<typeof bandLayout>>
const textOf = (l: L) => [...l.left, ...l.tail, ...l.right].map((s) => s.text).join('')
const MARGIN = 4 // the `[-]` collapse button's cells (hooks/band.ts EDGE): text must end this far from bodyColumns
const COLS = Array.from({ length: 181 }, (_, i) => i + 20)

type Sweep = { state: BandState; down: boolean; cols: number; layout: L; row?: ReturnType<typeof randomRow> }
const sweeps: Sweep[] = []
const linkedRows: ReturnType<typeof randomRow>[] = []
for (const cls of Object.keys(TITLE_CLASSES) as TitleClass[]) {
  for (let i = 0; i < 40; i++) {
    const row = randomRow(cls)
    linkedRows.push(row)
    const state: BandState = { kind: 'linked', card: toBandCard(row) }
    for (const cols of COLS) for (const down of [false, true]) sweeps.push({ state, down, cols, layout: bandLayout(state, down, cols)!, row })
  }
}
for (let i = 0; i < 60; i++) {
  const states: BandState[] = [
    { kind: 'none' },
    { kind: 'many', ids: Array.from({ length: int(2, 9) }, id) },
    { kind: 'held', id: id(), agent: pick(['codex', 'gemini-cli-with-a-very-long-name', '代理人小明']) },
  ]
  for (const state of states) for (const cols of COLS) sweeps.push({ state, down: false, cols, layout: bandLayout(state, false, cols)! })
}

// Emoji outside band.ts's WIDE table are kept apart: that is a finding, see the test at the bottom.
describe('band property: layout invariants over seeded random input', () => {
  test(`sample size (seed ${SEED})`, () => {
    expect(sweeps.length).toBeGreaterThan(50_000)
  })

  test('independent display width <= bodyColumns - 4 for every state, title class, priority/status/agent/branch/notes mix, width 20-200', () => {
    const bad = sweeps.filter((s) => w2(textOf(s.layout)) > s.cols - MARGIN)
    expect(bad.slice(0, 3).map((s) => `${s.state.kind}${s.down ? '/down' : ''}@${s.cols} w=${w2(textOf(s.layout))}: ${textOf(s.layout)}`)).toEqual([])
  })

  test('no newline, tab or carriage return in the band, and no lone surrogate', () => {
    for (const s of sweeps) {
      const t = textOf(s.layout)
      expect(/[\n\r\t]/.test(t)).toBe(false)
      expect(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]|�/.test(t)).toBe(false)
    }
  })

  test('deterministic: the same input gives a deep-equal layout', () => {
    for (const s of sweeps.filter((_, i) => i % 7 === 0)) expect(bandLayout(s.state, s.down, s.cols)).toEqual(s.layout)
  })

  test('title: cut only when it has to be, ends in … then, whole characters only, as much as fits, line right-aligned', () => {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    let truncated = 0
    for (const s of sweeps) {
      if (s.state.kind !== 'linked' || s.down || s.layout.tail.length === 0) continue
      const expected = s.row!.title.replace(/\s+/g, ' ').trim()
      const tail = s.layout.tail[0]!.text
      const hasRight = s.layout.right.length > 0
      const shown = tail.slice(1).trimEnd()
      const budget = w2(tail) - 1 - (hasRight ? 2 : 0)
      const where = `${s.cols}: ${JSON.stringify(expected)} -> ${JSON.stringify(shown)}`
      // right-aligned: with a title slot, the whole line ends exactly MARGIN cells before the edge
      expect(w2(textOf(s.layout)), where).toBe(s.cols - MARGIN)
      if (shown === expected) { expect(w2(expected), where).toBeLessThanOrEqual(budget); continue }
      truncated++
      expect(shown.endsWith('…'), `cut without …: ${where}`).toBe(true)
      expect(w2(expected), `cut but it fits: ${where}`).toBeGreaterThan(budget)
      const prefix = shown.slice(0, -1)
      expect(expected.startsWith(prefix), `not a prefix: ${where}`).toBe(true)
      const rest = [...seg.segment(expected.slice(prefix.length))].map((x) => x.segment)
      // whole graphemes: the prefix ends where a grapheme ends, and the next one would not have fit next to the …
      expect([...seg.segment(expected)].map((x) => x.segment).join('').startsWith(prefix), where).toBe(true)
      if (rest[0] !== undefined) expect(w2(prefix) + w2(rest[0]) + 1, `over-cut: ${where}`).toBeGreaterThan(budget)
    }
    expect(truncated).toBeGreaterThan(1000) // the generator really exercised cutting
  })

  test('agent and branch are cut at 14 and 24 cells, with a …', () => {
    for (const s of sweeps) {
      if (s.state.kind !== 'linked' || s.down || s.layout.right.length === 0) continue
      const [agent, branch] = s.layout.right[0]!.text.split(' · ')
      const card = s.state.card
      if (s.cols >= 100 && card.branch) {
        const b = s.layout.right[0]!.text.split(' · ').find((p) => p.startsWith('⎇ '))!
        expect(w2(b.slice(2))).toBeLessThanOrEqual(24)
        if (b.slice(2) !== card.branch) expect(b.endsWith('…')).toBe(true)
      }
      if (card.agent) {
        expect(w2(agent!)).toBeLessThanOrEqual(14)
        if (agent !== card.agent) expect(agent!.endsWith('…')).toBe(true)
      }
    }
  })

  test('priority of loss: items are dropped in the documented order, and a wider band never loses an item a narrower one had', () => {
    const items = (l: L, row: ReturnType<typeof randomRow>) => {
      const t = textOf(l)
      return {
        id: t.includes(row.id), glyph: /[○◐◑●]/.test(l.left[2]?.text ?? ''), word: l.left.length > 3,
        priority: l.left.length > 4, agent: !!row.agent && l.right.length > 0, branch: t.includes('⎇'), notes: /\d+ notes?/.test(t),
      }
    }
    const bad: string[] = []
    const need = (ok: boolean, msg: string) => { if (!ok && bad.length < 5) bad.push(msg) }
    for (const row of linkedRows) {
      let prev: ReturnType<typeof items> | null = null
      for (const cols of COLS) {
        const l = bandLayout({ kind: 'linked', card: toBandCard(row) }, false, cols)!
        const now = items(l, row)
        const at = `${cols}: ${textOf(l)}`
        // id and status symbol are never lost at any width >= 20
        need(now.id && now.glyph, `id/status lost @${at}`)
        // order: a later item (agent, branch, notes) is never shown without the earlier ones (word, priority)
        if (now.agent) need(now.word && (!['high', 'med', 'low'].includes(row.priority ?? '') || now.priority), `agent before word/priority @${at}`)
        if (now.branch || now.notes) need(now.agent || !row.agent, `branch/notes before agent @${at}`)
        if (prev) for (const k of Object.keys(now) as (keyof typeof now)[]) if (prev[k]) need(now[k], `${k} vanished going ${cols - 1}->${cols} @${at}`)
        prev = now
      }
    }
    expect(bad).toEqual([])
  })

  test('notice states: the command hint only when it fully fits, and never wider than the line', () => {
    for (const s of sweeps) {
      if (s.state.kind === 'linked' && !s.down) continue
      const t = textOf(s.layout)
      expect(w2(t)).toBeLessThanOrEqual(s.cols - MARGIN)
      if (t.includes('→')) expect(s.cols).toBeGreaterThanOrEqual(40)
    }
  })

  test('/board-sync status: every line <= 70 cells', () => {
    for (const row of linkedRows.slice(0, 150)) {
      const state: BandState = { kind: 'linked', card: toBandCard(row) }
      for (const retryInS of [null, 0, 30]) {
        const text = statusText({ isOn: true, server: 'http://localhost:4317', workspace: 'default', retryInS, bound: row.id, state })
        for (const line of text.split('\n')) expect(w2(line), line).toBeLessThanOrEqual(70)
      }
    }
  })
})

describe('band property: pessimistic model (ambiguous-width symbols drawn 2 cells), statistics only', () => {
  test('how far past the line does the band reach if ● ▲ ▌ ◐ … · → count 2 cells?', () => {
    type Acc = { n: number; over: number; overMargin: number; max: number }
    const acc: Record<string, Acc> = {}
    for (const s of sweeps) {
      const key = s.state.kind === 'linked' ? (s.down ? 'offline' : `linked/${s.state.card.status}`) : s.state.kind
      const t = textOf(s.layout)
      const excess = w2(t, 2) - s.cols // > 0: past the right edge (under the [-] button, or wrapped)
      const a = (acc[key] ??= { n: 0, over: 0, overMargin: 0, max: -99 })
      a.n++
      if (excess > 0) a.over++
      if (excess > -1) a.overMargin++ // would touch the last cell
      a.max = Math.max(a.max, excess)
    }
    const byCols: Record<number, number> = {}
    for (const s of sweeps) byCols[s.cols] = Math.max(byCols[s.cols] ?? -99, w2(textOf(s.layout), 2) - s.cols)
    const worst = Math.max(...Object.values(byCols))
    console.log('pessimistic model (excess = width with ambiguous=2 minus columns; margin is 4):')
    for (const [k, a] of Object.entries(acc)) console.log(`  ${k.padEnd(24)} renders=${a.n} max excess=${a.max} past edge=${a.over} (${((100 * a.over) / a.n).toFixed(1)}%) touching last cell=${a.overMargin}`)
    console.log(`  worst excess over any state/width: ${worst}`)
    expect(worst).toBeLessThan(100) // not a pass/fail question: only guards against NaN
  })
})

// A real finding, kept as its own test so it is visible and not hidden inside the invariants above.
describe('band property: emoji that terminals draw 2 cells wide but band.ts counts 1', () => {
  test('titles with 🚀 ✅ ⚡ ⭐ 🚗 still end MARGIN cells before the edge (independent width)', () => {
    const bad: string[] = []
    for (const e of OUTSIDE_EMOJI) {
      for (const cols of [60, 80, 120]) {
        const row = { ...randomRow('ascii'), title: `${e} ${words(20)}`, agent: null, branch: null, notes: null, priority: null }
        const l = bandLayout({ kind: 'linked', card: toBandCard(row) }, false, cols)!
        if (w2(textOf(l)) > cols - MARGIN) bad.push(`${e}@${cols}: ${w2(textOf(l))} > ${cols - MARGIN}`)
      }
    }
    expect(bad).toEqual([])
  })
})
