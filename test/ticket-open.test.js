import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

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

after(async () => {
  // wait for the server to exit before removing its data dir: on Windows its open SQLite files can't be deleted
  if (child && child.exitCode === null) await new Promise((r) => { child.once("exit", r); child.kill(); });
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

test("an answer that is the project's own name, ignoring case, is still remembered (#21)", async () => {
  await api("POST", "/api/workspaces", { name: "mem2" });
  await api("POST", "/api/w/mem2/projects", { name: "Beta", prefix: "BE" });
  await api("POST", "/api/w/mem2/projects", { name: "Other", prefix: "BETA" });
  const q = await create({ project: "beta" }, "mem2"); // Beta's name and Other's prefix
  assert.equal(q.status, 422);
  const pick = q.body.options.find((o) => o.args.project === "Beta");
  const ok = await create({ project: "beta", ...pick.args }, "mem2");
  assert.equal(ok.status, 201);
  assert.match(ok.body.notes, /remembered "beta" → Beta/);
  assert.equal((await create({ project: "beta" }, "mem2")).body.project, "Beta"); // no second question
  assert.equal((await create({ project: "Beta" }, "mem2")).body.notes, null); // exact name: nothing to remember

  // the same through move
  await api("POST", "/api/w/mem2/projects", { name: "Gamma", prefix: "GA" });
  await api("POST", "/api/w/mem2/projects", { name: "Misc", prefix: "GAMMA" });
  const t = (await create({ project: "Beta" }, "mem2")).body;
  const mq = await api("POST", `/api/w/mem2/tasks/${t.id}/move`, { project: "gamma" });
  assert.equal(mq.status, 422);
  const mpick = mq.body.options.find((o) => o.args.project === "Gamma");
  assert.equal((await api("POST", `/api/w/mem2/tasks/${t.id}/move`, { project: "gamma", ...mpick.args })).status, 200);
  assert.deepEqual((await api("GET", "/api/w/mem2/projects")).body.find((p) => p.name === "Gamma").aliases, ["gamma"]);
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
    let out = "";
    p.stderr.on("data", (d) => (err += d));
    p.stdout.on("data", (d) => (out += d));
    p.on("exit", (code) => resolve({ code, err, out }));
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

// ---- parent / subtask rules (two levels, same project) — the server enforces them for every client

async function subtaskBoard(ws) {
  await api("POST", "/api/workspaces", { name: ws });
  await api("POST", `/api/w/${ws}/projects`, { name: "Alpha", prefix: "AL" });
  await api("POST", `/api/w/${ws}/projects`, { name: "Beta", prefix: "BE" });
  return (await create({ project: "Alpha", status: "in_progress" }, ws)).body;
}

test("subtasks: project comes from the parent; two levels, existing parent, same project enforced on create", async () => {
  const P = await subtaskBoard("sub1");
  const child = await create({ parentId: P.id }, "sub1");
  assert.equal(child.status, 201);
  assert.equal(child.body.project, "Alpha");
  assert.equal(child.body.parentId, P.id);

  const grandchild = await create({ parentId: child.body.id }, "sub1");
  assert.equal(grandchild.status, 409);
  assert.equal(grandchild.body.code, "parent_is_subtask");
  const missing = await create({ parentId: "AL-99" }, "sub1");
  assert.equal(missing.status, 400);
  assert.equal(missing.body.code, "parent_not_found");

  // parent in another project: asked (never guessed), and with asking off, refused
  const cross = await create({ project: "Beta", parentId: P.id }, "sub1");
  assert.equal(cross.status, 422);
  assert.equal(cross.body.code, "needs_input");
  assert.deepEqual(cross.body.options.map((o) => o.args), [
    { project: "Alpha", parentId: P.id },
    { project: "Beta", parentId: null },
  ]);
  const answered = await create({ project: "Beta", parentId: null }, "sub1");
  assert.equal(answered.status, 201);
  assert.equal(answered.body.parentId, null);
  try {
    await setAsk("off");
    const off = await create({ project: "Beta", parentId: P.id }, "sub1");
    assert.equal(off.status, 400);
    assert.equal(off.body.code, "parent_other_project");
  } finally {
    await setAsk("on");
  }
});

test("subtasks: re-parenting via PATCH is checked, logged, and an unchanged parentId is a no-op", async () => {
  const P = await subtaskBoard("sub2");
  const kid = (await create({ parentId: P.id }, "sub2")).body;
  const loose = (await create({ project: "Alpha" }, "sub2")).body;
  const beta = (await create({ project: "Beta" }, "sub2")).body;
  const patch = (id, b) => api("PATCH", `/api/w/sub2/tasks/${id}`, b);

  assert.equal((await patch(loose.id, { parentId: loose.id })).body.code, "self_parent");
  const parentWithKids = await patch(P.id, { parentId: loose.id });
  assert.equal(parentWithKids.status, 409);
  assert.equal(parentWithKids.body.code, "has_subtasks");
  assert.deepEqual(parentWithKids.body.subtasks, [kid.id]);
  assert.equal((await patch(loose.id, { parentId: kid.id })).body.code, "parent_is_subtask");
  assert.equal((await patch(beta.id, { parentId: P.id })).body.code, "parent_other_project");

  const attached = await patch(loose.id, { parentId: P.id });
  assert.equal(attached.status, 200);
  assert.equal(attached.body.parentId, P.id);
  assert.match(attached.body.notes, new RegExp(`parentId: – → ${P.id}`));
  // a whole card sent back with the same parentId (older clients) passes without re-checking
  assert.equal((await patch(loose.id, { ...attached.body, title: "renamed" })).status, 200);

  assert.equal((await patch(loose.id, { parentId: null })).body.parentId, null);
  assert.equal((await patch(kid.id, { parentId: "" })).body.parentId, null);
});

test("subtasks: progress on every task; the all-done hint never changes the parent's status", async () => {
  const P = await subtaskBoard("sub3");
  const a = (await create({ parentId: P.id }, "sub3")).body;
  const b = (await create({ parentId: P.id }, "sub3")).body;
  const patch = (id, body) => api("PATCH", `/api/w/sub3/tasks/${id}`, body);
  const get = async (id) => (await api("GET", "/api/w/sub3/tasks")).body.find((t) => t.id === id);

  const before = await get(P.id);
  assert.deepEqual([before.subtaskCount, before.subtasksDone], [2, 0]);
  assert.equal((await patch(a.id, { status: "done" })).body.hint, undefined);
  const last = await patch(b.id, { status: "done" });
  assert.match(last.body.hint, new RegExp(`All 2 subtasks of ${P.id} are done`));
  const parent = await get(P.id);
  assert.equal(parent.status, "in_progress");
  assert.deepEqual([parent.subtaskCount, parent.subtasksDone], [2, 2]);
  assert.equal((await patch(b.id, { title: "again" })).body.hint, undefined);
});

test("subtasks: a parent can't be deleted while it has subtasks — JSON 409 listing them", async () => {
  const P = await subtaskBoard("sub4");
  const kid = (await create({ parentId: P.id }, "sub4")).body;
  const blocked = await fetch(`${base}/api/w/sub4/tasks/${P.id}`, { method: "DELETE" });
  assert.equal(blocked.status, 409);
  assert.match(blocked.headers.get("content-type"), /json/);
  const body = await blocked.json();
  assert.equal(body.code, "has_subtasks");
  assert.deepEqual(body.subtasks, [kid.id]);
  await api("PATCH", `/api/w/sub4/tasks/${kid.id}`, { parentId: null });
  assert.equal((await api("DELETE", `/api/w/sub4/tasks/${P.id}`)).status, 204);
});

test("errors are always JSON: bad JSON body, unknown /api path", async () => {
  const bad = await fetch(`${base}/api/w/t/tasks`, { method: "POST", headers: { "content-type": "application/json" }, body: "{oops" });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).code, "bad_json");
  const nope = await fetch(`${base}/api/nope`);
  assert.equal(nope.status, 404);
  assert.match(nope.headers.get("content-type"), /json/);
});

// ---- ticket ids are never handed out twice

test("ids: deleting the newest ticket doesn't free its number; a re-prefixed project keeps counting", async () => {
  await api("POST", "/api/workspaces", { name: "ids" });
  await api("POST", "/api/w/ids/projects", { name: "Web", prefix: "WB" });
  for (let i = 0; i < 3; i++) await create({ project: "Web" }, "ids");
  assert.equal((await api("DELETE", "/api/w/ids/tasks/WB-3")).status, 204);
  assert.equal((await create({ project: "Web" }, "ids")).body.id, "WB-4");

  // WB -> XY: new tickets continue after WB's numbers; a later project taking WB can't reissue them
  assert.equal((await api("PATCH", "/api/w/ids/projects/Web", { prefix: "XY" })).status, 200);
  assert.equal((await create({ project: "Web" }, "ids")).body.id, "XY-5");
  await api("POST", "/api/w/ids/projects", { name: "Web2", prefix: "WB" });
  assert.equal((await create({ project: "Web2" }, "ids")).body.id, "WB-5");
});

test("ids: an existing board is backfilled from its tickets the first time the new server opens it", async () => {
  // a board from before id_counters: MG-1, MG-2, and a ticket re-prefixed from OLD to MG with seq 5
  const wsDir = path.join(dir, "workspaces", "legacy");
  fs.mkdirSync(wsDir, { recursive: true });
  const db = new Database(path.join(wsDir, "tasks.db"));
  db.exec(`CREATE TABLE projects (name TEXT PRIMARY KEY, prefix TEXT UNIQUE NOT NULL, createdAt INTEGER);
    CREATE TABLE tasks (id TEXT PRIMARY KEY, seq INTEGER NOT NULL, title TEXT NOT NULL, project TEXT, projectPrefix TEXT,
      parentId TEXT REFERENCES tasks(id), agent TEXT, priority TEXT, status TEXT, notes TEXT, worktree TEXT, branch TEXT,
      link TEXT, dueDate TEXT, createdAt INTEGER, updatedAt INTEGER);
    INSERT INTO projects VALUES ('Migrated', 'MG', 0);
    INSERT INTO tasks (id, seq, title, project, projectPrefix, status, createdAt) VALUES
      ('MG-1', 1, 'a', 'Migrated', 'MG', 'backlog', 1), ('MG-2', 2, 'b', 'Migrated', 'MG', 'backlog', 2),
      ('OLD-5', 5, 'c', 'Migrated', 'MG', 'backlog', 3);`);
  db.close();
  const next = await create({ project: "Migrated" }, "legacy");
  assert.equal(next.status, 201);
  assert.equal(next.body.id, "MG-6");
});

// ---- the same rules through the CLI and MCP

test("CLI: subtasks listed under their parent with progress; --parent=none detaches; empty --parent refused", async () => {
  await api("POST", "/api/w/t/projects", { name: "Subtasks", prefix: "ST" });
  const P = (await create({ project: "Subtasks" })).body;
  const made = await cli("create", "--title=child", `--parent=${P.id}`);
  assert.equal(made.code, 0);
  assert.match(made.out, new RegExp(`subtask of ${P.id}`));
  const kid = made.out.match(/created (\S+)/)[1];
  const list = await cli("list", "--project=Subtasks");
  assert.match(list.out, new RegExp(`${P.id} .*\\[0/1 done\\]`));
  assert.match(list.out, new RegExp(`\\n  ↳ ${kid} `));
  const done = await cli("update", kid, "--status=done");
  assert.match(done.out, /note: The only subtask/);

  const blocked = await cli("delete", P.id);
  assert.equal(blocked.code, 1);
  assert.match(blocked.err, /409 .*has 1 subtask/);
  assert.match(blocked.err, new RegExp(`agent-board update ${kid} --parent=none`));
  assert.ok(!blocked.err.includes("reach the server"));

  const empty = await cli("update", kid, "--parent=");
  assert.equal(empty.code, 1);
  assert.match(empty.err, /--parent needs a ticket id/);
  assert.equal((await cli("update", kid, "--parent=none")).code, 0);
  assert.equal((await cli("delete", P.id)).code, 0);
});

test("MCP: update_task moves/detaches a parent; hint comes first; delete_task names the subtasks", async () => {
  await api("POST", "/api/w/t/projects", { name: "McpSub", prefix: "MS" });
  const call = (name, args) => rpc("tools/call", { name, arguments: { workspace: "t", ...args } });
  const last = (r) => JSON.parse(r.content.at(-1).text);
  const P = last(await call("create_task", { title: "parent", project: "McpSub" }));
  const kid = last(await call("create_task", { title: "kid", parentId: P.id }));
  assert.equal(kid.project, "McpSub");

  const done = await call("update_task", { taskId: kid.id, status: "done" });
  assert.match(done.content[0].text, /^Note: The only subtask/);
  const del = await call("delete_task", { taskId: P.id });
  assert.equal(del.isError, true);
  assert.match(del.content[0].text, new RegExp(`${kid.id}.*update_task with taskId ${kid.id} and parentId null`));

  assert.equal(last(await call("update_task", { taskId: kid.id, parentId: null })).parentId, null);
  assert.equal(last(await call("update_task", { taskId: kid.id, parentId: P.id })).parentId, P.id);
  assert.equal(last(await call("update_task", { taskId: kid.id, parentId: "none" })).parentId, null);
});

// ---- moving a ticket to another project (Jira's "Move"): new id, subtasks along, old ids keep working

test("move: new id in the target project, subtasks come along under it, history says where from", async () => {
  await api("POST", "/api/w/t/projects", { name: "MoveFrom", prefix: "MF" });
  await api("POST", "/api/w/t/projects", { name: "MoveTo", prefix: "MT" });
  const P = (await create({ project: "MoveFrom", title: "parent" })).body;
  const k1 = (await create({ parentId: P.id, title: "kid 1" })).body;
  const k2 = (await create({ parentId: P.id, title: "kid 2", status: "done" })).body;

  const r = await api("POST", `/api/w/t/tasks/${P.id}/move`, { project: "mt", agent: "claude" });
  assert.equal(r.status, 200);
  assert.match(r.body.id, /^MT-\d+$/);
  assert.equal(r.body.project, "MoveTo");
  assert.equal(r.body.movedFrom, P.id);
  assert.deepEqual(r.body.moved.map((m) => m.from), [P.id, k1.id, k2.id]);
  assert.match(r.body.hint, new RegExp(`${P.id} is now ${r.body.id} in MoveTo\\. Its subtasks moved too: ${k1.id} → MT-\\d+, ${k2.id} → MT-\\d+`));
  assert.equal(r.body.subtaskCount, 2);
  assert.equal(r.body.subtasksDone, 1);
  const kids = (await api("GET", `/api/w/t/tasks?parentId=${r.body.id}`)).body;
  assert.deepEqual(kids.map((k) => k.id), r.body.moved.slice(1).map((m) => m.to));
  assert.ok(kids.every((k) => k.project === "MoveTo" && k.projectPrefix === "MT"));
  assert.match(kids[0].notes, new RegExp(`moved from ${k1.id} \\(MoveFrom → MoveTo\\)$`));

  // the parentId foreign key survived the renumbering
  const db = new Database(path.join(dir, "workspaces", "t", "tasks.db"), { readonly: true });
  try { assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []); } finally { db.close(); }
});

test("move: old ids keep working everywhere (and say the new one); a second move repoints them; delete forgets them", async () => {
  await api("POST", "/api/w/t/projects", { name: "Alias A", prefix: "AA" });
  await api("POST", "/api/w/t/projects", { name: "Alias B", prefix: "AZ" });
  const P = (await create({ project: "Alias A" })).body;
  const kid = (await create({ parentId: P.id })).body;
  const first = (await api("POST", `/api/w/t/tasks/${P.id}/move`, { project: "Alias B" })).body;
  const newKid = first.moved[1].to;

  const got = await api("GET", `/api/w/t/tasks/${P.id}`);
  assert.equal(got.status, 200);
  assert.equal(got.body.id, first.id);
  assert.match(got.body.hint, new RegExp(`${P.id} is now ${first.id} \\(it moved projects\\)`));
  const patched = await api("PATCH", `/api/w/t/tasks/${kid.id}`, { note: "still works" });
  assert.equal(patched.body.id, newKid);
  assert.match(patched.body.hint, new RegExp(`${kid.id} is now ${newKid}`));
  assert.deepEqual((await api("GET", `/api/w/t/tasks?parentId=${P.id}`)).body.map((t) => t.id), [newKid]);
  // a new subtask can name the parent by its old id; it's stored under the current one
  assert.equal((await create({ parentId: P.id })).body.parentId, first.id);

  const second = (await api("POST", `/api/w/t/tasks/${first.id}/move`, { project: "Alias A" })).body;
  assert.equal((await api("GET", `/api/w/t/tasks/${P.id}`)).body.id, second.id); // straight to the latest, no chain
  assert.match(second.id, /^AA-\d+$/);
  assert.notEqual(second.id, P.id); // the old number isn't handed back

  // moving it back needs its subtasks gone first only to delete it — detach them, then delete
  for (const t of (await api("GET", `/api/w/t/tasks?parentId=${second.id}`)).body) await api("DELETE", `/api/w/t/tasks/${t.id}`);
  assert.equal((await api("DELETE", `/api/w/t/tasks/${P.id}`)).status, 204); // by its first id
  assert.equal((await api("GET", `/api/w/t/tasks/${P.id}`)).status, 404);
  assert.equal((await api("GET", `/api/w/t/tasks/${second.id}`)).status, 404);
});

test("move: a subtask moves alone only with detach; same project, unknown project and a new project", async () => {
  await api("POST", "/api/w/t/projects", { name: "Detach From", prefix: "DF" });
  await api("POST", "/api/w/t/projects", { name: "Detach To", prefix: "DT" });
  const P = (await create({ project: "Detach From" })).body;
  const kid = (await create({ parentId: P.id, status: "in_progress" })).body;
  const done = (await create({ parentId: P.id, status: "done" })).body;

  const blocked = await api("POST", `/api/w/t/tasks/${kid.id}/move`, { project: "Detach To" });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.code, "is_subtask");
  assert.equal(blocked.body.parentId, P.id);
  const alone = await api("POST", `/api/w/t/tasks/${kid.id}/move`, { project: "Detach To", detach: true });
  assert.equal(alone.status, 200);
  assert.equal(alone.body.parentId, null);
  assert.match(alone.body.notes, new RegExp(`parentId: ${P.id} → –`));
  assert.match(alone.body.hint, new RegExp(`The only subtask of ${P.id} is done`)); // what's left of the old parent

  const same = await api("POST", `/api/w/t/tasks/${P.id}/move`, { project: "detach from" });
  assert.equal(same.status, 400);
  assert.equal(same.body.code, "same_project");
  const unknown = await api("POST", `/api/w/t/tasks/${P.id}/move`, { project: "Brand New Place" });
  assert.equal(unknown.status, 422);
  assert.equal(unknown.body.code, "needs_input");
  const pick = unknown.body.options.find((o) => o.args.newProjectPrefix);
  const created = await api("POST", `/api/w/t/tasks/${P.id}/move`, { project: "Brand New Place", ...pick.args });
  assert.equal(created.status, 200);
  assert.equal(created.body.project, "Brand New Place");
  assert.equal(created.body.projectPrefix, pick.args.newProjectPrefix);
  assert.equal(created.body.moved.length, 2); // the parent and the subtask still under it
  assert.equal((await api("POST", `/api/w/t/tasks/${done.id}/move`, {})).status, 400); // no project given
});

