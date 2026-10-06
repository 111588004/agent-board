import type { PluginOptions, Register } from 'claude-code'

import type { BandState } from '../types'
import { bandLayout, statusText, toBandCard, type Seg } from './band'
import { baseUrl, call, type Deps } from './board'
import { pickCard, summarize, type Card } from './pick-card'

const BINDING = { plugin: 'agent-board', key: 'binding' } as const
const NOTED = { plugin: 'agent-board', key: 'lastNotedTurnId' } as const
const HEALTH = { plugin: 'agent-board', key: 'health' } as const
const BAND = { plugin: 'agent-board', key: 'band' } as const

// D18: only these end reasons are a real ending (/clear and resume keep going).
const END_REASONS = ['prompt_input_exit', 'other', 'logout']

// Helpers are top-level functions because `claude plugin validate` only follows
// `$` into functions declared at the top of the file.

// override (/board-sync on|off, kept in $.store) beats the userConfig default.
async function settings($: any, options: PluginOptions) {
  const override = await $.store.get('override')
  const env = await Promise.resolve($.env.get('AGENT_BOARD_URL')).catch(() => undefined)
  const deps: Deps = {
    fetch: (url, init) => $.http.fetch(url, init),
    sleep: (ms, signal) => $.clock.sleep(ms, { signal }),
    now: () => $.clock.now(),
    getHealth: async () => (await $.state.get(HEALTH)).value ?? { fails: 0, until: 0 },
    setHealth: (h) => $.state.set(HEALTH, h),
    base: baseUrl(String(options.agentBoardUrl ?? ''), env, String(options.workspace ?? '')),
  }
  const isOn = override === 'on' ? true : override === 'off' ? false : options.enabled !== false
  return { isOn, deps }
}

type Here = { cwd: string; toplevel: string | null; branch: string | null }

async function where($: any): Promise<Here> {
  const cwd: string = await $.session.cwd()
  // Two plain git calls: `rev-parse HEAD` fails in a repo with no commits yet, `branch --show-current` does not.
  const git = (...args: string[]): Promise<string | null> =>
    Promise.resolve($.process.run(['git', ...args], { cwd, timeoutMs: 2000 }))
      .then((r: any) => (r.exitCode === 0 ? r.stdout.trim() || null : null))
      .catch(() => null)
  const [toplevel, branch] = await Promise.all([git('rev-parse', '--show-toplevel'), git('branch', '--show-current')])
  return { cwd, toplevel, branch }
}

// A toast is easy to miss (the default is 4s), so give the person time to read it.
const TOAST_MS = 10_000

function toast($: any, text: string) {
  try { $.ui.toast(text, { timeoutMs: TOAST_MS }) } catch {}
}

// D20: the line above the prompt (ui.render AbovePrompt, see bandView) draws from this state, and a
// state change redraws it. It replaces `$.ui.status`, whose fixed "⚠ <plugin>:" style cannot be changed.
// Where nothing draws that band (not terminal/desktop, e.g. a vscode or mobile-only session) the
// three "nothing was claimed" states fall back to the toast they used to be.
async function drawsBand($: any): Promise<boolean> {
  try { return (await $.session.surfaces()).some((s: string) => s === 'terminal' || s === 'desktop') } catch { return true }
}

async function say($: any, state: BandState, fallbackToast: string) {
  await $.state.set(BAND, state)
  if (!(await drawsBand($))) toast($, fallbackToast)
}

async function remember($: any, row: Card) {
  await $.state.set(BAND, { kind: 'linked', card: toBandCard(row) })
}

// Claiming changes who owns a card (D15), so it only runs for a unique match
// or a person's explicit `link`. D19: it sets the owner and nothing else: opening a session
// is not the same as the work having started, so the status is left to whoever really moves it.
async function claim($: any, deps: Deps, card: Card, here: Here) {
  const row = await call(deps, 'PATCH', `/tasks/${card.id}`, {
    agent: 'claude', worktree: here.cwd, ...(here.branch ? { branch: here.branch } : {}),
  })
  if (!row) return false
  await $.state.set(BINDING, { sessionId: await $.session.id(), cardId: card.id })
  await remember($, row)
  return true
}

