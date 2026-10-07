// The onboarding questions (AB-23) as plain data: what each $.ui.ask offers and what an answer
// means. No engine dependency, so `npm test` (test/mod-onboard.test.js) and the hooks share it.
// Only options, never typed text: an answer that is not one of the labels (the dialog's "Other")
// counts as a cancel, because typed text there has leaked into the main prompt.

import type { Card } from './pick-card'

export type Choice<T> = { label: string; value: T }

export const CANCEL = 'Cancel'
export const NONE_OF_THESE = 'None of these'
export const ON_THE_WEB = "I'll set it up on the web"
export const NOT_NOW = 'Not now'

// Dialog labels wrap rather than overflow, so a plain length cap is enough. No import from band.ts:
// Node loads this file as is for `npm test`, and only type imports survive that.
const LABEL_MAX = 50
const cut = (s: string) => (s.length > LABEL_MAX ? s.slice(0, LABEL_MAX - 1).trimEnd() + '…' : s)

// The value behind the label the person picked; undefined for anything else (Other, dismissed).
// Blanks are compared collapsed: the dialog draws (and answers) "A  B" as "A B" (seen on 2.1.291).
const squash = (s: string) => s.replace(/\s+/g, ' ').trim()
export const answerOf = <T,>(choices: Choice<T>[], answer: string | null | undefined): T | undefined =>
  answer == null ? undefined : choices.find((c) => squash(c.label) === squash(answer))?.value

// First sentence of the first thing the person typed in this conversation; slash commands and
// rows the engine inserts (<command-name>…, <local-command-stdout>…) are skipped.
export function firstSentence(messages: readonly { role: string; text: string }[]): string | null {
  const first = messages.find((m) => m.role === 'user' && m.text.trim() && !/^\s*[</]/.test(m.text))
  const s = first?.text.trim().split(/\n|(?<=[.!?])\s+|[。！？]/)[0]?.trim().replace(/[.!?]+$/, '')
  return s ? cut(s.replace(/\s+/g, ' ')) : null
}

// `/board-sync new` with no title: the conversation's first sentence, the branch, or cancel.
export function titleChoices(sentence: string | null, branch: string | null): Choice<string | null>[] {
  const titles = [...new Set([sentence, branch].filter((t): t is string => !!t))]
  return [...titles.map((t) => ({ label: t, value: t as string | null })), { label: CANCEL, value: null }]
}

// Several cards match (D15/D16: the person picks, nothing is claimed by guessing): up to 3 cards.
export function cardChoices(cards: Card[]): Choice<string | null>[] {
  return [
    ...cards.slice(0, 3).map((c) => ({ label: cut(`${c.id} ${c.title.replace(/\s+/g, ' ')}`), value: c.id as string | null })),
    { label: NONE_OF_THESE, value: null },
  ]
}

export type ProjectAnswer = { prefix: string } | 'web' | 'not-now'

// A repo with no board project: two prefixes the server suggested (D15: the person picks the
// prefix, never the mod), set it up on the web, or not now.
export function projectChoices(prefixes: string[]): Choice<ProjectAnswer>[] {
  return [
    ...prefixes.slice(0, 2).map((p) => ({ label: `${p} (${p}-1, ${p}-2, …)`, value: { prefix: p } as ProjectAnswer })),
    { label: ON_THE_WEB, value: 'web' },
    { label: NOT_NOW, value: 'not-now' },
  ]
}

// A needs_input answer from the board (422): its options as choices, each carrying the fields to send again.
export type NeedsInput = { question: string; error: string; options: { label: string; args: Record<string, unknown> }[] }

// The server sends at most 4; Cancel fills a free slot (Esc cancels too).
export function needsInputChoices(n: NeedsInput): Choice<Record<string, unknown> | null>[] {
  const opts = n.options.slice(0, 4).map((o) => ({ label: o.label, value: o.args as Record<string, unknown> | null }))
  return opts.length < 4 ? [...opts, { label: CANCEL, value: null }] : opts
}

export const isNeedsInput = (data: any): data is NeedsInput & { code: 'needs_input' } =>
  data?.code === 'needs_input' && Array.isArray(data.options) && data.options.length > 0

// The repo's folder name: what a board project for this repo is called by default.
export const repoName = (dir: string) => dir.replace(/\/+$/, '').split('/').pop() || dir

// Which project this repo's cards go to, without asking: the plugin option, the one this repo was
// linked to before, or a project named like the repo (ignoring case). null: ask (or say how).
export function projectFor(projects: { name: string }[], opts: { configured: string; remembered?: string; repo: string }): string | null {
  const names = projects.map((p) => p.name)
  if (opts.configured) return opts.configured
  if (opts.remembered && names.includes(opts.remembered)) return opts.remembered
  const same = names.filter((n) => n.toLowerCase() === opts.repo.toLowerCase())
  return same.length === 1 ? same[0]! : null
}

// The card on the web (AB-18's ?task=ID); the workspace only when it is not the default one.
export function cardUrl(origin: string, id?: string | null, workspace?: string): string {
  const q = [id && `task=${encodeURIComponent(id)}`, workspace && `workspace=${encodeURIComponent(workspace)}`].filter(Boolean)
  return `${origin}/${q.length ? '?' + q.join('&') : ''}`
}

// D21 / AB-27: where `/board-sync off` holds. session (default): until this session ends;
// project: this repo, every session; global: everywhere, until `/board-sync on`.
export type OffScope = 'session' | 'project' | 'global'

export const OFF_LABEL: Record<OffScope | 'settings', string> = {
  session: 'this session', project: 'this project', global: 'everywhere', settings: 'settings',
}

export function reporting(s: { sessionOff: boolean; projectOff: boolean; override: unknown; enabled: boolean }): { isOn: boolean; offBy: keyof typeof OFF_LABEL | null } {
  if (s.sessionOff) return { isOn: false, offBy: 'session' }
  if (s.projectOff) return { isOn: false, offBy: 'project' }
  if (s.override === 'off') return { isOn: false, offBy: 'global' }
  if (s.override === 'on' || s.enabled) return { isOn: true, offBy: null }
  return { isOn: false, offBy: 'settings' }
}
