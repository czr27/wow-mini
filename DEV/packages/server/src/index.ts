import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import type { UserAccount, CharacterUiLayout } from '@cata-raid-sim/engine';
import {
  mergeAccountLists,
  normalizeCharacterNameKey,
  isReservedAiName,
} from '@cata-raid-sim/engine';
import { RoomWsHub } from './roomWs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Data storage path (persistent JSON file on server)
const DATA_DIR = path.resolve(__dirname, '../data');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const MAZE_DIR = path.join(DATA_DIR, 'maze_layouts');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(MAZE_DIR)) {
  fs.mkdirSync(MAZE_DIR, { recursive: true });
}

function mazeLayoutPath(dungeonId: string, stageIndex: number): string {
  const safeDungeon = dungeonId.replace(/[^a-zA-Z0-9_\-]/g, '_');
  return path.join(MAZE_DIR, `${safeDungeon}_stage_${stageIndex}.json`);
}

// In-memory cache synced with disk
let accountsMap = new Map<string, UserAccount>();

function loadAccountsFromDisk() {
  if (fs.existsSync(ACCOUNTS_FILE)) {
    try {
      const content = fs.readFileSync(ACCOUNTS_FILE, 'utf-8');
      if (content.trim()) {
        const list: UserAccount[] = JSON.parse(content);
        accountsMap.clear();
        for (const acc of list) {
          accountsMap.set(acc.username.toLowerCase(), acc);
        }
        console.log(`[Server Storage] Loaded ${accountsMap.size} accounts from disk.`);
        return;
      }
    } catch (err) {
      console.warn('[Server Storage] Warning: Failed to parse accounts.json, starting empty', err);
    }
  }
}

/**
 * Multi-client account mutations land in `accountsMap` first (merge on sync).
 * Disk writes are coalesced: mark dirty → flush at most once per 2s to avoid
 * Windows AV/lock storms when several clients save layouts/characters at once.
 */
const ACCOUNTS_PERSIST_INTERVAL_MS = 2000;
let accountsDirty = false;
let accountsPersistTimer: ReturnType<typeof setTimeout> | null = null;
let accountsPersisting = false;

/**
 * Atomic-ish persist for Windows: write temp → rename/copy over target.
 * Retries absorb AV/indexer locks (errno -4094 UNKNOWN / EBUSY / EPERM).
 */
function flushAccountsToDisk(): boolean {
  if (!accountsDirty || accountsPersisting) return !accountsDirty;
  accountsPersisting = true;
  // Clear dirty before snapshot: concurrent HTTP merges set it true again → re-schedule
  accountsDirty = false;
  const list = Array.from(accountsMap.values());
  const payload = JSON.stringify(list, null, 2);
  const tmp = `${ACCOUNTS_FILE}.${process.pid}.${Date.now()}.tmp`;
  const maxAttempts = 5;
  let lastErr: unknown;
  let ok = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(tmp, payload, 'utf-8');
      try {
        fs.renameSync(tmp, ACCOUNTS_FILE);
      } catch {
        fs.copyFileSync(tmp, ACCOUNTS_FILE);
        try {
          fs.unlinkSync(tmp);
        } catch {}
      }
      ok = true;
      break;
    } catch (err) {
      lastErr = err;
      try {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      } catch {}
      const waitMs = 40 * attempt;
      const start = Date.now();
      while (Date.now() - start < waitMs) {
        /* spin */
      }
    }
  }

  accountsPersisting = false;
  if (ok) {
    if (accountsDirty) scheduleAccountsPersist();
    return true;
  }
  console.error('[Server Storage] Failed to write accounts.json', lastErr);
  accountsDirty = true;
  scheduleAccountsPersist();
  return false;
}

/** Mark memory dirty and coalesce disk write to a 2s cadence. */
function scheduleAccountsPersist() {
  accountsDirty = true;
  if (accountsPersistTimer) return;
  accountsPersistTimer = setTimeout(() => {
    accountsPersistTimer = null;
    flushAccountsToDisk();
  }, ACCOUNTS_PERSIST_INTERVAL_MS);
}

/** Public alias used by HTTP handlers — never blocks the request on disk I/O. */
function saveAccountsToDisk() {
  scheduleAccountsPersist();
}

