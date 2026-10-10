// AB-29: the "copy launch command" text — a hand-off any CLI agent can act on.
// Plain JS with no React/DOM so test/launch.test.js can import it under node.
// Copy only: nothing here starts a terminal or a process.

export const DEFAULT_BOARD_URL = "http://localhost:4317"; // what the CLI/MCP assume with no AGENT_BOARD_URL

// cmd: how each CLI starts an interactive session with a first prompt
// (checked against each one's --help: gemini's bare positional is one-shot, -i stays open)
export const LAUNCH_TARGETS = [
  { id: "claude", label: "Claude Code", cmd: "claude" },
  { id: "codex", label: "Codex", cmd: "codex" },
  { id: "gemini", label: "Gemini CLI", cmd: "gemini -i" },
  { id: "pi", label: "Pi", cmd: "pi" },
  { id: "generic", label: "Any agent", cmd: null }, // a prompt only — the menu says so (App.jsx LaunchCommand)
];

export function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

// `~/x` inside quotes doesn't expand, so keep the tilde outside them
function quotePath(p) {
  return p === "~" ? "~" : p.startsWith("~/") ? `~/${shellQuote(p.slice(2))}` : shellQuote(p);
}

export function launchPromptLines({ card, target = "generic", workspace = "default", boardUrl = DEFAULT_BOARD_URL }) {
  const id = card.id;
  const custom = workspace && workspace !== "default";
  const ws = custom ? ` --workspace=${shellQuote(workspace)}` : "";
  const agent = target === "generic" ? "<your agent id, e.g. codex>" : target;
  const cli = boardUrl === DEFAULT_BOARD_URL ? "agent-board" : `AGENT_BOARD_URL=${boardUrl} agent-board`;
  const link = `${boardUrl}/?task=${encodeURIComponent(id)}${custom ? `&workspace=${encodeURIComponent(workspace)}` : ""}`;
  // MCP clients are registered against the default URL, so on any other port they'd write to the wrong board
  const mcp = (text) => (boardUrl === DEFAULT_BOARD_URL ? text : "");
  const api = `${boardUrl}/api/w/${encodeURIComponent(workspace || "default")}/tasks?project=${encodeURIComponent(card.projectPrefix || card.project)}`;

  const lines = [`You are picking up Agent Board ticket ${id}: "${card.title}" (project ${card.project}). Ticket: ${link}`];
  if (card.worktree || card.branch) {
    lines.push(`Work in ${[card.worktree, card.branch && `branch ${card.branch}`].filter(Boolean).join(", ")}.`);
  }
  if (custom) lines.push(`This board is the "${workspace}" workspace: pass it on every call (CLI --workspace${mcp(", MCP workspace param")}).`);
  lines.push(
    `1. Before changing anything, read the description and history of the ticket: ${mcp(`MCP list_tasks (project "${card.project}"), or `)}curl -s "${api}" and find ${id} in it.`,
    `2. Claim it: ${cli} update ${id} --status=in_progress --agent=${agent}${ws}${mcp(" (MCP: update_task)")}.`,
    `3. Report as you go: ${cli} note ${id} "what changed / what is blocked" --agent=${agent}${ws}${mcp(" (MCP: add_task_note)")}. When finished: ${cli} update ${id} --status=review${ws}.`,
    `No agent-board command on this machine? Use npx -y @limao.li.design/agent-board in its place.`
  );
  return lines;
}

// generic: a multi-line prompt to paste into an agent that's already running.
// A named agent: one shell line (cd + start that CLI with the prompt).
export function buildLaunchText(opts) {
  const target = LAUNCH_TARGETS.find((t) => t.id === opts.target) || LAUNCH_TARGETS.at(-1);
  const lines = launchPromptLines({ ...opts, target: target.id });
  if (!target.cmd) return lines.join("\n");
  const run = `${target.cmd} ${shellQuote(lines.join(" "))}`;
  return opts.card.worktree ? `cd ${quotePath(opts.card.worktree)} && ${run}` : run;
}
