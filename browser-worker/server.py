#!/usr/bin/env python3
import asyncio
import contextlib
import ipaddress
import json
import os
import re
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

HOST = os.environ.get("BROWSER_WORKER_HOST", "127.0.0.1")
PORT = int(os.environ.get("BROWSER_WORKER_PORT", "9140"))
TOKEN = os.environ.get("APOLLO_BROWSER_WORKER_TOKEN", "")
MODEL = os.environ.get("BROWSER_WORKER_MODEL") or os.environ.get("ANTHROPIC_DEFAULT_HAIKU_MODEL") or "glm-5.2"
ANTHROPIC_AUTH_TOKEN = os.environ.get("ANTHROPIC_AUTH_TOKEN", "")
ANTHROPIC_BASE_URL = os.environ.get("ANTHROPIC_BASE_URL", "")
FRAME_INTERVAL = min(1.0, max(0.1, float(os.environ.get("BROWSER_WORKER_FRAME_INTERVAL", "0.15"))))
RUN_SLOT = threading.BoundedSemaphore(1)
INPUT_SLOT = threading.BoundedSemaphore(4)
STREAM_SLOT = threading.BoundedSemaphore(16)
SESSIONS = {}
SESSIONS_LOCK = threading.Lock()
FRAME_CONDITION = threading.Condition(SESSIONS_LOCK)
CONTROLLERS = {}
CONTROLLERS_LOCK = threading.Lock()
SESSION_LIMIT = 20
def valid_session_id(value):
    return isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9-]{1,80}", value) is not None


def unsafe_allowed_domain(value):
    raw = value.strip().lower()
    if raw in {"*", "http://*", "https://*"}:
        return True
    try:
        parsed = urlparse(raw if "://" in raw else f"http://{raw}")
        host = (parsed.hostname or "").rstrip(".")
    except ValueError:
        return True
    if host.startswith("*."):
        host = host[2:]
    if not host or "." not in host:
        return True
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        pass
    return host in {"metadata.google.internal", "host.docker.internal", "gateway.docker.internal"} or host.endswith((".localhost", ".local", ".internal", ".home.arpa"))


def browser_profile_options(allowed_domains):
    options = {
        "headless": True,
        "viewport": {"width": 1280, "height": 720},
        "block_ip_addresses": True,
        "prohibited_domains": ["localhost", "*.localhost", "*.local", "*.internal", "*.home.arpa", "metadata.google.internal", "host.docker.internal", "gateway.docker.internal"],
    }
    if allowed_domains:
        options["allowed_domains"] = allowed_domains
    return options


def create_session(session_id):
    with SESSIONS_LOCK:
        if len(SESSIONS) >= SESSION_LIMIT:
            oldest = min(SESSIONS, key=lambda key: SESSIONS[key]["updated_at"])
            SESSIONS.pop(oldest, None)
        SESSIONS[session_id] = {
            "status": "starting",
            "url": "about:blank",
            "title": "正在启动浏览器",
            "step": 0,
            "updated_at": time.time(),
            "frame_version": "",
            "frame": None,
            "frame_mime": "image/jpeg",
            "live_view_url": "",
            "user_controlled": False,
            "error": "",
        }


def update_session(session_id, frame=None, frame_mime=None, **fields):
    with FRAME_CONDITION:
        session = SESSIONS.get(session_id)
        if not session:
            return
        session.update(fields)
        session["updated_at"] = time.time()
        if frame:
            session["frame"] = frame
            session["frame_mime"] = frame_mime or session["frame_mime"]
            session["frame_version"] = str(time.time_ns())
        FRAME_CONDITION.notify_all()


def session_snapshot(session_id):
    with SESSIONS_LOCK:
        session = SESSIONS.get(session_id)
        if not session:
            return None
        return {key: value for key, value in session.items() if key not in {"frame", "frame_mime"}}


def session_frame(session_id):
    with SESSIONS_LOCK:
        session = SESSIONS.get(session_id)
        return (session.get("frame"), session.get("frame_mime")) if session else (None, None)


def normalize_browser_input(value):
    if not isinstance(value, dict) or value.get("type") not in {"click", "scroll", "key", "text", "resume"}:
        raise ValueError("Invalid browser input")
    kind = value["type"]
    if kind in {"click", "scroll"}:
        for name in ("x", "y"):
            coordinate = value.get(name, 0.5)
            if isinstance(coordinate, bool) or not isinstance(coordinate, (int, float)) or not 0 <= coordinate <= 1:
                raise ValueError(f"Invalid {name}")
            value[name] = float(coordinate)
    if kind == "scroll":
        for name in ("delta_x", "delta_y"):
            delta = value.get(name, 0)
            if isinstance(delta, bool) or not isinstance(delta, (int, float)) or not -2000 <= delta <= 2000:
                raise ValueError(f"Invalid {name}")
            value[name] = float(delta)
    elif kind == "key":
        key = value.get("key")
        if not isinstance(key, str) or not 1 <= len(key) <= 32:
            raise ValueError("Invalid key")
    elif kind == "text":
        text = value.get("text")
        if not isinstance(text, str) or not text or len(text) > 4000:
            raise ValueError("Invalid text")
    return value


