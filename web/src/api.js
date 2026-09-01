const BASE = "/api";

async function request(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data && data.error) || res.statusText);
  return data;
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
