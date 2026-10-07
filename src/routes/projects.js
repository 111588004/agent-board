import { Router } from "express";
import { insertProject, getConfig, addAliases, parseAliases } from "../db.js";
import { needsInput, suggestPrefixes } from "../normalize.js";

const router = Router();

router.get("/", (req, res) => {
  const aliases = req.db.prepare("SELECT alias, project FROM project_aliases ORDER BY alias").all();
  const rows = req.db.prepare("SELECT * FROM projects ORDER BY createdAt").all();
  res.json(rows.map((p) => ({ ...p, aliases: aliases.filter((a) => a.project === p.name).map((a) => a.alias) })));
});

// undo a remembered answer ("ops" -> Operations); the next "ops" asks again
router.delete("/aliases/:alias", (req, res) => {
  const result = req.db.prepare("DELETE FROM project_aliases WHERE alias = ?").run(req.params.alias.trim().toLowerCase());
  if (result.changes === 0) return res.status(404).json({ error: `no remembered word "${req.params.alias}"` });
  res.status(204).end();
});

// register what the user calls a project, so that word resolves without asking
router.post("/:name/aliases", (req, res) => {
  const r = addAliases(req.db, req.params.name, parseAliases(req.body.aliases ?? req.body.alias));
  if (r.body) return res.status(r.status).json(r.body);
  res.status(201).json(r);
});

router.post("/", (req, res) => {
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  const prefix = typeof req.body.prefix === "string" ? req.body.prefix.trim() : "";
  const aliases = parseAliases(req.body.aliases).map((a) => a.trim()).filter(Boolean);
  if (!name) return res.status(400).json({ error: "name is required" });
  // D15: no prefix -> ask the user rather than let the caller invent one
  if (!prefix) {
    if (req.db.prepare("SELECT 1 FROM projects WHERE name = ?").get(name)) {
      return res.status(409).json({ error: `project "${name}" already exists` });
    }
    const projects = req.db.prepare("SELECT * FROM projects").all();
    const suggestions = suggestPrefixes(name, projects, 3);
    if (getConfig().ask === "off") {
      return res.status(400).json({ error: `prefix is required (the board doesn't pick one, and asking is off) — e.g. ${suggestions.join(", ")}` });
    }
    const r = needsInput(
      `Which ticket prefix for the new project "${name}"? Every ticket id starts with it.`,
      suggestions.map((p) => ({ label: p, description: `tickets ${p}-1, ${p}-2, …`, args: { name, prefix: p, ...(aliases.length ? { aliases } : {}) } })),
      "prefix"
    );
    return res.status(r.status).json(r.body);
  }
  // project + its aliases in one transaction: a clashing alias leaves no half-made project
  let out;
  try {
    req.db.transaction(() => {
      const r = insertProject(req.db, name, prefix);
      if (r.body) throw Object.assign(new Error(), { reply: r });
      const a = addAliases(req.db, name, aliases);
      if (a.body) throw Object.assign(new Error(), { reply: a });
      out = { ...r.project, aliases: a.added };
    })();
  } catch (e) {
    if (e.reply) return res.status(e.reply.status).json(e.reply.body);
    throw e;
  }
  res.status(201).json(out);
});

// rename and/or re-prefix a project — cascades to every task's denormalized
// project/projectPrefix columns in the same transaction, so a rename can't
// leave tasks pointing at a name that no longer exists in the projects table.
router.patch("/:name", (req, res) => {
  const { name: newName, prefix: newPrefix } = req.body;
  const existing = req.db.prepare("SELECT * FROM projects WHERE name = ?").get(req.params.name);
  if (!existing) return res.status(404).json({ error: `project "${req.params.name}" not found` });

  const name = newName || existing.name;
  const prefix = newPrefix || existing.prefix;
  try {
    req.db.transaction(() => {
      req.db.prepare("UPDATE projects SET name = ?, prefix = ? WHERE name = ?").run(name, prefix, existing.name);
      req.db.prepare("UPDATE tasks SET project = ?, projectPrefix = ? WHERE project = ?").run(
        name,
        prefix,
        existing.name
      );
      req.db.prepare("UPDATE project_aliases SET project = ? WHERE project = ?").run(name, existing.name);
    })();
  } catch (e) {
    if (e.code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
      return res.status(409).json({ error: `project "${name}" already exists` });
    }
    if (e.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({ error: `prefix "${prefix}" is already in use` });
    }
    throw e;
  }
  res.json(req.db.prepare("SELECT * FROM projects WHERE name = ?").get(name));
});

// refuses to delete a project with tasks still on it — rather than either
// cascading (silently destroying tickets) or orphaning them (tasks pointing
// at a project row that no longer exists), same "ask first" spirit as
// deleteWorkspace refusing "default".
router.delete("/:name", (req, res) => {
  const existing = req.db.prepare("SELECT * FROM projects WHERE name = ?").get(req.params.name);
  if (!existing) return res.status(404).json({ error: `project "${req.params.name}" not found` });
  const { count } = req.db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE project = ?").get(req.params.name);
  if (count > 0) {
    return res.status(400).json({ error: `project "${req.params.name}" still has ${count} task(s) — move or delete them first` });
  }
  req.db.prepare("DELETE FROM projects WHERE name = ?").run(req.params.name);
  req.db.prepare("DELETE FROM project_aliases WHERE project = ?").run(req.params.name);
  res.status(204).end();
});

export default router;
