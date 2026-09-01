# Agent Board

A local, Jira-style kanban board for tracking task progress across multiple CLI coding agents (Claude Code, Codex CLI, Gemini CLI, Pi Agent, etc.) working across multiple projects and worktrees.

A single Express + SQLite server is the source of truth. The CLI, an MCP server, and a web UI are all just clients of its REST API — this is what makes it safe for several agent sessions to read/write the board concurrently.

## Install

```bash
npm install -g @limao.li.design/agent-board
```

## Usage

Start the server (foreground, keep it running in its own terminal):

```bash
agent-board
```

This serves the REST API and web UI at `http://localhost:4317`.

From any other terminal, on any project:

```bash
agent-board list [--project=] [--status=] [--parent=] [--workspace=]
agent-board create --title="..." --project=<name> [--parent=<id>] [--agent=] [--priority=] [--status=] [--workspace=]
agent-board update <id> --status=<status> [--priority=] [--agent=] [--title=] [--worktree=] [--branch=] [--workspace=]
agent-board note <id> "<text>" [--agent=<name>] [--workspace=]

agent-board workspace list                # marks the current one with *
agent-board workspace create <name>
agent-board workspace use <name>          # sets the default for every command above that omits --workspace=
agent-board workspace rename <old> <new>
agent-board workspace delete <name>
```

The CLI is a REST client — it talks to the server above, it does not touch the database directly, and it requires the server to already be running.

**Workspaces** are fully isolated boards (own projects, own tasks, own SQLite file) for separating contexts — e.g. personal projects vs. a client's. Everything defaults to a single `"default"` workspace if you never touch this; it's opt-in.

## MCP

An MCP server is exposed over HTTP at `POST http://localhost:4317/mcp` (stateless `StreamableHTTPServerTransport`), with 4 tools: `list_tasks`, `create_task`, `update_task_status`, `add_task_note`. Register it with an MCP-capable client, e.g.:

```bash
claude mcp add agent-board --url http://localhost:4317/mcp
```

## Tracking work in another project

Add a short section to that project's own `CLAUDE.md` (or equivalent agent-instructions file) telling agents to call the `agent-board` CLI to report status. A working template is in [`templates/CLAUDE.md.example`](templates/CLAUDE.md.example) — copy its "Task board" section in, swap in that project's board name, and create the matching project (`POST /api/projects` with a `name` and a `prefix`) before creating tasks for it.

## Data

Each workspace's database lives at `~/.agent-board/workspaces/<name>/tasks.db` — not project-cwd-relative, so a board is shared across every project/worktree on the machine regardless of where `agent-board` is invoked from.

## Development

```bash
git clone https://github.com/111588004/agent-board.git
cd agent-board
npm install
cd web && npm install && npm run build && cd ..   # builds the web UI into web/dist, served by the server

npm start          # runs THIS checkout on :4317 — node src/server.js
```

**Do not `npm link` this repo.** The global `agent-board` command is meant to always be the published npm package — every other project on your machine, and every agent working in them, relies on that being predictable. `npm link` and the real install fight over the same global bin (whichever ran most recently silently wins), which is exactly the kind of ambiguity that makes "is this pointed at my dev changes or the real thing" impossible to answer with confidence. Run this checkout explicitly instead (`npm start`, or `node src/server.js` / `node src/cli.js ...` from inside the repo) — it never touches the global command.

**Pointing an agent at your dev checkout instead of the published version** (e.g. to test a change before publishing): start this checkout with `npm start` in one terminal (it takes over `:4317`, same as the real thing — stop any other `agent-board` instance first, or run it on a different port with `PORT=4321 npm start`). Then in the target project's `CLAUDE.md`/`AGENTS.md`, prefix every `agent-board` command with `AGENT_BOARD_URL=http://localhost:<port>` so the agent's calls land on your dev server instead of the real one — e.g. `AGENT_BOARD_URL=http://localhost:4321 agent-board list --project=...`. Revert that once you're done, or the agent stays pointed at a server that isn't running.

If you're ever unsure which one a running server actually is, `curl localhost:<port>/api/meta` reports `{version, source: "dev"|"npm", root, pid}` — also printed at startup.

See `CLAUDE.md` for architecture details.

## License

MIT
