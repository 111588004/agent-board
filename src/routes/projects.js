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

export default router;
