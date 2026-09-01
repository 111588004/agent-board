import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { Plus, X, Terminal, GripVertical, Filter, ChevronDown, Trash2, Clock, ChevronRight, GitBranch, FolderGit2, ExternalLink, Bold, List, Code2, Link2, CalendarDays, Folder, Bot, Flag, CornerDownRight, MoreHorizontal, Settings } from "lucide-react";
import * as api from "./api.js";

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
  { id: "pi", label: "Pi Agent", color: "#E8A33D" },
  { id: "other", label: "Other", color: "#8B8D98" },
];

const PRIORITIES = [
  { id: "low", label: "Low", color: "#8B8D98" },
  { id: "med", label: "Med", color: "#4C8DFF" },
  { id: "high", label: "High", color: "#E5484D" },
];

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

function reportError(action, err) {
  console.error(action, err);
  window.alert(`${action} failed: ${err.message}`);
}

export default function AgentBoard() {
  const [cards, setCards] = useState([]);
  const [projects, setProjects] = useState([]); // [{name, prefix, createdAt}]
  const [loaded, setLoaded] = useState(false);
  const [projectFilter, setProjectFilter] = useState("all");
  const [agentFilter, setAgentFilter] = useState("all");
  const [modalCard, setModalCard] = useState(null); // null = closed, {} = new
  const [dragId, setDragId] = useState(null);
  const [dragOverCol, setDragOverCol] = useState(null);
  const [view, setView] = useState("board"); // "board" | "list"
  const [sortKey, setSortKey] = useState("updatedAt");
  const [sortDir, setSortDir] = useState("desc");
  const [workspace, setWorkspace] = useState(api.getWorkspace());
  const [workspaces, setWorkspaces] = useState([]);
  const [meta, setMeta] = useState(null); // {version, source: "dev"|"npm", root, pid}

  useEffect(() => {
    api.listWorkspaces().then(setWorkspaces).catch((e) => reportError("Loading workspaces", e));
    api.getMeta().then(setMeta).catch(() => {}); // cosmetic only — don't bother the user if it fails
  }, []);

  useEffect(() => {
    setLoaded(false);
    (async () => {
      try {
        const [projectRows, taskRows] = await Promise.all([api.listProjects(), api.listTasks()]);
        setProjects(projectRows);
        setCards(taskRows);
      } catch (e) {
        reportError("Loading board", e);
      } finally {
        setLoaded(true);
      }
    })();
  }, [workspace]);

  async function switchWorkspace(name) {
    if (name === workspace) return;
    if (name === "__new__") {
      const newName = window.prompt("New workspace name");
      if (!newName) return;
      try {
        await api.createWorkspace(newName);
        setWorkspaces((prev) => Array.from(new Set([...prev, newName])).sort());
      } catch (e) {
        reportError("Create workspace", e);
        return;
      }
      name = newName;
    }
    api.setWorkspace(name);
    setWorkspace(name);
    setProjectFilter("all");
    setAgentFilter("all");
  }

  // target defaults to the currently-open workspace, but the hover "..." in
  // the switcher's own list can rename/delete a workspace without first
  // switching into it.
  async function renameWorkspaceByName(target) {
    const newName = window.prompt(`Rename workspace "${target}" to:`, target);
    if (!newName || newName === target) return;
    try {
      await api.renameWorkspace(target, newName);
      setWorkspaces((prev) => prev.map((w) => (w === target ? newName : w)).sort());
      if (target === workspace) {
        api.setWorkspace(newName);
        setWorkspace(newName);
      }
    } catch (e) {
      reportError("Rename workspace", e);
    }
  }

  async function deleteWorkspaceByName(target) {
    if (!window.confirm(`Delete workspace "${target}" and everything on it? This can't be undone.`)) return;
    try {
      await api.deleteWorkspace(target);
      setWorkspaces((prev) => prev.filter((w) => w !== target));
      if (target === workspace) {
        api.setWorkspace("default");
        setWorkspace("default");
        setProjectFilter("all");
        setAgentFilter("all");
      }
    } catch (e) {
      reportError("Delete workspace", e);
    }
  }

  const projectNames = useMemo(() => projects.map((p) => p.name).sort(), [projects]);

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
        case "id":
          return a.id.localeCompare(b.id, undefined, { numeric: true }) * dir;
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

  function openNew(status, parentId) {
    const parent = parentId ? cards.find((c) => c.id === parentId) : null;
    setModalCard({
      id: null,
      title: "",
      project: (parent && parent.project) || projectNames[0] || "",
      parentId: parentId || null,
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

  function openCard(card) {
    setModalCard(card);
  }

  async function saveModal(card) {
    try {
      if (card.id) {
        const updated = await api.updateTask(card.id, card);
        setCards((prev) => prev.map((c) => (c.id === card.id ? updated : c)));
      } else {
        const created = await api.createTask(card);
        setCards((prev) => [...prev, created]);
        setModalCard(null);
      }
    } catch (e) {
      reportError("Save", e);
    }
  }

  async function deleteCard(id) {
    try {
      await api.deleteTask(id);
      setCards((prev) => prev.filter((c) => c.id !== id));
      setModalCard(null);
    } catch (e) {
      reportError("Delete", e);
    }
  }

  async function moveCard(id, status) {
    try {
      const updated = await api.updateTask(id, { status });
      setCards((prev) => prev.map((c) => (c.id === id ? updated : c)));
    } catch (e) {
      reportError("Move", e);
    }
  }

  async function updateField(id, key, value) {
    try {
      const updated = await api.updateTask(id, { [key]: value });
      setCards((prev) => prev.map((c) => (c.id === id ? updated : c)));
    } catch (e) {
      reportError("Update", e);
    }
  }

  async function createProject(name, prefix) {
    const project = await api.createProject(name, prefix);
    setProjects((prev) => [...prev, project]);
    return project;
  }

  async function renameProjectByName(target) {
    const current = projects.find((p) => p.name === target);
    const newName = window.prompt(`Rename project "${target}" to:`, target);
    if (!newName) return;
    const newPrefix = window.prompt(`Ticket prefix for "${newName}":`, current?.prefix ?? "");
    if (!newPrefix) return;
    if (newName === target && newPrefix === current?.prefix) return;
    try {
      const updated = await api.renameProject(target, { name: newName, prefix: newPrefix });
      setProjects((prev) => prev.map((p) => (p.name === target ? updated : p)));
      setCards((prev) => prev.map((c) => (c.project === target ? { ...c, project: updated.name, projectPrefix: updated.prefix } : c)));
      if (projectFilter === target) setProjectFilter(updated.name);
    } catch (e) {
      reportError("Rename project", e);
    }
  }

  async function deleteProjectByName(target) {
    if (!window.confirm(`Delete project "${target}"? Only works if it has no tasks left.`)) return;
    try {
      await api.deleteProject(target);
      setProjects((prev) => prev.filter((p) => p.name !== target));
      if (projectFilter === target) setProjectFilter("all");
    } catch (e) {
      reportError("Delete project", e);
    }
  }

  function findCard(id) {
    return cards.find((c) => c.id === id);
  }

  if (!loaded) return null;

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
        html, body, #root { height: 100%; margin: 0; }
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
          {window.location.host}
        </span>
        {meta?.source === "dev" && (
          <span
            className="mono"
            title={`agent-board v${meta.version}\n${meta.root}\npid ${meta.pid}`}
            style={{
              fontSize: 10.5,
              padding: "2px 6px",
              borderRadius: 5,
              fontWeight: 700,
              background: "#3DCC7B22",
              color: "#3DCC7B",
              border: "1px solid #3DCC7B33",
            }}
          >
            DEV
          </span>
        )}
        <WorkspaceSwitcher
          workspace={workspace}
          workspaces={workspaces}
          onSwitch={switchWorkspace}
          onRename={renameWorkspaceByName}
          onDelete={deleteWorkspaceByName}
        />

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
          options={[{ id: "all", label: "All projects" }, ...projectNames.map((p) => ({ id: p, label: p }))]}
        />
        <ProjectManager
          projects={projects}
          onCreate={createProject}
          onRename={renameProjectByName}
          onDelete={deleteProjectByName}
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
          onOpen={openCard}
          projects={projectNames}
          onFieldChange={updateField}
          findCard={findCard}
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
                    onClick={() => openCard(c)}
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
                      <div style={{ minWidth: 0 }}>
                        <span className="mono" style={{ fontSize: 10, color: "#9599A3", display: "block", marginBottom: 2 }}>
                          {c.id}
                        </span>
                        <span style={{ fontSize: 13.5, fontWeight: 500, lineHeight: 1.35 }}>{c.title}</span>
                      </div>
                    </div>
                    {c.parentId && (
                      <button
                        onClick={(e) => { e.stopPropagation(); const p = findCard(c.parentId); if (p) openCard(p); }}
                        className="mono"
                        style={{
                          display: "flex", alignItems: "center", gap: 3, marginLeft: 19, marginTop: 4,
                          background: "none", border: "none", padding: 0, cursor: "pointer", color: "#9599A3", fontSize: 10.5,
                        }}
                      >
                        <CornerDownRight size={10} /> {c.parentId}
                      </button>
                    )}
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
          cards={cards}
          projects={projects}
          onClose={() => setModalCard(null)}
          onSave={saveModal}
          onDelete={deleteCard}
          onCreateProject={createProject}
          onOpenSubtask={(status, parentId) => openNew(status, parentId)}
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

// Self-styled listbox: the trigger IS the whole clickable box (no native
// <select> underneath), so the visible chip and the click target are
// guaranteed to be the same rectangle, and the open menu matches the app's
// own styling instead of falling back to the browser's unstyled OS list.
// The menu is portaled to <body> and positioned via the trigger's
// getBoundingClientRect() — otherwise an absolutely-positioned menu gets
// silently clipped by any ancestor with overflow:auto (e.g. the List view's
// scrollable table wrapper), which is exactly what happened before this.
function Dropdown({ value, options, onChange, renderTrigger, menuAlign = "left" }) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  function openMenu() {
    const rect = triggerRef.current.getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 4, left: rect.left, right: window.innerWidth - rect.right });
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e) {
      if (triggerRef.current?.contains(e.target)) return;
      if (menuRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    function onKeyDown(e) {
      if (e.key === "Escape") setOpen(false);
    }
    function onScroll() {
      setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  return (
    <span ref={triggerRef} style={{ display: "inline-block" }}>
      {renderTrigger({ onClick: (e) => { e.stopPropagation(); open ? setOpen(false) : openMenu(); } })}
      {open && menuPos && createPortal(
        <div
          ref={menuRef}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            top: menuPos.top,
            [menuAlign]: menuAlign === "right" ? menuPos.right : menuPos.left,
            zIndex: 1000,
            background: "#fff",
            border: "1px solid #E4E6EB",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(20,22,30,0.14)",
            padding: 4,
            minWidth: 130,
          }}
        >
          {options.map((o) => (
            <div
              key={o.id}
              onClick={() => { onChange(o.id); setOpen(false); }}
              style={{
                padding: "6px 10px",
                borderRadius: 5,
                fontSize: 12.5,
                fontWeight: o.id === value ? 600 : 400,
                color: "#1D2027",
                background: o.id === value ? "#F0F4FF" : "transparent",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
              onMouseEnter={(e) => { if (o.id !== value) e.currentTarget.style.background = "#F4F5F7"; }}
              onMouseLeave={(e) => { if (o.id !== value) e.currentTarget.style.background = "transparent"; }}
            >
              {o.label}
            </div>
          ))}
        </div>,
        document.body
      )}
    </span>
  );
}

// Bespoke rather than built on Dropdown: each row needs its own hover-reveal
// "..." (rename/delete for that specific workspace, not necessarily the
// active one) — a per-row nested menu that the generic Dropdown's flat
// options list has no notion of.
function WorkspaceSwitcher({ workspace, workspaces, onSwitch, onRename, onDelete }) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState(null);
  const [hoveredRow, setHoveredRow] = useState(null);
  const [actionsFor, setActionsFor] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  function openMenu() {
    const rect = triggerRef.current.getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 4, left: rect.left });
    setOpen(true);
  }

  function closeAll() {
    setOpen(false);
    setActionsFor(null);
  }

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e) {
      if (triggerRef.current?.contains(e.target)) return;
      if (menuRef.current?.contains(e.target)) return;
      closeAll();
    }
    function onKeyDown(e) {
      if (e.key === "Escape") closeAll();
    }
    function onScroll() {
      closeAll();
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  return (
    <span ref={triggerRef} style={{ display: "inline-block" }}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); open ? closeAll() : openMenu(); }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "#22262F",
          border: "none",
          borderRadius: 7,
          padding: "6px 10px",
          color: "#D7D9DE",
          fontSize: 12.5,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        <Folder size={13} />
        {workspace}
        <ChevronDown size={12} color="#8B8D98" />
      </button>
      {open && menuPos && createPortal(
        <div
          ref={menuRef}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            top: menuPos.top,
            left: menuPos.left,
            zIndex: 1000,
            background: "#fff",
            border: "1px solid #E4E6EB",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(20,22,30,0.14)",
            padding: 4,
            minWidth: 170,
          }}
        >
          {workspaces.map((w) => (
            <div
              key={w}
              onMouseEnter={() => setHoveredRow(w)}
              onMouseLeave={() => setHoveredRow((h) => (h === w ? null : h))}
              onClick={() => { onSwitch(w); closeAll(); }}
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                padding: "6px 4px 6px 10px",
                borderRadius: 5,
                fontSize: 12.5,
                fontWeight: w === workspace ? 600 : 400,
                color: "#1D2027",
                background: w === workspace ? "#F0F4FF" : "transparent",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              <span>{w}</span>
              {w !== "default" && (hoveredRow === w || actionsFor === w) && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setActionsFor((a) => (a === w ? null : w)); }}
                  style={{ background: "none", border: "none", color: "#8B8D98", cursor: "pointer", padding: 2, display: "flex", borderRadius: 4 }}
                >
                  <MoreHorizontal size={14} />
                </button>
              )}
              {actionsFor === w && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    position: "absolute",
                    top: "calc(100% + 2px)",
                    right: 0,
                    zIndex: 10,
                    background: "#fff",
                    border: "1px solid #E4E6EB",
                    borderRadius: 8,
                    boxShadow: "0 8px 24px rgba(20,22,30,0.14)",
                    padding: 4,
                    minWidth: 110,
                  }}
                >
                  <div
                    onClick={() => { closeAll(); onRename(w); }}
                    style={{ padding: "6px 10px", borderRadius: 5, fontSize: 12.5, cursor: "pointer" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#F4F5F7")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    Rename
                  </div>
                  <div
                    onClick={() => { closeAll(); onDelete(w); }}
                    style={{ padding: "6px 10px", borderRadius: 5, fontSize: 12.5, cursor: "pointer", color: "#E5484D" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#FDEDEE")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    Delete
                  </div>
                </div>
              )}
            </div>
          ))}
          <div
            onClick={() => { onSwitch("__new__"); closeAll(); }}
            style={{ padding: "6px 10px", borderRadius: 5, fontSize: 12.5, color: "#1D2027", cursor: "pointer", whiteSpace: "nowrap" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#F4F5F7")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            + New workspace
          </div>
        </div>,
        document.body
      )}
    </span>
  );
}

