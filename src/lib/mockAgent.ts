// 本地 mock agent：在没有真实后端时演示完整链路。
// 模拟流式增量输出，并在末尾附带 artifacts 代码块。
// 产出物覆盖四种：markdown / json / word(docx, 通道B url) / pdf(通道B url)。

import type { ProcessStep } from '@/types';

// 一个真实、最小、可被 docx-preview 渲染的 .docx（OOXML zip 的 base64）。
const MOCK_DOCX_BASE64 =
  'UEsDBBQAAAAIAE+56VwXmADX6wAAALIBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH1QyU4DMQy98xWRr2gmAweEUKc9sByBQ/kAK/HMRM2mOC3t3+NpoQdUONpvs99itQ9e7aiwS7GHm7YDRdEk6+LYw8f6pbkHxRWjRZ8i9XAghtXyarE+ZGIl4sg9TLXmB63ZTBSQ25QpCjKkErDKWEad0WxwJH3bdXfapFgp1qbOHiBmTzTg1lf1vJf96ZJCnkE9nphzWA+Ys3cGq+B6F+2vmOY7ohXlkcOTy3wtBNCXI2bo74Qf4ZuUU5wl9Y6lvmIQmv5MxWqbzDaItP3f58KlaRicobN+dsslGWKW1oNvz0hAF88f6GPlyy9QSwMEFAAAAAgAT7npXD+t/vqvAAAALAEAAAsAAABfcmVscy8ucmVsc43POw7CMAwA0J1TRN5pWgaEUEMXhNQVlQNEiZtWNB/F4dPbk4EBKgZG/57tunnaid0x0uidgKoogaFTXo/OCLh0p/UOGCXptJy8QwEzEjSHVX3GSaY8Q8MYiGXEkYAhpbDnnNSAVlLhA7pc6X20MuUwGh6kukqDfFOWWx4/DVigrNUCYqsrYN0c8B/c9/2o8OjVzaJLP3YsOrIso8Ek4OGj5vqdLjILPJ/Dv548vABQSwMEFAAAAAgAT7npXAUvvqxTAgAAlwUAABEAAAB3b3JkL2RvY3VtZW50LnhtbM1Uz28SQRS+96+YTMLJyC4UCSWF3ryZmKjxvMAUSNgf2V3BegK0pcUtwbhUQ1BaLeCvgiambheiif9Kd2a3p/4Lzu5KSUwbCade3sz33rz3vvflZVbXHvMFUESykheFBAwFWQiQkBYzeSGbgA+u374Zg0BROSHDFUQBJeAGUuBacmm1FM+I6Uc8ElRAKwhKvJSAOVWV4gyjpHOI55SgKCGBxtZFmedUCuUsUxLljCSLaaQotAFfYMIsG2V4Li9Ar2ZKzGwk6Sm5RvbMXe9IMa5VnoBSvMgVEnA5CqmHuYh7LOKKxKUpR0lGCpKLCCbx0Xts9i2jjesHpN7DL+pujupnela6tN2sUZidq5Gtf8PNhv15BLisq4mtd8l2E/z+AchEtw9N8JBODixzgGumvfPxPyyuaDIf93+lCsfmmsAyyqflCtGP8WaP9KvOYHsxkqTzxVedlMd+NRAKR4Bl1PDm0/OJhpsaGen43duz1i8aCUYCp+WqZYydfsV3kjc9p/YJ7zYso4M1k6Y43w9sbWiZW7bZB6FYANjtZzSCu103o9ylBa6joKZGBfV5ktcNe7y1GElfifNJ+4Y7OgAU491XLl6ZQs2DtwLXUQVjh6pgGc/9pcBj0xkOFxTCy8X1fXw4uFgPUm8R/ae7VyfHuPPBF4f6nVHLrp6Qva90V4ixf1Z5aR/t2a3eVbuioLTqDyJl77lD0v8sFFpho5Dec/QejS17E7sP7nAy9aqiRP2RCOs+kfPZnDqDKVFVRX6GC2h9GvVVm/Zj/n56S+5t+qUm/wBQSwECFAMUAAAACABPuelcF5gA1+sAAACyAQAAEwAAAAAAAAAAAAAAgAEAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUAxQAAAAIAE+56Vw/rf76rwAAACwBAAALAAAAAAAAAAAAAACAARwBAABfcmVscy8ucmVsc1BLAQIUAxQAAAAIAE+56VwFL76sUwIAAJcFAAARAAAAAAAAAAAAAACAAfQBAAB3b3JkL2RvY3VtZW50LnhtbFBLBQYAAAAAAwADALkAAAB2BAAAAAA=';

function makePdfDataUrl(): string {
  const pdf = `%PDF-1.1
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 74>>stream
BT /F1 18 Tf 30 120 Td (Mock Agent PDF Output) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF`;
  return 'data:application/pdf;base64,' + btoa(unescape(encodeURIComponent(pdf)));
}

