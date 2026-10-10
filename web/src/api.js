const WORKSPACE_KEY = "agent-board.workspace";

// URL query param wins (so a workspace link is shareable), then whatever
// was last picked in this browser, then "default".
export function getWorkspace() {
  const params = new URLSearchParams(window.location.search);
  let saved = null;
  try { saved = localStorage.getItem(WORKSPACE_KEY); } catch {} // blocked storage: just don't remember
  return params.get("workspace") || saved || "default";
}

export function setWorkspace(name) {
  try { localStorage.setItem(WORKSPACE_KEY, name); } catch {}
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
  // a non-JSON error body (an older server's HTML page) still carries the status
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    if (res.ok) throw new Error(`unexpected response from the server: ${text.slice(0, 80)}`);
  }
  if (!res.ok) {
    // code / subtasks let the UI react to a rule (e.g. "has_subtasks"), not only show the message
    throw Object.assign(new Error((data && data.error) || `${res.status} ${res.statusText}`), {
      status: res.status,
      code: data && data.code,
      subtasks: data && data.subtasks,
    });
  }
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

// one task by id — an old id of a moved ticket answers with the current one (and a hint saying so)
export function getTask(id) {
  return request("GET", `/tasks/${encodeURIComponent(id)}`);
}

// to another project: a new id there, its subtasks along; old ids keep working
export function moveTask(id, body) {
  return request("POST", `/tasks/${encodeURIComponent(id)}/move`, body);
}

export function deleteTask(id) {
  return request("DELETE", `/tasks/${id}`);
}

export function listProjects() {
  return request("GET", "/projects");
}

export function createProject(name, prefix, aliases) {
  return request("POST", "/projects", { name, prefix, aliases });
}

export function addAliases(project, aliases) {
  return request("POST", `/projects/${encodeURIComponent(project)}/aliases`, { aliases });
}

export function forgetAlias(alias) {
  return request("DELETE", `/projects/aliases/${encodeURIComponent(alias)}`);
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
