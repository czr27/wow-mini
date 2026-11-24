/**
 * Guest cast bar is local wall-clock — not driven by host cast timelines.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  classifySpellCastMode,
  getHastedCastTimeMs,
  getSpellByAnyId,
  LEVEL_80_MAX_HASTE,
} from '@cata-raid-sim/engine';
import { advanceLocalPlayerCast, type PlayerCastState } from '../../components/ActionBar.js';

describe('guestLocalCastBar', () => {
  it('advanceLocalPlayerCast 用 startedAtMs 平滑推进，结束返回 null', () => {
    const t0 = 1_000_000;
    const cast: PlayerCastState = {
      spellId: 'healing_wave',
      spellName: '治疗波',
      totalMs: 2000,
      elapsedMs: 0,
      progress: 0,
      startedAtMs: t0,
    };
    const mid = advanceLocalPlayerCast(cast, t0 + 500);
    assert.ok(mid);
    assert.equal(mid!.elapsedMs, 500);
    assert.ok(Math.abs(mid!.progress - 0.25) < 1e-6);
    assert.equal(advanceLocalPlayerCast(cast, t0 + 2000), null);
    assert.equal(advanceLocalPlayerCast(cast, t0 + 2500), null);
  });

  it('客人读条：治疗波识别为 CASTED，可用 ESM getHastedCastTimeMs 建本地条', () => {
    const norm = getSpellByAnyId('healing_wave', 'SHAMAN') || getSpellByAnyId('healing_wave');
    assert.ok(norm);
    const mode = classifySpellCastMode({
      spellId: 'healing_wave',
      castTimeMs: norm!.castTimeMs,
      channelDurationMs: norm!.channelDurationMs,
    });
    assert.equal(mode, 'CASTED');
    const totalMs = getHastedCastTimeMs(Math.max(1, norm!.castTimeMs), LEVEL_80_MAX_HASTE);
    assert.ok(totalMs > 0 && totalMs <= norm!.castTimeMs);
    const t0 = Date.now();
    const bar: PlayerCastState = {
      spellId: 'healing_wave',
      spellName: '治疗波',
      totalMs,
      elapsedMs: 0,
      progress: 0,
      startedAtMs: t0,
      isChannel: false,
    };
    const mid = advanceLocalPlayerCast(bar, t0 + Math.floor(totalMs / 2));
    assert.ok(mid);
    assert.ok((mid!.progress ?? 0) > 0.4 && (mid!.progress ?? 0) < 0.6);
  });

  it('handlePlayerCastSlot 不得再用 require() 拉 getHastedCastTimeMs（浏览器无 require）', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, '../handlePlayerCastSlot.ts'), 'utf8');
    assert.equal(
      /require\(['"]@cata-raid-sim\/engine['"]\)/.test(src),
      false,
      '客人读条路径禁止 CommonJS require'
    );
    assert.match(src, /getHastedCastTimeMs/);
  });
});
