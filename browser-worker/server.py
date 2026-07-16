#!/usr/bin/env python3
import asyncio
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = os.environ.get("BROWSER_WORKER_HOST", "127.0.0.1")
PORT = int(os.environ.get("BROWSER_WORKER_PORT", "9140"))
TOKEN = os.environ.get("APOLLO_BROWSER_WORKER_TOKEN", "")
MODEL = os.environ.get("BROWSER_WORKER_MODEL", os.environ.get("ANTHROPIC_DEFAULT_HAIKU_MODEL", "glm-5.2"))
ANTHROPIC_AUTH_TOKEN = os.environ.get("ANTHROPIC_AUTH_TOKEN", "")
ANTHROPIC_BASE_URL = os.environ.get("ANTHROPIC_BASE_URL", "")
RUN_SLOT = threading.BoundedSemaphore(1)


class Handler(BaseHTTPRequestHandler):
    server_version = "ApolloBrowserWorker/0.1"

    def do_GET(self):
        if self.path == "/healthz":
            available = RUN_SLOT.acquire(blocking=False)
            if available:
                RUN_SLOT.release()
            self.reply(200, {"ready": True, "busy": not available})
            return
        self.reply(404, {"error": "Not found"})

    def do_POST(self):
        if self.path != "/run":
            self.reply(404, {"error": "Not found"})
            return
        if TOKEN and self.headers.get("Authorization") != f"Bearer {TOKEN}":
            self.reply(401, {"error": "Unauthorized"})
            return
        if not RUN_SLOT.acquire(blocking=False):
            self.reply(429, {"error": "Browser worker is busy"}, {"Retry-After": "3"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 64 * 1024:
                self.reply(400, {"error": "Invalid request size"})
                return
            body = json.loads(self.rfile.read(length))
            task = body.get("task")
            if not isinstance(task, str) or not task.strip() or len(task) > 10_000:
                self.reply(400, {"error": "Invalid task"})
                return
            domains = body.get("allowed_domains", [])
            if not isinstance(domains, list) or any(not isinstance(item, str) for item in domains):
                self.reply(400, {"error": "Invalid allowed_domains"})
                return
            max_steps = body.get("max_steps", 30)
            if not isinstance(max_steps, int) or not 1 <= max_steps <= 50:
                self.reply(400, {"error": "Invalid max_steps"})
                return
            self.reply(200, asyncio.run(run_browser(task.strip(), domains[:50], max_steps)))
        except json.JSONDecodeError:
            self.reply(400, {"error": "Invalid JSON"})
        except Exception as error:
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

    def log_message(self, format, *args):
        print(f"[Apollo Browser Worker] {self.address_string()} {format % args}")


async def run_browser(task, allowed_domains, max_steps):
    from browser_use import Agent, BrowserProfile, ChatAnthropic

    profile_options = {"headless": True}
    if allowed_domains:
        profile_options["allowed_domains"] = allowed_domains
    profile = BrowserProfile(**profile_options)
    llm = ChatAnthropic(model=MODEL, auth_token=ANTHROPIC_AUTH_TOKEN, base_url=ANTHROPIC_BASE_URL)
    agent = Agent(task=task, llm=llm, browser_profile=profile, enable_signal_handler=False)
    history = await agent.run(max_steps=max_steps)
    return {
        "ok": bool(history.is_successful()),
        "result": history.final_result(),
        "urls": history.urls(),
        "errors": [error for error in history.errors() if error][-10:],
    }


if __name__ == "__main__":
    if not TOKEN:
        raise SystemExit("APOLLO_BROWSER_WORKER_TOKEN is required")
    if not ANTHROPIC_AUTH_TOKEN or not ANTHROPIC_BASE_URL:
        raise SystemExit("ANTHROPIC_AUTH_TOKEN and ANTHROPIC_BASE_URL are required")
    print(f"[Apollo Browser Worker] listening on http://{HOST}:{PORT}")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
