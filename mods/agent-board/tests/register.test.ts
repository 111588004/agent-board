import { describe, expect, test } from 'claude-code/testing'

import { width } from '../hooks/band'
import { band, bandTarget, card, sync, world } from './world'

const END = (reason: string) => ({ reason, sessionId: 's1', resume: { id: 's1' } }) as any

describe('session.start: claiming (D15)', () => {
  test('a unique worktree match is claimed: owner set, status left alone (D19)', async ($, on) => {
    const w = world(on, { cards: [card('P-1', { worktree: '/work/x' }), card('P-2', { worktree: '/work/y' })] })
    await $.session.start(w.start)
    expect(w.cards[0]).toMatchObject({ agent: 'claude', status: 'backlog', branch: 'feat/x' })
    expect(w.cards[1]).toMatchObject({ agent: null, status: 'backlog' })
    expect(w.toasts[0]).toContain('P-1')
    expect(w.toastMs[0]).toBe(10_000) // long enough to read
    expect(w.statusCalls).toEqual([]) // D20: nothing goes through $.ui.status any more
    const ui = await $.ui.mount(bandTarget())
    expect((await band(ui)).text).toContain('P-1') // the line above the prompt shows the card
  })

  test('a unique branch match is claimed', async ($, on) => {
    const w = world(on, { cards: [card('P-1', { branch: 'feat/x' }), card('P-2', { branch: 'main' })], branch: 'feat/x' })
    await $.session.start(w.start)
    expect(w.cards.map((c) => c.agent)).toEqual(['claude', null])
  })

  test('a shared branch like main is not a match', async ($, on) => {
    const w = world(on, { cards: [card('P-1', { branch: 'main' })], branch: 'main' })
    await $.session.start(w.start)
    expect(w.mutations()).toEqual([])
  })

  test('zero matches: the band says so, nothing written, no card created', async ($, on) => {
    const w = world(on, { cards: [card('P-1', { worktree: '/other' })] })
    await $.session.start(w.start)
    expect(w.mutations()).toEqual([])
    expect((await band(await $.ui.mount(bandTarget()))).text).toContain('no card for this branch')
  })

  test('several matches: the band lists them, nothing written', async ($, on) => {
    const w = world(on, { cards: [card('P-1', { worktree: '/work/x' }), card('P-2', { branch: 'feat/x' })] })
    await $.session.start(w.start)
    expect(w.mutations()).toEqual([])
    expect((await band(await $.ui.mount(bandTarget()))).text).toContain('2 cards match: P-1 P-2')
  })

  test('a card another agent holds is not taken', async ($, on) => {
    const w = world(on, { cards: [card('P-1', { worktree: '/work/x', agent: 'codex', status: 'in_progress' })] })
    await $.session.start(w.start)
    expect(w.mutations()).toEqual([])
    expect((await band(await $.ui.mount(bandTarget()))).text).toContain('P-1 is held by codex')
  })

  test('a second session.start (hot reload) does not claim again', async ($, on) => {
    const w = world(on, { cards: [card('P-1', { worktree: '/work/x' })] })
    await $.session.start(w.start)
    await $.session.start(w.start)
    expect(w.mutations()).toHaveLength(1)
  })

  test('/board-sync link and new write back worktree/branch or create a card', async ($, on) => {
    const w = world(on, { cards: [card('P-1')] })
    await $.session.start(w.start)
    expect(await sync($, 'link P-1')).toEqual({ text: 'Linked to P-1' })
    expect(w.cards[0]).toMatchObject({ worktree: '/work/x', branch: 'feat/x', agent: 'claude', status: 'backlog' })
    expect((await sync($, 'new "Do the thing"')).text).toBe('Created P-2: http://localhost:4317/?task=P-2')
    expect(w.cards[1]).toMatchObject({ title: 'Do the thing', project: 'x', status: 'in_progress' })
  })
})

