# Apollo Browser Bridge

这个 Chrome MV3 扩展让 Apollo 操作用户明确选中的网页标签页。页面识别和点击、输入、选择、滚动基于 `@page-agent/page-controller`。

## 本地安装

```bash
pnpm build:extension
```

1. 打开 `chrome://extensions`，启用“开发者模式”。
2. 点击“加载已解压的扩展程序”，选择本目录下的 `dist/`。
3. 打开要操作的网页，点击扩展图标。图标出现 `ON` 后，该页才是当前受控标签页。
4. 回到 Apollo 设置，确认“用户 Chrome”显示已连接。

更新代码后重新执行构建，并在 `chrome://extensions` 点击该扩展的刷新按钮。

Agent 读取或操作受控页面时，页面四周会显示彩色呼吸边框，并用大号指针同步展示点击位置；提示层不接收鼠标事件，用户随时可以接管页面。系统开启“减少动态效果”时会自动停用呼吸和移动动画。

## 边界

- 扩展只接受 `https://apollo.yh521.top` 和本地开发站点的请求。
- 只能操作 `http://` 和 `https://` 页面，不能操作 Chrome 内部页、扩展页或 Apollo 本身。
- 构建时会禁用 PageController 中本项目不需要的任意 JavaScript 执行方法；依赖升级导致该隔离失效时构建会直接失败。
- 页面标题、URL 和简化 DOM 只在 Agent 调用对应工具时返回；密码输入和常见 token 格式会被遮蔽。
- 点击、输入、切换或关闭标签页均走 Apollo 现有工具审批链路。
