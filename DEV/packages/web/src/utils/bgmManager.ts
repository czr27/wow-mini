/**
 * BGM & Stinger manager with dual-channel crossfading,
 * exact Neon Abyss track assignments per game state, dungeon, and boss.
 * Uses persistent IndexedDB blob caching (matching artCache.ts) to avoid duplicate downloads.
 */
import { getSfxVolume } from './combatSfx.js';
import { getAllCachedAudioUrls, putCachedAudioEntry } from './audioCache.js';

export type BgmPhase =
  | 'AUTH_UNLOGGED'
  | 'LOBBY_OUTSIDE'
  | 'ROOM_WAITING'
  | 'LOBBY'
  | 'TRAVEL_RECOVERY'
  | 'BOSS_COMBAT'
  | 'WIPE_VOTE'
  | 'SUMMARY';

export type BgmTrackType =
  | 'AUTH_UNLOGGED'
  | 'LOBBY_OUTSIDE'
  | 'ROOM_WAITING'
  | 'DUNGEON_AMBIENT'
  | 'BOSS_STANDARD'
  | 'BOSS_FINAL_EPIC'
  | 'WIPE_STINGER'
  | 'VICTORY_SUMMARY'
  | 'NONE';

export interface ResolveBgmParams {
  phase: BgmPhase;
  dungeonId?: string;
  bossIndex?: number;
  totalBosses?: number;
  bossId?: string;
}

export interface BgmTrackInfo {
  type: BgmTrackType;
  trackKey: string;
  title: string;
  url?: string;
  loop?: boolean;
}

const STORAGE_KEY = 'cata_bgm_volume';
export const DEFAULT_BGM_VOLUME = 0.3;

const OUTSIDE_LIST = ['/audio/bgm/outside_1.ogg', '/audio/bgm/outside_2.ogg'];
const ROOM_WAIT_LIST = [
  '/audio/bgm/room_wait_1.ogg',
  '/audio/bgm/room_wait_2.ogg',
  '/audio/bgm/room_wait_3.ogg',
  '/audio/bgm/room_wait_4.ogg',
  '/audio/bgm/room_wait_5.ogg',
  '/audio/bgm/room_wait_6.ogg',
  '/audio/bgm/room_wait_7.ogg',
  '/audio/bgm/room_wait_8.ogg',
  '/audio/bgm/room_wait_9.ogg',
];
const MAZE_LIST = ['/audio/bgm/maze_1.ogg', '/audio/bgm/maze_2.ogg'];
const WIPE_THUNDER_LIST = [
  '/audio/bgm/wipe_thunder_1.ogg',
  '/audio/bgm/wipe_thunder_2.ogg',
  '/audio/bgm/wipe_thunder_3.ogg',
  '/audio/bgm/wipe_thunder_4.ogg',
];

