# Agent Board — 交接文件

> 目標:一個本機跑的 Jira 風格看板,記錄多個 CLI coding agent(Claude Code / Codex / OpenCode / Gemini CLI 等)在多個專案上的進度。不管跑哪一款 agent,都能 CRUD 看板狀態。以 `npx` 方式安裝執行。

---

## 1. 整體架構

```
┌─────────────────────────────────────────────┐
│  Ghostty                                     │
│  ┌───────────┐  ┌───────────┐  ┌──────────┐  │
│  │ claude     │  │ codex     │  │ opencode │  │
│  │ (worktree │  │ (worktree │  │ (worktree│  │
│  │  A)       │  │  B)       │  │  C)      │  │
│  └─────┬─────┘  └─────┬─────┘  └────┬─────┘  │
│        │ MCP client   │ MCP client  │ MCP    │
│        │ (原生支援)    │ (原生支援)   │ 不確定  │
└────────┼──────────────┼─────────────┼────────┘
         │              │             │
         ▼              ▼             ▼
   ┌─────────────────────────────────────────┐
   │  agent-board server (Node, localhost)    │
   │  ┌───────────────┐   ┌─────────────────┐ │
   │  │ MCP server     │   │ REST API        │ │
   │  │ (tools: list/  │   │ /api/tasks      │ │
   │  │  create/update/│   │ CRUD            │ │
   │  │  note)         │   │                 │ │
   │  └───────┬────────┘   └────────┬────────┘ │
   │          └───────────┬─────────┘          │
   │                       ▼                    │
   │              SQLite (tasks.db)             │
   └──────────────────────┬──────────────────────┘
                          │ serves
                          ▼
              ┌───────────────────────┐
              │ Web UI (localhost:PORT)│
              │ 看板頁面 (React, 已有草稿) │
              └───────────────────────┘
```

**兩條更新路徑並存**(見前面討論的結論):

1. **Shell wrapper(保底,任何 CLI 都適用)**— 包住 `claude` / `codex` / `opencode` 等指令的 shell function,啟動時 POST 狀態為 `in_progress`,指令結束(依 exit code)POST 為 `review` 或 `done`。粗粒度,但保證涵蓋所有 agent,包含未來新出的、不支援 MCP 的工具。
2. **MCP server(主力,支援 MCP 的 agent 適用)**— agent 在對話過程中自己呼叫工具更新任務細節、加筆記、建立新任務。目前 Claude Code、Codex CLI、Gemini CLI 都是 MCP client,設定方式接近。OpenCode 是否支援 MCP 尚未確認,先當作「有就用,沒有就靠 wrapper 兜底」。

---

## 2. 資料模型

沿用目前 artifact 草稿(`agent-board.jsx`)裡已經定好的欄位,搬進 SQLite:

```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  project TEXT,
  agent TEXT,          -- claude | codex | opencode | gemini | aider | other
  priority TEXT,        -- low | med | high
  status TEXT,          -- backlog | in_progress | review | done
  notes TEXT,
  worktree TEXT,        -- 選填:git worktree 路徑
  branch TEXT,          -- 選填:branch 名稱
  created_at INTEGER,
  updated_at INTEGER
);
```

> `worktree` / `branch` 是新增欄位建議,方便 wrapper 自動帶入,也方便你之後點卡片直接 `cd` 過去。定案時再決定要不要加。

---

## 3. REST API(給 Web UI 用,也給 wrapper 用)

| Method | Path | 用途 |
|---|---|---|
| GET | `/api/tasks` | 列出全部任務,可加 query filter(`?project=`、`?agent=`、`?status=`) |
| POST | `/api/tasks` | 建立任務 |
| PATCH | `/api/tasks/:id` | 局部更新(狀態、筆記等) |
| DELETE | `/api/tasks/:id` | 刪除 |
| GET | `/api/projects` | 目前有哪些 project(給 UI 篩選用) |

Wrapper 主要會用到 `PATCH /api/tasks/:id`,或者如果 wrapper 不知道 task id(第一次跑),用 `POST /api/tasks` 自動建一張、狀態設 `in_progress`。

---

## 4. MCP Server 工具設計

以 `@modelcontextprotocol/sdk` 起一個本機 MCP server(stdio 或 http transport 皆可,http 較方便多個 agent 共用同一個 server 實例)。

建議工具:

