# Agent Board

A local, Jira-style kanban board for tracking task progress across multiple CLI coding agents (Claude Code, Codex CLI, Gemini CLI, Pi Agent, etc.) working across multiple projects and worktrees.

A single Express + SQLite server is the source of truth. The CLI, an MCP server, and a web UI are all just clients of its REST API — this is what makes it safe for several agent sessions to read/write the board concurrently.

## Try it (no install)

```bash
npx @limao.li.design/agent-board
```

That downloads the package and starts the server on `http://localhost:4317`, with a starter project already on the board. Open that URL and click around.

The first run has to download the package, and npm prints nothing while it does — give it up to a minute. You may see a deprecation warning from one of its dependencies; it's harmless. Later runs start in a second or two. Your data lives in `~/.agent-board` either way, so nothing is lost if you install it afterwards.

`npx` is for trying it. For daily use, install it (below) so agents can call the short `agent-board` command instead of a full `npx ...` line each time.

## Install

```bash
npm install -g @limao.li.design/agent-board
```

## Usage

Start the server (foreground, keep it running in its own terminal):

```bash
agent-board
```

This serves the REST API and web UI at `http://localhost:4317`. The server listens on `127.0.0.1` only, so other devices on your network can't reach it. There is no login, so keep it that way: setting `HOST=0.0.0.0` exposes every board to anyone on the same network (it prints a warning when you do). First run seeds a starter "Agent Board" project with 3 example tickets, so there's something to click around before you create your own project — remove it whenever you're ready: delete its three sample tasks first (`agent-board delete AB-1`, `AB-2`, `AB-3`), because a project that still has tasks can't be deleted, then `agent-board project delete "Agent Board"`.

From any other terminal, on any project. (These commands assume `agent-board` is installed globally. If you only tried it with `npx`, there is no `agent-board` command yet: either install it, or write `npx @limao.li.design/agent-board` in front, e.g. `npx @limao.li.design/agent-board list`.)

```bash
agent-board list [--project=] [--status=] [--parent=] [--workspace=]
agent-board create --title="..." --project=<name> [--new-project-prefix=<prefix>] [--parent=<id>] [--agent=] [--priority=<low|med|high>] [--status=<backlog|in_progress|review|done>] [--due-date=<YYYY-MM-DD>] [--worktree=] [--branch=] [--link=] [--notes="..."] [--workspace=]   # --notes sets the Description field
agent-board update <id> [--status=<backlog|in_progress|review|done>] [--priority=<low|med|high>] [--agent=] [--title=] [--worktree=] [--branch=] [--link=] [--due-date=<YYYY-MM-DD>] [--notes="..."] [--workspace=]   # --notes overwrites the Description field
agent-board delete <id> [--workspace=]
agent-board note <id> "<text>" [--agent=<name>] [--workspace=]

agent-board workspace list                # marks the current one with *
agent-board workspace create <name>
agent-board workspace use <name>          # sets the default for every command above that omits --workspace=
agent-board workspace rename <old> <new>
agent-board workspace delete <name>

agent-board project list
agent-board project create <name> [--prefix=<prefix>] [--workspace=]   # no --prefix: prints suggestions and asks
agent-board project rename <current-name> [--name=] [--prefix=] [--workspace=]
agent-board project delete <name> [--workspace=]           # refuses if the project still has tasks
agent-board config ask [on|off]                            # "ask the user" when a request is unclear (default on) — see below
agent-board mcp                                            # MCP over stdio — see MCP below
```

The CLI is a REST client — it talks to the server above, it does not touch the database directly, and it requires the server to already be running (the one exception is `agent-board mcp`, below).