// Same hover-reveal row-actions pattern as WorkspaceSwitcher — a plain list
// panel rather than a select, since this manages the set of projects, not a
// current selection (that's what the "All projects" FilterSelect is for).
function ProjectManager({ projects, onCreate, onRename, onDelete }) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState(null);
  const [hoveredRow, setHoveredRow] = useState(null);
  const [actionsFor, setActionsFor] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  function openMenu() {
    const rect = triggerRef.current.getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 4, left: rect.left });
    setOpen(true);
  }

  function closeAll() {
    setOpen(false);
    setActionsFor(null);
  }

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e) {
      if (triggerRef.current?.contains(e.target)) return;
      if (menuRef.current?.contains(e.target)) return;
      closeAll();
    }
    function onKeyDown(e) {
      if (e.key === "Escape") closeAll();
    }
    function onScroll() {
      closeAll();
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  async function createNew() {
    const name = window.prompt("New project name");
    if (!name) return;
    const prefix = window.prompt(`Ticket prefix for "${name}" (e.g. AB)`);
    if (!prefix) return;
    try {
      await onCreate(name, prefix);
    } catch (e) {
      window.alert(e.message);
    }
  }

  return (
    <span ref={triggerRef} style={{ display: "inline-block" }}>
      <button
        type="button"
        title="Manage projects"
        onClick={(e) => { e.stopPropagation(); open ? closeAll() : openMenu(); }}
        style={{
          display: "flex",
          alignItems: "center",
          background: "none",
          border: "1px solid #E4E6EB",
          borderRadius: 7,
          padding: 6,
          color: "#5B5F69",
          cursor: "pointer",
        }}
      >
        <Settings size={14} />
      </button>
      {open && menuPos && createPortal(
        <div
          ref={menuRef}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            top: menuPos.top,
            left: menuPos.left,
            zIndex: 1000,
            background: "#fff",
            border: "1px solid #E4E6EB",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(20,22,30,0.14)",
            padding: 4,
            minWidth: 190,
          }}
        >
          {projects.map((p) => (
            <div
              key={p.name}
              onMouseEnter={() => setHoveredRow(p.name)}
              onMouseLeave={() => setHoveredRow((h) => (h === p.name ? null : h))}
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                padding: "6px 4px 6px 10px",
                borderRadius: 5,
                fontSize: 12.5,
                color: "#1D2027",
                whiteSpace: "nowrap",
              }}
            >
              <span className="mono" style={{ color: "#8B8D98", marginRight: 4 }}>{p.prefix}</span>
              <span style={{ flex: 1 }}>{p.name}</span>
              {(hoveredRow === p.name || actionsFor === p.name) && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setActionsFor((a) => (a === p.name ? null : p.name)); }}
                  style={{ background: "none", border: "none", color: "#8B8D98", cursor: "pointer", padding: 2, display: "flex", borderRadius: 4 }}
                >
                  <MoreHorizontal size={14} />
                </button>
              )}
              {actionsFor === p.name && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    position: "absolute",
                    top: "calc(100% + 2px)",
                    right: 0,
                    zIndex: 10,
                    background: "#fff",
                    border: "1px solid #E4E6EB",
                    borderRadius: 8,
                    boxShadow: "0 8px 24px rgba(20,22,30,0.14)",
                    padding: 4,
                    minWidth: 110,
                  }}
                >
                  <div
                    onClick={() => { closeAll(); onRename(p.name); }}
                    style={{ padding: "6px 10px", borderRadius: 5, fontSize: 12.5, cursor: "pointer" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#F4F5F7")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    Rename
                  </div>
                  <div
                    onClick={() => { closeAll(); onDelete(p.name); }}
                    style={{ padding: "6px 10px", borderRadius: 5, fontSize: 12.5, cursor: "pointer", color: "#E5484D" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#FDEDEE")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    Delete
                  </div>
                </div>
              )}
            </div>
          ))}
          <div
            onClick={() => { createNew(); closeAll(); }}
            style={{ padding: "6px 10px", borderRadius: 5, fontSize: 12.5, color: "#1D2027", cursor: "pointer", whiteSpace: "nowrap" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#F4F5F7")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            + New project
          </div>
        </div>,
        document.body
      )}
    </span>
  );
}

