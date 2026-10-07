import { Router } from "express";
import { createTask, appendNote, insertProject } from "../db.js";
import { normalizeEnum, needsInput, resolveProject } from "../normalize.js";

const router = Router();

router.get("/", (req, res) => {
  const { project, status, parentId } = req.query;
  const clauses = [];
  const params = [];
  if (project) {
    const r = resolveProject(req.db, project);
    if (r.body) return res.status(r.status).json(r.body);
    clauses.push("project = ?"); params.push(r.project.name);
  }
  if (status) {
    const n = normalizeEnum("status", status);
    if (n.error) return res.status(400).json({ error: n.error });
    clauses.push("status = ?"); params.push(n.value);
  }
  if (parentId) { clauses.push("parentId = ?"); params.push(parentId); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  res.json(req.db.prepare(`SELECT * FROM tasks ${where} ORDER BY createdAt`).all(...params));
});

router.post("/", (req, res) => {
  const { title, project, parentId, agent, priority, status, notes, worktree, branch, link, dueDate } = req.body;
  if (!project) return res.status(400).json({ error: "project is required" });
  // newProjectPrefix: the user picked "new project" from a needs_input option
  const newPrefix = typeof req.body.newProjectPrefix === "string" ? req.body.newProjectPrefix.trim() : "";
  const resolved = resolveProject(req.db, project, { offerNew: !newPrefix });
  if (resolved.body && !(newPrefix && resolved.body.code === "unknown_project")) {
    return res.status(resolved.status).json(resolved.body);
  }
  if (!title || !String(title).trim()) {
    const first = String(notes || "").split("\n").map((l) => l.replace(/^[#>*\-\s]+/, "").trim()).find(Boolean);
    const suggestion = first && first.slice(0, 80);
    const r = needsInput(
      "What should the ticket's title be?",
      suggestion ? [{ label: suggestion, description: "first line of the description", args: { title: suggestion } }] : [],
      "title"
    );
    return res.status(r.status).json(r.body);
  }
  const norm = {};
  for (const [field, v] of [["priority", priority], ["status", status]]) {
    if (!v) continue;
    const n = normalizeEnum(field, v);
    if (n.error) return res.status(400).json({ error: n.error });
    norm[field] = n.value;
  }
  let projectRow = resolved.project;
  if (!projectRow) {
    const created = insertProject(req.db, String(project).trim(), newPrefix);
    if (created.body) return res.status(created.status).json(created.body);
    projectRow = created.project;
  }
  const row = createTask(req.db, {
    title,
    project: projectRow.name,
    projectPrefix: projectRow.prefix,
    parentId: parentId || null,
    agent: agent || null,
    priority: norm.priority || "med",
    status: norm.status || "backlog",
    notes: notes || null,
    worktree: worktree || null,
    branch: branch || null,
    link: link || null,
    dueDate: dueDate || null,
  });
  res.status(201).json(row);
});

// "notes" (plural, matches the column) = full overwrite — used by the UI's
// free-edit Description box. "note" (singular verb) = append a timestamped
// line — used by the CLI/MCP `note` command so multiple sessions/agents
// leaving notes over time don't stomp on each other's history.
const MUTABLE_FIELDS = ["title", "agent", "priority", "status", "worktree", "branch", "link", "dueDate", "notes"];

// fields worth an automatic history line: the ones two agents are most
// likely to race on (claiming/reprioritizing a ticket at the same moment).
// This doesn't prevent the race — the column still just holds whichever
// write landed last — but it makes a collision visible after the fact
// instead of silently disappearing.
const TRACKED_FIELDS = ["status", "agent", "priority"];

router.patch("/:id", (req, res) => {
  const existing = req.db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "task not found" });

  for (const field of ["status", "priority"]) {
    if (req.body[field] === undefined) continue;
    const n = normalizeEnum(field, req.body[field]);
    if (n.error) return res.status(400).json({ error: n.error });
    req.body[field] = n.value;
  }
  // `project` in a PATCH body is ignored (the web UI sends the whole card); tasks can't move projects.

  const sets = [];
  const params = [];
  for (const field of MUTABLE_FIELDS) {
    if (req.body[field] !== undefined) {
      sets.push(`${field} = ?`);
      params.push(req.body[field]);
    }
  }
  if (sets.length) {
    sets.push("updatedAt = ?");
    params.push(Date.now());
    params.push(req.params.id);
    req.db.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  }

  const changes = TRACKED_FIELDS
    .filter((f) => req.body[f] !== undefined && req.body[f] !== existing[f])
    .map((f) => `${f}: ${existing[f] ?? "–"} → ${req.body[f]}`);
  if (changes.length) appendNote(req.db, req.params.id, changes.join(", "), req.body.agent);

  let row = req.db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id);
  if (req.body.note !== undefined) {
    row = appendNote(req.db, req.params.id, req.body.note, req.body.agent);
  }
  res.json(row);
});

router.delete("/:id", (req, res) => {
  const result = req.db.prepare("DELETE FROM tasks WHERE id = ?").run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "task not found" });
  res.status(204).end();
});

export default router;
