# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

A local Jira-style kanban board that tracks task progress across multiple CLI coding agents (Claude Code, Codex CLI, Gemini CLI, Pi Agent, etc.) working across multiple projects/worktrees. Full design rationale and the decisions behind every choice below live in `agent-board-handoff.md` (v2) — read it before changing architecture, not just this file.

The backend (Express + SQLite REST API), frontend (Vite/React, wired to the real API), CLI (`agent-board`'s primary write path), and MCP server are all implemented, working, and validated end-to-end — including against a real Claude Code agent following a project's `CLAUDE.md` instructions, and against the raw MCP JSON-RPC protocol via `curl`. Pushed to GitHub at `github.com/111588004/agent-board`; published to npm as `@limao.li.design/agent-board` (currently v0.4.0 — the unscoped name `agent-board` was rejected by the registry as too similar to an existing unrelated package). Supports multiple fully isolated boards (`agent-board workspace ...`, see below) as of v0.2.0, project rename/delete (`agent-board project ...`) as of v0.2.1, and full task CRUD across CLI/MCP (`agent-board delete <id>`, MCP `update_task`/`delete_task`) as of v0.2.2. v0.4.0 adds a stdio MCP mode (`agent-board mcp`, auto-starts the server), live-updating web board (3s polling), `better-sqlite3` 12.x (prebuilt binaries for Node 24/25; `engines` is now `>=20`), and `npx @limao.li.design/agent-board` as the no-install way to try it. Not yet done: persistently registering the MCP server in the user's own Claude Code (`claude mcp add`, a one-liner — it edits global Claude Code config, so the user runs it).

## Commands

```bash
npm install                # backend deps (express, better-sqlite3)

npm start                   # runs THIS checkout — no args, starts the REST API + static server on :4316
                             # (equivalent: node src/server.js / node src/cli.js with no args, from this directory)

agent-board                 # the GLOBAL command — always the published npm package, listening on :4317, never this checkout (see below)

cd web && npm install      # frontend deps (first time only)
cd web && npm run dev      # Vite dev server on :5173, proxies /api to :4316
cd web && npm run build    # production build → web/dist, served by the server above

agent-board list [--project=] [--status=] [--parent=] [--workspace=]
agent-board create --title="..." --project=<name> [--new-project-prefix=<prefix>] [--parent=<id>] [--agent=] [--priority=<low|med|high>] [--status=<backlog|in_progress|review|done>] [--due-date=<YYYY-MM-DD>] [--worktree=] [--branch=] [--link=] [--notes="..."] [--workspace=]   # --notes sets the Description field
agent-board update <id> [--status=<backlog|in_progress|review|done>] [--priority=<low|med|high>] [--agent=] [--title=] [--worktree=] [--branch=] [--link=] [--due-date=<YYYY-MM-DD>] [--notes="..."] [--workspace=]   # --notes overwrites the Description field
agent-board note <id> "<text>" [--agent=<name>] [--workspace=]   # appends, never overwrites

agent-board workspace list                  # marks the current one with *
agent-board workspace create <name>         # any name is fine — filesystem-safe Unicode, not just lowercase/digits/hyphens
agent-board workspace use <name>            # sets the default for every command below that omits --workspace=
agent-board workspace rename <old> <new>    # updates current-workspace too, if you renamed the one you're on
agent-board workspace delete <name>         # can't delete "default"; resets current-workspace to "default" if you deleted it

agent-board project list                                                       # prefix + name
agent-board project create <name> [--prefix=<prefix>] [--workspace=]           # no --prefix: asks (exit 2) with suggested prefixes
agent-board project rename <current-name> [--name=] [--prefix=] [--workspace=] # cascades to every task's project/projectPrefix
agent-board project delete <name> [--workspace=]                              # refuses if the project still has tasks

agent-board config ask [on|off]   # global "ask the user" switch, default on — see needs_input below

agent-board mcp             # MCP over stdio (npx -y @limao.li.design/agent-board mcp) — auto-starts the server if needed, see below
```

**Testing `mcp` from this checkout: always set `AGENT_BOARD_URL` (and `AGENT_BOARD_DIR`).** Without a URL, `node src/cli.js mcp` targets the npm port 4317 — so from a dev checkout it refuses to auto-start (stderr warning) rather than squat 4317 with dev code and block the real global server. With one, it auto-starts this checkout's server on that port:

```bash
AGENT_BOARD_URL=http://localhost:4330 AGENT_BOARD_DIR=/tmp/ab-mcp-test node src/cli.js mcp   # kill the spawned server (pid is in the first tool result) when done
```

Any of the four task verbs above requires the server to already be running (`agent-board` with no args, in another terminal) — it does not auto-spawn one, deliberately, to avoid orphaned/duplicate server processes; it fails with a clear connection error instead. This works from any directory — the CLI is a REST client.

**`agent-board mcp` is the one exception to "never auto-spawn".** An MCP client launches it with no terminal for the user to start a server in first, so if `/api/meta` doesn't answer at a localhost URL it spawns `server.js` detached (explicit `PORT`, output appended to `<DB root>/server.log`) and waits up to 5s for it. Why that's safe here when it isn't for the task verbs: the port is the mutex — if two sessions race, the loser's server hits `EADDRINUSE` and exits (`server.js` handles that cleanly) before `getDb` ever opens a file, so there can't be a duplicate writer; and the server it starts is the same one the user would have run anyway, not an orphan nobody knows about — the session whose child actually won (`meta.pid === child.pid`) prepends a notice with the pid, log path and `kill <pid>` to its first tool result (plus MCP `instructions`). Detached, not in-process, so the server outlives the session that started it and stays shared. Non-localhost URLs never auto-start.

**Workspaces** are fully isolated boards (own projects + tasks, own SQLite file) — for separating contexts like personal vs. a client's work, not for multi-user/team access. Every task verb resolves which workspace to hit in this order: explicit `--workspace=name` > `AGENT_BOARD_WORKSPACE` env var > `~/.agent-board/current-workspace` (written by `workspace use`) > `"default"`. A fresh install with zero workspace commands ever run just uses `"default"` transparently — workspaces are opt-in, nothing breaks if you never think about them. The web UI has its own switcher in the header (persists to `localStorage`, also readable/shareable via `?workspace=<name>` in the URL) — it's independent of the CLI's `current-workspace` file, so the browser and your terminal can be pointed at different workspaces at the same time.

**First-run onboarding seed**: `seedOnboarding()` in `db.js` runs whenever `getDb("default")` opens the `"default"` workspace and finds zero projects — it creates a starter `"Agent Board"` project (prefix `AB`) with 3 example tickets (a how-to-use ticket, a ticket mid-handoff for the new user to pick up, and a non-code task) so a brand-new install has something on the board instead of a blank screen. This is checked on every startup, not just once — deleting every project resets to the same "empty default workspace" state and reseeds on next start, which is intentional (no separate "have I onboarded before" flag). The seed is never auto-deleted; a user who doesn't want it removes it themselves (`agent-board project delete "Agent Board"`).

**Dev and npm default to different ports AND different DB roots, both auto-detected the same way.** `server.js` picks port 4316/4317 and `db.js` picks `~/.agent-board-dev` vs `~/.agent-board` by the same check (`source: "dev"` if the running file's path is not under `node_modules`, `"npm"` otherwise — see the `source` field on `/api/meta`). This isn't just a convenience — before this, both defaulted to the exact same `~/.agent-board` DB root, so running `npm start` (dev) and the global `agent-board` (npm) at the same time meant two separate Node processes writing the same `tasks.db` files, which broke this project's own single-writer-process assumption (see "The REST API is the single source of truth" above). Now they're isolated by default; `AGENT_BOARD_DIR` still overrides either when you explicitly want them pointed at the same data (e.g. testing a dev-checkout fix against real board data on purpose). `PORT` still overrides the port independently.

**The server binds `127.0.0.1` by default, not all interfaces.** There is no authentication on the REST API or `/mcp`, so anything that can reach the port can read, change and delete every workspace. Before 0.4.1 `app.listen(PORT)` named no host and listened on every interface (verified: reachable from the machine's LAN address). `HOST` opts in to something else (`HOST=0.0.0.0` for a LAN; `HOST=::1` for IPv6 loopback) and prints a warning for non-loopback values. `mcp/stdio.js` passes `HOST=::1` when it auto-starts a server for a `[::1]` URL. Clients keep using `http://localhost:PORT` (Node 20+ tries both address families); `http://[::1]:PORT` only works if the server was started with `HOST=::1`.

**Running a second, isolated *server instance*** (a distinct concern from workspaces — this is for testing code changes against a completely separate port/process, e.g. verifying npm-published vs. dev code side by side, not for organizing real boards): both the port and the DB root are overridable via env vars, read by `server.js`/`db.js` (server-side) and `client.js` (CLI/MCP):

```bash
AGENT_BOARD_DIR=/tmp/agent-board-test PORT=4318 agent-board          # test server, separate DB root + port
AGENT_BOARD_URL=http://localhost:4318 agent-board list               # CLI talking to that test server
```

The web UI needs no env var for this — it always calls `/api/...` relative to whatever origin served it, so it automatically follows the port of whichever server you opened it from.

**The global `agent-board` command is always the published npm package — never `npm link` this checkout.** `npm link` and `npm install -g @limao.li.design/agent-board` fight over the same global bin (whichever ran most recently silently wins, no warning), which was a recurring source of confusion before this rule: you'd run a command expecting dev behavior and silently get frozen npm code, or vice versa. The fix is to never let them compete — this repo is only ever run explicitly (`npm start`, or `node src/server.js` / `node src/cli.js ...`), from inside this directory. Every other project on the machine, and every other agent, always gets the real npm-published behavior through the plain `agent-board` command, with zero ambiguity about which code is running.

If `npm link` ever gets run here anyway (by habit, by another agent not reading this) and clobbers the global bin, restore it: `npm install -g @limao.li.design/agent-board`.

**If you're ever unsure which one you're actually talking to** (this repo's dev code, or the published npm copy) — every running server exposes `GET /api/meta` (`{version, source: "dev"|"npm", root, pid}`), also printed at startup. No UI badge for this (the dev-vs-global split above should make it moot in practice — see it as a fallback, not something to lean on). `readlink -f $(which agent-board)` also works: a path under this repo means something clobbered the global bin with `npm link`; a path under `.../node_modules/@limao.li.design/agent-board/...` (not a symlink) means it's correctly the npm copy.

**Tests**: `npm test` (`node --test test/*.test.js`, no framework dependency). It starts its own `server.js` on the first free port in 4470–4479 with a `mkdtemp` `AGENT_BOARD_DIR`, so it never touches your real boards, the 4316/4317 servers, or `~/.agent-board*`. UI changes still need a manual click-through (no browser tests).

**CI** (`.github/workflows/ci.yml`, every branch push and PR): `npm ci && npm test` on ubuntu + macos × Node 20/22/24, plus a `package` job that runs `cd web && npm ci && npm run build` and `scripts/check-pack.js` against `npm pack --dry-run --json`. That check fails if the tarball is missing `web/dist/index.html` or the built JS. `web/dist` is gitignored, so there's no committed build to diff; the real risk is publishing without the UI.

**Releasing** (`.github/workflows/release.yml`, on a `v*` tag push): check that the tag equals `v` + `package.json` version (fail otherwise), run the whole CI workflow, then build web, re-check the tarball and `npm publish --access public --provenance` using the `NPM_TOKEN` repo secret. Steps: (1) put a valid npm token in GitHub → Settings → Secrets → Actions → `NPM_TOKEN`; (2) bump `version` in `package.json` (`npm version <x.y.z> --no-git-tag-version`) and commit it on master; (3) `git tag v<x.y.z> && git push origin master v<x.y.z>`. Don't `npm publish` by hand from a checkout. Nothing there builds `web/dist` for you.

## Architecture

```
src/
  db.js            SQLite (rollback-journal mode — see below), one file per workspace under
                    ~/.agent-board/workspaces/<name>/tasks.db, schema + ticket-id generation
  routes/tasks.js   GET/POST /tasks, PATCH/DELETE /tasks/:id — reads req.db, not a module-level export
  routes/projects.js GET/POST /projects — same req.db pattern
  client.js         shared REST client — fetch wrappers used by BOTH cli.js and mcp/tools.js
  cli.js            list/create/update/delete/note/workspace — a REST client, not a DB client
  mcp/stdio.js      `agent-board mcp`: probe/auto-start the server, then createMcpServer() over
                    StdioServerTransport — stdout is JSON-RPC only, never imports db.js
  mcp/tools.js      9 MCP tools (list_tasks/create_task/update_task/delete_task/add_task_note,
                    list_projects/create_project/rename_project/delete_project) — also just REST clients
  server.js         Express wiring: workspace-resolving middleware + REST routes + POST /mcp
                    (stateless StreamableHTTPServerTransport) + static, port 4317
web/
  src/App.jsx       the UI (kanban + list views, task drawer, workspace switcher) — fetches src/api.js
  src/api.js        thin fetch wrapper matching the REST routes (a separate client from src/client.js — browser fetch vs. Node fetch, no code worth sharing between them)
```

**The REST API is the single source of truth.** The CLI, the MCP server, and the web UI are all just clients of it — none of them touch SQLite directly. This is what makes concurrent access from multiple agent sessions safe: there's exactly one process (`server.js`) that opens the DB files. The MCP transport is stateless (`sessionIdGenerator: undefined`) — each HTTP request gets a fresh `McpServer` + transport pair; nothing is kept in memory between calls, so there's no session store to worry about.

**Workspaces are separate SQLite files, not a column on one shared table.** `db.js` keeps a `Map<workspaceName, Database>`, opened lazily on first access and cached for the process lifetime (no pooling/eviction — trivial cost for a low-traffic local tool). Routes read their connection from `req.db`, set by workspace-resolving middleware in `server.js`: `/api/w/:workspace/tasks|projects` for explicit requests, plus `/api/tasks|projects` kept working as an alias to the literal `"default"` workspace so anything written before workspaces existed still works unmodified. This design means ticket-id sequencing isolation (two workspaces can both have a project prefixed `AB` with independent `AB-1`s) falls out for free — there's no shared table a dropped `WHERE workspace=?` clause could ever leak across. A pre-workspaces `~/.agent-board/tasks.db` is migrated automatically on first startup with the new code: `fs.renameSync` (atomic, not a copy) into `workspaces/default/tasks.db`.

**Data model** (`tasks` table, columns are camelCase to match the UI's card shape 1:1 — no request/response translation layer):
`id` (format `{projectPrefix}-{seq}`, e.g. `AB-42`), `seq`, `title`, `project`, `projectPrefix`, `parentId` (subtask → parent task; two-tier only, no Epic/Story), `agent`, `priority` (low/med/high), `status` (backlog/in_progress/review/done), `notes`, `worktree`, `branch`, `link`, `dueDate`, `createdAt`, `updatedAt`. A separate `projects` table holds `name`/`prefix` (prefix is chosen once per project, at creation — never auto-derived, to avoid collisions).

**`agent` means "current/last owner", not "everyone who ever touched this"** — same semantics as a Jira assignee field, deliberately not a participant list. A human-created ticket nobody's picked up yet should have `agent = null`, never a placeholder string like `"human"` — `null` is already the real behavior when the web UI's "+ New task" is used without picking an agent. The full multi-agent handoff trail (who had it, in what order) isn't lost when `agent` gets overwritten — it's captured by the `status`/`agent`/`priority` auto-history log described above, so it's one `notes` read away rather than a separate column/UI element.

**`notes` vs `note` in `PATCH /api/tasks/:id`** — these are deliberately different:
- `notes` (plural, matches the column) = full overwrite. Used by the UI's free-edit Description box, where you're meant to be able to rewrite the whole thing like a normal text field.
- `note` (singular verb) = appends one timestamped, agent-tagged line. Used by the CLI/MCP `note` command, so multiple sessions/agents leaving notes over time don't stomp on each other's history.

This split exists because the original design doc only specified one `notes` column with append semantics for the CLI use case; the UI's Description editor (added later, styled after Jira's field) needs full-rewrite semantics on the same column. Don't collapse these back into one behavior without re-solving that conflict.

**`PATCH` also auto-logs `status`/`agent`/`priority` changes** as an appended `notes` line (e.g. `status: backlog → in_progress`), separate from and in addition to any explicit `note` in the same request. These three are the fields two agents are most likely to race on (both claiming/reprioritizing the same ticket at once) — there's no optimistic locking, so a race still just resolves as last-write-wins on the column itself, but the auto-log at least makes a collision visible in the ticket's history instead of one agent's change silently vanishing. `title`/`worktree`/`branch`/`link`/`dueDate`/`notes` changes are NOT auto-logged (`TRACKED_FIELDS` in `routes/tasks.js`) — only add a field here if it's actually contention-prone, not for general audit-trail completeness.

**Unclear requests return `needs_input` (HTTP 422), not a guess and not a plain error.** When the board can't uniquely tell what the user meant, the REST API responds `{ code: "needs_input", question, options: [{label, description, args}] (≤4), answerArg?, error }`. Each option's `args` are the exact fields to send again, and `answerArg` names the field a free-text answer goes in. Today's cases: `resolveProject` (`normalize.js`) finds several projects (name ignoring case and prefix together match more than one; an exact name always wins); `POST /tasks` names a project that doesn't exist (`offerNew`: options are up to 2 existing projects plus new-project options with suggested prefixes, and the chosen one comes back as `newProjectPrefix`, which creates project + task in one call); `POST /tasks` has no title (suggests the first line of `notes`); `POST /projects` has no prefix (D15: the prefix is the user's call, so the server suggests and never picks). A zero-match read (`GET /tasks?project=nope`) is deliberately still a 404 hint. The MCP layer (`toolError` in `mcp/tools.js`) turns needs_input into a non-error result starting with `NEEDS USER INPUT` that tells the agent to ask with its own built-in tool (AskUserQuestion / request_user_input / ask_user, or chat) and retry. The rule is also in the MCP `instructions`. That's how every agent asks without per-agent mods or hooks. The CLI prints the question with rerun flags and exits `2`. The global switch `agent-board config ask off` (file `<AGENT_BOARD_DIR or ~/.agent-board>/ask`, read client-side by `client.askEnabled()`) only changes presentation: the server answers the same either way, and the clients show it as a plain error listing the options. Note the HTTP `/mcp` endpoint runs `client.js` inside the server process, so it reads that file from the server's `AGENT_BOARD_DIR`, and it calls `AGENT_BOARD_URL` (default 4317!). Always set both when testing a dev server's `/mcp`.

**Ticket IDs are generated inside a `better-sqlite3` transaction** (`createTask` in `db.js`) — `SELECT MAX(seq)+1` and the `INSERT` happen atomically on the single connection, so concurrent requests can't collide on the same id.

**SQLite journal mode: deliberately NOT WAL**, despite `agent-board-handoff.md` originally specifying WAL mode. WAL leaves recently-committed writes sitting only in a separate `-wal` file until a checkpoint merges them into the main `.db` file — if the process dies before that checkpoint (crash, `kill -9`), that data is gone even though the app already told the caller it was saved. This actually happened once and lost a session's worth of board data. WAL's usual benefit (readers don't block on writers) doesn't buy anything here since every write already funnels through one single-threaded Express process — there's never a second concurrent writer for WAL to help with. Plain rollback-journal mode (SQLite's default) commits straight into the main file on every transaction, so there's no partially-committed state a crash can lose. Don't reintroduce WAL mode without solving the checkpoint-durability problem first.

## Using agent-board to track work in *other* projects

This is the actual point of the tool: a real project adds a short section to its own `CLAUDE.md` telling agents to call this CLI. A working template (validated against a real Claude Code session) is at `templates/CLAUDE.md.example` — copy its "Task board" section into a project's `CLAUDE.md`, swap in that project's board name, and create the matching project via `POST /api/projects` (or a one-off `curl`) first, since tasks can't be created for a project that doesn't exist yet.

## Known gaps / not yet built

- **Future work ideas tracked as tickets, not here**: see `AB-5` (right-click a task card to send it to a specific CLI agent's terminal) and `AB-6` (Description drawer comment that dispatches to an agent) on this project's own board (`agent-board list --project=agent-board`). Design questions live in each ticket's notes — check there before starting either.
- **Public npm publishing**: done. Published as `@limao.li.design/agent-board` (scoped — the unscoped `agent-board` was blocked by the registry's name-similarity check against an unrelated existing package). `npm install -g @limao.li.design/agent-board` is how the global `agent-board` command should always be kept current — see the `npm link` warning above for why `npm link` shouldn't be used to do this instead. Publishing uses a granular access token with 2FA bypass (7-day expiry) since OTP-based publish is being deprecated by npm; regenerate a token the same way for future version bumps and paste it into the `NPM_TOKEN` GitHub secret before tagging (see **Releasing** above) (`npmjs.com` → Access Tokens → Generate New Token → Granular Access Token → check "Bypass two-factor authentication").
- **Registering the MCP server with a real client**: not done. Preferred: `claude mcp add agent-board -s user -- npx -y @limao.li.design/agent-board mcp` (stdio; Claude desktop app / Codex snippets in README). HTTP alternative: `claude mcp add --transport http agent-board http://localhost:4317/mcp`. The stdio path is verified with hand-written JSON-RPC, `npx` from the published 0.4.0, and real Claude Code and Codex CLI sessions (see `study/real-client-test-report.md`); not yet with the Claude desktop app or Gemini CLI, nor a Codex cold start with an empty npm cache. Not run yet since it's a persistent config change on whichever machine runs it — do it yourself when ready rather than having an agent run it for you.
- **`agent-board.jsx`** (repo root): the original single-file prototype, now superseded by `web/src/App.jsx`. Left in place rather than deleted so this file's history stays intact; safe to remove once you're confident nothing still references it.
- **`agent-board open <id>`** (jump to a task's worktree from the CLI): explicitly out of scope per the handoff doc, not started.
- **MCP tools for listing/creating/deleting workspaces**: not built — an agent doesn't need to invent or destroy a workspace at runtime, that's a human/CLI decision about which board a project's `CLAUDE.md` points at. The 5 task MCP tools do accept an optional `workspace` param to *use* one, just not to manage the set of them.
