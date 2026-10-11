// Demo Chat client.
// The whole "network protocol" here is: JSON envelopes over one WebSocket.
let ws = null;
let me = null;

const $ = (id) => document.getElementById(id);

$("joinBtn").onclick = () => {
  me = $("username").value.trim();
  if (!me) return;
  connect();
};

function connect() {
  ws = new WebSocket(`ws://${location.host}/ws/${encodeURIComponent(me)}`);

  ws.onopen = () => {
    $("status").textContent = "connected";
    $("status").className = "connected";
    $("login").hidden = true;
    $("chat").hidden = false;
  };

  ws.onclose = () => {
    $("status").textContent = "disconnected";
    $("status").className = "disconnected";
  };

  ws.onmessage = (e) => {
    const env = JSON.parse(e.data); // unwrap the envelope
    if (env.type === "presence") {
      renderUsers(env.users);
      return;
    }
    showPacket("recv", env);        // received hop: SERVER -> me
    renderMessage(env);
  };
}

function renderUsers(users) {
  $("users").innerHTML = users
    .map((u) => `<li>${u === me ? u + " (me)" : u}</li>`).join("");
  const to = $("to");
  const prev = to.value;
  to.innerHTML = `<option value="all">everyone</option>` +
    users.filter((u) => u !== me)
         .map((u) => `<option value="${u}">${u}</option>`).join("");
  to.value = [...to.options].some((o) => o.value === prev) ? prev : "all";
}

$("sendForm").onsubmit = async (e) => {
  e.preventDefault();
  const file = $("image").files[0];
  const text = $("text").value.trim();
  if (!file && !text) return;

  // Build the application-layer envelope.
  const env = { to: $("to").value };
  if (file) {
    env.type = "image";
    env.filename = file.name;
    env.payload = await fileToDataURL(file); // image -> base64 text so it fits in JSON
  } else {
    env.type = "chat";
    env.payload = text;
  }

  ws.send(JSON.stringify(env));   // <-- hop 1 starts here: frame leaves this machine
  showPacket("sent", env);

  $("text").value = "";
  $("image").value = "";
};

function fileToDataURL(file) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsDataURL(file);
  });
}

function renderMessage(env) {
  const div = document.createElement("div");
  div.className = "msg" + (env.from === me ? " mine" : "");
  const time = new Date(env.timestamp * 1000).toLocaleTimeString();
  let body;
  if (env.type === "image") {
    body = `<img src="${env.payload}" alt="${env.filename || "image"}">`;
  } else {
    body = `<div></div>`;
  }
  div.innerHTML = `<div class="meta">${env.from} · ${time}</div>`;
  if (env.type === "image") {
    div.insertAdjacentHTML("beforeend", body);
  } else {
    const p = document.createElement("div");
    p.textContent = env.payload; // textContent, not innerHTML: no HTML injection
    div.appendChild(p);
  }
  $("messages").appendChild(div);
  $("messages").scrollTop = $("messages").scrollHeight;
}

// Packet Inspector: show the raw envelope. Base64 image payloads are truncated
// for readability, with the true byte size shown.
function showPacket(direction, env) {
  const size = new Blob([JSON.stringify(env)]).size;
  const shown = { ...env };
  if (shown.type === "image" && shown.payload.length > 120) {
    shown.payload = shown.payload.slice(0, 120) + `... [${shown.payload.length} base64 chars total]`;
  }
  const div = document.createElement("div");
  div.className = "pkt " + direction;
  div.innerHTML = `<div class="dir">${direction === "sent" ? "→ SENT (you → SERVER)" : "← RECEIVED (SERVER → you)"} · ${size} bytes</div>`;
  const pre = document.createElement("pre");
  pre.textContent = JSON.stringify(shown, null, 2);
  div.appendChild(pre);
  $("packets").prepend(div);
}
