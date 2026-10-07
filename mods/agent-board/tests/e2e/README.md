# End-to-end checks (tmux, real engine, no model prompts)

```
bash tests/e2e/band-smoke.sh        # ~2 min: 53 assertion groups over linked / none / many / held / off / offline, 8 widths
python3 tests/e2e/contrast.py       # ~1 min: WCAG contrast of the band colors, dark vs light theme
```

Both start a throw-away Agent Board server (`AGENT_BOARD_DIR=<tmp>`, port 4361 / 4366; override with `PORT=`; the user's ports 4316/4317/4352-4354 are refused), run Claude Code inside their own tmux socket, and clean up on exit. They only use local slash commands (`/board-sync ...`), so no quota is spent. `--strict-mcp-config` keeps a user-level agent-board MCP server from auto-starting on the test port.

Needs: tmux, node, jq, python3, and a git repo on branch `feat/try-mod` that Claude Code already trusts (`TRIAL_REPO=`; a new folder stops at the trust prompt). Engine: `CLAUDE_BIN=` (default the desktop app's 2.1.288); for 2.1.285 add `ENGINE_ENV=CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`. `THEME=light` starts the smoke test with `--settings '{"theme":"light"}'`.

Asserted per capture (`band_check.py`): band line no wider than the columns (display width via `termwidth.py`, wcwidth when installed), expected keywords per state and width, at least one free cell between the band text and the engine's `[-]` button, no `⚠` / `agent-board:` (the old status-line style), band gone after `/board-sync off`, `/board-sync status` lines within 78 cells.

Not covered, cannot be: a terminal font or emulator that draws ambiguous-width symbols (`● ▲ ▌`) two cells wide, a real CJK font's metrics, tmux does its own width accounting. `MOD_DIR=<copy>` and `AB_ROOT=<checkout with src/server.js>` run the script against a scratch copy (mutation checks).
