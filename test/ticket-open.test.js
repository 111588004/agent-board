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

test("unknown project on create: asks — existing project or new one with a prefix the user picks", async () => {
  const r = await create({ project: "準備發表會" });
  assert.equal(r.status, 422);
  assert.equal(r.body.code, "needs_input");
  assert.ok(r.body.options.length >= 2 && r.body.options.length <= 4);
  assert.deepEqual(r.body.options[0].args, { project: "發表會", rememberAs: "準備發表會" }); // name contains it -> offered first
  const fresh = r.body.options.find((o) => o.args.newProjectPrefix);
  assert.ok(fresh, "a new-project option");
  assert.ok(!r.body.error.includes("POST /api/projects"));
  // GET with an unknown project is a zero-match case: hint, don't ask
  assert.equal((await api("GET", "/api/w/t/tasks?project=準備發表會")).status, 404);
});

test("workspace with no projects: answering the question creates project + ticket in one call", async () => {
  await api("POST", "/api/workspaces", { name: "fresh" });
  const r = await create({ project: "My Web App" }, "fresh");
  assert.equal(r.status, 422);
  assert.deepEqual(r.body.options.map((o) => o.args.newProjectPrefix), ["MWA", "MY", "MYW"]);
  const ok = await create({ project: "My Web App", ...r.body.options[0].args }, "fresh");
  assert.equal(ok.status, 201);
  assert.equal(ok.body.id, "MWA-1");
  assert.equal((await create({ project: "mwa" }, "fresh")).body.id, "MWA-2");
});

test("several projects match: asks which one, then the answer resolves", async () => {
  await api("POST", "/api/w/t/projects", { name: "OPS", prefix: "OP" });
  await api("POST", "/api/w/t/projects", { name: "Operations", prefix: "OPS" });
  const r = await create({ project: "ops" });
  assert.equal(r.status, 422);
  assert.deepEqual(r.body.options.map((o) => o.args.project).sort(), ["OPS", "Operations"]);
  assert.equal((await api("GET", "/api/w/t/tasks?project=ops")).status, 422);
  const ok = await create({ project: "ops", ...r.body.options.find((o) => o.args.project === "Operations").args });
  assert.equal(ok.status, 201);
  assert.match(ok.body.id, /^OPS-\d+$/);
});

test("no title: asks, offering the description's first line", async () => {
  const r = await create({ project: "bm", title: "", notes: "## Fix login redirect\nmore detail" });
  assert.equal(r.status, 422);
  assert.equal(r.body.answerArg, "title");
  assert.deepEqual(r.body.options.map((o) => o.args), [{ title: "Fix login redirect" }]);
  assert.equal((await create({ project: "bm", title: undefined })).body.options.length, 0);
  const ok = await create({ project: "bm", notes: "x", ...r.body.options[0].args });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.title, "Fix login redirect");
});

test("create project without prefix: asks with suggestions (D15), never invents one", async () => {
  const r = await api("POST", "/api/w/t/projects", { name: "Data Pipeline" });
  assert.equal(r.status, 422);
  assert.equal(r.body.answerArg, "prefix");
  assert.deepEqual(r.body.options.map((o) => o.args.prefix), ["DP", "DA", "DAT"]);
  const ok = await api("POST", "/api/w/t/projects", r.body.options[0].args);
  assert.equal(ok.status, 201);
  assert.equal(ok.body.prefix, "DP");
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
  assert.ok(text.split("\n").filter(Boolean).length <= 8);
  for (const kw of ["create_task", "list_projects", "in_progress", "notes", "agent", "NEEDS USER INPUT", "AskUserQuestion", "request_user_input", "ask_user"]) {
    assert.ok(text.includes(kw), kw);
  }
});

