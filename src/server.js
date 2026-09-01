import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import tasksRouter from "./routes/tasks.js";
import projectsRouter from "./routes/projects.js";
import { createMcpServer } from "./mcp/tools.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());
app.use("/api/tasks", tasksRouter);
app.use("/api/projects", projectsRouter);

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

const PORT = 4317;
app.listen(PORT, () => console.log(`agent-board listening on http://localhost:${PORT}`));