/** Process exit / stopServer: cancel timer and force one flush. */
function flushAccountsToDiskNow() {
  if (accountsPersistTimer) {
    clearTimeout(accountsPersistTimer);
    accountsPersistTimer = null;
  }
  if (accountsDirty) {
    // Bypass the early-return guard if a flush is mid-flight by waiting briefly
    const deadline = Date.now() + 500;
    while (accountsPersisting && Date.now() < deadline) {
      /* wait in-flight write */
    }
    accountsDirty = true;
    flushAccountsToDisk();
  }
}

// Initial load
loadAccountsFromDisk();

const PORT = Number(process.env.PORT) || 3001;

/** Assigned after HTTP server + WS hub boot; used by /api/auth/login to kick old sessions. */
let roomHub: RoomWsHub;

function setCorsHeaders(res: http.ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function readJsonBody<T = any>(req: http.IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      // Protect from large payloads
      if (data.length > 5 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        const parsed = data ? JSON.parse(data) : {};
        resolve(parsed);
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  try {
    // 1. Health probe
    if (pathname === '/api/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', time: Date.now(), accountsCount: accountsMap.size }));
      return;
    }

    // 1b. Prim 迷宫布局缓存：缺失时客户端生成后 PUT 固化，下次直接 GET
    const mazeMatch = pathname.match(/^\/api\/maze-layouts\/([^/]+)\/(\d+)$/);
    if (mazeMatch) {
      const dungeonId = decodeURIComponent(mazeMatch[1]);
      const stageIndex = Number(mazeMatch[2]);
      const filePath = mazeLayoutPath(dungeonId, stageIndex);
      if (req.method === 'GET') {
        if (fs.existsSync(filePath)) {
          const raw = fs.readFileSync(filePath, 'utf-8');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(raw);
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'maze_not_cached' }));
        }
        return;
      }
      if (req.method === 'PUT' || req.method === 'POST') {
        const body = await readJsonBody<{ layout?: unknown }>(req);
        if (!body?.layout) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing layout' }));
          return;
        }
        const payload = JSON.stringify(
          { dungeonId, stageIndex, layout: body.layout, savedAtMs: Date.now() },
          null,
          2
        );
        fs.writeFileSync(filePath, payload, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, path: filePath }));
        return;
      }
    }

    // 2. Get all accounts
    if (pathname === '/api/accounts' && req.method === 'GET') {
      const list = Array.from(accountsMap.values());
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(list));
      return;
    }

    // 3. Get single account by username
    if (pathname.startsWith('/api/accounts/') && req.method === 'GET') {
      const username = decodeURIComponent(pathname.replace('/api/accounts/', '')).toLowerCase();
      const acc = accountsMap.get(username);
      if (acc) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(acc));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Account not found' }));
      }
      return;
    }

    // 4. Batch sync accounts from client to server (LWW by updatedAtMs, then persist)
    // Character names are unique server-wide (enforced inside mergeAccountLists).
    if (pathname === '/api/accounts/sync' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const accountsToSync: UserAccount[] = Array.isArray(body) ? body : (body.accounts || (body.id ? [body] : []));
      const existingList = Array.from(accountsMap.values());
      const merged = mergeAccountLists(existingList, accountsToSync);
      accountsMap.clear();
      for (const acc of merged) {
        if (acc?.username) {
          accountsMap.set(acc.username.toLowerCase(), acc);
        }
      }
      saveAccountsToDisk();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, count: accountsMap.size, accounts: merged }));
      return;
    }

    // 5a. Check character name availability (all accounts + reserved AI names)
    if (pathname === '/api/characters/check-name' && req.method === 'GET') {
      const rawName = parsedUrl.searchParams.get('name') || '';
      const key = normalizeCharacterNameKey(rawName);
      if (!key) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ available: false, reason: 'empty', error: '请输入角色名称' }));
        return;
      }
      if (isReservedAiName(rawName)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ available: false, reason: 'ai' }));
        return;
      }
      let taken = false;
      for (const acc of accountsMap.values()) {
        for (const char of acc.characters || []) {
          if (normalizeCharacterNameKey(char.name) === key) {
            taken = true;
            break;
          }
        }
        if (taken) break;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ available: !taken, reason: taken ? 'taken' : undefined }));
      return;
    }

    // 5. Save Character UI Layout (战斗界面布局持久化到账号角色中)
    if (pathname === '/api/characters/layout' && req.method === 'POST') {
      const body = await readJsonBody<{ username: string; charId: string; layout: CharacterUiLayout }>(req);
      const { username, charId, layout } = body;
      if (!username || !charId || !layout) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing username, charId or layout' }));
        return;
      }
      const acc = accountsMap.get(username.toLowerCase());
      if (!acc) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Account not found' }));
        return;
      }
      const char = acc.characters.find(c => c.id === charId);
      if (!char) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Character not found' }));
        return;
      }
      char.uiLayout = {
        ...(char.uiLayout || {}),
        ...layout,
      };
      acc.updatedAtMs = Date.now();
      saveAccountsToDisk();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, uiLayout: char.uiLayout }));
      return;
    }

    // 6. User Login (password required)
    if (pathname === '/api/auth/login' && req.method === 'POST') {
      const body = await readJsonBody<{ username: string; passwordHash?: string; password?: string }>(req);
      const key = (body.username || '').trim().toLowerCase();
      const password = body.passwordHash || body.password || '';
      const acc = accountsMap.get(key);
      if (!acc) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '账号不存在' }));
        return;
      }
      if (!password || acc.passwordHash !== password) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '密码错误' }));
        return;
      }
      // Duplicate account login: kick any existing live WS session back to login
      try {
        roomHub?.kickAccountSessions(acc.username, '账号已在其他地方登录');
      } catch {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(acc));
      return;
    }

    // 7. User Register
    if (pathname === '/api/auth/register' && req.method === 'POST') {
      const body = await readJsonBody<{ username: string; passwordHash?: string; password?: string; account?: UserAccount }>(req);
      const username = (body.username || (body.account ? body.account.username : '')).trim();
      const key = username.toLowerCase();
      const password = body.passwordHash || body.password || body.account?.passwordHash || '';
      if (!key) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '请输入用户名' }));
        return;
      }
      if (!password || password.length < 4) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '密码至少 4 个字符' }));
        return;
      }
      if (accountsMap.has(key)) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '用户名已被占用' }));
        return;
      }
      const now = Date.now();
      const newAcc: UserAccount = body.account || {
        id: `acc_${now}_${Math.random().toString(36).substring(2, 7)}`,
        username,
        passwordHash: password,
        characters: [],
        createdAtIso: new Date().toISOString(),
        updatedAtMs: now,
      };
      if (!newAcc.passwordHash) newAcc.passwordHash = password;
      accountsMap.set(key, newAcc);
      saveAccountsToDisk();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(newAcc));
      return;
    }

    // 8. Delete / cancel account (注销账号)
    if (pathname === '/api/auth/delete' && req.method === 'POST') {
      const body = await readJsonBody<{ username: string; passwordHash?: string; password?: string }>(req);
      const key = (body.username || '').trim().toLowerCase();
      const password = body.passwordHash || body.password || '';
      if (!key) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '请输入用户名' }));
        return;
      }
      const acc = accountsMap.get(key);
      if (!acc) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '账号不存在' }));
        return;
      }
      if (!password || acc.passwordHash !== password) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '密码错误，无法注销' }));
        return;
      }
      accountsMap.delete(key);
      saveAccountsToDisk();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
      return;
    }

    // Default 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  } catch (err: any) {
    console.error('[Server Error]', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message || 'Internal Server Error' }));
  }
});