def send_browser_input(session_id, command):
    with CONTROLLERS_LOCK:
        controller = CONTROLLERS.get(session_id)
    if not controller:
        raise RuntimeError("Browser session is not interactive")
    loop, agent = controller
    asyncio.run_coroutine_threadsafe(dispatch_browser_input(session_id, agent, command), loop).result(timeout=5)


async def dispatch_browser_input(session_id, agent, command):
    if command["type"] == "resume":
        agent.resume()
        update_session(session_id, user_controlled=False)
        return
    if not agent.state.paused:
        agent.pause()
        update_session(session_id, user_controlled=True)
    browser_session = agent.browser_session
    cdp = await browser_session.get_or_create_cdp_session(focus=True)
    client = cdp.cdp_client
    session_id = cdp.session_id
    kind = command["type"]
    if kind in {"click", "scroll"}:
        metrics = await client.send.Page.getLayoutMetrics(session_id=session_id)
        viewport = metrics.get("cssVisualViewport") or metrics.get("layoutViewport") or {}
        x = round(command["x"] * viewport.get("clientWidth", 1280))
        y = round(command["y"] * viewport.get("clientHeight", 720))
    if kind == "click":
        for event in ("mousePressed", "mouseReleased"):
            await client.send.Input.dispatchMouseEvent(
                params={"type": event, "x": x, "y": y, "button": "left", "clickCount": 1},
                session_id=session_id,
            )
    elif kind == "scroll":
        await client.send.Input.dispatchMouseEvent(
            params={"type": "mouseWheel", "x": x, "y": y, "deltaX": command["delta_x"], "deltaY": command["delta_y"]},
            session_id=session_id,
        )
    elif kind == "text":
        await client.send.Input.insertText(params={"text": command["text"]}, session_id=session_id)
    else:
        key = command["key"]
        for event in ("keyDown", "keyUp"):
            await client.send.Input.dispatchKeyEvent(params={"type": event, "key": key}, session_id=session_id)


class Handler(BaseHTTPRequestHandler):
    server_version = "ApolloBrowserWorker/0.1"

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/healthz":
            available = RUN_SLOT.acquire(blocking=False)
            if available:
                RUN_SLOT.release()
            self.reply(200, {"ready": True, "busy": not available})
            return
        if TOKEN and self.headers.get("Authorization") != f"Bearer {TOKEN}":
            self.reply(401, {"error": "Unauthorized"})
            return
        match = re.fullmatch(r"/sessions/([A-Za-z0-9-]{1,80})(/frame|/stream)?", path)
        if match:
            session_id, view_path = match.groups()
            if view_path == "/stream":
                self.stream_frames(session_id)
                return
            if view_path == "/frame":
                frame, mime = session_frame(session_id)
                if not frame:
                    self.reply(404, {"error": "Frame not found"})
                else:
                    self.reply_bytes(200, frame, mime or "image/jpeg")
                return
            session = session_snapshot(session_id)
            self.reply(200, session) if session else self.reply(404, {"error": "Session not found"})
            return
        self.reply(404, {"error": "Not found"})

    def do_POST(self):
        path = urlparse(self.path).path
        if TOKEN and self.headers.get("Authorization") != f"Bearer {TOKEN}":
            self.reply(401, {"error": "Unauthorized"})
            return
        input_match = re.fullmatch(r"/sessions/([A-Za-z0-9-]{1,80})/input", path)
        if input_match:
            if not INPUT_SLOT.acquire(blocking=False):
                self.reply(429, {"error": "Too many browser inputs"}, {"Retry-After": "1"})
                return
            try:
                command = normalize_browser_input(self.read_json(8 * 1024))
                send_browser_input(input_match.group(1), command)
                self.reply(200, {"ok": True})
            except (ValueError, json.JSONDecodeError) as error:
                self.reply(400, {"error": str(error)})
            except Exception as error:
                self.reply(409, {"error": str(error)[:500]})
            finally:
                INPUT_SLOT.release()
            return
        if path != "/run":
            self.reply(404, {"error": "Not found"})
            return
        if not RUN_SLOT.acquire(blocking=False):
            self.reply(429, {"error": "Browser worker is busy"}, {"Retry-After": "3"})
            return
        session_id = ""
        try:
            body = self.read_json(64 * 1024)
            task = body.get("task")
            if not isinstance(task, str) or not task.strip() or len(task) > 10_000:
                self.reply(400, {"error": "Invalid task"})
                return
            domains = body.get("allowed_domains", [])
            if not isinstance(domains, list) or any(not isinstance(item, str) for item in domains):
                self.reply(400, {"error": "Invalid allowed_domains"})
                return
            if any(unsafe_allowed_domain(item) for item in domains):
                self.reply(400, {"error": "Unsafe allowed_domains"})
                return
            max_steps = body.get("max_steps", 30)
            if not isinstance(max_steps, int) or not 1 <= max_steps <= 50:
                self.reply(400, {"error": "Invalid max_steps"})
                return
            session_id = body.get("session_id") or uuid.uuid4().hex
            if not valid_session_id(session_id):
                self.reply(400, {"error": "Invalid session_id"})
                return
            create_session(session_id)
            result = asyncio.run(run_browser(task.strip(), domains[:50], max_steps, session_id))
            status = "succeeded" if result["ok"] else "failed"
            update_session(session_id, status=status, error="" if result["ok"] else "任务未成功完成")
            self.reply(200, {**result, "session_id": session_id})
        except (json.JSONDecodeError, ValueError) as error:
            self.reply(400, {"error": str(error) or "Invalid JSON"})
        except Exception as error:
            if session_id:
                update_session(session_id, status="failed", error=str(error)[:500])
            self.reply(500, {"ok": False, "error": str(error)[:2_000]})
        finally:
            RUN_SLOT.release()

    def reply(self, status, payload, headers=None):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(data)

    def read_json(self, max_bytes):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > max_bytes:
            raise ValueError("Invalid request size")
        return json.loads(self.rfile.read(length))

    def stream_frames(self, session_id):
        if not STREAM_SLOT.acquire(blocking=False):
            self.reply(429, {"error": "Too many browser streams"}, {"Retry-After": "1"})
            return
        try:
            self._stream_frames(session_id)
        finally:
            STREAM_SLOT.release()

    def _stream_frames(self, session_id):
        if not session_snapshot(session_id):
            self.reply(404, {"error": "Session not found"})
            return
        self.send_response(200)
        self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=apollo-frame")
        self.send_header("Cache-Control", "no-store, no-transform")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        version = ""
        try:
            while True:
                with FRAME_CONDITION:
                    FRAME_CONDITION.wait_for(
                        lambda: session_id not in SESSIONS or SESSIONS[session_id]["frame_version"] != version,
                        timeout=15,
                    )
                    session = SESSIONS.get(session_id)
                    if not session:
                        return
                    frame = session.get("frame")
                    mime = session.get("frame_mime", "image/jpeg")
                    next_version = session.get("frame_version", "")
                    terminal = session.get("status") in {"succeeded", "failed"}
                if frame and next_version != version:
                    version = next_version
                    self.wfile.write(
                        b"--apollo-frame\r\n"
                        + f"Content-Type: {mime}\r\nContent-Length: {len(frame)}\r\n\r\n".encode("ascii")
                        + frame
                        + b"\r\n"
                    )
                    self.wfile.flush()
                if terminal:
                    return
        except (BrokenPipeError, ConnectionResetError):
            return

    def reply_bytes(self, status, data, content_type):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format, *args):
        print(f"[Apollo Browser Worker] {self.address_string()} {format % args}")


