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
agent-board create --title="..." --project=<name> [--parent=<id>] [--agent=] [--priority=<low|med|high>] [--status=<backlog|in_progress|review|done>] [--due-date=<YYYY-MM-DD>] [--worktree=] [--branch=] [--link=] [--notes="..."] [--workspace=]
agent-board update <id> [--status=<backlog|in_progress|review|done>] [--priority=<low|med|high>] [--agent=] [--title=] [--worktree=] [--branch=] [--link=] [--due-date=<YYYY-MM-DD>] [--workspace=]
agent-board delete <id> [--workspace=]
agent-board note <id> "<text>" [--agent=<name>] [--workspace=]

agent-board workspace list                # marks the current one with *
agent-board workspace create <name>
agent-board workspace use <name>          # sets the default for every command above that omits --workspace=
agent-board workspace rename <old> <new>
agent-board workspace delete <name>

agent-board project list
agent-board project create <name> --prefix=<prefix> [--workspace=]
agent-board project rename <current-name> [--name=] [--prefix=] [--workspace=]
agent-board project delete <name> [--workspace=]           # refuses if the project still has tasks
```

The CLI is a REST client — it talks to the server above, it does not touch the database directly, and it requires the server to already be running.

**Workspaces** are fully isolated boards (own projects, own tasks, own SQLite file) for separating contexts — e.g. personal projects vs. a client's. Everything defaults to a single `"default"` workspace if you never touch this; it's opt-in.

## MCP

An MCP server is exposed over HTTP at `POST http://localhost:4317/mcp` (stateless `StreamableHTTPServerTransport`), with 9 tools: `list_tasks`, `create_task`, `update_task`, `delete_task`, `add_task_note`, `list_projects`, `create_project`, `rename_project`, `delete_project`. Register it with an MCP-capable client, e.g.:

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

npm start          # runs THIS checkout on :4316 — node src/server.js
```

**Do not `npm link` this repo.** The global `agent-board` command is meant to always be the published npm package — every other project on your machine, and every agent working in them, relies on that being predictable. `npm link` and the real install fight over the same global bin (whichever ran most recently silently wins), which is exactly the kind of ambiguity that makes "is this pointed at my dev changes or the real thing" impossible to answer with confidence. Run this checkout explicitly instead (`npm start`, or `node src/server.js` / `node src/cli.js ...` from inside the repo) — it never touches the global command.

**Dev defaults to `:4316`, the npm-installed `agent-board` defaults to `:4317`** — different ports on purpose, so both can run at the same time and you can compare them directly instead of stopping one to test the other. `PORT=<port> npm start` overrides it if you need a third one.

**Pointing an agent at your dev checkout instead of the published version** (e.g. to test a change before publishing): start this checkout with `npm start` in one terminal (`:4316`). Then in the target project's `CLAUDE.md`/`AGENTS.md`, prefix every `agent-board` command with `AGENT_BOARD_URL=http://localhost:4316` so the agent's calls land on your dev server instead of the real one — e.g. `AGENT_BOARD_URL=http://localhost:4316 agent-board list --project=...`. Revert that once you're done, or the agent stays pointed at a server that isn't running.

If you're ever unsure which one a running server actually is, `curl localhost:<port>/api/meta` reports `{version, source: "dev"|"npm", root, pid}` — also printed at startup.

See `CLAUDE.md` for architecture details.

## License

MIT
