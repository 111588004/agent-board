// What the line above the prompt and `/board-sync status` say, as plain data and
// plain strings (no engine dependency, so tests and hooks share one code path).
// Layout rules come from study/terminal-design-research.md (scenes 1-3).

import type { BandCard, BandState } from '../types'
import type { Card } from './pick-card'

// ---- display width -------------------------------------------------------
// CJK is two cells, so truncating by character count would overflow the band.
// Ambiguous-width symbols (● ▲ …) count 1, like the engine's own status line does.

// Emoji that terminals draw two cells wide (🚀 ✅ ⚡ ⭐ 🚗 …): Unicode Emoji_Presentation, which the
// block ranges below only partly cover. Text-presentation symbols (❤ without U+FE0F) stay 1.
const EMOJI_WIDE = /^\p{Emoji_Presentation}$/u
const WIDE: [number, number][] = [
  [0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff],
  [0xa000, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe30, 0xfe6f], [0xff00, 0xff60],
  [0xffe0, 0xffe6], [0x1f300, 0x1f64f], [0x1f900, 0x1f9ff], [0x20000, 0x3fffd],
]

function cellWidth(ch: string): number {
  const c = ch.codePointAt(0)!
  if ((c >= 0x300 && c <= 0x36f) || (c >= 0x200b && c <= 0x200f) || (c >= 0xfe00 && c <= 0xfe0f)) return 0
  return WIDE.some(([a, b]) => c >= a && c <= b) || EMOJI_WIDE.test(ch) ? 2 : 1
}

export function width(s: string): number {
  let w = 0
  for (const ch of s) w += cellWidth(ch)
  return w
}

// Whole characters only (grapheme clusters where the runtime has Intl.Segmenter, else code points).
function chars(s: string): string[] {
  const Seg = (Intl as any)?.Segmenter
  return Seg ? Array.from(new Seg(undefined, { granularity: 'grapheme' }).segment(s), (x: any) => x.segment) : Array.from(s)
}

// Newlines and runs of blanks in a title would break the one-line layout.
export const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

// At most `max` cells; a cut ends in … (one cell). Never splits a character.
export function fit(s: string, max: number): string {
  if (max <= 0) return ''
  if (width(s) <= max) return s
  let out = ''
  let w = 0
  for (const ch of chars(s)) {
    const cw = width(ch)
    if (w + cw > max - 1) break
    out += ch
    w += cw
  }
  return out + '…'
}

// ---- vocabulary ----------------------------------------------------------

export const STATUS: Record<string, { glyph: string; short: string; color: string }> = {
  backlog: { glyph: '○', short: 'todo', color: 'inactive' },
  in_progress: { glyph: '◐', short: 'doing', color: 'warning' },
  review: { glyph: '◑', short: 'review', color: 'permission' },
  done: { glyph: '●', short: 'done', color: 'success' },
}
const UNKNOWN_STATUS = { glyph: '○', short: '?', color: 'inactive' }
// hasOwn: a status like "constructor" must not find Object.prototype members.
const own = <T,>(table: Record<string, T>, k: string): T | undefined => (Object.hasOwn(table, k) ? table[k] : undefined)
export const statusOf = (s: string) => own(STATUS, s) ?? { ...UNKNOWN_STATUS, short: s }

// Only high gets a color; the three shapes differ, so they read without color too.
export const PRIORITY: Record<string, { glyph: string; color?: string; dim?: boolean }> = {
  high: { glyph: '▲', color: 'error' },
  med: { glyph: '◆' },
  low: { glyph: '▽', dim: true },
}

// Anything that is not low/med/high (an old or hand-typed value) gets a neutral "?" and its own word.
export const priorityOf = (p: string) => own(PRIORITY, p) ?? { glyph: '?', dim: true }

