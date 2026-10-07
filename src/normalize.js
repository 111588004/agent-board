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

// -> { project } (row) or { status, body }. Never guesses: a step must match exactly one row.
export function resolveProject(db, input) {
  const projects = db.prepare("SELECT * FROM projects ORDER BY createdAt").all();
  const s = String(input ?? "").trim();
  const steps = [
    (p) => p.name === s,
    (p) => p.name.toLowerCase() === s.toLowerCase(),
    (p) => p.prefix.toLowerCase() === s.toLowerCase(),
  ];
  for (const step of steps) {
    const hits = projects.filter(step);
    if (hits.length === 1) return { project: hits[0] };
  }
  const list = projects.map((p) => `${p.name} (${p.prefix})`).join(", ");
  const error = projects.length
    ? `unknown project "${s}". Existing projects: ${list}. Retry with one of these names or prefixes; to create a new project, create it first.`
    : `unknown project "${s}", and this workspace has no projects yet. Create a project first, then retry.`;
  return { status: 404, body: { error, code: "unknown_project", input: s } };
}
