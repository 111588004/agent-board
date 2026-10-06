# Agent Board mod for Claude Code

Reports a Claude Code session's progress to [Agent Board](../../README.md) without anyone typing `agent-board update`. It is a convenience layer, not a dependency: the CLI and MCP server work the same without it, and with the Agent Board server stopped the mod stays silent.

Early-access API: needs Claude Code 2.1.287+ per the official article. Developed against 2.1.285, which loaded it fine.

## What it does

| When | What |
|---|---|
| Session start | Looks for **exactly one** open card whose `worktree` is the session's directory (or a parent of it) or whose `branch` is the current branch (`main`/`master` never match). One hit: claims it (`agent=claude`, `status=in_progress`). Zero or several hits, or a card held by another agent: only a toast, nothing is created or written. |
| Each turn | One note per main-agent turn: first line of the answer (max 120 chars) plus `(edited N files, M Bash)`. Subagent turns, aborted and failed turns are skipped. Lines mentioning token/secret/password/api key are dropped. |
| Session end | If the card is still `in_progress`, moves it to `review`. Never `done`. Not on `/clear` or resume. |

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
| `project` | empty | Project for `/board-sync new`. Empty: the board's only project, if there is exactly one. |

## `/board-sync`

- `on` / `off`: turn reporting on or off for good (kept in the plugin's store, beats `enabled`). `on` also tries to claim a card right away.
- `status`: on/off, server URL, bound card, whether it is backing off.
- `link <ID>`: bind this session to a card, claim it, and write this session's directory and branch back into its `worktree`/`branch` so the next session finds it by itself.
- `new "title"`: create a card (in progress, agent claude, this directory and branch) and bind to it.

## Failure behaviour

Every REST call has a 1.5 s limit (0.6 s at session end), errors are swallowed, and after a failed call the mod makes no more calls for 15 s, doubling up to 10 minutes. Cards are matched on the client: the REST API has no worktree/branch filter.

## Known limits

- **Hanging server**: `$.http.fetch` cannot be cancelled. A server that accepts the connection and never answers costs one 1.5 s wait, then the backoff skips the rest. In `claude -p` the process then waited about 30 s for the dead request before exiting (measured). A server that is simply not running fails instantly and costs nothing.
- `worktree` must be an absolute path (`~` is not expanded).
- After `/clear` there is no new `session.start`; the card stays bound by id.
- In `-p` mode function hooks are sometimes refused unless `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` is set (it loaded without it on the first run, then was refused on identical later runs; `claude plugin test` behaved the same way).

## Development

```
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test mods/agent-board
claude plugin validate --strict mods/agent-board
```

`hooks/board.ts` (REST, timeout, backoff) and `hooks/pick-card.ts` (card matching, note text) are plain functions with no engine dependency. `tsconfig.json` and `.claude-plugin/types/` are written by Claude Code when it loads the folder; they are not committed.
