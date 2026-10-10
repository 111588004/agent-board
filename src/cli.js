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

// --name=value, plus the on/off flags, which also stand alone (--detach = --detach=true).
// "--name value" is refused, not guessed: it used to be dropped without a word ("list --project Alpha" listed everything)
const BOOLEAN_FLAGS = ["detach", "confirm"];
const BOOLEAN_VALUES = { true: true, yes: true, on: true, 1: true, false: false, no: false, off: false, 0: false };
const flags = {};
const positional = [];
for (const [i, arg] of rest.entries()) {
  const m = arg.match(/^--([^=]+)(?:=(.*))?$/s);
  if (!m) {
    positional.push(arg);
    continue;
  }
  const [, name, value] = m;
  if (BOOLEAN_FLAGS.includes(name)) {
    const v = value === undefined ? "true" : value.trim().toLowerCase();
    flags[name] = Object.hasOwn(BOOLEAN_VALUES, v) ? BOOLEAN_VALUES[v] : undefined;
    if (flags[name] === undefined) {
      console.error(`agent-board: --${name} is on or off: --${name}, --${name}=true or --${name}=false (got --${name}=${value})`);
      process.exit(1);
    }
  } else if (value !== undefined) {
    flags[name] = value;
  } else {
    const next = rest[i + 1];
    const example = next !== undefined && !next.startsWith("--") ? JSON.stringify(next) : "<value>";
    console.error(`agent-board: --${name} needs its value after "=": --${name}=${example}  (only --${BOOLEAN_FLAGS.join(" and --")} stand alone)`);
    process.exit(1);
  }
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
  // REST field -> CLI flag; parentId is --parent, and a null arg ("no parent") means leave the flag out
  const flag = (k, v) => `--${k === "parentId" ? "parent" : k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}=${JSON.stringify(String(v))}`;
  const lines = [`agent-board: needs your input — ${e.question}`];
  e.options.forEach((o, i) => {
    const args = Object.entries(o.args)
      .filter(([k, v]) => k !== "name" && v !== null && v !== undefined) // name is positional
      .map(([k, v]) => flag(k, v))
      .join(" ");
    lines.push(`  ${i + 1}) ${o.label} — ${o.description}`, `     rerun with: ${args}`);
  });
  if (e.answerArg) lines.push(`  or answer in your own words: ${flag(e.answerArg, "...")}`);
  lines.push("(agents: ask the user — don't pick for them)");
  console.error(lines.join("\n"));
}

// subtasks are listed under their parent (indented), with the parent's progress; a subtask whose
// parent isn't in this listing (filtered out) stays in place and names it
function printTasks(tasks) {
  if (!tasks.length) {
    console.log("(no tasks)");
    return;
  }
  const line = (t) => `${t.id}  [${t.status}]  ${t.title}  (${t.agent || "-"}, ${t.priority})`;
  const listed = new Set(tasks.map((t) => t.id));
  for (const t of tasks) {
    if (t.parentId && listed.has(t.parentId)) continue; // printed under its parent
    const progress = t.subtaskCount ? `  [${t.subtasksDone}/${t.subtaskCount} done]` : "";
    console.log(`${line(t)}${progress}${t.parentId ? `  (↳ ${t.parentId})` : ""}`);
    for (const s of tasks) if (s.parentId === t.id) console.log(`  ↳ ${line(s)}`);
  }
}

// a server note worth seeing right after a write, e.g. "all subtasks of AB-4 are done"
function printHint(task) {
  if (task && task.hint) console.log(`note: ${task.hint}`);
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
    if (!flags.project && !flags.parent) {
      console.error(
        'usage: agent-board create --title="..." --project=<name> [--new-project-prefix=<prefix>] [--remember-as=<word>] [--parent=<id>] [--agent=<name>] [--priority=<low|med|high>] [--status=<backlog|in_progress|review|done>] [--due-date=<YYYY-MM-DD>] [--worktree=<path>] [--branch=<name>] [--link=<url>] [--notes="..."] [--workspace=<name>]\n  (--notes sets the Description field; with --parent, --project can be left out: a subtask goes in its parent\'s project)'
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
    console.log(`created ${task.id}${task.parentId ? ` (subtask of ${task.parentId})` : ""}`);
    printHint(task);
    break;
  }

  case "update": {
    const id = positional[0];
    if (!id) {
      console.error(
        "usage: agent-board update <id> [--status=<backlog|in_progress|review|done>] [--priority=<low|med|high>] [--agent=<name>] [--title=] [--worktree=] [--branch=] [--link=<url>] [--due-date=<YYYY-MM-DD>] [--parent=<id>|none] [--notes=\"...\"] [--confirm] [--workspace=<name>]\n  (--notes overwrites the Description field; --parent=none detaches a subtask from its parent; --confirm clears an \"unconfirmed\" mark)"
      );
      process.exit(1);
    }
    const body = { workspace: flags.workspace };
    for (const key of ["status", "priority", "agent", "title", "worktree", "branch", "link", "notes"]) {
      if (flags[key] !== undefined) body[key] = flags[key];
    }
    if (flags["due-date"] !== undefined) body.dueDate = flags["due-date"];
    if (flags.parent !== undefined) {
      // an empty --parent= is refused rather than read as "detach": it's what an unset shell variable looks like
      if (!flags.parent.trim()) {
        console.error("agent-board: --parent needs a ticket id, or --parent=none to detach it from its parent");
        process.exit(1);
      }
      body.parentId = flags.parent.trim().toLowerCase() === "none" ? null : flags.parent.trim();
    }
    if (flags.confirm) body.unconfirmed = null; // clears the board's "unconfirmed" mark
    const task = await run(() => client.updateTask(id, body));
    // a server from before parent changes ignores parentId silently — say so instead of claiming it worked
    if ("parentId" in body && (task.parentId ?? null) !== body.parentId) {
      console.error(`agent-board: the server didn't change ${task.id}'s parent — it's too old for that; update it`);
      process.exit(1);
    }
    console.log(`updated ${task.id}`);
    printHint(task);
    break;
  }

  case "move": {
    const id = positional[0];
    if (!id || !flags.project) {
      console.error(
        "usage: agent-board move <id> --project=<name> [--new-project-prefix=<prefix>] [--detach] [--agent=<name>] [--workspace=<name>]\n  (the ticket gets a new id in that project and its subtasks come along; old ids keep working. A subtask moves alone only with --detach, which takes it out of its parent)"
      );
      process.exit(1);
    }
    const res = await run(() =>
      client.moveTask(id, {
        project: flags.project,
        newProjectPrefix: flags["new-project-prefix"],
        rememberAs: flags["remember-as"],
        detach: flags.detach || undefined,
        agent: flags.agent,
        workspace: flags.workspace,
      })
    );
    for (const m of res.moved) console.log(`moved ${m.from} → ${m.to}`);
    printHint(res);
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
    // noteAgent, not agent: --agent tags the note line and never reassigns the ticket
    const task = await run(() => client.updateTask(id, { note: text, noteAgent: flags.agent, workspace: flags.workspace }));
    console.log(`noted ${task.id}`);
    printHint(task); // e.g. "AB-5 is now OPS-12" when an old id was used
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