// Setup WebSocket Server for multiplayer rooms, presence, and host combat relay
const wss = new WebSocketServer({ server });
roomHub = new RoomWsHub();

wss.on('connection', (ws: WebSocket) => {
  roomHub.handleConnection(ws);
});

if (process.env.NODE_ENV !== 'test') {
  // Bind IPv4 explicitly so Windows clients using 127.0.0.1 (not ::1) connect reliably
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Cata Raid Sim Server] Ready on http://127.0.0.1:${PORT} (WS on ws://127.0.0.1:${PORT})`);
  });
}

export function stopServer(): Promise<void> {
  return new Promise<void>((resolve) => {
    flushAccountsToDiskNow();
    wss.close(() => {
      if (server.listening) {
        server.close(() => resolve());
      } else {
        resolve();
      }
    });
  });
}

function installAccountsPersistHooks() {
  if (process.env.NODE_ENV === 'test') return;
  const shutdown = () => {
    try {
      flushAccountsToDiskNow();
    } catch {}
  };
  process.once('exit', shutdown);
  process.once('SIGINT', () => {
    shutdown();
    process.exit(0);
  });
  process.once('SIGTERM', () => {
    shutdown();
    process.exit(0);
  });
}
installAccountsPersistHooks();

export {
  server,
  wss,
  accountsMap,
  saveAccountsToDisk,
  flushAccountsToDiskNow,
  loadAccountsFromDisk,
  roomHub,
};
