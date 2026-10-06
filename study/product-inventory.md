# Agent Board 產品盤點（PM / TPM / AI 應用視角）

> 2026-10-05 · 北極星：接下來 3 個月以社群採用為目標。

## Context
使用者這幾輪提了一串方向：
- Claude Code mod 自動回報。
- terminal 裡的像素風卡片 widget。
- 跨 agent 協調，與 CC Switch 互補。
- JEV 判斷員。

使用者要的是一份完整的產品盤點：要點、價值與痛點、做過什麼、想做什麼、roadmap、priority。
北極星已確認：**接下來 3 個月以「社群採用」為目標**，也就是 solo dev 裝了、留下來、願意分享。
本文件即為這份盤點。

資料來源：
- `git log`（v0.1 到 v0.3.1）。
- 本機 dev 與 npm 兩個看板的 tickets，用 sqlite read-only 讀取。
- `content-pitch.md`。
- `study/agent-board-capabilities.md`。
- `study/claude-mods-x-agent-board-proposal.md`。

---

## 1. 產品一句話與北極星
- **定位**（取自 content-pitch）：人和 agent 誰先動手都行、交接零摩擦的本機看板；不預設事情一定要 deliver code。
- **北極星**：每週有在用的安裝數。以「一週內有 ≥3 張卡被 agent 寫入」的 workspace 數當代理指標，因為是本機工具、無遙測，只能靠問卷 / issue / 影片留言估。
- **輔助指標**：npm 週下載、GitHub star、「裝完到第一張 agent 寫入的卡」所需步驟數（越少越好）。

## 2. 要點 → 解決的痛點 → 價值
| 要點（使用者提出） | 痛點 | 價值 |
|---|---|---|
| 人機零摩擦交接（核心主張） | Jira 讓 agent 遷就人、agent 自治系統讓人變旁觀者 | 誰先動手都行，中途換手不需重新同步 context |
| CLI / MCP 直接對應 CRUD | Notion / Jira 要 agent 燒 token 理解語意層 | 低 token、低誤操作 |
| 本機 npm、開源、不綁平台 | 平台鎖定、雲端延遲 | 任何能跑指令的 agent 都能加入 |
| Hook / 工作流綁定 | 回報靠 agent 記得照 CLAUDE.md 做，常漏 | 從「請 agent 記得」變成「harness 自動做」 |
| Claude Code mod 自動回報 | 同上，加上每個專案都要貼一段設定 | **裝完就有感**，免設定，直接打中採用摩擦 |
| terminal 像素 widget | 要開瀏覽器、Web 不會即時更新 | 看板就在工作的地方；可截 GIF，自帶傳播力 |
| 跨 agent 協調（CC Switch 互補） | Claude → Codex → Gemini 換手時工作狀態斷層 | CC Switch 管設定 / 工具鏈；Agent Board 管「做到哪、誰接手」 |
| JEV 判斷員 | 小判斷（這 prompt 屬哪張卡？算完成嗎？）叫大模型太貴 | 便宜、快速的自動分類，讓自動化不吵也不貴 |
| AB-5 / AB-6 派工 | 從卡片到「叫某個 agent 去做」要手動複製貼上 | 看板從「記錄」升級成「調度」 |

## 3. 已經做過的（Shipped）
| 版本 | 內容 |
|---|---|
| v0.1 | Express + SQLite REST（唯一真相）、CLI、Web 看板 / 列表、MCP（stateless HTTP） |
| 可靠性 | 放棄 WAL（資料遺失事故後的根因修正）、ticket id 在 transaction 內產生 |
| 協作語意 | status / agent / priority 自動留痕；`notes`（覆寫）vs `note`（附加）；`agent` = 目前負責人 |
| v0.2.0 | 多 workspace（獨立 SQLite 檔）、Unicode 名稱、Web 切換器、`/api/meta` |
| v0.2.1–0.2.4 | project rename / delete、task 完整 CRUD（CLI + MCP 共 9 個工具）、修 notes 不寫入的 bug |
| v0.3.x | dev / npm 自動分 port 與 DB、首次啟動 onboarding seed、CLI 多行參數修正、drawer 可拉寬 |
| 外圍 | npm 發佈（`@limao.li.design/agent-board`）、`templates/CLAUDE.md.example`、PostToolUse hook 實例、`content-pitch.md`、demo 影片剪輯版、`scenario-tests.md` |

