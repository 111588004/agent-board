import { Fragment, useState, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { Plus, X, Terminal, GripVertical, Filter, ChevronDown, ChevronLeft, Trash2, Clock, ChevronRight, GitBranch, FolderGit2, ExternalLink, Bold, List, ListOrdered, Code2, Link2, Image, Heading1, Heading2, Heading3, CalendarDays, Folder, Bot, Flag, CornerDownRight, MoreHorizontal, Pencil, Copy, Check, HelpCircle, BookOpen, CircleAlert, CircleDashed, AlignLeft, ChevronUp, Equal, Users } from "lucide-react";
import { BrandMark } from "./theme.jsx";
import * as api from "./api.js";
import { AGENT_ICONS } from "./agentIcons.js";
import { LAUNCH_TARGETS, buildLaunchText } from "./launch.js";
import Tour, { TOUR_SEEN_KEY, readStore, writeStore, demoTicket, isSeedProject, guideUrl } from "./Tour.jsx";

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

// Jira's convention (the shape carries the level, so it reads without color too — WCAG 1.4.1):
// ˄ high, = medium, ˅ low, warm to cool
const PRIORITIES = [
  { id: "low", label: "Low", color: "#4C8DFF" },
  { id: "med", label: "Med", color: "#E8A33D" },
  { id: "high", label: "High", color: "#E5484D" },
];

const UNASSIGNED_AGENT = { id: null, label: "Unassigned", color: "#8B8D98" };
// the agent filter's value for "nobody has it yet" (a ticket's agent is null, which a menu id can't be)
// agent menus carry an icon + a group heading; narrower than this they look cramped
const AGENT_MENU_MIN_WIDTH = 200;
const UNASSIGNED_FILTER = "__unassigned__";
const AGENT_OPTIONS = // grouped in the menus: nobody | AGENTS (the named ones) | the catch-all
[UNASSIGNED_AGENT, ...AGENTS].map((a, i) => ({
  ...a,
  groupLabel: i === 1 ? "Agents" : undefined,
  dividerBefore: a.id === "other",
  icon: a.id ? <AgentIcon agent={a.id} color={a.color} /> : <CircleDashed size={14} color="#9599A3" style={{ flexShrink: 0 }} aria-hidden="true" />,
}));

function agentMeta(id) {
  if (!id) return UNASSIGNED_AGENT;
  return AGENTS.find((a) => a.id === id) || AGENTS[AGENTS.length - 1];
}
// the agent's own solid mark (agentIcons.js); "Other" gets a generic bot, Unassigned gets nothing
function AgentIcon({ agent, size = 14, color = "currentColor" }) {
  if (!agent) return null;
  const mark = AGENT_ICONS[agentMeta(agent).id];
  if (!mark) return <Bot size={size} color={color} strokeWidth={2.2} style={{ flexShrink: 0 }} aria-hidden="true" />;
  return (
    <svg width={size} height={size} viewBox={mark.viewBox} fill={color} fillRule="evenodd" style={{ flexShrink: 0 }} aria-hidden="true">
      {mark.paths.map((d) => <path key={d} d={d} clipRule="evenodd" />)}
    </svg>
  );
}
function priorityMeta(id) {
  return PRIORITIES.find((p) => p.id === id) || PRIORITIES[0];
}
function PriorityIcon({ priority, size = 15 }) {
  const { id, color } = priorityMeta(priority);
  const Icon = id === "high" ? ChevronUp : id === "med" ? Equal : ChevronDown;
  return <Icon size={size} color={color} strokeWidth={2.6} style={{ flexShrink: 0 }} aria-hidden="true" />;
}
// the same options with their icon, for the menus — highest first, as in Jira
const PRIORITY_OPTIONS = [...PRIORITIES].reverse().map((p) => ({ ...p, icon: <PriorityIcon priority={p.id} /> }));
function statusMeta(id) {
  return COLUMNS.find((c) => c.id === id) || COLUMNS[0];
}

// ponytail: regex-based, handles the subset of markdown notes actually need
// (bold, code, links, bare-URL autolink, images, headings, bulleted/numbered
// lists, checkboxes). Swap for a real parser if notes start using
// tables/nesting.
function renderMarkdown(src) {
  if (!src) return "";
  const esc = (s) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (line) =>
    esc(line)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      // images before links — "![alt](url)" would otherwise also match the
      // link pattern below and leave a stray "!" in front of the <a>
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;border-radius:6px;margin:4px 0;display:block;" />')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
      // autolink bare URLs — skipped right after href="/src=" so a URL that
      // just became part of a link/image above doesn't get wrapped again
      .replace(/(?<!href=")(?<!src=")(https?:\/\/[^\s<>"]+)/g, '<a href="$1" target="_blank" rel="noreferrer">$1</a>');

  const blocks = [];
  let list = null; // { type: "ul" | "ol", items: [] }
  function flushList() {
    if (!list) return;
    const tag = list.type;
    blocks.push(`<${tag} style="margin:4px 0 10px;padding-left:18px">${list.items.join("")}</${tag}>`);
    list = null;
  }
  for (const raw of src.split("\n")) {
    const line = raw.trim();
    const heading = line.match(/^(#{1,3})\s+(.*)/);
    if (heading) {
      flushList();
      const level = heading[1].length;
      const size = { 1: 17, 2: 15, 3: 13.5 }[level];
      blocks.push(`<div style="font-size:${size}px;font-weight:700;margin:${level === 1 ? "10px" : "8px"} 0 4px">${inline(heading[2])}</div>`);
      continue;
    }
    const check = line.match(/^-\s\[([ x])\]\s(.*)/i);
    const bullet = line.match(/^[-*]\s(.*)/);
    const numbered = line.match(/^\d+[.)]\s(.*)/);
    if (check || bullet || numbered) {
      const type = numbered ? "ol" : "ul";
      if (!list || list.type !== type) {
        flushList();
        list = { type, items: [] };
      }
      list.items.push(
        check
          ? `<li style="list-style:none;margin-left:-18px"><input type="checkbox" disabled ${check[1].toLowerCase() === "x" ? "checked" : ""} style="margin-right:6px" />${inline(check[2])}</li>`
          : `<li>${inline((bullet || numbered)[1])}</li>`
      );
      continue;
    }
    flushList();
    blocks.push(line ? `<p style="margin:0 0 8px">${inline(line)}</p>` : "");
  }
  flushList();
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

const POLL_MS = 3000; // live-update interval, see the polling effect in AgentBoard

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
  const [toast, setToast] = useState(null); // {key, message, card?}
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [dragId, setDragId] = useState(null);
  const [dragOverCol, setDragOverCol] = useState(null);
  const [view, setView] = useState("board"); // "board" | "list"
  const [sortKey, setSortKey] = useState("updatedAt");
  const [sortDir, setSortDir] = useState("desc");
  const [workspace, setWorkspace] = useState(api.getWorkspace());
  const [workspaces, setWorkspaces] = useState([]);
  const [meta, setMeta] = useState(null); // {version, source: "dev"|"npm", root, pid}
  const [tourOpen, setTourOpen] = useState(false);

  useEffect(() => {
    api.listWorkspaces().then(setWorkspaces).catch((e) => reportError("Loading workspaces", e));
    api.getMeta().then(setMeta).catch(() => {}); // cosmetic only — don't bother the user if it fails
  }, []);

  // refs so the polling loop below reads the latest values without
  // restarting its timer on every render
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const dragIdRef = useRef(dragId);
  dragIdRef.current = dragId;

  // initial load + live updates: re-fetch every POLL_MS so changes agents
  // make via the CLI/MCP show up without a manual refresh. TaskDrawer and
  // the dialogs edit their own local copy (form/notesDraft state), so
  // replacing `cards` here never clobbers half-typed input.
  useEffect(() => {
    let cancelled = false; // a response for a workspace we've since left must not land
    let timer = null;
    let inFlight = false;
    let first = true;
    setLoaded(false);

    async function poll() {
      clearTimeout(timer);
      if (inFlight) return;
      inFlight = true;
      const before = cardsRef.current;
      try {
        const [projectRows, taskRows] = await Promise.all([api.listProjects(), api.listTasks()]);
        if (cancelled) return;
        // skip this round if a local edit landed while we were fetching (its
        // response may be newer than ours) or a card is mid-drag (re-rendering
        // the column would cancel the drag) — the next tick catches up
        if (first || (cardsRef.current === before && !dragIdRef.current)) {
          // unchanged data keeps the old array, so nothing re-renders or jumps
          setCards((prev) => (JSON.stringify(prev) === JSON.stringify(taskRows) ? prev : taskRows));
          setProjects((prev) => (JSON.stringify(prev) === JSON.stringify(projectRows) ? prev : projectRows));
        }
      } catch (e) {
        if (cancelled) return;
        // only the first load alerts; a later failure is usually the server
        // restarting, so stay quiet and let the next tick reconnect
        if (first) reportError("Loading board", e);
      } finally {
        inFlight = false;
        if (!cancelled) {
          if (first) setLoaded(true);
          first = false;
          if (document.visibilityState === "visible") timer = setTimeout(poll, POLL_MS);
        }
      }
    }

    // paused while the tab is hidden; fetch right away when it comes back
    function onVisibility() {
      if (document.visibilityState === "visible") poll();
      else clearTimeout(timer);
    }

    poll();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [workspace]);

  // Deep link: `?task=SB-1` opens that card's detail once the first load is in, and the
  // address bar follows whichever card is open, so the URL can be copied or sent as it is
  // (the mod and the CLI print these links). `?workspace=` keeps selecting the board.
  const deepLinked = useRef(false);
  useEffect(() => {
    if (!loaded || deepLinked.current) return;
    deepLinked.current = true;
    const id = new URLSearchParams(window.location.search).get("task");
    const card = id && cards.find((c) => c.id === id);
    if (card) setModalCard(card);
  }, [loaded, cards]);

  // first visit: start the tour (AB-30) — but not over a ?task= link someone followed to a card
  const tourChecked = useRef(false);
  useEffect(() => {
    if (!loaded || tourChecked.current) return;
    tourChecked.current = true;
    const params = new URLSearchParams(window.location.search);
    if (params.has("tour")) { // the guide's "run the tour" link
      const url = new URL(window.location.href);
      url.searchParams.delete("tour");
      window.history.replaceState(null, "", url);
      startTour();
    } else if (!readStore(TOUR_SEEN_KEY) && !params.has("task")) startTour();
  }, [loaded]);

  function startTour() {
    setView("board");
    setModalCard(null);
    setNewProjectOpen(false);
    setTourOpen(true);
  }

  function closeTour() {
    writeStore(TOUR_SEEN_KEY, "1");
    setTourOpen(false);
  }

  // the demo goes in the starter project if it's there, else whichever project comes first
  const demoProject = (projects.find(isSeedProject) || projects[0])?.name;
  const tourActions = {
    openDemoDraft: () => setModalCard({ id: null, parentId: null, worktree: "", branch: "", link: "", dueDate: "", ...demoTicket(demoProject) }),
    createDemo: async () => {
      const created = await api.createTask(demoTicket(demoProject));
      setCards((prev) => [...prev, created]);
      setModalCard(null);
    },
    openCard: (card) => setModalCard(card),
    closeDrawer: () => setModalCard(null),
    openNewProject: () => { setModalCard(null); setNewProjectOpen(true); },
    deleteCard,
  };

  useEffect(() => {
    if (!deepLinked.current) return; // don't wipe ?task= before it has been read
    const url = new URL(window.location.href);
    if (modalCard?.id) url.searchParams.set("task", modalCard.id);
    else url.searchParams.delete("task");
    window.history.replaceState(null, "", url);
  }, [modalCard?.id]);

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
        (agentFilter === "all" || (agentFilter === UNASSIGNED_FILTER ? !c.agent : c.agent === agentFilter))
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
      // don't silently pick an arbitrary project — inherit the parent's, or
      // the board's active project filter if one is set, otherwise leave it
      // blank so the Create button stays disabled until the user picks one
      project: (parent && parent.project) || (projectFilter !== "all" ? projectFilter : ""),
      parentId: parentId || null,
      agent: null, // matches the "unassigned until claimed" semantics documented in CLAUDE.md — not a silent default owner
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
        // the drawer closes on create, so say where the ticket went and offer a way back to it
        setToast({ key: Date.now(), message: `Created ${created.id}`, card: created });
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
      setToast({ key: Date.now(), message: `Deleted ${id}` }); // the drawer closes, so confirm it went
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

  async function createProject(name, prefix, aliases) {
    const project = await api.createProject(name, prefix, aliases);
    setProjects((prev) => [...prev, project]);
    return project;
  }

  // other words the user calls a project — those words open tickets there without the board asking
  async function addAliasesByName(target) {
    const words = window.prompt(`Other names you use for "${target}" (comma-separated), e.g. 發表會, launch:`);
    if (!words?.trim()) return;
    try {
      await api.addAliases(target, words);
      setProjects(await api.listProjects());
    } catch (e) {
      reportError("Add name", e);
    }
  }

  async function forgetAliasWord(word) {
    try {
      await api.forgetAlias(word);
      setProjects(await api.listProjects());
    } catch (e) {
      reportError("Remove name", e);
    }
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
        /* menus are portaled to <body>, outside the root div's font — without this they render in the browser's serif */
        body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
        ::-webkit-scrollbar { height: 8px; width: 8px; }
        ::-webkit-scrollbar-thumb { background: #C7CBD4; border-radius: 8px; }
        .mono { font-family: 'JetBrains Mono', monospace; }
        .card-btn { transition: background .12s ease, box-shadow .12s ease, transform .08s ease; }
        .card-btn:active { transform: scale(0.995); }
        .col-drop { transition: background .15s ease; }
        select:focus, input:focus, textarea:focus { outline: 2px solid #4C8DFF; outline-offset: 1px; }
        @keyframes drawer-in { from { transform: translateX(100%); } to { transform: translateX(0); } }
        .drawer-title { border-bottom: 2px solid transparent; }
        .drawer-title:focus { outline: none; border-bottom-color: #4C8DFF; } /* the board's focus color, as on every input */
        .detail-value { background: transparent; }
        /* Development fields: inline edit on a real input — reads as text at rest, the Development input box on focus
           (plus the global input:focus ring), so it matches the property values above */
        .inline-input { border: 1px solid transparent; background: transparent; }
        .inline-input:hover { background: #F4F5F7; }
        .inline-input:focus { border-color: #E4E6EB; background: #FAFAFB; }
        .inline-input::placeholder { color: #8B8D98; }
        .detail-value:hover { background: #F4F5F7; }
        ::placeholder { color: #C7CBD4; }
        .cal-day:not(:disabled):not(.cal-day--selected):hover { background: #F4F5F7; }
        .notes-edit-btn { opacity: 0; transition: opacity .1s ease; }
        .notes-view:hover .notes-edit-btn, .notes-view:focus-within .notes-edit-btn { opacity: 1; }
        .notes-view:hover { background: #FAFAFB; }
        .drawer-resize-handle::after {
          content: ""; position: absolute; left: 50%; top: 0; bottom: 0; width: 2px;
          transform: translateX(-50%); background: transparent; transition: background .12s ease;
        }
        .drawer-resize-handle:hover::after { background: #C7CBD4; }
        .drawer-resize-handle.resizing::after { background: #4C8DFF; }
      `}</style>

      {/* Header */}
      <div
        style={{
          background: "var(--ab-chrome)",
          color: "#fff",
          padding: "14px 22px",
          display: "flex",
          alignItems: "center",
          gap: 14,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <BrandMark size={20} />
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

        <button className="card-btn" onClick={startTour} title="Replay the first-visit tour" style={headerLinkStyle}>
          <HelpCircle size={14} /> Tour
        </button>
        <a className="card-btn" href={guideUrl(workspace)} title="First ticket, step by step as text and commands" style={headerLinkStyle}>
          <BookOpen size={14} /> Guide
        </a>
        <button
          className="card-btn"
          data-tour="new-task"
          onClick={() => openNew()}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "var(--ab-accent)",
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

        <span data-tour="project-filter" style={{ display: "inline-flex" }}>
        <ProjectFilterSelect
          value={projectFilter}
          projects={projects}
          onChange={setProjectFilter}
          onRequestCreate={() => setNewProjectOpen(true)}
          onRename={renameProjectByName}
          onDelete={deleteProjectByName}
          onAddAlias={addAliasesByName}
          onForgetAlias={forgetAliasWord}
        />
        </span>
        <FilterSelect
          light
          value={agentFilter}
          minWidth={AGENT_MENU_MIN_WIDTH}
          onChange={setAgentFilter}
          options={[
            { id: "all", label: "All agents", icon: <Users size={14} color="#6B6F79" style={{ flexShrink: 0 }} aria-hidden="true" /> },
            { id: UNASSIGNED_FILTER, label: "Unassigned", icon: <CircleDashed size={14} color="#9599A3" style={{ flexShrink: 0 }} aria-hidden="true" /> },
            ...AGENTS.map((a, i) => ({ id: a.id, label: a.label, icon: <AgentIcon agent={a.id} color={a.color} />, groupLabel: i === 0 ? "Agents" : undefined, dividerBefore: a.id === "other" })),
          ]}
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
              data-tour="column"
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
                    data-tour-card={c.id}
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
                      {/* priority leads the row: it is what a scan of the board looks for first */}
                      <span title={`${priorityMeta(c.priority).label} priority`} style={{ display: "flex" }}>
                        <PriorityIcon priority={c.priority} size={14} />
                      </span>
                      <Chip label={c.project} />
                      <Chip
                        label={agentMeta(c.agent).label}
                        color={agentMeta(c.agent).color}
                        icon={<AgentIcon agent={c.agent} size={11} />}
                      />
                      {c.unconfirmed && (
                        <span title={`The board picked this for you: ${c.unconfirmed}`}>
                          <Chip label="⚠ Unconfirmed" color="#B7791F" />
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 7, marginLeft: 19, color: "#9599A3" }}>
                      <Clock size={10.5} />
                      <span style={{ fontSize: 10.5 }}>{timeAgo(c.updatedAt)}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ flexShrink: 0, padding: "8px" }}>
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
          onToast={(message) => setToast({ key: Date.now(), message })}
        />
      )}

      {toast && (
        <Toast
          key={toast.key}
          message={toast.message}
          actionLabel={toast.card ? "Open" : null}
          onAction={() => { openCard(toast.card); setToast(null); }}
          onDone={() => setToast(null)}
        />
      )}

      {newProjectOpen && (
        <NewProjectDialog onClose={() => setNewProjectOpen(false)} onCreate={createProject} />
      )}

      {tourOpen && (
        <Tour
          cards={cards}
          projects={projects}
          workspace={workspace}
          drawerOpen={modalCard ? modalCard.id || "new" : null}
          dialogOpen={newProjectOpen}
          onClose={closeTour}
          actions={tourActions}
        />
      )}
    </div>
  );
}

// short confirmation after an action whose result isn't otherwise on screen (e.g. the drawer closed);
// errors still go through reportError, and form problems are shown on the field itself.
const TOAST_MS = 4000;

function Toast({ message, actionLabel, onAction, onDone }) {
  const [hover, setHover] = useState(false);
  useEffect(() => {
    if (hover) return; // keep it up while the pointer is on it, so "Open" can still be clicked
    const t = setTimeout(onDone, TOAST_MS);
    return () => clearTimeout(t);
  }, [hover]);
  return (
    <div
      role="status"
      aria-live="polite"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "fixed", left: "50%", bottom: 84, transform: "translateX(-50%)", zIndex: 70, // above the drawer footer, not on it
        display: "flex", alignItems: "center", gap: 12, maxWidth: "calc(100vw - 32px)",
        background: "var(--ab-chrome)", color: "#fff", borderRadius: 8, padding: "10px 12px 10px 14px",
        fontSize: 13, boxShadow: "0 6px 24px rgba(0,0,0,0.18)",
      }}
    >
      <Check size={15} color="var(--ab-accent-on-dark)" style={{ flexShrink: 0 }} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{message}</span>
      {actionLabel && (
        <button
          type="button"
          onClick={onAction}
          style={{
            background: "none", border: "none", color: "var(--ab-accent-on-dark)", fontWeight: 700,
            fontSize: 13, cursor: "pointer", padding: "2px 4px", fontFamily: "inherit",
          }}
        >
          {actionLabel}
        </button>
      )}
      <button
        type="button"
        onClick={onDone}
        title="Dismiss"
        aria-label="Dismiss"
        style={{ background: "none", border: "none", color: "#8B8D98", cursor: "pointer", padding: 2, display: "flex" }}
      >
        <X size={14} />
      </button>
    </div>
  );
}

function Chip({ label, color, icon }) {
  if (!label) return null;
  return (
    <span
      className="mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        whiteSpace: "nowrap",
        fontSize: 10.5,
        padding: "2px 6px",
        borderRadius: 5,
        background: color ? `${color}1A` : "#F0F1F4",
        color: color || "#5B5F69",
        fontWeight: 600,
        border: color ? `1px solid ${color}33` : "1px solid #E4E6EB",
      }}
    >
      {icon}
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
// options: [{ id, label, description?, dividerBefore? }]; title is an optional heading over the options
// placement "top" opens the menu above the trigger (for triggers near the bottom of the screen)
function Dropdown({ value, options, onChange, renderTrigger, menuAlign = "left", block = false, title, placement = "bottom", minWidth = 130 }) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  function openMenu() {
    const rect = triggerRef.current.getBoundingClientRect();
    setMenuPos({
      ...(placement === "top" ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
      left: rect.left, right: window.innerWidth - rect.right,
      minWidth: Math.max(minWidth, block ? rect.width : 0),
    });
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
      if (e.key !== "Escape") return;
      // handled here: the drawer's own Escape (on window, runs after this) must not also close the drawer
      e.preventDefault();
      setOpen(false);
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
    <span ref={triggerRef} style={{ display: block ? "block" : "inline-block" }}>
      {renderTrigger({ open, onClick: (e) => { e.stopPropagation(); open ? setOpen(false) : openMenu(); } })}
      {open && menuPos && createPortal(
        <div
          ref={menuRef}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            top: menuPos.top,
            bottom: menuPos.bottom,
            [menuAlign]: menuAlign === "right" ? menuPos.right : menuPos.left,
            zIndex: 1000,
            background: "#fff",
            border: "1px solid #E4E6EB",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(20,22,30,0.14)",
            padding: 4,
            minWidth: menuPos.minWidth,
          }}
        >
          {title && (
            <div style={{ fontSize: 11, fontWeight: 600, color: "#6B6F79", textTransform: "uppercase", letterSpacing: 0.4, padding: "6px 10px 4px" }}>
              {title}
            </div>
          )}
          {options.map((o) => (
            <Fragment key={o.id ?? "__none__"}>
            {(o.dividerBefore || o.groupLabel) && <div style={{ borderTop: "1px solid #E4E6EB", margin: "4px 0" }} />}
            {o.groupLabel && (
              <div style={{ fontSize: 11, fontWeight: 600, color: "#6B6F79", textTransform: "uppercase", letterSpacing: 0.4, padding: "6px 10px 4px" }}>
                {o.groupLabel}
              </div>
            )}
            <div
              onClick={() => { onChange(o.id); setOpen(false); }}
              style={{
                padding: "7px 10px",
                borderRadius: 5,
                fontSize: CONTROL_SIZE.fontSize,
                fontWeight: o.id === value ? 600 : 400,
                color: "#1D2027",
                background: o.id === value ? "#F0F4FF" : "transparent",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
              onMouseEnter={(e) => { if (o.id !== value) e.currentTarget.style.background = "#F4F5F7"; }}
              onMouseLeave={(e) => { if (o.id !== value) e.currentTarget.style.background = "transparent"; }}
            >
              {o.icon ? <span style={{ display: "flex", alignItems: "center", gap: 7 }}>{o.icon}{o.label}</span> : o.label}
              {o.description && (
                <div style={{ fontSize: 11.5, fontWeight: 400, color: "#8B8D98", marginTop: 1 }}>{o.description}</div>
              )}
            </div>
            </Fragment>
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
          background: "var(--ab-menu)",
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

// The "All projects" filter, folded together with project management —
// same hover-reveal row-actions pattern as WorkspaceSwitcher, so renaming or
// deleting a project happens right where you'd already look to filter by one.
function ProjectFilterSelect({ value, projects, onChange, onRequestCreate, onRename, onDelete, onAddAlias, onForgetAlias }) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState(null);
  const [hoveredRow, setHoveredRow] = useState(null);
  const [actionsFor, setActionsFor] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  const label = value === "all" ? "All projects" : value;

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
          background: "#fff",
          border: "1px solid #E4E6EB",
          borderRadius: 7,
          padding: "6px 10px",
          color: "#42454D",
          fontSize: 12.5,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        <Filter size={13} />
        {label}
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
            minWidth: 190,
          }}
        >
          <div
            onClick={() => { onChange("all"); closeAll(); }}
            style={{
              padding: "6px 10px",
              borderRadius: 5,
              fontSize: 12.5,
              fontWeight: value === "all" ? 600 : 400,
              color: "#1D2027",
              background: value === "all" ? "#F0F4FF" : "transparent",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            All projects
          </div>
          {projects.map((p) => (
            <div
              key={p.name}
              onMouseEnter={() => setHoveredRow(p.name)}
              onMouseLeave={() => setHoveredRow((h) => (h === p.name ? null : h))}
              onClick={() => { onChange(p.name); closeAll(); }}
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                padding: "6px 4px 6px 10px",
                borderRadius: 5,
                fontSize: 12.5,
                fontWeight: p.name === value ? 600 : 400,
                color: "#1D2027",
                background: p.name === value ? "#F0F4FF" : "transparent",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
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
                    minWidth: 170,
                  }}
                >
                  <div style={{ padding: "6px 10px 2px", fontSize: 10.5, fontWeight: 600, color: "#8B8D98" }}>Also called</div>
                  {(p.aliases ?? []).map((a) => (
                    <div key={a} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 6px 3px 10px", fontSize: 12.5, color: "#42454D" }}>
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{a}</span>
                      <button
                        type="button"
                        aria-label={`Stop treating "${a}" as ${p.name}`}
                        title={`Stop treating "${a}" as ${p.name}`}
                        onClick={() => onForgetAlias(a)}
                        style={{ background: "none", border: "none", color: "#8B8D98", cursor: "pointer", padding: 2, display: "flex", borderRadius: 4 }}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                  <div
                    onClick={() => { closeAll(); onAddAlias(p.name); }}
                    style={{ padding: "6px 10px", borderRadius: 5, fontSize: 12.5, cursor: "pointer", color: "#42454D" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#F4F5F7")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    + Add a name
                  </div>
                  <div style={{ height: 1, background: "#E4E6EB", margin: "4px 0" }} />
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
            onClick={() => { onRequestCreate(); closeAll(); }}
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

// Centered dialog (unlike the drawer's no-dim split view — this is a small,
// focused form, not a persistent editing surface) with the name/prefix
// fields side by side so picking a project's ticket-id prefix isn't a
// separate prompt() step.
// asks before a task is deleted. In-app, not window.confirm: some embedded browsers don't implement the native
// dialogs, and the board's own look is clearer about what goes away. A task with subtasks can't be deleted (the
// server refuses), so that case says so up front instead of letting the request fail.
function ConfirmDeleteDialog({ card, subtasks, onCancel, onConfirm }) {
  const blocked = subtasks > 0;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={onCancel} style={{ position: "absolute", inset: 0, background: "rgba(15,16,20,0.32)" }} />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-delete-title"
        aria-describedby="confirm-delete-body"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative", background: "#fff", borderRadius: 10, boxShadow: "0 16px 48px rgba(9,10,12,0.28)",
          width: 420, maxWidth: "92vw", padding: 20,
        }}
      >
        <div id="confirm-delete-title" style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>
          {blocked
            ? <><span className="mono">{card.id}</span> can't be deleted yet</>
            : <>Delete <span className="mono">{card.id}</span>?</>}
        </div>
        <div id="confirm-delete-body" style={{ fontSize: 13, lineHeight: 1.5, color: "#31343B", marginBottom: 18 }}>
          {blocked ? (
            <>
              <b>{card.title}</b> has {subtasks} subtask{subtasks === 1 ? "" : "s"}. Delete {subtasks === 1 ? "it" : "them"} first —
              a task with subtasks can't be deleted.
            </>
          ) : (
            <>
              <b>{card.title}</b> and its notes will be deleted for everyone on this board, and agents that have{" "}
              <span className="mono">{card.id}</span> won't find it any more. This can't be undone.
            </>
          )}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            type="button"
            autoFocus // the safe choice gets the focus, so a stray Enter doesn't delete
            onClick={onCancel}
            style={{ background: "none", border: "1px solid #E4E6EB", borderRadius: 7, padding: "7px 14px", fontSize: 12.5, cursor: "pointer", fontFamily: "inherit" }}
          >
            {blocked ? "OK" : "Cancel"}
          </button>
          {!blocked && (
            <button
              type="button"
              onClick={onConfirm}
              style={{
                background: ERROR_COLOR, color: "#fff", border: "none", borderRadius: 7, padding: "7px 14px",
                fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
              }}
            >
              Delete task
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function NewProjectDialog({ onClose, onCreate }) {
  const [name, setName] = useState("");
  const [prefix, setPrefix] = useState(""); // stays empty until the user actually types — the suggestion is a placeholder, not a value
  const [aliases, setAliases] = useState("");
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  // shown as a placeholder only (see the ::placeholder rule below) — never
  // written into the field's value, so it can't be mistaken for something
  // the user already typed. Falls back to this on submit if left blank.
  // multi-word names use initials ("Design Tools" -> "DT"); a single word
  // uses its first two letters ("Inbox" -> "IN", not just "I"); a name with
  // no Latin letters at all (CJK, emoji-only, ...) has no sane initials to
  // derive, so it's left blank — the user types their own prefix instead of
  // getting a suggestion that isn't actually a suggestion of anything.
  const words = name.split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
  const suggestedPrefix =
    words.length >= 2
      ? words.map((w) => w.match(/[A-Za-z]/)[0]).join("").slice(0, 4).toUpperCase()
      : words.length === 1
        ? words[0].replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase()
        : "";

  async function submit(e) {
    e.preventDefault();
    const finalPrefix = (prefix.trim() || suggestedPrefix).toUpperCase();
    if (!name.trim() || !finalPrefix) return;
    setSaving(true);
    setError(null);
    try {
      await onCreate(name.trim(), finalPrefix, aliases.trim() || undefined);
      onClose();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(15,16,20,0.32)" }} />
      <form
        data-tour="project-dialog"
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          background: "#fff",
          borderRadius: 10,
          boxShadow: "0 16px 48px rgba(9,10,12,0.28)",
          width: 420,
          maxWidth: "92vw",
          padding: 20,
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>New project</div>

        <div style={{ display: "grid", gridTemplateColumns: "96px 1fr", gap: 10, marginBottom: 4 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#8B8D98" }}>Prefix</span>
            <input
              className="mono new-project-prefix"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value.toUpperCase())}
              placeholder={suggestedPrefix || "AB"}
              maxLength={6}
              style={{ border: "1px solid #E4E6EB", borderRadius: 6, padding: "7px 8px", fontSize: 13, fontFamily: "inherit", textTransform: "uppercase" }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#8B8D98" }}>Name</span>
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="What are you calling this project?"
              style={{ border: "1px solid #E4E6EB", borderRadius: 6, padding: "7px 8px", fontSize: 13, fontFamily: "inherit" }}
            />
          </label>
        </div>
        <div style={{ fontSize: 11, color: "#B7BAC2", marginBottom: error ? 12 : 18 }}>
          {prefix || suggestedPrefix
            ? `Shows up in ticket ids, e.g. ${prefix || suggestedPrefix}-1 — leave blank to use the suggestion.`
            : "No suggestion for this name — type a short prefix for ticket ids, e.g. AB."}
        </div>

        <label style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "#8B8D98" }}>Also called (optional)</span>
          <input
            id="new-project-aliases"
            value={aliases}
            onChange={(e) => setAliases(e.target.value)}
            placeholder="發表會, launch"
            style={{ border: "1px solid #E4E6EB", borderRadius: 6, padding: "7px 8px", fontSize: 13, fontFamily: "inherit" }}
          />
        </label>
        <div style={{ fontSize: 11, color: "#B7BAC2", marginBottom: error ? 12 : 18 }}>
          Other words you'd use for this project, comma-separated. Agents that use them land here without asking.
        </div>

        {error && <div style={{ color: "#E5484D", fontSize: 12, marginBottom: 10 }}>{error}</div>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            type="button"
            onClick={onClose}
            style={{ background: "none", border: "1px solid #E4E6EB", borderRadius: 7, padding: "7px 14px", fontSize: 12.5, cursor: "pointer", fontFamily: "inherit" }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim() || !(prefix.trim() || suggestedPrefix) || saving}
            style={{
              background: "#1D2027", color: "#fff", border: "none", borderRadius: 7, padding: "7px 14px",
              fontSize: 12.5, cursor: "pointer", fontFamily: "inherit",
              opacity: !name.trim() || !(prefix.trim() || suggestedPrefix) || saving ? 0.5 : 1,
            }}
          >
            Create
          </button>
        </div>
      </form>
    </div>
  );
}

function ChipSelect({ value, onChange, options, colorFor, iconFor, minWidth }) {
  const color = colorFor(value);
  const label = options.find((o) => o.id === value)?.label ?? value;
  return (
    <Dropdown
      value={value}
      options={options}
      onChange={onChange}
      minWidth={minWidth}
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
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            whiteSpace: "nowrap",
          }}
        >
          {iconFor?.(value)}
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
  const current = options.find((o) => o.id === value);
  const label = current?.label ?? value;
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
          style={{ ...detailInputStyle, width: "auto", textAlign: "left", color: color || "#42454D", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 7 }}
        >
          {current?.icon}
          {label}
        </button>
      )}
    />
  );
}

// local-date formatting only — toISOString() is UTC and shifts the date by
// a day near midnight in timezones behind UTC, which would silently save
// the wrong due date.
function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function fromISODate(iso) {
  if (!iso) return undefined;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// custom calendar popover (react-day-picker) instead of the native
// <input type="date"> — the native picker's language and layout follow the
// OS/browser locale with no way to override from the page, and it looked
// out of place next to the rest of this hand-styled UI.
const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// single-month grid — no range selection, no multi-month, so this is
// plain enough to hand-roll rather than reach for a dependency; keeps the
// app's zero-external-UI-library rule intact and matches its own palette
// exactly instead of overriding a library's CSS variables.
function CalendarGrid({ viewMonth, selectedISO, onSelect }) {
  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const numDays = new Date(year, month + 1, 0).getDate();
  const todayISO = toISODate(new Date());

  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= numDays; d++) cells.push(d);

  return (
    <div style={{ width: 232 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginBottom: 4 }}>
        {WEEKDAY_LABELS.map((w) => (
          <div key={w} style={{ fontSize: 10.5, fontWeight: 600, color: "#8B8D98", textAlign: "center", padding: "2px 0" }}>
            {w}
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
        {cells.map((d, i) => {
          if (d === null) return <div key={i} />;
          const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          const isSelected = iso === selectedISO;
          const isToday = iso === todayISO;
          return (
            <button
              key={i}
              type="button"
              onClick={() => onSelect(iso)}
              className={`mono cal-day${isSelected ? " cal-day--selected" : ""}`}
              style={{
                width: 30,
                height: 30,
                borderRadius: "50%",
                border: isToday && !isSelected ? "1px solid #4C8DFF" : "1px solid transparent",
                background: isSelected ? "#4C8DFF" : "transparent",
                color: isSelected ? "#fff" : "#1D2027",
                fontSize: 12,
                fontWeight: isToday || isSelected ? 700 : 400,
                cursor: "pointer",
              }}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DueDateField({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState(null);
  const [viewMonth, setViewMonth] = useState(() => fromISODate(value) || new Date());
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  function openMenu() {
    const rect = triggerRef.current.getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    setViewMonth(fromISODate(value) || new Date());
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
      if (e.key !== "Escape") return;
      // handled here: the drawer's own Escape (on window, runs after this) must not also close the drawer
      e.preventDefault();
      setOpen(false);
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
    <span ref={triggerRef} style={{ display: "block" }}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); open ? setOpen(false) : openMenu(); }}
        className="detail-value"
        style={propValueStyle({ open, empty: !value })}
      >
        {value || "Add due date"}
      </button>
      {open && menuPos && createPortal(
        <div
          ref={menuRef}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            top: menuPos.top,
            right: menuPos.right,
            zIndex: 1000,
            background: "#fff",
            border: "1px solid #E4E6EB",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(20,22,30,0.14)",
            padding: "10px 12px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <button
              type="button"
              onClick={() => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
              style={{ background: "none", border: "none", color: "#5B5F69", cursor: "pointer", display: "flex", padding: 2, borderRadius: 4 }}
            >
              <ChevronLeft size={15} />
            </button>
            <span style={{ fontSize: 13, fontWeight: 700 }}>
              {MONTH_NAMES[viewMonth.getMonth()]} {viewMonth.getFullYear()}
            </span>
            <button
              type="button"
              onClick={() => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
              style={{ background: "none", border: "none", color: "#5B5F69", cursor: "pointer", display: "flex", padding: 2, borderRadius: 4 }}
            >
              <ChevronRight size={15} />
            </button>
          </div>
          <CalendarGrid
            viewMonth={viewMonth}
            selectedISO={value || null}
            onSelect={(iso) => { onChange(iso); setOpen(false); }}
          />
          {value && (
            <button
              type="button"
              onClick={() => { onChange(""); setOpen(false); }}
              style={{
                width: "100%", textAlign: "center", padding: "8px 0 2px", marginTop: 4,
                border: "none", borderTop: "1px solid #F0F1F4", background: "none", color: "#E5484D",
                fontSize: 12, cursor: "pointer", fontFamily: "inherit",
              }}
            >
              Clear due date
            </button>
          )}
        </div>,
        document.body
      )}
    </span>
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
                    options={AGENT_OPTIONS}
                    minWidth={AGENT_MENU_MIN_WIDTH}
                    colorFor={(v) => agentMeta(v).color}
                    iconFor={(v) => <AgentIcon agent={v} size={11} />}
                  />
                </td>
                <td style={{ padding: "6px 12px" }}>
                  <BlockSelect
                    value={t.priority}
                    onChange={(v) => onFieldChange(t.id, "priority", v)}
                    options={PRIORITY_OPTIONS}
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

function FilterSelect({ value, onChange, options, icon, light, minWidth }) {
  const label = options.find((o) => o.id === value)?.label ?? value;
  return (
    <Dropdown
      value={value}
      options={options}
      onChange={onChange}
      minWidth={minWidth}
      renderTrigger={({ onClick }) => (
        <button
          type="button"
          onClick={onClick}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: light ? "#fff" : "var(--ab-menu)",
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

const DRAWER_MIN_WIDTH = 360;
// cap resize at 80% of viewport rather than snapping to fullscreen —
// wider than that starts to feel like a second board, not a detail panel.
const DRAWER_MAX_WIDTH_RATIO = 0.8;
const DRAWER_WIDTH_KEY = "ab-drawer-width";

function TaskDrawer({ card, cards, projects, onClose, onSave, onDelete, onCreateProject, onOpenSubtask, onToast }) {
  const [form, setForm] = useState(card);
  // read view first, editor on click (inline edit) — for a new task too, so the empty box isn't mistaken for a field to fill
  const [editingNotes, setEditingNotes] = useState(false);
  // Development starts open only when it has something in it, so a new task's drawer stays short
  const [devOpen, setDevOpen] = useState(Boolean(card.worktree || card.branch || card.link));
  const [notesDraft, setNotesDraft] = useState(card.notes || "");
  const notesRef = useRef(null);
  // a new task needs a title and a project. Create stays clickable (a greyed-out button can't explain itself);
  // pressing it with one missing follows Jira's create dialog, which these borderless fields mirror: a red underline
  // on each missing field and one "Complete required fields" message by the Create button. The project is never
  // pre-picked: a ticket can't move projects later, and the board asks rather than guesses.
  const [showErrors, setShowErrors] = useState(false);
  const titleRef = useRef(null);
  const projectRef = useRef(null);
  const titleError = showErrors && !form.title.trim();
  const projectError = showErrors && !form.project;
  const [drawerWidth, setDrawerWidth] = useState(
    () => Number(readStore(DRAWER_WIDTH_KEY)) || 460
  );
  const [resizing, setResizing] = useState(false);

  // dragging the left-edge handle resizes the drawer; width is clamped live
  // and only persisted on mouseup so we're not hitting localStorage per-frame
  function startResize(e) {
    e.preventDefault();
    setResizing(true);
    // body.style.cursor alone loses to any element under the pointer that sets
    // its own cursor (links, buttons, inputs) — the resize overlay below wins
    // the hit-test everywhere so the cursor can't flip mid-drag. userSelect
    // still needs setting here so fast drags don't select text underneath it.
    document.body.style.userSelect = "none";
    function onMove(ev) {
      const w = window.innerWidth - ev.clientX;
      const max = window.innerWidth * DRAWER_MAX_WIDTH_RATIO;
      setDrawerWidth(Math.min(Math.max(w, DRAWER_MIN_WIDTH), max));
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
      setResizing(false);
      setDrawerWidth((w) => {
        writeStore(DRAWER_WIDTH_KEY, String(w));
        return w;
      });
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  // auto-grows with content between 240 and 480px instead of a fixed box
  // with a manual drag handle — resets to "auto" first so shrinking (e.g.
  // after deleting a paragraph) is measured correctly, not just growth.
  // useLayoutEffect (not useEffect) so the height is corrected before paint,
  // avoiding a one-frame flash at the wrong size when editing starts.
  useLayoutEffect(() => {
    const el = notesRef.current;
    if (!el || !editingNotes) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 240), 480)}px`;
  }, [notesDraft, editingNotes]);

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
      // send only the changed field — the rest of `form` can be stale now
      // that the board live-updates, and must not revert an agent's edits
      if (card.id) onSave({ id: card.id, [k]: v });
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
    onSave({ id: card.id, title: form.title, worktree: form.worktree, branch: form.branch, link: form.link });
  }

  function closeAndSave() {
    blurSave();
    onClose();
  }

  function create() {
    if (!form.title.trim() || !form.project) {
      setShowErrors(true);
      (!form.title.trim() ? titleRef : projectRef).current?.focus(); // first missing field, top to bottom
      return;
    }
    // the description box is a draft until its own Save; on a new task Create is the only save, so include it
    onSave({ ...form, notes: notesDraft });
  }

  // "+ New project…" opens the same dialog as the board's project menu (prefix suggestions, aliases,
  // inline errors). It used window.prompt, which some embedded browsers don't implement — it threw and nothing opened.
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function handleProjectChange(newValue) {
    if (newValue === "__new__") setNewProjectOpen(true);
    else setAndSave("project", newValue);
  }

  async function createProjectHere(name, prefix, aliases) {
    const project = await onCreateProject(name, prefix, aliases);
    setAndSave("project", project.name);
    return project;
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

  function applyLinePrefix(prefix) {
    const el = notesRef.current;
    if (!el) return;
    const { selectionStart: s, value } = el;
    const lineStart = value.lastIndexOf("\n", s - 1) + 1;
    const next = value.slice(0, lineStart) + prefix + value.slice(lineStart);
    setNotesDraft(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + prefix.length, s + prefix.length);
    });
  }

  function applyList() {
    applyLinePrefix("- ");
  }

  function applyOrderedList() {
    applyLinePrefix("1. ");
  }

  function applyHeading(level) {
    applyLinePrefix(`${"#".repeat(level)} `);
  }

  function applyLink() {
    const url = window.prompt("Link URL");
    if (!url) return;
    applyMd("[", `](${url})`, "text");
  }

  function applyImage() {
    const url = window.prompt("Image URL");
    if (!url) return;
    applyMd("![", `](${url})`, "alt text");
  }

  function saveNotes() {
    setAndSave("notes", notesDraft);
    setEditingNotes(false);
  }

  function cancelNotes() {
    setNotesDraft(form.notes || "");
    setEditingNotes(false);
  }

  useEffect(() => {
    function onKey(e) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // Escape closes the topmost layer only: an open menu (handled above) or the New project dialog,
      // not the drawer (and the draft) under it
      if (confirmDelete) setConfirmDelete(false);
      else if (newProjectOpen) setNewProjectOpen(false);
      else closeAndSave();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50 }}>
      {/* click-outside catcher — no dim, board stays fully visible like Jira's split detail view */}
      <div onClick={closeAndSave} style={{ position: "absolute", inset: 0 }} />

      {/* while resizing, this wins the hit-test over the whole viewport so the
          cursor can't flip to a link/button/input's own cursor mid-drag */}
      {resizing && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, cursor: "col-resize" }} />
      )}

      <div
        data-tour="drawer"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          height: "100%",
          width: drawerWidth,
          maxWidth: "92vw",
          background: "#fff",
          boxShadow: "-8px 0 32px rgba(9,10,12,0.18)",
          animation: "drawer-in .18s ease",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          className={`drawer-resize-handle${resizing ? " resizing" : ""}`}
          onMouseDown={startResize}
          title="Drag to resize"
          style={{
            position: "absolute", top: 0, bottom: 0, left: -4, width: 8,
            cursor: "col-resize", zIndex: 1,
          }}
        />
        <div
          style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "14px 18px", borderBottom: "1px solid #E4E6EB", flexShrink: 0,
          }}
        >
          {/* project › ticket, on top like Jira's "KAN | Feature" and Linear's team: the project sets the id */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flexShrink: 1 }}>
            {card.id ? (
              // a ticket can't move projects, so here it's a label, not a control
              <span style={{ ...projectChipStyle, cursor: "default" }} title="A ticket can't move to another project">
                <Folder size={13} style={{ flexShrink: 0 }} /> <span style={chipTextStyle}>{form.project}</span>
              </span>
            ) : (
              <Dropdown
                value={form.project}
                options={[...projectNames.map((p) => ({ id: p, label: p })), { id: "__new__", label: "+ New project…" }]}
                onChange={handleProjectChange}
                minWidth={AGENT_MENU_MIN_WIDTH}
                renderTrigger={({ onClick, open }) => (
                  <button
                    ref={projectRef}
                    type="button"
                    onClick={onClick}
                    aria-label={form.project ? `Project: ${form.project}` : "Select project"}
                    aria-required
                    aria-invalid={projectError}
                    aria-describedby={projectError ? "new-task-required-error" : undefined}
                    style={{
                      ...projectChipStyle,
                      color: form.project ? "#1D2027" : "#6B6F79",
                      ...(open && FOCUS_RING),
                      ...(projectError && { borderColor: ERROR_COLOR, color: ERROR_COLOR }),
                    }}
                  >
                    <Folder size={13} style={{ flexShrink: 0 }} />
                    <span style={chipTextStyle}>{form.project || "Select project"}</span>
                    <ChevronDown size={12} style={{ flexShrink: 0 }} />
                  </button>
                )}
              />
            )}
            <span style={{ color: "#C7CBD4" }}>›</span>
            <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: "#8B8D98", letterSpacing: 0.5, whiteSpace: "nowrap", flexShrink: 0 }}>
              {card.id || "New task"}
            </span>
          </div>
          {/* in a narrow drawer the autosave note is dropped, so the project and the id keep their room */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0, marginLeft: 10 }}>
            {card.id && drawerWidth >= 520 && <span style={{ fontSize: 11.5, color: "#9599A3", whiteSpace: "nowrap" }}>Changes save automatically</span>}
            <button onClick={closeAndSave} aria-label="Close" style={{ background: "none", border: "none", cursor: "pointer", color: "#8B8D98", display: "flex", flexShrink: 0 }}>
              <X size={18} />
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px" }}>
          {/* ask mode new/off: the board decided something the user would otherwise have been asked */}
          {card.id && form.unconfirmed && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10, background: "#FFF8E6", border: "1px solid #F3D58C", borderRadius: 8, padding: "9px 11px", marginBottom: 14, fontSize: 12.5, color: "#7A5300" }}>
              <span style={{ flex: 1, lineHeight: 1.45 }}>
                <b>⚠ The board picked this for you:</b> {form.unconfirmed}. A wrong project can't be changed — create the ticket again in the right one.
              </span>
              <button
                className="card-btn"
                onClick={() => { setForm((f) => ({ ...f, unconfirmed: null })); onSave({ id: card.id, unconfirmed: null }); }}
                style={{ flexShrink: 0, border: "1px solid #E0B653", background: "#fff", borderRadius: 6, padding: "3px 10px", fontSize: 12, fontWeight: 600, color: "#7A5300", cursor: "pointer" }}
              >
                Confirm
              </button>
            </div>
          )}
          <input
            ref={titleRef}
            autoFocus={!card.id} // a new task starts typing its title; an existing one just opens to read
            className="drawer-title"
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            onBlur={blurSave}
            placeholder="What needs to be done?"
            aria-label="Title"
            aria-required={!card.id}
            aria-invalid={titleError}
            aria-describedby={titleError ? "new-task-required-error" : undefined}
            style={{
              // underline only (the .drawer-title rule): none at rest, 2px accent while editing, 2px red when
              // missing — Material 3's active indicator is 2px focused, with 8px between text and line
              width: "100%", borderTop: "none", borderLeft: "none", borderRight: "none", borderRadius: 0,
              padding: "4px 6px 8px", marginLeft: -6, marginBottom: 14,
              fontSize: 17, fontWeight: 700, fontFamily: "inherit", background: "transparent",
              ...(titleError && { borderBottomColor: ERROR_COLOR }),
            }}
          />

          {/* properties — Field labels and spacing like Description and Development; each value reads as text until
              clicked (inline edit). Two columns to keep the block short, gapped like the Worktree/Branch row; auto-fit
              drops to one when the drawer is dragged narrower than two 180px columns. */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", columnGap: 10 }}>
            <Field icon={<CircleDashed size={12} />} label="Status">
              <Dropdown
                value={form.status}
                options={COLUMNS}
                onChange={(v) => setAndSave("status", v)}
                block
                renderTrigger={({ onClick, open }) => (
                  <button type="button" onClick={onClick} className="detail-value" style={propValueStyle({ open })}>
                    <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: statusMeta(form.status).color, marginRight: 7, verticalAlign: 1 }} />
                    {statusMeta(form.status).label}
                  </button>
                )}
              />
            </Field>
            <Field icon={<Bot size={12} />} label="Agent">
              <Dropdown
                value={form.agent}
                options={AGENT_OPTIONS}
                minWidth={AGENT_MENU_MIN_WIDTH}
                onChange={(v) => setAndSave("agent", v)}
                block
                renderTrigger={({ onClick, open }) => (
                  <button type="button" onClick={onClick} className="detail-value" style={{ ...propValueStyle({ open, empty: !form.agent }), display: "flex", alignItems: "center", gap: 8 }}>
                    <AgentIcon agent={form.agent} size={15} color={agentMeta(form.agent).color} />
                    {agentMeta(form.agent).label}
                  </button>
                )}
              />
            </Field>
            <Field icon={<Flag size={12} />} label="Priority">
              <Dropdown
                value={form.priority}
                options={PRIORITY_OPTIONS}
                onChange={(v) => setAndSave("priority", v)}
                block
                renderTrigger={({ onClick, open }) => (
                  <button type="button" onClick={onClick} className="detail-value" style={{ ...propValueStyle({ open }), display: "flex", alignItems: "center", gap: 8 }}>
                    <PriorityIcon priority={form.priority} />
                    {priorityMeta(form.priority).label}
                  </button>
                )}
              />
            </Field>
            <Field icon={<CalendarDays size={12} />} label="Due date">
              <DueDateField value={form.dueDate || ""} onChange={(v) => setAndSave("dueDate", v)} />
            </Field>
            <Field icon={<CornerDownRight size={12} />} label="Parent">
              <Dropdown
                value={form.parentId || ""}
                options={[{ id: "", label: "— none —" }, ...parentCandidates.map((p) => ({ id: p.id, label: `${p.id} — ${p.title}` }))]}
                onChange={(v) => setAndSave("parentId", v || null)}
                block
                renderTrigger={({ onClick, open }) =>
                  parentCandidates.length === 0 && !form.parentId ? (
                    // nothing to nest under (no project yet, or no top-level tasks in it): an empty value, not a control
                    <span style={{ ...propValueStyle({ empty: true }), cursor: "default", display: "block" }}>-</span>
                  ) : (
                    <button type="button" onClick={onClick} className="detail-value" style={propValueStyle({ open, empty: !form.parentId })}>
                      {form.parentId ? `${form.parentId} — ${cards.find((c) => c.id === form.parentId)?.title ?? ""}` : "Add parent"}
                    </button>
                  )
                }
              />
            </Field>
          </div>


          <Field icon={<AlignLeft size={12} />} label="Description">
            {editingNotes ? (
              <div>
                <div
                  style={{
                    display: "flex", gap: 2, padding: 6, background: "#F4F5F7",
                    border: "1px solid #E4E6EB", borderBottom: "none", borderRadius: "7px 7px 0 0",
                  }}
                >
                  <ToolbarBtn title="Heading 1" onClick={() => applyHeading(1)}><Heading1 size={13} /></ToolbarBtn>
                  <ToolbarBtn title="Heading 2" onClick={() => applyHeading(2)}><Heading2 size={13} /></ToolbarBtn>
                  <ToolbarBtn title="Heading 3" onClick={() => applyHeading(3)}><Heading3 size={13} /></ToolbarBtn>
                  <div style={{ width: 1, background: "#E4E6EB", margin: "2px 2px" }} />
                  <ToolbarBtn title="Bold" onClick={() => applyMd("**")}><Bold size={13} /></ToolbarBtn>
                  <ToolbarBtn title="Code" onClick={() => applyMd("`")}><Code2 size={13} /></ToolbarBtn>
                  <div style={{ width: 1, background: "#E4E6EB", margin: "2px 2px" }} />
                  <ToolbarBtn title="Bullet list" onClick={applyList}><List size={13} /></ToolbarBtn>
                  <ToolbarBtn title="Numbered list" onClick={applyOrderedList}><ListOrdered size={13} /></ToolbarBtn>
                  <div style={{ width: 1, background: "#E4E6EB", margin: "2px 2px" }} />
                  <ToolbarBtn title="Link" onClick={applyLink}><Link2 size={13} /></ToolbarBtn>
                  <ToolbarBtn title="Image" onClick={applyImage}><Image size={13} /></ToolbarBtn>
                </div>
                <textarea
                  ref={notesRef}
                  autoFocus // the editor only opens from a click on the description
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  placeholder={card.id ? "markdown — blockers, checklist, links…" : "Optional — markdown: blockers, checklist, links…"}
                  style={{
                    ...inputStyle, borderRadius: "0 0 7px 7px", resize: "none", overflowY: "auto",
                    fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
                    height: 240, minHeight: 240, maxHeight: 480,
                  }}
                />
                {/* a new task saves its description with Create — a second Save here read as "already saved" */}
                {card.id && <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button
                    onClick={saveNotes}
                    style={{
                      background: "var(--ab-accent)", color: "#fff", border: "none", borderRadius: 6,
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
                </div>}
              </div>
            ) : (form.notes || "").trim() ? ( // notes can be null (a ticket created without a description)
              <div className="notes-view" style={{ position: "relative", padding: "9px 11px", marginLeft: -11, borderRadius: 7 }}>
                <button
                  type="button"
                  title="Edit description"
                  onClick={() => { setNotesDraft(form.notes); setEditingNotes(true); }}
                  className="notes-edit-btn"
                  style={{
                    position: "absolute", top: 6, right: 6, background: "#fff", border: "1px solid #E4E6EB",
                    borderRadius: 6, padding: 5, color: "#5B5F69", cursor: "pointer", display: "flex",
                  }}
                >
                  <Pencil size={12} />
                </button>
                <div
                  style={{ fontSize: 12.5, lineHeight: 1.5, color: "#31343B", overflowWrap: "anywhere" }}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(form.notes) }}
                />
              </div>
            ) : (
              <button
                type="button"
                className="detail-value"
                onClick={() => { setNotesDraft(""); setEditingNotes(true); }}
                style={propValueStyle({ empty: true })}
              >
                Add a description — blockers, checklist, links…
              </button>
            )}
          </Field>

          {/* Development — a collapsible card like Jira's Details panel: a header row (chevron, title, and a summary
              while collapsed) set apart from the field labels inside it. */}
          {(() => {
            const filled = [form.worktree, form.branch, form.link].filter(Boolean).length;
            const Chevron = devOpen ? ChevronDown : ChevronRight;
            const header = (
              <button
                type="button"
                onClick={() => setDevOpen((o) => !o)}
                aria-expanded={devOpen}
                aria-controls="drawer-development"
                style={{
                  display: "flex", alignItems: "center", gap: 4, width: "100%", background: "none", border: "none",
                  cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600, color: "#1D2027", textAlign: "left",
                  // hanging chevron: it sits 10px in, so the title text (10 + 16 + 4 = 30px) lines up with the fields below
                  padding: "10px 22px 10px 10px",
                }}
              >
                <Chevron size={16} color="#6B6F79" style={{ flexShrink: 0 }} />
                Development
                {!devOpen && (
                  <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 400, color: "#8B8D98" }}>
                    {filled ? `${filled} of 3 set` : "Empty"}
                  </span>
                )}
              </button>
            );
            const body = devOpen && (
              <div id="drawer-development" style={{ padding: "2px 22px 4px 30px" }}>
                <div style={{ display: "flex", gap: 10 }}>
                  <Field icon={<FolderGit2 size={12} />} label="Worktree" style={{ flex: 1 }}>
                    <input
                      className="mono inline-input"
                      value={form.worktree || ""}
                      onChange={(e) => set("worktree", e.target.value)}
                      onBlur={blurSave}
                      onKeyDown={blurOnEnter}
                      placeholder="Add worktree path"
                      style={{ ...inlineInputStyle, fontSize: 12 }}
                    />
                  </Field>
                  <Field icon={<GitBranch size={12} />} label="Branch" style={{ flex: 1 }}>
                    <input
                      className="mono inline-input"
                      value={form.branch || ""}
                      onChange={(e) => set("branch", e.target.value)}
                      onBlur={blurSave}
                      onKeyDown={blurOnEnter}
                      placeholder="Add branch"
                      style={{ ...inlineInputStyle, fontSize: 12 }}
                    />
                  </Field>
                </div>
                <Field icon={<Link2 size={12} />} label="Link">
                  <input
                    className="inline-input"
                    value={form.link || ""}
                    onChange={(e) => set("link", e.target.value)}
                    onBlur={blurSave}
                    onKeyDown={blurOnEnter}
                    placeholder="Add a repo, PR, or issue link"
                    style={inlineInputStyle}
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
            );
            return (
              <div style={{ border: "1px solid #E4E6EB", borderRadius: 8, marginTop: 4, marginBottom: 12 }}>
                {header}
                {body}
              </div>
            );
          })()}

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
              onClick={() => setConfirmDelete(true)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                background: "none", border: "none", color: "#E5484D", fontSize: 12.5, cursor: "pointer",
              }}
            >
              <Trash2 size={14} /> Delete
            </button>
          ) : titleError || projectError ? (
            <FieldError id="new-task-required-error" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
              <CircleAlert size={14} style={{ flexShrink: 0 }} /> Complete required fields
            </FieldError>
          ) : <span />}
          {card.id ? (
            <HandOffButton card={card} compact={drawerWidth < 380} onCopied={onToast} />
          ) : (
            <button
              onClick={create}
              style={{
                background: "var(--ab-accent)",
                color: "#fff",
                border: "none",
                borderRadius: 7,
                padding: "8px 16px",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Create
            </button>
          )}
        </div>
      </div>

      {newProjectOpen && (
        <NewProjectDialog onClose={() => setNewProjectOpen(false)} onCreate={createProjectHere} />
      )}
      {confirmDelete && (
        <ConfirmDeleteDialog
          card={form}
          subtasks={cards.filter((c) => c.parentId === card.id).length}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => { setConfirmDelete(false); onDelete(card.id); }}
        />
      )}
    </div>
  );
}

