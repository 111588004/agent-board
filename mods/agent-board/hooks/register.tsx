import type { PluginOptions, Register } from 'claude-code'

import type { BandState } from '../types'
import { bandLayout, START_HINT, statusText, toBandCard, welcomeLayout, type Seg } from './band'
import { baseUrl, call, request, type Deps } from './board'
import {
  answerOf, cardChoices, cardUrl, firstSentence, isNeedsInput, needsInputChoices, OFF_LABEL, projectChoices,
  projectFor, repoName, reporting, titleChoices, type Choice, type OffScope,
} from './onboard'
import { pickCard, summarize, type Card } from './pick-card'

const BINDING = { plugin: 'agent-board', key: 'binding' } as const
const NOTED = { plugin: 'agent-board', key: 'lastNotedTurnId' } as const
const HEALTH = { plugin: 'agent-board', key: 'health' } as const
const BAND = { plugin: 'agent-board', key: 'band' } as const
const WELCOME = { plugin: 'agent-board', key: 'welcome' } as const
const SESSION_OFF = { plugin: 'agent-board', key: 'sessionOff' } as const
const ASKED = { plugin: 'agent-board', key: 'asked' } as const

const UNREACHABLE = `Agent Board is not reachable: ${START_HINT}`

// D18: only these end reasons are a real ending (/clear and resume keep going).
const END_REASONS = ['prompt_input_exit', 'other', 'logout']

// Helpers are top-level functions because `claude plugin validate` only follows
// `$` into functions declared at the top of the file.

// /board-sync off (D21: this session, this repo, or everywhere) beats /board-sync on, which beats
// the userConfig default.
async function settings($: any, options: PluginOptions) {
  const env = await Promise.resolve($.env.get('AGENT_BOARD_URL')).catch(() => undefined)
  const workspace = String(options.workspace ?? '')
  const deps: Deps = {
    fetch: (url, init) => $.http.fetch(url, init),
    sleep: (ms, signal) => $.clock.sleep(ms, { signal }),
    now: () => $.clock.now(),
    getHealth: async () => (await $.state.get(HEALTH)).value ?? { fails: 0, until: 0 },
    setHealth: (h) => $.state.set(HEALTH, h),
    base: baseUrl(String(options.agentBoardUrl ?? ''), env, workspace),
  }
  const offRepos = ((await $.store.get('offRepos')) ?? {}) as Record<string, true>
  const { isOn, offBy } = reporting({
    sessionOff: !!(await $.state.get(SESSION_OFF)).value,
    projectOff: Object.keys(offRepos).length > 0 && !!offRepos[repoKey(await where($))],
    override: await $.store.get('override'),
    enabled: options.enabled !== false,
  })
  const origin = new URL(deps.base).origin
  return { isOn, offBy, deps, urlOf: (id?: string | null) => cardUrl(origin, id, workspace) }
}

type Settings = Awaited<ReturnType<typeof settings>>

type Here = { cwd: string; toplevel: string | null; branch: string | null }

// The repo a session works in: what project choices and the "project" off scope are kept under.
function repoKey(here: Here): string {
  return here.toplevel ?? here.cwd
}

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

async function remember($: any, row: Card, urlOf: Settings['urlOf']) {
  await $.state.set(BAND, { kind: 'linked', card: { ...toBandCard(row), url: urlOf(row.id) } })
}

// `agent-board config ask off` (the same file the CLI and MCP read) turns every question off: the
// mod then says what to type instead.
async function askEnabled($: any): Promise<boolean> {
  try {
    const dir = (await $.env.get('AGENT_BOARD_DIR')) || `${await $.env.get('HOME')}/.agent-board`
    return String(await $.fs.read(`${dir}/ask`)).trim() !== 'off'
  } catch {
    return true
  }
}

// Options only (AB-23): anything but a label (Other, Esc, a -p run) is undefined, i.e. cancel.
async function ask<T>($: any, question: string, header: string, choices: Choice<T>[]): Promise<T | undefined> {
  try {
    return answerOf(choices, await $.ui.ask(question, { header, options: choices.map((c) => c.label) }))
  } catch {
    return undefined
  }
}

async function keep($: any, key: 'repoProjects' | 'declinedRepos' | 'offRepos', repo: string, value: unknown) {
  const all = { ...(((await $.store.get(key)) ?? {}) as Record<string, unknown>) }
  if (value === undefined) delete all[repo]
  else all[repo] = value
  await $.store.set(key, all)
}

