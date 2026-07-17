# Apollo Browser Worker

独立运行的 Browserbase + Stagehand 托管浏览器后端。它不复用用户本地 Chrome 的 Cookie，只在配置 `APOLLO_BROWSER_WORKER_URL` 后向 Apollo 注册 `browser_managed_task`。

```bash
cd browser-worker
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
APOLLO_BROWSER_WORKER_TOKEN=replace-with-random-token \
BROWSERBASE_API_KEY=replace-with-browserbase-key \
BROWSERBASE_MODEL=google/gemini-3-flash-preview \
.venv/bin/python server.py
```

默认监听 `127.0.0.1:9140`，同时只运行一个任务。浏览器实际运行在 Browserbase 隔离环境；Web 使用 Browserbase Live View 展示实时画面。Worker 只保留最近 20 个任务的临时元数据且不落盘。生产环境应把它作为独立 systemd 服务运行，不要放进 Web 主进程。

## 生产 systemd

```bash
python3.12 -m venv /opt/wyd-web-agent/shared/browser-worker-venv
/opt/wyd-web-agent/shared/browser-worker-venv/bin/pip install -r /opt/wyd-web-agent/current/browser-worker/requirements.txt
sudo install -d -o wyd-agent -g wyd-agent /opt/wyd-web-agent/shared/browser-worker-home
sudo -u wyd-agent env HOME=/opt/wyd-web-agent/shared/browser-worker-home \
sudo cp ops/apollo-browser-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now apollo-browser-worker.service
curl -fsS http://127.0.0.1:9140/healthz
```

共享 `.env` 需设置 `BROWSERBASE_API_KEY`、随机的 `APOLLO_BROWSER_WORKER_TOKEN`，以及供 Web 使用的 `APOLLO_BROWSER_WORKER_URL=http://127.0.0.1:9140`。Worker 默认通过 Browserbase Model Gateway 使用 `google/gemini-3-flash-preview`，可用 `BROWSERBASE_MODEL` 覆盖。