export const BOSS_TRACK_MAP: Record<string, string> = {
  // 死亡矿井
  glubtok: '/audio/bgm/boss_dm_glubtok.ogg',
  helix: '/audio/bgm/boss_dm_helix.ogg',
  foe_reaper: '/audio/bgm/boss_dm_foereaper.ogg',
  foeReaper: '/audio/bgm/boss_dm_foereaper.ogg',
  ripsnarl: '/audio/bgm/boss_dm_ripsnarl.ogg',
  cookie: '/audio/bgm/boss_dm_cookie.ogg',
  vanessa: '/audio/bgm/boss_dm_vanessa.ogg',
  // 影牙城堡
  ashbury: '/audio/bgm/boss_sfk_ashbury.ogg',
  silverlaine: '/audio/bgm/boss_sfk_silverlaine.ogg',
  springvale: '/audio/bgm/boss_sfk_springvale.ogg',
  walden: '/audio/bgm/boss_sfk_walden.ogg',
  godfrey: '/audio/bgm/boss_sfk_godfrey.ogg',
  // 血色修道院
  vishas: '/audio/bgm/boss_sm_vishas.ogg',
  loksey: '/audio/bgm/boss_sm_loksey.ogg',
  doan: '/audio/bgm/boss_sm_doan.ogg',
  herod: '/audio/bgm/boss_sm_herod.ogg',
  mograine_whitemane: '/audio/bgm/boss_sm_mograine.ogg',
  mograineWhitemane: '/audio/bgm/boss_sm_mograine.ogg',
  thalnoren: '/audio/bgm/boss_sm_herod.ogg',
  // 斯坦索姆
  balnazzar: '/audio/bgm/boss_strat_balnazzar.ogg',
  willey: '/audio/bgm/boss_strat_willey.ogg',
  ramstein: '/audio/bgm/boss_strat_ramstein.ogg',
  rivendare: '/audio/bgm/boss_strat_rivendare.ogg',
  // 祖尔格拉布
  venoxis: '/audio/bgm/boss_zg_venoxis.ogg',
  mandokir: '/audio/bgm/boss_zg_mandokir.ogg',
  kilnara: '/audio/bgm/boss_zg_kilnara.ogg',
  zanzil: '/audio/bgm/boss_zg_zanzil.ogg',
  jindo: '/audio/bgm/boss_zg_jindo.ogg',
  // 巨龙之魂
  morchok: '/audio/bgm/boss_ds_morchok.ogg',
  zonozz: '/audio/bgm/boss_ds_zonozz.ogg',
  yorsahj: '/audio/bgm/boss_ds_yorsahj.ogg',
  hagara: '/audio/bgm/boss_ds_hagara.ogg',
  ultraxion: '/audio/bgm/boss_ds_ultraxion.ogg',
  blackhorn: '/audio/bgm/boss_ds_blackhorn.ogg',
  spine: '/audio/bgm/boss_ds_spine.ogg',
  madness: '/audio/bgm/boss_ds_madness.ogg',
};

const CLEAR_MID_BY_DUNGEON: Record<string, string> = {
  deadmines: '/audio/bgm/clear_mid_deadmines.ogg',
  shadowfang_keep: '/audio/bgm/clear_mid_sfk.ogg',
  scarlet_monastery: '/audio/bgm/clear_mid_sm.ogg',
  stratholme: '/audio/bgm/clear_mid_strat.ogg',
  zulgurub: '/audio/bgm/clear_mid_zg.ogg',
  dragon_soul: '/audio/bgm/clear_mid_ds.ogg',
};

const CLEAR_FINAL_BY_DUNGEON: Record<string, string> = {
  deadmines: '/audio/bgm/clear_final_deadmines.ogg',
  shadowfang_keep: '/audio/bgm/clear_final_sfk.ogg',
  scarlet_monastery: '/audio/bgm/clear_final_sm.ogg',
  stratholme: '/audio/bgm/clear_final_strat.ogg',
  zulgurub: '/audio/bgm/clear_final_zg.ogg',
  dragon_soul: '/audio/bgm/clear_final_ds.ogg',
};

const WIPE_BY_DUNGEON: Record<string, string> = {
  deadmines: '/audio/bgm/wipe_deadmines.ogg',
  shadowfang_keep: '/audio/bgm/wipe_sfk.ogg',
  scarlet_monastery: '/audio/bgm/wipe_sm.ogg',
  stratholme: '/audio/bgm/wipe_strat.ogg',
  zulgurub: '/audio/bgm/wipe_zg.ogg',
  dragon_soul: '/audio/bgm/wipe_ds.ogg',
};

let cachedVolume: number | null = null;
let currentTrackKey: string | null = null;

let activeChannel = 0;
const audioChannels: [HTMLAudioElement | null, HTMLAudioElement | null] = [null, null];
const fadeTimers: [ReturnType<typeof setInterval> | null, ReturnType<typeof setInterval> | null] = [null, null];

function pickRandom(list: string[]): string {
  return list[Math.floor(Math.random() * list.length)];
}

export function getBgmVolume(): number {
  if (cachedVolume !== null) return cachedVolume;
  if (typeof window === 'undefined' || !window.localStorage) {
    cachedVolume = DEFAULT_BGM_VOLUME;
    return cachedVolume;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) {
        cachedVolume = Math.max(0, Math.min(1, parsed));
        return cachedVolume;
      }
    }
  } catch {
    // ignore storage errors
  }
  cachedVolume = DEFAULT_BGM_VOLUME;
  return cachedVolume;
}

