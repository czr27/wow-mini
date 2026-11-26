import { duckBgmForVoice } from './bgmManager.js';

const STORAGE_KEY = 'cata_dbm_voice_volume';
export const DEFAULT_DBM_VOICE_VOLUME = 0.9;
const VOICE_DEDUPE_MS = 7000;

let cachedDbmVolume: number | null = null;
const spokenAtByPhrase = new Map<string, number>();

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
