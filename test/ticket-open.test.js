import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
let child, base, dir;

async function startOn(port) {
  child = spawn(process.execPath, [path.join(src, "server.js")], {
    env: { ...process.env, PORT: String(port), AGENT_BOARD_DIR: dir, AGENT_BOARD_URL: `http://localhost:${port}` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let exited = false;
  child.on("exit", () => (exited = true));
  for (let i = 0; i < 50 && !exited; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try {
      const meta = await (await fetch(`http://127.0.0.1:${port}/api/meta`)).json();
      if (meta.pid === child.pid) return true;
    } catch {}
  }
  return false;
}

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-test-"));
  for (let port = 4470; port <= 4479; port++) {
    if (await startOn(port)) { base = `http://127.0.0.1:${port}`; break; }
    child.kill();
  }
  assert.ok(base, "no free port in 4470-4479");
  await api("POST", "/api/workspaces", { name: "t" });
  await api("POST", "/api/workspaces", { name: "empty" });
  await api("POST", "/api/w/t/projects", { name: "AB-Benchmark", prefix: "BM" });
  await api("POST", "/api/w/t/projects", { name: "發表會", prefix: "PR" });
});

after(() => {
  child?.kill();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

async function api(method, p, body) {
  const res = await fetch(base + p, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const create = (b, ws = "t") => api("POST", `/api/w/${ws}/tasks`, { title: "x", ...b });

test("project resolves by exact name, case, prefix, whitespace", async () => {
  for (const input of ["AB-Benchmark", "ab-benchmark", "bm", "BM", "  bm  ", " AB-Benchmark "]) {
    const r = await create({ project: input });
    assert.equal(r.status, 201, input);
    assert.equal(r.body.project, "AB-Benchmark");
    assert.equal(r.body.projectPrefix, "BM");
    assert.match(r.body.id, /^BM-\d+$/);
  }
  assert.equal((await create({ project: "pr" })).body.project, "發表會");
});

test("GET ?project= accepts prefix and aliases for status", async () => {
  const r = await api("GET", "/api/w/t/tasks?project=bm&status=待辦");
  assert.equal(r.status, 200);
  assert.ok(r.body.length >= 1 && r.body.every((t) => t.project === "AB-Benchmark" && t.status === "backlog"));
  assert.equal((await api("GET", "/api/w/t/tasks?project=nope")).status, 404);
  assert.equal((await api("GET", "/api/w/t/tasks?status=bogus")).status, 400);
});

test("unknown project: 404 listing existing projects, no POST /api/projects", async () => {
  const r = await create({ project: "準備發表會" });
  assert.equal(r.status, 404);
  assert.match(r.body.error, /Existing projects: AB-Benchmark \(BM\), 發表會 \(PR\)/);
  assert.ok(!r.body.error.includes("POST /api/projects"));
});

test("workspace with no projects says to create one first", async () => {
  const r = await create({ project: "anything" }, "empty");
  assert.equal(r.status, 404);
  assert.match(r.body.error, /no projects/);
  assert.ok(!r.body.error.includes("POST /api/projects"));
});

test("status and priority aliases are stored canonically", async () => {
  const cases = [
    [{ status: "進行中", priority: "高" }, "in_progress", "high"],
    [{ status: "WIP", priority: "Urgent" }, "in_progress", "high"],
    [{ status: "In-Progress", priority: "p0" }, "in_progress", "high"],
    [{ status: "in_progress", priority: "medium" }, "in_progress", "med"],
    [{ status: "todo", priority: "中" }, "backlog", "med"],
    [{ status: "新", priority: "低" }, "backlog", "low"],
    [{ status: "in review", priority: "p3" }, "review", "low"],
    [{ status: "審查" }, "review", "med"],
    [{ status: "完成" }, "done", "med"],
    [{ status: "Closed", priority: "critical" }, "done", "high"],
    [{}, "backlog", "med"],
  ];
  for (const [input, status, priority] of cases) {
    const r = await create({ project: "bm", ...input });
    assert.equal(r.status, 201, JSON.stringify(input));
    assert.equal(r.body.status, status, JSON.stringify(input));
    assert.equal(r.body.priority, priority, JSON.stringify(input));
  }
});

test("invalid status / priority: 400 with allowed values", async () => {
  const s = await create({ project: "bm", status: "someday" });
  assert.equal(s.status, 400);
  assert.match(s.body.error, /backlog, in_progress, review, done/);
  const p = await create({ project: "bm", priority: "asap" });
  assert.equal(p.status, 400);
  assert.match(p.body.error, /low, med, high/);
});

test("PATCH normalizes aliases, rejects invalid, ignores project", async () => {
  const t = (await create({ project: "bm" })).body;
  const ok = await api("PATCH", `/api/w/t/tasks/${t.id}`, { status: "doing", priority: "高", project: "發表會" });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.status, "in_progress");
  assert.equal(ok.body.priority, "high");
  assert.equal(ok.body.project, "AB-Benchmark");
  assert.equal((await api("PATCH", `/api/w/t/tasks/${t.id}`, { status: "nope" })).status, 400);
  assert.equal((await api("GET", `/api/w/t/tasks?project=bm`)).body.find((x) => x.id === t.id).status, "in_progress");
});

// minimal stateless MCP over HTTP (responses may be SSE)
async function rpc(method, params) {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const text = await res.text();
  const line = text.split("\n").find((l) => l.startsWith("data:"));
  return JSON.parse(line ? line.slice(5) : text).result;
}

test("MCP: instructions always present with key rules", async () => {
  const r = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } });
  const text = r.instructions;
  assert.ok(text, "instructions missing");
  assert.ok(text.split("\n").filter(Boolean).length <= 6);
  for (const kw of ["create_task", "list_projects", "in_progress", "notes", "agent"]) assert.ok(text.includes(kw), kw);
});

test("MCP: aliases pass the schema; unknown project error names create_project", async () => {
  const args = { workspace: "t", title: "mcp", project: "BM", status: "進行中", priority: "高" };
  const ok = await rpc("tools/call", { name: "create_task", arguments: args });
  assert.ok(!ok.isError, ok.content[0].text);
  const task = JSON.parse(ok.content[0].text);
  assert.equal(task.status, "in_progress");
  assert.equal(task.priority, "high");

  const bad = await rpc("tools/call", { name: "create_task", arguments: { ...args, project: "準備發表會" } });
  assert.ok(bad.isError);
  const msg = bad.content[0].text;
  assert.match(msg, /Existing projects: AB-Benchmark \(BM\)/);
  assert.match(msg, /create_project/);
  assert.ok(!msg.includes("POST /api/projects"));
});

test("CLI: unknown project error suggests project create", async () => {
  const out = await new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(src, "cli.js"), "create", "--title=x", "--project=準備發表會", "--workspace=t"], {
      env: { ...process.env, AGENT_BOARD_URL: base },
    });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("exit", () => resolve(err));
  });
  assert.match(out, /Existing projects:/);
  assert.match(out, /agent-board project create "準備發表會" --prefix=<PREFIX>/);
  assert.ok(!out.includes("POST /api/projects"));
});
