import { Router } from "express";

const router = Router();

router.get("/", (req, res) => {
  res.json(req.db.prepare("SELECT * FROM projects ORDER BY createdAt").all());
});

router.post("/", (req, res) => {
  const { name, prefix } = req.body;
  if (!name || !prefix) {
    return res.status(400).json({ error: "name and prefix are required" });
  }
  try {
    req.db.prepare("INSERT INTO projects (name, prefix, createdAt) VALUES (?, ?, ?)").run(
      name,
      prefix,
      Date.now()
    );
  } catch (e) {
    if (e.code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
      return res.status(409).json({ error: `project "${name}" already exists` });
    }
    if (e.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({ error: `prefix "${prefix}" is already in use` });
    }
    throw e;
  }
  res.status(201).json(req.db.prepare("SELECT * FROM projects WHERE name = ?").get(name));
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
  res.status(204).end();
});

export default router;
