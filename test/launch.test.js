import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { buildLaunchText, launchPromptLines, shellQuote } from "../web/src/launch.js";

const card = { id: "AB-42", title: `Fix "it's" bug`, project: "My App", projectPrefix: "AB", worktree: null, branch: null };

test("generic target is a multi-line prompt with id, title and how to report", () => {
  const text = buildLaunchText({ card, target: "generic" });
  assert.match(text, /AB-42: "Fix "it's" bug"/);
  assert.match(text, /agent-board update AB-42 --status=in_progress --agent=<your agent id/);
  assert.match(text, /agent-board note AB-42 /);
  assert.match(text, /MCP: add_task_note/);
  assert.match(text, /npx -y @limao\.li\.design\/agent-board/);
  assert.ok(text.includes("\n"));
  assert.doesNotMatch(text, /workspace/); // default workspace stays implicit
  assert.doesNotMatch(text, /AGENT_BOARD_URL/); // default port needs no env var
});

test("named agents get their own launch command, quoted so the shell passes the prompt through untouched", () => {
  for (const [target, cmd] of [["claude", "claude"], ["codex", "codex"], ["gemini", "gemini -i"], ["pi", "pi"]]) {
    const text = buildLaunchText({ card, target });
    assert.ok(text.startsWith(`${cmd} '`), text);
    assert.ok(!text.includes("\n"));
    assert.match(text, new RegExp(`--agent=${target}`));
    // swap the CLI for printf and let a real shell parse the line
    const echoed = execFileSync("sh", ["-c", text.replace(cmd, "printf %s")], { encoding: "utf8" });
    assert.equal(echoed, launchPromptLines({ card, target }).join(" "));
  }
});

test("worktree adds a cd, and ~ stays outside the quotes so it expands", () => {
  assert.ok(buildLaunchText({ card: { ...card, worktree: "/tmp/a b" }, target: "codex" }).startsWith("cd '/tmp/a b' && codex '"));
  assert.ok(buildLaunchText({ card: { ...card, worktree: "~/code/x y" }, target: "claude" }).startsWith("cd ~/'code/x y' && claude '"));
  assert.match(buildLaunchText({ card: { ...card, worktree: "~/w", branch: "feat/x" }, target: "generic" }), /Work in ~\/w, branch feat\/x\./);
});

test("a non-default workspace and board URL are spelled out on every command", () => {
  const text = buildLaunchText({ card, target: "generic", workspace: "client work", boardUrl: "http://localhost:4316" });
  assert.match(text, /"client work" workspace/);
  assert.match(text, /AGENT_BOARD_URL=http:\/\/localhost:4316 agent-board update AB-42 .* --workspace='client work'/);
  assert.match(text, /\?task=AB-42&workspace=client%20work/);
  assert.match(text, /\/api\/w\/client%20work\/tasks\?project=AB/);
  assert.doesNotMatch(text, /MCP/); // registered MCP clients point at the default URL, not this board
});

test("shellQuote escapes single quotes", () => {
  assert.equal(shellQuote("a'b"), `'a'\\''b'`);
});