export function toBandCard(row: Card): BandCard {
  const lines = (row.notes ?? '').split('\n').filter((l) => l.trim())
  return {
    id: row.id, title: oneLine(row.title), status: row.status, priority: row.priority ?? null,
    agent: row.agent && oneLine(row.agent), branch: row.branch && oneLine(row.branch), notes: lines.length, lastNote: lines.at(-1)?.slice(0, 200) ?? null,
  }
}

// ---- the band ------------------------------------------------------------

export type Seg = { text: string; color?: string; bold?: boolean; dim?: boolean }
// left, tail and right follow each other; the title (tail) is padded so right ends exactly EDGE cells
// before the band's edge. The padding is ours, not a flex spacer: a flex row would run under `[-]`.
export type Layout = { left: Seg[]; tail: Seg[]; right: Seg[] }

// The engine's `[-]` collapse button sits over the right edge of the band: Claude Code 2.1.291 already
// takes its 4 cells out of bodyColumns (120 columns -> 115), 2.1.288 (the desktop app's engine) does not
// (120 -> 120) and paints it over the last cells (both seen in tmux). Keep clear of those cells either way;
// the width tiers still go by bodyColumns.
const EDGE = 4

const w = (segs: Seg[]) => segs.reduce((n, s) => n + width(s.text), 0)

// Priority of what survives a narrow line (last dropped first): id, status, title, priority, agent, branch, notes.
function linked(card: BandCard, cols: number): Layout {
  const tier = cols >= 100 ? 3 : cols >= 64 ? 2 : cols >= 40 ? 1 : 0
  const st = statusOf(card.status)
  const pr = card.priority ? priorityOf(card.priority) : undefined
  // Only the symbols carry a theme color; the words stay in the default text color, so a light theme's
  // weaker warning/permission colors only have to be readable as a glyph (3:1), not as text (4.5:1).
  const left: Seg[] = [
    { text: '▌ ', color: st.color, bold: true },
    { text: card.id, bold: true },
    { text: ' ' + st.glyph, color: st.color },
  ]
  if (tier >= 1) left.push({ text: ' ' + (tier === 3 ? fit(oneLine(card.status), 14) : st.short) })
  if (tier >= 1 && pr) {
    left.push({ text: ' ' + pr.glyph, color: pr.color, dim: pr.dim })
    if (tier === 3) left.push({ text: ' ' + fit(oneLine(card.priority!), 10) })
  }
  const meta = tier === 3
    ? [card.agent && fit(card.agent, 14), card.branch && '⎇ ' + fit(card.branch, 24), card.notes > 0 && `${card.notes} note${card.notes > 1 ? 's' : ''}`]
    : tier === 2 ? [card.agent && fit(card.agent, 14)] : []
  const parts = meta.filter((p): p is string => !!p)
  const right: Seg[] = parts.length ? [{ text: parts.join(' · '), dim: true }] : []
  const budget = cols - EDGE - w(left) - 1 - (right.length ? w(right) + 2 : 0)
  const title = budget > 0 ? fit(card.title, budget) : ''
  return { left, tail: budget > 0 ? [{ text: ' ' + title + ' '.repeat(budget - width(title) + (right.length ? 2 : 0)) }] : [], right }
}

function notice(glyph: string, color: string, text: string, hint: string, cols: number): Layout {
  const left: Seg[] = [{ text: `▌ ${glyph} `, color, bold: true }]
  const room = cols - EDGE - w(left)
  const main = fit(text, room)
  const hintRoom = room - width(main) - 4
  // < 40 columns: symbol and the first half only, the command hint goes.
  const tail: Seg[] = [{ text: main, bold: true }]
  if (cols >= 40 && hintRoom >= 12 && main === text) tail.push({ text: '  → ' + fit(hint, hintRoom), dim: true })
  return { left, tail, right: [] }
}

