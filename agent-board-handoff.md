# Agent Board — 交接文件(v2,含架構討論定案)

> 目標:一個本機跑的 Jira 風格看板,記錄多個 CLI coding agent(Claude Code / Codex / OpenCode / Gemini CLI / pi agent 等)在多個專案上的進度。不管跑哪一款 agent,都能 CRUD 看板狀態。以 `npx` 方式安裝執行。
>
> v1 全文見 `agent-board-handoff.v1.2026-08-31.md`。本版取代 v1 中「兩條路徑並存(wrapper + MCP)」的結論,改為下方「互動模式」章節的設計。

---

## 0. 這版變更了什麼(相對 v1)

- 寫入路徑從「Shell wrapper(保底)+ MCP server(主力)」改為「**CLI 優先、MCP 其次**」,共用同一組 REST API 後端,不做 shell wrapper
- 資料模型新增 `parent_id`(兩層任務結構:task / subtask),`worktree`、`branch` 欄位確定加入(掛在有 `parent_id` 的 subtask 上)
- 票的識別從隨機 `uid()` 改為 **`{project 前綴}-{流水號}`**(例如 `AB-42`),前綴由使用者在建立 project 時手動指定
- 儲存直接上 SQLite(WAL mode),不做 JSON 檔案過渡
- Port 固定 `4317`
- MCP 工具維持 4 個,`list_tasks` / `create_task` 增加選填 `parent_id` 參數

---

## 1. 整體架構

```
┌─────────────────────────────────────────────┐
│  Ghostty                                     │
│  ┌───────────┐  ┌───────────┐  ┌──────────┐  │
│  │ claude     │  │ codex     │  │ pi agent │  │
│  │ (worktree │  │ (worktree │  │ (worktree│  │
│  │  A)       │  │  B)       │  │  C)      │  │
│  └─────┬─────┘  └─────┬─────┘  └────┬─────┘  │
│        │ shell/bash 呼叫 agent-board CLI（都有）│
│        │ MCP client（部分支援，加分）           │
└────────┼──────────────┼─────────────┼────────┘
         │              │             │
         ▼              ▼             ▼
   ┌─────────────────────────────────────────┐
   │  agent-board server (Node, localhost:4317)│
   │  ┌───────────────┐   ┌─────────────────┐ │
   │  │ MCP server     │   │ REST API        │ │
   │  │ (tools: list/  │   │ /api/tasks      │ │
   │  │  create/update/│   │ CRUD            │ │
   │  │  note)         │   │                 │ │
   │  └───────┬────────┘   └────────┬────────┘ │
   │          └───────────┬─────────┘          │
   │                       ▼                    │
   │           SQLite (tasks.db, WAL mode)      │
   └──────────────────────┬──────────────────────┘
                          │ serves
                          ▼
              ┌───────────────────────┐
              │ Web UI (localhost:4317)│
              │ 看板頁面 (React, 已有草稿) │
              └───────────────────────┘
```

---

## 2. 互動模式(agent 怎麼更新/讀取 board)—— 討論定案

三個候選方案比較過:

- **A. MCP tools** — agent 對話中主動呼叫工具,語意清楚、agent 呼叫準確率高,但只有支援 MCP 的 agent 能用(Claude Code / Codex / Gemini CLI 原生支援,OpenCode 不確定,pi agent 不支援)
- **B. Shell wrapper**(v1 的保底路徑)— 包住 agent 指令,只在開始/結束打 API,顆粒度太粗。**已放棄**,理由見下方
- **C. CLI 指令** — `agent-board` 二進位檔,agent 透過自己已有的 shell/bash 能力呼叫(`agent-board update AB-42 --status=review`),不挑 agent(所有 code agent 都有 shell),顆粒度跟 MCP 一樣細,但需要在專案的 `CLAUDE.md`/`AGENTS.md` 裡明確提示 agent 使用方式

**定案:C 優先實作,A(MCP)是下一步。**

理由:
- token/runtime 成本上,MCP tool 呼叫跟「Bash 執行 CLI」幾乎一樣貴,差異不在 runtime,在可靠性(MCP 有 schema、agent 呼叫更準)與涵蓋率(CLI 對任何有 shell 的 agent 都通用)
- C 的 CLI 本質是打同一組 REST API;A 的 MCP tool handler 也是打同一組 REST API,只是包一層 schema。先做 C 等於把 A 的地基也做了,A 之後補上成本很低,不衝突
- B(shell wrapper)被放棄,因為顆粒度太粗(只有開始/結束兩個事件),且各家 agent 的**生命週期 hook**(Claude Code 的 SessionStart/Stop/PreToolUse 等)是更精準的替代方案——但這塊**先不排進主線**,因為不是每款 agent 都有 hook(pi agent 目前沒有),等真的需要細粒度自動回報時再另外討論
- 「像改 md 一樣直接編輯共享檔案」的方案已排除:跨專案的前提下,共享檔案必然在專案目錄外(例如 `~/.agent-board/`),Claude Code 這類工具對專案外檔案編輯預設會跳權限確認,體驗比呼叫 CLI/MCP 更卡,並不比較省事

