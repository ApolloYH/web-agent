import { libraryKind, type LibraryFile, type WritableFileHandle } from './documentFiles';

export interface DirectoryHandle {
  kind: 'directory';
  name: string;
  entries(): AsyncIterableIterator<[string, DirectoryHandle | WritableFileHandle]>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<WritableFileHandle>;
  queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
}

declare global {
  interface Window {
    showDirectoryPicker?: (options: { mode: 'readwrite' }) => Promise<DirectoryHandle>;
  }
}

const DATABASE = 'apollo-local-files';
const STORE = 'handles';
const KEY = 'folder';
const MAX_FILES = 5_000;
const MAX_DEPTH = 20;

export async function chooseLocalFolder(): Promise<DirectoryHandle> {
  if (!window.showDirectoryPicker) throw new Error('当前浏览器不支持本地文件夹编辑，请使用桌面版 Chrome 或 Edge');
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  await persistHandle(handle);
  return handle;
}

export async function restoreLocalFolder(): Promise<DirectoryHandle | null> {
  const handle = await readHandle().catch(() => null);
  if (!handle) return null;
  return await handle.queryPermission({ mode: 'readwrite' }) === 'granted' ? handle : null;
}

export async function ensureFolderPermission(handle: DirectoryHandle): Promise<boolean> {
  if (await handle.queryPermission({ mode: 'readwrite' }) === 'granted') return true;
  return await handle.requestPermission({ mode: 'readwrite' }) === 'granted';
}

export async function listLocalFiles(root: DirectoryHandle): Promise<LibraryFile[]> {
  const output: LibraryFile[] = [];
  await walk(root, '', output, 0);
  return output.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
}

export async function writeLocalTextFile(root: DirectoryHandle, name: string, content: string, overwrite = false): Promise<{ path: string; size: number; modifiedAt: string }> {
  if (!name || name.length > 120 || name.startsWith('.') || /[\\/\0]/.test(name) || !/\.(?:txt|md|markdown|json)$/i.test(name)) throw new Error('只能在当前文件夹根目录写入 TXT、Markdown 或 JSON 文件');
  if (new TextEncoder().encode(content).byteLength > 5 * 1024 * 1024) throw new Error('本地文本文件不能超过 5MB');
  if (!overwrite) {
    const exists = await root.getFileHandle(name).then(() => true).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'NotFoundError') return false;
      throw error;
    });
    if (exists) throw new Error(`文件“${name}”已存在；如需覆盖，请明确确认`);
  }
  if (name.toLowerCase().endsWith('.json')) JSON.parse(content);
  const handle = await root.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(new Blob([content], { type: 'text/plain;charset=utf-8' }));
  await writable.close();
  const file = await handle.getFile();
  return { path: name, size: file.size, modifiedAt: new Date(file.lastModified).toISOString() };
}

async function walk(directory: DirectoryHandle, prefix: string, output: LibraryFile[], depth: number): Promise<void> {
  if (depth > MAX_DEPTH) throw new Error(`本地文件夹层级超过 ${MAX_DEPTH} 层，请选择范围更小的目录`);
  for await (const [name, handle] of directory.entries()) {
    if (name.startsWith('.')) continue;
    const relativePath = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === 'directory') {
      await walk(handle, relativePath, output, depth + 1);
      continue;
    }
    const kind = libraryKind(name);
    if (!kind) continue;
    if (output.length >= MAX_FILES) throw new Error(`本地文件夹中可识别文件超过 ${MAX_FILES} 个，请选择范围更小的目录`);
    const file = await handle.getFile();
    output.push({
      id: `local:${relativePath}`,
      title: name,
      kind,
      size: file.size,
      modifiedAt: new Date(file.lastModified).toISOString(),
      source: 'local',
      handle,
      relativePath,
    });
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function persistHandle(handle: DirectoryHandle): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = database.transaction(STORE, 'readwrite').objectStore(STORE).put(handle, KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  database.close();
}

async function readHandle(): Promise<DirectoryHandle | null> {
  const database = await openDatabase();
  const handle = await new Promise<DirectoryHandle | null>((resolve, reject) => {
    const request = database.transaction(STORE).objectStore(STORE).get(KEY);
    request.onsuccess = () => resolve((request.result as DirectoryHandle | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return handle;
}
