import { describe, expect, test } from 'claude-code/testing'

import { band, bandTarget, card, sync, world } from './world'

// The eight onboarding scenarios of AB-23, plus AB-19 (open, bare /board-sync) and AB-27 (off scope).

describe('1. first-session welcome', () => {
  test('board up: the line says connected and links the web tour, once', async ($, on) => {
    const w = world(on, { store: { welcome: undefined } })
    await $.session.start(w.start)
    const ui = await $.ui.mount(bandTarget())
    const b = await band(ui)
    expect(b.text).toContain('Agent Board connected · first time? take the tour')
    expect(b.text).toContain('http://localhost:4317/?tour=1')
    await $.turn.complete(w.complete('t1')) // gone after the first turn
    expect((await band(ui)).text).toContain('no card for this branch')
    expect(w.store['welcome']).toBe('done')
  })

  test('board down: how to start it, no error, and the connected welcome still comes later', async ($, on) => {
    const w = world(on, { store: { welcome: undefined } })
    w.mode = 'down'
    await $.session.start(w.start)
    expect((await band(await $.ui.mount(bandTarget()))).text).toContain('Agent Board is not running  → start it in another terminal')
    expect(w.store['welcome']).toBe('offline')
  })

  test('a later session shows nothing of it', async ($, on) => {
    const w = world(on, { store: { welcome: 'done' }, cards: [card('P-1', { worktree: '/work/x' })] })
    await $.session.start(w.start)
    expect((await band(await $.ui.mount(bandTarget()))).text).not.toContain('first time')
  })
})

describe('2. auto bind still works', () => {
  test('one match by branch is claimed without a question', async ($, on) => {
    const w = world(on, { cards: [card('P-1', { branch: 'feat/x' })] })
    await $.session.start(w.start)
    expect(w.cards[0]!.agent).toBe('claude')
    expect(w.asked).toEqual([])
  })
})

describe('3. a repo with no board project', () => {
  const noProject = { projects: [{ name: 'Agent Board', prefix: 'AB' }], cards: [card('AB-1', { worktree: '/elsewhere' })] }

  test('session start asks nothing', async ($, on) => {
    const w = world(on, noProject)
    await $.session.start(w.start)
    expect(w.asked).toEqual([])
  })

  test('/board-sync new asks for a prefix (two suggested, web, not now) and creates project + card', async ($, on) => {
    const w = world(on, { ...noProject, answers: ['X (X-1, X-2, …)', 'Fix the login bug'], cwd: '/work/x' })
    w.messages = [{ role: 'user', text: 'Fix the login bug. It loops on Safari.', toolUses: [] }]
    await $.session.start(w.start)
    const out = (await sync($, 'new')).text
    expect(w.asked[0]).toMatchObject({ header: 'New project', options: ['X (X-1, X-2, …)', 'XX (XX-1, XX-2, …)', "I'll set it up on the web", 'Not now'] })
    expect(w.projects.at(-1)).toEqual({ name: 'x', prefix: 'X' })
    expect(out).toContain('in the new project x')
    expect(w.cards.at(-1)).toMatchObject({ title: 'Fix the login bug', project: 'x' })
  })

  test('"Not now" is remembered for this repo: no more questions', async ($, on) => {
    const w = world(on, { ...noProject, answers: ['Not now'] })
    await $.session.start(w.start)
    expect((await sync($, 'new "t"')).text).toContain('OK, no more questions')
    expect((await sync($, 'new "t"')).text).toContain('you said not now')
    expect((await sync($, '')).text).toContain('Agent Board  ● reporting on')
    expect(w.asked).toHaveLength(1)
  })

  test('"on the web" points at the board and creates nothing', async ($, on) => {
    const w = world(on, { ...noProject, answers: ["I'll set it up on the web"] })
    await $.session.start(w.start)
    expect((await sync($, 'new "t"')).text).toBe('Open http://localhost:4317/ and create the project there, then /board-sync new')
    expect(w.projects).toHaveLength(1) // asking for prefixes (POST without one) creates nothing
    expect(w.cards).toHaveLength(1)
  })

  test('typed text (Other) is a cancel, never a prefix', async ($, on) => {
    const w = world(on, { ...noProject, answers: ['ZZZ'] })
    await $.session.start(w.start)
    expect((await sync($, 'new "t"')).text).toBe('Cancelled')
    expect(w.projects).toHaveLength(1)
    expect(w.cards).toHaveLength(1)
  })

  test('bare /board-sync asks too, then shows the status', async ($, on) => {
    const w = world(on, { ...noProject, answers: ['X (X-1, X-2, …)'] })
    await $.session.start(w.start)
    const out = (await sync($, '')).text
    expect(out).toContain('Created the project x')
    expect(out).toContain('Agent Board  ● reporting on')
  })

  test('a project linked before is used without asking', async ($, on) => {
    const w = world(on, { ...noProject, cards: [card('AB-1', { project: 'Agent Board' })] })
    await $.session.start(w.start)
    await sync($, 'link AB-1')
    await sync($, 'new "next thing"')
    expect(w.asked).toEqual([])
    expect(w.cards.at(-1)).toMatchObject({ title: 'next thing', project: 'Agent Board' })
  })
})