### 讀取情境(agent 何時該主動查 board)

討論過四個情境,結論:

1. **換手接續**(agent A 做一半、agent B 接手)—— **靠人工引用**,使用者在對話裡打 `@AB-42` 告訴 agent 要接哪張票,agent 收到引用後查該票的 notes。**不做自動化**(不需要 agent 在 session 開頭主動掃描 board),保持簡單。
2. **同專案多 worktree 平行跑,避免撞車**—— **不做即時碰撞偵測**。改用資料結構解法:同一個 task 底下開多個 worktree = 建立多個 subtask(`parent_id` 指向同一個 task),board 上天然分組顯示,使用者一眼就看得出哪些票在平行跑同一件事,不需要 agent 主動查詢比對。
3. **agent 主動「去 board 挑一張票做」**—— 用 `list_tasks(project?, status?, parent_id?)`,**每次即時查詢、不快取**(因為使用者隨時可能手動改了 board,agent 不能假設自己上次看到的狀態還是最新的)。
4. **人工在 UI 上手動 CRUD**—— 是一等公民,跟 agent 走同一組 REST API、同一份資料,沒有「UI 唯讀」這回事。有些工作是概念性/局部由人完成,agent 不需要、也不會知道這些手動變更,直到下次查詢。

---

## 3. 資料模型

```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,       -- 格式:{project 前綴}-{流水號},例如 AB-42
  seq INTEGER NOT NULL,       -- project 內流水號(產生 id 用)
  title TEXT NOT NULL,
  project TEXT,
  project_prefix TEXT,        -- 使用者建立 project 時手動指定,例如 "AB"
  parent_id TEXT REFERENCES tasks(id),  -- 選填:指向父 task,代表本票是 subtask
  agent TEXT,                 -- claude | codex | opencode | gemini | pi | other
  priority TEXT,               -- low | med | high
  status TEXT,                 -- backlog | in_progress | review | done
  notes TEXT,
  worktree TEXT,               -- 選填,通常只有 subtask(有 parent_id)會填
  branch TEXT,                 -- 選填,同上
  created_at INTEGER,
  updated_at INTEGER
);
```

**票號規則**:`{project_prefix}-{seq}`,`seq` 為該 project 內的流水號(不是全域流水號,也不含 tier)。前綴由使用者建立 project 時手動輸入一次,之後同一 project 沿用(避免自動推導撞名,例如 `agent-board` 跟 `api-backend` 都想取 `AB`)。

**層級只做兩層**:task(無 `parent_id`)與 subtask(有 `parent_id`,指向另一張 task)。不做 Epic/User Story 四層——這是服務大型團隊長期 roadmap 的複雜度,單人 + 多 agent 平行跑的場景用不上,先不做,之後真的需要再加。

**`worktree`/`branch`**:欄位現在就加(成本低,兩個 TEXT column),但「點卡片直接 cd 過去」這個跳轉功能先不做——瀏覽器沒辦法直接操作本機 terminal,這需要另外設計(例如 CLI 提供 `agent-board open <id>`,由使用者自己在 terminal 呼叫),不在這階段範圍內。

---

## 4. REST API(給 Web UI、CLI、MCP server 共用)

| Method | Path | 用途 |
|---|---|---|
| GET | `/api/tasks` | 列出任務,可加 query filter(`?project=`、`?agent=`、`?status=`、`?parent_id=`) |
| POST | `/api/tasks` | 建立任務(可帶 `parent_id` 建 subtask) |
| PATCH | `/api/tasks/:id` | 局部更新(狀態、筆記、worktree/branch 等) |
| DELETE | `/api/tasks/:id` | 刪除 |
| GET | `/api/projects` | 目前有哪些 project 及其前綴(給 UI 篩選、給 CLI 產生票號用) |
| POST | `/api/projects` | 建立 project,需指定 `prefix`(手動輸入,見上) |

CLI 與 MCP server 都是這組 API 的 client,不直接碰 SQLite。

---

## 5. CLI 設計(主力寫入路徑)

`agent-board` 二進位檔(npx 套件的 `bin`),供 agent 透過 shell/bash 工具呼叫:

```bash
agent-board list [--project=] [--status=] [--parent=AB-42]
agent-board create --title="..." --project=agent-board [--parent=AB-42] [--agent=claude]
agent-board update AB-42 --status=review
agent-board note AB-42 "卡在 XX,需要先確認 API 回傳格式"
```

