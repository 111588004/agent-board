import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const baseDir = process.env.AGENT_BOARD_DIR || path.join(os.homedir(), ".agent-board");
const workspacesDir = path.join(baseDir, "workspaces");
fs.mkdirSync(baseDir, { recursive: true });

// one-time migration: a pre-workspaces install has a single tasks.db right
// under baseDir. Move it (not copy) into workspaces/default/ so it becomes
// that workspace's data — renameSync is a single atomic inode update on the
// same filesystem, so there's no crash-mid-copy window that could lose data
// (this project has already lost a session's data once to a durability bug;
// this migration must not add a second way to do that).
const legacyDbPath = path.join(baseDir, "tasks.db");
if (!fs.existsSync(workspacesDir) && fs.existsSync(legacyDbPath)) {
  const defaultDir = path.join(workspacesDir, "default");
  fs.mkdirSync(defaultDir, { recursive: true });
  fs.renameSync(legacyDbPath, path.join(defaultDir, "tasks.db"));
}
fs.mkdirSync(workspacesDir, { recursive: true });

// filesystem-safe, not ASCII-only — a workspace name becomes a directory
// name and a URL path segment (percent-encoded by the client), both of
// which handle Unicode fine. Only reject what would actually break: empty,
// path separators, and the two directory-traversal specials.
function isValidWorkspaceName(name) {
  return !!name && !name.includes("/") && !name.includes("\\") && name !== "." && name !== "..";
}

function initSchema(db) {
  // deliberately NOT WAL mode: every commit writes straight into the main
  // .db file (SQLite's default rollback-journal mode), so there's no
  // WAL-only window where a crash loses "committed" data. WAL's benefit —
  // writers not blocking readers — doesn't apply here anyway: every write
  // for a given workspace goes through this one Express process, so
  // there's never more than one writer at a time regardless of journal mode.

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
}

const connections = new Map();

// lazily opens (or creates) a workspace's SQLite file, caches the connection
// for the process lifetime — no pooling/eviction, a handful of open handles
// costs nothing for a low-traffic local tool.
export function getDb(workspaceName) {
  const name = workspaceName || "default";
  if (connections.has(name)) return connections.get(name);
  if (!isValidWorkspaceName(name)) {
    const err = new Error(`invalid workspace name "${name}" — can't be empty, ".", "..", or contain "/"`);
    err.status = 400;
    throw err;
  }
  const dir = path.join(workspacesDir, name);
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(path.join(dir, "tasks.db"));
  initSchema(db);
  connections.set(name, db);
  return db;
}

export function listWorkspaces() {
  const onDisk = fs
    .readdirSync(workspacesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(workspacesDir, e.name, "tasks.db")))
    .map((e) => e.name);
  // include any workspace already opened this run but not yet holding a
  // ticket/project (so a just-created empty workspace shows up immediately)
  return Array.from(new Set([...onDisk, ...connections.keys()])).sort();
}

export function createWorkspace(name) {
  if (!isValidWorkspaceName(name)) {
    const err = new Error(`invalid workspace name "${name}" — can't be empty, ".", "..", or contain "/"`);
    err.status = 400;
    throw err;
  }
  getDb(name); // opens + initializes schema as a side effect
  return name;
}

// ponytail: MAX(seq)+1 can reuse a number if the highest-seq row for that
// prefix is ever deleted — upgrade to a persisted per-project counter if
// that gap ever matters in practice.
export function createTask(db, task) {
  return db.transaction((task) => {
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
  })(task);
}

// used by the CLI/MCP `note` verb (append) — distinct from the "notes" PATCH
// field (full overwrite, used by the UI's free-edit Description box).
export function appendNote(db, id, text, agent) {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const line = `[${stamp}${agent ? " · " + agent : ""}] ${text}`;
  const row = db.prepare("SELECT notes FROM tasks WHERE id = ?").get(id);
  if (!row) return null;
  const notes = row.notes ? `${row.notes}\n${line}` : line;
  db.prepare("UPDATE tasks SET notes = ?, updatedAt = ? WHERE id = ?").run(notes, Date.now(), id);
  return db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
}
