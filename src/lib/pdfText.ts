import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

const cache = new WeakMap<File, Promise<PdfTextResult>>();

export type PdfTextResult = {
  content: string;
  pages: number;
  pagesRead: number;
  truncated: boolean;
};

export function extractPdfText(file: File, maxCharacters = 1_000_000): Promise<PdfTextResult> {
  const existing = cache.get(file);
  if (existing) return existing;
  const task = readPdfText(file, maxCharacters);
  cache.set(file, task);
  task.catch(() => cache.delete(file));
  return task;
}

async function readPdfText(file: File, maxCharacters: number): Promise<PdfTextResult> {
  const pdf = await getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    const pageCount = pdf.numPages;
    const pages: string[] = [];
    let length = 0;
    let pagesRead = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages && length < maxCharacters; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .flatMap((item) => 'str' in item && typeof item.str === 'string' ? [item.str] : [])
        .join(' ')
        .trim();
      pages.push(text);
      length += text.length + 1;
      pagesRead = pageNumber;
      page.cleanup();
    }
    const joined = pages.join('\n').slice(0, maxCharacters);
    return { content: joined, pages: pageCount, pagesRead, truncated: pagesRead < pageCount || length > maxCharacters };
  } finally {
    await pdf.destroy();
  }
}
