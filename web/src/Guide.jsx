import { useState } from "react";
import { Copy, Check, ArrowLeft } from "lucide-react";
import { BrandMark } from "./theme.jsx";
import { buildLaunchText } from "./launch.js";
import template from "../../templates/CLAUDE.md.example?raw";

// AB-31: the tour's steps as text + commands, for people who'd rather read.
// Lives at ?guide on the same server, so it needs nothing the board doesn't.

const NPX = "npx -y @limao.li.design/agent-board";
const claudeMdSection = template.replace(/<!--[\s\S]*?-->\s*/, "").trim();
const sample = { id: "APP-1", title: "Add a dark mode toggle", project: "My App", projectPrefix: "APP", worktree: "~/code/my-app" };

function Cmd({ children }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {} // the text is selectable right there
  }
  return (
    <div className="guide-cmd">
      <pre className="mono">{children}</pre>
      <button onClick={copy} aria-label="Copy" title="Copy">{copied ? <Check size={13} /> : <Copy size={13} />}</button>
    </div>
  );
}

function Step({ n, title, children }) {
  return (
    <section className="guide-step">
      <h2><span className="mono">{n}</span>{title}</h2>
      {children}
    </section>
  );
}

export default function Guide() {
  const params = new URLSearchParams(window.location.search);
  const ws = params.get("workspace");
  const board = `./${ws ? `?workspace=${encodeURIComponent(ws)}` : ""}`;
  const origin = window.location.origin;

  return (
    <div className="guide">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; background: #F4F5F7; }
        .guide { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1D2027; min-height: 100vh; }
        .mono { font-family: 'JetBrains Mono', monospace; }
        .guide header { background: var(--ab-chrome); color: #fff; padding: 14px 22px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .guide header a { color: #C7CBD4; text-decoration: none; display: flex; align-items: center; gap: 5px; font-size: 13px; font-weight: 600; border: 1px solid #3A3E48; border-radius: 7px; padding: 6px 10px; }
        .guide main { max-width: 760px; margin: 0 auto; padding: 24px 16px 64px; }
        .guide h1 { font-size: 24px; margin: 8px 0 6px; }
        .guide .lede { color: #5B5F69; font-size: 14.5px; line-height: 1.6; margin: 0 0 22px; }
        .guide-step { background: #fff; border: 1px solid #E4E6EB; border-radius: 10px; padding: 18px 20px; margin-bottom: 16px; }
        .guide-step h2 { font-size: 16px; margin: 0 0 10px; display: flex; align-items: center; gap: 10px; }
        .guide-step h2 .mono { font-size: 12px; background: var(--ab-accent); color: #fff; border-radius: 99px; width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .guide-step h3 { font-size: 13px; margin: 14px 0 6px; color: #42454D; text-transform: uppercase; letter-spacing: .4px; }
        .guide-step p, .guide-step li { font-size: 14px; line-height: 1.6; color: #31343B; }
        .guide-step p { margin: 0 0 8px; }
        .guide-step ul, .guide-step ol { margin: 0 0 8px; padding-left: 20px; }
        .guide code { font-family: 'JetBrains Mono', monospace; font-size: 12.5px; background: #F0F1F4; border-radius: 4px; padding: 1px 4px; }
        .guide-cmd { position: relative; margin: 6px 0 10px; }
        .guide-cmd pre { margin: 0; background: #181B21; color: #E6E7EB; border-radius: 8px; padding: 10px 40px 10px 12px; font-size: 12.5px; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }
        .guide-cmd button { position: absolute; top: 6px; right: 6px; background: #2A2E37; color: #C7CBD4; border: none; border-radius: 6px; padding: 6px; cursor: pointer; display: flex; }
        .guide details summary { cursor: pointer; font-size: 14px; font-weight: 600; color: #42454D; }
        .guide a { color: #4C8DFF; }
      `}</style>

      <header>
        <BrandMark size={20} />
        <span style={{ fontWeight: 700, fontSize: 15 }}>Agent Board</span>
        <span style={{ fontSize: 13, color: "#8B8D98" }}>First ticket guide</span>
        <span style={{ flex: 1 }} />
        <a href={board}><ArrowLeft size={14} /> Back to the board</a>
      </header>

      <main>
        <h1>Your first ticket, step by step</h1>
        <p className="lede">
          The same path as the board's tour, as text and commands. Every command below works as-is with <code>npx</code>;
          if you've installed the package globally (<code>npm install -g @limao.li.design/agent-board</code>), you can write
          the shorter <code>agent-board</code> instead of <code>{NPX}</code>.
        </p>

        <Step n="1" title="Start the board">
          <Cmd>npx @limao.li.design/agent-board</Cmd>
          <p>The first run downloads the package (about 30 seconds). Then open <a href="http://localhost:4317">http://localhost:4317</a>. Keep that terminal open: it's the server every agent and this page talk to.</p>
          <p>The board starts with an example project, <b>Agent Board</b>, holding three example tickets. Delete them whenever you like.</p>
        </Step>

        <Step n="2" title="Make a project for your work">
          <p>Tickets belong to a project, and each project has a short prefix that goes in every ticket id (<code>APP-1</code>, <code>APP-2</code>…). You choose the prefix; the board never picks one for you.</p>
          <h3>On the board</h3>
          <p>Open the project filter in the toolbar → <b>+ New project</b> → type a name and a prefix → Create.</p>
          <h3>From a terminal</h3>
          <Cmd>{`${NPX} project create "My App" --prefix=APP`}</Cmd>
          <p>Leave out <code>--prefix</code> and it suggests a few and asks you to pick.</p>
        </Step>

        <Step n="3" title="Open a ticket">
          <p>A ticket needs a title and a project. Agent, priority, description and worktree are optional — you or the agent can add them later.</p>
          <h3>On the board</h3>
          <p>Click <b>+ New task</b> (top right) → title → pick your project → Create.</p>
          <h3>From a terminal</h3>
          <Cmd>{`${NPX} create --project="My App" --title="Add a dark mode toggle" --notes="Settings page, remember the choice"`}</Cmd>
        </Step>

        <Step n="4" title="Hand it to an agent">
          <p>Open the ticket and press <b>Hand off</b> at the bottom. By default it copies a prompt for <i>any agent</i> to paste into a session that's already running; pick Claude Code, Codex, Gemini CLI or Pi with its <b>▾</b> to copy a command that starts that agent instead, and paste it into a terminal. It only copies — nothing runs until you paste it.</p>
          <p>For a ticket <code>APP-1</code> with a worktree set, Codex gets this:</p>
          <Cmd>{buildLaunchText({ card: sample, target: "codex", boardUrl: origin, workspace: ws || "default" })}</Cmd>
          <p>The agent claims the ticket, reads its history, and reports back with <code>agent-board note</code> / <code>update</code> (or the MCP tools). Keep the board open: it updates live as they work.</p>
        </Step>

        <Step n="5" title="Advanced: make it automatic">
          <details>
            <summary>A "Task board" section in your project's CLAUDE.md / AGENTS.md</summary>
            <p style={{ marginTop: 10 }}>Paste this into the project's <code>CLAUDE.md</code> (Codex and others read <code>AGENTS.md</code>). Replace <code>PROJECT_NAME</code> with the board's project name and <code>claude</code> with the agent's id. Agents then open and update tickets without being asked.</p>
            <Cmd>{claudeMdSection}</Cmd>
          </details>
          <details style={{ marginTop: 12 }}>
            <summary>Register the MCP server, so agents get board tools</summary>
            <p style={{ marginTop: 10 }}>Claude Code (once, for every project):</p>
            <Cmd>{`claude mcp add agent-board -s user -- ${NPX} mcp`}</Cmd>
            <p>Codex, in <code>~/.codex/config.toml</code>:</p>
            <Cmd>{`[mcp_servers.agent-board]\ncommand = "npx"\nargs = ["-y", "@limao.li.design/agent-board", "mcp"]\nstartup_timeout_sec = 60`}</Cmd>
            <p>If the board isn't running, the MCP server starts it in the background and says so in its first reply.</p>
          </details>
        </Step>

        <p className="lede">Prefer to be shown? <a href={`${board}${board.includes("?") ? "&" : "?"}tour`}>Run the tour on the board</a>.</p>
      </main>
    </div>
  );
}
