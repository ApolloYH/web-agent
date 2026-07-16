# Apollo Browser Worker

独立运行的 `browser-use` 托管浏览器后端。它不复用用户本地 Chrome 的 Cookie，只在配置 `APOLLO_BROWSER_WORKER_URL` 后向 Apollo 注册 `browser_managed_task`。

```bash
cd browser-worker
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/browser-use install
APOLLO_BROWSER_WORKER_TOKEN=replace-with-random-token \
ANTHROPIC_AUTH_TOKEN=replace-with-anthropic-token \
ANTHROPIC_BASE_URL=https://api.anthropic.com \
BROWSER_WORKER_MODEL=claude-haiku-4-5 \
.venv/bin/python server.py
```

默认监听 `127.0.0.1:9140`，同时只运行一个任务。浏览器默认禁止直接访问 IP、localhost、链路本地元数据和常见内部域名；生产环境仍应使用容器或网络命名空间阻断私网出口，以覆盖 DNS rebinding。运行期间会保留最新浏览器画面，供 Web 通过带鉴权的 `/sessions/:id` 与 `/sessions/:id/frame` 接口展示；只保留最近 20 个会话且不落盘。生产环境应把它作为独立 systemd 服务或容器运行，不要放进 Web 主进程。

## 生产 systemd

```bash
python3.12 -m venv /opt/wyd-web-agent/shared/browser-worker-venv
/opt/wyd-web-agent/shared/browser-worker-venv/bin/pip install -r /opt/wyd-web-agent/current/browser-worker/requirements.txt
sudo install -d -o wyd-agent -g wyd-agent /opt/wyd-web-agent/shared/browser-worker-home
sudo -u wyd-agent env HOME=/opt/wyd-web-agent/shared/browser-worker-home \
  /opt/wyd-web-agent/shared/browser-worker-venv/bin/browser-use install
sudo cp ops/apollo-browser-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now apollo-browser-worker.service
curl -fsS http://127.0.0.1:9140/healthz
```

共享 `.env` 需设置 `ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_BASE_URL`、随机的 `APOLLO_BROWSER_WORKER_TOKEN`，以及供 Web 使用的 `APOLLO_BROWSER_WORKER_URL=http://127.0.0.1:9140`。Worker 默认读取 `ANTHROPIC_DEFAULT_HAIKU_MODEL`，也可用 `BROWSER_WORKER_MODEL` 单独覆盖。
