import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { X, ChevronUp } from "lucide-react";

// AB-30: first-visit spotlight tour. Dims the page, lights one region at a
// time (any element tagged data-tour="..."), with a bubble beside it. The
// dimming layer ignores pointer events, so the lit region stays usable.

export const TOUR_SEEN_KEY = "agent-board.tour-seen";
const DEMO_KEY = "agent-board.tour-demo"; // {workspace, id} of the last demo card, for the cleanup offer

// localStorage can throw (private mode, blocked storage) — the tour must still work, just unremembered
export function readStore(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function writeStore(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}

const DEMO_TITLE = "[Demo] Add a dark mode toggle";
export function demoTicket(project) {
  return {
    title: DEMO_TITLE,
    project,
    agent: null,
    priority: "med",
    status: "backlog",
    notes: "Created by the tour to show what a ticket looks like — safe to delete.\n\n- what to build, in a sentence or two\n- links, blockers, a checklist: whatever the next agent needs",
  };
}

// the seed project from db.js seedOnboarding — "no project of your own" means only this one
export const isSeedProject = (p) => p.name === "Agent Board" && p.prefix === "AB";

export function guideUrl(workspace) {
  return `?guide${workspace && workspace !== "default" ? `&workspace=${encodeURIComponent(workspace)}` : ""}`;
}

const STEP_NO = { board: 1, demo: 2, "demo-draft": 2, "demo-card": 2, project: 3, "new-task": 3, launch: 4, done: 5 };
const TOTAL = 5;

function unionRect(selector) {
  const els = [...document.querySelectorAll(selector)];
  if (!els.length) return null;
  const vw = window.innerWidth, vh = window.innerHeight;
  let top = Infinity, left = Infinity, right = -Infinity, bottom = -Infinity;
  for (const el of els) {
    const r = el.getBoundingClientRect();
    top = Math.min(top, r.top); left = Math.min(left, r.left);
    right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom);
  }
  // clip to the viewport (the board scrolls sideways on a phone)
  top = Math.max(top, 0); left = Math.max(left, 0); right = Math.min(right, vw); bottom = Math.min(bottom, vh);
  if (right <= left || bottom <= top) return null;
  return { top, left, width: right - left, height: bottom - top, bottom, right };
}

// beside the lit region if there's room (below, above, left, right), else centered over it —
// on a phone that's the drawer's optional middle fields, not its title/project (top) or Create (bottom)
function placeBubble(rect, w, h, vw, vh, gap = 14, m = 8) {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
  if (!rect) return { top: (vh - h) / 2, left: (vw - w) / 2 };
  const cx = clamp(rect.left + rect.width / 2 - w / 2, m, vw - w - m);
  const cy = clamp(rect.top, m, vh - h - m);
  if (rect.bottom + gap + h <= vh - m) return { top: rect.bottom + gap, left: cx };
  if (rect.top - gap - h >= m) return { top: rect.top - gap - h, left: cx };
  if (rect.left - gap - w >= m) return { top: cy, left: rect.left - gap - w };
  if (rect.right + gap + w <= vw - m) return { top: cy, left: rect.right + gap };
  return { top: (vh - h) / 2, left: (vw - w) / 2 };
}

