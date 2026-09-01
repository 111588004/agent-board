import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import tasksRouter from "./routes/tasks.js";
import projectsRouter from "./routes/projects.js";
import { createMcpServer } from "./mcp/tools.js";
import { getDb, listWorkspaces, createWorkspace, deleteWorkspace, renameWorkspace } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

// answers "which copy of agent-board am I actually talking to" — dev
// checkout vs. an npm-installed copy — without relying on remembering which
// port/command you used to start it. npm link vs `npm install -g` silently
// swap which code the global `agent-board` bin runs (see CLAUDE.md), so the
// running server has to self-report; there's no other reliable signal.
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const meta = {
  version: pkg.version,
  source: root.includes("node_modules") ? "npm" : "dev",
  root,
  pid: process.pid,
};

const app = express();
app.use(express.json());

app.get("/api/meta", (req, res) => {
  res.json(meta);
});

app.get("/api/workspaces", (req, res) => {
  res.json(listWorkspaces());
});
app.post("/api/workspaces", (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });
  try {
    createWorkspace(name);
    res.status(201).json({ name });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});
app.patch("/api/workspaces/:name", (req, res) => {
  const { name: newName } = req.body;
  if (!newName) return res.status(400).json({ error: "name is required" });
  try {
    renameWorkspace(req.params.name, newName);
    res.json({ name: newName });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});
app.delete("/api/workspaces/:name", (req, res) => {
  try {
    deleteWorkspace(req.params.name);
    res.status(204).end();
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// resolves req.db for every /api/tasks and /api/projects request below —
// either from an explicit /api/w/:workspace/... path, or (for the
// unprefixed /api/tasks, /api/projects aliases — kept working so nothing
// that predates workspaces breaks) the literal "default" workspace.
function withWorkspace(explicitName) {
  return (req, res, next) => {
    try {
      req.db = getDb(explicitName || req.params.workspace);
      next();
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  };
}

app.use("/api/w/:workspace/tasks", withWorkspace(), tasksRouter);
app.use("/api/w/:workspace/projects", withWorkspace(), projectsRouter);
app.use("/api/tasks", withWorkspace("default"), tasksRouter);
app.use("/api/projects", withWorkspace("default"), projectsRouter);

// MCP — http transport (not stdio), so multiple agent sessions can share
// this one server instance. Stateless: no session to track between
// requests, so each call gets its own short-lived server+transport pair.
app.post("/mcp", async (req, res) => {
  try {
    const mcpServer = createMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on("close", () => {
      transport.close();
      mcpServer.close();
    });
  } catch (e) {
    console.error("MCP request failed:", e);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  }
});
app.get("/mcp", (req, res) => {
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
});
app.delete("/mcp", (req, res) => {
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
});

// serves the built web UI (npm run build in web/) — 404s harmlessly until built
app.use(express.static(path.join(__dirname, "../web/dist")));

// dev and npm default to different ports so both can run at once and be
// compared directly — no more "stop one to test the other." PORT still wins
// if set explicitly.
const PORT = process.env.PORT || (meta.source === "dev" ? 4316 : 4317);
app.listen(PORT, () => {
  console.log(`agent-board v${meta.version} (${meta.source}) listening on http://localhost:${PORT}`);
  console.log(`  root: ${meta.root}`);
});
