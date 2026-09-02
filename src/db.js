import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// same "am I a dev checkout or the npm-installed copy" check server.js uses
// to auto-pick a port — applied here so dev and npm also default to
// separate DB roots without anyone having to remember AGENT_BOARD_DIR. An
// explicit AGENT_BOARD_DIR always wins over either default.
const isDevCheckout = !path.join(path.dirname(fileURLToPath(import.meta.url)), "..").includes("node_modules");
const defaultBaseDir = path.join(os.homedir(), isDevCheckout ? ".agent-board-dev" : ".agent-board");
const baseDir = process.env.AGENT_BOARD_DIR || defaultBaseDir;
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

function requireValidWorkspaceName(name) {
  if (!isValidWorkspaceName(name)) {
    const err = new Error(`invalid workspace name "${name}" — can't be empty, ".", "..", or contain "/"`);
    err.status = 400;
    throw err;
  }
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
  requireValidWorkspaceName(name);
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
  requireValidWorkspaceName(name);
  getDb(name); // opens + initializes schema as a side effect
  return name;
}

function requireNotDefault(name, action) {
  if (name === "default") {
    const err = new Error(`can't ${action} the "default" workspace`);
    err.status = 400;
    throw err;
  }
}

export function deleteWorkspace(name) {
  requireNotDefault(name, "delete");
  const dir = path.join(workspacesDir, name);
  if (!fs.existsSync(dir)) {
    const err = new Error(`workspace "${name}" doesn't exist`);
    err.status = 404;
    throw err;
  }
  const conn = connections.get(name);
  if (conn) {
    conn.close();
    connections.delete(name);
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

// renameSync on the same filesystem is a single atomic inode update, same
// durability guarantee as the legacy-tasks.db migration above — no
// crash-mid-copy window that could lose the workspace's data.
export function renameWorkspace(oldName, newName) {
  requireNotDefault(oldName, "rename");
  requireValidWorkspaceName(newName);
  if (newName === "default") {
    const err = new Error(`can't rename to "default" — it's reserved`);
    err.status = 400;
    throw err;
  }
  const oldDir = path.join(workspacesDir, oldName);
  const newDir = path.join(workspacesDir, newName);
  if (!fs.existsSync(oldDir)) {
    const err = new Error(`workspace "${oldName}" doesn't exist`);
    err.status = 404;
    throw err;
  }
  if (fs.existsSync(newDir) || connections.has(newName)) {
    const err = new Error(`workspace "${newName}" already exists`);
    err.status = 409;
    throw err;
  }
  const conn = connections.get(oldName);
  if (conn) {
    conn.close();
    connections.delete(oldName);
  }
  fs.renameSync(oldDir, newDir);
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