// Claiming changes who owns a card (D15), so it only runs for a unique match
// or a person's explicit `link`. D19: it sets the owner and nothing else: opening a session
// is not the same as the work having started, so the status is left to whoever really moves it.
async function claim($: any, s: Settings, card: Card, here: Here) {
  const row = await call(s.deps, 'PATCH', `/tasks/${card.id}`, {
    agent: 'claude', worktree: here.cwd, ...(here.branch ? { branch: here.branch } : {}),
  })
  if (!row) return false
  await $.state.set(BINDING, { sessionId: await $.session.id(), cardId: card.id })
  await remember($, row, s.urlOf)
  // The repo's project is now known: /board-sync new puts cards there without asking.
  if (row.project) await keep($, 'repoProjects', repoKey(here), row.project)
  return true
}

// The first session ever (AB-23): one line saying the board answered and where the web tour is,
// or how to start it. Each is shown once ($.store); never an error (D3).
async function welcome($: any, up: boolean, url: string) {
  const seen = await $.store.get('welcome')
  if (seen === 'done' || (!up && seen === 'offline')) return
  await $.store.set('welcome', up ? 'done' : 'offline')
  if (await drawsBand($)) await $.state.set(WELCOME, up ? { kind: 'connected', url } : { kind: 'offline' })
  else toast($, up ? `Agent Board connected. First time? Take the tour: ${url}` : `Agent Board is not running: ${START_HINT}`)
}

// Several cards match (scenario 5): the person picks one, or none. Picking is an explicit choice,
// like /board-sync link, so it claims even a card another agent holds.
async function askWhichCard($: any, s: Settings, ids: string[]): Promise<string | null> {
  const cards = ((await call(s.deps, 'GET', '/tasks')) as Card[] | null)?.filter((c) => ids.includes(c.id))
  if (!cards?.length) return null
  const id = await ask($, `${cards.length} cards match this branch. Which one is this session working on?`, 'Which card', cardChoices(cards))
  const card = id && cards.find((c) => c.id === id)
  return card && (await claim($, s, card, await where($))) ? card.id : null
}

async function autoBind($: any, s: Settings, interactive: boolean) {
  const { deps } = s
  const sessionId = await $.session.id()
  const bound = (await $.state.get(BINDING)).value
  if (bound?.sessionId === sessionId) {
    // Hot reload re-ran session.start, or /board-sync on after off: the line needs a card to draw again.
    if ((await $.state.get(BAND)).value) return
    const row = (await call(deps, 'GET', '/tasks') as Card[] | null)?.find((c) => c.id === bound.cardId)
    return row ? remember($, row, s.urlOf) : undefined
  }
  const cards: Card[] | null = await call(deps, 'GET', '/tasks')
  if (interactive) await welcome($, !!cards, s.urlOf())
  if (!cards) return // server down: silent (past the one-time hint above)
  const here = await where($)
  const hit = pickCard(cards, here)
  // Scenario 7: no question, the line says what to type.
  if (hit.kind === 'none') return say($, { kind: 'none' }, 'Agent Board: no card matches this worktree/branch. /board-sync new to open one, or /board-sync link <ID>')
  if (hit.kind === 'many') {
    const ids = hit.cards.map((c) => c.id)
    await say($, { kind: 'many', ids }, `Agent Board: ${ids.join(', ')} all match. /board-sync link <ID> to pick one`)
    // Scenario 5: asked once per session (a hot reload re-runs this), never with asking turned off.
    if (!interactive || (await $.state.get(ASKED)).value || !(await askEnabled($))) return
    await $.state.set(ASKED, true)
    const id = await askWhichCard($, s, ids)
    if (id) toast($, `Agent Board: working on ${id}`)
    return
  }
  const { card } = hit
  // Scenario 6 (D16): never taken from another agent without the person saying so.
  if (card.agent && card.agent !== 'claude') {
    return say($, { kind: 'held', id: card.id, agent: card.agent }, `Agent Board: ${card.id} is held by ${card.agent}. /board-sync link ${card.id} to take it`)
  }
  if (await claim($, s, card, here)) toast($, `Agent Board: working on ${card.id}`)
}

