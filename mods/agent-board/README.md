# Agent Board mod for Claude Code

Reports a Claude Code session's progress to [Agent Board](../../README.md) without anyone typing `agent-board update`. It is a convenience layer, not a dependency: the CLI and MCP server work the same without it, and with the Agent Board server stopped the mod stays silent.

Early-access API. The official article says mods are on by default from Claude Code 2.1.287. Before that (checked on 2.1.285) function hooks are off unless you set `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`, and without it this mod simply does nothing. Check `claude --version` and update if it is older than 2.1.287.

## What it does

| When | What |
|---|---|
| Session start | Looks for **exactly one** open card whose `worktree` is the session's directory (or a parent of it) or whose `branch` is the current branch (`main`/`master` never match). One hit: claims it (sets `agent=claude` and the worktree/branch; the status is left alone, because opening a session isn't the same as the work having started), shows a 10-second toast and keeps the card on the line above the prompt (see below). Several hits: asks once which card (up to 3, or "None of these"), and claims the pick. Zero hits, or a card held by another agent: no question, nothing is created or written, and the line above the prompt says why and what to type next. |
| First session ever | One line above the prompt until the first turn ends: "Agent Board connected · first time? take the tour → <board URL>" (a link), or, with the server not running, how to start it. Each is shown once (kept in the plugin's store). |
| Each turn | One note per main-agent turn: first line of the answer (max 120 chars) plus `(edited N files, M Bash)`. Subagent turns, aborted and failed turns are skipped. Lines mentioning token/secret/password/api key are dropped. |
| Session end | Adds one line to the card's history (`claude session ended`). Does **not** change the status or the owner: closing a session doesn't mean the work is done or ready for review, and nobody should be asked to review unfinished work. Not on `/clear` or resume. |

## The line above the prompt

One line, always there once a card is bound (it replaces the old `$.ui.status` line, whose fixed `⚠ agent-board:` style could not be changed):

```
▌ AB-1 ◐ in_progress ▲ high Fix login redirect loop on mobile Safari      claude · ⎇ feat/try-mod · 3 notes
▌ AB-1 ◐ doing ▲ Fix login redirect loop on mobile Safari            claude
▌ ✓ Agent Board connected · first time? take the tour  → http://localhost:4317/
▌ ? no card for this branch  → /board-sync new to open one | link <ID>
▌ ≡ 3 cards match: AB-1 AB-4 AB-7  → /board-sync link <ID>
▌ ⊘ AB-1 is held by codex  → /board-sync link AB-1 to take over
▌ ✗ board offline  → AB-1 last known, retrying
```

- Status colors are theme keys, so they follow your theme: `in_progress` warning, `review` permission, `done` success, `backlog` inactive; only `high` priority is error-red. Every state also has a symbol and a word, so it reads under `NO_COLOR`.
- It narrows with the width it is given (at least 100, 64, 40 columns, then below): full words, then `doing`/`todo` and a priority symbol, then no agent/branch/notes, then only the status symbol. Last to go: id, status, title, priority, agent, branch, note count. Titles are cut by display width (a Chinese character is two cells).
- The card id is a link to the card on the web (`?task=ID`; OSC 8, cmd/ctrl+click in terminals that support it).
- "no card", "several cards" and "held by another agent" stay on the line until you resolve them (`/board-sync link` or `new`) or turn reporting off; they replace the old 10-second toast. Only in a session that has neither a terminal nor a desktop surface (the line is not drawn there) do they still come as a toast.
- **Server not running and no card bound: the line stays empty** (many people never start the server). Offline only shows, in red, once a card was bound and then the server stopped answering.
- `/board-sync off` and `enabled=false`: no line.
- It shows a snapshot, not a live view: the card as of the last answer the server gave this session (claim, `link`, `new`, or the reply to each turn's note; a turn with no note to write re-reads the list). If someone moves the card in the Web UI, the line catches up at the end of the next turn, not instantly.

## Install

```
/plugin marketplace add 111588004/agent-board
/plugin install agent-board@agent-board-mods
/reload-plugins
```

Or try it for one session: `claude --plugin-dir mods/agent-board`.

## Settings (`/config` or `pluginConfigs`)

| Option | Default | |
|---|---|---|
| `enabled` | `true` | Master switch. |
| `agentBoardUrl` | empty | Server URL. Empty: `AGENT_BOARD_URL`, then `http://localhost:4317`. |
| `workspace` | empty | Agent Board workspace. Empty: the server's default. |
| `project` | empty | Project for `/board-sync new`. Empty: the project this repo was linked to before, else one named like the repo folder, else `/board-sync` asks (see below). |
| `offScope` | `session` | How far `/board-sync off` reaches: `session` (back on next session), `project` (this repo), `global` (everywhere until `/board-sync on`). |

Questions (`$.ui.ask`) only offer options; anything typed under "Other" counts as cancel. The board's ask mode (`/board-sync ask`, `agent-board config ask`) decides which questions the mod asks: `on` all of them; `new` only the new-project question (several cards: the line lists them; no title: the first suggestion is taken); `off` none, the mod says what to type instead.

## `/board-sync`

- *(no argument)*: where things stand (on/off, server, card, the card's URL, the next step, the commands). If several cards match it first asks which one; if this repo has no board project it asks: two prefixes the server suggests, "I'll set it up on the web", or "Not now" (remembered for this repo, never asked again).
- `open`: open the bound card (or the board) in the browser.
- `status`: the same read-out, never asks and makes no request.
- `on` / `off`: turn reporting on or off (`off` reaches as far as `offScope` says). `on` also tries to claim a card right away.
- `link <ID>`: bind this session to a card, claim it, write this session's directory and branch back into its `worktree`/`branch`, and remember the card's project for this repo.
- `new ["title"]`: create a card (in progress, agent claude, this directory and branch) and bind to it. No title: asks, offering the first sentence of this conversation, the branch name, or cancel. No project for this repo yet: asks first, as above. When the board answers `needs_input`, its options are asked and the pick sent again.
- `ask [on | new | off]`: show or change when the board asks you about unclear requests. This is the board's global setting, the same as `agent-board config ask` and the MCP `set_ask_mode` tool, not a per-session one: `on` asks every time, `new` asks only before creating a project, `off` never asks. In `new` and `off` the board picks and marks the card ⚠ unconfirmed.

## Failure behaviour

Every REST call has a 1.5 s limit (0.6 s at session end), errors are swallowed, and after a failed call the mod makes no more calls for 15 s, doubling up to 10 minutes. The line above the prompt never makes requests: it draws from the last answer. Cards are matched on the client: the REST API has no worktree/branch filter.

## Known limits

- The question dialog always adds "Type something." and "Chat about this"; the mod cannot hide them, so either counts as cancel (typed text there has been seen leaking into the main prompt).
- `/board-sync open` and the band's link need a server that has `?task=ID` (0.4.1+); an older one opens the board without the card.
- **Hanging server**: `$.http.fetch` cannot be cancelled. A server that accepts the connection and never answers costs one 1.5 s wait, then the backoff skips the rest. In `claude -p` the process then waited about 30 s for the dead request before exiting (measured). A server that is simply not running fails instantly and costs nothing.
- Not checked on a real light theme, nor with a terminal that draws ambiguous-width symbols (`● ▲ ▌`) two cells wide, nor with a real CJK title in a real terminal font: the layout follows Unicode widths and the engine's theme keys, which was only checked in a tmux session on a dark theme.
- `worktree` must be an absolute path (`~` is not expanded).
- After `/clear` there is no new `session.start`; the card stays bound by id.
- On Claude Code older than 2.1.287, hooks (and `claude plugin test`) need `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`; without it the build reports "hooks modules are not turned on in this build yet (early access)". One earlier run appeared to load the mod without the variable and then refuse identical later runs; that was not reproduced, so don't rely on it.

## Development

```
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test mods/agent-board
claude plugin validate --strict mods/agent-board
bash mods/agent-board/tests/e2e/band-smoke.sh   # tmux end-to-end, see tests/e2e/README.md
```

`tests/band.property.test.ts` is a seeded property test of `hooks/band.ts` (widths, truncation, drop order) and prints a pessimistic-width statistic.

`hooks/board.ts` (REST, timeout, backoff), `hooks/pick-card.ts` (card matching, note text) and `hooks/band.ts` (what the line and `status` say, display-width cutting) are plain functions with no engine dependency. `tsconfig.json` and `.claude-plugin/types/` are written by Claude Code when it loads the folder; they are not committed.
