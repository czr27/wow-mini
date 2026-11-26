import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import crypto from 'crypto';
import fs from 'fs';
import type { IncomingMessage } from 'http';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';

function readJsonBody<T = any>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 5 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function artResourcesPlugin(): Plugin {
  const artDir = path.resolve(__dirname, 'ART');
  const artResourcesDir = path.resolve(artDir, 'resources');

  const getArtFiles = (): string[] => {
    try {
      if (fs.existsSync(artResourcesDir)) {
        return fs.readdirSync(artResourcesDir).filter((file) => {
          if (file.startsWith('.') || file === 'manifest.json') return false;
          const fullPath = path.join(artResourcesDir, file);
          return fs.statSync(fullPath).isFile();
        });
      }
    } catch (e) {
      console.warn('[artResourcesPlugin] Error reading ART/resources:', e);
    }
    return [];
  };

  const getArtManifest = () => {
    const files = getArtFiles();
    const hashes: Record<string, string> = {};
    for (const file of files) {
      try {
        const buf = fs.readFileSync(path.join(artResourcesDir, file));
        hashes[file] = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);
      } catch {
        // skip unreadable file
      }
    }
    return { files, hashes, updatedAt: Date.now() };
  };

  const syncManifest = (targetDir: string) => {
    try {
      const manifest = getArtManifest();
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      const manifestPath = path.join(targetDir, 'manifest.json');
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
    } catch (e) {
      console.warn('[artResourcesPlugin] Error syncing manifest:', e);
    }
  };

  return {
    name: 'art-resources-plugin',
    configureServer(server) {
      syncManifest(artResourcesDir);

      server.middlewares.use('/api/art-resources', (_req, res) => {
        const manifest = getArtManifest();
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(JSON.stringify(manifest));
      });

      server.middlewares.use('/ART', (req, res, next) => {
        const decodedUrl = decodeURIComponent(req.url || '');
        const [rawPath, queryStr] = decodedUrl.replace(/^\//, '').split('?');
        const filePath = path.resolve(artDir, rawPath);
        if (!filePath.startsWith(artDir)) {
          res.statusCode = 403;
          res.end('Forbidden');
          return;
        }
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          const ext = path.extname(filePath).toLowerCase();
          const mimeTypes: Record<string, string> = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.webp': 'image/webp',
            '.svg': 'image/svg+xml',
            '.gif': 'image/gif',
            '.json': 'application/json',
          };
          res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
          const hasVersionQuery = Boolean(queryStr && /(?:^|&)h=/.test(queryStr));
          if (hasVersionQuery && ext !== '.json') {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          } else {
            res.setHeader('Cache-Control', 'no-cache');
          }
          fs.createReadStream(filePath).pipe(res);
          return;
        }
        next();
      });
    },
    closeBundle(error?: Error) {
      if (error) return;
      try {
        const distArtResourcesDir = path.resolve(__dirname, 'dist/ART/resources');
        if (fs.existsSync(artResourcesDir)) {
          fs.mkdirSync(distArtResourcesDir, { recursive: true });
          fs.cpSync(artResourcesDir, distArtResourcesDir, { recursive: true });
          syncManifest(distArtResourcesDir);
        }
      } catch (err) {
        console.warn('[artResourcesPlugin] Failed to copy ART resources to dist:', err);
      }
    },
  };
}

function accountApiPlugin(): Plugin {
  const dataDir = path.resolve(__dirname, 'DEV/packages/server/data');
  const accountsFile = path.join(dataDir, 'accounts.json');
  const accountsMap = new Map<string, any>();

  const loadAccounts = () => {
    try {
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      if (fs.existsSync(accountsFile)) {
        const content = fs.readFileSync(accountsFile, 'utf-8');
        if (content.trim()) {
          const list = JSON.parse(content);
          accountsMap.clear();
          for (const acc of list) {
            if (acc?.username) {
              accountsMap.set(acc.username.toLowerCase(), acc);
            }
          }
        }
      }
    } catch (err) {
      console.warn('[accountApiPlugin] Failed to load accounts.json:', err);
    }
  };

  const saveAccounts = () => {
    try {
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      fs.writeFileSync(
        accountsFile,
        JSON.stringify(Array.from(accountsMap.values()), null, 2),
        'utf-8'
      );
    } catch (err) {
      console.error('[accountApiPlugin] Failed to save accounts.json:', err);
    }
  };

  return {
    name: 'account-api-plugin',
    configureServer(server) {
      loadAccounts();

      server.middlewares.use(async (req, res, next) => {
        const urlStr = req.url || '/';
        if (!urlStr.startsWith('/api/')) {
          return next();
        }
        const pathname = new URL(urlStr, 'http://localhost').pathname;
        if (pathname === '/api/art-resources') {
          return next();
        }

        try {
          if (pathname === '/api/health' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', time: Date.now(), accountsCount: accountsMap.size }));
            return;
          }

          if (pathname === '/api/accounts' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(Array.from(accountsMap.values())));
            return;
          }

          if (pathname === '/api/accounts/sync' && req.method === 'POST') {
            const body = await readJsonBody(req);
            const list = Array.isArray(body) ? body : body.accounts || (body.id ? [body] : []);
            for (const acc of list) {
              if (acc?.username) {
                const key = acc.username.toLowerCase();
                const existing = accountsMap.get(key);
                accountsMap.set(key, existing ? { ...existing, ...acc } : acc);
              }
            }
            saveAccounts();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, count: accountsMap.size }));
            return;
          }

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

          if (pathname === '/api/characters/layout' && req.method === 'POST') {
            const { username, charId, layout } = await readJsonBody(req);
            if (!username || !charId || !layout) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Missing username, charId or layout' }));
              return;
            }
            const acc = accountsMap.get(username.toLowerCase());
            const char = acc?.characters?.find((c: any) => c.id === charId);
            if (!acc || !char) {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Account or character not found' }));
              return;
            }
            char.uiLayout = { ...(char.uiLayout || {}), ...layout };
            saveAccounts();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, uiLayout: char.uiLayout }));
            return;
          }

          if (pathname === '/api/auth/login' && req.method === 'POST') {
            const body = await readJsonBody(req);
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

          if (pathname === '/api/auth/register' && req.method === 'POST') {
            const body = await readJsonBody(req);
            const username = (body.username || body.account?.username || '').trim();
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
            const newAcc = body.account || {
              id: `acc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
              username,
              passwordHash: body.passwordHash || 'default',
              characters: [],
              createdAtIso: new Date().toISOString(),
            };
            accountsMap.set(key, newAcc);
            saveAccounts();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(newAcc));
            return;
          }

          return next();
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err?.message || 'Internal Server Error' }));
        }
      });
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      artResourcesPlugin(),
      accountApiPlugin(),
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds. Do not remove.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(__dirname, 'dist');
          const srcAssets = path.resolve(__dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, { recursive: true, force: true });
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        '@cata-raid-sim/engine': path.resolve(__dirname, 'DEV/packages/engine/src/index.ts'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