test("MCP: aliases pass the schema; unknown project -> NEEDS USER INPUT, answer creates the ticket", async () => {
  const args = { workspace: "t", title: "mcp", project: "BM", status: "進行中", priority: "高" };
  const ok = await rpc("tools/call", { name: "create_task", arguments: args });
  assert.ok(!ok.isError, ok.content[0].text);
  const task = JSON.parse(ok.content[0].text);
  assert.equal(task.status, "in_progress");
  assert.equal(task.priority, "high");

  const ask = await rpc("tools/call", { name: "create_task", arguments: { ...args, project: "Launch Prep" } });
  assert.ok(!ask.isError, "asking is not an error");
  assert.match(ask.content[0].text, /^NEEDS USER INPUT/);
  assert.match(ask.content[0].text, /call create_task again/);
  const { needs_input } = JSON.parse(ask.content[1].text);
  assert.ok(needs_input.question && needs_input.options.length <= 4);
  const pick = needs_input.options.find((o) => o.args.newProjectPrefix);
  const done = await rpc("tools/call", { name: "create_task", arguments: { ...args, ...pick.args } });
  assert.ok(!done.isError, done.content[0].text);
  assert.equal(JSON.parse(done.content[0].text).projectPrefix, pick.args.newProjectPrefix);
});

const setAsk = (ask) => api("PUT", "/api/config", { ask });

test("MCP: create_project without prefix asks; set_ask_mode changes the global setting", async () => {
  const ask = await rpc("tools/call", { name: "create_project", arguments: { workspace: "t", name: "Mobile" } });
  assert.match(ask.content[0].text, /^NEEDS USER INPUT/);
  assert.match(ask.content[0].text, /"prefix"/);
  try {
    const set = await rpc("tools/call", { name: "set_ask_mode", arguments: { mode: "off" } });
    assert.equal(JSON.parse(set.content[0].text).ask, "off");
    assert.equal((await api("GET", "/api/w/t/config")).body.ask, "off"); // workspace-prefixed path too (the mod uses it)
    const bad = await rpc("tools/call", { name: "create_project", arguments: { workspace: "t", name: "Mobile" } });
    assert.ok(bad.isError);
    assert.match(bad.content[0].text, /prefix is required.*e\.g\. MO/);
  } finally {
    await setAsk("on");
  }
  assert.equal((await setAsk("maybe")).status, 400);
});

test("an answer is remembered: the same word resolves next time; forget undoes it", async () => {
  await api("POST", "/api/workspaces", { name: "mem" });
  await api("POST", "/api/w/mem/projects", { name: "OPS", prefix: "OP" });
  await api("POST", "/api/w/mem/projects", { name: "Operations", prefix: "OPS" });
  const q = await create({ project: "ops" }, "mem");
  const pick = q.body.options.find((o) => o.args.project === "Operations");
  assert.equal(pick.args.rememberAs, "ops");
  const ok = await create({ project: "ops", ...pick.args }, "mem");
  assert.equal(ok.status, 201);
  assert.match(ok.body.notes, /remembered "ops" → Operations/);
  const again = await create({ project: " Ops " }, "mem"); // trimmed + case-insensitive, but not the exact name "OPS"
  assert.equal(again.status, 201);
  assert.equal(again.body.project, "Operations");
  assert.equal((await create({ project: "OPS" }, "mem")).body.project, "OPS"); // an exact name still wins
  assert.deepEqual((await api("GET", "/api/w/mem/projects")).body.find((p) => p.name === "Operations").aliases, ["ops"]);
  assert.equal((await api("DELETE", "/api/w/mem/projects/aliases/OPS")).status, 204);
  assert.equal((await create({ project: "ops" }, "mem")).status, 422);
});

