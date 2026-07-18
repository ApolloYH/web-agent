# Apollo Browser Worker

独立运行的 Apollo 自托管浏览器后端。它使用 `browser-use` 驱动服务器上的隔离 Chromium，不复用用户本地 Chrome 的 Cookie；只在配置 `APOLLO_BROWSER_WORKER_URL` 后向 Apollo 注册 `browser_managed_task`。

```bash
cd browser-worker
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
APOLLO_BROWSER_WORKER_TOKEN=replace-with-random-token \
ANTHROPIC_AUTH_TOKEN=replace-with-model-key \
ANTHROPIC_BASE_URL=https://example.com/api/anthropic \
BROWSER_WORKER_MODEL=glm-5.2 \
.venv/bin/python server.py
```

默认监听 `127.0.0.1:9140`，同时只运行一个任务。Web 通过 Worker 的 MJPEG 实时流显示画面，并把点击、滚动和键盘输入通过 CDP 发回同一个 Chromium 会话。`BROWSER_WORKER_FRAME_INTERVAL` 可调整抓帧间隔，默认 `0.15` 秒。Worker 只保留最近 20 个任务的临时元数据且不落盘。

## 生产 systemd

```bash
python3.12 -m venv /opt/apollo-web-agent/shared/browser-worker-venv
/opt/apollo-web-agent/shared/browser-worker-venv/bin/pip install -r /opt/apollo-web-agent/current/browser-worker/requirements.txt
sudo install -d -o apollo-agent -g apollo-agent /opt/apollo-web-agent/shared/browser-worker-home
sudo -u apollo-agent env HOME=/opt/apollo-web-agent/shared/browser-worker-home \
sudo cp ops/apollo-browser-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now apollo-browser-worker.service
curl -fsS http://127.0.0.1:9140/healthz
```

共享 `.env` 需设置 `ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_BASE_URL`、`BROWSER_WORKER_MODEL`、随机的 `APOLLO_BROWSER_WORKER_TOKEN`，以及供 Web 使用的 `APOLLO_BROWSER_WORKER_URL=http://127.0.0.1:9140`。Worker 仅监听回环地址，实时流和控制接口由主站鉴权代理，不要直接暴露公网。
