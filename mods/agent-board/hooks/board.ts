// REST access that never throws, never waits longer than `ms`, and backs off
// after a failure. Everything it needs from the engine is injected, so tests
// and the hooks share one code path.

export type Health = { fails: number; until: number }

export type Deps = {
  fetch: (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ status: number; ok: boolean; text: string }>
  sleep: (ms: number, signal: AbortSignal) => Promise<void>
  now: () => Promise<number>
  getHealth: () => Promise<Health>
  setHealth: (h: Health) => Promise<unknown>
  base: string // server URL, workspace prefix included
}

const BACKOFF_MS = 15_000
const BACKOFF_MAX_MS = 600_000

export const DEFAULT_URL = 'http://localhost:4317'

// Resolution order: userConfig > AGENT_BOARD_URL > default. The workspace
// route mirrors src/server.js (`/api/w/:workspace`).
export function baseUrl(configured: string, envUrl: string | undefined, workspace: string): string {
  const url = (configured || envUrl || DEFAULT_URL).replace(/\/+$/, '')
  return workspace ? `${url}/api/w/${encodeURIComponent(workspace)}` : `${url}/api`
}

// Parsed JSON on 2xx, null on anything else.
export async function call(d: Deps, method: string, path: string, body?: unknown, ms = 1500): Promise<any> {
  const r = await request(d, method, path, body, ms)
  return r && r.ok ? r.data : null
}

// { ok, status, data } for any answer (a 422 needs_input carries its question in `data`), null when
// the server could not be reached. Only transport failures (refused, timeout) count towards the
// backoff; a 404 means the server is alive.
export async function request(d: Deps, method: string, path: string, body?: unknown, ms = 1500): Promise<{ ok: boolean; status: number; data: any } | null> {
  try {
    const health = await d.getHealth()
    const now = await d.now()
    if (now < health.until) return null

    const stop = new AbortController()
    const pending = Promise.resolve().then(() =>
      d.fetch(d.base + path, {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    )
    pending.catch(() => {}) // the loser of the race must not surface as unhandled
    const timeout = d.sleep(ms, stop.signal).then(
      () => { throw new Error('timeout') },
      () => new Promise<never>(() => {}), // aborted because the request finished
    )

    let res
    try {
      res = await Promise.race([pending, timeout])
    } catch {
      const fails = health.fails + 1
      await d.setHealth({ fails, until: now + Math.min(BACKOFF_MAX_MS, BACKOFF_MS * 2 ** (fails - 1)) })
      return null
    } finally {
      stop.abort()
    }

    if (health.fails > 0) await d.setHealth({ fails: 0, until: 0 })
    let data = null
    try { data = JSON.parse(res.text || 'null') } catch {}
    return { ok: res.ok, status: res.status, data }
  } catch {
    return null
  }
}
