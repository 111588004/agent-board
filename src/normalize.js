// deterministic input cleanup shared by the REST routes: project lookup
// (name / name ignoring case / prefix / trimmed) and status/priority aliases.
const ALIASES = {
  status: {
    backlog: ["待辦", "todo", "open", "新", "new"],
    in_progress: ["進行中", "doing", "wip", "in progress", "started"],
    review: ["審查", "in review"],
    done: ["完成", "closed", "finished"],
  },
  priority: {
    low: ["低", "p3"],
    med: ["中", "medium", "normal", "p2"],
    high: ["高", "urgent", "p0", "p1", "critical"],
  },
};

// case-insensitive; space, "_" and "-" are interchangeable ("in-progress", "IN_PROGRESS")
const squash = (s) => s.trim().toLowerCase().replace(/[\s_-]+/g, " ");

// -> { value } (canonical) or { error } (400 text listing allowed values)
export function normalizeEnum(field, raw) {
  const key = typeof raw === "string" ? squash(raw) : null;
  for (const [value, list] of Object.entries(ALIASES[field])) {
    if ([value, ...list].some((a) => squash(a) === key)) return { value };
  }
  const allowed = Object.keys(ALIASES[field]).join(", ");
  const aliases = Object.entries(ALIASES[field]).map(([v, l]) => `${v}: ${l.join("/")}`).join("; ");
  return { error: `invalid ${field} "${raw}" — allowed: ${allowed} (aliases: ${aliases})` };
}

// dueDate: a real calendar date as YYYY-MM-DD (what the web's date picker sends), or null/"" to clear
// -> { value } (the date, or null) or { error, code } (400)
export function normalizeDueDate(raw) {
  if (raw === null || raw === "") return { value: null };
  const s = typeof raw === "string" ? raw.trim() : "";
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const d = m && new Date(Date.UTC(+m[1], m[2] - 1, +m[3]));
  if (d && d.toISOString().slice(0, 10) === s) return { value: s }; // round trip rules out 2026-02-30
  return { error: `invalid dueDate ${JSON.stringify(raw)} — use YYYY-MM-DD, e.g. 2026-03-05 (or empty to clear it)`, code: "invalid_due_date" };
}

// The board can't tell what the user meant -> ask instead of guessing. 422 with
// a question and <=4 options; each option's `args` are the fields to send again.
// `answerArg` names the field a free-text answer goes in. Clients render it as
// "ask the user" (or, with asking turned off, as a plain error — `error` alone
// is readable either way).
export function needsInput(question, options, answerArg) {
  options = options.slice(0, 4);
  const list = options.map((o, i) => `${i + 1}) ${o.label} — ${o.description}`).join("; ");
  const error = `needs input: ${question}${list ? ` Options: ${list}` : ""}`;
  return { status: 422, body: { error, code: "needs_input", question, options, ...(answerArg && { answerArg }) } };
}

// D15: the prefix is the user's call — these are only offered as options.
export function suggestPrefixes(name, projects, n) {
  const taken = new Set(projects.map((p) => p.prefix.toUpperCase()));
  const words = String(name).toUpperCase().match(/[A-Z0-9]+/g) || [];
  const joined = words.join("");
  const candidates = [
    words.length > 1 && words.map((w) => w[0]).join(""),
    joined.slice(0, 2), joined.slice(0, 3), joined.slice(0, 4),
    "PRJ", "PJ", "P", // names with no ASCII letters (e.g. 發表會)
  ];
  return [...new Set(candidates)].filter((c) => c && !taken.has(c)).slice(0, n);
}

// -> { project, picked? } or { status, body }. An exact name wins, then a word
// the user already answered for (project_aliases), then name-ignoring-case and
// prefix, which must point at exactly one project. When they don't:
// - ask "on": needs_input — every option carries rememberAs, so the user's
//   answer is learned and the same word won't be asked again
// - ask "new"/"off": pick the busiest candidate (ties: oldest) and return
//   `picked` (why) for the caller to flag the ticket as unconfirmed
// `offerNew` (creating a task) and no match: ask "on"/"new" asks — existing
// project, or a new one with a prefix the user picks (D15: never auto-created);
// "off" and reads get a plain 404 listing the projects.
export function resolveProject(db, input, { offerNew = false, ask = "on" } = {}) {
  const projects = db.prepare("SELECT * FROM projects ORDER BY createdAt").all();
  const s = String(input ?? "").trim();
  const lower = s.toLowerCase();
  const exact = projects.filter((p) => p.name === s);
  if (exact.length === 1) return { project: exact[0] };
  const alias = db.prepare("SELECT project FROM project_aliases WHERE alias = ?").get(lower);
  const aliased = alias && projects.find((p) => p.name === alias.project);
  if (aliased) return { project: aliased };
  const hits = projects.filter((p) => p.name.toLowerCase() === lower || p.prefix.toLowerCase() === lower);
  if (hits.length === 1) return { project: hits[0] };
  if (hits.length > 1) {
    if (ask !== "on") {
      const count = db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE project = ?");
      const best = hits.reduce((a, b) => (count.get(b.name).n > count.get(a.name).n ? b : a)); // hits are oldest-first, so ties keep the oldest
      return { project: best, picked: `"${s}" matched ${hits.map((p) => p.name).join(", ")}; picked ${best.name} (most tickets)` };
    }
    return needsInput(
      `"${s}" matches ${hits.length} projects in this workspace — which one?`,
      hits.map((p) => ({ label: p.name, description: `project "${p.name}", tickets ${p.prefix}-N`, args: { project: p.name, rememberAs: s } })),
      "project"
    );
  }
  if (offerNew && s && ask !== "off") {
    const near = projects.filter((p) => p.name.toLowerCase().includes(lower) || lower.includes(p.name.toLowerCase()));
    const options = (near.length ? near : projects).slice(0, 2).map((p) => ({
      label: `Use ${p.name}`,
      description: `existing project, tickets ${p.prefix}-N`,
      args: { project: p.name, rememberAs: s },
    }));
    for (const prefix of suggestPrefixes(s, projects, Math.min(3, 4 - options.length))) {
      options.push({
        label: `New project ${s} (${prefix})`,
        description: `create project "${s}" with ticket prefix ${prefix} (${prefix}-1, ${prefix}-2, …)`,
        args: { project: s, newProjectPrefix: prefix },
      });
    }
    return needsInput(`This workspace has no project "${s}". Put the ticket in an existing project, or create "${s}" — with which ticket prefix?`, options);
  }
  const list = projects.map((p) => `${p.name} (${p.prefix})`).join(", ");
  const error = projects.length
    ? `unknown project "${s}". Existing projects: ${list}. Retry with one of these names or prefixes; to create a new project, create it first.`
    : `unknown project "${s}", and this workspace has no projects yet. Create a project first, then retry.`;
  return { status: 404, body: { error, code: "unknown_project", input: s } };
}

// the user's answer to "which project?" (rememberAs): store word -> project so the same word
// resolves next time. Skipped only when the word already resolves to that project by itself —
// not merely because it equals the project's name ignoring case: "beta" for Beta was asked about
// because it is also project Other's prefix BETA, so it has to be remembered. -> the stored word or null
export function rememberAnswer(db, rememberAs, projectName) {
  const word = typeof rememberAs === "string" ? rememberAs.trim().toLowerCase() : "";
  if (!word || resolveProject(db, word).project?.name === projectName) return null;
  db.prepare("INSERT OR REPLACE INTO project_aliases (alias, project) VALUES (?, ?)").run(word, projectName);
  return word;
}