const MOCK_MARKDOWN = `## 分析结论

我已经完成任务处理，产出物见右侧面板。要点如下：

- **收入**同比增长 **12.4%**
- 主要驱动来自 *华东区*
- 建议下季度加大投放

\`\`\`python
def roi(gain, cost):
    return (gain - cost) / cost
\`\`\`

| 区域 | 增长 |
| --- | --- |
| 华东 | 18% |
| 华南 | 9% |
`;

const MOCK_JSON = JSON.stringify(
  {
    summary: { revenue: 1240000, growth: 0.124, region_top: '华东' },
    regions: [
      { name: '华东', growth: 0.18 },
      { name: '华南', growth: 0.09 },
    ],
    generated_at: '2026-07-09T00:00:00Z',
  },
  null,
  2,
);

export function buildMockArtifactsBlock(): string {
  const artifacts = [
    { id: 'md-1', kind: 'markdown', title: '分析报告.md', content: MOCK_MARKDOWN },
    { id: 'json-1', kind: 'json', title: '结构化结果.json', content: MOCK_JSON },
    {
      id: 'word-1',
      kind: 'word',
      title: '季度报告.docx',
      content: MOCK_DOCX_BASE64,
      url:
        'data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,' +
        MOCK_DOCX_BASE64,
    },
    { id: 'pdf-1', kind: 'pdf', title: '汇报材料.pdf', url: makePdfDataUrl() },
  ];
  return '\n\n```artifacts\n' + JSON.stringify(artifacts, null, 2) + '\n```\n';
}

export type MockStreamHandlers = {
  onDelta: (chunk: string) => void;
  /** 过程步骤更新（Thought / Run），可点击展开 */
  onSteps?: (steps: ProcessStep[]) => void;
};

/**
 * 模拟流式 + 可折叠过程块：
 * 1) Thought（默认折叠）
 * 2) Run 工具（默认折叠，展开见命令与输出）
 * 3) 最终回答 + artifacts
 */
export async function mockStream(
  userText: string,
  onDeltaOrHandlers: ((chunk: string) => void) | MockStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const handlers: MockStreamHandlers =
    typeof onDeltaOrHandlers === 'function'
      ? { onDelta: onDeltaOrHandlers }
      : onDeltaOrHandlers;
  const { onDelta, onSteps } = handlers;

  const steps: ProcessStep[] = [];
  const push = (step: ProcessStep) => {
    const i = steps.findIndex((s) => s.id === step.id);
    if (i >= 0) steps[i] = step;
    else steps.push(step);
    onSteps?.([...steps]);
  };

  const sleep = (ms: number) =>
    new Promise<void>((r) => {
      const t = setTimeout(r, ms);
      signal?.addEventListener('abort', () => {
        clearTimeout(t);
        r();
      });
    });

  // ── Thought（默认折叠，可点击展开）──────────────────────────
  const thoughtStart = Date.now();
  push({
    id: 'thought-1',
    kind: 'thought',
    title: 'Thought',
    pending: true,
    detail: '解析用户意图，规划产出物类型与生成顺序…',
  });
  await sleep(450);
  if (signal?.aborted) return;
  push({
    id: 'thought-1',
    kind: 'thought',
    title: 'Thought',
    pending: false,
    durationSec: (Date.now() - thoughtStart) / 1000,
    detail: `用户请求：「${userText}」\n\n计划：\n1. 生成 Markdown 分析报告\n2. 输出结构化 JSON\n3. 渲染 Word / PDF 文档\n\n（此块默认折叠，点击可展开查看）`,
  });

  // ── Run：模拟工具 ─────────────────────────────────────────
  push({
    id: 'run-1',
    kind: 'tool_run',
    title: 'Prepare artifact templates',
    pending: true,
    command: 'node scripts/prepare-artifacts.mjs --kinds md,json,docx,pdf',
  });
  await sleep(500);
  if (signal?.aborted) return;
  push({
    id: 'run-1',
    kind: 'tool_run',
    title: 'Prepare artifact templates',
    pending: false,
    durationSec: 0.5,
    command: 'node scripts/prepare-artifacts.mjs --kinds md,json,docx,pdf',
    detail: 'templates ready · 4 kinds\nok',
  });

  push({
    id: 'run-2',
    kind: 'tool_run',
    title: 'Generate report bundle',
    pending: true,
    command: 'agent generate --out workspace/artifacts/',
  });
  await sleep(400);
  if (signal?.aborted) return;
  push({
    id: 'run-2',
    kind: 'tool_run',
    title: 'Generate report bundle',
    pending: false,
    durationSec: 0.4,
    command: 'agent generate --out workspace/artifacts/',
    detail: 'wrote 分析报告.md\nwrote 结构化结果.json\nwrote 季度报告.docx\nwrote 汇报材料.pdf',
  });

  // ── 最终回答 ─────────────────────────────────────────────
  const reply = `收到请求：“${userText}”。\n\n我已完成处理，生成了 Word / PDF / JSON / Markdown 四类产出物。你可以在右侧面板预览；上方 **Thought / Run** 可点击展开查看过程。`;
  for (const ch of reply) {
    if (signal?.aborted) return;
    onDelta(ch);
    await sleep(10);
  }
  for (const ch of buildMockArtifactsBlock()) {
    if (signal?.aborted) return;
    onDelta(ch);
  }
}
