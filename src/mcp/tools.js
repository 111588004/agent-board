import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as client from "../client.js";

const STATUS = ["backlog", "in_progress", "review", "done"];
const PRIORITY = ["low", "med", "high"];

function json(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function toolError(e) {
  return { content: [{ type: "text", text: `error: ${e.message}` }], isError: true };
}

// a fresh McpServer per HTTP request (see server.js — stateless transport
// mode), so this is a plain factory rather than a module-level singleton.
export function createMcpServer() {
  const server = new McpServer({ name: "agent-board", version: "0.1.0" });

  server.registerTool(
    "list_tasks",
    {
      description: "List tasks on the board. Always call this fresh before acting — the board can change between turns.",
      inputSchema: {
        project: z.string().optional().describe("Filter to one project's tasks"),
        status: z.enum(STATUS).optional(),
        parentId: z.string().optional().describe("Ticket id of a parent task, to list its subtasks"),
      },
    },
    async ({ project, status, parentId }) => {
      try {
        return json(await client.listTasks({ project, status, parentId }));
      } catch (e) {
        return toolError(e);
      }
    }
  );

  server.registerTool(
    "create_task",
    {
      description: "Create a new task on the board (or a subtask, if parentId is given). The project must already exist.",
      inputSchema: {
        title: z.string(),
        project: z.string(),
        agent: z.string().optional().describe("Your agent id, e.g. claude"),
        priority: z.enum(PRIORITY).optional(),
        parentId: z.string().optional().describe("Ticket id of the parent task, to create this as a subtask"),
      },
    },
    async ({ title, project, agent, priority, parentId }) => {
      try {
        return json(await client.createTask({ title, project, agent, priority, parentId }));
      } catch (e) {
        return toolError(e);
      }
    }
  );

  server.registerTool(
    "update_task_status",
    {
      description: "Change a task's status.",
      inputSchema: {
        taskId: z.string(),
        status: z.enum(STATUS),
      },
    },
    async ({ taskId, status }) => {
      try {
        return json(await client.updateTask(taskId, { status }));
      } catch (e) {
        return toolError(e);
      }
    }
  );

  server.registerTool(
    "add_task_note",
    {
      description: "Append a timestamped note to a task (a blocker, a PR link, a decision) — never overwrites existing notes.",
      inputSchema: {
        taskId: z.string(),
        note: z.string(),
        agent: z.string().optional().describe("Your agent id, e.g. claude"),
      },
    },
    async ({ taskId, note, agent }) => {
      try {
        return json(await client.updateTask(taskId, { note, agent }));
      } catch (e) {
        return toolError(e);
      }
    }
  );

  return server;
}
