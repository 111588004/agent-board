<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark.svg">
    <img src="docs/logo-light.svg" alt="Agent Board" height="56">
  </picture>
</p>

<p align="center"><a href="README.md">English</a> · <b>繁體中文</b></p>

<p align="center">你和你的 AI coding agent 共用的本機看板。<br>一句話交代下去：agent 開單，另一個 agent 接手，最後回到你手上。</p>

<p align="center"><a href="https://111588004.github.io/agent-board/"><b>官方網站</b></a> · <a href="https://111588004.github.io/agent-board/bench.html">實測</a> · <a href="https://www.npmjs.com/package/@limao.li.design/agent-board">npm</a></p>

Agent Board 追蹤多個 CLI coding agent（Claude Code、Codex CLI、Gemini CLI、Pi Agent 等）在多個專案和 worktree 之間的任務進度。人用網頁看板，agent 用 CLI 或 MCP，大家寫的都是同一批卡。

唯一的資料來源是一個 Express + SQLite 伺服器。CLI、MCP 伺服器和網頁 UI 都只是它 REST API 的 client，正因如此，多個 agent session 同時讀寫看板才是安全的。

**實測，不是形容詞。** 開單只要 2 次工具呼叫，比 Jira 的 MCP 連接器快 4.2 倍；接手一張單比 Linear 快 1.6 倍。同一任務、同一模型（Sonnet 5.5）、各家用自己的 MCP 連接器，取開單每組 15 次（接手 13 次）的中位數，2026 年 10 月測得。每一家最後開出的單都對，差在 agent 寫入前要先查幾次。[方法與每一次的紀錄 →](https://111588004.github.io/agent-board/bench.html)

## 安裝

```bash
npm install -g @limao.li.design/agent-board
```

## 先試試（免安裝）

```bash
npx @limao.li.design/agent-board
```

這會下載套件並在 `http://localhost:4317` 啟動伺服器，看板上已經有一個入門專案。打開這個網址點點看。

第一次執行要先下載套件，而 npm 下載時什麼都不會印，最多給它一分鐘。你可能會看到某個相依套件的 deprecation 警告，不影響使用。之後再執行一兩秒就會啟動。不管哪種方式，資料都存在 `~/.agent-board`，所以之後再安裝也不會遺失任何東西。

`npx` 是拿來試用的。日常使用請安裝（見上方），agent 就能直接呼叫簡短的 `agent-board` 指令，不必每次都打一整行 `npx ...`。

## 使用方式

啟動伺服器（前景執行，在它自己的終端機裡保持開著）：

```bash
agent-board
```

這會在 `http://localhost:4317` 提供 REST API 和網頁 UI。伺服器只監聽 `127.0.0.1`，所以同一個網路上的其他裝置連不到。它沒有登入機制，請維持這樣：設定 `HOST=0.0.0.0` 會把每個看板開放給同網路上的任何人（設定時會印出警告）。第一次執行會建立一個入門用的「Agent Board」專案，附 3 張範例單，讓你在建立自己的專案之前有東西可以點。準備好了就把它移除：先刪掉那三張範例單（`agent-board delete AB-1`、`AB-2`、`AB-3`），因為還有任務的專案不能刪，然後執行 `agent-board project delete "Agent Board"`。

在任何其他終端機、任何專案裡都能用。（以下指令假設 `agent-board` 已全域安裝。如果你只用 `npx` 試過，就還沒有 `agent-board` 這個指令：要嘛安裝它，要嘛在前面加上 `npx @limao.li.design/agent-board`，例如 `npx @limao.li.design/agent-board list`。）

```bash
agent-board list [--project=] [--status=] [--parent=] [--workspace=]
agent-board create --title="..." --project=<name> [--new-project-prefix=<prefix>] [--remember-as=<word>] [--parent=<id>] [--agent=] [--priority=<low|med|high>] [--status=<backlog|in_progress|review|done>] [--due-date=<YYYY-MM-DD>] [--worktree=] [--branch=] [--link=] [--notes="..."] [--workspace=]   # --notes 設定 Description 欄位；有 --parent 時可以省略 --project
agent-board update <id> [--status=<backlog|in_progress|review|done>] [--priority=<low|med|high>] [--agent=] [--title=] [--worktree=] [--branch=] [--link=] [--due-date=<YYYY-MM-DD>] [--parent=<id>|none] [--notes="..."] [--confirm] [--workspace=]   # --notes 會覆寫 Description 欄位；--parent=none 解除 parent；--confirm 清除「unconfirmed」
agent-board move <id> --project=<name> [--detach] [--workspace=]   # 搬到另一個專案：在那裡拿新單號，子任務一起搬，舊單號照樣能用
agent-board delete <id> [--workspace=]
agent-board note <id> "<text>" [--agent=<name>] [--workspace=]

agent-board workspace list                # 用 * 標出目前的 workspace
agent-board workspace create <name>
agent-board workspace use <name>          # 設定上面所有沒帶 --workspace= 的指令的預設值
agent-board workspace rename <old> <new>
agent-board workspace delete <name>

agent-board project list                                   # 也會列出記住的詞：「(also: ops)」
agent-board project create <name> [--prefix=<prefix>] [--workspace=]   # 沒給 --prefix：印出建議並詢問
agent-board project rename <current-name> [--name=] [--prefix=] [--workspace=]
agent-board project delete <name> [--workspace=]           # 專案裡還有任務就拒絕刪除
agent-board project forget <word> [--workspace=]           # 撤銷一個記住的答案（ops -> Operations）；那個詞之後會再問一次
agent-board config ask [on|new|off]                        # 看板什麼時候會問你（預設 on），見下方
agent-board mcp                                            # 透過 stdio 的 MCP，見下方 MCP 一節
```

CLI 是 REST client：它跟上面的伺服器溝通，不直接碰資料庫，而且伺服器必須已經在跑（唯一的例外是下面的 `agent-board mcp`）。

**看板看不懂你的意思時，會問你，而不是用猜的。** 有三種情況：專案名稱符合好幾個專案、這個 workspace 裡還沒有這個專案，或是單沒有標題。建立專案時沒給 `--prefix` 也會問，因為前綴由你決定，不是 agent。CLI 會印出問題和最多 4 個選項，每個選項附上重跑要用的 flag，並以代碼 `2` 結束。MCP 工具會在一個以 `NEEDS USER INPUT` 開頭的結果裡回傳同樣的問題。接著 agent 會用它自己內建的提問工具問你（Claude Code：AskUserQuestion，Codex CLI：request_user_input，Gemini CLI：ask_user，Antigravity CLI：它自己的提問介面；沒有這種工具的 agent，像 Pi，就在對話裡問），再帶著你的答案重新呼叫工具。從選項中選「新專案」會一次建立專案和單（`--new-project-prefix=` / `newProjectPrefix`）。完全沒有符合的情況不會問，例如 `list --project=nope`；你會拿到一個列出現有專案的錯誤。

**你的答案會被記住。** 每個選項都帶著你用的那個詞（`--remember-as=` / `rememberAs`）。當你對「ops」選了 Operations，看板就會記住，之後「ops」會直接對到 Operations。`project list` 會顯示記住的詞，`project forget ops` 可以撤銷一個。完全相符的專案名稱永遠優先於記住的詞。

**要問多少，是一個全域設定**（所有 workspace、所有 agent 共用），由伺服器保存：

| | 符合好幾個專案／沒有標題 | 專案不存在 |
|---|---|---|
| `on`（預設） | 詢問 | 詢問 |
| `new` | 看板自己選，並把單標為 ⚠ unconfirmed | 詢問 |
| `off` | 看板自己選，並把單標為 ⚠ unconfirmed | 錯誤（絕不自動建立） |

看板自己選的時候，會挑單最多的專案（同數時挑最舊的），或用描述的第一行當標題。它會把原因寫進單的 notes，並設定 `unconfirmed` 欄位。網頁看板會在卡上顯示 ⚠ Unconfirmed 標籤，在單的側邊面板裡顯示 Confirm 按鈕；`agent-board update <id> --confirm` 效果相同。如果選錯了，把單搬過去：`agent-board move <id> --project=<正確的專案>`。沒給前綴就建立專案，在 `on`/`new` 下會詢問，在 `off` 下是錯誤：前綴絕不會替你挑。

有三種改法，改的都是同一個設定：

```bash
agent-board config ask off     # CLI（npx：npx @limao.li.design/agent-board config ask off）
```

- MCP：跟你的 agent 說「關掉看板的提問」。它會呼叫 `set_ask_mode` 工具，而 agent 被告知只有在你要求時才能用它。
- Claude Code mod：`/board-sync ask off`。

**子任務（subtask）** 用來把一件工作分給多個 agent：一張 parent 單負責協調，每個 agent 各拿一張子任務（建立時加 `--parent=<id>`；專案會沿用 parent 的）。網頁看板、CLI、MCP 都遵守同一套規則，由看板強制執行：

- 只有兩層。子任務不能再有子任務，已經有子任務的單也不能變成別人的子任務。
- parent 和它的子任務在同一個專案。建立單時指定了另一個專案的 parent，看板會問你到底要哪一個。
- `agent-board update <id> --parent=<id>` 把子任務移到另一個 parent 底下；`--parent=none` 解除。每次移動都會寫進單的 notes。
- parent 會顯示子任務的進度（`list` 會印出 `[2/3 done]`，並把子任務縮排在它底下）。它的狀態不會自己變：最後一個子任務完成時，看板會告訴你（`note: All 3 subtasks of AB-4 are done`），要不要推進 parent 由你決定。
- 有子任務的單不能刪除。錯誤訊息會列出那些子任務，讓你先刪掉或解除它們。

**把單搬到另一個專案**的做法跟 Jira 的 Move 一樣：`agent-board move AB-5 --project=Ops` 會在那裡給它新單號（`AB-5 → OPS-12`），因為單號標示的是它所在的專案。

- 子任務會一起搬，也拿新單號，並且仍然掛在它底下。
- 舊單號到處都照樣能用——`list`、`update`、`note`、`delete`、MCP、`?task=AB-5` 連結——用了舊號的回應都會說 `AB-5 is now OPS-12`。搬兩次的話，所有舊單號都直接指向最新的那個。
- 子任務只有加上 `--detach` 才能單獨搬，它會因此脫離 parent；沒加的話，錯誤訊息會請你改搬 parent。
- 每張被搬的單，notes 都會記下它從哪裡搬來。舊號碼絕不會再發給別張單。

**Workspace** 是完全隔離的看板（各自的專案、各自的任務、各自的 SQLite 檔案），用來區隔不同情境，例如個人專案和客戶的專案。如果你從不碰它，一切都預設在單一個 `"default"` workspace；要用才需要開。

## MCP

11 個工具：`list_tasks`、`create_task`、`update_task`、`move_task`、`delete_task`、`add_task_note`、`list_projects`、`create_project`、`rename_project`、`delete_project`、`set_ask_mode`。

**stdio（推薦）**：`agent-board mcp` 透過 stdin/stdout 講 MCP，所以 client 不需全域安裝就能啟動它：

```bash
npx -y @limao.li.design/agent-board mcp
```

它仍然只是 REST 伺服器的 client（預設 `http://localhost:4317`，或 `AGENT_BOARD_URL`）。如果那裡沒有東西在監聽，而且網址是 localhost，它會在背景啟動伺服器（detached，log 在 `~/.agent-board/server.log`），並在第一個工具結果的最上方說明這件事，附上 pid 和停止方式。這個伺服器在 MCP session 結束後仍會繼續執行，所以網頁 UI、CLI 和其他 agent 都共用它。如果兩個 session 同時搶著啟動，只有一個能拿到 port，另一個會連到贏的那個。

Claude Code：

```bash
claude mcp add agent-board -s user -- npx -y @limao.li.design/agent-board mcp
```

Claude 桌面版 app（`~/Library/Application Support/Claude/claude_desktop_config.json`）：

```json
{ "mcpServers": { "agent-board": { "command": "npx", "args": ["-y", "@limao.li.design/agent-board", "mcp"] } } }
```

Codex（`~/.codex/config.toml`）：

```toml
[mcp_servers.agent-board]
command = "npx"
args = ["-y", "@limao.li.design/agent-board", "mcp"]
startup_timeout_sec = 60   # 第一次執行要下載套件（約 20 秒）；Codex 的預設值比這短
```

已用真實 client 驗證（2026-10-06，0.4.0）：Claude Code 和 Codex CLI 都能透過 stdio 列出並呼叫工具，而且只有第一次呼叫會帶著「auto-started」通知。尚未驗證：Claude 桌面版 app（從 GUI 啟動時，PATH 上可能找不到用 nvm 安裝的 `npx`，遇到的話請用絕對路徑）；Gemini CLI（無法測試，卡在它自己的登入／專案設定）；以及 npm 快取為空時的 Codex 冷啟動，這也是上面把 timeout 調高的原因。

**HTTP**：執行中的伺服器也在 `POST http://localhost:4317/mcp` 提供 MCP（無狀態的 `StreamableHTTPServerTransport`），給偏好用網址的 client。這個方式絕不會自動啟動任何東西：

```bash
claude mcp add --transport http agent-board http://localhost:4317/mcp
```

## 在其他專案追蹤工作

在那個專案自己的 `CLAUDE.md`（或同類的 agent 指示檔）加一小段，告訴 agent 呼叫 `agent-board` CLI 回報狀態。可用的範本在 [`templates/CLAUDE.md.example`](templates/CLAUDE.md.example)：把它的「Task board」段落複製進去，換成那個專案的看板名稱，並在替它開任務之前先建立對應的專案（`agent-board project create "<name>" --prefix=<PREFIX>`）。

範本教 agent 用一次呼叫開單的規則：

1. `project` 照使用者講的原樣傳入（名稱或前綴，大小寫不拘，前後空白會去掉）。agent 不會自己去專案清單查、再換成符合的那個：在一次真實 agent 測試中，Codex 把模稜兩可的「ops」換成了精確名稱「OPS」，跳過了提問。如果它符合好幾個專案或一個都不符合，看板會回傳一個給使用者的問題（見上方「會問你，而不是用猜的」）。agent 會問你，絕不自己選選項或自己編前綴。
2. 知道是哪個專案？直接開單，不必先 `list`。
3. `status`：`backlog` `in_progress` `review` `done`；`priority`：`low` `med` `high`。像 `doing`/`wip`/`進行中`/`urgent`/`高` 這類別名也接受，並存成標準值；其他值會回 400，並列出允許的值。
4. 描述放在 `notes`；`agent` 設成你自己的 id。
5. 工作分給多個 agent 時：一張 parent 單，每個 agent 一張子任務（見上方「子任務」）。所有子任務都完成時，agent 會告訴你，而不是自己去推進 parent。
6. MCP client 會自動透過伺服器的 `instructions` 拿到這些規則。

## 資料

每個 workspace 的資料庫在 `~/.agent-board/workspaces/<name>/tasks.db`，不是相對於專案的 cwd，所以不管從哪裡執行 `agent-board`，同一台機器上的每個專案／worktree 都共用同一個看板。

單號永遠不會重複使用。刪掉 `AB-7` 不會讓 `7` 空出來：下一張是 `AB-8`，所以還拿著 `AB-7` 的 agent 會查到「找不到」，而不是別人的單。換前綴時也一樣：從 `AB` 改成 `XY` 的專案會從 `XY-8` 接著編，之後拿到 `AB` 這個前綴的專案也會從 `AB-7` 之後開始。

## 開發

```bash
git clone https://github.com/111588004/agent-board.git
cd agent-board
npm install
cd web && npm install && npm run build && cd ..   # 把網頁 UI 建置到 web/dist，由伺服器提供

npm start          # 在 :4316 執行「這份」checkout：node src/server.js
```

**不要對這個 repo 執行 `npm link`。** 全域的 `agent-board` 指令應該永遠是發布到 npm 的套件：你機器上其他每個專案，以及在裡面工作的每個 agent，都依賴這一點是可預期的。`npm link` 和正式安裝會搶同一個全域 bin（最後執行的那個會悄悄勝出），正是這種模糊讓「這到底是指向我的開發改動還是正式版」變得無法有把握地回答。請改成明確執行這份 checkout（`npm start`，或在 repo 裡執行 `node src/server.js` / `node src/cli.js ...`），它永遠不會動到全域指令。

**開發版預設 `:4316`，npm 安裝的 `agent-board` 預設 `:4317`**：刻意用不同的 port，讓兩者可以同時跑，你能直接比較，不必停掉一個才能測另一個。需要第三個的話，用 `PORT=<port> npm start` 覆寫。

**讓 agent 指向你的開發 checkout 而不是發布版**（例如在發布前測試改動）：在一個終端機用 `npm start` 啟動這份 checkout（`:4316`）。然後在目標專案的 `CLAUDE.md`/`AGENTS.md` 裡，在每個 `agent-board` 指令前加上 `AGENT_BOARD_URL=http://localhost:4316`，讓 agent 的呼叫打到你的開發伺服器而不是正式的那個，例如 `AGENT_BOARD_URL=http://localhost:4316 agent-board list --project=...`。用完記得改回來，不然 agent 會一直指向一個沒在跑的伺服器。

如果你不確定某個執行中的伺服器到底是哪一個，`curl localhost:<port>/api/meta` 會回報 `{version, source: "dev"|"npm", root, pid}`，啟動時也會印出來。

架構細節請見 `CLAUDE.md`。

## 授權

MIT
