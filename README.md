# Demo Chat App — 學習網絡資料傳輸原理

一個極簡聊天 app，用嚟學習 WhatsApp / Line / WeChat 背後嘅核心原理：
**client 同 client 之間唔會直接通訊，所有訊息都經 server 轉發。**

重點唔係功能多，係你可以**親眼見到**每個訊息包裹點樣喺網絡行：

```
alice ──(WebSocket frame)──▶  SERVER  ──(WebSocket frame)──▶ bob
         hop 1: upload                hop 2: push 落 receiver
```

---

## 1. 點用

### 安裝（第一次先做）

用 [uv](https://docs.astral.sh/uv/)（推薦）：

```bash
uv sync
```

或者傳統 pip：

```bash
pip install -r requirements.txt
```

### 開 server

```bash
uv run uvicorn server:app --port 8000
```

或者傳統跑法：

```bash
python -m uvicorn server:app --port 8000
```

### 玩

1. 開 **http://localhost:8000/monitor** — 呢個係 Network Monitor，放埋一邊
2. 開 **http://localhost:8000** 兩次（兩個 tab 或者兩個 browser），入兩個唔同名，例如 `alice` 同 `bob`
3. 喺 alice 嗰邊 type 訊息 send，或者揀幅圖 send
4. 望 Monitor：黃色波由 `alice` 飛去 `SERVER`，再由 `SERVER` 飛去 `bob`
5. 望 chat 頁右邊嘅 **Packet Inspector**：你 send 出 / 收到嘅 raw JSON envelope 原貌

想同一 Wi-Fi 嘅其他裝置一齊玩，開 server 時加 `--host 0.0.0.0`，然後其他裝置用你部機嘅 LAN IP（例如 `http://192.168.x.x:8000`）連入。

### uv 常用命令

| 動作 | 命令 |
|---|---|
| 加依賴 | `uv add <pkg>` |
| 刪依賴 | `uv remove <pkg>` |
| 加 dev 依賴（如 pytest） | `uv add --dev <pkg>` |
| 同步環境（clone 之後跑） | `uv sync` |
| 更新所有依賴 | `uv lock --upgrade` |
| 跑任何 script | `uv run <command>` |

依賴寫喺 `pyproject.toml`，鎖定版本喺 `uv.lock`。

---

## 2. 架構

主流 **client-server** 架構（WhatsApp、Line、WeChat 都係呢個 pattern）：

| 部分 | 檔案 | 職責 |
|---|---|---|
| Server | `server.py` | 記住邊個 online（connection registry）、收訊息、路由轉發 |
| Chat client | `static/index.html` + `static/app.js` | 你嘅聊天介面，一條 WebSocket 連去 server |
| Network Monitor | `static/monitor.html` + `static/monitor.js` | 唯讀觀察者，server 每轉一個包裹就通知佢 |

重點：**client 之間冇直接連線。** bob 收到嘅每個 byte 都係 server 送出去嘅。
咁樣做嘅原因：client 喺 NAT / 防火牆後面，互相搵唔到對方；但大家都可以主動連去一個 public server。
所以全世界嘅 IM 都係「人人連 server,server 做中間人」。

---

## 3. 通訊原理逐個步驟對照

所有通訊 —— 打電話、寄信、WhatsApp、呢個 app —— 都係同一個基本模型：

```
sender → 編碼 → 建立通道 → 寫上地址 → 傳輸（經中間人）→ 接收 → 解碼 → 確認
```

alice send 一句 "hello" 俾 bob，每一個步驟對應 project 入面邊一度，逐個睇：

| # | 通訊步驟 | 寄信比喻 | 呢個 project 發生緊乜 | Code 位置 |
|---|---|---|---|---|
| 1 | Sender 有訊息想傳 | 你諗到封信嘅內容 | alice 喺輸入框打 "hello"，撳 Send | `static/index.html` 嘅 `#text` 輸入框 |
| 2 | 編碼：內容變成可以傳嘅格式 | 諗法寫做文字落信紙 | JS 砌一個 JSON envelope，再 `JSON.stringify` 變成字串（圖片就 base64 變文字） | `static/app.js` 嘅 `sendForm` handler |
| 3 | 建立通道 | 打電話前要先接通 | WebSocket 握手，連線 keep住唔斷（詳見第 4.2 節） | `app.js` `new WebSocket(...)`；`server.py` `await ws.accept()` |
| 4 | 寫上地址：寄俾邊個 | 信封面嘅收件人 | envelope 嘅 `to` 欄位；server 收到後 stamp 埋 `from` / `id` / `timestamp` | `app.js` 砌 `env.to`；`server.py` 嘅 stamp 嗰三行 |
| 5 | 傳輸，經中間人轉手 | 郵局收信 → 分揀 → 派送 | **hop 1**: alice → SERVER；server 睇 `to` 做 routing；**hop 2**: SERVER → bob | `server.py` 嘅 `/ws/{username}` handler |
| 6 | 接收 + 解碼 | 收件人拆信讀內容 | bob 嘅 browser 收到 frame，`JSON.parse` 還原 envelope，顯示上畫面 | `app.js` 嘅 `ws.onmessage` → `renderMessage` |
| 7 | 確認收到（ack） | 「收到，唔該！」 | **呢個 demo 冇做**。現實 IM 嘅「單剔/雙剔」就係 ack | 見第 5 節限制表 |

### 要記住嘅四個觀念

- **步驟 2 同 6 係對稱嘅**：一邊 encode，另一邊 decode。兩邊必須用同一種「語言」（呢度係 JSON envelope 格式）—— 呢種事先約定好嘅格式就係**協議（protocol)**。協議唔夾，就 decode 唔到。
- **步驟 4 嘅地址係分層嘅**：application 層用 `to: "bob"` 話俾 server 知送俾邊個；到底層，TCP/IP 用 IP address 話俾 router 知。每層淨係關心自己嗰層嘅地址（詳見第 4.1 節）。
- **步驟 5 嘅中間人係必須嘅**：client 互相搵唔到對方（NAT/防火牆，見第 2 節），所以全世界 IM 都係中間人架構。
- **每一步都可能出錯**，所以先有步驟 7：冇 ack 就唔知對方收唔收到。呢個 demo 簡化咗 —— 你 send 完見到 bob 個 tab 彈出嚟，其實你就係人肉 ack。