export default function Tour({ cards, projects, workspace, drawerOpen, dialogOpen, onClose, actions }) {
  const [step, setStep] = useState("board");
  const [demoId, setDemoId] = useState(null);
  const [realId, setRealId] = useState(null);
  const [minimized, setMinimized] = useState(false);
  const [busy, setBusy] = useState(false);
  const baseline = useRef(new Set(cards.map((c) => c.id)));
  const ownProjects = projects.filter((p) => !isSeedProject(p));

  function go(next) {
    baseline.current = new Set(cards.map((c) => c.id)); // "new card" = not on the board when this step began
    setMinimized(false);
    setStep(next);
  }
  const afterDemo = () => (ownProjects.length ? "new-task" : "project");
  const NEXT = {
    board: () => (projects.length ? "demo" : afterDemo()),
    demo: afterDemo, "demo-draft": afterDemo, "demo-card": afterDemo,
    project: () => "new-task",
    "new-task": () => "launch",
    launch: () => "done",
  };
  function skip() {
    if (step === "demo-draft") actions.closeDrawer();
    go(NEXT[step]());
  }

  // steps that wait for the user (or the demo) to do something on the board itself
  useEffect(() => {
    const fresh = cards.filter((c) => !baseline.current.has(c.id));
    if (step === "demo-draft") {
      const demo = fresh.find((c) => c.title === DEMO_TITLE);
      if (demo) {
        setDemoId(demo.id);
        writeStore(DEMO_KEY, JSON.stringify({ workspace, id: demo.id }));
        go("demo-card");
      }
    } else if (step === "project" && ownProjects.length) {
      go("new-task");
    } else if (step === "new-task") {
      const mine = fresh.find((c) => c.title !== DEMO_TITLE);
      if (mine) { setRealId(mine.id); go("launch"); }
    }
  }, [step, cards, projects]);

  // step entry side effects
  useEffect(() => {
    if (step === "launch") {
      const card = [realId, demoId].map((id) => cards.find((c) => c.id === id)).find(Boolean)
        || cards.find((c) => c.status === "in_progress") || cards[0];
      if (card) actions.openCard(card);
      else go("done");
    }
    if (step === "done") actions.closeDrawer();
  }, [step]);

  const storedDemo = (() => {
    try { return JSON.parse(readStore(DEMO_KEY)); } catch { return null; }
  })();
  const leftoverDemo = storedDemo?.workspace === workspace
    ? cards.find((c) => c.id === storedDemo.id && c.title === DEMO_TITLE)
    : null;

  async function run(fn) {
    setBusy(true);
    try { await fn(); } catch (e) { actions.showError(e.message); } finally { setBusy(false); }
  }

  const guideHref = guideUrl(workspace);

  const S = {
    board: {
      targets: ["[data-tour=column]"],
      title: "This is your board",
      body: "Each card is one piece of work, yours or an agent's. Columns are status: Backlog → In Progress → Review → Done. The cards in the Agent Board project are examples — one was left mid-handoff by Claude, the way a real one looks.",
      primary: ["Next", () => go(NEXT.board())],
    },
    demo: {
      targets: ["[data-tour=new-task]"],
      title: "Watch me open a ticket",
      body: "I'll fill one in and create it for you. It's marked [Demo], and you can delete it at the end.",
      primary: ["Show me", () => { actions.openDemoDraft(); go("demo-draft"); }],
      secondary: ["Seen it — skip the demo", () => go(afterDemo())],
    },
    "demo-draft": {
      targets: ["[data-tour=drawer]", "[data-tour=new-task]"],
      title: "A ticket needs two things",
      body: "A title and a project. Agent, priority, description, worktree: all optional, and you or the agent can fill them in later.",
      primary: ["Create it", () => run(actions.createDemo)],
    },
    "demo-card": {
      targets: [`[data-tour-card="${demoId}"]`],
      title: `That's ${demoId}`,
      body: "It's on the board, and every agent sees it through the CLI or MCP right away — nothing to sync.",
      primary: ["Next", () => go(afterDemo())],
    },
    project: {
      targets: ["[data-tour=project-dialog]", "[data-tour=project-filter]"],
      title: "Now yours: make a project",
      body: dialogOpen
        ? "Name it, and type the prefix you want in its ticket ids (APP for APP-1, APP-2…). The board never picks one for you."
        : "Projects group tickets. You pick the prefix — it goes in every ticket id (APP-1, APP-2…), and the board never picks one for you.",
      primary: !dialogOpen && ["Create a project", actions.openNewProject],
    },
    "new-task": {
      targets: ["[data-tour=drawer]", "[data-tour=new-task]"],
      title: "Open your first real ticket",
      body: drawerOpen === "new"
        ? "Give it a title, pick your project, then press Create."
        : "Click + New task. Give it a title, pick your project, then Create.",
    },
    launch: {
      targets: ["[data-tour=launch]"],
      title: "Hand it to an agent",
      body: "Pick an agent and copy. Paste it into a terminal: the agent starts with this ticket's id, reads its history, and reports back here with agent-board note / update. Nothing runs until you paste it.",
      primary: ["Next", () => go("done")],
    },
    done: {
      targets: [],
      title: "You're set",
      body: "Agents report on this board as they work, and it updates live. Rerun this tour any time from Tour in the header.",
    },
  }[step];

  // follow the target: it can move (drawer sliding in, live updates, scrolling)
  const [rect, setRect] = useState(null);
  useEffect(() => {
    let last = "";
    let scrolled = false;
    function measure() {
      const sel = S.targets.find((t) => document.querySelector(t));
      if (sel && !scrolled) {
        scrolled = true;
        const el = document.querySelector(sel), r = el.getBoundingClientRect();
        if (r.top < 0 || r.left < 0 || r.bottom > window.innerHeight || r.right > window.innerWidth) {
          el.scrollIntoView({ block: "nearest", inline: "nearest" });
        }
      }
      const r = sel ? unionRect(sel) : null;
      const key = JSON.stringify(r);
      if (key !== last) { last = key; setRect(r); }
    }
    measure();
    const timer = setInterval(measure, 150);
    window.addEventListener("resize", measure);
    return () => { clearInterval(timer); window.removeEventListener("resize", measure); };
  }, [step, demoId, S.targets.join()]);

  const hole = rect && { top: rect.top - 6, left: rect.left - 6, bottom: rect.bottom + 6, right: rect.right + 6 };
  const bubbleRef = useRef(null);
  const [pos, setPos] = useState({ top: -9999, left: 0 });
  useLayoutEffect(() => {
    const el = bubbleRef.current;
    if (!el) return;
    const pad = hole && { ...hole, width: hole.right - hole.left, height: hole.bottom - hole.top };
    setPos(placeBubble(pad, el.offsetWidth, el.offsetHeight, window.innerWidth, window.innerHeight));
  }, [rect, step, minimized, drawerOpen, dialogOpen]);

  const btn = (primary) => ({
    border: primary ? "none" : "1px solid #E4E6EB", background: primary ? "var(--ab-accent)" : "#fff",
    color: primary ? "#fff" : "#42454D", borderRadius: 7, padding: "7px 12px", fontSize: 12.5,
    fontWeight: 600, cursor: busy ? "wait" : "pointer", fontFamily: "inherit",
  });

  return (
    <div className="tour" role="dialog" aria-label="Agent Board tour" aria-live="polite">
      {/* the dim layer: one full sheet, or four panels framing the lit region (a 9999px
          box-shadow or an evenodd clip-path would be one element, but Chrome drew both unreliably) */}
      {(hole
        ? [
            { top: 0, left: 0, right: 0, height: Math.max(hole.top, 0) },
            { top: hole.bottom, left: 0, right: 0, bottom: 0 },
            { top: hole.top, left: 0, width: Math.max(hole.left, 0), height: hole.bottom - hole.top },
            { top: hole.top, left: hole.right, right: 0, height: hole.bottom - hole.top },
          ]
        : [{ inset: 0 }]
      ).map((box, i) => (
        <div
          key={i}
          className="tour-dim"
          style={{ position: "fixed", zIndex: 900, background: "rgba(10,12,16,0.55)", pointerEvents: step === "done" ? "auto" : "none", ...box }}
        />
      ))}
      {hole && (
        <div
          style={{
            position: "fixed", zIndex: 900, pointerEvents: "none", borderRadius: 6, boxShadow: "0 0 0 2px var(--ab-accent)",
            top: hole.top, left: hole.left, width: hole.right - hole.left, height: hole.bottom - hole.top,
          }}
        />
      )}

      {minimized ? (
        <button
          onClick={() => setMinimized(false)}
          style={{ ...btn(true), position: "fixed", left: 12, bottom: 12, zIndex: 901, display: "flex", alignItems: "center", gap: 6, boxShadow: "0 6px 20px rgba(9,10,12,0.3)" }}
        >
          <ChevronUp size={14} /> Tour {STEP_NO[step]}/{TOTAL}
        </button>
      ) : (
        <div
          ref={bubbleRef}
          style={{
            position: "fixed", zIndex: 901, top: pos.top, left: pos.left, width: "min(340px, calc(100vw - 16px))",
            background: "#fff", color: "#1D2027", borderRadius: 10, padding: "14px 16px",
            boxShadow: "0 12px 40px rgba(9,10,12,0.35)", fontSize: 13, lineHeight: 1.5,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span className="mono" style={{ fontSize: 11, color: "#9599A3" }}>{STEP_NO[step]} / {TOTAL}</span>
            <span style={{ flex: 1 }} />
            {step !== "done" && (
              <button onClick={skip} style={{ background: "none", border: "none", color: "#8B8D98", fontSize: 11.5, cursor: "pointer", fontFamily: "inherit" }}>
                Skip step
              </button>
            )}
            {step !== "done" && (
              <button onClick={() => setMinimized(true)} style={{ background: "none", border: "none", color: "#9599A3", fontSize: 11.5, cursor: "pointer", fontFamily: "inherit" }}>
                Hide
              </button>
            )}
            <button aria-label="Close tour" title="Close tour" onClick={onClose} style={{ background: "none", border: "none", color: "#8B8D98", cursor: "pointer", display: "flex", padding: 2 }}>
              <X size={16} />
            </button>
          </div>
          <div style={{ fontWeight: 700, fontSize: 14.5, marginBottom: 4 }}>{S.title}</div>
          <div style={{ color: "#42454D" }}>{S.body}</div>

          {step === "done" && (
            <a href={guideHref} style={{ display: "inline-block", marginTop: 10, color: "#4C8DFF", fontWeight: 600, textDecoration: "none" }}>
              Next: the first-ticket guide, as text and commands →
            </a>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            {S.secondary && <button disabled={busy} onClick={S.secondary[1]} style={btn(false)}>{S.secondary[0]}</button>}
            {step === "done" && leftoverDemo && (
              <button disabled={busy} onClick={() => run(() => actions.deleteCard(leftoverDemo.id))} style={{ ...btn(false), color: "#E5484D" }}>
                Delete demo ticket {leftoverDemo.id}
              </button>
            )}
            {S.primary && <button disabled={busy} onClick={S.primary[1]} style={btn(true)}>{S.primary[0]}</button>}
            {step === "done" && <button onClick={onClose} style={btn(true)}>Finish</button>}
          </div>
        </div>
      )}
    </div>
  );
}