export function getEffectiveBgmGain(vol = getBgmVolume()): number {
  return Math.max(0, Math.min(1, vol * 0.5));
}

export function setBgmVolume(vol: number): number {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(vol) ? vol : DEFAULT_BGM_VOLUME));
  cachedVolume = clamped;
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(clamped));
    } catch {
      // ignore storage errors
    }
  }
  const curAudio = audioChannels[activeChannel];
  if (curAudio && !curAudio.paused) {
    curAudio.volume = getEffectiveBgmGain(clamped);
  }
  return clamped;
}

export function resolveBgmTrackInfo(params: ResolveBgmParams): BgmTrackInfo {
  if (params.phase === 'AUTH_UNLOGGED') {
    return {
      type: 'AUTH_UNLOGGED',
      trackKey: 'auth_unlogged',
      title: '账户未登录',
      url: '/audio/bgm/auth_unlogged.ogg',
      loop: true,
    };
  }

  if (params.phase === 'LOBBY_OUTSIDE' || params.phase === 'LOBBY') {
    const cachedOutside = OUTSIDE_LIST.filter((u) => preloadedUrls.has(u));
    return {
      type: 'LOBBY_OUTSIDE',
      trackKey: 'lobby_outside',
      title: '房间外大厅',
      url: pickRandom(cachedOutside.length > 0 ? cachedOutside : OUTSIDE_LIST),
      loop: true,
    };
  }

  if (params.phase === 'ROOM_WAITING') {
    const cachedRoom = ROOM_WAIT_LIST.filter((u) => preloadedUrls.has(u));
    return {
      type: 'ROOM_WAITING',
      trackKey: 'room_waiting',
      title: '房间等待',
      url: pickRandom(cachedRoom.length > 0 ? cachedRoom : ROOM_WAIT_LIST),
      loop: true,
    };
  }

  if (params.phase === 'TRAVEL_RECOVERY') {
    return {
      type: 'DUNGEON_AMBIENT',
      trackKey: `maze_${params.dungeonId || 'run'}`,
      title: '迷宫赶路',
      url: pickRandom(MAZE_LIST),
      loop: true,
    };
  }

  const isFinal =
    (typeof params.bossIndex === 'number' &&
      typeof params.totalBosses === 'number' &&
      params.totalBosses > 0 &&
      params.bossIndex >= params.totalBosses - 1) ||
    params.bossId === 'madness' ||
    params.bossId === 'godfrey' ||
    params.bossId === 'vanessa' ||
    params.bossId === 'rivendare' ||
    params.bossId === 'jindo';

  if (params.phase === 'BOSS_COMBAT') {
    const bossUrl =
      (params.bossId && BOSS_TRACK_MAP[params.bossId]) ||
      (isFinal ? '/audio/bgm/boss_ds_madness.ogg' : '/audio/bgm/boss_ds_blackhorn.ogg');
    return {
      type: isFinal ? 'BOSS_FINAL_EPIC' : 'BOSS_STANDARD',
      trackKey: `boss_${params.bossId || params.bossIndex || 0}`,
      title: isFinal ? '关底尾王决战' : '首领战斗',
      url: bossUrl,
      loop: true,
    };
  }

  if (params.phase === 'WIPE_VOTE') {
    const did = params.dungeonId || 'shadowfang_keep';
    const url = isFinal
      ? pickRandom(WIPE_THUNDER_LIST)
      : WIPE_BY_DUNGEON[did] || '/audio/bgm/wipe_sfk.ogg';
    return {
      type: 'WIPE_STINGER',
      trackKey: `wipe_${did}_${params.bossIndex ?? 0}`,
      title: isFinal ? '尾王团灭雷鸣' : '团灭音效',
      url,
      loop: false,
    };
  }

  if (params.phase === 'SUMMARY') {
    const did = params.dungeonId || 'shadowfang_keep';
    return {
      type: 'VICTORY_SUMMARY',
      trackKey: `summary_${did}`,
      title: '副本通关',
      url: CLEAR_FINAL_BY_DUNGEON[did] || '/audio/bgm/clear_final_sfk.ogg',
      loop: false,
    };
  }

  return { type: 'NONE', trackKey: 'none', title: '静音', loop: false };
}