async def run_browser(task, allowed_domains, max_steps, session_id):
    from browser_use import Agent, BrowserProfile, ChatAnthropic

    profile = BrowserProfile(**browser_profile_options(allowed_domains))
    llm = ChatAnthropic(model=MODEL, auth_token=ANTHROPIC_AUTH_TOKEN, base_url=ANTHROPIC_BASE_URL)
    browser_ready = asyncio.Event()
    loop = asyncio.get_running_loop()

    async def on_step(state, _output, step):
        update_session(session_id, status="running", url=state.url, title=state.title, step=step)
        with CONTROLLERS_LOCK:
            CONTROLLERS[session_id] = (loop, agent)
        browser_ready.set()

    agent = Agent(
        task=task,
        llm=llm,
        browser_profile=profile,
        use_vision="auto",
        use_thinking=False,
        flash_mode=True,
        use_judge=False,
        enable_signal_handler=False,
        register_new_step_callback=on_step,
    )
    capture_task = asyncio.create_task(capture_frames(agent, session_id, browser_ready))
    try:
        history = await agent.run(max_steps=max_steps)
    finally:
        with CONTROLLERS_LOCK:
            CONTROLLERS.pop(session_id, None)
        capture_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await capture_task
    return {"ok": bool(history.is_successful()), "result": history.final_result(), "urls": history.urls(), "errors": [error for error in history.errors() if error][-10:]}


async def capture_frames(agent, session_id, browser_ready):
    await browser_ready.wait()
    while True:
        try:
            frame = await agent.browser_session.take_screenshot(format="jpeg", quality=72)
            update_session(session_id, frame=frame, frame_mime="image/jpeg", status="running", url=await agent.browser_session.get_current_page_url(), title=await agent.browser_session.get_current_page_title())
        except Exception:
            pass
        await asyncio.sleep(FRAME_INTERVAL)


if __name__ == "__main__":
    if not TOKEN:
        raise SystemExit("APOLLO_BROWSER_WORKER_TOKEN is required")
    if not ANTHROPIC_AUTH_TOKEN or not ANTHROPIC_BASE_URL:
        raise SystemExit("ANTHROPIC_AUTH_TOKEN and ANTHROPIC_BASE_URL are required")
    print(f"[Apollo Browser Worker] listening on http://{HOST}:{PORT}")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