### 乜嘢係 hop?

hop = 一段路。包裹由 A 去 B，中間每經過一個「站」，就係一個 hop。

喺呢個 app 入面：

```
alice ──hop 1──▶ SERVER ──hop 2──▶ bob
```

- hop 1: 你部機 → server(upload)
- hop 2: server → bob(push)

一個 message 行兩個 hop，因為中間有 server 呢個中間人。Monitor 頁啲黃色波，每飛一段就係一 hop。

大網絡入面係一樣嘅：你上網 send 個包裹去 Google，佢會經你 router → ISP → 幾個中間 router → Google server。**每過一個 router = 一個 hop**。可以親眼睇：

```bash
tracert google.com
```

會列出十幾個 hop，每行一個 router。記法：hop 即係「跳」—— 包裹唔係一跳到位，係一跳一跳咁跳去目的地。

### Visualization 喺邊度睇到？

同一個包裹，有三個地方可以睇，由淺入深：

1. **Network Monitor 頁** — http://localhost:8000/monitor
   黃色波動畫 = 每個 hop 飛緊；下面 log = 每個 hop 嘅 `src → dst`、byte 數、raw envelope。
   呢個係**鳥瞰圖**：成個系統入面邊個 send 俾邊個。
2. **Chat 頁右邊嘅 Packet Inspector**
   你 send 出（黃色「→ SENT」）同收到（綠色「← RECEIVED」）嘅 envelope 原貌，附 byte 數。
   呢個係**第一人稱視角**：淨係你部機嘅進出包裹。
3. **Browser DevTools（最貼近真實）** — 撳 F12 → Network tab → 揀 `ws` 嗰條連線 → Messages tab
   睇到電線上真係流過嘅每一個 WebSocket frame（send 同 receive 會分開標示），仲見到開頭嘅 `101 Switching Protocols` 握手。