function ChipSelect({ value, onChange, options, colorFor }) {
  const color = colorFor(value);
  const label = options.find((o) => o.id === value)?.label ?? value;
  return (
    <Dropdown
      value={value}
      options={options}
      onChange={onChange}
      renderTrigger={({ onClick }) => (
        <button
          type="button"
          onClick={onClick}
          className="mono"
          style={{
            fontSize: 10.5,
            padding: "2px 6px",
            borderRadius: 5,
            background: color ? `${color}1A` : "#F0F1F4",
            color: color || "#5B5F69",
            fontWeight: 600,
            border: color ? `1px solid ${color}33` : "1px solid #E4E6EB",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {label}
        </button>
      )}
    />
  );
}

// for fields with no tag/chip identity elsewhere in the UI (priority is just a
// dot on the kanban card, never a pill) — the whole cell is the click target,
// styled as plain text so it doesn't read as a badge that isn't one.
function BlockSelect({ value, onChange, options, color }) {
  const label = options.find((o) => o.id === value)?.label ?? value;
  return (
    <Dropdown
      value={value}
      options={options}
      onChange={onChange}
      menuAlign="right"
      renderTrigger={({ onClick }) => (
        <button
          type="button"
          onClick={onClick}
          className="detail-value"
          style={{ ...detailInputStyle, width: "auto", textAlign: "left", color: color || "#42454D", fontWeight: 600 }}
        >
          {label}
        </button>
      )}
    />
  );
}

function ListView({ tasks, sortKey, sortDir, onSort, onOpen, projects, onFieldChange, findCard }) {
  return (
    <div style={{ flex: 1, overflow: "auto", padding: "18px 22px" }}>
      <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #E4E6EB", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#F7F8FA", borderBottom: "1px solid #E4E6EB" }}>
              <SortHeader label="Key" sortKeyName="id" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
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
                <td className="mono" style={{ padding: "10px 12px", fontSize: 11, color: "#9599A3", whiteSpace: "nowrap" }}>
                  {t.id}
                </td>
                <td style={{ padding: "10px 12px", fontSize: 13.5, fontWeight: 500 }}>
                  {t.title}
                  {t.parentId && (
                    <button
                      onClick={(e) => { e.stopPropagation(); const p = findCard(t.parentId); if (p) onOpen(p); }}
                      className="mono"
                      style={{
                        display: "flex", alignItems: "center", gap: 3, marginTop: 3,
                        background: "none", border: "none", padding: 0, cursor: "pointer", color: "#9599A3", fontSize: 10.5, fontWeight: 400,
                      }}
                    >
                      <CornerDownRight size={10} /> {t.parentId}
                    </button>
                  )}
                </td>
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
                <td colSpan={7} style={{ padding: "24px 12px", textAlign: "center", fontSize: 12.5, color: "#9599A3" }}>
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
  const label = options.find((o) => o.id === value)?.label ?? value;
  return (
    <Dropdown
      value={value}
      options={options}
      onChange={onChange}
      renderTrigger={({ onClick }) => (
        <button
          type="button"
          onClick={onClick}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: light ? "#fff" : "#22262F",
            border: light ? "1px solid #E4E6EB" : "none",
            borderRadius: 7,
            padding: "6px 10px",
            color: light ? "#42454D" : "#D7D9DE",
            fontSize: 12.5,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {icon}
          {label}
          <ChevronDown size={12} color="#8B8D98" />
        </button>
      )}
    />
  );
}

function TaskDrawer({ card, cards, projects, onClose, onSave, onDelete, onCreateProject, onOpenSubtask }) {
  const [form, setForm] = useState(card);
  const [editingNotes, setEditingNotes] = useState(!card.notes || !card.notes.trim());
  const [notesDraft, setNotesDraft] = useState(card.notes || "");
  const notesRef = useRef(null);

  const projectNames = projects.map((p) => p.name);
  // two-tier only: a subtask can't itself be a parent, and can't be its own parent
  const parentCandidates = cards.filter(
    (c) => c.project === form.project && !c.parentId && c.id !== form.id
  );

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
    if (!card.id) return;
    if (
      form.title === card.title &&
      (form.worktree || "") === (card.worktree || "") &&
      (form.branch || "") === (card.branch || "") &&
      (form.link || "") === (card.link || "")
    ) return;
    onSave(form);
  }

  function closeAndSave() {
    blurSave();
    onClose();
  }

  async function handleProjectChange(e) {
    if (e.target.value === "__new__") {
      const name = window.prompt("New project name");
      if (!name) return;
      const prefix = window.prompt("Project prefix (used in ticket ids, e.g. AB → AB-1)");
      if (!prefix) return;
      try {
        const project = await onCreateProject(name, prefix.toUpperCase());
        setAndSave("project", project.name);
      } catch (err) {
        window.alert(`Failed to create project: ${err.message}`);
      }
    } else {
      setAndSave("project", e.target.value);
    }
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
          <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: "#8B8D98", letterSpacing: 0.5 }}>
            {card.id || "New task"}
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
              <select
                value={form.project}
                onChange={handleProjectChange}
                className="detail-value"
                style={detailInputStyle}
              >
                {projectNames.length === 0 && <option value="">—</option>}
                {projectNames.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
                <option value="__new__">+ New project…</option>
              </select>
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
            <DetailRow icon={<CalendarDays size={13} />} label="Due date">
              <input
                type="date"
                value={form.dueDate || ""}
                onChange={(e) => setAndSave("dueDate", e.target.value)}
                className="detail-value"
                style={detailInputStyle}
              />
            </DetailRow>
            <DetailRow icon={<CornerDownRight size={13} />} label="Parent" last>
              <select
                value={form.parentId || ""}
                onChange={(e) => setAndSave("parentId", e.target.value || null)}
                className="detail-value"
                style={detailInputStyle}
                disabled={parentCandidates.length === 0 && !form.parentId}
              >
                <option value="">— none —</option>
                {parentCandidates.map((p) => (
                  <option key={p.id} value={p.id}>{p.id} — {p.title}</option>
                ))}
              </select>
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

          {card.id && !card.parentId && (
            <button
              onClick={() => { closeAndSave(); onOpenSubtask(card.status, card.id); }}
              className="card-btn"
              style={{
                display: "flex", alignItems: "center", gap: 6, marginTop: 4,
                background: "none", border: "1px dashed #E4E6EB", borderRadius: 7,
                padding: "8px 11px", fontSize: 12.5, color: "#6B6F79", cursor: "pointer", width: "100%",
              }}
            >
              <CornerDownRight size={13} /> Add subtask
            </button>
          )}
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
              disabled={!form.title.trim() || !form.project}
              onClick={() => onSave(form)}
              style={{
                background: form.title.trim() && form.project ? "#D97757" : "#E4E6EB",
                color: form.title.trim() && form.project ? "#fff" : "#9599A3",
                border: "none",
                borderRadius: 7,
                padding: "8px 16px",
                fontSize: 13,
                fontWeight: 600,
                cursor: form.title.trim() && form.project ? "pointer" : "not-allowed",
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
