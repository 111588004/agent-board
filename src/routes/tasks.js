import { Router } from "express";
import {
  createTask, appendNote, insertProject, getConfig, getTask, TASK_SELECT, checkParent, subtaskIds, allDoneHint,
  resolveTaskId, movedHint, moveTask, forgetTaskAliases,
} from "../db.js";
import { normalizeEnum, normalizeDueDate, needsInput, resolveProject } from "../normalize.js";

const router = Router();

// every task carries subtaskCount/subtasksDone (see TASK_SELECT); a parent's progress is shown, never acted on
router.get("/", (req, res) => {
  const { project, status, parentId } = req.query;
  const clauses = [];
  const params = [];
  if (project) {
    const r = resolveProject(req.db, project, { ask: getConfig().ask });
    if (r.body) return res.status(r.status).json(r.body);
    clauses.push("t.project = ?"); params.push(r.project.name);
  }
  if (status) {
    const n = normalizeEnum("status", status);
    if (n.error) return res.status(400).json({ error: n.error });
    clauses.push("t.status = ?"); params.push(n.value);
  }
  if (parentId) { clauses.push("t.parentId = ?"); params.push(resolveTaskId(req.db, parentId)?.id || parentId); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  res.json(req.db.prepare(`${TASK_SELECT} ${where} ORDER BY t.createdAt`).all(...params));
});

const withHint = (row, ...hints) => {
  const hint = hints.filter(Boolean).join(" ");
  return hint ? { ...row, hint } : row;
};

// every /:id route: an id a moved ticket left behind (task_aliases) reaches the ticket, and the reply says
// its current id. req.taskId is the id to use; req.movedHint is set when the caller used an old one.
router.param("id", (req, res, next, id) => {
  const r = resolveTaskId(req.db, id);
  req.taskId = r ? r.id : id;
  req.movedHint = r && r.movedFrom ? movedHint(r.movedFrom, r.id) : undefined;
  next();
});

router.get("/:id", (req, res) => {
  const row = getTask(req.db, req.taskId);
  if (!row) return res.status(404).json({ error: `there's no task ${req.params.id}`, code: "not_found" });
  res.json(withHint(row, req.movedHint));
});

router.post("/", (req, res) => {
  const { parentId, agent, priority, status, notes, worktree, branch, link, dueDate, rememberAs } = req.body;
  let { project, title } = req.body;

  // a subtask: check the parent first (two levels only), and with no project given, use the parent's —
  // a subtask lives in its parent's project, so that's derived, not guessed
  let parent = null;
  const wantedParent = parentId ? String(parentId).trim() : "";
  if (wantedParent) {
    const c = checkParent(req.db, {}, wantedParent);
    if (c.status) return res.status(c.status).json(c.body);
    parent = c.parent;
    if (!project) project = parent.project;
  }

  if (!project) return res.status(400).json({ error: "project is required" });
  const { ask } = getConfig();
  // newProjectPrefix: the user picked "new project" from a needs_input option
  const newPrefix = typeof req.body.newProjectPrefix === "string" ? req.body.newProjectPrefix.trim() : "";
  const resolved = resolveProject(req.db, project, { offerNew: !newPrefix, ask });
  if (resolved.body && !(newPrefix && resolved.body.code === "unknown_project")) {
    return res.status(resolved.status).json(resolved.body);
  }
  const unconfirmed = resolved.picked ? [resolved.picked] : [];
  if (!title || !String(title).trim()) {
    const first = String(notes || "").split("\n").map((l) => l.replace(/^[#>*\-\s]+/, "").trim()).find(Boolean);
    const suggestion = first && first.slice(0, 80);
    if (ask === "on") {
      const r = needsInput(
        "What should the ticket's title be?",
        suggestion ? [{ label: suggestion, description: "first line of the description", args: { title: suggestion } }] : [],
        "title"
      );
      return res.status(r.status).json(r.body);
    }
    title = suggestion || "(untitled)";
    unconfirmed.push(`no title given; used ${suggestion ? "the description's first line" : '"(untitled)"'}`);
  }
  const norm = {};
  for (const [field, v] of [["priority", priority], ["status", status]]) {
    if (!v) continue;
    const n = normalizeEnum(field, v);
    if (n.error) return res.status(400).json({ error: n.error });
    norm[field] = n.value;
  }
  if (dueDate !== undefined) {
    const d = normalizeDueDate(dueDate);
    if (d.error) return res.status(400).json({ error: d.error, code: d.code });
    norm.dueDate = d.value;
  }

  // the parent is in another project: the caller meant one or the other, so ask (never guess a relationship).
  // Checked before a new project is created, so refusing doesn't leave one behind.
  const target = resolved.project ? resolved.project.name : String(project).trim();
  if (parent && parent.project !== target) {
    if (ask === "on") {
      const r = needsInput(`${parent.id} is in ${parent.project}, not ${target}. Where should this ticket go?`, [
        {
          label: `${parent.project}, as a subtask of ${parent.id}`,
          description: "a subtask lives in its parent's project",
          args: { project: parent.project, parentId: parent.id },
        },
        {
          label: `${target}, with no parent`,
          description: `a standalone ticket in ${target}`,
          args: { project: target, parentId: null, ...(newPrefix && { newProjectPrefix: newPrefix }) },
        },
      ]);
      return res.status(r.status).json(r.body);
    }
    return res.status(400).json({
      error: `${parent.id} is in ${parent.project}, not ${target} — a subtask has to be in its parent's project`,
      code: "parent_other_project",
    });
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
    parentId: parent ? parent.id : null,
    agent: agent || null,
    priority: norm.priority || "med",
    status: norm.status || "backlog",
    notes: notes || null,
    worktree: worktree || null,
    branch: branch || null,
    link: link || null,
    dueDate: norm.dueDate || null,
    unconfirmed: unconfirmed.join("; ") || null,
  });
  let out = row;
  if (unconfirmed.length) out = appendNote(req.db, row.id, `⚠ unconfirmed — ${unconfirmed.join("; ")}`, agent);
  // the user's answer to "which project?" — remember the word they used
  const word = typeof rememberAs === "string" ? rememberAs.trim().toLowerCase() : "";
  if (word && word !== projectRow.name.toLowerCase()) {
    req.db.prepare("INSERT OR REPLACE INTO project_aliases (alias, project) VALUES (?, ?)").run(word, projectRow.name);
    out = appendNote(req.db, row.id, `remembered "${word}" → ${projectRow.name} (undo: agent-board project forget "${word}")`, agent);
  }
  res.status(201).json(withHint(out, allDoneHint(req.db, out.parentId)));
});

// "notes" (plural, matches the column) = full overwrite — used by the UI's
// free-edit Description box. "note" (singular verb) = append a timestamped
// line — used by the CLI/MCP `note` command so multiple sessions/agents
// leaving notes over time don't stomp on each other's history.
const MUTABLE_FIELDS = ["title", "agent", "priority", "status", "worktree", "branch", "link", "dueDate", "notes", "unconfirmed", "parentId"];

// fields worth an automatic history line: the ones two agents are most
// likely to race on (claiming/reprioritizing a ticket at the same moment).
// This doesn't prevent the race — the column still just holds whichever
// write landed last — but it makes a collision visible after the fact
// instead of silently disappearing. parentId too: a ticket moving under
// another parent changes who's coordinating it.
const TRACKED_FIELDS = ["status", "agent", "priority", "parentId"];

router.patch("/:id", (req, res) => {
  const existing = req.db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.taskId);
  if (!existing) return res.status(404).json({ error: "task not found" });

  for (const field of ["status", "priority"]) {
    if (req.body[field] === undefined) continue;
    const n = normalizeEnum(field, req.body[field]);
    if (n.error) return res.status(400).json({ error: n.error });
    req.body[field] = n.value;
  }
  // dueDate: unchanged (the web sends whole cards) is left alone, so a value stored before this check doesn't block other edits
  if (req.body.dueDate !== undefined && (req.body.dueDate || null) !== (existing.dueDate || null)) {
    const d = normalizeDueDate(req.body.dueDate);
    if (d.error) return res.status(400).json({ error: d.error, code: d.code });
    req.body.dueDate = d.value;
  }
  // `project` in a PATCH body is ignored (the web UI sends the whole card, so a stray value would move it):
  // moving is its own verb, POST /tasks/:id/move.

  // parentId: an id sets the parent, null or "" detaches. Unchanged (a whole card sent back, as older
  // clients do) is left alone without checks, so rows from before these rules don't start failing.
  if (req.body.parentId !== undefined) {
    const next = req.body.parentId ? String(req.body.parentId).trim() || null : null;
    if (next === (existing.parentId || null)) {
      delete req.body.parentId;
    } else {
      let parentRow = null;
      if (next) {
        const c = checkParent(req.db, existing, next);
        parentRow = c.parent;
        if (c.status) return res.status(c.status).json(c.body);
        if (c.parent.project !== existing.project) {
          return res.status(400).json({
            error: `${c.parent.id} is in ${c.parent.project} and ${existing.id} is in ${existing.project} — a subtask has to be in its parent's project (move one of them first: POST /tasks/:id/move)`,
            code: "parent_other_project",
          });
        }
      }
      req.body.parentId = parentRow ? parentRow.id : null; // an old id given for the parent is stored as its current one
    }
  }

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
    params.push(existing.id);
    req.db.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  }

  const changes = TRACKED_FIELDS
    .filter((f) => req.body[f] !== undefined && req.body[f] !== existing[f])
    .map((f) => `${f}: ${existing[f] ?? "–"} → ${req.body[f] ?? "–"}`);
  if (changes.length) appendNote(req.db, existing.id, changes.join(", "), req.body.agent);

  let row = getTask(req.db, existing.id);
  // noteAgent tags the note and nothing else (CLI/MCP `note`); `agent` is the owner, so sending it reassigns
  if (req.body.note !== undefined) {
    row = appendNote(req.db, existing.id, req.body.note, req.body.noteAgent || req.body.agent);
  }
  // this change may have finished a parent's subtasks: its own (went done, or moved in) or the one it left
  const wentDone = req.body.status === "done" && existing.status !== "done";
  const moved = req.body.parentId !== undefined;
  let hint;
  if (wentDone || moved) hint = allDoneHint(req.db, row.parentId);
  if (!hint && moved) hint = allDoneHint(req.db, existing.parentId);
  res.json(withHint(row, req.movedHint, hint));
});

// a task with subtasks can't be deleted — its subtasks would be left pointing at nothing. Say which,
// so the caller can delete them or detach them (parentId null) first; never delete them along with it.
router.delete("/:id", (req, res) => {
  const existing = req.db.prepare("SELECT id FROM tasks WHERE id = ?").get(req.taskId);
  if (!existing) return res.status(404).json({ error: "task not found" });
  const subtasks = subtaskIds(req.db, existing.id);
  if (subtasks.length) {
    const n = subtasks.length;
    return res.status(409).json({
      error: `${existing.id} has ${n} subtask${n === 1 ? "" : "s"} (${subtasks.join(", ")}) — delete ${n === 1 ? "it" : "them"} or detach ${n === 1 ? "it" : "them"} (parentId: null) first.`,
      code: "has_subtasks",
      subtasks,
    });
  }
  req.db.transaction(() => {
    req.db.prepare("DELETE FROM tasks WHERE id = ?").run(existing.id);
    forgetTaskAliases(req.db, existing.id);
  })();
  res.status(204).end();
});

// Move a ticket to another project (Jira's "Move"): it gets a new id there and its subtasks come along.
// Its own verb, not a PATCH field — the web UI PATCHes whole cards, and a move renumbers tickets.
// The target project is always asked about when unclear (whatever the ask mode): a ticket landing in a
// guessed project, under a new id, is worse than a question. A subtask moves alone only with detach: true.
// Old ids keep working (see task_aliases) and the reply lists every { from, to }.
router.post("/:id/move", (req, res) => {
  const existing = req.db.prepare("SELECT id, project, parentId FROM tasks WHERE id = ?").get(req.taskId);
  if (!existing) return res.status(404).json({ error: "task not found" });
  const { project, detach, agent, rememberAs } = req.body;
  if (!project || !String(project).trim()) return res.status(400).json({ error: "project is required — the project to move the ticket to" });

  const newPrefix = typeof req.body.newProjectPrefix === "string" ? req.body.newProjectPrefix.trim() : "";
  const resolved = resolveProject(req.db, project, { offerNew: !newPrefix, ask: "on" });
  if (resolved.body && !(newPrefix && resolved.body.code === "unknown_project")) {
    return res.status(resolved.status).json(resolved.body);
  }
  if (resolved.project && resolved.project.name === existing.project) {
    return res.status(400).json({ error: `${existing.id} is already in ${existing.project}`, code: "same_project" });
  }
  if (existing.parentId && !detach) {
    return res.status(409).json({
      error: `${existing.id} is a subtask of ${existing.parentId}, and a subtask lives in its parent's project — move ${existing.parentId} instead (its subtasks come along), or move ${existing.id} alone with detach (it leaves ${existing.parentId})`,
      code: "is_subtask",
      parentId: existing.parentId,
    });
  }

  let target = resolved.project;
  let moved;
  try {
    moved = req.db.transaction(() => {
      if (!target) {
        const created = insertProject(req.db, String(project).trim(), newPrefix);
        if (created.body) throw Object.assign(new Error(created.body.error), { reply: created });
        target = created.project;
      }
      return moveTask(req.db, existing.id, target, { detach: !!detach, agent });
    })();
  } catch (e) {
    if (e.reply) return res.status(e.reply.status).json(e.reply.body);
    throw e;
  }
  const word = typeof rememberAs === "string" ? rememberAs.trim().toLowerCase() : "";
  if (word && word !== target.name.toLowerCase()) {
    req.db.prepare("INSERT OR REPLACE INTO project_aliases (alias, project) VALUES (?, ?)").run(word, target.name);
  }

  const [self, ...subs] = moved;
  const subsText = subs.length ? ` Its subtask${subs.length === 1 ? "" : "s"} moved too: ${subs.map((m) => `${m.from} → ${m.to}`).join(", ")}.` : "";
  // named as the caller knows it: an old id they used reads "AB-6 (later AB-10) is now OPS-4"
  const was = req.params.id !== self.from ? `${req.params.id} (later ${self.from})` : self.from;
  const hint = `${was} is now ${self.to} in ${target.name}.${subsText} Old ids keep working, but use the new ones from now on.`;
  // a detached subtask may have been the last unfinished one of its old parent
  res.json({ ...withHint(getTask(req.db, self.to), hint, existing.parentId && allDoneHint(req.db, existing.parentId)), movedFrom: self.from, moved });
});

export default router;
