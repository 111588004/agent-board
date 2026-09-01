import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = process.env.AGENT_BOARD_DIR || path.join(os.homedir(), ".agent-board");
fs.mkdirSync(dir, { recursive: true });

export const db = new Database(path.join(dir, "tasks.db"));
db.pragma("journal_mode = WAL");

// Column names are camelCase to match the frontend's card shape directly —
// no request/response translation layer needed between API and UI.
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    name TEXT PRIMARY KEY,
    prefix TEXT UNIQUE NOT NULL,
    createdAt INTEGER
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    seq INTEGER NOT NULL,
    title TEXT NOT NULL,
    project TEXT,
    projectPrefix TEXT,
    parentId TEXT REFERENCES tasks(id),
    agent TEXT,
    priority TEXT,
    status TEXT,
    notes TEXT,
    worktree TEXT,
    branch TEXT,
    link TEXT,
    dueDate TEXT,
    createdAt INTEGER,
    updatedAt INTEGER
  );
`);

// ponytail: MAX(seq)+1 can reuse a number if the highest-seq row for that
// prefix is ever deleted — upgrade to a persisted per-project counter if
// that gap ever matters in practice.
export const createTask = db.transaction((task) => {
  const { next } = db
    .prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM tasks WHERE projectPrefix = ?")
    .get(task.projectPrefix);
  const id = `${task.projectPrefix}-${next}`;
  const now = Date.now();
  db.prepare(
    `INSERT INTO tasks (id, seq, title, project, projectPrefix, parentId, agent, priority, status, notes, worktree, branch, link, dueDate, createdAt, updatedAt)
     VALUES (@id, @seq, @title, @project, @projectPrefix, @parentId, @agent, @priority, @status, @notes, @worktree, @branch, @link, @dueDate, @createdAt, @updatedAt)`
  ).run({ ...task, id, seq: next, createdAt: now, updatedAt: now });
  return db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
});

// used by the CLI/MCP `note` verb (append) — distinct from the "notes" PATCH
// field (full overwrite, used by the UI's free-edit Description box).
export function appendNote(id, text, agent) {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const line = `[${stamp}${agent ? " · " + agent : ""}] ${text}`;
  const row = db.prepare("SELECT notes FROM tasks WHERE id = ?").get(id);
  if (!row) return null;
  const notes = row.notes ? `${row.notes}\n${line}` : line;
  db.prepare("UPDATE tasks SET notes = ?, updatedAt = ? WHERE id = ?").run(notes, Date.now(), id);
  return db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
}
