import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import type { UserAccount, CharacterUiLayout } from '@cata-raid-sim/engine';
import { mergeAccountLists } from '@cata-raid-sim/engine';
import { RoomWsHub } from './roomWs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Data storage path (persistent JSON file on server)
const DATA_DIR = path.resolve(__dirname, '../data');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
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

function saveAccountsToDisk() {
  try {
    const list = Array.from(accountsMap.values());
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(list, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Server Storage] Failed to write accounts.json', err);
  }
}

// Initial load
loadAccountsFromDisk();

const PORT = Number(process.env.PORT) || 3001;

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
      saveAccountsToDisk();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, uiLayout: char.uiLayout }));
      return;
    }

    // 6. User Login
    if (pathname === '/api/auth/login' && req.method === 'POST') {
      const body = await readJsonBody<{ username: string; passwordHash?: string }>(req);
      const key = (body.username || '').trim().toLowerCase();
      const acc = accountsMap.get(key);
      if (!acc) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Account not found' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(acc));
      return;
    }

    // 7. User Register
    if (pathname === '/api/auth/register' && req.method === 'POST') {
      const body = await readJsonBody<{ username: string; passwordHash?: string; account?: UserAccount }>(req);
      const username = (body.username || (body.account ? body.account.username : '')).trim();
      const key = username.toLowerCase();
      if (!key) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Username required' }));
        return;
      }
      if (accountsMap.has(key)) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Account already exists' }));
        return;
      }
      const newAcc: UserAccount = body.account || {
        id: `acc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        username,
        passwordHash: body.passwordHash || 'default',
        characters: [],
        createdAtIso: new Date().toISOString(),
      };
      accountsMap.set(key, newAcc);
      saveAccountsToDisk();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(newAcc));
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
const roomHub = new RoomWsHub();

wss.on('connection', (ws: WebSocket) => {
  roomHub.handleConnection(ws);
});

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => {
    console.log(`[Cata Raid Sim Server] Ready on http://localhost:${PORT} (WS on ws://localhost:${PORT})`);
  });
}

export function stopServer(): Promise<void> {
  return new Promise<void>((resolve) => {
    wss.close(() => {
      if (server.listening) {
        server.close(() => resolve());
      } else {
        resolve();
      }
    });
  });
}

export { server, wss, accountsMap, saveAccountsToDisk, loadAccountsFromDisk, roomHub };