function initChannel(idx: number): HTMLAudioElement {
  if (audioChannels[idx]) return audioChannels[idx]!;
  const audio = new Audio();
  audio.preload = 'auto';
  audioChannels[idx] = audio;
  return audio;
}

function fadeAudio(
  audio: HTMLAudioElement,
  startVol: number,
  targetVol: number,
  durMs: number,
  onComplete?: () => void
) {
  const steps = 15;
  const interval = Math.max(10, Math.floor(durMs / steps));
  let step = 0;
  const delta = (targetVol - startVol) / steps;

  const timer = setInterval(() => {
    step++;
    const nextVol = Math.max(0, Math.min(1, startVol + delta * step));
    audio.volume = nextVol;
    if (step >= steps) {
      clearInterval(timer);
      audio.volume = targetVol;
      onComplete?.();
    }
  }, interval);
  return timer;
}

export function playBgm(info: BgmTrackInfo): void {
  if (typeof window === 'undefined') return;
  if (info.trackKey === currentTrackKey) return;
  currentTrackKey = info.trackKey;

  const targetVol = getEffectiveBgmGain();

  if (info.type === 'NONE' || targetVol <= 0.001 || !info.url) {
    for (let i = 0; i < 2; i++) {
      const a = audioChannels[i];
      if (a && !a.paused) {
        if (fadeTimers[i]) clearInterval(fadeTimers[i]!);
        fadeTimers[i] = fadeAudio(a, a.volume, 0, 800, () => a.pause());
      }
    }
    return;
  }

  const nextChannel = 1 - activeChannel;
  const oldAudio = audioChannels[activeChannel];
  const newAudio = initChannel(nextChannel);

  if (fadeTimers[activeChannel]) clearInterval(fadeTimers[activeChannel]!);
  if (fadeTimers[nextChannel]) clearInterval(fadeTimers[nextChannel]!);

  if (oldAudio && !oldAudio.paused) {
    fadeTimers[activeChannel] = fadeAudio(oldAudio, oldAudio.volume, 0, 900, () => {
      oldAudio.pause();
    });
  }

  newAudio.loop = info.loop !== false;
  newAudio.volume = 0;
  const playTrackKey = info.trackKey;
  void ensureAudioCached(info.url).then((playableUrl) => {
    // Abort if phase/track already changed while fetching
    if (currentTrackKey !== playTrackKey) return;
    newAudio.src = playableUrl;
    const playPromise = newAudio.play();
    if (playPromise) {
      playPromise
        .then(() => {
          fadeTimers[nextChannel] = fadeAudio(newAudio, 0, targetVol, 900);
          activeChannel = nextChannel;
        })
        .catch(() => {
          // Autoplay blocked or missing asset: stay silent
        });
    }
  });
}

export function playOneShotAudio(url: string, volume: number): void {
  if (typeof window === 'undefined' || volume <= 0.001) return;
  void ensureAudioCached(url).then((playableUrl) => {
    const a = new Audio(playableUrl);
    a.volume = Math.max(0, Math.min(1, volume));
    a.loop = false;
    void a.play().catch(() => {});
  });
}

export function playEnterDungeonStinger(): void {
  playOneShotAudio('/audio/bgm/enter_dungeon.ogg', getEffectiveBgmGain());
}

let duckTimer: ReturnType<typeof setTimeout> | null = null;
export function duckBgmForVoice(durationMs = 1500): void {
  const curAudio = audioChannels[activeChannel];
  if (!curAudio || curAudio.paused) return;
  const fullGain = getEffectiveBgmGain();
  curAudio.volume = fullGain * 0.45;
  if (duckTimer) clearTimeout(duckTimer);
  duckTimer = setTimeout(() => {
    if (!curAudio.paused) {
      curAudio.volume = getEffectiveBgmGain();
    }
    duckTimer = null;
  }, durationMs);
}

