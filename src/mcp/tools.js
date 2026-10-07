import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as client from "../client.js";

// plain strings, not enums: the server normalizes aliases (進行中, wip, 高, p0...) and rejects unknowns with the allowed list
const STATUS_DESC = "backlog | in_progress | review | done (aliases ok: todo, doing, wip, 待辦, 進行中, 審查, 完成)";
const PRIORITY_DESC = "low | med | high (aliases ok: urgent, p0, 高, 中, 低)";
const PROJECT_DESC = "Project name or prefix as shown by list_projects (case-insensitive) — not a free-form phrase";
const WORKSPACE_DESC = "Board workspace to use — omit to use the CLI's current workspace (agent-board workspace use) or \"default\"";

function json(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

// needs_input (and asking is on): not an error — tell the agent to ask the user and retry.
function toolError(e, name) {
  if (e.code === "needs_input" && client.askEnabled()) {
    const open = e.answerArg ? ` If the user answers in their own words, pass it as "${e.answerArg}".` : "";
    const text = `NEEDS USER INPUT — do not pick an option yourself. Ask the user this question with your built-in ask tool (AskUserQuestion / request_user_input / ask_user; if you have none, ask in chat)${e.options.length ? ", offering these options" : " as an open question"}, then call ${name} again with the same arguments plus the chosen option's args.${open}`;
    const payload = { needs_input: { question: e.question, options: e.options, ...(e.answerArg && { answerArg: e.answerArg }) } };
    return { content: [{ type: "text", text }, { type: "text", text: JSON.stringify(payload, null, 2) }] };
  }
  return { content: [{ type: "text", text: `error: ${client.errorWithHint(e, "mcp")}` }], isError: true };
}

// a fresh McpServer per HTTP request (see server.js — stateless transport
// mode), so this is a plain factory rather than a module-level singleton.
// `notice` (stdio mode only — see mcp/stdio.js) is prepended to the first
// tool result, the one place the user reliably sees it; HTTP passes nothing.
export const INSTRUCTIONS = [
  "Opening a ticket: create_task once is enough — don't list_tasks first.",
  "project = a name or prefix exactly as list_projects shows it (case-insensitive). Only call list_projects if you don't know which project; never use a free-form phrase as the project.",
  "status: backlog | in_progress | review | done (aliases: todo, doing, wip, 進行中, 待辦, 審查, 完成...). priority: low | med | high (aliases: urgent, p0, 高, 中, 低...).",
  "Put the description in notes; set agent to your own id (claude, codex, gemini, ...).",
  "A result starting with NEEDS USER INPUT means the board can't tell what the user wants (several projects match, the project doesn't exist yet, no title). Ask the user that question with your built-in ask tool (Claude Code: AskUserQuestion, Codex: request_user_input, Gemini: ask_user; none -> ask in chat), then call the same tool again with the chosen option's args. Never pick an option yourself.",
  "Ticket prefixes are the user's call: never invent one — omit prefix (create_project) and the board asks.",
].join("\n");

export function createMcpServer({ notice } = {}) {
  const instructions = notice ? `${INSTRUCTIONS}\n\n${notice}` : INSTRUCTIONS;
  const server = new McpServer({ name: "agent-board", version: "0.1.0" }, { instructions });
  const tool = (name, def, handler) =>
    server.registerTool(name, def, async (args) => {
      let result;
      try {
        result = await handler(args);
      } catch (e) {
        result = toolError(e, name);
      }
      if (notice) {
        result.content.unshift({ type: "text", text: notice });
        notice = undefined;
      }
      return result;
    });

  tool(
    "list_tasks",
    {
      description: "List tasks on the board. Always call this fresh before acting — the board can change between turns.",
      inputSchema: {
        project: z.string().optional().describe(`Filter to one project's tasks. ${PROJECT_DESC}`),
        status: z.string().optional().describe(STATUS_DESC),
        parentId: z.string().optional().describe("Ticket id of a parent task, to list its subtasks"),
        workspace: z.string().optional().describe(WORKSPACE_DESC),
      },
    },
    async ({ project, status, parentId, workspace }) => {
      return json(await client.listTasks({ project, status, parentId, workspace }));
    }
  );

  tool(
    "create_task",
    {
      description: "Create a new task on the board (or a subtask, if parentId is given). One call is enough — if the project is ambiguous or doesn't exist yet, the result asks you to check with the user.",
      inputSchema: {
        title: z.string().optional().describe("Short title — omit only if you truly don't know it; the board will ask the user"),
        project: z.string().describe(PROJECT_DESC),
        newProjectPrefix: z.string().optional().describe("Only from a NEEDS USER INPUT option the user chose: creates the project with this prefix in the same call. Never invent one"),
        agent: z.string().optional().describe("Your agent id, e.g. claude, codex, opencode, gemini, pi — omit to leave unassigned"),
        priority: z.string().optional().describe(`${PRIORITY_DESC}. Defaults to med`),
        status: z.string().optional().describe(`${STATUS_DESC}. Defaults to backlog`),
        parentId: z.string().optional().describe("Ticket id of the parent task, to create this as a subtask"),
        dueDate: z.string().optional().describe("ISO date, e.g. 2026-03-05"),
        worktree: z.string().optional().describe("Filesystem path of the git worktree this task is being worked in"),
        branch: z.string().optional().describe("Git branch name"),
        link: z.string().optional().describe("Repo / PR / issue URL"),
        notes: z.string().optional().describe("Initial description, markdown — headings, bold, `code`, bullet/numbered lists, [links](url), ![images](url) all render"),
        workspace: z.string().optional().describe(WORKSPACE_DESC),
      },
    },
    async ({ title, project, newProjectPrefix, agent, priority, status, parentId, dueDate, worktree, branch, link, notes, workspace }) => {
      return json(
        await client.createTask({ title, project, newProjectPrefix, agent, priority, status, parentId, dueDate, worktree, branch, link, notes, workspace })
      );
    }
  );

  tool(
    "update_task",
    {
      description: "Update one or more fields on an existing task. Only the fields you pass are changed — omit the rest. Passing notes overwrites the whole description; use add_task_note to append instead.",
      inputSchema: {
        taskId: z.string(),
        status: z.string().optional().describe(STATUS_DESC),
        priority: z.string().optional().describe(PRIORITY_DESC),
        agent: z.string().optional().describe("Your agent id, e.g. claude, codex, opencode, gemini, pi"),
        title: z.string().optional(),
        worktree: z.string().optional().describe("Filesystem path of the git worktree this task is being worked in"),
        branch: z.string().optional().describe("Git branch name"),
        link: z.string().optional().describe("Repo / PR / issue URL"),
        dueDate: z.string().optional().describe("ISO date, e.g. 2026-03-05"),
        notes: z.string().optional().describe("Full description overwrite, markdown — headings, bold, `code`, bullet/numbered lists, [links](url), ![images](url) all render"),
        workspace: z.string().optional().describe(WORKSPACE_DESC),
      },
    },
    async ({ taskId, status, priority, agent, title, worktree, branch, link, dueDate, notes, workspace }) => {
      return json(
        await client.updateTask(taskId, { status, priority, agent, title, worktree, branch, link, dueDate, notes, workspace })
      );
    }
  );

  tool(
    "add_task_note",
    {
      description: "Append a timestamped note to a task (a blocker, a PR link, a decision) — never overwrites existing notes.",
      inputSchema: {
        taskId: z.string(),
        note: z.string(),
        agent: z.string().optional().describe("Your agent id, e.g. claude"),
        workspace: z.string().optional().describe(WORKSPACE_DESC),
      },
    },
    async ({ taskId, note, agent, workspace }) => {
      return json(await client.updateTask(taskId, { note, agent, workspace }));
    }
  );

  tool(
    "delete_task",
    {
      description: "Permanently delete a task. This can't be undone — prefer moving it to \"done\" via update_task unless it genuinely shouldn't exist (e.g. created by mistake).",
      inputSchema: {
        taskId: z.string(),
        workspace: z.string().optional().describe(WORKSPACE_DESC),
      },
    },
    async ({ taskId, workspace }) => {
      await client.deleteTask(taskId, { workspace });
      return json({ deleted: taskId });
    }
  );

  tool(
    "list_projects",
    {
      description: "List projects on the board, with their ticket-id prefixes.",
      inputSchema: {
        workspace: z.string().optional().describe(WORKSPACE_DESC),
      },
    },
    async ({ workspace }) => {
      return json(await client.listProjects({ workspace }));
    }
  );

  tool(
    "create_project",
    {
      description: "Create a new project. Usually not needed: create_task on a new project name asks the user and creates it in the same call.",
      inputSchema: {
        name: z.string(),
        prefix: z.string().optional().describe("Ticket-id prefix, e.g. \"AB\" for tickets like AB-1. Only pass one the user chose — omit it and the board asks the user"),
        workspace: z.string().optional().describe(WORKSPACE_DESC),
      },
    },
    async ({ name, prefix, workspace }) => {
      return json(await client.createProject({ name, prefix, workspace }));
    }
  );

  tool(
    "rename_project",
    {
      description: "Rename a project and/or change its ticket-id prefix. Existing tasks are updated to match.",
      inputSchema: {
        currentName: z.string(),
        name: z.string().optional().describe("New name — omit to leave unchanged"),
        prefix: z.string().optional().describe("New ticket-id prefix — omit to leave unchanged"),
        workspace: z.string().optional().describe(WORKSPACE_DESC),
      },
    },
    async ({ currentName, name, prefix, workspace }) => {
      return json(await client.renameProject(currentName, { name, prefix, workspace }));
    }
  );

  tool(
    "delete_project",
    {
      description: "Delete a project. Fails if it still has tasks — move or delete those first.",
      inputSchema: {
        name: z.string(),
        workspace: z.string().optional().describe(WORKSPACE_DESC),
      },
    },
    async ({ name, workspace }) => {
      await client.deleteProject(name, { workspace });
      return json({ deleted: name });
    }
  );

  return server;
}