async function autoBind($: any, deps: Deps) {
  const sessionId = await $.session.id()
  const bound = (await $.state.get(BINDING)).value
  if (bound?.sessionId === sessionId) {
    // Hot reload re-ran session.start, or /board-sync on after off: the line needs a card to draw again.
    if ((await $.state.get(BAND)).value) return
    const row = (await call(deps, 'GET', '/tasks') as Card[] | null)?.find((c) => c.id === bound.cardId)
    return row ? remember($, row) : undefined
  }
  const cards: Card[] | null = await call(deps, 'GET', '/tasks')
  if (!cards) return // server down: stay silent
  const here = await where($)
  const hit = pickCard(cards, here)
  if (hit.kind === 'none') return say($, { kind: 'none' }, 'Agent Board: no card matches this worktree/branch. /board-sync link <ID> or /board-sync new "title"')
  if (hit.kind === 'many') {
    const ids = hit.cards.map((c) => c.id)
    return say($, { kind: 'many', ids }, `Agent Board: ${ids.join(', ')} all match. /board-sync link <ID> to pick one`)
  }
  const { card } = hit
  if (card.agent && card.agent !== 'claude') {
    return say($, { kind: 'held', id: card.id, agent: card.agent }, `Agent Board: ${card.id} is held by ${card.agent}. /board-sync link ${card.id} to take it`)
  }
  if (await claim($, deps, card, here)) toast($, `Agent Board: working on ${card.id}`)
}

async function reportTurn($: any, options: PluginOptions, turnId: string, answer: string) {
  const { isOn, deps } = await settings($, options)
  const binding = (await $.state.get(BINDING)).value
  if (!isOn || !binding || (await $.state.get(NOTED)).value === turnId) return
  await $.state.set(NOTED, turnId) // before sending: a repeat dispatch must not double-write
  const messages = await $.session.messages()
  const turnStart = messages.findLastIndex((m: any) => m.role === 'user' && m.text !== '')
  const uses = messages.slice(turnStart + 1).flatMap((m: any) => m.toolUses)
  const note = summarize(answer, uses)
  // The PATCH answer is the card as it is now (status may have been moved in the Web UI), so each
  // turn refreshes the band's snapshot; with no note to send, a list read does the same.
  const row: Card | null | undefined = note
    ? await call(deps, 'PATCH', `/tasks/${binding.cardId}`, { note, agent: 'claude' })
    : (await call(deps, 'GET', '/tasks') as Card[] | null)?.find((c) => c.id === binding.cardId)
  if (row) await remember($, row)
}

// D18: ending a session says nothing about the work being finished, so it only leaves a line in
// the card's history. Status and owner stay as they were, and `agent` is left out of the request
// on purpose: the REST API reads it as "set the owner", which would take a card back from
// whoever picked it up in the meantime.
async function noteEnd($: any, options: PluginOptions, remainingMs: number) {
  const { isOn, deps } = await settings($, options)
  const binding = (await $.state.get(BINDING)).value
  if (!isOn || !binding) return
  // The whole session.end chain gets ~1.5s: one call, capped below that.
  const ms = Math.max(200, Math.min(900, remainingMs - 300))
  await call(deps, 'PATCH', `/tasks/${binding.cardId}`, { note: 'claude session ended' }, ms)
}

