import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { createApolloMiddleware } from './server/apollo-middleware';

// 纯前端 SPA：对话入口 + 产出物预览（Word / PDF / JSON / Markdown 均只读预览）。
export default defineConfig(({ mode }) => {
  // 从 .env(.local) 读取 Noumi 上游与可选密钥（密钥优先放这里，避免写进前端 JS）。
  const env = loadEnv(mode, process.cwd(), '');
  const noumiUpstream =
    env.NOUMI_API_BASE || 'https://www.langhub.cn/api/external/v1';
  const noumiKey = env.NOUMI_API_KEY || '';
  const apollo = createApolloMiddleware({
    workspaceRoot: process.cwd(),
    envPath: resolve(process.cwd(), 'agent/.apollo/.env'),
  });

  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'apollo-api',
        configureServer(server) {
          server.middlewares.use(apollo.handle);
          server.httpServer?.once('close', apollo.close);
        },
        configurePreviewServer(server) {
          server.middlewares.use(apollo.handle);
          server.httpServer?.once('close', apollo.close);
        },
      },
    ],
    base: './',
    publicDir: 'public',
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    server: {
      host: true,
      watch: { ignored: ['**/agent/dist/**'] },
      // 开发代理：前端同源请求 /noumi-api/* → 转发到 langhub.cn，绕开 CORS。
      // 若配置了 NOUMI_API_KEY，则由代理注入 Authorization，密钥不出现在浏览器里。
      proxy: {
        '/noumi-api': {
          target: noumiUpstream,
          changeOrigin: true,
          secure: true,
          rewrite: (p) => p.replace(/^\/noumi-api/, ''),
          configure: (proxy) => {
            if (!noumiKey) return;
            proxy.on('proxyReq', (proxyReq) => {
              if (!proxyReq.getHeader('authorization')) {
                proxyReq.setHeader('authorization', `Bearer ${noumiKey}`);
              }
            });
          },
        },
      },
    },
  };
});