需要在各專案的 `CLAUDE.md`/`AGENTS.md` 裡明確告知 agent:何時該呼叫(開始工作、狀態變化、卡住時)、怎麼呼叫(上述指令格式)、以及**每次查詢都要即時打 API,不要憑對話記憶假設 board 狀態**(見上方讀取情境 3 的結論)。

---

## 6. MCP Server 工具設計(A,C 之後的下一步)

`@modelcontextprotocol/sdk`,http transport(方便多個 agent session 共用同一個 server 實例,stdio 是一對一,不適合這個場景)。

工具維持 4 個,呼叫的是跟 CLI 相同的 REST API:

- `list_tasks(project?, status?, parent_id?)` — 讀取看板現況;`parent_id` 用來查某個 task 底下有哪些 subtask,不另開 `list_subtasks` 工具(工具數量盡量少,語意清楚,agent 才會穩定觸發正確工具)
- `create_task(title, project, agent, priority?, parent_id?)` — 開新任務或 subtask
- `update_task_status(task_id, status)` — 搬欄位
- `add_task_note(task_id, note)` — 補充筆記(worktree 路徑、blocker、PR 連結等)

各 CLI 設定範例(語法都接近):

```bash
# Claude Code
claude mcp add agent-board --url http://localhost:4317/mcp

# Codex CLI
codex mcp add agent-board --url http://localhost:4317/mcp

# Gemini CLI
gemini mcp add agent-board --url http://localhost:4317/mcp
```

> 實際指令與設定檔格式建置時要對照各家當下最新文件再確認一次,這塊變動快。

---

## 7. 專案結構(npx 套件)

```
agent-board/
├── package.json          # bin: agent-board -> dist/cli.js
├── src/
│   ├── server.js          # Express app,掛載 REST + MCP endpoint(4317)+ 靜態檔
│   ├── cli.js              # CLI entrypoint(list/create/update/note）,打 REST API
│   ├── db.js               # SQLite(WAL mode)初始化與 query helper
│   ├── mcp/
│   │   └── tools.js        # MCP tool 定義(下一步)
│   └── routes/
│       ├── tasks.js
│       └── projects.js
├── web/                   # 前端,把現有 agent-board.jsx 改寫:
│                           #   - window.storage.get/set 換成 fetch('/api/tasks')
│                           #   - 其餘 UI 邏輯不用動,新增 parent_id 分組顯示
├── scripts/
│   └── (無 shell wrapper — 已放棄)
└── README.md
```

`package.json` 關鍵:

```json
{
  "name": "agent-board",
  "bin": { "agent-board": "./src/cli.js" },
  "scripts": { "start": "node src/server.js" }
}
```

使用者之後就是 `npx agent-board`(啟動 server,固定監聽 4317)。agent 透過 shell 呼叫的則是同一個 `agent-board` 指令的 CRUD 子命令。

---

## 8. 已有素材

- `agent-board.jsx` — 目前 UI 草稿(拖曳看板、4 欄、project/agent/priority 標籤、篩選、Modal 編輯)。搬過去時把 `window.storage` 那段換成打 REST API 即可;需另外加上 subtask 分組顯示(依 `parent_id` 把子票收在對應的父票下)與票號(`AB-42`)顯示。

---

## 9. 待你本地決定的事項(已解決見上方各節;以下是仍未定案的)

- [ ] Hook 整合(利用各 agent 生命週期事件自動觸發 CLI)—— 想法保留,不卡主線,等有明確需求(例如發現 agent 常忘記呼叫 CLI)再另外討論
- [ ] `agent-board open <id>` 這種「跳轉到 worktree」的 CLI 指令要不要做,做到什麼程度(開新 terminal tab / 只印路徑讓使用者自己 cd)
- [ ] 是否要發布到 npm 公開,還是只在本機 `npm link` 用

---

## 10. 建議實作順序

1. Express server + SQLite(WAL mode)+ REST API(含 `project_prefix`、`parent_id`、`worktree`/`branch` 欄位)—— 先讓看板能跑,手動 CRUD
2. `agent-board` CLI(list/create/update/note),打上面的 REST API
3. 把 `agent-board.jsx` 接上 REST API,取代 `window.storage`,加上票號與 subtask 分組顯示
4. 包成 npx 套件,固定 port 4317,本機跑起來驗證
5. 在一個實際專案裡驗證「agent 透過 CLAUDE.md 指示,主動呼叫 CLI 回報狀態」是否穩定
6. 加 MCP server(工具打同一組 REST API),先在 Claude Code 上驗證
7. 視情況擴到 Codex CLI / Gemini CLI
