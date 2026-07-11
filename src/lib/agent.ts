import type { Artifact } from '@/types';

const ARTIFACT_BLOCK = /```artifacts\s*([\s\S]*)```\s*$/g;

/**
 * 从 assistant 完整文本中抽取产出物（通道 A）。
 * 约定：agent 在回复中输出 ```artifacts [ {...}, {...} ] ``` 代码块。
 * 返回 { cleanText, artifacts }：cleanText 已移除 artifacts 块，用于气泡展示。
 */
export function extractArtifacts(text: string): { cleanText: string; artifacts: Artifact[] } {
  const artifacts: Artifact[] = [];
  let match: RegExpExecArray | null;
  ARTIFACT_BLOCK.lastIndex = 0;
  while ((match = ARTIFACT_BLOCK.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of arr) {
        if (item && typeof item === 'object' && item.kind) {
          artifacts.push({
            id: item.id ?? `art-${artifacts.length}-${item.title ?? 'untitled'}`,
            kind: item.kind,
            title: item.title ?? '未命名产出物',
            url: item.url,
            content: item.content,
            size: item.size,
            meta: item.meta,
          });
        }
      }
    } catch {
      // artifacts 块 JSON 不合法时跳过，不影响正文
    }
  }
  const cleanText = text.replace(ARTIFACT_BLOCK, '').trim();
  return { cleanText, artifacts };
}
