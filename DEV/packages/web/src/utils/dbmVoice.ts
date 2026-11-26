import { duckBgmForVoice } from './bgmManager.js';

const STORAGE_KEY = 'cata_dbm_voice_volume';
export const DEFAULT_DBM_VOICE_VOLUME = 0.9;
const VOICE_DEDUPE_MS = 7000;

let cachedDbmVolume: number | null = null;
const spokenAtByPhrase = new Map<string, number>();
let lastDbmVoiceAtMs = 0;

export function getDbmVoiceVolume(): number {
  if (cachedDbmVolume !== null) return cachedDbmVolume;
  if (typeof window === 'undefined') {
    cachedDbmVolume = DEFAULT_DBM_VOICE_VOLUME;
    return cachedDbmVolume;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) {
        cachedDbmVolume = Math.max(0, Math.min(1, parsed));
        return cachedDbmVolume;
      }
    }
  } catch {
    // ignore storage errors
  }
  cachedDbmVolume = DEFAULT_DBM_VOICE_VOLUME;
  return cachedDbmVolume;
}

export function setDbmVoiceVolume(vol: number): number {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(vol) ? vol : DEFAULT_DBM_VOICE_VOLUME));
  cachedDbmVolume = clamped;
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, String(clamped));
    }
  } catch {
    // ignore storage errors
  }
  return clamped;
}

/**
 * 使用浏览器 Web Speech API 播报 4 字左右 DBM 短语音。
 * 自动打断上一条未播完的语音并做短窗去重，避免高并发时语音排队滞后。
 * 音量独立于游戏战斗音效（cata_sfx_volume）。
 */
export function speakDbmVoice(
  text: string | undefined | null,
  opts?: { force?: boolean; volume?: number }
): void {
  const phrase = (text || '').trim();
  if (!phrase) return;
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

  const vol = opts?.volume !== undefined
    ? Math.max(0, Math.min(1, opts.volume))
    : getDbmVoiceVolume();
  if (vol <= 0) return;

  const now = Date.now();
  const lastAt = spokenAtByPhrase.get(phrase);
  if (!opts?.force && lastAt !== undefined && now - lastAt < VOICE_DEDUPE_MS) {
    return;
  }
  spokenAtByPhrase.set(phrase, now);

  try {
    const synth = window.speechSynthesis;
    synth.cancel();
    lastDbmVoiceAtMs = now;
    const utter = new SpeechSynthesisUtterance(phrase);
    utter.lang = 'zh-CN';
    utter.rate = 1.99;
    // Double DBM voice gain (clamped to Web Speech API max 1.0) and duck BGM briefly
    utter.volume = Math.min(1, vol * 2.0);
    duckBgmForVoice(1500);
    synth.speak(utter);
  } catch {
    // 浏览器禁用或无语音引擎时静默忽略
  }
}

export interface EvilOldManVoicePreset {
  id: string;
  label: string;
  pitch: number;
  rate: number;
}

/**
 * 多个“邪恶老男人”音色预设：低沉音调 + 阴冷/狂傲/沙哑语速变化。
 */
export const EVIL_OLD_MAN_VOICE_PRESETS: readonly EvilOldManVoicePreset[] = [
  { id: 'dark_warlock', label: '阴沉老巫师', pitch: 0.42, rate: 0.84 },
  { id: 'raspy_undead', label: '沙哑老亡灵', pitch: 0.48, rate: 0.78 },
  { id: 'arrogant_warlord', label: '狂傲老领主', pitch: 0.56, rate: 0.96 },
  { id: 'sinister_cultist', label: '阴险老教主', pitch: 0.62, rate: 0.88 },
  { id: 'cackling_madman', label: '癫狂老怪', pitch: 0.46, rate: 1.05 },
];

const MALE_VOICE_KEYWORDS = [
  'kangkang',
  'yunxi',
  'yunjian',
  'yunyang',
  'yunfeng',
  'yunhao',
  'yunze',
  'male',
  '男',
];

function pickEvilOldManVoice(
  voices: SpeechSynthesisVoice[],
  presetIndex: number
): SpeechSynthesisVoice | null {
  if (!voices || voices.length === 0) return null;
  const zhVoices = voices.filter((v) =>
    (v.lang || '').toLowerCase().startsWith('zh')
  );
  const pool = zhVoices.length > 0 ? zhVoices : voices;
  const malePool = pool.filter((v) => {
    const name = (v.name || '').toLowerCase();
    return MALE_VOICE_KEYWORDS.some((kw) => name.includes(kw));
  });
  const candidates = malePool.length > 0 ? malePool : pool;
  return candidates[presetIndex % candidates.length] || null;
}

function normalizeBossVoiceKey(key: string): string {
  return key.replace(/^(boss_)+/, '').replace(/_\d+$/, '').trim() || key;
}

function hashBossKey(key: string): number {
  const norm = normalizeBossVoiceKey(key);
  let h = 0;
  for (let i = 0; i < norm.length; i++) {
    h = (h * 31 + norm.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

const TRASH_TALK_DEDUPE_MS = 5000;
const DBM_ACTIVE_WINDOW_MS = 2200;

/**
 * 为每个 Boss 分配固定的邪恶老男人音色喊出垃圾话。
 * 当 DBM 正在报警时，自动压低 Boss 喊话音量（轻声喊出，不打断 DBM）。
 */
export function speakBossTrashTalkVoice(
  text: string | undefined | null,
  bossKey?: string | null,
  opts?: { force?: boolean; volume?: number }
): void {
  const phrase = (text || '').replace(/^🗣️\s*[「「]?|[」」]$/g, '').trim();
  if (!phrase) return;
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

  const vol =
    opts?.volume !== undefined
      ? Math.max(0, Math.min(1, opts.volume))
      : getDbmVoiceVolume();
  if (vol <= 0) return;

  const now = Date.now();
  const dedupeKey = `tt:${phrase}`;
  const lastAt = spokenAtByPhrase.get(dedupeKey);
  if (!opts?.force && lastAt !== undefined && now - lastAt < TRASH_TALK_DEDUPE_MS) {
    return;
  }

  try {
    const synth = window.speechSynthesis;
    spokenAtByPhrase.set(dedupeKey, now);

    // 固定按 Boss ID 分配同一音色预设与系统声音
    const idx = bossKey ? hashBossKey(bossKey) : 0;
    const preset =
      EVIL_OLD_MAN_VOICE_PRESETS[idx % EVIL_OLD_MAN_VOICE_PRESETS.length];

    const isDbmAlerting =
      synth.speaking || now - lastDbmVoiceAtMs < DBM_ACTIVE_WINDOW_MS;
    const bossVolume = isDbmAlerting
      ? Math.min(0.35, vol * 0.35)
      : Math.min(1, vol * 1.15);

    const utter = new SpeechSynthesisUtterance(phrase);
    utter.lang = 'zh-CN';
    utter.pitch = preset.pitch;
    utter.rate = preset.rate;
    utter.volume = bossVolume;

    const voice = pickEvilOldManVoice(synth.getVoices(), idx);
    if (voice) utter.voice = voice;

    duckBgmForVoice(isDbmAlerting ? 1500 : 2200);
    synth.speak(utter);
  } catch {
    // 浏览器禁用或无语音引擎时静默忽略
  }
}
