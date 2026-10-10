<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark.svg">
    <img src="docs/logo-light.svg" alt="Agent Board" height="56">
  </picture>
</p>

<p align="center"><b>English</b> · <a href="README.zh-TW.md">繁體中文</a></p>

<p align="center">A local kanban board that you and your AI coding agents share.<br>Say it in one sentence: the agent opens the ticket, another agent picks it up, and it comes back to you.</p>

<p align="center"><a href="https://111588004.github.io/agent-board/"><b>Website</b></a> · <a href="https://111588004.github.io/agent-board/bench.html">Benchmarks</a> · <a href="https://www.npmjs.com/package/@limao.li.design/agent-board">npm</a></p>

Agent Board tracks task progress across multiple CLI coding agents (Claude Code, Codex CLI, Gemini CLI, Pi Agent, etc.) working across multiple projects and worktrees. People use the web board, agents use the CLI or MCP, and everyone writes to the same cards.

A single Express + SQLite server is the source of truth. The CLI, an MCP server, and a web UI are all just clients of its REST API — this is what makes it safe for several agent sessions to read/write the board concurrently.

**Measured, not claimed.** Opening a ticket took 2 tool calls and was 4.2× faster than Jira's MCP connector; handing a ticket off was 1.6× faster than Linear's. Same task, same model (Sonnet 5.5), each tool through its own MCP connector, median of 15 runs (13 for hand-off), October 2026. Every tool ended up with a correct ticket; the difference is how many lookups an agent needs before it can write. [Method and every run →](https://111588004.github.io/agent-board/bench.html)

## Install

```bash
npm install -g @limao.li.design/agent-board
```

## Try it (no install)

```bash
npx @limao.li.design/agent-board
```

That downloads the package and starts the server on `http://localhost:4317`, with a starter project already on the board. Open that URL and click around.

The first run has to download the package, and npm prints nothing while it does — give it up to a minute. You may see a deprecation warning from one of its dependencies; it's harmless. Later runs start in a second or two. Your data lives in `~/.agent-board` either way, so nothing is lost if you install it afterwards.

`npx` is for trying it. For daily use, install it (above) so agents can call the short `agent-board` command instead of a full `npx ...` line each time.

## Usage

Start the server (foreground, keep it running in its own terminal):

```bash
agent-board
```

This serves the REST API and web UI at `http://localhost:4317`. The server listens on `127.0.0.1` only, so other devices on your network can't reach it. There is no login, so keep it that way: setting `HOST=0.0.0.0` exposes every board to anyone on the same network (it prints a warning when you do). First run seeds a starter "Agent Board" project with 3 example tickets, so there's something to click around before you create your own project — remove it whenever you're ready: delete its three sample tasks first (`agent-board delete AB-1`, `AB-2`, `AB-3`), because a project that still has tasks can't be deleted, then `agent-board project delete "Agent Board"`.

From any other terminal, on any project. (These commands assume `agent-board` is installed globally. If you only tried it with `npx`, there is no `agent-board` command yet: either install it, or write `npx @limao.li.design/agent-board` in front, e.g. `npx @limao.li.design/agent-board list`.)

```bash
agent-board list [--project=] [--status=] [--parent=] [--workspace=]
agent-board create --title="..." --project=<name> [--new-project-prefix=<prefix>] [--remember-as=<word>] [--parent=<id>] [--agent=] [--priority=<low|med|high>] [--status=<backlog|in_progress|review|done>] [--due-date=<YYYY-MM-DD>] [--worktree=] [--branch=] [--link=] [--notes="..."] [--workspace=]   # --notes sets the Description field; with --parent, --project can be left out
agent-board update <id> [--status=<backlog|in_progress|review|done>] [--priority=<low|med|high>] [--agent=] [--title=] [--worktree=] [--branch=] [--link=] [--due-date=<YYYY-MM-DD>] [--parent=<id>|none] [--notes="..."] [--confirm] [--workspace=]   # --notes overwrites the Description field; --parent=none detaches; --confirm clears "unconfirmed"
agent-board move <id> --project=<name> [--detach] [--workspace=]   # to another project: a new id there, subtasks come along, old ids keep working
agent-board delete <id> [--workspace=]
agent-board note <id> "<text>" [--agent=<name>] [--workspace=]

agent-board workspace list                # marks the current one with *
agent-board workspace create <name>
agent-board workspace use <name>          # sets the default for every command above that omits --workspace=
agent-board workspace rename <old> <new>
agent-board workspace delete <name>

agent-board project list                                   # shows remembered words too: "(also: ops)"
agent-board project create <name> [--prefix=<prefix>] [--workspace=]   # no --prefix: prints suggestions and asks
agent-board project rename <current-name> [--name=] [--prefix=] [--workspace=]
agent-board project delete <name> [--workspace=]           # refuses if the project still has tasks
agent-board project forget <word> [--workspace=]           # undo a remembered answer (ops -> Operations); that word asks again
agent-board config ask [on|new|off]                        # when the board asks you (default on) — see below
agent-board mcp                                            # MCP over stdio — see MCP below
```

The CLI is a REST client — it talks to the server above, it does not touch the database directly, and it requires the server to already be running (the one exception is `agent-board mcp`, below).

**When the board can't tell what you meant, it asks instead of guessing.** Three cases: the project name matches several projects, the project doesn't exist in this workspace yet, or a ticket has no title. Creating a project without `--prefix` asks too, because the prefix is your call, not the agent's. The CLI prints the question and up to 4 options, each with the flags to rerun with, and exits with code `2`. MCP tools return the same question in a result that starts with `NEEDS USER INPUT`. The agent then asks you with its own built-in ask tool (Claude Code: AskUserQuestion, Codex CLI: request_user_input, Gemini CLI: ask_user, Antigravity CLI: its own question prompt; agents without one, like Pi, ask in chat) and calls the tool again with your answer. Picking "new project" from the options creates the project and the ticket in one call (`--new-project-prefix=` / `newProjectPrefix`). No match at all is not asked about, for example `list --project=nope`; you get an error that lists the existing projects.

**Your answers are remembered.** Each option carries the word you used (`--remember-as=` / `rememberAs`). When you pick Operations for "ops", the board remembers that, so "ops" goes straight to Operations from then on. `project list` shows remembered words, and `project forget ops` undoes one. An exact project name always wins over a remembered word.

**How much it asks is one global setting** (every workspace, every agent), kept by the server:

| | several projects match / no title | project doesn't exist |
|---|---|---|
| `on` (default) | asks | asks |
| `new` | the board picks, marks the ticket ⚠ unconfirmed | asks |
| `off` | the board picks, marks the ticket ⚠ unconfirmed | error (never auto-created) |

When the board picks, it takes the project with the most tickets (ties: the oldest), or uses the description's first line as the title. It writes why into the ticket's notes and sets its `unconfirmed` field. The web board shows a ⚠ Unconfirmed chip on the card and a Confirm button in the ticket drawer; `agent-board update <id> --confirm` does the same. If the pick was wrong, move the ticket: `agent-board move <id> --project=<the right one>`. Creating a project without a prefix asks in `on`/`new` and is an error in `off`: the prefix is never picked for you.

Three ways to change it, all the same setting:

```bash
agent-board config ask off     # CLI (npx: npx @limao.li.design/agent-board config ask off)
```

- MCP: tell your agent "turn off the board's questions". It calls the `set_ask_mode` tool, which agents are told to use only when you ask.
- Claude Code mod: `/board-sync ask off`.

**Subtasks** split one piece of work across agents: a parent ticket coordinates it, and each agent gets a subtask (`--parent=<id>` on create; the project comes from the parent). The board enforces the shape for the web board, the CLI and MCP alike:

- Two levels only. A subtask can't have subtasks, and a ticket that has subtasks can't become one.
- A parent is in the same project as its subtasks. Naming a parent in another project when you create a ticket asks which you meant.
- `agent-board update <id> --parent=<id>` moves a subtask under another parent; `--parent=none` detaches it. Each move is written into the ticket's notes.
- A parent shows its subtasks' progress (`list` prints `[2/3 done]` and indents the subtasks under it). Its status never changes by itself: when the last subtask is done, the board says so (`note: All 3 subtasks of AB-4 are done`) and leaves moving the parent to you.
- A ticket with subtasks can't be deleted. The error lists them, so you can delete them or detach them first.

**Moving a ticket to another project** works like Jira's Move: `agent-board move AB-5 --project=Ops` gives it a new id there (`AB-5 → OPS-12`), because a ticket's id names its project.

- Its subtasks come along, with new ids too, still under it.
- The old id keeps working everywhere — `list`, `update`, `note`, `delete`, MCP, a `?task=AB-5` link — and every reply that used it says `AB-5 is now OPS-12`. Moving twice points every old id at the newest one.
- A subtask moves alone only with `--detach`, which takes it out of its parent; otherwise the error tells you to move the parent instead.
- Each moved ticket's notes record where it came from. An old number is never handed out again.

**Workspaces** are fully isolated boards (own projects, own tasks, own SQLite file) for separating contexts — e.g. personal projects vs. a client's. Everything defaults to a single `"default"` workspace if you never touch this; it's opt-in.

## MCP

11 tools: `list_tasks`, `create_task`, `update_task`, `move_task`, `delete_task`, `add_task_note`, `list_projects`, `create_project`, `rename_project`, `delete_project`, `set_ask_mode`.

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

1. `project` is passed exactly as the user named it (name or prefix, any case, whitespace trimmed). The agent doesn't look it up in the project list and swap in a match itself: in a real-agent test, Codex turned an ambiguous "ops" into the exact name "OPS" and skipped the question. If it matches several projects or none, the board returns a question for the user (see "asks instead of guessing" above). The agent asks you and never picks an option or invents a prefix itself.
2. Know the project? Create the ticket directly; no `list` first.
3. `status`: `backlog` `in_progress` `review` `done`; `priority`: `low` `med` `high`. Aliases such as `doing`/`wip`/`進行中`/`urgent`/`高` are accepted and stored as the standard value; anything else is a 400 listing the allowed values.
4. Description goes in `notes`; set `agent` to your own id.
5. Work split across agents: one parent ticket, one subtask per agent (see **Subtasks** above). An agent tells you when every subtask is done instead of moving the parent itself.
6. MCP clients get these rules automatically as the server's `instructions`.

## Data

Each workspace's database lives at `~/.agent-board/workspaces/<name>/tasks.db` — not project-cwd-relative, so a board is shared across every project/worktree on the machine regardless of where `agent-board` is invoked from.

Ticket numbers are never reused. Deleting `AB-7` doesn't free `7`: the next ticket is `AB-8`, so an agent still holding `AB-7` gets "not found" instead of somebody else's ticket. The same holds across a prefix change: a project re-prefixed from `AB` to `XY` continues at `XY-8`, and a later project that takes `AB` starts after `AB-7`.

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