test("CLI move + MCP move_task: old → new printed, subtask needs --detach / detach", async () => {
  await api("POST", "/api/w/t/projects", { name: "CliMove", prefix: "CM" });
  await api("POST", "/api/w/t/projects", { name: "CliTarget", prefix: "CT" });
  const P = (await create({ project: "CliMove" })).body;
  const kid = (await create({ parentId: P.id })).body;

  const sub = await cli("move", kid.id, "--project=CliTarget");
  assert.equal(sub.code, 1);
  assert.match(sub.err, new RegExp(`409 .*agent-board move ${P.id} --project=<name> — or this one alone: add --detach`));
  const moved = await cli("move", P.id, "--project=CliTarget");
  assert.equal(moved.code, 0);
  assert.match(moved.out, new RegExp(`moved ${P.id} → CT-\\d+\\nmoved ${kid.id} → CT-\\d+`));
  assert.match(moved.out, /note: .* is now CT-\d+ in CliTarget/);
  const noted = await cli("note", kid.id, "by the old id");
  assert.match(noted.out, new RegExp(`noted CT-\\d+\\nnote: ${kid.id} is now CT-\\d+`));

  const call = (name, args) => rpc("tools/call", { name, arguments: { workspace: "t", ...args } });
  const back = await call("move_task", { taskId: P.id, project: "CliMove" });
  assert.match(back.content[0].text, new RegExp(`^Note: ${P.id} \\(later CT-\\d+\\) is now CM-\\d+ in CliMove`));
  const lone = await call("move_task", { taskId: kid.id, project: "CliTarget" });
  assert.equal(lone.isError, true);
  assert.match(lone.content[0].text, /move_task with taskId CM-\d+ — or this one alone: detach true/);
});