- `list_tasks(project?, status?)` — 讀取看板現況,讓 agent 知道自己/其他 agent 在做什麼
- `create_task(title, project, agent, priority?)` — 開新任務
- `update_task_status(task_id, status)` — 搬欄位
- `add_task_note(task_id, note)` — 補充筆記(worktree 路徑、blocker、PR 連結等)

> 設計原則:工具數量盡量少、語意清楚,agent 才會穩定觸發正確工具,不要做成一個萬用 `update_task(patch: object)`,agent 對這種模糊 schema 呼叫準確率較差。

各 CLI 設定範例(語法都接近):

```bash
# Claude Code
claude mcp add agent-board --url http://localhost:PORT/mcp

# Codex CLI
codex mcp add agent-board --url http://localhost:PORT/mcp

# Gemini CLI
gemini mcp add agent-board --url http://localhost:PORT/mcp
```

> 實際指令與設定檔格式建置時要對照各家當下最新文件再確認一次,這塊變動快。

---

## 5. Shell Wrapper 設計(保底路徑)

放在 `~/.config/ghostty/` 或 shell rc(`.zshrc`)裡的 function,概念:

```bash
agent_run() {
  local cmd="$1"; shift
  local task_id
  task_id=$(curl -s -X POST localhost:$PORT/api/tasks \
    -d "title=$cmd on $(basename $PWD)" \
    -d "project=$(basename $PWD)" \
    -d "agent=$cmd" \
    -d "status=in_progress" | jq -r .id)

  "$cmd" "$@"
  local exit_code=$?

  curl -s -X PATCH localhost:$PORT/api/tasks/$task_id \
    -d "status=$([ $exit_code -eq 0 ] && echo review || echo backlog)"
}

alias claude='agent_run claude'
alias codex='agent_run codex'
alias opencode='agent_run opencode'
```

這段先當草稿,建置時要處理:引號/參數轉發是否正確、`jq` 依賴、PORT 怎麼帶入(建議固定 port 或寫進 `~/.agent-board/config`)。

---

## 6. 專案結構(npx 套件)

```
agent-board/
├── package.json          # bin: agent-board -> dist/server.js
├── src/
│   ├── server.js          # Express app,掛載 REST + MCP endpoint + 靜態檔
│   ├── db.js               # SQLite 初始化與 query helper
│   ├── mcp/
│   │   └── tools.js        # MCP tool 定義
│   └── routes/
│       └── tasks.js
├── web/                   # 前端,把現有 agent-board.jsx 改寫:
│                           #   - window.storage.get/set 換成 fetch('/api/tasks')
│                           #   - 其餘 UI 邏輯不用動
├── scripts/
│   └── agent-run.sh        # 上面的 wrapper,提供範例讓使用者自己 source
└── README.md
```

`package.json` 關鍵:

```json
{
  "name": "agent-board",
  "bin": { "agent-board": "./src/server.js" },
  "scripts": { "start": "node src/server.js" }
}
```

使用者之後就是 `npx agent-board`,啟動後開 `localhost:PORT`。

---

## 7. 已有素材

- `agent-board.jsx` — 目前 UI 草稿(拖曳看板、4 欄、project/agent/priority 標籤、篩選、Modal 編輯)。搬過去時把 `window.storage` 那段換成打 REST API 即可,UI 結構不用重做。

---

## 8. 待你本地決定的事項

- [ ] Port 固定值(建議一個不常見的 port,例如 4317,避免跟其他本機服務衝突)
- [ ] 儲存要不要真的上 SQLite,還是先用 JSON 檔案(任務量不大的話 JSON 也夠,之後要加更多查詢再換 SQLite)
- [ ] `worktree` / `branch` 欄位要不要現在就加
- [ ] wrapper 要放 shell function 還是做成 Ghostty 自己的 hook(Ghostty 目前沒有 agent 生命週期 hook,只能靠 shell 層)
- [ ] MCP server 用 stdio 還是 http transport(http 較適合你這種「一個 server,多個 agent session 共用」的情境)
- [ ] 是否要發布到 npm 公開,還是只在本機 `npm link` 用

---

## 9. 建議實作順序

1. Express server + SQLite + REST API(先讓看板能跑,手動 CRUD)
2. 把 `agent-board.jsx` 接上 REST API,取代 `window.storage`
3. 包成 npx 套件,本機跑起來驗證
4. 加 shell wrapper,驗證「開始/結束」自動記錄
5. 加 MCP server,先在 Claude Code 上驗證 agent 主動呼叫工具
6. 視情況擴到 Codex CLI / Gemini CLI
