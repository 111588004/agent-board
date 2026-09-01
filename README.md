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
agent-board list [--project=] [--status=] [--parent=]
agent-board create --title="..." --project=<name> [--parent=<id>] [--agent=] [--priority=] [--status=]
agent-board update <id> --status=<status> [--priority=] [--agent=] [--title=] [--worktree=] [--branch=]
agent-board note <id> "<text>" [--agent=<name>]
```

The CLI is a REST client — it talks to the server above, it does not touch the database directly, and it requires the server to already be running.

## MCP

An MCP server is exposed over HTTP at `POST http://localhost:4317/mcp` (stateless `StreamableHTTPServerTransport`), with 4 tools: `list_tasks`, `create_task`, `update_task_status`, `add_task_note`. Register it with an MCP-capable client, e.g.:

```bash
claude mcp add agent-board --url http://localhost:4317/mcp
```

## Tracking work in another project

Add a short section to that project's own `CLAUDE.md` (or equivalent agent-instructions file) telling agents to call the `agent-board` CLI to report status. A working template is in [`templates/CLAUDE.md.example`](templates/CLAUDE.md.example) — copy its "Task board" section in, swap in that project's board name, and create the matching project (`POST /api/projects` with a `name` and a `prefix`) before creating tasks for it.

## Data

The database lives at `~/.agent-board/tasks.db` (SQLite, WAL mode) — not project-cwd-relative, so the board is shared across every project/worktree on the machine regardless of where `agent-board` is invoked from.

## Development

```bash
npm install                # backend deps
cd web && npm install && npm run build   # builds the web UI into web/dist, served by the server
```

See `CLAUDE.md` for architecture details.

## License

MIT
