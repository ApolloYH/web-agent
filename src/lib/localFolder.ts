import { libraryKind, type LibraryFile, type WritableFileHandle } from './documentFiles';

export interface DirectoryHandle {
  kind: 'directory';
  name: string;
  entries(): AsyncIterableIterator<[string, DirectoryHandle | WritableFileHandle]>;
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
  await walk(root, '', output);
  return output.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
}

async function walk(directory: DirectoryHandle, prefix: string, output: LibraryFile[]): Promise<void> {
  for await (const [name, handle] of directory.entries()) {
    if (name.startsWith('.')) continue;
    const relativePath = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === 'directory') {
      await walk(handle, relativePath, output);
      continue;
    }
    const kind = libraryKind(name);
    if (!kind) continue;
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
