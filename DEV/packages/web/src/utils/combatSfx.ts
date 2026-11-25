/**
 * Web Audio API combat & casting SFX synthesizer with 2D distance attenuation,
 * stereo panning, and unit-priority weighting (self & boss prominent, other players attenuated).
 */

export type SfxActorRole = 'self' | 'boss' | 'other';
export type SfxSchool = 'physical' | 'fire' | 'frost' | 'shadow' | 'holy' | 'nature' | 'arcane';
export type SfxEventKind = 'melee' | 'cast_start' | 'spell_hit' | 'heal' | 'boss_cast';

export interface SfxPosition {
  x: number;
  y: number;
}

export interface PlayCombatSfxParams {
  kind: SfxEventKind;
  school?: SfxSchool;
  role: SfxActorRole;
  actorPos?: SfxPosition | null;
  listenerPos?: SfxPosition | null;
  actorId?: string;
}

const STORAGE_KEY = 'cata_sfx_volume';
export const DEFAULT_SFX_VOLUME = 0.3; // 30% default

// 8px = 1 yard in canvas space
const FULL_VOL_DIST_PX = 80; // <= 10 yards: 100%
const MAX_HEAR_DIST_PX = 560; // >= 70 yards: silent

const ROLE_WEIGHT: Record<SfxActorRole, number> = {
  self: 1.0,
  boss: 0.95,
  other: 0.28,
};

let cachedVolume: number | null = null;
let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let activeVoices = 0;
const MAX_ACTIVE_VOICES = 10;
const lastActorSfxAt = new Map<string, number>();

export function getSfxVolume(): number {
  if (cachedVolume !== null) return cachedVolume;
  if (typeof window === 'undefined' || !window.localStorage) {
    cachedVolume = DEFAULT_SFX_VOLUME;
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
  cachedVolume = DEFAULT_SFX_VOLUME;
  return cachedVolume;
}

export function setSfxVolume(vol: number): number {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(vol) ? vol : DEFAULT_SFX_VOLUME));
  cachedVolume = clamped;
  if (masterGain && audioCtx) {
    masterGain.gain.setTargetAtTime(clamped, audioCtx.currentTime, 0.02);
  }
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(clamped));
    } catch {
      // ignore storage errors
    }
  }
  return clamped;
}

/**
 * Compute distance attenuation factor in [0, 1].
 * <= 80px (10yd) -> 1.0; >= 560px (70yd) -> 0.
 */
export function computeDistanceAttenuation(
  actorPos?: SfxPosition | null,
  listenerPos?: SfxPosition | null
): number {
  if (!actorPos || !listenerPos) return 1.0;
  const dist = Math.hypot(actorPos.x - listenerPos.x, actorPos.y - listenerPos.y);
  if (dist <= FULL_VOL_DIST_PX) return 1.0;
  if (dist >= MAX_HEAR_DIST_PX) return 0;
  const t = (dist - FULL_VOL_DIST_PX) / (MAX_HEAR_DIST_PX - FULL_VOL_DIST_PX);
  // Quadratic falloff feels natural for 2D raid arenas
  return Math.max(0.05, (1 - t) * (1 - t));
}

export function computeStereoPan(
  actorPos?: SfxPosition | null,
  listenerPos?: SfxPosition | null
): number {
  if (!actorPos || !listenerPos) return 0;
  const dx = actorPos.x - listenerPos.x;
  return Math.max(-0.75, Math.min(0.75, dx / 300));
}

export function computeEffectiveGain(
  role: SfxActorRole,
  masterVol: number,
  actorPos?: SfxPosition | null,
  listenerPos?: SfxPosition | null
): number {
  if (masterVol <= 0.001) return 0;
  const distFactor = role === 'self' ? 1.0 : computeDistanceAttenuation(actorPos, listenerPos);
  if (distFactor <= 0.001) return 0;
  // 2x gain boost so default 30% feels punchy and audible
  return Math.min(1.0, masterVol * 2.0 * ROLE_WEIGHT[role] * distFactor);
}

export function inferSpellSchool(spellId?: string, spellName?: string): SfxSchool {
  const s = `${spellId ?? ''} ${spellName ?? ''}`.toLowerCase();
  if (/fire|pyro|flame|burn|lava|incinerate|immolate|ignite|火|炎|烧|爆/.test(s)) return 'fire';
  if (/frost|ice|blizzard|chill|frozen|冰|霜|寒/.test(s)) return 'frost';
  if (/shadow|death|chaos|curse|drain|soul|dark|plague|void|暗|影|死|痛|腐/.test(s)) return 'shadow';
  if (/holy|light|heal|flash|prayer|renew|smite|divine|圣|光|愈|祷|惩/.test(s)) return 'holy';
  if (/nature|wrath|rejuv|regrowth|wild|lightning|thunder|earth|自然|雷|电|风|愈合|回春/.test(s)) return 'nature';
  if (/arcane|missile|blast|barrage|time|奥|法|秘/.test(s)) return 'arcane';
  return 'physical';
}

function ensureAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) {
    audioCtx = new Ctx();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = getSfxVolume();
    masterGain.connect(audioCtx.destination);
  }
  if (audioCtx.state === 'suspended') {
    void audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function createNoiseBuffer(ctx: AudioContext, durationSec: number): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

function connectWithPan(ctx: AudioContext, node: AudioNode, pan: number): void {
  if (!masterGain) return;
  if (typeof ctx.createStereoPanner === 'function' && Math.abs(pan) > 0.02) {
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    node.connect(panner);
    panner.connect(masterGain);
  } else {
    node.connect(masterGain);
  }
}

export function playCombatSfx(params: PlayCombatSfxParams): void {
  const masterVol = getSfxVolume();
  const gainVal = computeEffectiveGain(params.role, masterVol, params.actorPos, params.listenerPos);
  if (gainVal <= 0.005) return;

  // Throttle per-actor spam (especially melee/other players in 20-man)
  const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const actorKey = `${params.actorId ?? params.role}:${params.kind}`;
  const minGapMs = params.role === 'other' ? 140 : 65;
  const lastAt = lastActorSfxAt.get(actorKey) ?? 0;
  if (nowMs - lastAt < minGapMs) return;
  lastActorSfxAt.set(actorKey, nowMs);

  if (activeVoices >= MAX_ACTIVE_VOICES) return;

  const ctx = ensureAudioContext();
  if (!ctx || !masterGain) return;

  const pan = params.role === 'self' ? 0 : computeStereoPan(params.actorPos, params.listenerPos);
  const school = params.school ?? 'physical';
  const t = ctx.currentTime;

  activeVoices += 1;
  const releaseVoice = (durSec: number) => {
    setTimeout(() => {
      activeVoices = Math.max(0, activeVoices - 1);
    }, Math.ceil(durSec * 1000) + 30);
  };

  if (params.kind === 'melee') {
    const isBoss = params.role === 'boss';
    const dur = isBoss ? 0.19 : 0.12;
    releaseVoice(dur);

    // Body thud
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = isBoss ? 'sawtooth' : 'triangle';
    osc.frequency.setValueAtTime(isBoss ? 125 : 190, t);
    osc.frequency.exponentialRampToValueAtTime(isBoss ? 38 : 55, t + dur);
    g.gain.setValueAtTime(gainVal * (isBoss ? 0.45 : 0.32), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g);
    connectWithPan(ctx, g, pan);
    osc.start(t);
    osc.stop(t + dur);

    // Blade / impact transient
    const noise = ctx.createBufferSource();
    noise.buffer = createNoiseBuffer(ctx, 0.07);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = isBoss ? 900 : 1800;
    filter.Q.value = 1.4;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(gainVal * 0.22, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.065);
    noise.connect(filter);
    filter.connect(ng);
    connectWithPan(ctx, ng, pan);
    noise.start(t);
    noise.stop(t + 0.07);
    return;
  }

  if (params.kind === 'boss_cast' || params.kind === 'cast_start') {
    const isBoss = params.kind === 'boss_cast' || params.role === 'boss';
    const dur = isBoss ? 0.42 : 0.26;
    releaseVoice(dur);

    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    if (isBoss || school === 'shadow') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(110, t);
      osc.frequency.exponentialRampToValueAtTime(165, t + dur);
    } else if (school === 'holy' || school === 'nature') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, t);
      osc.frequency.exponentialRampToValueAtTime(660, t + dur);
    } else if (school === 'frost' || school === 'arcane') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(520, t);
      osc.frequency.exponentialRampToValueAtTime(880, t + dur);
    } else {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, t);
      osc.frequency.exponentialRampToValueAtTime(340, t + dur);
    }

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(isBoss ? 650 : 1400, t);
    filter.frequency.exponentialRampToValueAtTime(isBoss ? 1300 : 2400, t + dur);

    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(gainVal * (isBoss ? 0.34 : 0.22), t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);

    osc.connect(filter);
    filter.connect(g);
    connectWithPan(ctx, g, pan);
    osc.start(t);
    osc.stop(t + dur);
    return;
  }

  if (params.kind === 'heal') {
    const dur = 0.28;
    releaseVoice(dur);

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const g = ctx.createGain();
    osc1.type = 'sine';
    osc2.type = 'sine';
    osc1.frequency.setValueAtTime(523.25, t); // C5
    osc2.frequency.setValueAtTime(659.25, t); // E5
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(gainVal * 0.2, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);

    osc1.connect(g);
    osc2.connect(g);
    connectWithPan(ctx, g, pan);
    osc1.start(t);
    osc2.start(t);
    osc1.stop(t + dur);
    osc2.stop(t + dur);
    return;
  }

  // spell_hit
  const dur = 0.18;
  releaseVoice(dur);
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  if (school === 'fire') {
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(50, t + dur);
  } else if (school === 'frost') {
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(980, t);
    osc.frequency.exponentialRampToValueAtTime(320, t + dur);
  } else if (school === 'shadow') {
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + dur);
  } else if (school === 'arcane' || school === 'nature') {
    osc.type = 'square';
    osc.frequency.setValueAtTime(420, t);
    osc.frequency.exponentialRampToValueAtTime(140, t + dur);
  } else {
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(240, t);
    osc.frequency.exponentialRampToValueAtTime(80, t + dur);
  }
  g.gain.setValueAtTime(gainVal * 0.28, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g);
  connectWithPan(ctx, g, pan);
  osc.start(t);
  osc.stop(t + dur);
}
