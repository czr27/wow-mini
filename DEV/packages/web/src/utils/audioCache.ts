/**
 * 本地音频资源持久化缓存（IndexedDB）
 * 与美术图标缓存 (artCache.ts) 一致：按 URL 缓存音频 Blob，刷新重进直接命中本地缓存，避免重复下载。
 * IndexedDB 无固定过期时间，除非用户手动清理浏览器站点数据，否则长期有效。
 */

const DB_NAME = 'wow_simu_audio_cache';
const DB_VERSION = 1;
const STORE_NAME = 'tracks';

export interface CachedAudioEntry {
  url: string;
  blob: Blob;
  updatedAt: number;
}

export function isAudioCacheSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof indexedDB !== 'undefined' &&
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function'
  );
}

let dbPromise: Promise<IDBDatabase | null> | null = null;
let persistRequested = false;

function requestPersistentStorageOnce(): void {
  if (persistRequested || typeof navigator === 'undefined') return;
  persistRequested = true;
  try {
    if (navigator.storage && typeof navigator.storage.persist === 'function') {
      void navigator.storage.persist().catch(() => {});
    }
  } catch {
    // ignore
  }
}

function openAudioCacheDb(): Promise<IDBDatabase | null> {
  if (!isAudioCacheSupported()) return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  requestPersistentStorageOnce();

  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'url' });
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

export async function getAllCachedAudioUrls(): Promise<Map<string, Blob>> {
  const result = new Map<string, Blob>();
  const db = await openAudioCacheDb();
  if (!db) return result;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const list = Array.isArray(req.result) ? (req.result as CachedAudioEntry[]) : [];
        for (const item of list) {
          if (item?.url && item.blob instanceof Blob) {
            result.set(item.url, item.blob);
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

export async function putCachedAudioEntry(url: string, blob: Blob): Promise<void> {
  const db = await openAudioCacheDb();
  if (!db) return;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const entry: CachedAudioEntry = {
        url,
        blob,
        updatedAt: Date.now(),
      };
      store.put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}
