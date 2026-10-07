#!/bin/bash
# End-to-end smoke test of the always-on band, in tmux, against a throw-away Agent Board server.
# No model prompt is ever sent (no quota used): only local slash commands and restarts.
#   bash tests/e2e/band-smoke.sh
# env: CLAUDE_BIN (engine), ENGINE_ENV (e.g. CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 for 2.1.285),
#      PORT (default 4361), TRIAL_REPO (a git repo on branch feat/try-mod that Claude already trusts),
#      WIDTHS (space separated), THEME (value for --settings {"theme":...}), VERBOSE=1 to list every PASS
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
MOD="${MOD_DIR:-$(cd "$HERE/../.." && pwd)}"                                   # MOD_DIR: test a scratch copy (mutation runs)
ROOT="${AB_ROOT:-$(cd "$(git -C "$HERE" rev-parse --git-common-dir)/.." && pwd)}"           # checkout that holds src/server.js
CLAUDE_BIN="${CLAUDE_BIN:-/Users/limao/Library/Application Support/Claude/claude-code/2.1.288/48d54124d3c3/claude.app/Contents/MacOS/claude}"
TRIAL_REPO="${TRIAL_REPO:-/private/tmp/claude-501/-Users-limao-Agent-Board/0f5adf1c-6f3c-466d-8019-c33e8da56535/scratchpad/trial/repo}"
PORT="${PORT:-4361}"
WIDTHS="${WIDTHS:-200 120 100 80 64 50 40 36}"
SOCK="qa$PORT"
case "$PORT" in 4316|4317|4352|4353|4354) echo "refusing port $PORT (in use by the user)"; exit 2;; esac
[ "$(git -C "$TRIAL_REPO" branch --show-current)" = "feat/try-mod" ] || { echo "TRIAL_REPO must be on branch feat/try-mod"; exit 2; }
lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1 && { echo "port $PORT is busy"; exit 2; }

DB="$(mktemp -d)"; SRV=""; FAILED=0; TOTAL=0
URL="http://localhost:$PORT"
# The mod's $.store is the user's real one (~/.claude/plugins/store/agent-board_inline-*.json): the run
# edits its one-time `welcome` key, so it is backed up here and put back (or removed again) on exit.
STORE_GLOB="$HOME/.claude/plugins/store/agent-board_inline-"
STORE="$(ls "$STORE_GLOB"*.json 2>/dev/null | head -1)"
[ -n "$STORE" ] && cp "$STORE" "$DB/store.bak"
store_set() { # store_set <jq filter>: rewrite the store file (only once it exists)
  local f; f="$(ls "$STORE_GLOB"*.json 2>/dev/null | head -1)"; [ -n "$f" ] || return 0
  jq "$1" "$f" >"$DB/store.tmp" && mv "$DB/store.tmp" "$f"
}
cleanup() {
  tmux -L $SOCK kill-server 2>/dev/null
  if [ -n "$SRV" ]; then kill $SRV 2>/dev/null; sleep 0.5; kill -9 $SRV 2>/dev/null; fi
  if [ -n "$STORE" ]; then cp "$DB/store.bak" "$STORE"; else rm -f "$STORE_GLOB"*.json; fi
  rm -rf "$DB"
  if lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then echo "WARNING: port $PORT still held"; FAILED=1; else echo "port $PORT released"; fi
}
trap cleanup EXIT INT TERM

