const WORKSPACE_KEY = "agent-board.workspace";

// URL query param wins (so a workspace link is shareable), then whatever
// was last picked in this browser, then "default".
export function getWorkspace() {
  const params = new URLSearchParams(window.location.search);
  return params.get("workspace") || localStorage.getItem(WORKSPACE_KEY) || "default";
}

export function setWorkspace(name) {
  localStorage.setItem(WORKSPACE_KEY, name);
  const url = new URL(window.location.href);
  url.searchParams.set("workspace", name);
  window.history.replaceState({}, "", url);
}

async function rawRequest(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data && data.error) || res.statusText);
  return data;
}

function request(method, path, body) {
  return rawRequest(method, `/api/w/${encodeURIComponent(getWorkspace())}${path}`, body);
}

export function listTasks(filters = {}) {
  const params = new URLSearchParams();
  if (filters.project) params.set("project", filters.project);
  if (filters.status) params.set("status", filters.status);
  if (filters.parentId) params.set("parentId", filters.parentId);
  const qs = params.toString();
  return request("GET", `/tasks${qs ? `?${qs}` : ""}`);
}

export function createTask(task) {
  return request("POST", "/tasks", task);
}

export function updateTask(id, patch) {
  return request("PATCH", `/tasks/${id}`, patch);
}

export function deleteTask(id) {
  return request("DELETE", `/tasks/${id}`);
}

export function listProjects() {
  return request("GET", "/projects");
}

export function createProject(name, prefix) {
  return request("POST", "/projects", { name, prefix });
}

export function renameProject(currentName, { name, prefix }) {
  return request("PATCH", `/projects/${encodeURIComponent(currentName)}`, { name, prefix });
}

export function deleteProject(name) {
  return request("DELETE", `/projects/${encodeURIComponent(name)}`);
}

export function getMeta() {
  return rawRequest("GET", "/api/meta");
}

export function listWorkspaces() {
  return rawRequest("GET", "/api/workspaces");
}

export function createWorkspace(name) {
  return rawRequest("POST", "/api/workspaces", { name });
}

export function renameWorkspace(oldName, newName) {
  return rawRequest("PATCH", `/api/workspaces/${encodeURIComponent(oldName)}`, { name: newName });
}

export function deleteWorkspace(name) {
  return rawRequest("DELETE", `/api/workspaces/${encodeURIComponent(name)}`);
}
