// shared REST client — used by both cli.js and mcp/tools.js so the fetch
// logic (and the "how do I talk to the API" contract) lives in one place.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.env.AGENT_BOARD_URL || "http://localhost:4317";

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
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error((data && data.error) || res.statusText);
    err.status = res.status;
    throw err;
  }
  return data;
}

export function listWorkspaces() {
  return apiRequest("GET", "/api/workspaces");
}

export function createWorkspace(name) {
  return apiRequest("POST", "/api/workspaces", { name });
}

export function listTasks({ project, status, parentId, workspace } = {}) {
  const params = new URLSearchParams();
  if (project) params.set("project", project);
  if (status) params.set("status", status);
  if (parentId) params.set("parentId", parentId);
  const qs = params.toString();
  return apiRequest("GET", `/api/w/${resolveWorkspace(workspace)}/tasks${qs ? `?${qs}` : ""}`);
}

export function createTask({ workspace, ...task }) {
  return apiRequest("POST", `/api/w/${resolveWorkspace(workspace)}/tasks`, task);
}

export function updateTask(id, { workspace, ...patch } = {}) {
  return apiRequest("PATCH", `/api/w/${resolveWorkspace(workspace)}/tasks/${id}`, patch);
}