## 4. 想做的（Backlog 全盤點）
**A. 信任與基本功**（不做，demo 和第一印象會破）
- A1 **Web UI 即時更新**：目前沒有 polling / SSE，但 pitch 的核心 demo 是「agent 改 status，畫面同步更新」，demo 主張與實作不符。
- A2 AB-7：drawer 開著時點別張卡要點兩次。
- A3 AB-8：drawer 文字溢出時的截斷方向。
- A4 文件漂移：handoff 寫 4 個 MCP 工具（實際 9 個）；`client.js` 預設 4317 與 dev 4316 不一致（只影響 dev）。
- A5 MCP 註冊說明：README 給 `claude mcp add` 一行指令，但不替使用者執行。

**B. 自動化（mod 路線）**
- B1 mod v0：`session.start` 建卡或認領、`turn.complete` 每輪彙總一行 note、`session.end` 推到 review。
- B2 交接帶入：開 session 時把該卡 notes 注入 context。
- B3 撞車保護：`tool.call` 發現別的 agent 持有就開窗詢問。
- B4 subagent 歸屬（`e.agentId`）。

**C. 呈現面（widget 路線）**
- C1 提示列 band：`AB-12 · in_progress`。
- C2 `/board` 像素風卡片 pane，可按鍵移動狀態。
- C3 獨立 TUI（`agent-board tui`）：跨所有 CLI 共用。

**D. 協調 / 派工**
- D1 AB-5：右鍵把卡片送到特定 agent 的 terminal。
- D2 AB-6：Description comment 派工。
- D3 其他 CLI（Codex / Gemini）的自動回報對應（各自的 hook 機制）。

**E. 智慧層**
- E1 JEV 判斷員：prompt 對應卡片、完成判定、撞車第二層過濾、自動摘要 note。

**F. 長期 / 暫不做**
- F1 結構化事件表（取代純文字 history）。
- F2 optimistic locking。
- F3 認證 / 身分。
- F4 多人 / 雲端。
- F5 AB-9：inline 資產 chip。
- F6 AB-10：agent 欄位語意釐清（已有結論：目前負責人，可結案）。

## 5. Priority（以「社群採用」北極星排序）
評分方式：對採用的影響 × 信心 ÷ 成本。

| 優先 | 項目 | 理由 |
|---|---|---|
| **P0** | A1 Web 即時更新 | demo 主張的根基；成本低（輪詢 `GET /tasks` 就夠） |
| **P0** | B1 mod 自動回報 v0 | 直接拿掉「要貼 CLAUDE.md」這個最大採用摩擦；可驗證核心假設 |
| **P0** | A2 / A4 / A5 | 小成本，消除第一印象扣分 |
| **P1** | C1 提示列 + C2 `/board` 像素 pane | 視覺化、可截 GIF，是傳播素材；建在 B1 的 `$.state` 上，邊際成本低 |
| **P1** | B2 交接帶入 | 兌現「換手不卡」主張的另一半（自動讀） |
| **P1** | 影片 / README 更新 | 新功能變成傳播 |
| **P2** | E1 JEV | 等 B1 證明自動回報有用、且出現「太吵 / 對錯卡」的問題再加；否則是解決不存在的問題 |
| **P2** | B3 撞車保護、B4 subagent 歸屬 | 真實但頻率較低 |
| **P2** | D1 / D2 派工 | 價值高但設計未定（AB-5 / AB-6 notes 裡有開放問題） |
| **P3** | C3 TUI、D3 其他 CLI | 「真正跨 agent 協調」：等 Claude Code 側驗證後再複製 |
| **不做（本季）** | F1–F5 | 與 solo dev 採用無關，或會讓產品變重，違背「輕量」主張 |

## 6. Roadmap（Now / Next / Later）
- **Now：v0.4「看得見、免設定」**（約 2–3 週）
  - 內容：A1、A2、A4、A5，加上 B1 mod v0（放在 repo 的 `mods/agent-board/`，透過 plugin marketplace 安裝）。
  - 出場條件：全新使用者裝完 npm 與 mod，在一個 Claude Code session 內，卡片在不寫 CLAUDE.md 的情況下自動出現並更新，Web 不用重整就看得到。
- **Next：v0.5「看板在 terminal 裡」**（約 3–4 週）
  - 內容：C1、C2、B2，並重拍 demo GIF / 影片。
  - 出場條件：不開瀏覽器也能完成「看 → 移動狀態 → 換手接續」整個流程。
- **Later：v0.6+「真正的跨 agent 協調者」**
  - 內容：E1 JEV、B3、D1 / D2、C3 TUI、D3 其他 CLI。
  - 前提：v0.4 的自動回報被證明有人在用，而且出現需要更聰明判斷的訊號。