test("ask new/off: the board picks the busiest project and marks the ticket unconfirmed", async () => {
  await api("POST", "/api/workspaces", { name: "auto" });
  await api("POST", "/api/w/auto/projects", { name: "OPS", prefix: "OP" });
  await api("POST", "/api/w/auto/projects", { name: "Operations", prefix: "OPS" });
  await create({ project: "Operations" }, "auto");
  try {
    await setAsk("new");
    const r = await create({ project: "ops", agent: "codex" }, "auto");
    assert.equal(r.status, 201);
    assert.equal(r.body.project, "Operations"); // 1 ticket vs 0
    assert.match(r.body.unconfirmed, /matched OPS, Operations; picked Operations/);
    assert.match(r.body.notes, /⚠ unconfirmed/);
    const t = await create({ project: "Operations", title: "", notes: "## Renew domain\nbody" }, "auto");
    assert.equal(t.body.title, "Renew domain");
    assert.match(t.body.unconfirmed, /first line/);
    assert.equal((await create({ project: "Brand New" }, "auto")).status, 422); // new project: still asks (D15)
    const cleared = await api("PATCH", `/api/w/auto/tasks/${r.body.id}`, { unconfirmed: null });
    assert.equal(cleared.body.unconfirmed, null);

    await setAsk("off");
    assert.equal((await create({ project: "ops" }, "auto")).body.project, "Operations");
    assert.equal((await create({ project: "Brand New" }, "auto")).status, 404); // never auto-created
    assert.equal((await api("POST", "/api/w/auto/projects", { name: "Brand New" })).status, 400);
  } finally {
    await setAsk("on");
  }
});

function cli(...argv) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(src, "cli.js"), ...argv, "--workspace=t"], {
      env: { ...process.env, AGENT_BOARD_URL: base, AGENT_BOARD_DIR: dir },
    });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("exit", (code) => resolve({ code, err }));
  });
}

test("CLI: prints the same question + rerun flags, exits 2; config ask off -> plain error, exit 1", async () => {
  const r = await cli("create", "--project=準備發表會");
  assert.equal(r.code, 2);
  assert.match(r.err, /needs your input — This workspace has no project "準備發表會"/);
  assert.match(r.err, /rerun with: --project="發表會" --remember-as="準備發表會"/);
  assert.match(r.err, /--new-project-prefix="PRJ"/);
  const t = await cli("create", "--project=bm");
  assert.equal(t.code, 2);
  assert.match(t.err, /--title="\.\.\."/);
  try {
    const set = await cli("config", "ask", "off");
    assert.equal(set.code, 0);
    const off = await cli("project", "create", "Tablet");
    assert.equal(off.code, 1);
    assert.match(off.err, /prefix is required/);
  } finally {
    await setAsk("on");
  }
});

test("CLI: unknown project on list is still a hint, suggesting project create", async () => {
  const r = await cli("list", "--project=準備發表會");
  assert.equal(r.code, 1);
  assert.match(r.err, /Existing projects:/);
  assert.match(r.err, /agent-board project create "準備發表會" --prefix=<PREFIX>/);
  assert.ok(!r.err.includes("POST /api/projects"));
});

test("aliases registered up front: create with aliases, add more, clashes refused, word opens tickets", async () => {
  await api("POST", "/api/workspaces", { name: "al" });
  const p = await api("POST", "/api/w/al/projects", { name: "Launch", prefix: "LA", aliases: "準備發表會, 發表會" });
  assert.equal(p.status, 201);
  assert.deepEqual(p.body.aliases.sort(), ["準備發表會", "發表會"].sort());
  // another project's name/prefix, or a word that already means another project: 409, and no half-made project
  await api("POST", "/api/w/al/projects", { name: "Ops", prefix: "OP" });
  assert.equal((await api("POST", "/api/w/al/projects", { name: "X", prefix: "XX", aliases: ["op"] })).status, 409);
  assert.equal((await api("POST", "/api/w/al/projects", { name: "X", prefix: "XX", aliases: ["發表會"] })).status, 409);
  assert.ok(!(await api("GET", "/api/w/al/projects")).body.some((q) => q.name === "X"));
  const add = await api("POST", "/api/w/al/projects/Ops/aliases", { aliases: ["維運", "ops"] });
  assert.equal(add.status, 201);
  assert.deepEqual(add.body.added, ["維運"]); // own name skipped
  assert.equal((await api("POST", "/api/w/al/projects/Ops/aliases", { alias: "launch" })).status, 409);
  const t = await create({ project: "準備發表會" }, "al");
  assert.equal(t.status, 201);
  assert.equal(t.body.project, "Launch");
});
