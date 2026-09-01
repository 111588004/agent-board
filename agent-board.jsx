import { useState, useEffect, useMemo, useRef } from "react";
import { Plus, X, Terminal, GripVertical, Filter, ChevronDown, Trash2, Clock, ChevronRight, GitBranch, FolderGit2, ExternalLink, Bold, List, Code2, Link2, CalendarDays, Folder, Bot, Flag } from "lucide-react";

const COLUMNS = [
  { id: "backlog", label: "Backlog", color: "#8B8D98" },
  { id: "in_progress", label: "In Progress", color: "#4C8DFF" },
  { id: "review", label: "Review", color: "#E8A33D" },
  { id: "done", label: "Done", color: "#3DCC7B" },
];

const PRIORITY_RANK = { low: 0, med: 1, high: 2 };

const AGENTS = [
  { id: "claude", label: "Claude Code", color: "#D97757" },
  { id: "codex", label: "Codex", color: "#10A37F" },
  { id: "opencode", label: "OpenCode", color: "#6E56CF" },
  { id: "gemini", label: "Gemini CLI", color: "#4285F4" },
  { id: "aider", label: "Aider", color: "#E8A33D" },
  { id: "other", label: "Other", color: "#8B8D98" },
];

const PRIORITIES = [
  { id: "low", label: "Low", color: "#8B8D98" },
  { id: "med", label: "Med", color: "#4C8DFF" },
  { id: "high", label: "High", color: "#E5484D" },
];

const STORAGE_KEY = "agent-board:v1";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function agentMeta(id) {
  return AGENTS.find((a) => a.id === id) || AGENTS[AGENTS.length - 1];
}
function priorityMeta(id) {
  return PRIORITIES.find((p) => p.id === id) || PRIORITIES[0];
}
function statusMeta(id) {
  return COLUMNS.find((c) => c.id === id) || COLUMNS[0];
}

// ponytail: regex-based, handles the subset of markdown notes actually need
// (bold, code, links, bullets, checkboxes). Swap for a real parser if notes
// start using tables/headings/nesting.
function renderMarkdown(src) {
  if (!src) return "";
  const esc = (s) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (line) =>
    esc(line)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');

  const blocks = [];
  let list = null;
  for (const raw of src.split("\n")) {
    const line = raw.trim();
    const check = line.match(/^-\s\[([ x])\]\s(.*)/i);
    const bullet = line.match(/^[-*]\s(.*)/);
    if (check || bullet) {
      if (!list) list = [];
      list.push(
        check
          ? `<li style="list-style:none;margin-left:-18px"><input type="checkbox" disabled ${check[1].toLowerCase() === "x" ? "checked" : ""} style="margin-right:6px" />${inline(check[2])}</li>`
          : `<li>${inline(bullet[1])}</li>`
      );
      continue;
    }
    if (list) {
      blocks.push(`<ul style="margin:4px 0 10px;padding-left:18px">${list.join("")}</ul>`);
      list = null;
    }
    blocks.push(line ? `<p style="margin:0 0 8px">${inline(line)}</p>` : "");
  }
  if (list) blocks.push(`<ul style="margin:4px 0 10px;padding-left:18px">${list.join("")}</ul>`);
  return blocks.join("");
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

const seedCards = () => [
  {
    id: uid(),
    title: "Migrate auth middleware to new session store",
    project: "core-api",
    agent: "claude",
    priority: "high",
    status: "in_progress",
    notes: "Blocked on confirming the new session store's token TTL with backend.\n\n- [ ] Migrate `SessionMiddleware` to `SessionStoreV2`\n- [ ] Backfill existing sessions\n\nSee `docs/session-store.md` for the target shape.",
    worktree: "~/code/core-api/.worktrees/session-store",
    branch: "feature/session-store",
    link: "https://github.com/acme/core-api/pull/512",
    dueDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 3).toISOString().slice(0, 10),
    updatedAt: Date.now() - 1000 * 60 * 40,
  },
  {
    id: uid(),
    title: "Generate OpenAPI types for billing service",
    project: "billing",
    agent: "codex",
    priority: "med",
    status: "backlog",
    notes: "",
    updatedAt: Date.now() - 1000 * 60 * 60 * 5,
  },
  {
    id: uid(),
    title: "Refactor CSV import to streaming parser",
    project: "core-api",
    agent: "opencode",
    priority: "med",
    status: "review",
    notes: "PR #482 open, waiting on my review.",
    updatedAt: Date.now() - 1000 * 60 * 60 * 20,
  },
  {
    id: uid(),
    title: "Add retry/backoff to webhook dispatcher",
    project: "notifications",
    agent: "claude",
    priority: "low",
    status: "done",
    notes: "Merged to main.",
    updatedAt: Date.now() - 1000 * 60 * 60 * 30,
  },
];