## 7. 風險與未驗證假設
- mod API 會隨版本變（需 Claude Code ≥ 2.1.287）；mod 只覆蓋 Claude Code。
- CC Switch 的 Sessions 功能是否已處理 context 搬移：只讀過 README 摘錄，**未驗證**。
- JEV 的呼叫方式、延遲、費用：只讀過搜尋摘錄，**未驗證**。
- 自動 note 太吵會讓使用者關掉 mod：B1 要預設「每輪一行彙總」，並提供開關。
- 本機工具沒有遙測，北極星只能靠間接訊號估。


## 8. 決議紀錄

### D1（2026-10-05）加入 stdio MCP 模式
- **決議**：新增 `agent-board mcp` 子指令，以 stdio 提供 MCP。各 AI 工具在設定裡寫 `npx -y @limao.li.design/agent-board mcp` 就能接上。
- **理由**：這是 MCP 生態最常見的接法。Claude 桌面 app 這類偏好 stdio 的 client 不必再多一層轉接，也符合「npx 一行開始」的輕量定義。
- **限制**：stdio 行程必須和現有 MCP 工具一樣，只當 REST client（共用 `src/client.js`），不能自己開 SQLite。否則會破壞「只有 server.js 一個寫入者」的前提。
- **待決**：
  - server 沒在跑時，stdio 模式要直接報錯（維持現行 CLI 不自動啟動 server 的原則），還是自動帶起一個 server？
  - stdio 模式預設要連 4317（npm）還是依 `AGENT_BOARD_URL`？

### D2（2026-10-05）價值主張以 `content-pitch.md` 為準
- 主張只有一個：零摩擦的人機協作心智模型，誰先動手都行、中途換手不卡；不偏袒人或 agent 任一邊。
- 因此撤回「`done` 只能由人按」的提議。
- 「人是路由決策者」沿用 pitch 3.2：自動化（交接帶入、JEV 對卡）只能做到建議，由人確認。

### D3（2026-10-05）主要入口是習慣 code 的人；Mod 是爽感層
- 目標使用者以平常寫 code、願意接 CLI 和 MCP 的人為主。
- Claude Code mod 的定位是「讓開單更爽」的體驗層，不是核心依賴；沒裝 mod，CLI 和 MCP 一樣完整可用，平台中立不破。

### D4（2026-10-05）「npx 一行試用」是既有能力，不是新功能
- `npx @limao.li.design/agent-board` 依現有 code 就會啟動 server 並 seed onboarding（尚未實測）。
- 待辦：在乾淨環境實測一次，確認 `better-sqlite3` 裝得起來；README 改成以 npx 為第一入口。

### D5–D10（2026-10-06）六題全部照建議
- **D5** stdio MCP 遇到 server 沒在跑：自動帶起 server。啟動前先確認 port 有沒有人在聽，有就直接連上；第一次回應時告知使用者 server 是自動開的。
- **D6** stdio MCP 預設連 4317，`AGENT_BOARD_URL` 優先。
- **D7** `node:sqlite`：先做 npx 實測。在乾淨環境裝不起來或很慢，就換掉 `better-sqlite3`；裝得順就延後。
- **D8** 介面：Web 為主（先補即時更新）；mod 只補提示列與簡單 `/board`；獨立 TUI 先不做。
- **D9** 非 code 卡片：先不加欄位，用 Description；觀察兩週再決定要不要做 AB-9 資產 chip。
- **D10** 派工：先做「產生指令」；「直接開 terminal」視需要再加；不做執行追蹤 / orchestrator。

### D11–D13（2026-10-06）實測後的三項決議
- **D11** `agent-board mcp` 是「不自動啟動 server」規則的唯一例外：用 detached spawn 加 port 互斥，並告知使用者 pid 與停止方式；CLI 的 task verbs 維持不自動啟動。實作 D1 時一併寫進 CLAUDE.md。設計見 `stdio-mcp-design.md`。
- **D12** 修正 README / CLAUDE.md 的 `claude mcp add` 語法為 `--transport http`。✅ 已完成（未 commit）。
- **D13** `better-sqlite3` 11 升到 `^12.11.1`（npm 上 12.x 最新；GitHub 的 12.12.0 沒有發佈到 npm），已確認有 Node 24 / 25 的預編譯檔；`engines` 改為 `>=20`，跟 12.x 的支援範圍一致。`node:sqlite` 延後。✅ 已完成並在隔離 port 驗證（未 commit、未發佈）。

