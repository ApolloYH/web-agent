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
    const next = replaceAll ? text.split(find).join(replacement) : text.replace(find, replacement);
    const matches = replaceAll ? text.split(find).length - 1 : 1;
    nodes[0]!.textContent = next;
    for (const node of nodes.slice(1)) node.textContent = '';
    count += matches;
    if (!replaceAll) break;
  }
  if (!count) throw new Error(`文档中没有找到“${find}”`);
  return { file: writeDocument(file, archive, document), count };
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