export default function AgentBoard() {
  const [cards, setCards] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [projectFilter, setProjectFilter] = useState("all");
  const [agentFilter, setAgentFilter] = useState("all");
  const [modalCard, setModalCard] = useState(null); // null = closed, {} = new
  const [dragId, setDragId] = useState(null);
  const [dragOverCol, setDragOverCol] = useState(null);
  const [view, setView] = useState("board"); // "board" | "list"
  const [sortKey, setSortKey] = useState("updatedAt");
  const [sortDir, setSortDir] = useState("desc");
  const saveTimer = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get(STORAGE_KEY, false);
        if (res && res.value) {
          setCards(JSON.parse(res.value));
        } else {
          setCards(seedCards());
        }
      } catch (e) {
        setCards(seedCards());
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await window.storage.set(STORAGE_KEY, JSON.stringify(cards), false);
      } catch (e) {
        // best effort
      }
    }, 300);
  }, [cards, loaded]);

  const projects = useMemo(() => {
    const set = new Set(cards.map((c) => c.project).filter(Boolean));
    return Array.from(set).sort();
  }, [cards]);

  const filtered = useMemo(() => {
    return cards.filter(
      (c) =>
        (projectFilter === "all" || c.project === projectFilter) &&
        (agentFilter === "all" || c.agent === agentFilter)
    );
  }, [cards, projectFilter, agentFilter]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case "title":
          return a.title.localeCompare(b.title) * dir;
        case "project":
          return (a.project || "").localeCompare(b.project || "") * dir;
        case "agent":
          return agentMeta(a.agent).label.localeCompare(agentMeta(b.agent).label) * dir;
        case "priority":
          return (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]) * dir;
        case "status":
          return (
            (COLUMNS.findIndex((c) => c.id === a.status) -
              COLUMNS.findIndex((c) => c.id === b.status)) *
            dir
          );
        default:
          return (a.updatedAt - b.updatedAt) * dir;
      }
    });
  }, [filtered, sortKey, sortDir]);

  function toggleSort(key) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function openNew(status) {
    setModalCard({
      id: null,
      title: "",
      project: projects[0] || "",
      agent: "claude",
      priority: "med",
      status: status || "backlog",
      notes: "",
      worktree: "",
      branch: "",
      link: "",
      dueDate: "",
    });
  }

  function saveModal(card) {
    if (card.id) {
      setCards((prev) =>
        prev.map((c) => (c.id === card.id ? { ...card, updatedAt: Date.now() } : c))
      );
    } else {
      setCards((prev) => [
        ...prev,
        { ...card, id: uid(), updatedAt: Date.now() },
      ]);
    }
    setModalCard(null);
  }

  function deleteCard(id) {
    setCards((prev) => prev.filter((c) => c.id !== id));
    setModalCard(null);
  }

  function moveCard(id, status) {
    setCards((prev) =>
      prev.map((c) => (c.id === id ? { ...c, status, updatedAt: Date.now() } : c))
    );
  }

  function updateField(id, key, value) {
    setCards((prev) =>
      prev.map((c) => (c.id === id ? { ...c, [key]: value, updatedAt: Date.now() } : c))
    );
  }

  return (
    <div
      style={{
        fontFamily:
          "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        background: "#F4F5F7",
        minHeight: "100%",
        color: "#1D2027",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { height: 8px; width: 8px; }
        ::-webkit-scrollbar-thumb { background: #C7CBD4; border-radius: 8px; }
        .mono { font-family: 'JetBrains Mono', monospace; }
        .card-btn { transition: background .12s ease, box-shadow .12s ease, transform .08s ease; }
        .card-btn:active { transform: scale(0.995); }
        .col-drop { transition: background .15s ease; }
        select:focus, input:focus, textarea:focus { outline: 2px solid #4C8DFF; outline-offset: 1px; }
        @keyframes drawer-in { from { transform: translateX(100%); } to { transform: translateX(0); } }
        .drawer-title:focus { outline: none; background: #FAFAFB; }
        .drawer-collapse summary { cursor: pointer; list-style: none; }
        .drawer-collapse summary::-webkit-details-marker { display: none; }
        .detail-value:hover { background: #F4F5F7; }
      `}</style>

      {/* Header */}
      <div
        style={{
          background: "#181B21",
          color: "#fff",
          padding: "14px 22px",
          display: "flex",
          alignItems: "center",
          gap: 14,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Terminal size={18} color="#D97757" />
          <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: 0.2 }}>
            Agent Board
          </span>
        </div>
        <span
          className="mono"
          style={{ fontSize: 11, color: "#8B8D98", marginLeft: 2 }}
        >
          local · manual updates
        </span>

        <div style={{ flex: 1 }} />

        <button
          className="card-btn"
          onClick={() => openNew()}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "#D97757",
            color: "#fff",
            border: "none",
            borderRadius: 7,
            padding: "8px 14px",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <Plus size={15} /> New task
        </button>
      </div>

      {/* Toolbar — view switch + filters, left-aligned above the board */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 22px 0",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", background: "#E4E6EB", borderRadius: 7, padding: 3, gap: 2 }}>
          {["board", "list"].map((v) => (
            <button
              key={v}
              className="card-btn"
              onClick={() => setView(v)}
              style={{
                background: view === v ? "#fff" : "transparent",
                color: view === v ? "#1D2027" : "#6B6F79",
                boxShadow: view === v ? "0 1px 2px rgba(9,10,12,0.1)" : "none",
                border: "none",
                borderRadius: 5,
                padding: "5px 10px",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                textTransform: "capitalize",
              }}
            >
              {v}
            </button>
          ))}
        </div>

        <FilterSelect
          light
          icon={<Filter size={13} />}
          value={projectFilter}
          onChange={setProjectFilter}
          options={[{ id: "all", label: "All projects" }, ...projects.map((p) => ({ id: p, label: p }))]}
        />
        <FilterSelect
          light
          value={agentFilter}
          onChange={setAgentFilter}
          options={[{ id: "all", label: "All agents" }, ...AGENTS.map((a) => ({ id: a.id, label: a.label }))]}
        />
      </div>

      {/* Board */}
      {view === "list" ? (
        <ListView
          tasks={sorted}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={toggleSort}
          onOpen={setModalCard}
          projects={projects}
          onFieldChange={updateField}
        />
      ) : (
      <div
        style={{
          flex: 1,
          display: "flex",
          gap: 16,
          padding: "18px 22px",
          overflowX: "auto",
          alignItems: "flex-start",
        }}
      >
        {COLUMNS.map((col) => {
          const colCards = filtered.filter((c) => c.status === col.id);
          const isOver = dragOverCol === col.id;
          return (
            <div
              key={col.id}
              className="col-drop"
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverCol(col.id);
              }}
              onDragLeave={() => setDragOverCol((cur) => (cur === col.id ? null : cur))}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId) moveCard(dragId, col.id);
                setDragId(null);
                setDragOverCol(null);
              }}
              style={{
                background: isOver ? "#E9ECF4" : "#EBECF0",
                borderRadius: 10,
                minWidth: 268,
                width: 268,
                flexShrink: 0,
                display: "flex",
                flexDirection: "column",
                maxHeight: "calc(100vh - 130px)",
              }}
            >
              <div
                style={{
                  padding: "12px 12px 8px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span style={{ fontSize: 12.5, fontWeight: 700, color: "#42454D", textTransform: "uppercase", letterSpacing: 0.5 }}>
                  {col.label}
                </span>
                <span
                  className="mono"
                  style={{ fontSize: 11, color: "#8B8D98", background: "#DEE1E8", borderRadius: 5, padding: "1px 6px" }}
                >
                  {colCards.length}
                </span>
              </div>

              <div style={{ overflowY: "auto", padding: "0 8px 8px", flex: 1 }}>
                {colCards.map((c) => (
                  <div
                    key={c.id}
                    draggable
                    onDragStart={() => setDragId(c.id)}
                    onDragEnd={() => setDragId(null)}
                    onClick={() => setModalCard(c)}
                    className="card-btn"
                    style={{
                      background: "#fff",
                      borderRadius: 8,
                      padding: "10px 11px",
                      marginBottom: 8,
                      cursor: "grab",
                      boxShadow: "0 1px 2px rgba(9,10,12,0.08)",
                      border: "1px solid #E4E6EB",
                      opacity: dragId === c.id ? 0.4 : 1,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                      <GripVertical size={13} color="#C7CBD4" style={{ marginTop: 2, flexShrink: 0 }} />
                      <span style={{ fontSize: 13.5, fontWeight: 500, lineHeight: 1.35 }}>{c.title}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: 9, marginLeft: 19 }}>
                      <Chip label={c.project} />
                      <Chip
                        label={agentMeta(c.agent).label}
                        color={agentMeta(c.agent).color}
                      />
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: 99,
                          background: priorityMeta(c.priority).color,
                        }}
                        title={priorityMeta(c.priority).label}
                      />
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 7, marginLeft: 19, color: "#9599A3" }}>
                      <Clock size={10.5} />
                      <span style={{ fontSize: 10.5 }}>{timeAgo(c.updatedAt)}</span>
                    </div>
                  </div>
                ))}

                <button
                  onClick={() => openNew(col.id)}
                  className="card-btn"
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    background: "transparent",
                    border: "none",
                    color: "#6B6F79",
                    fontSize: 12.5,
                    padding: "7px 4px",
                    cursor: "pointer",
                    borderRadius: 6,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#DEE1E8")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <Plus size={13} /> Add task
                </button>
              </div>
            </div>
          );
        })}
      </div>
      )}

      {modalCard && (
        <TaskDrawer
          key={modalCard.id || "new"}
          card={modalCard}
          projects={projects}
          onClose={() => setModalCard(null)}
          onSave={saveModal}
          onDelete={deleteCard}
        />
      )}
    </div>
  );
}

function Chip({ label, color }) {
  if (!label) return null;
  return (
    <span
      className="mono"
      style={{
        fontSize: 10.5,
        padding: "2px 6px",
        borderRadius: 5,
        background: color ? `${color}1A` : "#F0F1F4",
        color: color || "#5B5F69",
        fontWeight: 600,
        border: color ? `1px solid ${color}33` : "1px solid #E4E6EB",
      }}
    >
      {label}
    </span>
  );
}

function SortHeader({ label, sortKeyName, sortKey, sortDir, onSort, align }) {
  const active = sortKey === sortKeyName;
  return (
    <th
      onClick={() => onSort(sortKeyName)}
      style={{
        textAlign: align || "left",
        padding: "10px 12px",
        fontSize: 11,
        fontWeight: 700,
        color: active ? "#42454D" : "#8B8D98",
        textTransform: "uppercase",
        letterSpacing: 0.5,
        cursor: "pointer",
        userSelect: "none",
        whiteSpace: "nowrap",
      }}
    >
      {label}
      {active ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
    </th>
  );
}

function ChipSelect({ value, onChange, options, colorFor }) {
  const color = colorFor(value);
  return (
    <select
      value={value}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value)}
      className="mono"
      style={{
        appearance: "none",
        fontSize: 10.5,
        padding: "2px 6px",
        borderRadius: 5,
        background: color ? `${color}1A` : "#F0F1F4",
        color: color || "#5B5F69",
        fontWeight: 600,
        border: color ? `1px solid ${color}33` : "1px solid #E4E6EB",
        cursor: "pointer",
      }}
    >
      {options.map((o) => (
        <option key={o.id} value={o.id} style={{ color: "#000" }}>{o.label}</option>
      ))}
    </select>
  );
}

// for fields with no tag/chip identity elsewhere in the UI (priority is just a
// dot on the kanban card, never a pill) — the whole cell is the click target,
// styled as plain text so it doesn't read as a badge that isn't one.
function BlockSelect({ value, onChange, options, color }) {
  return (
    <select
      value={value}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value)}
      className="detail-value"
      style={{ ...detailInputStyle, textAlign: "left", color: color || "#42454D", fontWeight: 600 }}
    >
      {options.map((o) => (
        <option key={o.id} value={o.id} style={{ color: "#000" }}>{o.label}</option>
      ))}
    </select>
  );
}

function ListView({ tasks, sortKey, sortDir, onSort, onOpen, projects, onFieldChange }) {
  return (
    <div style={{ flex: 1, overflow: "auto", padding: "18px 22px" }}>
      <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #E4E6EB", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#F7F8FA", borderBottom: "1px solid #E4E6EB" }}>
              <SortHeader label="Title" sortKeyName="title" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortHeader label="Project" sortKeyName="project" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortHeader label="Agent" sortKeyName="agent" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortHeader label="Priority" sortKeyName="priority" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortHeader label="Status" sortKeyName="status" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortHeader label="Updated" sortKeyName="updatedAt" sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr
                key={t.id}
                onClick={() => onOpen(t)}
                style={{ borderBottom: "1px solid #F0F1F4", cursor: "pointer" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#FAFAFB")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <td style={{ padding: "10px 12px", fontSize: 13.5, fontWeight: 500 }}>{t.title}</td>
                <td style={{ padding: "10px 12px" }}>
                  <ChipSelect
                    value={t.project}
                    onChange={(v) => onFieldChange(t.id, "project", v)}
                    options={projects.map((p) => ({ id: p, label: p }))}
                    colorFor={() => null}
                  />
                </td>
                <td style={{ padding: "10px 12px" }}>
                  <ChipSelect
                    value={t.agent}
                    onChange={(v) => onFieldChange(t.id, "agent", v)}
                    options={AGENTS}
                    colorFor={(v) => agentMeta(v).color}
                  />
                </td>
                <td style={{ padding: "6px 12px" }}>
                  <BlockSelect
                    value={t.priority}
                    onChange={(v) => onFieldChange(t.id, "priority", v)}
                    options={PRIORITIES}
                    color={priorityMeta(t.priority).color}
                  />
                </td>
                <td style={{ padding: "10px 12px" }}>
                  <ChipSelect
                    value={t.status}
                    onChange={(v) => onFieldChange(t.id, "status", v)}
                    options={COLUMNS}
                    colorFor={(v) => statusMeta(v).color}
                  />
                </td>
                <td className="mono" style={{ padding: "10px 12px", textAlign: "right", fontSize: 11, color: "#9599A3" }}>
                  {timeAgo(t.updatedAt)}
                </td>
              </tr>
            ))}
            {tasks.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: "24px 12px", textAlign: "center", fontSize: 12.5, color: "#9599A3" }}>
                  No tasks match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilterSelect({ value, onChange, options, icon, light }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: light ? "#fff" : "#22262F",
        border: light ? "1px solid #E4E6EB" : "none",
        borderRadius: 7,
        padding: "6px 10px",
      }}
    >
      {icon}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: "transparent",
          color: light ? "#42454D" : "#D7D9DE",
          border: "none",
          fontSize: 12.5,
          cursor: "pointer",
          appearance: "none",
        }}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id} style={{ color: "#000" }}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={12} color="#8B8D98" />
    </div>
  );
}

function TaskDrawer({ card, projects, onClose, onSave, onDelete }) {
  const [form, setForm] = useState(card);
  const [customProject, setCustomProject] = useState(!projects.includes(card.project) && !!card.project);
  const [editingNotes, setEditingNotes] = useState(!card.notes || !card.notes.trim());
  const [notesDraft, setNotesDraft] = useState(card.notes || "");
  const notesRef = useRef(null);

  function set(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  // existing tasks autosave (matches Jira — no explicit Save for edits);
  // a brand-new task has no row to write to yet, so it still needs Create.
  function setAndSave(k, v) {
    setForm((f) => {
      const next = { ...f, [k]: v };
      if (card.id) onSave(next);
      return next;
    });
  }

  function blurSave() {
    if (card.id) onSave(form);
  }

  function closeAndSave() {
    blurSave();
    onClose();
  }

  function applyMd(prefix, suffix = prefix, placeholder = "") {
    const el = notesRef.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e, value } = el;
    const selected = value.slice(s, e) || placeholder;
    const next = value.slice(0, s) + prefix + selected + suffix + value.slice(e);
    setNotesDraft(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + prefix.length, s + prefix.length + selected.length);
    });
  }

  function applyList() {
    const el = notesRef.current;
    if (!el) return;
    const { selectionStart: s, value } = el;
    const lineStart = value.lastIndexOf("\n", s - 1) + 1;
    const next = value.slice(0, lineStart) + "- " + value.slice(lineStart);
    setNotesDraft(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + 2, s + 2);
    });
  }

  function applyLink() {
    const url = window.prompt("Link URL");
    if (!url) return;
    applyMd("[", `](${url})`, "text");
  }

  function saveNotes() {
    setAndSave("notes", notesDraft);
    setEditingNotes(false);
  }

  function cancelNotes() {
    setNotesDraft(form.notes);
    setEditingNotes(false);
  }

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") closeAndSave();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50 }}>
      {/* click-outside catcher — no dim, board stays fully visible like Jira's split detail view */}
      <div onClick={closeAndSave} style={{ position: "absolute", inset: 0 }} />

      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          height: "100%",
          width: 460,
          maxWidth: "92vw",
          background: "#fff",
          boxShadow: "-8px 0 32px rgba(9,10,12,0.18)",
          animation: "drawer-in .18s ease",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "14px 18px", borderBottom: "1px solid #E4E6EB", flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 700, color: "#8B8D98", textTransform: "uppercase", letterSpacing: 0.5 }}>
            {card.id ? "Task" : "New task"}
          </span>
          <button onClick={closeAndSave} style={{ background: "none", border: "none", cursor: "pointer", color: "#8B8D98", display: "flex" }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px" }}>
          <input
            autoFocus
            className="drawer-title"
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            onBlur={blurSave}
            placeholder="What is the agent doing?"
            style={{
              width: "100%", border: "1px solid transparent", borderRadius: 6, padding: "4px 6px",
              marginLeft: -6, fontSize: 17, fontWeight: 700, fontFamily: "inherit", background: "transparent",
              marginBottom: 14,
            }}
          />

          {/* status — its own pill, like Jira's "To Do ▾" button above the Details block */}
          <div style={{ position: "relative", display: "inline-block", marginBottom: 16 }}>
            <select
              value={form.status}
              onChange={(e) => setAndSave("status", e.target.value)}
              style={{
                appearance: "none", border: "none", borderRadius: 20, padding: "6px 28px 6px 12px",
                fontSize: 12.5, fontWeight: 700, cursor: "pointer",
                background: `${statusMeta(form.status).color}1A`, color: statusMeta(form.status).color,
              }}
            >
              {COLUMNS.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
            <ChevronDown
              size={12}
              style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: statusMeta(form.status).color }}
            />
          </div>

          {/* details — compact vertical rows, icon + label left, value right (mirrors Jira's Details panel) */}
          <div style={{ border: "1px solid #E4E6EB", borderRadius: 8, padding: "2px 10px", marginBottom: 16 }}>
            <DetailRow icon={<Folder size={13} />} label="Project">
              {customProject ? (
                <input
                  value={form.project}
                  onChange={(e) => set("project", e.target.value)}
                  onBlur={blurSave}
                  placeholder="project-name"
                  className="detail-value"
                  style={detailInputStyle}
                />
              ) : (
                <select
                  value={form.project}
                  onChange={(e) => {
                    if (e.target.value === "__new__") {
                      setCustomProject(true);
                      set("project", "");
                    } else setAndSave("project", e.target.value);
                  }}
                  className="detail-value"
                  style={detailInputStyle}
                >
                  {projects.length === 0 && <option value="">—</option>}
                  {projects.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                  <option value="__new__">+ New project…</option>
                </select>
              )}
            </DetailRow>
            <DetailRow icon={<Bot size={13} />} label="Agent">
              <select value={form.agent} onChange={(e) => setAndSave("agent", e.target.value)} className="detail-value" style={detailInputStyle}>
                {AGENTS.map((a) => (
                  <option key={a.id} value={a.id}>{a.label}</option>
                ))}
              </select>
            </DetailRow>
            <DetailRow icon={<Flag size={13} />} label="Priority">
              <select value={form.priority} onChange={(e) => setAndSave("priority", e.target.value)} className="detail-value" style={detailInputStyle}>
                {PRIORITIES.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </DetailRow>
            <DetailRow icon={<CalendarDays size={13} />} label="Due date" last>
              <input
                type="date"
                value={form.dueDate || ""}
                onChange={(e) => setAndSave("dueDate", e.target.value)}
                className="detail-value"
                style={detailInputStyle}
              />
            </DetailRow>
          </div>

          <Field label="Description">
            {editingNotes ? (
              <div>
                <div
                  style={{
                    display: "flex", gap: 2, padding: 6, background: "#F4F5F7",
                    border: "1px solid #E4E6EB", borderBottom: "none", borderRadius: "7px 7px 0 0",
                  }}
                >
                  <ToolbarBtn title="Bold" onClick={() => applyMd("**")}><Bold size={13} /></ToolbarBtn>
                  <ToolbarBtn title="Code" onClick={() => applyMd("`")}><Code2 size={13} /></ToolbarBtn>
                  <ToolbarBtn title="Bullet list" onClick={applyList}><List size={13} /></ToolbarBtn>
                  <ToolbarBtn title="Link" onClick={applyLink}><Link2 size={13} /></ToolbarBtn>
                </div>
                <textarea
                  ref={notesRef}
                  autoFocus
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  placeholder="markdown — blockers, checklist, links…"
                  rows={5}
                  style={{
                    ...inputStyle, borderRadius: "0 0 7px 7px", resize: "vertical",
                    fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
                  }}
                />
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button
                    onClick={saveNotes}
                    style={{
                      background: "#D97757", color: "#fff", border: "none", borderRadius: 6,
                      padding: "6px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                    }}
                  >
                    Save
                  </button>
                  <button
                    onClick={cancelNotes}
                    style={{
                      background: "none", color: "#6B6F79", border: "1px solid #E4E6EB", borderRadius: 6,
                      padding: "6px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : form.notes.trim() ? (
              <div
                onClick={() => { setNotesDraft(form.notes); setEditingNotes(true); }}
                className="card-btn"
                style={{ padding: "9px 11px", borderRadius: 7, fontSize: 12.5, lineHeight: 1.5, color: "#31343B", cursor: "text" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#FAFAFB")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(form.notes) }}
              />
            ) : (
              <button
                onClick={() => { setNotesDraft(""); setEditingNotes(true); }}
                style={{
                  width: "100%", textAlign: "left", background: "none", border: "1px dashed #E4E6EB",
                  borderRadius: 7, padding: "9px 11px", fontSize: 12.5, color: "#9599A3", cursor: "pointer",
                }}
              >
                + Add a description
              </button>
            )}
          </Field>

          <details className="drawer-collapse" open style={{ marginTop: 4 }}>
            <summary style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 0", borderTop: "1px solid #E4E6EB" }}>
              <ChevronRight size={13} color="#8B8D98" style={{ transition: "transform .12s" }} className="dev-chevron" />
              <FolderGit2 size={13} color="#6B6F79" />
              <span style={{ fontSize: 11, fontWeight: 700, color: "#6B6F79", textTransform: "uppercase", letterSpacing: 0.5 }}>
                Development
              </span>
            </summary>
            <div style={{ paddingLeft: 2 }}>
              <div style={{ display: "flex", gap: 10 }}>
                <Field label="Worktree" style={{ flex: 1 }}>
                  <input
                    className="mono"
                    value={form.worktree || ""}
                    onChange={(e) => set("worktree", e.target.value)}
                    onBlur={blurSave}
                    placeholder="~/code/project/.worktrees/…"
                    style={{ ...inputStyle, fontSize: 12 }}
                  />
                </Field>
                <Field label="Branch" style={{ flex: 1 }}>
                  <input
                    className="mono"
                    value={form.branch || ""}
                    onChange={(e) => set("branch", e.target.value)}
                    onBlur={blurSave}
                    placeholder="feature/…"
                    style={{ ...inputStyle, fontSize: 12 }}
                  />
                </Field>
              </div>
              <Field label="Link">
                <input
                  value={form.link || ""}
                  onChange={(e) => set("link", e.target.value)}
                  onBlur={blurSave}
                  placeholder="repo / PR / issue URL"
                  style={inputStyle}
                />
              </Field>
              {form.link && (
                <a
                  href={form.link}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#4C8DFF",
                    textDecoration: "none", marginTop: -4, marginBottom: 12,
                  }}
                >
                  <GitBranch size={12} /> <span style={{ wordBreak: "break-all" }}>{form.link}</span>
                  <ExternalLink size={11} style={{ flexShrink: 0 }} />
                </a>
              )}
            </div>
          </details>
        </div>

        <div
          style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "12px 18px", borderTop: "1px solid #E4E6EB", flexShrink: 0,
          }}
        >
          {card.id ? (
            <button
              onClick={() => onDelete(card.id)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                background: "none", border: "none", color: "#E5484D", fontSize: 12.5, cursor: "pointer",
              }}
            >
              <Trash2 size={14} /> Delete
            </button>
          ) : <span />}
          {card.id ? (
            <span style={{ fontSize: 11.5, color: "#9599A3" }}>Changes save automatically</span>
          ) : (
            <button
              disabled={!form.title.trim()}
              onClick={() => onSave(form)}
              style={{
                background: form.title.trim() ? "#D97757" : "#E4E6EB",
                color: form.title.trim() ? "#fff" : "#9599A3",
                border: "none",
                borderRadius: 7,
                padding: "8px 16px",
                fontSize: 13,
                fontWeight: 600,
                cursor: form.title.trim() ? "pointer" : "not-allowed",
              }}
            >
              Create
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailRow({ icon, label, children, last }) {
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 10, padding: "8px 2px",
        borderBottom: last ? "none" : "1px solid #F0F1F4",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7, width: 92, flexShrink: 0, color: "#6B6F79", fontSize: 12.5 }}>
        {icon}
        <span>{label}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}

function ToolbarBtn({ onClick, title, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="card-btn"
      style={{
        display: "flex", alignItems: "center", justifyContent: "center", width: 26, height: 26,
        background: "transparent", border: "none", borderRadius: 5, color: "#5B5F69", cursor: "pointer",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "#E4E6EB")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {children}
    </button>
  );
}

function Field({ label, children, style }) {
  return (
    <div style={{ marginBottom: 12, ...style }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#6B6F79", marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.4 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

const inputStyle = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 7,
  border: "1px solid #E4E6EB",
  fontSize: 13.5,
  fontFamily: "inherit",
  background: "#FAFAFB",
};

const detailInputStyle = {
  width: "100%",
  border: "none",
  background: "transparent",
  fontSize: 13,
  fontFamily: "inherit",
  color: "#1D2027",
  cursor: "pointer",
  padding: "3px 6px",
  borderRadius: 5,
  appearance: "none",
  textAlign: "right",
};
