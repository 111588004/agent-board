// shared REST client — used by both cli.js and mcp/tools.js so the fetch
// logic (and the "how do I talk to the API" contract) lives in one place.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";

const BASE = process.env.AGENT_BOARD_URL || "http://localhost:4317";

// the server's own HTTP /mcp runs these same calls, and they must reach that server — not whatever
// AGENT_BOARD_URL (or :4317) names in its environment. withBase(url, fn) points every call made
// while fn runs at url; the CLI and stdio MCP never use it.
const baseOverride = new AsyncLocalStorage();
export function withBase(url, fn) {
  return baseOverride.run(url, fn);
}

const baseDir = process.env.AGENT_BOARD_DIR || path.join(os.homedir(), ".agent-board");
const currentWorkspaceFile = path.join(baseDir, "current-workspace");

// resolution order: explicit --workspace= flag > AGENT_BOARD_WORKSPACE env
// var (mirrors AGENT_BOARD_URL, for scripting/CI) > ~/.agent-board/current-workspace
// (written by `agent-board workspace use <name>`) > "default".
export function resolveWorkspace(explicit) {
  if (explicit) return explicit;
  if (process.env.AGENT_BOARD_WORKSPACE) return process.env.AGENT_BOARD_WORKSPACE;
  try {
    const fromFile = fs.readFileSync(currentWorkspaceFile, "utf8").trim();
    if (fromFile) return fromFile;
  } catch {
    // no current-workspace file yet — fall through to "default"
  }
  return "default";
}

export function setCurrentWorkspace(name) {
  fs.mkdirSync(baseDir, { recursive: true });
  fs.writeFileSync(currentWorkspaceFile, `${name}\n`);
}

export async function apiRequest(method, path, body) {
  const res = await fetch(`${baseOverride.getStore() || BASE}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  // a body that isn't JSON (an old server's HTML error page) still carries the status: with no status,
  // the CLI would report "can't reach the server" about a server that answered
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    if (res.ok) throw Object.assign(new Error(`unexpected response from the server: ${text.slice(0, 80)}`), { status: res.status });
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `${res.status} ${res.statusText}`);
    err.status = res.status;
    err.code = data && data.code;
    err.input = data && data.input;
    err.subtasks = data && data.subtasks;
    err.parentId = data && data.parentId;
    if (err.code === "needs_input") Object.assign(err, { question: data.question, options: data.options, answerArg: data.answerArg });
    throw err;
  }
  return data;
}

// REST errors are caller-neutral; each front end appends its own next step.
export function errorWithHint(e, surface) {
  const cli = surface === "cli";
  if (e.code === "unknown_project") {
    const name = e.input || "<name>";
    return cli
      ? `${e.message} New project: agent-board project create "${name}" --prefix=<PREFIX>`
      : `${e.message} New project: use the create_project tool (name, prefix).`;
  }
  if (e.code === "is_subtask" && e.parentId) {
    return cli
      ? `${e.message}. Move the parent: agent-board move ${e.parentId} --project=<name> — or this one alone: add --detach`
      : `${e.message}. Move the parent: move_task with taskId ${e.parentId} — or this one alone: detach true.`;
  }
  if (e.code === "has_subtasks" && e.subtasks?.length) {
    const first = e.subtasks[0];
    return cli
      ? `${e.message} Detach one: agent-board update ${first} --parent=none`
      : `${e.message} Detach one: update_task with taskId ${first} and parentId null.`;
  }
  return e.message;
}

// global settings (every workspace) live on the server: ask = on | new | off
export function getConfig() {
  return apiRequest("GET", "/api/config");
}

export function setConfig(patch) {
  return apiRequest("PUT", "/api/config", patch);
}

export function forgetAlias(alias, { workspace } = {}) {
  return apiRequest("DELETE", `${workspacePath(workspace)}/projects/aliases/${encodeURIComponent(alias)}`);
}

export function listWorkspaces() {
  return apiRequest("GET", "/api/workspaces");
}

export function createWorkspace(name) {
  return apiRequest("POST", "/api/workspaces", { name });
}

export function renameWorkspace(oldName, newName) {
  return apiRequest("PATCH", `/api/workspaces/${encodeURIComponent(oldName)}`, { name: newName });
}

export function deleteWorkspace(name) {
  return apiRequest("DELETE", `/api/workspaces/${encodeURIComponent(name)}`);
}

function workspacePath(workspace) {
  return `/api/w/${encodeURIComponent(resolveWorkspace(workspace))}`;
}

export function listTasks({ project, status, parentId, workspace } = {}) {
  const params = new URLSearchParams();
  if (project) params.set("project", project);
  if (status) params.set("status", status);
  if (parentId) params.set("parentId", parentId);
  const qs = params.toString();
  return apiRequest("GET", `${workspacePath(workspace)}/tasks${qs ? `?${qs}` : ""}`);
}

export function createTask({ workspace, ...task }) {
  return apiRequest("POST", `${workspacePath(workspace)}/tasks`, task);
}

export function updateTask(id, { workspace, ...patch } = {}) {
  return apiRequest("PATCH", `${workspacePath(workspace)}/tasks/${id}`, patch);
}

// to another project: a new id there, subtasks along, old ids keep working (POST /tasks/:id/move)
export function moveTask(id, { workspace, ...body } = {}) {
  return apiRequest("POST", `${workspacePath(workspace)}/tasks/${id}/move`, body);
}

export function deleteTask(id, { workspace } = {}) {
  return apiRequest("DELETE", `${workspacePath(workspace)}/tasks/${id}`);
}

export function listProjects({ workspace } = {}) {
  return apiRequest("GET", `${workspacePath(workspace)}/projects`);
}

export function createProject({ name, prefix, aliases, workspace }) {
  return apiRequest("POST", `${workspacePath(workspace)}/projects`, { name, prefix, aliases });
}

export function addAliases(project, aliases, { workspace } = {}) {
  return apiRequest("POST", `${workspacePath(workspace)}/projects/${encodeURIComponent(project)}/aliases`, { aliases });
}

export function renameProject(currentName, { name, prefix, workspace } = {}) {
  return apiRequest("PATCH", `${workspacePath(workspace)}/projects/${encodeURIComponent(currentName)}`, { name, prefix });
}

export function deleteProject(name, { workspace } = {}) {
  return apiRequest("DELETE", `${workspacePath(workspace)}/projects/${encodeURIComponent(name)}`);
}
