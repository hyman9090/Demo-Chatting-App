# AGENTS.md — Demo Chat App

> 俾 AI coding agent 睇嘅项目指南。项目本身係教學用嘅極簡聊天 app,
> 用嚟示範 WhatsApp / Line / WeChat 背後嘅 client-server 訊息轉發原理。
> 詳細教學說明(廣東話)喺 `README.md`,呢度只講開發者需要嘅實務資料。

## 1. Project 結構

```
├── server.py                  # FastAPI app:WebSocket 路由、訊息轉發、monitor 通知(核心,約 120 行)
├── static/
│   ├── index.html             # 聊天介面(http://localhost:8000/)
│   ├── app.js                 # 聊天 client:砌 JSON envelope、WebSocket 收發、Packet Inspector
│   ├── monitor.html           # Network Monitor 頁(http://localhost:8000/monitor)
│   ├── monitor.js             # Monitor:接 /monitor_ws,動畫顯示每個 hop
│   └── style.css              # 兩頁共用嘅樣式
├── src/demo_chatting_app/
│   └── __init__.py            # uv 預設 scaffold,只得一個 hello-world main(),同 app 無關
├── pyproject.toml             # 依賴同 build 設定(uv_build backend)
├── requirements.txt           # pip 用嘅平裝依賴清單(同 pyproject.toml 對應)
├── uv.lock                    # uv 鎖定版本
├── .python-version            # 3.14
└── README.md                  # 完整教學文件(廣東話):原理、步驟對照表、學習順序
```

冇 `tests/`、冇 CI 設定、冇 linter 設定。

## 2. 架構同通訊協議

- **Client-server 架構**:client 之間冇直接連線,所有訊息經 server 轉發。
- 每個 chat client 開一條 WebSocket 去 `/ws/{username}`;server 用 `clients: dict[str, WebSocket]` 記住邊個 online。
- 訊息係 JSON envelope:client 填 `type`(`chat` 或 `image`)、`to`(`all` 或某個 username)、`payload`;
  server 收到後 stamp 上 `id`(uuid4)、`from`(由連線決定,唔信 client 自報)、`timestamp`。
- `to == "all"` 就 broadcast 俾 sender 以外所有人;否則單播。圖片用 base64 data URL 放入 `payload`。
- 每個 hop(sender→SERVER、SERVER→receiver)server 會經 `/monitor_ws` 通知所有 monitor 頁。
- Presence:join/leave 時 broadcast `{"type":"presence","users":[...]}`。
- HTTP 只用嚟 serve 頁面(`GET /`、`GET /monitor`、`/static/*`);訊息全部行 WebSocket。

## 3. Setup 同啟動

需要 Python 3.14(見 `.python-version`,`pyproject.toml` 寫 `requires-python = ">=3.14"`)。

依賴(`pyproject.toml` / `requirements.txt`):`fastapi`、`uvicorn[standard]`、`websockets`。

