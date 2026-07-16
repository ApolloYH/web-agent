import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { createApolloMiddleware } from './server/apollo-middleware';
import { serveOfficeRuntime, startOfficeRuntimeServer } from './server/office-runtime';

// 对话入口 + Word、PDF、图片产出物只读预览。
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apollo = createApolloMiddleware({
    workspaceRoot: process.cwd(),
    envPath: resolve(process.cwd(), '.env'),
    registrationInvite: env.WEB_REGISTRATION_INVITE || '',
    adminUsername: env.WEB_ADMIN_USERNAME || '',
    allowUnrestricted: env.WEB_ALLOW_UNRESTRICTED === 'true',
    maxConcurrentRuns: Number(env.WEB_MAX_CONCURRENT_RUNS || 8),
    maxRunsPerUser: Number(env.WEB_MAX_RUNS_PER_USER || 3),
    entry: {
      langcoreApiKey: env.LANGCORE_API_KEY || '',
      langhubApiKey: env.NOUMI_API_KEY || '',
      langhubBaseUrl: env.NOUMI_API_BASE || 'https://www.langhub.cn/api/external/v1',
      projects: {
        risk_card: env.LANGHUB_PROJECT_RISK_CARD || '',
        supervision_notice: env.LANGHUB_PROJECT_SUPERVISION_NOTICE || '',
        supervision_log: env.LANGHUB_PROJECT_SUPERVISION_LOG || '',
        supervision_document: env.LANGHUB_PROJECT_SUPERVISION_DOCUMENT || '',
        hazard_analysis: env.LANGHUB_PROJECT_HAZARD || '',
        plan_review: env.LANGHUB_PROJECT_PLAN_REVIEW || '',
        drawing_compare: env.LANGHUB_PROJECT_DRAWING_COMPARE || '',
      },
    },
  });

  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'apollo-api',
        configureServer(server) {
          const officeServer = startOfficeRuntimeServer(Number(env.VITE_OFFICE_HOST_PORT || 5174));
          server.middlewares.use(serveOfficeRuntime);
          server.middlewares.use(apollo.handle);
          server.httpServer?.once('close', () => officeServer?.close());
          server.httpServer?.once('close', apollo.close);
        },
        configurePreviewServer(server) {
          const officeServer = startOfficeRuntimeServer(Number(env.VITE_OFFICE_HOST_PORT || 5174));
          server.middlewares.use(serveOfficeRuntime);
          server.middlewares.use(apollo.handle);
          server.httpServer?.once('close', () => officeServer?.close());
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
      host: '127.0.0.1',
      allowedHosts: ['.localhost'],
      watch: { ignored: ['**/agent/dist/**'] },
    },
    preview: { host: '127.0.0.1', allowedHosts: ['.localhost'] },
  };
});