async function boardSync($: any, options: PluginOptions, args: string): Promise<string> {
  const sub = args.trim().split(/\s+/)[0] ?? ''
  const arg = args.trim().slice(sub.length).trim()
  const { isOn, deps } = await settings($, options)
  if (sub === 'off') { await $.store.set('override', 'off'); await $.state.set(BAND, null); return 'Agent Board reporting: off' }
  if (sub === 'on') {
    await $.store.set('override', 'on')
    await autoBind($, (await settings($, options)).deps).catch(() => {})
    return 'Agent Board reporting: on'
  }
  if (sub === 'status') {
    const binding = (await $.state.get(BINDING)).value
    const health = await deps.getHealth()
    const retryInS = health.fails ? Math.max(0, Math.ceil((health.until - (await deps.now())) / 1000)) : null
    return statusText({
      isOn, server: new URL(deps.base).origin, workspace: String(options.workspace ?? '') || 'default',
      retryInS, bound: binding?.cardId ?? null, state: (await $.state.get(BAND)).value ?? null,
    })
  }
  if (sub === 'link' && arg) {
    const cards: Card[] | null = await call(deps, 'GET', '/tasks')
    const card = cards?.find((c) => c.id === arg)
    if (!card) return cards ? `No card ${arg}` : 'Agent Board is not reachable'
    return (await claim($, deps, card, await where($))) ? `Linked to ${card.id}` : 'Could not update the card'
  }
  if (sub === 'new' && arg) {
    const title = arg.replace(/^["'“”]|["'“”]$/g, '')
    let project = String(options.project ?? '')
    if (!project) {
      const projects: { name: string }[] | null = await call(deps, 'GET', '/projects')
      if (projects?.length !== 1) return projects ? 'Several projects: set the "project" option of this plugin' : 'Agent Board is not reachable'
      project = projects[0]!.name
    }
    const here = await where($)
    const card: Card | null = await call(deps, 'POST', '/tasks', {
      title, project, agent: 'claude', status: 'in_progress', worktree: here.cwd, ...(here.branch ? { branch: here.branch } : {}),
    })
    if (!card) return 'Could not create the card'
    await $.state.set(BINDING, { sessionId: await $.session.id(), cardId: card.id })
    await remember($, card)
    return `Created ${card.id}`
  }
  return 'Usage: /board-sync on | off | status | link <ID> | new "title"'
}

// D20: the always-on line. Everything it shows comes from $.state (written by the hooks above), never
// from a request made while drawing. Helpers live at the top level because `claude plugin validate`
// only follows `$` into top-level functions.
function bandText(seg: Seg) {
  return { ...(seg.color && { color: seg.color }), ...(seg.bold && { bold: true }), ...(seg.dim && { dimColor: true }) }
}

async function bandView($: any, e: any, next: any) {
  if (e.props.hasSurvey) return next(e) // a survey owns the band: yield
  const state: BandState | null = (await $.state.get(BAND)).value ?? null
  const health = (await $.state.get(HEALTH)).value ?? { fails: 0, until: 0 }
  const layout = bandLayout(state, health.fails > 0, e.props.bodyColumns)
  if (!layout) return next(e)
  const { Box, Text } = $.ui.resolve(e)
  const draw = (seg: Seg) => <Text {...bandText(seg)}>{seg.text}</Text>
  return (
    <Box>
      {layout.left.map(draw)}
      {layout.tail.map(draw)}
      {layout.right.map(draw)}
    </Box>
  )
}

export const register: Register = (on, options) => {
  // D3: the mod is an extra, so every hook swallows its own errors and always continues the chain.
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'board-sync', description: 'Agent Board progress reporting', argumentHint: '[on|off|status|link <ID>|new "title"]' })
      const { isOn, deps } = await settings($, options)
      if (isOn) await autoBind($, deps)
    } catch {}
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    // Subagent turns reach every hook; only the main loop's answer is reported.
    if (e.agentId !== undefined || e.reason !== 'answer') return result
    // Awaited, but time-boxed by call(): a `$` call started after this hook returns never
    // reaches the server (measured on 2.1.285), so a fire-and-forget write would be lost.
    try { await reportTurn($, options, e.turnId, e.answer) } catch {}
    return result
  })

  on('session.end', async ($, e, next) => {
    try {
      if (END_REASONS.includes(e.reason)) await noteEnd($, options, next.budget.remainingMs)
    } catch {}
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    try { return await bandView($, e, next) } catch { return next(e) }
  })

  on('command.run', { command: 'board-sync' }, async ($, e) => {
    try {
      return { text: await boardSync($, options, e.args) }
    } catch {
      return { text: 'Agent Board: something went wrong' }
    }
  })
}