用 [uv](https://docs.astral.sh/uv/)(推薦):

```bash
uv sync
uv run uvicorn server:app --port 8000
```

或者傳統 pip:

```bash
pip install -r requirements.txt
python -m uvicorn server:app --port 8000
```

以上命令已驗證:`uv sync` 成功;server 啟動後 `GET /`、`GET /monitor`、`GET /static/app.js` 全部回 200。

想俾同一 Wi-Fi 嘅裝置連入,加 `--host 0.0.0.0`,其他裝置用你部機嘅 LAN IP 連。

手動驗證流程:
1. 開 `http://localhost:8000/monitor` 放埋一邊。
2. 開兩個 tab 去 `http://localhost:8000`,入兩個唔同名(例如 `alice`、`bob`)。
3. 一邊 send 訊息,Monitor 應該見到 hop 1(client→SERVER)同 hop 2(SERVER→client)動畫。

## 4. 跑測試

**呢個 project 冇測試。** 冇 `tests/` 目錄、冇 pytest 設定。驗證靠手動(見上面第 3 節流程)。

如需加測試,常規做法係 `uv add --dev pytest`,用 FastAPI 嘅 `TestClient` 測 WebSocket 路由。

## 5. 跑單一測試

唔適用 — 冇測試可以跑。

## 6. Code style 同 lint

**冇配置任何 linter / formatter**(冇 ruff、black、eslint、prettier 設定)。如需引入,Python 常規係 ruff。

現有 code 嘅慣例,改 code 時跟住做:

- Python(`server.py`):標準 PEP 8;模組開頭有大段 docstring 解釋架構;關鍵行有行尾 comment
  標示網絡概念(例如 `# <-- one WebSocket frame arrives`)。註解用英文。
- JavaScript(`static/*.js`):vanilla JS,冇 framework、冇 build step;2-space indent;
  聊天訊息用 `textContent` 渲染(防 HTML injection,見 `app.js` 嘅 `renderMessage`)。
- **教學註解係呢個 project 嘅一部分**:comments 解釋網絡概念俾學習者睇,改動邏輯時要同步更新註解。
- 文件語言:`README.md` 用廣東話(繁體中文);code comments 用英文。新文件跟返呢個分工。

## 7. 安全注意事項

呢個係教學 demo,刻意冇做真實 IM 嘅安全措施。改 code 時要守住嘅原則:

- **sender 身份必須由 server stamp** — `from` 由連線決定,唔信 client 自報(見 `server.py` 嘅
  `/ws/{username}` handler)。改動時唔好破壞呢點,呢個係項目要示範嘅安全概念。
- **渲染用戶內容用 `textContent`** — `renderMessage` 入面 `env.payload` 行 `textContent` 防 injection。
  已知例外:`renderUsers` 用 `innerHTML` 砌 username,惡意 username 可以 inject HTML — 屬於 demo 嘅已知限制。
- **冇加密、冇 auth、冇 payload 上限** — `ws://` 明文、打個名就入到、巨大 frame 可以 DoS。
  呢啲限制係 README 第 5 節嘅教學內容;改咗行為就要改 README。
- 冇 `.env` 或 secrets;如果日後加,記住唔好 commit。

## 8. PR 之前要過嘅檢查

冇 CI。最低限度要做:

1. `uv sync` 確認依賴解決到。
2. 啟動 server(`uv run uvicorn server:app --port 8000`),確認 `GET /` 同 `GET /monitor` 回 200。
3. 手動行一次第 3 節嘅兩-client 互傳流程,Monitor 見到兩個 hop。

## 9. Commit 同 PR 慣例

Git history 暫時係空(repo 喺 `master` branch,未有任何 commit),冇既定慣例可跟。用簡短、描述性嘅
英文 commit message 即可(例如 `Add delivery ack to chat server`)。冇 branch 命名規則、冇 PR template。

## 10. Don'ts

- **唔好 commit `.venv/` 同 `__pycache__/`** — 已喺 `.gitignore`,唔好繞過。
- **唔好將 `src/demo_chatting_app/__init__.py` 當成 app 入口** — 佢係 uv scaffold 嘅 hello-world
  (`pyproject.toml` 入面 `[project.scripts]` 指住佢嘅 `main()`),真正嘅 app 係 root 嘅 `server.py`。
- **唔好加 build step / framework 俾 frontend** — `static/` 係刻意 vanilla 嘅教學 code,
  引入 bundler 會破壞項目嘅教學目的。
- **唔好喺 client 信 `env["from"]`** — sender 身份必須由 server 根據連線 stamp(見 `server.py`),
  呢個係項目要示範嘅安全概念。
- **唔好加 auth、加密、資料庫等「真實 IM」功能時唔記得更新 README** — README 第 5 節列明嘅限制
  係教學內容一部分;改咗行為就要改文件。
- 冇 `.env` 或 secrets;如果日後加,記住唔好 commit。