⚠️ 要分清楚：Monitor 同 Inspector 係 **app 自己「話俾你知」**嘅（server 額外報告嘅）;
DevTools 先係你**直接偷睇電線入面**嘅嘢。學網絡要分清楚呢兩者 —— 現實入面你睇唔到別人 app 嘅內部報告，只可以用 DevTools / Wireshark 呢類工具喺「電線」層面觀察。

---

## 4. 訊息傳輸原理

### 4.1 層次（ layering )

你一個 "hello" 其實著咗幾層衫先出門：

```
Application layer : {"type":"chat","from":"alice","to":"all","payload":"hello"}   ← 你睇到嘅 JSON envelope
Transport layer   : WebSocket frame → 拆入 TCP segment（TCP 保證順序、甩咗會重傳）
Network layer     : IP packet（負責搵路去對方部機）
Link layer        : Ethernet / Wi-Fi frame（你部機 → router 嗰一截）
```

呢個 app 俾你睇到嘅係最頂嗰層（application envelope）。下面幾層係 OS 同網絡設備搞掂，
想睇可以用 Wireshark 捉包對照。

### 4.2 乜嘢係 WebSocket?

**WebSocket 係一個網絡協議（protocol)**，同 HTTP 平起平坐，用途係：
一條 keep住唔斷、**雙向**嘅連線，雙方任何時候都可以主動 send 嘢俾對方。

#### 點解需要佢？—— HTTP 嘅先天限制

傳統 HTTP 係「問一句答一句」(request-response):

```
client: GET /messages        →  server: 「冇新訊息」
client: GET /messages        →  server: 「冇新訊息」
client: GET /messages        →  server: 「有！bob send 咗嘢」
```

問題：
- **Server 唔可以主動搵 client**。冇 request 就冇 response。
- 想「即時」收訊息，client 只可以不斷問（polling)——浪費、又有延遲。

WebSocket 解決咗呢個問題。佢嘅生命週期：

```
1. Handshake（握手）   — client 先用一個普通 HTTP request 開頭，帶個特殊 header:
                          GET /ws/alice HTTP/1.1
                          Upgrade: websocket          ← 「我想轉用 WebSocket」
                          Connection: Upgrade
                        server 同意就回:
                          HTTP/1.1 101 Switching Protocols
2. 連線 keep住唔斷      — 由呢刻開始，呢條 TCP 連線唔再係 HTTP，
                          變咗做 WebSocket，雙方對等
3. 互傳 frame          — 任何一方隨時 send（呢個 app 入面，frame 入面就係 JSON envelope)
4. 任何一方 close      — 連線先斷
```

你喺 `server.py` 見到嘅 `"WebSocket /ws/alice" [accepted]` log，就係步驟 1 握手成功嘅一刻。

#### HTTP vs WebSocket 對照

| | HTTP | WebSocket |
|---|---|---|
| 模式 | request → response，問完即散 | 長連線，keep住 |
| 邊個可以主動 send | 只有 client | 雙方都得（full-duplex) |
| 適合 | 攞網頁、API call | IM、即時报价、online game、協作編輯 |
| 地址寫法 | `http://` | `ws://`（加密版 `wss://`，等於 HTTP 嘅 `https://`) |

#### 重點概念

- **WebSocket 唔係取代 HTTP**，係補充。呢個 app 兩樣都用：開網頁（`GET /`）用 HTTP，傳訊息用 WebSocket。
- WebSocket frame 下面仍然係 TCP —— 所以順序保證、甩包重傳都係 TCP 搞掂，application 唔使煩。
- 「點解 WhatsApp 訊息即時彈出，唔使 manual refresh」嘅答案就係呢度：server 一收到 alice 嘅訊息，即刻沿住 bob 嗰條 keep住嘅 WebSocket push 落去。
- 想親眼睇握手：開 browser DevTools → Network tab → 揀 `ws` 嗰條連線 → 睇到 `101 Switching Protocols` 同之後每一個 frame 嘅內容。

### 4.3 Envelope（訊息包裹）

每個訊息係一個 JSON envelope:

