// Network Monitor: connects to /monitor_ws and animates every packet event.
// Layout: CLIENTS (left) -> SERVER (center) -> CLIENTS (right).
// Hop 1 animates left -> center, hop 2 animates center -> right.

const stage = document.getElementById("stage");
const logEl = document.getElementById("monitorLog");
const nodes = new Map(); // name -> {el, x, y}  (x,y are fractions of stage size)

const SERVER_POS = { x: 0.5, y: 0.5 };
let leftCount = 0, rightCount = 0;

function ensureNode(name) {
  if (nodes.has(name)) return nodes.get(name);
  let pos;
  if (name === "SERVER") {
    pos = SERVER_POS;
  } else {
    // clients alternate left/right columns, stacked vertically
    const left = leftCount <= rightCount;
    const i = left ? leftCount++ : rightCount++;
    pos = { x: left ? 0.12 : 0.88, y: 0.15 + i * 0.22 };
  }
  const el = document.createElement("div");
  el.className = "node" + (name === "SERVER" ? " server" : "");
  el.innerHTML = `${name}<small>${name === "SERVER" ? "FastAPI · routes every message" : "chat client"}</small>`;
  stage.appendChild(el);
  const node = { el, ...pos };
  nodes.set(name, node);
  layout();
  return node;
}

function layout() {
  const r = stage.getBoundingClientRect();
  for (const n of nodes.values()) {
    n.el.style.left = n.x * r.width + "px";
    n.el.style.top = n.y * r.height + "px";
  }
}
window.addEventListener("resize", layout);

function flash(name) {
  const n = nodes.get(name);
  if (!n) return;
  n.el.classList.add("flash");
  setTimeout(() => n.el.classList.remove("flash"), 400);
}

// Animate one frame flying from node `from` to node `to`.
function fly(from, to, onArrive) {
  const r = stage.getBoundingClientRect();
  const a = ensureNode(from), b = ensureNode(to);
  const dot = document.createElement("div");
  dot.className = "flying-pkt";
  stage.appendChild(dot);

  const x0 = a.x * r.width, y0 = a.y * r.height;
  const x1 = b.x * r.width, y1 = b.y * r.height;
  const duration = 900; // ms — deliberately slow so you can watch it
  const start = performance.now();

  function step(now) {
    const t = Math.min((now - start) / duration, 1);
    dot.style.left = x0 + (x1 - x0) * t + "px";
    dot.style.top = y0 + (y1 - y0) * t + "px";
    if (t < 1) requestAnimationFrame(step);
    else { dot.remove(); flash(to); onArrive && onArrive(); }
  }
  flash(from);
  requestAnimationFrame(step);
}

function log(cls, text, envelope) {
  const div = document.createElement("div");
  div.className = "line " + cls;
  div.textContent = text;
  if (envelope) {
    const shown = { ...envelope };
    if (shown.type === "image" && shown.payload && shown.payload.length > 100) {
      shown.payload = shown.payload.slice(0, 100) + `... [${shown.payload.length} base64 chars]`;
    }
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(shown);
    div.appendChild(pre);
  }
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}

ensureNode("SERVER");

const ws = new WebSocket(`ws://${location.host}/monitor_ws`);
ws.onopen = () => {
  document.getElementById("status").textContent = "connected";
  document.getElementById("status").className = "connected";
  log("sys", "monitor connected — waiting for traffic...");
};
ws.onclose = () => {
  document.getElementById("status").textContent = "disconnected";
  document.getElementById("status").className = "disconnected";
};

ws.onmessage = (e) => {
  const ev = JSON.parse(e.data);

  if (ev.event === "join") {
    ensureNode(ev.user);
    log("sys", `● ${ev.user} connected (opened a WebSocket to the server). Online: ${ev.online.join(", ")}`);
  } else if (ev.event === "leave") {
    log("sys", `○ ${ev.user} disconnected. Online: ${ev.online.join(", ") || "nobody"}`);
  } else if (ev.event === "packet") {
    const label = ev.hop === 1
      ? `HOP 1  ${ev.src} ──▶ SERVER   (${ev.bytes} bytes)`
      : `HOP 2  SERVER ──▶ ${ev.dst}   (${ev.bytes} bytes)`;
    log("hop" + ev.hop, label, ev.envelope);
    fly(ev.src, ev.dst);
  }
};
