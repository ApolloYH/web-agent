import fs from 'node:fs/promises';

const source = await fs.readFile(new URL('../server/site-inspector.ts', import.meta.url), 'utf8');
const pinned = source.match(/OPEN_DESIGN_UPSTREAM_COMMIT = '([0-9a-f]{40})'/)?.[1];
if (!pinned) throw new Error('找不到 OPEN_DESIGN_UPSTREAM_COMMIT');
const response = await fetch('https://api.github.com/repos/nexu-io/open-design/commits/HEAD', {
  headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'apollo-open-design-check' },
});
if (!response.ok) throw new Error(`GitHub ${response.status}: ${await response.text()}`);
const latest = (await response.json()).sha;
if (latest !== pinned) {
  console.error(`OpenDesign 已更新：${pinned.slice(0, 8)} -> ${latest.slice(0, 8)}\n请审查元素选择协议变更：https://github.com/nexu-io/open-design/compare/${pinned}...${latest}`);
  process.exitCode = 1;
} else {
  console.log(`OpenDesign 协议基线仍为 ${pinned.slice(0, 8)}`);
}
