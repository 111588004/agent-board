#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as client from "./client.js";

const [cmd, ...rest] = process.argv.slice(2);

// bare `agent-board` (no args at all) starts the server in the foreground —
// no auto-spawn-in-background magic, no separate `serve` verb to remember.
// An unrecognized verb still falls through to the usage error below.
if (cmd === undefined) {
  const serverPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "server.js");
  await import(serverPath);
  await new Promise(() => {}); // server.js's own app.listen() keeps the process alive
}

const flags = {};
const positional = [];
for (const arg of rest) {
  const m = arg.match(/^--([^=]+)=(.*)$/);
  if (m) flags[m[1]] = m[2];
  else positional.push(arg);
}

async function run(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e.status === undefined) {
      console.error("agent-board: can't reach the server — is it running? (agent-board, no args, in another terminal)");
    } else {
      console.error(`agent-board: ${e.status} ${e.message}`);
    }
    process.exit(1);
  }
}

function printTasks(tasks) {
  if (!tasks.length) {
    console.log("(no tasks)");
    return;
  }
  for (const t of tasks) {
    console.log(`${t.id}  [${t.status}]  ${t.title}  (${t.agent || "-"}, ${t.priority})`);
  }
}

switch (cmd) {
  case "list": {
    printTasks(
      await run(() =>
        client.listTasks({ project: flags.project, status: flags.status, parentId: flags.parent, workspace: flags.workspace })
      )
    );
    break;
  }

  case "create": {
    if (!flags.title || !flags.project) {
      console.error(
        'usage: agent-board create --title="..." --project=<name> [--parent=<id>] [--agent=<name>] [--priority=<low|med|high>] [--status=<backlog|in_progress|review|done>] [--due-date=<YYYY-MM-DD>] [--worktree=<path>] [--branch=<name>] [--link=<url>] [--notes="..."] [--workspace=<name>]'
      );
      process.exit(1);
    }
    const task = await run(() =>
      client.createTask({
        title: flags.title,
        project: flags.project,
        parentId: flags.parent,
        agent: flags.agent,
        priority: flags.priority,
        status: flags.status,
        dueDate: flags["due-date"],
        worktree: flags.worktree,
        branch: flags.branch,
        link: flags.link,
        notes: flags.notes,
        workspace: flags.workspace,
      })
    );
    console.log(`created ${task.id}`);
    break;
  }

  case "update": {
    const id = positional[0];
    if (!id) {
      console.error(
        "usage: agent-board update <id> [--status=<backlog|in_progress|review|done>] [--priority=<low|med|high>] [--agent=<name>] [--title=] [--worktree=] [--branch=] [--link=<url>] [--due-date=<YYYY-MM-DD>] [--notes=\"...\"] [--workspace=<name>]"
      );
      process.exit(1);
    }
    const body = { workspace: flags.workspace };
    for (const key of ["status", "priority", "agent", "title", "worktree", "branch", "link", "notes"]) {
      if (flags[key] !== undefined) body[key] = flags[key];
    }
    if (flags["due-date"] !== undefined) body.dueDate = flags["due-date"];
    const task = await run(() => client.updateTask(id, body));
    console.log(`updated ${task.id}`);
    break;
  }

  case "delete": {
    const id = positional[0];
    if (!id) {
      console.error("usage: agent-board delete <id> [--workspace=<name>]");
      process.exit(1);
    }
    await run(() => client.deleteTask(id, { workspace: flags.workspace }));
    console.log(`deleted ${id}`);
    break;
  }

  case "note": {
    const id = positional[0];
    const text = positional[1];
    if (!id || !text) {
      console.error('usage: agent-board note <id> "<text>" [--agent=<name>] [--workspace=<name>]');
      process.exit(1);
    }
    const task = await run(() => client.updateTask(id, { note: text, agent: flags.agent, workspace: flags.workspace }));
    console.log(`noted ${task.id}`);
    break;
  }

  case "workspace": {
    const sub = positional[0];
    if (sub === "list") {
      const names = await run(() => client.listWorkspaces());
      const current = client.resolveWorkspace();
      for (const name of names) console.log(name === current ? `* ${name}` : `  ${name}`);
      break;
    }
    if (sub === "create") {
      const name = positional[1];
      if (!name) {
        console.error("usage: agent-board workspace create <name>");
        process.exit(1);
      }
      await run(() => client.createWorkspace(name));
      console.log(`created workspace ${name}`);
      break;
    }
    if (sub === "use") {
      const name = positional[1];
      if (!name) {
        console.error("usage: agent-board workspace use <name>");
        process.exit(1);
      }
      client.setCurrentWorkspace(name);
      console.log(`current workspace is now ${name}`);
      break;
    }
    if (sub === "rename") {
      const [oldName, newName] = [positional[1], positional[2]];
      if (!oldName || !newName) {
        console.error("usage: agent-board workspace rename <old> <new>");
        process.exit(1);
      }
      await run(() => client.renameWorkspace(oldName, newName));
      if (client.resolveWorkspace() === oldName) client.setCurrentWorkspace(newName);
      console.log(`renamed workspace ${oldName} to ${newName}`);
      break;
    }
    if (sub === "delete") {
      const name = positional[1];
      if (!name) {
        console.error("usage: agent-board workspace delete <name>");
        process.exit(1);
      }
      await run(() => client.deleteWorkspace(name));
      if (client.resolveWorkspace() === name) client.setCurrentWorkspace("default");
      console.log(`deleted workspace ${name}`);
      break;
    }
    console.error("usage: agent-board workspace <list|create|use|rename|delete> ...");
    process.exit(1);
  }

  case "project": {
    const sub = positional[0];
    if (sub === "list") {
      const projects = await run(() => client.listProjects({ workspace: flags.workspace }));
      if (!projects.length) console.log("(no projects)");
      for (const p of projects) console.log(`${p.prefix}  ${p.name}`);
      break;
    }
    if (sub === "create") {
      const name = positional[1];
      if (!name || !flags.prefix) {
        console.error("usage: agent-board project create <name> --prefix=<prefix> [--workspace=<name>]");
        process.exit(1);
      }
      await run(() => client.createProject({ name, prefix: flags.prefix, workspace: flags.workspace }));
      console.log(`created project ${name} (${flags.prefix})`);
      break;
    }
    if (sub === "rename") {
      const currentName = positional[1];
      if (!currentName || (!flags.name && !flags.prefix)) {
        console.error("usage: agent-board project rename <current-name> [--name=<new-name>] [--prefix=<new-prefix>] [--workspace=<name>]");
        process.exit(1);
      }
      const updated = await run(() =>
        client.renameProject(currentName, { name: flags.name, prefix: flags.prefix, workspace: flags.workspace })
      );
      console.log(`updated project ${currentName} -> ${updated.name} (${updated.prefix})`);
      break;
    }
    if (sub === "delete") {
      const name = positional[1];
      if (!name) {
        console.error("usage: agent-board project delete <name> [--workspace=<name>]");
        process.exit(1);
      }
      await run(() => client.deleteProject(name, { workspace: flags.workspace }));
      console.log(`deleted project ${name}`);
      break;
    }
    console.error("usage: agent-board project <list|create|rename|delete> ...");
    process.exit(1);
  }

  default:
    console.error("usage: agent-board <list|create|update|delete|note|workspace|project> ...");
    process.exit(1);
}
