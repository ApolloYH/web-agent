import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { createApolloMiddleware } from './server/apollo-middleware';
import { serveOfficeRuntime, startOfficeRuntimeServer } from './server/office-runtime';

// 对话入口 + Word、PDF、图片产出物只读预览。
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const createApollo = () => createApolloMiddleware({
    workspaceRoot: process.cwd(),
    envPath: resolve(process.cwd(), '.env'),
    registrationInvite: env.WEB_REGISTRATION_INVITE || '',
    adminUsername: env.WEB_ADMIN_USERNAME || '',
    allowUnrestricted: env.WEB_ALLOW_UNRESTRICTED === 'true',
    maxConcurrentRuns: Number(env.WEB_MAX_CONCURRENT_RUNS || 8),
    maxRunsPerUser: Number(env.WEB_MAX_RUNS_PER_USER || 3),
    minFreeDiskBytes: Number(env.WEB_MIN_FREE_DISK_BYTES || 536870912),
    userStorageQuotaBytes: Number(env.WEB_USER_STORAGE_QUOTA_BYTES || 2147483648),
    uploadRetentionDays: Number(env.WEB_UPLOAD_RETENTION_DAYS || 7),
    trustedProxyAddresses: (env.WEB_TRUSTED_PROXIES || '').split(',').map((value) => value.trim()).filter(Boolean),
    managedBrowser: env.APOLLO_BROWSER_WORKER_URL ? {
      url: env.APOLLO_BROWSER_WORKER_URL,
      token: env.APOLLO_BROWSER_WORKER_TOKEN || '',
    } : undefined,
    rag: {
      siliconflowApiKey: env.SILICONFLOW_API_KEY || '',
      rerankerModel: env.RAG_RERANKER_MODEL || 'BAAI/bge-reranker-v2-m3',
      mineruApiKey: env.MINERU_API_KEY || '',
      chatApiKey: env.RAG_CHAT_API_KEY || '',
      chatBaseUrl: env.RAG_CHAT_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4',
      chatModel: env.RAG_CHAT_MODEL || 'glm-4.7-flashx',
      weknoraBaseUrl: env.WEKNORA_BASE_URL || '',
      weknoraApiKey: env.WEKNORA_API_KEY || '',
      weknoraEmbeddingModelId: env.WEKNORA_EMBEDDING_MODEL_ID || '',
      lightRagBaseUrlTemplate: env.LIGHTRAG_BASE_URL_TEMPLATE || '',
      lightRagApiKey: env.LIGHTRAG_API_KEY || '',
      externalTimeoutMs: Number(env.RAG_EXTERNAL_TIMEOUT_MS || 300_000),
    },
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
          const apollo = createApollo();
          const officeServer = startOfficeRuntimeServer(Number(env.VITE_OFFICE_HOST_PORT || 5174));
          server.middlewares.use(serveOfficeRuntime);
          server.middlewares.use(apollo.handle);
          server.httpServer?.once('close', () => officeServer?.close());
          server.httpServer?.once('close', apollo.close);
        },
        configurePreviewServer(server) {
          const apollo = createApollo();
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