// AB-29: copy a hand-off for an agent. Copy only — never starts a terminal.
// It lives in the drawer footer, opposite Delete — where Create sits on a new task, so the footer's right end is
// always the drawer's main action. The button names the goal ("Hand off to Codex"), not the mechanism: that it
// copies a command is said when it's pressed (the button flips to Copied and a toast says where to paste it) and
// in the "?" tooltip next to it.
function HandOffButton({ card, compact, onCopied }) {
  const [target, setTarget] = useState("generic"); // any agent by default: a prompt works with whatever is running
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false); // clipboard refused: show the text selected instead
  const [tip, setTip] = useState(false);
  const text = buildLaunchText({ card, target, workspace: api.getWorkspace(), boardUrl: window.location.origin });
  const t = LAUNCH_TARGETS.find((x) => x.id === target);
  const next = t.cmd ? `paste it in a terminal to start ${t.label} on ${card.id}` : "paste it into an agent that's already running";
  const menu = LAUNCH_TARGETS.map((x) => ({
    id: x.id,
    label: x.label,
    description: x.cmd ? `Starts ${x.cmd} in a terminal` : "A prompt to paste into a running session",
    dividerBefore: !x.cmd, // "Any agent" only copies a prompt; set it apart from the agents it would start
  }));

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setManual(false);
      setCopied(true);
      onCopied(`Copied — ${next}`);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setManual(true);
    }
  }

  const half = {
    display: "inline-flex", alignItems: "center", gap: 6, background: copied ? "#3DCC7B" : "#1D2027", color: "#fff",
    border: "none", padding: "8px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
  };
  const popover = {
    position: "absolute", bottom: "calc(100% + 8px)", right: 0, zIndex: 5, background: "#1D2027", color: "#fff",
    borderRadius: 6, padding: "8px 10px", fontSize: 11.5, lineHeight: 1.45,
  };

  return (
    <div data-tour="launch" style={{ position: "relative", display: "flex", alignItems: "center", gap: 8 }}>
      <button
        type="button"
        aria-label="What does hand off do?"
        aria-describedby={tip ? "handoff-tip" : undefined}
        onMouseEnter={() => setTip(true)}
        onMouseLeave={() => setTip(false)}
        onFocus={() => setTip(true)}
        onBlur={() => setTip(false)}
        style={{ display: "flex", background: "none", border: "none", padding: 2, color: "#9599A3", cursor: "help" }}
      >
        <HelpCircle size={15} />
      </button>
      {tip && (
        <div id="handoff-tip" role="tooltip" style={{ ...popover, width: 280 }}>
          {t.cmd
            ? `Copies a one-line command that starts ${t.label}${card.worktree ? " in this ticket's worktree" : ""} with a prompt pointing at ${card.id} on this board. Paste it in a terminal — nothing runs until you do.`
            : `Copies a short prompt with ${card.id} and this board's address. Paste it into an agent that's already running — nothing runs until you do.`}
        </div>
      )}

      <div style={{ display: "inline-flex", borderRadius: 7, overflow: "hidden" }}>
        <button type="button" onClick={copy} style={half}>
          {copied ? <Check size={14} /> : <Terminal size={14} />}
          {copied ? "Copied" : compact ? "Hand off" : `Hand off to ${t.cmd ? t.label : "any agent"}`}
        </button>
        <Dropdown
          value={target}
          options={menu}
          title="Hand off to"
          placement="top"
          menuAlign="right"
          onChange={(v) => { setTarget(v); setManual(false); }}
          renderTrigger={({ onClick }) => (
            <button
              type="button"
              onClick={onClick}
              aria-label={`Choose agent (now: ${t.label})`}
              aria-haspopup="menu"
              style={{ ...half, padding: "8px 9px", borderLeft: "1px solid rgba(255,255,255,0.18)", height: "100%" }}
            >
              <ChevronDown size={14} />
            </button>
          )}
        />
      </div>

      {manual && (
        <div style={{ ...popover, width: 320, background: "#fff", color: "#1D2027", border: "1px solid #E4E6EB", boxShadow: "0 8px 24px rgba(20,22,30,0.14)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ flex: 1, color: "#E5484D" }}>The browser blocked the clipboard — the text is selected, press ⌘C / Ctrl+C.</span>
            <button type="button" onClick={() => setManual(false)} aria-label="Close" style={{ display: "flex", background: "none", border: "none", cursor: "pointer", color: "#8B8D98" }}>
              <X size={14} />
            </button>
          </div>
          <textarea
            readOnly
            value={text}
            ref={(el) => { if (el) { el.focus(); el.select(); } }}
            onFocus={(e) => e.target.select()}
            className="mono"
            style={{ ...inputStyle, fontSize: 11, height: 120, resize: "vertical" }}
          />
        </div>
      )}
    </div>
  );
}

function DetailRow({ icon, label, children, last, required }) {
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 10, padding: "8px 2px",
        borderBottom: last ? "none" : "1px solid #F0F1F4",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7, width: 92, flexShrink: 0, color: "#6B6F79", fontSize: 12.5 }}>
        {icon}
        <span>{label}{required && <span title="Required" style={{ color: ERROR_COLOR, marginLeft: 2 }}>*</span>}</span>
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