// null = draw nothing: no card and no complaint, or the server cannot be reached and nothing is bound
// (D3: most people never start the server, a permanent red line would be nagging).
export function bandLayout(state: BandState | null, isDown: boolean, cols: number): Layout | null {
  if (!state) return null
  if (state.kind === 'linked') {
    if (isDown) return notice('✗', 'error', 'board offline', `${state.card.id} last known, retrying`, cols)
    return linked(state.card, cols)
  }
  if (state.kind === 'none') return notice('?', 'warning', 'no card for this branch', '/board-sync new "title" | link <ID>', cols)
  if (state.kind === 'many') {
    const shown = state.ids.slice(0, 3).join(' ') + (state.ids.length > 3 ? ` +${state.ids.length - 3}` : '')
    return notice('≡', 'warning', `${state.ids.length} cards match: ${shown}`, '/board-sync link <ID>', cols)
  }
  return notice('⊘', 'warning', `${state.id} is held by ${state.agent}`, `/board-sync link ${state.id} to take over`, cols)
}

// ---- /board-sync status --------------------------------------------------
// Plain text, no ANSI. The engine adds "agent-board: " in front of line 1 and indents the rest,
// so the content stays within 70 cells.

export const STATUS_WIDTH = 70

export type StatusInput = {
  isOn: boolean
  server: string // origin, e.g. http://localhost:4317
  workspace: string
  retryInS: number | null // set while backing off after a failure
  bound: string | null // binding's card id
  state: BandState | null
}

function noCard(state: BandState | null): { why: string; next: string } {
  if (state?.kind === 'many') return { why: `≡ ${state.ids.length} cards match: ${state.ids.slice(0, 3).join(' ')}${state.ids.length > 3 ? ` +${state.ids.length - 3}` : ''}`, next: '/board-sync link <ID>' }
  if (state?.kind === 'held') return { why: `⊘ ${state.id} is held by ${state.agent}`, next: `/board-sync link ${state.id}  to take it` }
  return { why: '? no open card matches this worktree or branch', next: '/board-sync link <ID>  or  /board-sync new "title"' }
}

export function statusText(s: StatusInput): string {
  const row = (label: string, value: string) => fit(`  ${label.padEnd(11)}${value}`.trimEnd(), STATUS_WIDTH)
  const cont = (value: string) => fit(' '.repeat(13) + value, STATUS_WIDTH)
  const card = s.state?.kind === 'linked' ? s.state.card : null
  const lines = [`Agent Board  ${s.isOn ? '● reporting on' : '○ reporting off'}`]
  const marker = !s.isOn ? '' : s.retryInS === null ? '   ● up' : `   ✗ offline, ${s.retryInS > 0 ? `retrying in ${s.retryInS}s` : 'will retry'}`
  lines.push(row('server', s.server + marker))
  lines.push(row('workspace', s.workspace))

  if (!s.isOn) {
    lines.push(row('card', s.bound ? `${s.bound}  (bound, not reporting)` : 'none'))
    lines.push(row('next', '/board-sync on'))
  } else if (card) {
    const st = statusOf(card.status)
    const pr = card.priority ? priorityOf(card.priority) : undefined
    lines.push(row('card', `${card.id}  ${st.glyph} ${card.status}${pr ? `  ${pr.glyph} ${card.priority}` : ''}${s.retryInS !== null ? '  (last known)' : ''}`))
    lines.push(cont(card.title))
    if (card.agent || card.branch) lines.push(row('owner', [card.agent, card.branch && '⎇ ' + card.branch].filter(Boolean).join('  ')))
    if (card.lastNote) {
      const m = /^\[\d{4}-\d{2}-\d{2} (\d{2}:\d{2})[^\]]*\] ?(.*)$/.exec(card.lastNote)
      lines.push(row('last note', m ? `${m[1]}  ${m[2]}` : card.lastNote))
    }
    lines.push(s.retryInS !== null ? row('next', 'start the board: agent-board') : row('commands', 'on | off | link <ID> | new "title"'))
  } else {
    const { why, next } = noCard(s.state)
    lines.push(row('card', s.bound ? `${s.bound}  (last known)` : `none  ${why}`))
    lines.push(row('next', s.retryInS !== null ? 'start the board: agent-board' : next))
  }
  return lines.join('\n')
}