describe('turn.complete', () => {
  const claimed = async ($: any, on: any) => {
    const w = world(on, { cards: [card('P-1', { worktree: '/work/x' })] })
    await $.session.start(w.start)
    return w
  }

  test('writes one note per turn, with a work summary', async ($, on) => {
    const w = await claimed($, on)
    w.messages = [
      { role: 'user', text: 'old', toolUses: [{ tool: 'Edit', input: { file_path: '/old' } }] },
      { role: 'user', text: 'fix it', toolUses: [] },
      { role: 'assistant', text: '', toolUses: [{ tool: 'Edit', input: { file_path: '/a' } }, { tool: 'Edit', input: { file_path: '/a' } }, { tool: 'Bash', input: {} }, { tool: 'Edit', input: { file_path: '/b' }, isError: true }] },
      { role: 'user', text: '', toolUses: [], toolResults: [{}] },
    ]
    await $.turn.complete(w.complete('t1'))
    await w.settle()
    const notes = w.notes('P-1')
    expect(notes).toHaveLength(1)
    expect(notes[0]!.body).toEqual({ note: 'Fixed the bug. (edited 1 file, 1 Bash)', agent: 'claude' })
  })

  test('subagent and aborted turns write nothing', async ($, on) => {
    const w = await claimed($, on)
    await $.turn.complete(w.complete('t1', { agentId: 'sub1' }))
    await $.turn.complete(w.complete('t2', { reason: 'aborted', isAborted: true }))
    await w.settle()
    expect(w.notes('P-1')).toHaveLength(0)
  })

  test('a session without a card writes nothing', async ($, on) => {
    const w = world(on, { cards: [] })
    await $.session.start(w.start)
    await $.turn.complete(w.complete('t1'))
    await w.settle()
    expect(w.mutations()).toEqual([])
  })

  test('the same turnId is never noted twice', async ($, on) => {
    const w = await claimed($, on)
    await $.turn.complete(w.complete('t1'))
    await w.settle()
    await $.turn.complete(w.complete('t1'))
    await w.settle()
    await $.turn.complete(w.complete('t2'))
    await w.settle()
    expect(w.notes('P-1')).toHaveLength(2)
  })

  test('a hanging server holds the turn for at most the timeout, and the answer still goes out', async ($, on) => {
    const w = await claimed($, on)
    w.mode = 'hang'
    const done = $.turn.complete(w.complete('t1'))
    await w.clock.advance(1600)
    expect(await done).toMatchObject({ text: 'Fixed the bug.' })
  })
})

describe('server trouble (D3)', () => {
  test('refused connection: nothing throws, the next calls are skipped (backoff), then it retries', async ($, on) => {
    const w = world(on, { cards: [card('P-1', { worktree: '/work/x' })] })
    w.mode = 'down'
    await $.session.start(w.start) // probes, fails, swallowed
    expect(w.requests).toHaveLength(1)
    await sync($, 'link P-1')
    await $.session.end(END('other'))
    expect(w.requests, 'no more traffic while backing off').toHaveLength(1)
    expect((await sync($, 'status')).text).toContain('offline, retrying')

    w.mode = 'ok'
    await w.clock.advance(20_000)
    await $.session.start({ ...w.start })
    expect(w.requests.length).toBeGreaterThan(1)
    expect(w.cards[0]!.agent).toBe('claude')
  })

  test('a hanging server is cut off by the timeout', async ($, on) => {
    const w = world(on, { cards: [card('P-1', { worktree: '/work/x' })] })
    w.mode = 'hang'
    const started = $.session.start(w.start)
    await w.clock.advance(1600)
    await started
    expect(w.mutations()).toEqual([])
    expect(w.cards[0]!.agent).toBeNull()
  })

  test('a 404 is not a server failure (no backoff)', async ($, on) => {
    const w = world(on, { cards: [card('P-1', { worktree: '/work/x' })] })
    await $.session.start(w.start)
    expect(await sync($, 'link NOPE-9')).toEqual({ text: 'No card NOPE-9' })
    expect((await sync($, 'status')).text).not.toContain('offline')
  })
})

