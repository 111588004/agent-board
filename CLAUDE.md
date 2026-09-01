# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

A local Jira-style kanban board that tracks task progress across multiple CLI coding agents (Claude Code, Codex CLI, Gemini CLI, Pi Agent, etc.) working across multiple projects/worktrees. Full design rationale and the decisions behind every choice below live in `agent-board-handoff.md` (v2) — read it before changing architecture, not just this file.

The backend (Express + SQLite REST API), frontend (Vite/React, wired to the real API), CLI (`agent-board`'s primary write path), and MCP server are all implemented, working, and validated end-to-end — including against a real Claude Code agent following a project's `CLAUDE.md` instructions, and against the raw MCP JSON-RPC protocol via `curl`. Published to npm as `@limao.li.design/agent-board` (the unscoped name `agent-board` was rejected by the registry as too similar to an existing unrelated package) and pushed to GitHub at `github.com/111588004/agent-board`. Not yet done: registering the MCP server with a real Claude Code session (`claude mcp add`, a one-liner — not run yet since it edits global Claude Code config).

## Commands

```bash
npm install                # backend deps (express, better-sqlite3)
npm link                   # makes the global `agent-board` command point at THIS dev directory

agent-board                 # bare command, no args → starts the REST API + static server on :4317
                             # (equivalent: node src/server.js / node src/cli.js with no args)

cd web && npm install      # frontend deps (first time only)
cd web && npm run dev      # Vite dev server on :5173, proxies /api to :4317
cd web && npm run build    # production build → web/dist, served by the server above

agent-board list [--project=] [--status=] [--parent=]
agent-board create --title="..." --project=<name> [--parent=<id>] [--agent=] [--priority=] [--status=]
agent-board update <id> --status=<status> [--priority=] [--agent=] [--title=] [--worktree=] [--branch=]
agent-board note <id> "<text>" [--agent=<name>]   # appends, never overwrites
```

Any of the four verbs above requires the server to already be running (`agent-board` with no args, in another terminal) — it does not auto-spawn one, deliberately, to avoid orphaned/duplicate server processes; it fails with a clear connection error instead. This works from any directory — the CLI is a REST client, and the DB it talks to lives at a fixed path (`~/.agent-board/tasks.db`), not project-cwd-relative.

**Running a second, isolated server** (e.g. to test changes without touching your real board): both the port and the DB location are overridable via env vars, read by `server.js`/`db.js` (server-side) and `client.js` (CLI/MCP), so a test instance never collides with the real one:

```bash
AGENT_BOARD_DIR=/tmp/agent-board-test PORT=4318 agent-board          # test server, separate DB + port
AGENT_BOARD_URL=http://localhost:4318 agent-board list               # CLI talking to that test server
```

The web UI needs no env var — it always calls `/api/...` relative to whatever origin served it, so it automatically follows the port of whichever server you opened it from.

**`npm link` vs. `npm install -g @limao.li.design/agent-board`** — both register a global `agent-board` bin with the same name, so whichever ran most recently wins and silently replaces the other; there's no warning when this happens. This matters because they point at different code:
- `npm link` (run from this dev directory) → the global `agent-board` command runs *this* checkout live, no rebuild/republish needed — use this while making changes here.
- `npm install -g @limao.li.design/agent-board` → the global command runs whatever was last published to npm, frozen until the next `npm publish` + reinstall — use this to verify what a real end user actually gets.

Check which one is currently active: `readlink -f $(which agent-board)` — a path under this repo means dev/linked, a path under `.../node_modules/@limao.li.design/agent-board/...` means the published npm copy. Switch back to dev with `npm link` (from this directory) at any time.

There's no test framework — this is a solo local tool. Verify changes manually: `curl` against the REST routes, run the CLI verbs, or click through the UI. See `agent-board-handoff.md` and the implementation plan history for the exact verification commands used when each piece was built.

## Architecture

```
src/
  db.js            SQLite (rollback-journal mode — see below, ~/.agent-board/tasks.db), schema + ticket-id generation
  routes/tasks.js   GET/POST /api/tasks, PATCH/DELETE /api/tasks/:id
  routes/projects.js GET/POST /api/projects
  client.js         shared REST client — fetch wrappers used by BOTH cli.js and mcp/tools.js
  cli.js            list/create/update/note — a REST client, not a DB client
  mcp/tools.js      4 MCP tools (list_tasks/create_task/update_task_status/add_task_note) — also just REST clients
  server.js         Express wiring: REST routes + POST /mcp (stateless StreamableHTTPServerTransport) + static, port 4317
web/
  src/App.jsx       the UI (kanban + list views, task drawer) — fetches src/api.js
  src/api.js        thin fetch wrapper matching the REST routes (a separate client from src/client.js — browser fetch vs. Node fetch, no code worth sharing between them)
```

**The REST API is the single source of truth.** The CLI, the MCP server, and the web UI are all just clients of it — none of them touch SQLite directly. This is what makes concurrent access from multiple agent sessions safe: there's exactly one process (`server.js`) that opens the DB file. The MCP transport is stateless (`sessionIdGenerator: undefined`) — each HTTP request gets a fresh `McpServer` + transport pair; nothing is kept in memory between calls, so there's no session store to worry about.

**Data model** (`tasks` table, columns are camelCase to match the UI's card shape 1:1 — no request/response translation layer):
`id` (format `{projectPrefix}-{seq}`, e.g. `AB-42`), `seq`, `title`, `project`, `projectPrefix`, `parentId` (subtask → parent task; two-tier only, no Epic/Story), `agent`, `priority` (low/med/high), `status` (backlog/in_progress/review/done), `notes`, `worktree`, `branch`, `link`, `dueDate`, `createdAt`, `updatedAt`. A separate `projects` table holds `name`/`prefix` (prefix is chosen once per project, at creation — never auto-derived, to avoid collisions).

**`notes` vs `note` in `PATCH /api/tasks/:id`** — these are deliberately different:
- `notes` (plural, matches the column) = full overwrite. Used by the UI's free-edit Description box, where you're meant to be able to rewrite the whole thing like a normal text field.
- `note` (singular verb) = appends one timestamped, agent-tagged line. Used by the CLI/MCP `note` command, so multiple sessions/agents leaving notes over time don't stomp on each other's history.

This split exists because the original design doc only specified one `notes` column with append semantics for the CLI use case; the UI's Description editor (added later, styled after Jira's field) needs full-rewrite semantics on the same column. Don't collapse these back into one behavior without re-solving that conflict.

**`PATCH` also auto-logs `status`/`agent`/`priority` changes** as an appended `notes` line (e.g. `status: backlog → in_progress`), separate from and in addition to any explicit `note` in the same request. These three are the fields two agents are most likely to race on (both claiming/reprioritizing the same ticket at once) — there's no optimistic locking, so a race still just resolves as last-write-wins on the column itself, but the auto-log at least makes a collision visible in the ticket's history instead of one agent's change silently vanishing. `title`/`worktree`/`branch`/`link`/`dueDate`/`notes` changes are NOT auto-logged (`TRACKED_FIELDS` in `routes/tasks.js`) — only add a field here if it's actually contention-prone, not for general audit-trail completeness.

**Ticket IDs are generated inside a `better-sqlite3` transaction** (`createTask` in `db.js`) — `SELECT MAX(seq)+1` and the `INSERT` happen atomically on the single connection, so concurrent requests can't collide on the same id.

**SQLite journal mode: deliberately NOT WAL**, despite `agent-board-handoff.md` originally specifying WAL mode. WAL leaves recently-committed writes sitting only in a separate `-wal` file until a checkpoint merges them into the main `.db` file — if the process dies before that checkpoint (crash, `kill -9`), that data is gone even though the app already told the caller it was saved. This actually happened once and lost a session's worth of board data. WAL's usual benefit (readers don't block on writers) doesn't buy anything here since every write already funnels through one single-threaded Express process — there's never a second concurrent writer for WAL to help with. Plain rollback-journal mode (SQLite's default) commits straight into the main file on every transaction, so there's no partially-committed state a crash can lose. Don't reintroduce WAL mode without solving the checkpoint-durability problem first.

## Using agent-board to track work in *other* projects

This is the actual point of the tool: a real project adds a short section to its own `CLAUDE.md` telling agents to call this CLI. A working template (validated against a real Claude Code session) is at `templates/CLAUDE.md.example` — copy its "Task board" section into a project's `CLAUDE.md`, swap in that project's board name, and create the matching project via `POST /api/projects` (or a one-off `curl`) first, since tasks can't be created for a project that doesn't exist yet.

## Known gaps / not yet built

- **Public npm publishing**: done. Published as `@limao.li.design/agent-board` (scoped — the unscoped `agent-board` was blocked by the registry's name-similarity check against an unrelated existing package). `npm install -g @limao.li.design/agent-board` gives the same global `agent-board` command as the local `npm link` setup. Publishing used a granular access token with 2FA bypass (7-day expiry) since OTP-based publish is being deprecated by npm; regenerate a token the same way for future version bumps.
- **Registering the MCP server with a real client**: not done. `claude mcp add agent-board --url http://localhost:4317/mcp` (per `agent-board-handoff.md` §6) will do it for Claude Code; the same pattern applies to Codex/Gemini CLI. Not run yet since it's a persistent config change on whichever machine runs it — do it yourself when ready rather than having an agent run it for you.
- **`agent-board.jsx`** (repo root): the original single-file prototype, now superseded by `web/src/App.jsx`. Left in place rather than deleted so this file's history stays intact; safe to remove once you're confident nothing still references it.
- **`agent-board open <id>`** (jump to a task's worktree from the CLI): explicitly out of scope per the handoff doc, not started.
