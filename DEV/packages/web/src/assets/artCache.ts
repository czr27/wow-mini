/**
 * 本地美术资源持久化缓存（IndexedDB）
 * 按文件名 + 内容 Hash 缓存 Blob，刷新重进时 Hash 相等的资源直接命中本地缓存，跳过网络下载。
 */

const DB_NAME = 'wow_simu_art_cache';
const DB_VERSION = 1;
const STORE_NAME = 'resources';

export interface CachedArtEntry {
  file: string;
  hash: string;
  blob: Blob;
  updatedAt: number;
}

export function isArtCacheSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof indexedDB !== 'undefined' &&
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function'
  );
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openArtCacheDb(): Promise<IDBDatabase | null> {
  if (!isArtCacheSupported()) return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'file' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null;
        resolve(null);
      };
      req.onblocked = () => resolve(null);
    } catch {
      dbPromise = null;
      resolve(null);
    }
  });

  return dbPromise;
}

export async function getAllCachedArtEntries(): Promise<Map<string, CachedArtEntry>> {
  const result = new Map<string, CachedArtEntry>();
  const db = await openArtCacheDb();
  if (!db) return result;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const list = Array.isArray(req.result) ? (req.result as CachedArtEntry[]) : [];
        for (const item of list) {
          if (item?.file && item.hash && item.blob instanceof Blob) {
            result.set(item.file, item);
          }
        }
        resolve(result);
      };
      req.onerror = () => resolve(result);
    } catch {
      resolve(result);
    }
  });
}

export async function putCachedArtEntries(entries: CachedArtEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const db = await openArtCacheDb();
  if (!db) return;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      for (const entry of entries) {
        store.put(entry);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function deleteCachedArtFiles(files: string[]): Promise<void> {
  if (files.length === 0) return;
  const db = await openArtCacheDb();
  if (!db) return;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      for (const file of files) {
        store.delete(file);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}