describe('session.end (D18)', () => {
  const claimed = async ($: any, on: any, over: object = {}) => {
    const w = world(on, { cards: [card('P-1', { worktree: '/work/x', ...over })] })
    await $.session.start(w.start)
    return w
  }

  test('only leaves a note: status and owner stay as they were', async ($, on) => {
    const w = await claimed($, on)
    await $.session.end(END('prompt_input_exit'))
    expect(w.cards[0]).toMatchObject({ status: 'backlog', agent: 'claude' })
    expect(w.notes('P-1').map((r) => r.body.note)).toContain('claude session ended')
    expect(w.mutations().map((r) => r.body.status)).not.toContain('review')
  })

  test('the end note does not carry `agent`, so it cannot take a card back', async ($, on) => {
    const w = await claimed($, on)
    w.cards[0]!.agent = 'codex' // someone picked it up during the session
    await $.session.end(END('other'))
    const last = w.mutations().at(-1)!
    expect(last.body).toEqual({ note: 'claude session ended' })
    expect(w.cards[0]!.agent).toBe('codex')
  })

  test('clear and resume are not an ending', async ($, on) => {
    const w = await claimed($, on)
    const before = w.mutations().length
    await $.session.end(END('clear'))
    await $.session.end(END('resume'))
    expect(w.mutations()).toHaveLength(before)
  })

  test('a card the person already moved to done keeps its status', async ($, on) => {
    const w = await claimed($, on)
    w.cards[0]!.status = 'done'
    await $.session.end(END('other'))
    expect(w.cards[0]!.status).toBe('done')
  })

  test('a session with no card writes nothing', async ($, on) => {
    const w = world(on, { cards: [] })
    await $.session.start(w.start)
    await $.session.end(END('other'))
    expect(w.mutations()).toEqual([])
  })
})

describe('switch (D3)', () => {
  test('enabled=false: no network, no writes, not even a probe', { options: { enabled: false } }, async ($, on) => {
    const w = world(on, { cards: [card('P-1', { worktree: '/work/x' })] })
    await $.session.start(w.start)
    await $.turn.complete(w.complete('t1'))
    await $.session.end(END('other'))
    await w.settle()
    expect(w.requests).toEqual([])
    expect(w.toasts).toEqual([])
    expect(w.statusCalls).toEqual([])
    expect(await band(await $.ui.mount(bandTarget()))).toMatchObject({ text: '' }) // no band either
  })

  test('/board-sync off stops reporting; on resumes and claims', async ($, on) => {
    const w = world(on, { cards: [card('P-1', { worktree: '/work/x' })] })
    await $.session.start(w.start)
    await sync($, 'off')
    const before = w.requests.length
    await $.turn.complete(w.complete('t1'))
    await $.session.end(END('other'))
    await w.settle()
    expect(w.requests).toHaveLength(before)
    expect(w.cards[0]!.status).toBe('backlog')
    await sync($, 'on')
    const status = (await sync($, 'status')).text
    expect(status).toContain('● reporting on')
    expect(status).toMatch(/server {5}http:\/\/localhost:4317 {3}● up/) // the page you can open, not the /api root
  })
})

describe('server URL', () => {
  test('AGENT_BOARD_URL beats the default', async ($, on) => {
    const w = world(on, { env: { AGENT_BOARD_URL: 'http://env:1' } })
    await $.session.start(w.start)
    expect(w.requests[0]!.url).toBe('http://env:1/api/tasks')
  })

  test('the default is localhost:4317', async ($, on) => {
    const w = world(on)
    await $.session.start(w.start)
    expect(w.requests[0]!.url).toBe('http://localhost:4317/api/tasks')
  })

  test('userConfig url and workspace', { options: { agentBoardUrl: 'http://cfg:2/', workspace: 'my ws' } }, async ($, on) => {
    const w = world(on, { env: { AGENT_BOARD_URL: 'http://env:1' } })
    await $.session.start(w.start)
    expect(w.requests[0]!.url).toBe('http://cfg:2/api/w/my%20ws/tasks')
  })
})
