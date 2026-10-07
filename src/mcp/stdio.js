// `agent-board mcp` — MCP over stdio, for clients that launch a command
// (npx -y @limao.li.design/agent-board mcp) instead of connecting to a URL.
// Still just a REST client: never imports db.js, never opens SQLite. stdout
// is reserved for JSON-RPC — everything human-readable goes to stderr.
//
// The one exception to "the CLI never auto-spawns a server": if nothing is
// listening at a localhost AGENT_BOARD_URL, start server.js detached (so it
// outlives this session and stays shared with the web UI / CLI / other
// agents). The port itself is the mutex — if two of these race, the loser's
// server hits EADDRINUSE and exits before it ever opens a DB, and both
// stdio processes end up talking to the winner.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./tools.js";

const url = new URL(process.env.AGENT_BOARD_URL || "http://localhost:4317"); // same default as client.js
const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const isDevCheckout = !srcDir.includes("node_modules"); // same check as db.js/server.js

async function getMeta() {
  try {
    const res = await fetch(new URL("/api/meta", url), { signal: AbortSignal.timeout(1000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

async function ensureServer() {
  if (await getMeta()) return null;
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    console.error(`agent-board mcp: no server at ${url.origin}, and it isn't localhost — not auto-starting one`);
    return null;
  }
  // a dev checkout without an explicit URL would squat the npm port (4317)
  // with dev code, and the real global server could never start after it
  if (isDevCheckout && !process.env.AGENT_BOARD_URL) {
    console.error("agent-board mcp: no server running, and this is a dev checkout — refusing to auto-start one on the npm port. Set AGENT_BOARD_URL (e.g. http://localhost:4330) to auto-start a dev server there.");
    return null;
  }

  // same DB root db.js will pick for the spawned server
  const root = process.env.AGENT_BOARD_DIR || path.join(os.homedir(), isDevCheckout ? ".agent-board-dev" : ".agent-board");
  fs.mkdirSync(root, { recursive: true });
  const log = path.join(root, "server.log");
  const fd = fs.openSync(log, "a");
  const child = spawn(process.execPath, [path.join(srcDir, "server.js")], {
    detached: true,
    stdio: ["ignore", fd, fd],
    // the server binds 127.0.0.1 by default; a [::1] URL needs it on the IPv6 loopback instead
    env: { ...process.env, PORT: url.port || "80", ...(url.hostname === "[::1]" ? { HOST: "::1" } : {}) },
  });
  child.unref();
  fs.closeSync(fd);

  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const meta = await getMeta();
    if (!meta) continue;
    if (meta.pid !== child.pid) return null; // someone else won the race
    return `agent-board: no server was running at ${url.origin}, so this MCP session auto-started one in the background (pid ${child.pid}, log: ${log}). It keeps running after this session ends so the web UI, CLI and other agents can share it — stop it with \`kill ${child.pid}\`.`;
  }
  console.error(`agent-board mcp: started a server but it didn't answer within 5s — see ${log}`);
  return null;
}

const notice = await ensureServer();
await createMcpServer({ notice }).connect(new StdioServerTransport());