**When the board can't tell what you meant, it asks instead of guessing.** Three cases: the project name matches several projects, the project doesn't exist in this workspace yet, or a ticket has no title. Creating a project without `--prefix` asks too, because the prefix is your call, not the agent's. The CLI prints the question and up to 4 options, each with the flags to rerun with, and exits with code `2`. MCP tools return the same question in a result that starts with `NEEDS USER INPUT`. The agent then asks you with its own built-in ask tool (Claude Code: AskUserQuestion, Codex CLI: request_user_input, Gemini CLI: ask_user; agents without one ask in chat) and calls the tool again with your answer. Picking "new project" from the options creates the project and the ticket in one call (`--new-project-prefix=` / `newProjectPrefix`). No match at all is not asked about, for example `list --project=nope`; you get an error that lists the existing projects. `agent-board config ask off` turns asking off for every workspace: those cases become plain errors that list the same options.

**Workspaces** are fully isolated boards (own projects, own tasks, own SQLite file) for separating contexts — e.g. personal projects vs. a client's. Everything defaults to a single `"default"` workspace if you never touch this; it's opt-in.

## MCP

9 tools: `list_tasks`, `create_task`, `update_task`, `delete_task`, `add_task_note`, `list_projects`, `create_project`, `rename_project`, `delete_project`.

**stdio (recommended)** — `agent-board mcp` speaks MCP over stdin/stdout, so a client can launch it with no global install:

```bash
npx -y @limao.li.design/agent-board mcp
```

It's still just a client of the REST server (default `http://localhost:4317`, or `AGENT_BOARD_URL`). If nothing is listening there and the URL is localhost, it starts the server in the background (detached, log at `~/.agent-board/server.log`) and says so — with the pid and how to stop it — at the top of the first tool result. That server keeps running after the MCP session ends, so the web UI, CLI and other agents share it. If two sessions race to start it, only one wins the port; the other connects to the winner.

Claude Code:

```bash
claude mcp add agent-board -s user -- npx -y @limao.li.design/agent-board mcp
```

Claude desktop app (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{ "mcpServers": { "agent-board": { "command": "npx", "args": ["-y", "@limao.li.design/agent-board", "mcp"] } } }
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.agent-board]
command = "npx"
args = ["-y", "@limao.li.design/agent-board", "mcp"]
startup_timeout_sec = 60   # the very first run downloads the package (~20s); Codex's default is shorter
```

Verified with real clients (2026-10-06, 0.4.0): Claude Code and Codex CLI both list and call the tools over stdio, and only the first call carries the "auto-started" notice. Not verified: the Claude desktop app (launched from the GUI it may not find an nvm-installed `npx` on its PATH — use the absolute path if so); Gemini CLI (couldn't be tested, it stopped at its own sign-in/project setup); and a Codex cold start with an empty npm cache, which is why the timeout above is raised.

**HTTP** — the running server also exposes MCP at `POST http://localhost:4317/mcp` (stateless `StreamableHTTPServerTransport`), for clients that prefer a URL. This one never auto-starts anything:

```bash
claude mcp add --transport http agent-board http://localhost:4317/mcp
```

## Tracking work in another project

Add a short section to that project's own `CLAUDE.md` (or equivalent agent-instructions file) telling agents to call the `agent-board` CLI to report status. A working template is in [`templates/CLAUDE.md.example`](templates/CLAUDE.md.example) — copy its "Task board" section in, swap in that project's board name, and create the matching project (`agent-board project create "<name>" --prefix=<PREFIX>`) before creating tasks for it.

Rules the template teaches agents for opening a ticket in one call:

1. `project` is an existing project's name or prefix (case-insensitive, whitespace trimmed) — never a free-form phrase. If it matches several projects or none, the board returns a question for the user (see "asks instead of guessing" above). The agent asks you and never picks an option or invents a prefix itself.
2. Know the project? Create the ticket directly; no `list` first.
3. `status`: `backlog` `in_progress` `review` `done`; `priority`: `low` `med` `high`. Aliases such as `doing`/`wip`/`進行中`/`urgent`/`高` are accepted and stored as the standard value; anything else is a 400 listing the allowed values.
4. Description goes in `notes`; set `agent` to your own id.
5. MCP clients get these rules automatically as the server's `instructions`.

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