```json
{
  "type": "chat",
  "to": "all",
  "payload": "hello",
  "id": "8d2f3019-5183-4296-af37-df9f97e68414",
  "from": "alice",
  "timestamp": 1791568203.519
}
```

- `payload` — 真正內容（文字，或者 base64 圖片）
- `from` / `timestamp` / `id` — **由 server 加上去**，唔係 client 填。
  重點：server 唔信 client 自己報嘅名，`from` 係由「你連入嗰條 connection」決定。
  呢個係最基本嘅身份驗證概念。
- `to` — routing 欄位，server 睇佢決定轉發去邊（`all` = broadcast，否則單播）

### 4.4 Server 嘅角色：routing

`server.py` 入面個 `/ws/{username}` handler 做嘅嘢：

1. 收一個 WebSocket frame（hop 1 完成）
2. 拆開 JSON envelope
3. Stamp 上 id / timestamp / from
4. 睇 `to` 欄位，搵出目標 client 嘅 connection
5. 沿嗰條 connection 送出去（hop 2 完成）

同時每個 hop 都會通知所有 monitor 頁，所以你先睇到動畫。

### 4.5 圖片點傳

圖片係 binary,JSON 係文字，所以 client 用 **base64** 將圖片 encode 成文字放入 `payload`。

留意 trade-off:
- base64 會令 data 大 **~33%**(3 bytes → 4 chars)
- send 幅大圖，睇 Packet Inspector 嘅 byte 數就感受到
- 現實 app 會壓縮圖片、分段傳、或者用 binary frame 直接傳——呢個 demo 為咗簡單全部放入 JSON

### 4.6 Presence（邊個 online )

Server 維護一個 `clients` dictionary(username → connection)。
有人 join / leave 就 broadcast `{"type":"presence","users":[...]}` 俾所有人。
你都係透過 Monitor 見到 join/leave event。

---

## 5. 要留意嘅地方（呢個 demo 嘅限制）

呢啲係「學習版」同真實 IM 嘅差距，逐個諗下點解現實要咁做，係最好嘅學習：

| 限制 | 現實 app 點做 |
|---|---|
| 用 `ws://` 明文，冇加密 | 用 `wss://`(WebSocket over TLS)，仲有 end-to-end encryption(Signal protocol)— 連 server 都睇唔到內容 |
| 冇帳號密碼，打個名就入到 | 真正 authentication（密碼、token、session) |
| Server 死咗 / 斷線就冇咗，client 唔會自動 reconnect | Reconnect + 補收離線訊息 |
| 訊息唔會儲存，refresh 就冇 | Server 寫落 database，先儲後送（store-and-forward) |
| 冇送達確認（ack)/ 已讀 | 每個訊息 receiver 收到後回 ack,server 未收到 ack 會重試 — 個 `id` 欄位就係為咗呢啲 |
| 所有嘢行一個 process、記憶體 | 多機部署要 message queue(Kafka / RabbitMQ）跨 server 轉發 |
| 圖片 base64 入 JSON，大圖會慢 | Binary 傳輸、壓縮、分段、CDN |
| 冇限 payload 大細 | 現實要限，否則一條巨大 frame 可以做 DoS |

---

## 6. 建議學習順序

1. 玩住先：兩個 tab 互傳，對照 Monitor 動畫同 Packet Inspector 嘅 JSON
2. 對住第 3 節嘅七個步驟表，逐個 step 搵出佢喺 code 入面嘅位置
3. 讀 `server.py` 嘅 `/ws/{username}` — 全部核心邏輯得幾十行
4. 讀 `static/app.js` 嘅 `ws.send()` 前後 — envelope 點樣砌出嚟
5. 實驗：send 俾特定人（`to: bob`)，Monitor 見到 hop 2 只飛去 bob
6. 實驗：send 一幅大圖，比較文字同圖片嘅 byte 數
7. 想再深入：用 Wireshark 捉 `localhost` 嘅 TCP/WebSocket 流量，對照第 4.1 節嘅 layering

可以試住加嘅功能（每個都對應一個真實 IM 概念）：送達 ack、自動 reconnect、訊息歷史（儲落 file / SQLite)。