describe('4. /board-sync new without a title', () => {
  test('offers the first sentence, the branch, cancel', async ($, on) => {
    const w = world(on, { answers: ['feat/x'] })
    w.messages = [{ role: 'user', text: '/board-sync new', toolUses: [] }, { role: 'user', text: '幫我修登入頁。很急', toolUses: [] }]
    await $.session.start(w.start)
    await sync($, 'new')
    expect(w.asked[0]).toMatchObject({ header: 'New card', options: ['幫我修登入頁', 'feat/x', 'Cancel'] })
    expect(w.cards.at(-1)).toMatchObject({ title: 'feat/x' })
  })

  test('Cancel creates nothing', async ($, on) => {
    const w = world(on, { answers: ['Cancel'] })
    await $.session.start(w.start)
    expect((await sync($, 'new')).text).toBe('Cancelled')
    expect(w.mutations()).toEqual([])
  })

  test('the board answers needs_input: its options are asked, the pick is sent again', { options: { project: 'Nope' } }, async ($, on) => {
    const w = world(on, { answers: ['Use x'] })
    await $.session.start(w.start)
    expect((await sync($, 'new "a title"')).text).toContain('Created P-1')
    expect(w.asked[0]).toMatchObject({ header: 'Agent Board', question: 'No project "Nope". Which one?', options: ['Use x', 'Cancel'] })
    expect(w.cards[0]).toMatchObject({ title: 'a title', project: 'x' })
  })

  test('the quoted form still works and asks nothing', async ($, on) => {
    const w = world(on)
    await $.session.start(w.start)
    expect((await sync($, 'new "Do it"')).text).toContain('Created P-1')
    expect(w.asked).toEqual([])
  })
})

describe('5. several cards match', () => {
  const two = [card('P-1', { worktree: '/work/x', title: 'one' }), card('P-2', { branch: 'feat/x', title: 'two' })]

  test('asked at start: up to three cards and "None of these"; the pick is claimed', async ($, on) => {
    const w = world(on, { cards: two, answers: ['P-2 two'] })
    await $.session.start(w.start)
    expect(w.asked[0]).toMatchObject({ header: 'Which card', options: ['P-1 one', 'P-2 two', 'None of these'] })
    expect(w.cards[1]!.agent).toBe('claude')
    expect(w.cards[0]!.agent).toBeNull()
  })

  test('"None of these" claims nothing; a hot reload does not ask again; bare /board-sync does', async ($, on) => {
    const w = world(on, { cards: two, answers: ['None of these', 'P-1 one'] })
    await $.session.start(w.start)
    await $.session.start(w.start)
    expect(w.asked).toHaveLength(1)
    expect(w.mutations()).toEqual([])
    expect((await sync($, '')).text).toContain('Linked to P-1')
  })

  test('at most three cards are offered', async ($, on) => {
    const w = world(on, { cards: [1, 2, 3, 4].map((i) => card(`P-${i}`, { branch: 'feat/x' })) })
    await $.session.start(w.start)
    expect(w.asked[0]!.options).toHaveLength(4)
    expect(w.asked[0]!.options.at(-1)).toBe('None of these')
  })
})

describe('6 and 7: held, or no match: no question', () => {
  test('held by another agent: not taken, the line says how to take it', async ($, on) => {
    const w = world(on, { cards: [card('P-1', { worktree: '/work/x', agent: 'codex' })] })
    await $.session.start(w.start)
    expect(w.asked).toEqual([])
    expect(w.mutations()).toEqual([])
    expect((await band(await $.ui.mount(bandTarget()))).text).toContain('/board-sync link P-1 to take over')
  })

  test('no match: no question, the line says /board-sync new', async ($, on) => {
    const w = world(on, { cards: [card('P-1', { worktree: '/other' })] })
    await $.session.start(w.start)
    expect(w.asked).toEqual([])
    expect((await band(await $.ui.mount(bandTarget()))).text).toContain('no card for this branch  → /board-sync new to open one')
  })
})

