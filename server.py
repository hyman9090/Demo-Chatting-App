"""
Chat server — mainstream client-server architecture (same idea as WhatsApp/Line):
every client holds ONE persistent WebSocket connection to the server.
Clients NEVER talk to each other directly; the server routes every message.

Flow of one message:
    sender client  --(hop 1: WebSocket frame over TCP)-->  server
    server         --(hop 2: WebSocket frame over TCP)-->  receiver client

Every hop is reported to the Network Monitor page as a "packet event",
so you can watch the envelope travel.
"""

import json
import time
import uuid

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI()

# username -> WebSocket   (the server's "connection registry")
clients: dict[str, WebSocket] = {}
# Network Monitor pages watching traffic
monitors: list[WebSocket] = []


async def notify_monitors(event: dict):
    """Send one packet event to every open monitor page."""
    dead = []
    for m in monitors:
        try:
            await m.send_text(json.dumps(event))
        except Exception:
            dead.append(m)
    for m in dead:
        monitors.remove(m)


async def broadcast_presence():
    """Tell every chat client who is currently online."""
    msg = json.dumps({"type": "presence", "users": sorted(clients.keys())})
    for ws in clients.values():
        try:
            await ws.send_text(msg)
        except Exception:
            pass


@app.websocket("/ws/{username}")
async def chat_socket(ws: WebSocket, username: str):
    await ws.accept()
    clients[username] = ws
    await broadcast_presence()
    await notify_monitors({"event": "join", "user": username, "online": sorted(clients.keys())})

    try:
        while True:
            raw = await ws.receive_text()          # <-- one WebSocket frame arrives
            size_bytes = len(raw.encode("utf-8"))  # real size of the frame payload

            # ---- server-side envelope handling ----
            env = json.loads(raw)                  # unwrap the application-layer envelope
            env["id"] = str(uuid.uuid4())          # server stamps a message id
            env["from"] = username                 # sender identity comes from the connection
            env["timestamp"] = time.time()

            # report hop 1: sender -> SERVER
            await notify_monitors({
                "event": "packet", "hop": 1,
                "src": username, "dst": "SERVER",
                "bytes": size_bytes, "envelope": env,
            })

            # ---- routing: decide who gets the message ----
            to = env.get("to", "all")
            if to == "all":
                targets = [u for u in clients if u != username]
            else:
                targets = [to] if to in clients else []

            for t in targets:
                await clients[t].send_text(json.dumps(env))
                # report hop 2: SERVER -> receiver
                await notify_monitors({
                    "event": "packet", "hop": 2,
                    "src": "SERVER", "dst": t,
                    "bytes": size_bytes, "envelope": env,
                })
    except WebSocketDisconnect:
        clients.pop(username, None)
        await broadcast_presence()
        await notify_monitors({"event": "leave", "user": username, "online": sorted(clients.keys())})


@app.websocket("/monitor_ws")
async def monitor_socket(ws: WebSocket):
    """Read-only feed of packet events for the visualization page."""
    await ws.accept()
    monitors.append(ws)
    try:
        while True:
            await ws.receive_text()  # monitors never send; just keep the socket alive
    except WebSocketDisconnect:
        if ws in monitors:
            monitors.remove(ws)


@app.get("/")
def index():
    return FileResponse("static/index.html")


@app.get("/monitor")
def monitor_page():
    return FileResponse("static/monitor.html")


app.mount("/static", StaticFiles(directory="static"), name="static")
