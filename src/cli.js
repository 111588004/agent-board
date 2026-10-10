#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import * as client from "./client.js";

const [cmd, ...rest] = process.argv.slice(2);

// bare `agent-board` (no args at all) starts the server in the foreground —
// no auto-spawn-in-background magic, no separate `serve` verb to remember.
// An unrecognized verb still falls through to the usage error below.
if (cmd === undefined) {
  const serverPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "server.js");
  // a file URL, not the path: on Windows an absolute path (C:\...) is read as a URL with scheme "c:" and
  // import() refuses it (ERR_UNSUPPORTED_ESM_URL_SCHEME), so bare `agent-board` crashed there
  await import(pathToFileURL(serverPath).href);
  await new Promise(() => {}); // server.js's own app.listen() keeps the process alive
}

const flags = {};
const positional = [];
for (const arg of rest) {
  const m = arg.match(/^--([^=]+)=(.*)$/s);
  if (m) flags[m[1]] = m[2];
  else positional.push(arg);
}

async function run(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e.code === "needs_input") {
      printQuestion(e);
      process.exit(2);
    }
    if (e.status === undefined) {
      console.error("agent-board: can't reach the server — is it running? Start it in another terminal: agent-board  (or: npx @limao.li.design/agent-board)");
    } else {
      console.error(`agent-board: ${e.status} ${client.errorWithHint(e, "cli")}`);
    }
    process.exit(1);
  }
}

// same question + options the MCP tools return; exit 2 so a calling agent can
// tell "ask the user, then rerun with these flags" apart from a real error (1)
function printQuestion(e) {
  const flag = (k, v) => `--${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}=${JSON.stringify(String(v))}`;
  const lines = [`agent-board: needs your input — ${e.question}`];
  e.options.forEach((o, i) => {
    const args = Object.entries(o.args).filter(([k]) => k !== "name").map(([k, v]) => flag(k, v)).join(" "); // name is positional
    lines.push(`  ${i + 1}) ${o.label} — ${o.description}`, `     rerun with: ${args}`);
  });
  if (e.answerArg) lines.push(`  or answer in your own words: ${flag(e.answerArg, "...")}`);
  lines.push("(agents: ask the user — don't pick for them)");
  console.error(lines.join("\n"));
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
    if (!flags.project) {
      console.error(
        'usage: agent-board create --title="..." --project=<name> [--new-project-prefix=<prefix>] [--remember-as=<word>] [--parent=<id>] [--agent=<name>] [--priority=<low|med|high>] [--status=<backlog|in_progress|review|done>] [--due-date=<YYYY-MM-DD>] [--worktree=<path>] [--branch=<name>] [--link=<url>] [--notes="..."] [--workspace=<name>]\n  (--notes sets the Description field)'
      );
      process.exit(1);
    }
    const task = await run(() =>
      client.createTask({
        title: flags.title,
        project: flags.project,
        newProjectPrefix: flags["new-project-prefix"],
        rememberAs: flags["remember-as"],
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
        "usage: agent-board update <id> [--status=<backlog|in_progress|review|done>] [--priority=<low|med|high>] [--agent=<name>] [--title=] [--worktree=] [--branch=] [--link=<url>] [--due-date=<YYYY-MM-DD>] [--notes=\"...\"] [--confirm] [--workspace=<name>]\n  (--notes overwrites the Description field; --confirm clears an \"unconfirmed\" mark)"
      );
      process.exit(1);
    }
    const body = { workspace: flags.workspace };
    for (const key of ["status", "priority", "agent", "title", "worktree", "branch", "link", "notes"]) {
      if (flags[key] !== undefined) body[key] = flags[key];
    }
    if (flags["due-date"] !== undefined) body.dueDate = flags["due-date"];
    if (positional.includes("--confirm")) body.unconfirmed = null; // clears the board's "unconfirmed" mark
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
      for (const p of projects) console.log(`${p.prefix}  ${p.name}${p.aliases?.length ? `  (also: ${p.aliases.join(", ")})` : ""}`);
      break;
    }
    if (sub === "create") {
      const name = positional[1];
      if (!name) {
        console.error("usage: agent-board project create <name> [--prefix=<prefix>] [--alias=<word>[,<word>...]] [--workspace=<name>]  (no --prefix: asks)");
        process.exit(1);
      }
      const p = await run(() => client.createProject({ name, prefix: flags.prefix, aliases: flags.alias, workspace: flags.workspace }));
      console.log(`created project ${p.name} (${p.prefix})${p.aliases?.length ? `, also called: ${p.aliases.join(", ")}` : ""}`);
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
    if (sub === "alias") {
      const [, project, ...words] = positional;
      if (!project || !words.length) {
        console.error("usage: agent-board project alias <project> <word> [<word>...] [--workspace=<name>]  (what you call it, e.g. 發表會)");
        process.exit(1);
      }
      const r = await run(() => client.addAliases(project, words, { workspace: flags.workspace }));
      console.log(r.added.length ? `${project} is also called: ${r.added.join(", ")}` : "nothing to add");
      break;
    }
    if (sub === "forget") {
      const alias = positional[1];
      if (!alias) {
        console.error("usage: agent-board project forget <word> [--workspace=<name>]  (undo a remembered answer, e.g. ops -> Operations)");
        process.exit(1);
      }
      await run(() => client.forgetAlias(alias, { workspace: flags.workspace }));
      console.log(`forgot ${alias}`);
      break;
    }
    console.error("usage: agent-board project <list|create|rename|delete|alias|forget> ...");
    process.exit(1);
  }

  case "config": {
    const [key, value] = positional;
    if (key === "ask" && value !== undefined) {
      const c = await run(() => client.setConfig({ ask: value }));
      console.log(`ask ${c.ask}`);
      break;
    }
    if (key === undefined || key === "ask") {
      const c = await run(() => client.getConfig());
      console.log(`ask ${c.ask}`);
      break;
    }
    console.error(`usage: agent-board config [ask [on|new|off]]
  ask on   unclear requests return a question for the user (default)
  ask new  only ask before creating a project; otherwise the board picks and marks the ticket "unconfirmed"
  ask off  never ask; the board picks and marks the ticket "unconfirmed" (an unknown project is an error)`);
    process.exit(1);
  }

  // stdio MCP — stdout belongs to JSON-RPC from here on, so nothing above
  // may print. The stdin listener keeps the process alive.
  case "mcp": {
    await import("./mcp/stdio.js");
    break;
  }

  default:
    console.error("usage: agent-board <list|create|update|delete|note|workspace|project|config|mcp> ...");
    process.exit(1);
}