async function reportTurn($: any, options: PluginOptions, turnId: string, answer: string) {
  const s = await settings($, options)
  const { isOn, deps } = s
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
  if (row) await remember($, row, s.urlOf)
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

// Which project this repo's cards go to (scenario 3). Known without asking: the "project" option, the
// project this repo was linked to before, or one named like the repo. Otherwise ask, only from a
// command the person typed: two prefixes the server suggests (D15), the web, or not now (remembered).
async function repoProject($: any, s: Settings, options: PluginOptions, here: Here): Promise<{ name: string; isNew?: true } | { text: string }> {
  const projects: { name: string }[] | null = await call(s.deps, 'GET', '/projects')
  if (!projects) return { text: UNREACHABLE }
  const key = repoKey(here)
  const repo = repoName(key)
  const remembered = (((await $.store.get('repoProjects')) ?? {}) as Record<string, string>)[key]
  const name = projectFor(projects, { configured: String(options.project ?? ''), remembered, repo })
  if (name) return { name }
  const how = `create a project for it on the web (${s.urlOf()}) named "${repo}", or set this plugin's "project" option`
  if ((((await $.store.get('declinedRepos')) ?? {}) as Record<string, true>)[key]) return { text: `No board project for ${repo} (you said not now): ${how}` }
  if (!(await askEnabled($))) return { text: `No board project for ${repo}: ${how}` }
  const r = await request(s.deps, 'POST', '/projects', { name: repo })
  if (!r) return { text: UNREACHABLE }
  const prefixes = isNeedsInput(r.data) ? r.data.options.map((o) => String(o.args.prefix ?? '')).filter(Boolean) : []
  if (!prefixes.length) return { text: `No board project for ${repo}: ${how}` }
  const answer = await ask($, `This repo has no board project yet. Create "${repo}" with which ticket prefix?`, 'New project', projectChoices(prefixes))
  if (answer === undefined) return { text: 'Cancelled' }
  if (answer === 'web') return { text: `Open ${s.urlOf()} and create the project there, then /board-sync new` }
  if (answer === 'not-now') {
    await keep($, 'declinedRepos', key, true)
    return { text: `OK, no more questions about a project for ${repo}. Later: ${how}` }
  }
  const made = await request(s.deps, 'POST', '/projects', { name: repo, prefix: answer.prefix })
  if (!made?.ok) return { text: `Could not create the project: ${made?.data?.error ?? 'Agent Board is not reachable'}` }
  await keep($, 'repoProjects', key, repo)
  return { name: repo, isNew: true }
}

// Scenario 4: /board-sync new ["title"]. No title: the conversation's first sentence, the branch, or
// cancel. A needs_input answer from the board is asked as it comes and sent again with the choice.
async function newCard($: any, s: Settings, options: PluginOptions, arg: string): Promise<string> {
  const here = await where($)
  const project = await repoProject($, s, options, here)
  if ('text' in project) return project.text
  let title = arg.replace(/^["'“”]|["'“”]$/g, '').trim()
  if (!title) {
    if (!(await askEnabled($))) return 'Give the card a title: /board-sync new "title"'
    const choices = titleChoices(firstSentence(await $.session.messages()), here.branch)
    if (choices.length < 2) return 'Give the card a title: /board-sync new "title"'
    const picked = await ask($, 'What should the new card be called?', 'New card', choices)
    if (!picked) return 'Cancelled'
    title = picked
  }
  let body: Record<string, unknown> = {
    title, project: project.name, agent: 'claude', status: 'in_progress', worktree: here.cwd, ...(here.branch ? { branch: here.branch } : {}),
  }
  for (let round = 0; round < 3; round++) {
    const r = await request(s.deps, 'POST', '/tasks', body)
    if (!r) return UNREACHABLE
    if (r.ok) {
      const card: Card = r.data
      await $.state.set(BINDING, { sessionId: await $.session.id(), cardId: card.id })
      await remember($, card, s.urlOf)
      await keep($, 'repoProjects', repoKey(here), card.project ?? project.name)
      return `Created ${card.id}${project.isNew ? ` in the new project ${project.name}` : ''}: ${s.urlOf(card.id)}`
    }
    if (!isNeedsInput(r.data)) return `Could not create the card: ${r.data?.error ?? `HTTP ${r.status}`}`
    if (!(await askEnabled($))) return `Could not create the card: ${r.data.error}`
    const args = await ask($, r.data.question, 'Agent Board', needsInputChoices(r.data))
    if (!args) return 'Cancelled'
    body = { ...body, ...args }
  }
  return 'Could not create the card'
}

// AB-19: the card (or the board) in the browser. Plain argv, no shell; whichever opener exists.
async function openUrl($: any, url: string): Promise<boolean> {
  for (const argv of [['open', url], ['xdg-open', url], ['rundll32', 'url.dll,FileProtocolHandler', url]]) {
    try {
      if ((await $.process.run(argv, { timeoutMs: 3000 })).exitCode === 0) return true
    } catch {}
  }
  return false
}

async function status($: any, s: Settings, options: PluginOptions): Promise<string> {
  const binding = (await $.state.get(BINDING)).value
  const health = await s.deps.getHealth()
  const retryInS = health.fails ? Math.max(0, Math.ceil((health.until - (await s.deps.now())) / 1000)) : null
  return statusText({
    isOn: s.isOn, offBy: s.offBy ? OFF_LABEL[s.offBy] : undefined, url: s.urlOf(binding?.cardId),
    server: new URL(s.deps.base).origin, workspace: String(options.workspace ?? '') || 'default',
    retryInS, bound: binding?.cardId ?? null, state: (await $.state.get(BAND)).value ?? null,
  })
}

async function boardSync($: any, options: PluginOptions, args: string): Promise<string> {
  const sub = args.trim().split(/\s+/)[0] ?? ''
  const arg = args.trim().slice(sub.length).trim()
  const s = await settings($, options)
  if (sub === 'off') {
    // D21 / AB-27: how far "off" reaches is a setting; this session by default.
    const scope = (['session', 'project', 'global'].includes(String(options.offScope)) ? options.offScope : 'session') as OffScope
    if (scope === 'session') await $.state.set(SESSION_OFF, true)
    else if (scope === 'project') await keep($, 'offRepos', repoKey(await where($)), true)
    else await $.store.set('override', 'off')
    await $.state.set(BAND, null)
    await $.state.set(WELCOME, null)
    return `Agent Board reporting: off (${OFF_LABEL[scope]})${scope === 'session' ? ', back on in the next session' : ''}`
  }
  if (sub === 'on') {
    await $.state.set(SESSION_OFF, false)
    await keep($, 'offRepos', repoKey(await where($)), undefined)
    await $.store.set('override', 'on')
    await autoBind($, await settings($, options), false).catch(() => {})
    return 'Agent Board reporting: on'
  }
  if (sub === 'status') return status($, s, options)
  if (sub === 'open') {
    const url = s.urlOf((await $.state.get(BINDING)).value?.cardId)
    return (await openUrl($, url)) ? `Opened ${url}` : `Open ${url}`
  }
  if (sub === 'link' && arg) {
    const cards: Card[] | null = await call(s.deps, 'GET', '/tasks')
    const card = cards?.find((c) => c.id === arg)
    if (!card) return cards ? `No card ${arg}` : UNREACHABLE
    return (await claim($, s, card, await where($))) ? `Linked to ${card.id}` : 'Could not update the card'
  }
  if (sub === 'new') return newCard($, s, options, arg)
  if (sub === '' || sub === 'link') {
    // AB-19: no dead end. Bare /board-sync asks what is open (which card, or which project), then shows where things stand.
    const state: BandState | null = (await $.state.get(BAND)).value ?? null
    const bound = (await $.state.get(BINDING)).value?.sessionId === (await $.session.id())
    let said = ''
    if (s.isOn && !bound && state?.kind === 'many' && (await askEnabled($))) {
      const id = await askWhichCard($, s, state.ids)
      if (id) said = `Linked to ${id}\n`
    } else if (s.isOn && !bound && state?.kind === 'none') {
      const project = await repoProject($, s, options, await where($))
      if ('isNew' in project) said = `Created the project ${project.name}. /board-sync new to open its first card\n`
      else if ('text' in project && project.text !== 'Cancelled') said = project.text + '\n'
    }
    return said + (await status($, await settings($, options), options))
  }
  return 'Usage: /board-sync [open | status | on | off | link <ID> | new ["title"]]'
}

// D20: the always-on line. Everything it shows comes from $.state (written by the hooks above), never
// from a request made while drawing. Helpers live at the top level because `claude plugin validate`
// only follows `$` into top-level functions.
function bandText(seg: Seg) {
  return { ...(seg.color && { color: seg.color }), ...(seg.bold && { bold: true }), ...(seg.dim && { dimColor: true }) }
}

async function bandView($: any, e: any, next: any) {
  if (e.props.hasSurvey) return next(e) // a survey owns the band: yield
  const welcome = (await $.state.get(WELCOME)).value ?? null
  const state: BandState | null = (await $.state.get(BAND)).value ?? null
  const health = (await $.state.get(HEALTH)).value ?? { fails: 0, until: 0 }
  const layout = welcome ? welcomeLayout(welcome, e.props.bodyColumns) : bandLayout(state, health.fails > 0, e.props.bodyColumns)
  if (!layout) return next(e)
  const { Box, Text, Link } = $.ui.resolve(e)
  const draw = (seg: Seg) => {
    const text = <Text {...bandText(seg)}>{seg.text}</Text>
    return seg.href ? <Link href={seg.href}>{text}</Link> : text
  }
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
      await $.command.register({ name: 'board-sync', description: 'Agent Board: where this session stands, and what to do next', argumentHint: '[open|status|on|off|link <ID>|new ["title"]]' })
      const st = await settings($, options)
      if (st.isOn) await autoBind($, st, e.isInteractive !== false)
    } catch {}
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    // Subagent turns reach every hook; only the main loop's answer is reported.
    if (e.agentId !== undefined) return result
    // The first-session welcome stays until the first turn has ended.
    try { if ((await $.state.get(WELCOME)).value) await $.state.set(WELCOME, null) } catch {}
    if (e.reason !== 'answer') return result
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
