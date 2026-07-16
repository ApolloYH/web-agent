import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

const WORD_NAMESPACE = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export async function extractDocxText(file: File): Promise<string> {
  const { document } = await readDocument(file);
  return [...document.getElementsByTagNameNS(WORD_NAMESPACE, 'p')]
    .map((paragraph) => [...paragraph.getElementsByTagNameNS(WORD_NAMESPACE, 't')].map((node) => node.textContent ?? '').join(''))
    .filter(Boolean)
    .join('\n');
}

export async function replaceDocxText(file: File, find: string, replacement: string, replaceAll = true): Promise<{ file: File; count: number }> {
  if (!find) throw new Error('要查找的文字不能为空');
  const { archive, document } = await readDocument(file);
  let count = 0;
  for (const paragraph of [...document.getElementsByTagNameNS(WORD_NAMESPACE, 'p')]) {
    const nodes = [...paragraph.getElementsByTagNameNS(WORD_NAMESPACE, 't')];
    if (!nodes.length) continue;
    const text = nodes.map((node) => node.textContent ?? '').join('');
    if (!text.includes(find)) continue;
    const matches = matchOffsets(text, find, replaceAll);
    const ranges = textNodeRanges(nodes);
    for (const start of [...matches].reverse()) replaceAcrossRuns(ranges, start, start + find.length, replacement);
    count += matches.length;
    if (!replaceAll) break;
  }
  if (!count) throw new Error(`文档中没有找到“${find}”`);
  return { file: writeDocument(file, archive, document), count };
}

function matchOffsets(text: string, find: string, replaceAll: boolean): number[] {
  const matches: number[] = [];
  for (let start = text.indexOf(find); start >= 0; start = text.indexOf(find, start + find.length)) {
    matches.push(start);
    if (!replaceAll) break;
  }
  return matches;
}

function textNodeRanges(nodes: Element[]): Array<{ node: Element; start: number; end: number }> {
  let offset = 0;
  return nodes.map((node) => {
    const start = offset;
    offset += (node.textContent ?? '').length;
    return { node, start, end: offset };
  });
}

function replaceAcrossRuns(
  ranges: Array<{ node: Element; start: number; end: number }>,
  start: number,
  end: number,
  replacement: string,
): void {
  const startIndex = ranges.findIndex((range) => start >= range.start && start < range.end);
  const endIndex = ranges.findIndex((range) => end > range.start && end <= range.end);
  if (startIndex < 0 || endIndex < 0) throw new Error('DOCX 文本结构与查找内容不一致');
  const startRange = ranges[startIndex]!;
  const endRange = ranges[endIndex]!;
  const startText = startRange.node.textContent ?? '';
  const endText = endRange.node.textContent ?? '';
  const prefix = startText.slice(0, start - startRange.start);
  const suffix = endText.slice(end - endRange.start);
  if (startIndex === endIndex) {
    setWordText(startRange.node, `${prefix}${replacement}${suffix}`);
    return;
  }
  setWordText(startRange.node, `${prefix}${replacement}`);
  for (let index = startIndex + 1; index < endIndex; index += 1) setWordText(ranges[index]!.node, '');
  setWordText(endRange.node, suffix);
}

function setWordText(node: Element, value: string): void {
  node.textContent = value;
  const namespace = 'http://www.w3.org/XML/1998/namespace';
  if (/^\s|\s$/.test(value)) node.setAttributeNS(namespace, 'xml:space', 'preserve');
  else node.removeAttributeNS(namespace, 'space');
}

export async function appendDocxText(file: File, text: string): Promise<File> {
  if (!text.trim()) throw new Error('追加内容不能为空');
  const { archive, document } = await readDocument(file);
  const body = document.getElementsByTagNameNS(WORD_NAMESPACE, 'body')[0];
  if (!body) throw new Error('DOCX 缺少正文结构');
  const section = body.getElementsByTagNameNS(WORD_NAMESPACE, 'sectPr')[0] ?? null;
  for (const line of text.split(/\r?\n/)) {
    const paragraph = document.createElementNS(WORD_NAMESPACE, 'w:p');
    const run = document.createElementNS(WORD_NAMESPACE, 'w:r');
    const value = document.createElementNS(WORD_NAMESPACE, 'w:t');
    if (/^\s|\s$/.test(line)) value.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
    value.textContent = line;
    run.appendChild(value);
    paragraph.appendChild(run);
    body.insertBefore(paragraph, section);
  }
  return writeDocument(file, archive, document);
}

async function readDocument(file: File): Promise<{ archive: Record<string, Uint8Array>; document: XMLDocument }> {
  const archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const bytes = archive['word/document.xml'];
  if (!bytes) throw new Error('不是有效的 DOCX 文件');
  const document = new DOMParser().parseFromString(strFromU8(bytes), 'application/xml');
  if (document.querySelector('parsererror')) throw new Error('DOCX 正文 XML 无法解析');
  return { archive, document };
}

function writeDocument(source: File, archive: Record<string, Uint8Array>, document: XMLDocument): File {
  archive['word/document.xml'] = strToU8(new XMLSerializer().serializeToString(document));
  const bytes = zipSync(archive, { level: 6 });
  return new File([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], source.name, {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    lastModified: Date.now(),
  });
}