start_server() {
  (cd "$ROOT" && AGENT_BOARD_DIR="$DB" PORT=$PORT exec node src/server.js >"$DB/server.log" 2>&1) &
  SRV=$!
  for i in $(seq 40); do curl -sf $URL/api/meta >/dev/null && return; sleep 0.25; done
  echo "server did not start"; cat "$DB/server.log"; exit 2
}
api() { if [ $# -ge 3 ]; then curl -s -X "$1" "$URL/api$2" -H 'content-type: application/json' -d "$3"; else curl -s -X "$1" "$URL/api$2"; fi; }
mk()  { api POST /tasks "$(jq -nc --arg t "$1" --argjson x "$2" '{title:$t,project:"Agent Board"} + $x')" | jq -r .id; }
wipe() { for id in $(api GET /tasks | jq -r '.[] | select(.branch=="feat/try-mod") | .id'); do api DELETE /tasks/$id >/dev/null; done; }

cap() { tmux -L $SOCK capture-pane -p -t qa; }
send() { tmux -L $SOCK send-keys -t qa "$1" Enter; sleep "${2:-4}"; }
resize() { tmux -L $SOCK resize-window -t qa -x "$1" -y 36; sleep 1.5; }
launch() { # launch <1: wait for the band | 0: wait a fixed time, no band expected>
  tmux -L $SOCK kill-server 2>/dev/null
  local settings=""; [ -n "${THEME:-}" ] && settings="--settings '{\"theme\":\"$THEME\"}'"
  tmux -L $SOCK new-session -d -s qa -x 200 -y 36 "cd '$TRIAL_REPO' && env AGENT_BOARD_URL=$URL DISABLE_AUTOUPDATER=1 ${ENGINE_ENV:-} '$CLAUDE_BIN' --plugin-dir '$MOD' --strict-mcp-config $settings"
  for i in $(seq 60); do cap | grep -q '❯' && break; sleep 0.5; done
  if [ "$1" = 1 ]; then for i in $(seq 40); do cap | grep -q '^▌' && break; sleep 0.5; done; else sleep 10; fi
  sleep 1
}
# verify <kind> <cols> [--clean]: run band_check.py on a fresh capture
verify() {
  local out rc; out=$(cap | python3 "$HERE/band_check.py" "$@"); rc=$?
  TOTAL=$((TOTAL+1)); [ $rc -ne 0 ] && FAILED=$((FAILED+1))
  if [ -n "${VERBOSE:-}" ] || [ $rc -ne 0 ]; then echo "$out"; else echo "  ok $1@$2 ($(echo "$out" | grep -c PASS) checks)"; echo "$out" | grep '^  INFO'; fi
}
widths() { for w in $WIDTHS; do resize $w; verify "$1" $w ${2---clean}; done; }  # 2nd arg "" = a command output is on screen, skip the screen-wide check
grep_screen() { # grep_screen <name> <regex>: the regex must be on the screen
  TOTAL=$((TOTAL+1))
  if cap | grep -Eq "$2"; then echo "  ok $1"; else echo "  FAIL $1 (no match for /$2/)"; echo '--- screen ---'; cap; echo '--------------'; FAILED=$((FAILED+1)); fi
}

echo "engine: $("$CLAUDE_BIN" --version 2>&1 | head -1)  ${ENGINE_ENV:-}  theme=${THEME:-default}"

echo "== 0 first session ever: server down (how to start it), then up (web tour), each once"
store_set 'del(.welcome)'
if [ -n "$STORE" ]; then
  launch 0; grep_screen "offline welcome" "^▌ ○ Agent Board is not running .*npx @limao.li.design/agent-board"
  launch 0; TOTAL=$((TOTAL+1)); if cap | grep -q '^▌'; then echo "  FAIL offline welcome shown twice"; FAILED=$((FAILED+1)); else echo "  ok offline welcome only once"; fi
  start_server
  launch 1; grep_screen "connected welcome" "^▌ ✓ Agent Board connected · first time\? take the tour  → $URL/\\?tour=1"
  verify welcome 200 --clean
else
  echo "  (no store file yet: the first launch below creates it; welcome not checked)"
  start_server
fi

echo "== 1 linked, English title"; wipe
ID=$(mk "Fix login redirect loop on mobile Safari" '{"branch":"feat/try-mod","status":"in_progress","priority":"high"}')
launch 1; widths linked
echo "== 1b linked, CJK + mixed title (re-read with /board-sync link $ID)"
api PATCH /tasks/$ID '{"title":"修正登入重導迴圈 on 手機版 Safari，使用者回報無法登出"}' >/dev/null
resize 80; send "/board-sync link $ID" 3; widths linked ""
echo "== 2 off, then on"; resize 120
send "/board-sync off"; verify off 120
send "/board-sync on" 4; verify linked 120
echo "== 3 /board-sync status (linked)"
send "/board-sync status"; verify status 120; grep_screen "status shows card id" "card +$ID"; grep_screen "status says reporting on" "reporting on"
echo "== 4 offline (server killed after binding)"
kill $SRV; wait $SRV 2>/dev/null; SRV=""
send "/board-sync link $ID" 3
for w in 120 80 50; do resize $w; verify offline $w; done
resize 120; send "/board-sync status"; grep_screen "status says offline" "offline"
echo "== 5 server down at start, nothing bound: stays silent"
launch 0; verify noband 120
start_server; wipe

echo "== 6 no card for this branch"
launch 1; widths none
resize 120; send "/board-sync status"; grep_screen "status explains none" "no open card matches"
echo "== 7 several cards (two with the same branch)"
A=$(mk "first card" '{"branch":"feat/try-mod"}'); B=$(mk "second card" '{"branch":"feat/try-mod"}')
api PUT /config '{"ask":"off"}' >/dev/null   # the board's ask mode off: no dialog, the band lists them
launch 1; widths many
resize 120; send "/board-sync status"; grep_screen "status lists both ids" "cards match: $A $B"
echo "== 7b several cards, asking on: a dialog at start; Esc binds nothing"
api PUT /config '{"ask":"on"}' >/dev/null
launch 0; grep_screen "dialog asks which card" "cards match this branch. Which one"; grep_screen "dialog offers None of these" "None of these"
tmux -L $SOCK send-keys -t qa Escape; sleep 2; verify many 200
api GET /tasks | jq -e '[.[] | select(.branch=="feat/try-mod" and .agent != null)] | length == 0' >/dev/null \
  && { TOTAL=$((TOTAL+1)); echo "  ok nothing claimed"; } || { TOTAL=$((TOTAL+1)); FAILED=$((FAILED+1)); echo "  FAIL a card was claimed"; }
echo "== 8 held by codex"
wipe; mk "held card" '{"branch":"feat/try-mod","agent":"codex","status":"in_progress"}' >/dev/null
launch 1; widths held
resize 120; send "/board-sync status"; grep_screen "status says held" "held by codex"

echo; echo "assertion groups run: $TOTAL, failed: $FAILED"
trap - EXIT; cleanup
if [ $FAILED -eq 0 ]; then echo "ALL PASS"; else echo "SOME FAILED"; fi
[ $FAILED -eq 0 ]