export function playMidBossClearStinger(dungeonId?: string): void {
  const url = CLEAR_MID_BY_DUNGEON[dungeonId || 'shadowfang_keep'] || '/audio/bgm/clear_mid_sfk.ogg';
  playOneShotAudio(url, getEffectiveBgmGain());
}

let lastRaidBuffSfxAt = 0;
export function playRaidBuffSfx(): void {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (now - lastRaidBuffSfxAt < 1200) return;
  lastRaidBuffSfxAt = now;
  playOneShotAudio('/audio/bgm/sfx_raid_buff.ogg', getSfxVolume());
}

export function stopAllBgm(): void {
  currentTrackKey = null;
  for (let i = 0; i < 2; i++) {
    const a = audioChannels[i];
    if (a) {
      if (fadeTimers[i]) clearInterval(fadeTimers[i]!);
      a.pause();
      a.currentTime = 0;
    }
  }
}

// ── Idle & Dungeon-Priority Preloader ─────────────────────────
const DUNGEON_BOSS_IDS: Record<string, string[]> = {
  deadmines: ['glubtok', 'helix', 'foe_reaper', 'ripsnarl', 'cookie', 'vanessa'],
  shadowfang_keep: ['ashbury', 'silverlaine', 'springvale', 'walden', 'godfrey'],
  scarlet_monastery: ['vishas', 'loksey', 'doan', 'herod', 'mograine_whitemane'],
  stratholme: ['balnazzar', 'willey', 'ramstein', 'rivendare'],
  zulgurub: ['venoxis', 'mandokir', 'kilnara', 'zanzil', 'jindo'],
  dragon_soul: ['morchok', 'zonozz', 'yorsahj', 'hagara', 'ultraxion', 'blackhorn', 'spine', 'madness'],
};

export function getDungeonAudioUrls(dungeonId: string): string[] {
  const urls = new Set<string>();
  urls.add('/audio/bgm/enter_dungeon.ogg');
  urls.add('/audio/bgm/sfx_raid_buff.ogg');
  MAZE_LIST.forEach((u) => urls.add(u));

  const bossIds = DUNGEON_BOSS_IDS[dungeonId] || [];
  bossIds.forEach((bid) => {
    const u = BOSS_TRACK_MAP[bid];
    if (u) urls.add(u);
  });

  if (CLEAR_MID_BY_DUNGEON[dungeonId]) urls.add(CLEAR_MID_BY_DUNGEON[dungeonId]);
  if (CLEAR_FINAL_BY_DUNGEON[dungeonId]) urls.add(CLEAR_FINAL_BY_DUNGEON[dungeonId]);
  if (WIPE_BY_DUNGEON[dungeonId]) urls.add(WIPE_BY_DUNGEON[dungeonId]);
  WIPE_THUNDER_LIST.forEach((u) => urls.add(u));

  return Array.from(urls);
}

export function getAllAudioUrls(): string[] {
  const urls = new Set<string>([
    '/audio/bgm/auth_unlogged.ogg',
    ...OUTSIDE_LIST,
    ...ROOM_WAIT_LIST,
    '/audio/bgm/enter_dungeon.ogg',
    '/audio/bgm/sfx_raid_buff.ogg',
    ...MAZE_LIST,
    ...Object.values(BOSS_TRACK_MAP),
    ...Object.values(CLEAR_MID_BY_DUNGEON),
    ...Object.values(CLEAR_FINAL_BY_DUNGEON),
    ...Object.values(WIPE_BY_DUNGEON),
    ...WIPE_THUNDER_LIST,
  ]);
  return Array.from(urls);
}

const preloadQueue: string[] = [];
const preloadedUrls = new Set<string>();
const cachedBlobUrls = new Map<string, string>();
const inflightFetches = new Map<string, Promise<string>>();
let hydratePromise: Promise<void> | null = null;
let isPreloading = false;

export function hydrateAudioCache(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (hydratePromise) return hydratePromise;
  hydratePromise = getAllCachedAudioUrls()
    .then((map) => {
      for (const [url, blob] of map.entries()) {
        preloadedUrls.add(url);
        if (!cachedBlobUrls.has(url) && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
          cachedBlobUrls.set(url, URL.createObjectURL(blob));
        }
      }
    })
    .catch(() => {});
  return hydratePromise;
}