### 實作紀錄（2026-10-06）
- **AB-11 stdio MCP 模式**：已合併進 master（bcfc275）。待發佈後驗證真實 client 接上。
- **AB-12 Web 即時更新**：已合併進 master（2d54d72）。已知限制見該單的 note。
- 兩項皆尚未 push、尚未發佈。建議合併 AB-14（README npx）後一起發 0.4.0。

### 發佈紀錄（2026-10-06）
- **0.4.0 已發佈到 npm**（commit b95a647，已 push）。註冊表約 90 秒後生效。
- 以已發佈的 0.4.0 在乾淨環境驗證：冷快取 `npx` 18 秒啟動、3 張範例卡、前端含輪詢、stdio 自動啟動 server 並列出 9 個工具。
- 未驗證：真實 Claude Code / 桌面 app / Codex 接上 stdio；不帶版本號的 `npx` 在乾淨環境（本機有舊版殘留而無法隔離）。
- 尚未打 git tag（建議 `git tag v0.4.0`）。

### 真實 client 驗證（2026-10-06）
- 詳見 `study/real-client-test-report.md`。stdio MCP（0.4.0）：**Claude Code 通過、Codex CLI 通過**（兩次呼叫，只有第一次帶 auto-started 通知）；**Gemini CLI 被擋**（它自己的認證需要 GOOGLE_CLOUD_PROJECT，MCP 子行程有被啟動）；**Claude 桌面 app 未測**（要改持久設定）。
- 報告中的「第一次回覆只有通知」是測試提示要求「逐字回報第一段」造成的，不是缺陷。
- 未驗證：Codex 在空 npm 快取（冷啟動約 20 秒）下是否逾時。Codex 預設啟動逾時 10 秒（官方文件；有 issue 提到較新版為 30 秒，來源不一致）。對策：README 的 Codex 範例加上 `startup_timeout_sec = 60`。

### D14–D15（2026-10-06）mod v0 的行為邊界（AB-13）
- **D14** mod 在 session 結束時**最多把卡推到 `review`，不自己設 `done`**，且只在卡目前是 `in_progress` 時才推。這只是 mod 自己的預設，**不限制** agent 或使用者用 CLI / Web 把卡設成 `done`，所以和 D2 撤回「done 只能由人按」不衝突。理由：session 結束不等於工作完成。
- **D15** session 開始時**找不到唯一對應的卡**，mod 只提示，不自動建卡：提示使用者用 `/board-sync new "標題"` 建立或 `/board-sync link <ID>` 綁定。找到唯一一張（以卡的 `worktree` / `branch` 對 cwd / branch 比對）才自動認領。理由：符合 D2，自動化只做建議，路由決定由人。
- 調查報告：`study/mod-api-research.md`（含 11 項只能靠實測確認的推論）。已知版本落差：本機 CLI 是 2.1.285，文章要求 ≥2.1.287；`claude plugin validate` / `claude plugin test` 在 2.1.285 可用。

### D16 + AB-13 實作紀錄（2026-10-06）
- **D16**（實作者加的保守規則，主 session 追認）：卡片的 `agent` 若是別的 agent（例如 codex），mod **不認領**，只提示，需要時用 `/board-sync link <ID>` 接手。理由：`agent` 代表目前負責人，不該被自動覆蓋；符合 D2。
- AB-13 實作在分支 `worktree-agent-ae9ef79be913b4f79`（`5bfcb2d` 加上 README 修正），**尚未合併**。24 項單元測試通過、`claude plugin validate --strict` 通過；主 session 另外用真實 `claude -p`（2.1.285 + 旗標）在隔離環境做了「以分支名稱認領」的端到端：backlog → in_progress（claude 認領）→ 寫入 note → review。
- 與指示的唯一偏離：`turn.complete` 的 note 寫入改為「await + 1.5 秒逾時」，因為實測 hook 回傳後才發出的 `$` 呼叫送不出去（背景寫入會遺失）。
- 版本需求：2.1.285 的函式 hook 預設關閉，需 `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`；文章稱 2.1.287 起預設開啟。使用者的 CLI 目前是 2.1.285。
- 未驗證：互動 REPL 與桌面 app、resume / `/clear`、熱重載、多行程同時寫入、`/board-sync` 的真實 UI。

