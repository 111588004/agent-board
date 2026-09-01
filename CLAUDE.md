# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

A local Jira-style kanban board that tracks task progress across multiple CLI coding agents (Claude Code, Codex CLI, Gemini CLI, Pi Agent, etc.) working across multiple projects/worktrees. Full design rationale and the decisions behind every choice below live in `agent-board-handoff.md` (v2) — read it before changing architecture, not just this file.

The backend (Express + SQLite REST API), frontend (Vite/React, wired to the real API), CLI (`agent-board`'s primary write path), and MCP server are all implemented, `npm link`-packaged, and working — validated end-to-end, including against a real Claude Code agent following a project's `CLAUDE.md` instructions, and against the raw MCP JSON-RPC protocol via `curl`. Not yet done: registering the MCP server with a real Claude Code session (`claude mcp add`, a one-liner — not run yet since it edits global Claude Code config) and a decision on public npm publishing.

## Commands

```bash
npm install                # backend deps (express, better-sqlite3)
npm link                   # one-time: makes the `agent-board` command global (already done in dev)

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

There's no test framework — this is a solo local tool. Verify changes manually: `curl` against the REST routes, run the CLI verbs, or click through the UI. See `agent-board-handoff.md` and the implementation plan history for the exact verification commands used when each piece was built.

## Architecture

```
src/
  db.js            SQLite (WAL mode, ~/.agent-board/tasks.db), schema + ticket-id generation
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

**Ticket IDs are generated inside a `better-sqlite3` transaction** (`createTask` in `db.js`) — `SELECT MAX(seq)+1` and the `INSERT` happen atomically on the single connection, so concurrent requests can't collide on the same id.

## Using agent-board to track work in *other* projects

This is the actual point of the tool: a real project adds a short section to its own `CLAUDE.md` telling agents to call this CLI. A working template (validated against a real Claude Code session) is at `templates/CLAUDE.md.example` — copy its "Task board" section into a project's `CLAUDE.md`, swap in that project's board name, and create the matching project via `POST /api/projects` (or a one-off `curl`) first, since tasks can't be created for a project that doesn't exist yet.

## Known gaps / not yet built

- **Public npm publishing**: not done, undecided per `agent-board-handoff.md` §9. `npm link` already makes `agent-board` a real global command on this machine — that's sufficient for personal use; publishing only matters if this needs to be `npx`-installable on other machines. The name `agent-board` was unclaimed on the registry as of last check.
- **Registering the MCP server with a real client**: not done. `claude mcp add agent-board --url http://localhost:4317/mcp` (per `agent-board-handoff.md` §6) will do it for Claude Code; the same pattern applies to Codex/Gemini CLI. Not run yet since it's a persistent config change on whichever machine runs it — do it yourself when ready rather than having an agent run it for you.
- **`agent-board.jsx`** (repo root): the original single-file prototype, now superseded by `web/src/App.jsx`. Left in place rather than deleted so this file's history stays intact; safe to remove once you're confident nothing still references it.
- **`agent-board open <id>`** (jump to a task's worktree from the CLI): explicitly out of scope per the handoff doc, not started.
