import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'

export type Card = { id: string; title: string; project?: string; status: string; agent: string | null; worktree: string | null; branch: string | null; priority?: string; notes?: string }

export const card = (id: string, over: Partial<Card> = {}): Card => ({
  id, title: `card ${id}`, status: 'backlog', agent: null, worktree: null, branch: null, ...over,
})

type Mode = 'ok' | 'down' | 'hang'

// Everything beneath the mod: an in-memory Agent Board (list/patch/post), git,
// the session, a clock, a store, the environment. `requests` logs each call.
// store: $.store's starting entries; by default the one-time welcome was already shown.
// answers: what the person picks in each $.ui.ask dialog, in order (a label, or anything else for Other).
export function world(on: On, opts: {
  cards?: Card[]; projects?: { name: string; prefix: string }[]; env?: Record<string, string>; branch?: string; cwd?: string
  surfaces?: ('terminal' | 'desktop' | 'vscode' | 'mobile')[]; store?: Record<string, unknown>; answers?: string[]; ask?: 'on' | 'new' | 'off'
} = {}) {
  const w = {
    cards: structuredClone(opts.cards ?? []),
    projects: structuredClone(opts.projects ?? [{ name: 'x', prefix: 'P' }]),
    answers: [...(opts.answers ?? [])],
    asked: [] as { question: string; header: string; options: string[] }[],
    opened: [] as string[][],
    store: undefined as unknown as Record<string, unknown>,
    ask: opts.ask ?? 'on', // the board's ask mode (GET/PUT /api/config)
    mode: 'ok' as Mode,
    requests: [] as { method: string; url: string; body: any }[],
    toasts: [] as string[],
    toastMs: [] as (number | undefined)[],
    statusCalls: [] as (string | undefined)[], // $.ui.status must stay unused (D20)
    messages: [] as any[],
    clock: mock.clock(on, { now: 1_000_000 }),
    cwd: opts.cwd ?? '/work/x',
    branch: opts.branch ?? 'feat/x',
    mutations: () => w.requests.filter((r) => r.method !== 'GET'),
    notes: (id: string) => w.mutations().filter((r) => r.url.endsWith(`/tasks/${id}`) && r.body?.note !== undefined),
    settle: () => w.clock.advance(1), // lets the mod's un-awaited work finish
    start: { surface: 'terminal', isInteractive: true, cwd: opts.cwd ?? '/work/x' } as const,
    complete: (turnId: string, over: object = {}) =>
      ({ answer: 'Fixed the bug.', durationMs: 5, isAborted: false, turnId, reason: 'answer', ...over }) as any,
  }
  // $.store in memory, readable by the test as `w.store`.
  const store: Record<string, unknown> = { welcome: 'done', ...opts.store }
  for (const k of Object.keys(store)) if (store[k] === undefined) delete store[k]
  on('store.get', (_$, e) => ({ value: structuredClone(store[e.key]) }))
  on('store.set', (_$, e) => { store[e.key] = structuredClone(e.value); return { value: undefined } })
  on('store.delete', (_$, e) => { delete store[e.key]; return { value: undefined } })
  on('store.keys', () => ({ value: Object.keys(store) }))
  mock.env(on, opts.env ?? {})

  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('command.register', () => ({ value: undefined as any }))
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: w.cwd }))
  on('session.messages', () => ({ value: w.messages as any }))
  on('ui.toast', (_$, e) => { w.toasts.push(e.text); w.toastMs.push(e.timeoutMs); return { value: undefined as any } })
  // The engine draws nothing in AbovePrompt: a plugin that passes leaves an empty Box.
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }) as any)
  on('session.surfaces', () => ({ value: opts.surfaces ?? ['terminal'] }))
  on('ui.status', (_$, e) => { w.statusCalls.push(e.text); return { value: undefined as any } })
  on('process.run', (_$, e) => {
    if (e.argv[0] !== 'git') w.opened.push([...e.argv])
    return { value: { exitCode: 0, stdout: `${e.argv[1] === 'rev-parse' ? w.cwd : w.branch}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  // $.ui.ask is a tool call of AskUserQuestion: answer with the next scripted pick.
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e: any) => {
    const q = e.questions[0]
    w.asked.push({ question: q.question, header: q.header, options: q.options.map((o: any) => o.label) })
    const answer = w.answers.shift()
    if (answer === undefined) return { deny: 'dismissed' }
    return { result: { questions: e.questions, answers: { [q.question]: answer } } } as any
  })
  on('http.fetch', async (_$, e) => {
    const method = e.init?.method ?? 'GET'
    const body = e.init?.body ? JSON.parse(e.init.body) : undefined
    w.requests.push({ method, url: e.url, body })
    if (w.mode === 'down') return { deny: 'ECONNREFUSED' }
    if (w.mode === 'hang') await new Promise(() => {})
    const json = (data: unknown, status = 200) => ({ value: { status, ok: status < 300, headers: {}, text: JSON.stringify(data) } })
    const url = new URL(e.url)
    const id = url.pathname.split('/tasks/')[1]
    if (url.pathname.endsWith('/config')) {
      if (method === 'PUT') w.ask = body.ask
      return json({ ask: w.ask })
    }
    if (url.pathname.endsWith('/projects')) {
      if (method === 'GET') return json(w.projects)
      // Like the server (D15): no prefix -> needs_input with suggested prefixes.
      if (!body.prefix) {
        const p = body.name.slice(0, 2).toUpperCase()
        return json({ code: 'needs_input', question: 'Which prefix?', error: 'needs input', options: [p, p + 'X', p + 'Y'].map((x) => ({ label: x, args: { name: body.name, prefix: x } })) }, 422)
      }
      w.projects.push({ name: body.name, prefix: body.prefix })
      return json(body, 201)
    }
    if (method === 'GET') {
      const status = url.searchParams.get('status')
      return json(w.cards.filter((c) => !status || c.status === status))
    }
    if (method === 'POST') {
      // Like the server: an unknown project asks (needs_input) instead of guessing.
      if (!w.projects.some((p) => p.name === body.project) && !body.newProjectPrefix) {
        return json({ code: 'needs_input', question: `No project "${body.project}". Which one?`, error: 'needs input: no project', options: w.projects.slice(0, 2).map((p) => ({ label: `Use ${p.name}`, args: { project: p.name } })) }, 422)
      }
      const { newProjectPrefix: _, ...fields } = body
      const c = card(`P-${w.cards.length + 1}`, { priority: 'med', ...fields })
      w.cards.push(c)
      return json(c, 201)
    }
    const c = w.cards.find((x) => x.id === id)
    if (!c) return json({ error: 'task not found' }, 404)
    const { note, ...fields } = body
    Object.assign(c, fields)
    // Like the server: a note is appended as one stamped line.
    if (note !== undefined) c.notes = `${c.notes ? c.notes + '\n' : ''}[2026-10-06 14:02 · ${fields.agent ?? 'x'}] ${note}`
    return json(c)
  })
  w.store = store
  return w
}

// `/board-sync <args>` as the person would type it.
export const sync = ($: any, args: string): Promise<{ text: string }> => $.command.run({ command: 'board-sync', args })

// The always-on line, mounted the way the engine mounts it (what AbovePrompt gets as props).
export const bandTarget = (columns = 115, over: object = {}, surface: 'terminal' | 'desktop' = 'terminal') =>
  ({
    plugin: 'agent-board', surface, component: 'AbovePrompt' as const,
    props: { hasSurvey: false, isWorking: false, maxRows: 8, bodyColumns: columns, scroll: { offset: 0, bodyRows: 7 }, view: {}, ...over },
  }) as const

type Seg = { text: string; color?: string; bold: boolean; dim: boolean }

// What the band shows: its Text pieces in order, with the theme key each carries.
export async function band(ui: { findAll: (q: { type: string }) => Promise<{ text: string; props: Record<string, unknown> }[]> }) {
  const segs: Seg[] = (await ui.findAll({ type: 'Text' })).map((t) => ({
    text: t.text, color: t.props.color as string | undefined, bold: !!t.props.bold, dim: !!t.props.dimColor,
  }))
  return { segs, shown: segs.map((s) => s.text.trimEnd()), text: segs.map((s) => s.text).join(''), colorOf: (needle: string) => segs.find((s) => s.text.includes(needle))?.color }
}
