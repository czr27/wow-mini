/**
 * Derive game API / WebSocket URLs from the browser's current access link.
 * Works for localhost, LAN IP, and WAN hostname — always reuse that host.
 *
 * Port rules:
 * - Page on Vite/dev ports 3000 / 5173 → game server on same host, port 3001
 * - Page on default 80/443 (empty port) → same-origin (reverse proxy)
 * - Page on any other port → game server on same host, port = pagePort + 1
 *   (e.g. http://192.168.1.8:8080 → http://192.168.1.8:8081)
 *
 * Overrides (highest priority):
 * - window.__CATA_API_BASE__ / window.__CATA_WS_URL__
 * - ?apiBase= / ?wsUrl= query params
 * - ?apiPort=1234 → same host, that port
 */

const DEV_PAGE_PORTS = new Set(['3000', '5173']);
const DEFAULT_GAME_PORT = 3001;

function pageLocation(): { protocol: string; hostname: string; port: string; search: string } {
  if (typeof window === 'undefined') {
    return { protocol: 'http:', hostname: '127.0.0.1', port: '3000', search: '' };
  }
  return {
    protocol: window.location.protocol,
    hostname: window.location.hostname,
    port: window.location.port,
    search: window.location.search || '',
  };
}

/** Keep hostname as the user typed it (LAN IP / domain). Only normalize bare "localhost". */
function resolveHost(hostname: string): string {
  if (hostname === 'localhost') return '127.0.0.1';
  return hostname || '127.0.0.1';
}

function readQueryParam(search: string, key: string): string | null {
  try {
    const v = new URLSearchParams(search).get(key);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

/** Which TCP port the game HTTP/WS server should use, given the page port. */
export function resolveGameServerPort(pagePort: string): number | 'same-origin' {
  if (!pagePort) return 'same-origin'; // 80 / 443 behind reverse proxy
  if (DEV_PAGE_PORTS.has(pagePort)) return DEFAULT_GAME_PORT;
  const n = Number(pagePort);
  if (Number.isFinite(n) && n > 0) {
    // Custom publish port → game server conventionally on +1
    return Math.min(n + 1, 65535);
  }
  return DEFAULT_GAME_PORT;
}

function buildHttpBase(protocol: string, host: string, gamePort: number | 'same-origin'): string {
  if (gamePort === 'same-origin') return '';
  return `${protocol}//${host}:${gamePort}`;
}

function buildWsUrl(protocol: string, host: string, pagePort: string, gamePort: number | 'same-origin'): string {
  const wsProto = protocol === 'https:' ? 'wss:' : 'ws:';
  if (gamePort === 'same-origin') {
    return `${wsProto}//${host}${pagePort ? `:${pagePort}` : ''}`;
  }
  return `${wsProto}//${host}:${gamePort}`;
}

export function resolveGameApiBaseUrl(): string {
  const loc = pageLocation();
  if (typeof window !== 'undefined') {
    const override = (window as unknown as { __CATA_API_BASE__?: string }).__CATA_API_BASE__;
    if (typeof override === 'string' && override.trim()) {
      return override.replace(/\/$/, '');
    }
  }

  const qBase = readQueryParam(loc.search, 'apiBase');
  if (qBase) return qBase.replace(/\/$/, '');

  const host = resolveHost(loc.hostname);
  const qPort = readQueryParam(loc.search, 'apiPort');
  if (qPort && /^\d+$/.test(qPort)) {
    return buildHttpBase(loc.protocol, host, Number(qPort));
  }

  const gamePort = resolveGameServerPort(loc.port);
  return buildHttpBase(loc.protocol, host, gamePort);
}

export function resolveGameWsUrl(): string {
  const loc = pageLocation();
  if (typeof window !== 'undefined') {
    const override = (window as unknown as { __CATA_WS_URL__?: string }).__CATA_WS_URL__;
    if (typeof override === 'string' && override.trim()) return override.trim();
  }

  const qWs = readQueryParam(loc.search, 'wsUrl');
  if (qWs) return qWs;

  const host = resolveHost(loc.hostname);
  const qPort = readQueryParam(loc.search, 'apiPort');
  if (qPort && /^\d+$/.test(qPort)) {
    return buildWsUrl(loc.protocol, host, loc.port, Number(qPort));
  }

  const gamePort = resolveGameServerPort(loc.port);
  return buildWsUrl(loc.protocol, host, loc.port, gamePort);
}