### AB-13 已合併（2026-10-06）
- mod v0 合併進 master（a595e24）。合併後以 2.1.288（桌面 app 引擎，預設不設旗標）驗證：`validate --strict` 通過、24 項測試通過；`npm pack --dry-run` 不含 `mods/`，npm 套件不受影響。
- 更正先前說法：使用者平常用的桌面 app 引擎是 2.1.288（≥2.1.287），mod 預設即可生效；只有終端機的 Homebrew `claude`（stable 通道，2.1.285）需要旗標。
- 本機領先 GitHub 4 個 commit（beef83b 文件、AB-13 的 3 個）：尚未 push。

### 互動式試用的第一個發現（2026-10-06）
- 在桌面 app 引擎 2.1.288 的互動式 session 中，mod **確實載入並認領了卡**（除錯日誌：`hooks module agent-board@inline loaded ... events: session.start,turn.complete,session.end,command.run`；板子 SB-1 被改為 in_progress / claude）。
- **但使用者第一次開的 session 沒有認領**：該資料夾是第一次開，Claude Code 先顯示「是否信任這個資料夾」。推測：信任確認前 `session.start` 已過，之後也不會重發。**這只是推測，未驗證**（要用從未信任過的新資料夾、帶 `--debug-file` 實測，但信任畫面需要人按 Enter）。對真實使用的影響：使用者既有的專案都已信任過，只有「第一次在全新資料夾開 session」會漏掉那一次的認領，且可用 `/board-sync on` 補綁。
- **提示（toast）使用者沒看到**：`$.ui.toast` 是一閃即逝的訊息，容易錯過；是否真的顯示未確認。這支持 AB-15 的方向：用常駐的提示列（AbovePrompt）顯示「目前綁定哪張卡」，比 toast 可靠。

### D17（2026-10-06）常駐狀態列 + 提示延長
- 互動式試用回報：提示「短暫閃了一下又不見了」。原因：`$.ui.toast` 預設只停 4 秒。
- **D17** 修法（使用者同意）：(1) toast 停留改為 10 秒（`timeoutMs`）；(2) 認領 / `/board-sync link` / `new` 之後用 `$.ui.status` 把 `Agent Board: <卡片 ID>` 固定在輸入框下方，`/board-sync off` 清除；熱重載重跑 `session.start` 時重新釘上。沒有綁定卡片、或 `enabled=false` 時不釘。
- 這是 AB-13 的小修補，不需要等 AB-15。AB-15 之後只在「想看更多資訊」時才做。
- 驗證：`claude plugin validate --strict` 通過，單元測試 24 → 27 項全過（2.1.288 引擎，不設旗標）。**尚未在互動式畫面確認**，等使用者重測。

### 重測結果（2026-10-06）
- 通過：認領、常駐狀態列、每輪一條 note（`… (edited 1 file)`）、`/board-sync` 用法說明、`/board-sync off`（狀態列隨之消失）。
- **發現並修正**：`/board-sync status` 的 `server:` 印的是 API 根（`http://localhost:4352/api`），使用者打開得到 `Cannot GET /api`。改為顯示 origin。有測試，且還原修正後該測試會失敗（已驗證）。
- 外觀問題（交給設計研究處理）：引擎會在每則外掛輸出前加 `agent-board:`，我們又寫了 `Agent Board`，造成重複；狀態列前有引擎加的橘黃 ▲。
- 未驗證：`/exit` 後卡片是否自動推到 review（互動式）、全新資料夾第一次 session 為何沒認領。

### D18（2026-10-06）session 結束只留紀錄，不改狀態（取代 D14）
- 使用者互動試用回報：關掉 session 後卡片變 review，「沒有做完，硬被放到 review，是要給誰 review？」並選擇方案 B。
- **D18**：session 結束時**只在卡片歷史加一行**（`claude session ended`），**不改 status，也不改 agent**。`/clear` 與 resume 不算結束。D14（最多推到 review）作廢。
- 實作細節：結束那條紀錄**不帶 `agent`**，因為 REST 把 body 的 `agent` 同時當成「設定負責人」與「作者標籤」，帶了會在期間被他人接手時把卡搶回 claude。（每輪 note 仍帶 `agent: claude`，視為「正在這張卡上工作的人」，這是否合理待檢討。）
- 取捨：卡片會一直掛著 agent 名字，別的 agent 看到會跳「被 claude 持有」，需要 `/board-sync link` 接手。
- 29 項測試通過；還原「不帶 agent」的對照會使測試失敗（已驗證）。
- **尚未處理**：session **開始**就自動把卡標成 in_progress，同樣有「只是開來問個問題也被認領」的問題。
