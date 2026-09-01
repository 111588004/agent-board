// shared REST client — used by both cli.js and mcp/tools.js so the fetch
// logic (and the "how do I talk to the API" contract) lives in one place.
const BASE = process.env.AGENT_BOARD_URL || "http://localhost:4317";

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

export function listTasks({ project, status, parentId } = {}) {
  const params = new URLSearchParams();
  if (project) params.set("project", project);
  if (status) params.set("status", status);
  if (parentId) params.set("parentId", parentId);
  const qs = params.toString();
  return apiRequest("GET", `/api/tasks${qs ? `?${qs}` : ""}`);
}

export function createTask(task) {
  return apiRequest("POST", "/api/tasks", task);
}

export function updateTask(id, patch) {
  return apiRequest("PATCH", `/api/tasks/${id}`, patch);
}
