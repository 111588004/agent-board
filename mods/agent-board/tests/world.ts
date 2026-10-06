import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'

export type Card = { id: string; title: string; status: string; agent: string | null; worktree: string | null; branch: string | null; notes?: string }

export const card = (id: string, over: Partial<Card> = {}): Card => ({
  id, title: `card ${id}`, status: 'backlog', agent: null, worktree: null, branch: null, ...over,
})

type Mode = 'ok' | 'down' | 'hang'

// Everything beneath the mod: an in-memory Agent Board (list/patch/post), git,
// the session, a clock, a store, the environment. `requests` logs each call.
export function world(on: On, opts: { cards?: Card[]; env?: Record<string, string>; branch?: string; cwd?: string } = {}) {
  const w = {
    cards: opts.cards ?? [],
    mode: 'ok' as Mode,
    requests: [] as { method: string; url: string; body: any }[],
    toasts: [] as string[],
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
  on('ui.toast', (_$, e) => { w.toasts.push(e.text); return { value: undefined as any } })
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
      const c = card(`P-${w.cards.length + 1}`, body)
      w.cards.push(c)
      return json(c, 201)
    }
    const c = w.cards.find((x) => x.id === id)
    if (!c) return json({ error: 'task not found' }, 404)
    const { note, ...fields } = body
    Object.assign(c, fields)
    return json(c)
  })
  return w
}

// `/board-sync <args>` as the person would type it.
export const sync = ($: any, args: string): Promise<{ text: string }> => $.command.run({ command: 'board-sync', args })