/**
 * Return a local blob URL from IndexedDB cache, or download once, persist to IndexedDB, and return it.
 * Deduplicates concurrent requests for the same URL.
 */
export async function ensureAudioCached(url: string): Promise<string> {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return url;
  await hydrateAudioCache();

  const existingBlobUrl = cachedBlobUrls.get(url);
  if (existingBlobUrl) return existingBlobUrl;

  const inflight = inflightFetches.get(url);
  if (inflight) return inflight;

  const promise = fetch(url)
    .then(async (res) => {
      if (!res.ok) return url;
      const blob = await res.blob();
      preloadedUrls.add(url);
      await putCachedAudioEntry(url, blob);
      if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
        const blobUrl = URL.createObjectURL(blob);
        cachedBlobUrls.set(url, blobUrl);
        return blobUrl;
      }
      return url;
    })
    .catch(() => url)
    .finally(() => {
      inflightFetches.delete(url);
    });

  inflightFetches.set(url, promise);
  return promise;
}

/**
 * Boot gate: ensure at least 1 room-outside track AND at least 1 room-inside track
 * are cached locally before entering the game.
 */
export async function ensureMinimumBootAudio(onProgress?: (label: string) => void): Promise<void> {
  await hydrateAudioCache();
  const hasOutside = OUTSIDE_LIST.some((u) => preloadedUrls.has(u));
  const hasRoom = ROOM_WAIT_LIST.some((u) => preloadedUrls.has(u));

  const tasks: Array<{ url: string; label: string }> = [];
  if (!hasOutside) {
    tasks.push({ url: OUTSIDE_LIST[0], label: '下载大厅背景音乐 (1/2)…' });
  }
  if (!hasRoom) {
    tasks.push({ url: ROOM_WAIT_LIST[0], label: `下载房间背景音乐 (${hasOutside ? '1/1' : '2/2'})…` });
  }

  for (const t of tasks) {
    onProgress?.(t.label);
    await ensureAudioCached(t.url);
  }
}

function scheduleIdleStep(fn: () => void) {
  if (typeof window === 'undefined') return;
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void })
    .requestIdleCallback;
  if (typeof ric === 'function') {
    ric(fn, { timeout: 1500 });
  } else {
    setTimeout(fn, 250);
  }
}

function pumpPreloadQueue() {
  if (isPreloading || typeof window === 'undefined' || typeof fetch !== 'function') return;
  const nextUrl = preloadQueue.shift();
  if (!nextUrl) return;
  if (preloadedUrls.has(nextUrl)) {
    scheduleIdleStep(pumpPreloadQueue);
    return;
  }

  isPreloading = true;
  scheduleIdleStep(() => {
    void ensureAudioCached(nextUrl).finally(() => {
      isPreloading = false;
      if (preloadQueue.length > 0) {
        pumpPreloadQueue();
      }
    });
  });
}

/**
 * Prioritize downloading all audio tracks for a specific dungeon (e.g. when inside a room).
 */
export function preloadDungeonAudio(dungeonId?: string | null): void {
  if (!dungeonId || typeof window === 'undefined') return;
  const priorityUrls = getDungeonAudioUrls(dungeonId);
  // Remove already queued priority items so we can unshift them to the very front
  for (let i = priorityUrls.length - 1; i >= 0; i--) {
    const u = priorityUrls[i];
    if (preloadedUrls.has(u)) continue;
    const existingIdx = preloadQueue.indexOf(u);
    if (existingIdx !== -1) preloadQueue.splice(existingIdx, 1);
    preloadQueue.unshift(u);
  }
  pumpPreloadQueue();
}

/**
 * Start background idle preloading for all remaining assigned audio assets.
 */
export function startIdleAudioPreload(): void {
  if (typeof window === 'undefined') return;
  for (const u of getAllAudioUrls()) {
    if (!preloadedUrls.has(u) && !preloadQueue.includes(u)) {
      preloadQueue.push(u);
    }
  }
  pumpPreloadQueue();
}
