import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

function artResourcesPlugin(): Plugin {
  const artDir = path.resolve(__dirname, '../../../ART');
  const artResourcesDir = path.resolve(artDir, 'resources');

  const getArtFiles = (): string[] => {
    try {
      if (fs.existsSync(artResourcesDir)) {
        return fs.readdirSync(artResourcesDir).filter((file) => {
          if (file.startsWith('.')) return false;
          const fullPath = path.join(artResourcesDir, file);
          return fs.statSync(fullPath).isFile();
        });
      }
    } catch (e) {
      console.warn('[artResourcesPlugin] Error reading ART/resources:', e);
    }
    return [];
  };

  const syncManifest = (targetDir: string) => {
    try {
      const files = getArtFiles();
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      const manifestPath = path.join(targetDir, 'manifest.json');
      fs.writeFileSync(manifestPath, JSON.stringify({ files, updatedAt: Date.now() }, null, 2), 'utf-8');
    } catch (e) {
      console.warn('[artResourcesPlugin] Error syncing manifest:', e);
    }
  };

  return {
    name: 'art-resources-plugin',
    configureServer(server) {
      // Sync manifest at dev server startup
      syncManifest(artResourcesDir);

      // Watch ART/resources directory for additions / modifications
      server.watcher.add(artResourcesDir);
      server.watcher.on('all', (event, filePath) => {
        if (filePath.startsWith(artResourcesDir)) {
          syncManifest(artResourcesDir);
          server.ws.send({
            type: 'custom',
            event: 'art-resources-changed',
            data: { files: getArtFiles() },
          });
        }
      });

      // API endpoint: /api/art-resources returns the list of files in ART/resources
      server.middlewares.use('/api/art-resources', (req, res) => {
        const files = getArtFiles();
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(JSON.stringify({ files }));
      });

      // Static file server: /ART/* directly serves files from the ART/ directory
      server.middlewares.use('/ART', (req, res, next) => {
        const decodedUrl = decodeURIComponent(req.url || '');
        const relPath = decodedUrl.replace(/^\//, '').split('?')[0];
        const filePath = path.resolve(artDir, relPath);

        // Security check: restrict access to within artDir
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
          res.setHeader('Cache-Control', 'no-cache');
          fs.createReadStream(filePath).pipe(res);
          return;
        }
        next();
      });
    },

    // In build mode, copy ART/resources to dist/ART/resources and generate manifest
    closeBundle() {
      try {
        const distArtDir = path.resolve(__dirname, 'dist/ART');
        const distArtResourcesDir = path.resolve(distArtDir, 'resources');
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

export default defineConfig({
  plugins: [react(), artResourcesPlugin()],
  optimizeDeps: {
    exclude: ['@cata-raid-sim/engine'],
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
    fs: {
      allow: [
        path.resolve(__dirname, '../../..'), // allow root wow_simu workspace
      ],
    },
    proxy: {
      // Proxy fallback on the Vite host machine; browser clients use resolveGameApiBaseUrl (same host as page)
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        timeout: 8000,
        proxyTimeout: 8000,
      },
      '/ws-proxy': {
        target: 'ws://127.0.0.1:3001',
        ws: true,
        rewrite: () => '/',
        timeout: 8000,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
