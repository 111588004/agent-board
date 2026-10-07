export type Card = {
  id: string
  title: string
  project?: string
  status: string
  agent: string | null
  worktree: string | null
  branch: string | null
  priority?: string | null
  notes?: string | null
}

export type Where = { cwd: string; toplevel?: string | null; branch?: string | null }

export type Pick = { kind: 'one'; card: Card } | { kind: 'none' } | { kind: 'many'; cards: Card[] }

const SHARED_BRANCHES = ['main', 'master', 'HEAD']

const trim = (p: string) => p.trim().replace(/\/+$/, '')

// D15: a card matches when its `worktree` is the session's directory (or an
// ancestor of it), or its `branch` is the session's branch (never a shared one
// like main, which many cards could name). Done cards never match. Only an
// unambiguous match is a hit. `worktree` must be an absolute path; `~` is not
// expanded because the hooks environment has no home directory to expand it with.
export function pickCard(cards: Card[], where: Where): Pick {
  const dirs = [where.cwd, where.toplevel].filter((d): d is string => !!d).map(trim)
  const branch = where.branch && !SHARED_BRANCHES.includes(where.branch) ? where.branch : null
  const hits = cards.filter((c) => {
    if (c.status === 'done') return false
    const wt = c.worktree ? trim(c.worktree) : ''
    if (wt && dirs.some((d) => d === wt || d.startsWith(wt + '/'))) return true
    return !!branch && c.branch === branch
  })
  if (hits.length === 1) return { kind: 'one', card: hits[0]! }
  return hits.length ? { kind: 'many', cards: hits } : { kind: 'none' }
}

const SECRET = /token|secret|password|api[_-]?key/i

// One line per turn: what came out of it (first line of the answer, secrets
// dropped, truncated) plus how much work it took. '' = nothing worth a note.
export function summarize(answer: string, uses: { tool: string; input: Record<string, unknown>; isError?: true }[]): string {
  const first = answer.split('\n').map((l) => l.trim()).find((l) => l && !SECRET.test(l)) ?? ''
  const files = new Set<string>()
  let bash = 0
  for (const u of uses) {
    if (u.isError) continue // a refused or failed call did not change anything
    if (u.tool === 'Bash') bash++
    else if (u.tool === 'Edit' || u.tool === 'Write') files.add(String(u.input.file_path))
    else if (u.tool === 'NotebookEdit') files.add(String(u.input.notebook_path))
  }
  const work = [files.size && `edited ${files.size} file${files.size > 1 ? 's' : ''}`, bash && `${bash} Bash`].filter(Boolean).join(', ')
  const text = first.length > 120 ? first.slice(0, 119) + '…' : first
  return [text, work && `(${work})`].filter(Boolean).join(' ')
}
