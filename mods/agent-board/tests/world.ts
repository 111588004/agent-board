import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'

export type Card = { id: string; title: string; status: string; agent: string | null; worktree: string | null; branch: string | null; priority?: string; notes?: string }

export const card = (id: string, over: Partial<Card> = {}): Card => ({
  id, title: `card ${id}`, status: 'backlog', agent: null, worktree: null, branch: null, ...over,
})

type Mode = 'ok' | 'down' | 'hang'

// Everything beneath the mod: an in-memory Agent Board (list/patch/post), git,
// the session, a clock, a store, the environment. `requests` logs each call.
export function world(on: On, opts: { cards?: Card[]; env?: Record<string, string>; branch?: string; cwd?: string; surfaces?: ('terminal' | 'desktop' | 'vscode' | 'mobile')[] } = {}) {
  const w = {
    cards: opts.cards ?? [],
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
  mock.store(on)
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
  on('process.run', (_$, e) => ({
    value: { exitCode: 0, stdout: `${e.argv[1] === 'rev-parse' ? w.cwd : w.branch}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('http.fetch', async (_$, e) => {
    const method = e.init?.method ?? 'GET'
    const body = e.init?.body ? JSON.parse(e.init.body) : undefined
    w.requests.push({ method, url: e.url, body })
    if (w.mode === 'down') return { deny: 'ECONNREFUSED' }
    if (w.mode === 'hang') await new Promise(() => {})
    const json = (data: unknown, status = 200) => ({ value: { status, ok: status < 300, headers: {}, text: JSON.stringify(data) } })
    const url = new URL(e.url)
    const id = url.pathname.split('/tasks/')[1]
    if (url.pathname.endsWith('/projects')) return json([{ name: 'Proj', prefix: 'P' }])
    if (method === 'GET') {
      const status = url.searchParams.get('status')
      return json(w.cards.filter((c) => !status || c.status === status))
    }
    if (method === 'POST') {
      const c = card(`P-${w.cards.length + 1}`, { priority: 'med', ...body })
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
