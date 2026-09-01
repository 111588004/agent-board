# Scenario Tests — Agent Board

Real end-to-end tests run against a live-installed `@limao.li.design/agent-board` (npm-installed, not the dev checkout), simulating a project's `CLAUDE.md` onboarding a brand-new agent with zero prior knowledge of the board. Test project: `scenario-x` (prefix `SX`), backed by a tiny real bug (`calc.js` with a broken `subtract()` and later `multiply()`) so agents had genuine work to do, not a synthetic "test the board" instruction.

Covers the 4 collaboration scenarios worked out earlier in the project's architecture discussion (see `agent-board-handoff.md` §2 "讀取情境"):

1. **Handoff** — a ticket left mid-way with a note, picked up by a different session via `@ticket-id` reference.
2. **Worktree as subtask** — parallel worktrees on the same task modeled as sibling subtasks via `parentId`.
3. **Agent finds its own work** — an agent discovers relevant backlog tickets via the board itself, with no other instruction.
4. **Pure dashboard viewing** — out of scope for these tests (no agent read involved).

## Setup

- Fresh scratch project directory with a `CLAUDE.md` containing only the standard "Task board" section from `templates/CLAUDE.md.example` (project name `scenario-x`, agent id `claude`) — no other mention of agent-board anywhere in the prompt given to test agents.
- `calc.js` seeded with a real bug: `subtract(a, b)` returned `a + b`.
- Board seeded with two backlog tickets before the first agent ran:
  - `SX-1` — "Fix subtract() bug in calc.js" (high priority, relevant)
  - `SX-2` — "Write onboarding docs for new contributors" (low priority, deliberate decoy — unrelated to the coding task)

## Scenario 3 — agent finds its own work

**Setup:** a completely fresh subagent (no context from this conversation) was told only: *"There's a bug in calc.js — the subtract() function is giving wrong results. Please fix it."* No mention of agent-board, tickets, or a task board anywhere in the prompt.

**Result — pass.**
- Agent read the directory's `CLAUDE.md` on its own initiative, ran `agent-board list --project=scenario-x`, found `SX-1` as the matching open ticket.
- Moved `SX-1` to `in_progress`, fixed the bug (`return a - b`), verified with an inline assert script.
- Left an accurate note explaining the root cause and verification, moved `SX-1` to `done`.
- Correctly ignored the decoy ticket `SX-2` — never touched it.
- Used `--agent=claude` on every call, per the `CLAUDE.md` instruction (an earlier version of the template left this optional and a test agent dropped it — the instruction was reworded to require it explicitly, and this run confirms the fix holds).

## Scenario 1 — handoff via `@ticket-id`

**Setup:** seeded `SX-3` ("Add multiply() to calc.js") already `review`, with a note from a simulated "previous session": *multiply() implemented, tested positive/mixed-sign cases, explicitly flagged the both-negative case as unverified.* A second, completely fresh subagent was told only: *"Please pick up where the last session left off on @SX-3. Check its current status/notes first, then finish it off properly."*

**Result — pass, and caught a real bug.**
- Agent looked up `SX-3`, read the existing note, and didn't just rubber-stamp the prior work — it actually found a genuine bug in the existing `multiply()` implementation (a sign-handling special case that was wrong: `(-2) * (-3)` returned `-6` instead of `6`).
- Fixed it by deleting the unnecessary special-casing entirely (`a * b` alone is correct for all sign combinations), verified with an assert script covering all sign combinations plus zero.
- Appended a second note (not a replacement — the append-only `notes` semantics preserved the full handoff trail) explaining the bug and the fix, moved `SX-3` to `done`.
- Confirms the append-vs-overwrite design decision for `note` actually matters in practice: an overwrite would have destroyed the first agent's context before the second agent ever read it.

## Scenario 2 — worktree as subtask

**Setup:** not agent-driven — a direct structural/data-model check. Created a parent ticket `SX-4` ("Refactor calc.js into separate modules") and two children via `--parent=SX-4`:
- `SX-5` — "worktree: extract add/subtract", `worktree=/tmp/wt-add-subtract`, `branch=feat/extract-add-subtract`
- `SX-6` — "worktree: extract multiply", `worktree=/tmp/wt-multiply`, `branch=feat/extract-multiply`

**Result — pass.**
- `agent-board list --parent=SX-4` and `GET /api/tasks?parentId=SX-4` both correctly return only the two children.
- Web UI (List view) renders `SX-5`/`SX-6` with a `↳ SX-4` parent-reference chip, and clicking it navigates to the parent ticket.
- Confirms the two-tier `parentId` model is sufficient for "same task, multiple worktrees running in parallel" without needing a real Epic/Story/Task/Subtask hierarchy.

## Notable side findings from this test round

- **Select/dropdown interaction bug** — surfaced independently while reviewing the List view during these tests: the Project/Agent/Priority/Status fields were native `<select>` elements disguised as chips (`appearance: none`), so the *closed* state looked custom-styled but the *open* state fell back to the browser's unstyled native option list, and the top filter bar (`All projects`/`All agents`) had the same issue via a wrapping `<div>` with only the inner `<select>` actually clickable. Fixed by replacing both with a self-drawn `Dropdown` component (see `web/src/App.jsx`); the same fix was ported to the standalone design-review Artifact (vanilla JS `<details>`/`<summary>` equivalent).
- **WAL data-loss incident** — an unrelated server crash during this same session lost the first run of this scenario-x data (plus a real ticket the user had created) because SQLite was in WAL mode and the crash happened before a checkpoint. Root-caused and fixed by dropping WAL mode entirely in favor of the rollback-journal default (see `CLAUDE.md`'s SQLite journal mode note) — verified via `kill -9` durability test. This file's data is the *second*, post-fix creation of the same scenario.