function Field({ icon, label, children, style }) {
  return (
    <div style={{ marginBottom: 12, minWidth: 0, ...style }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, color: "#6B6F79", marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.4 }}>
        {icon}
        {label}
      </div>
      {children}
    </div>
  );
}

const headerLinkStyle = {
  display: "flex", alignItems: "center", gap: 5, background: "transparent", color: "#C7CBD4",
  border: "1px solid #3A3E48", borderRadius: 7, padding: "7px 10px", fontSize: 12.5, fontWeight: 600,
  cursor: "pointer", textDecoration: "none", fontFamily: "inherit",
};

// the drawer's small controls (project picker, hint buttons, menu rows) sit next to inline fields, so they
// share their text size and come close to their height
const CONTROL_SIZE = { fontSize: 13.5, padding: "8px 12px", borderRadius: 7 };

const inputStyle = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 7,
  border: "1px solid #E4E6EB",
  fontSize: 13.5,
  fontFamily: "inherit",
  background: "#FAFAFB",
};

const ERROR_COLOR = "#E5484D"; // same red as the drawer's Delete

// the message under a field that failed a check; `id` is what the field's aria-describedby points at
function FieldError({ id, children, style }) {
  return (
    <div id={id} role="alert" style={{ color: ERROR_COLOR, fontSize: 12, lineHeight: 1.4, ...style }}>
      {children}
    </div>
  );
}