describe('8. open, bare /board-sync, the card link (AB-19)', () => {
  test('/board-sync open opens the bound card on the web', async ($, on) => {
    const w = world(on, { cards: [card('P-1', { worktree: '/work/x' })] })
    await $.session.start(w.start)
    expect((await sync($, 'open')).text).toBe('Opened http://localhost:4317/?task=P-1')
    expect(w.opened[0]).toEqual(['open', 'http://localhost:4317/?task=P-1'])
  })

  test('with a workspace the URL names it; unbound opens the board', { options: { workspace: 'my ws' } }, async ($, on) => {
    const w = world(on, { cards: [] })
    await $.session.start(w.start)
    expect((await sync($, 'open')).text).toBe('Opened http://localhost:4317/?workspace=my%20ws')
  })

  test('bare /board-sync: the card, on/off, the next step and the commands', async ($, on) => {
    const w = world(on, { cards: [card('P-1', { worktree: '/work/x' })] })
    await $.session.start(w.start)
    const text = (await sync($, '')).text
    expect(text).toContain('● reporting on')
    expect(text).toContain('card       P-1')
    expect(text).toContain('open       http://localhost:4317/?task=P-1')
    expect(text).toContain('commands   open | on | off')
  })

  test('the line draws no Link (a terminal without OSC 8 would print the URL twice)', async ($, on) => {
    const w = world(on, { cards: [card('P-1', { worktree: '/work/x' })], store: { welcome: undefined } })
    await $.session.start(w.start)
    expect(await (await $.ui.mount(bandTarget())).findAll({ type: 'Link' })).toEqual([])
  })
})

describe('AB-27: how far /board-sync off reaches (D21)', () => {
  test('default session: off now, on again in the next session', async ($, on) => {
    const w = world(on, { cards: [card('P-1', { worktree: '/work/x' })] })
    await $.session.start(w.start)
    expect((await sync($, 'off')).text).toBe('Agent Board reporting: off (this session), back on in the next session')
    expect((await sync($, 'status')).text).toContain('reporting off (this session)')
    expect(w.store['override']).toBeUndefined() // nothing kept beyond the session
  })

  test('project: kept for this repo only', { options: { offScope: 'project' } }, async ($, on) => {
    const w = world(on, { cards: [card('P-1', { worktree: '/work/x' })] })
    await $.session.start(w.start)
    await sync($, 'off')
    expect(w.store['offRepos']).toEqual({ '/work/x': true })
    expect((await sync($, 'status')).text).toContain('reporting off (this project)')
    await sync($, 'on')
    expect(w.store['offRepos']).toEqual({})
  })

  test('global: kept everywhere until on', { options: { offScope: 'global' } }, async ($, on) => {
    const w = world(on, { cards: [card('P-1', { worktree: '/work/x' })] })
    await $.session.start(w.start)
    await sync($, 'off')
    expect(w.store['override']).toBe('off')
    expect((await sync($, 'status')).text).toContain('reporting off (everywhere)')
  })
})

describe("the board's ask mode", () => {
  test('off: no dialogs; several cards are listed on the line', async ($, on) => {
    const w = world(on, { ask: 'off', cards: [card('P-1', { worktree: '/work/x' }), card('P-2', { branch: 'feat/x' })] })
    await $.session.start(w.start)
    expect(w.asked).toEqual([])
    expect((await band(await $.ui.mount(bandTarget()))).text).toContain('2 cards match')
  })

  test('off: no project question, says what to do instead', async ($, on) => {
    const w = world(on, { ask: 'off', projects: [{ name: 'Other', prefix: 'O' }] })
    await $.session.start(w.start)
    expect((await sync($, 'new "t"')).text).toContain('No board project for x: create a project for it on the web')
    expect(w.asked).toEqual([])
  })

  test('new: a missing title takes the first suggestion, no dialog', async ($, on) => {
    const w = world(on, { ask: 'new' })
    w.messages = [{ role: 'user', text: 'Fix the login bug. Now.', toolUses: [] }]
    await $.session.start(w.start)
    expect((await sync($, 'new')).text).toContain('titled "Fix the login bug" (rename it on the web)')
    expect(w.asked).toEqual([])
  })

  test('new: the new-project question is still asked', async ($, on) => {
    const w = world(on, { ask: 'new', projects: [{ name: 'Other', prefix: 'O' }], answers: ['Not now'] })
    await $.session.start(w.start)
    await sync($, 'new "t"')
    expect(w.asked[0]!.header).toBe('New project')
  })

  test('/board-sync ask shows and changes the mode', async ($, on) => {
    const w = world(on)
    await $.session.start(w.start)
    expect((await sync($, 'ask')).text).toBe('Agent Board asks: on (unclear requests ask you)')
    expect((await sync($, 'ask off')).text).toContain('Agent Board asks: off')
    expect(w.ask).toBe('off')
    expect((await sync($, 'ask maybe')).text).toBe('Usage: /board-sync ask [on | new | off]')
  })
})
