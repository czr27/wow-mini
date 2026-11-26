import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  HUMAN_BOSS_TARGET_WEIGHT,
  pickWeightedBossTarget,
  pickWeightedBossTargets,
} from '../index.js';
import type { Unit } from '../types.js';

function mkUnit(id: string, opts: Partial<Unit> = {}): Unit {
  return {
    id,
    name: id,
    classId: 'WARRIOR',
    role: 'DPS',
    isPlayer: false,
    isHumanControlled: false,
    isAlive: true,
    alive: true,
    hp: 50_000,
    maxHp: 50_000,
    absorb: 0,
    buffs: [],
    threatTable: [],
    resources: [],
    stats: {
      attackPower: 2000,
      spellPower: 0,
      critChance: 0.1,
      haste: 0,
      armor: 1000,
    },
    position: { x: 200, y: 200 },
    ...opts,
  };
}

describe('BossTargetPicker 60/40 玩家/AI 加权点名', () => {
  it('1. 1 玩家 + 19 AI 池子：玩家总命中率约 60%，AI 总命中率约 40%', () => {
    const human = mkUnit('p1', { isPlayer: true, isHumanControlled: true });
    const ais = Array.from({ length: 19 }, (_, i) => mkUnit(`ai_${i}`));
    const pool = [human, ...ais];

    let seed = 1234567;
    const rng = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    const trials = 10_000;
    let humanHits = 0;
    for (let i = 0; i < trials; i++) {
      const picked = pickWeightedBossTarget(pool, rng);
      if (picked?.id === 'p1') humanHits++;
    }
    const rate = humanHits / trials;
    assert.ok(
      Math.abs(rate - HUMAN_BOSS_TARGET_WEIGHT) < 0.03,
      `expected ~0.60, got ${rate.toFixed(4)}`
    );
  });

  it('2. 多玩家混合池（2 玩家 + 3 AI）：所有玩家合计 60%，所有 AI 合计 40%', () => {
    const p1 = mkUnit('p1', { isPlayer: true });
    const p2 = mkUnit('p2', { isHumanControlled: true });
    const ais = [mkUnit('ai1'), mkUnit('ai2'), mkUnit('ai3')];
    const pool = [p1, p2, ...ais];

    let seed = 9876543;
    const rng = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    const trials = 10_000;
    let humanHits = 0;
    for (let i = 0; i < trials; i++) {
      const picked = pickWeightedBossTarget(pool, rng);
      if (picked?.id === 'p1' || picked?.id === 'p2') humanHits++;
    }
    const rate = humanHits / trials;
    assert.ok(
      Math.abs(rate - 0.6) < 0.03,
      `expected ~0.60 combined human weight, got ${rate.toFixed(4)}`
    );
  });

  it('3. 条件池（如仅 Tank 池）全 AI 时 100% 从 AI 池选；有玩家 Tank 时玩家 Tank 占 60%', () => {
    const aiTank1 = mkUnit('t_ai1', { role: 'TANK' });
    const aiTank2 = mkUnit('t_ai2', { role: 'TANK' });
    const pickedAiOnly = pickWeightedBossTarget([aiTank1, aiTank2]);
    assert.ok(pickedAiOnly && (pickedAiOnly.id === 't_ai1' || pickedAiOnly.id === 't_ai2'));

    const humanTank = mkUnit('t_human', { role: 'TANK', isPlayer: true });
    const mixedTankPool = [humanTank, aiTank1];
    let seed = 424242;
    const rng = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    let humanCount = 0;
    for (let i = 0; i < 4000; i++) {
      if (pickWeightedBossTarget(mixedTankPool, rng)?.id === 't_human') humanCount++;
    }
    const rate = humanCount / 4000;
    assert.ok(Math.abs(rate - 0.6) < 0.04, `expected ~0.60, got ${rate.toFixed(4)}`);
  });

  it('4. pickWeightedBossTargets 不重复且排除宠物', () => {
    const pet = mkUnit('pet1', { isPet: true, unitKind: 'PET', isPlayer: false });
    const p1 = mkUnit('p1', { isPlayer: true });
    const ai1 = mkUnit('ai1');
    const ai2 = mkUnit('ai2');
    const picks = pickWeightedBossTargets([pet, p1, ai1, ai2], 2);
    assert.equal(picks.length, 2);
    assert.notEqual(picks[0].id, picks[1].id);
    assert.ok(picks.every((u) => !u.isPet));
  });
});