// the board's focus ring — what the global input:focus rule draws on the Development inputs
const FOCUS_RING = { outline: "2px solid #4C8DFF", outlineOffset: 1 };

// a property value in the task drawer, after Atlassian's inline edit: plain text (read view) until it's clicked,
// then a field (edit view) while its menu or picker is open. Both views have the Development inputs' box
// (inputStyle: 8px 10px, 13.5px, radius 7) — the read view's is just transparent — so they're the same height
// and nothing moves on click (Atlassian's read and edit views are both 40px for the same reason). The edit view
// looks like a focused Development input, which is the board's own field style.
function propValueStyle({ open = false, empty = false } = {}) {
  return {
    ...inputStyle,
    display: "block",
    textAlign: "left",
    // pulled left by its padding + border so the text lines up with the label above, as Notion does; the hover
    // fill and the edit-view box stick out to the left instead
    marginLeft: -11, width: "calc(100% + 11px)",
    // a long value (a parent ticket title) stays on one line in its column
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
    cursor: "pointer",
    border: "1px solid transparent",
    background: undefined, // transparent from the .detail-value rule, so its :hover fill can show
    color: empty ? "#8B8D98" : "#1D2027",
    ...(open && { border: inputStyle.border, background: inputStyle.background, ...FOCUS_RING }),
  };
}

const chipTextStyle = { overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 };

const projectChipStyle = {
  ...CONTROL_SIZE,
  display: "inline-flex", alignItems: "center", gap: 6, maxWidth: 260, minWidth: 0, // a long name ellipsizes
  border: "1px solid #E4E6EB", background: "#fff",
  fontFamily: "inherit", color: "#1D2027", cursor: "pointer", whiteSpace: "nowrap",
};


// a text input used inline (Development fields): the Development input geometry, pulled left like propValueStyle so
// its text lines up with the label; border and fill come from the .inline-input rules so :hover/:focus can change them
const { border: _b, background: _bg, ...inputGeometry } = inputStyle;
const inlineInputStyle = { ...inputGeometry, marginLeft: -11, width: "calc(100% + 11px)" };

// Enter commits an inline text field the way leaving it does (onBlur saves)
function blurOnEnter(e) {
  if (e.key === "Enter") e.currentTarget.blur();
}

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
