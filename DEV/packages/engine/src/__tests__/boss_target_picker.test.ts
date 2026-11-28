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

describe('BossTargetPicker 玩家优先随机点名（玩家不够再补 AI）', () => {
  it('1. 1 玩家 + 19 AI 池子：单点 100% 选中玩家', () => {
    const human = mkUnit('p1', { isPlayer: true, isHumanControlled: true });
    const ais = Array.from({ length: 19 }, (_, i) => mkUnit(`ai_${i}`));
    const pool = [human, ...ais];

    let seed = 1234567;
    const rng = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    const trials = 1_000;
    let humanHits = 0;
    for (let i = 0; i < trials; i++) {
      const picked = pickWeightedBossTarget(pool, rng);
      if (picked?.id === 'p1') humanHits++;
    }
    assert.equal(HUMAN_BOSS_TARGET_WEIGHT, 1);
    assert.equal(humanHits, trials, '有玩家时应 100% 优先点玩家');
  });

  it('2. 多玩家混合池（2 玩家 + 3 AI）：单点仅从玩家池均匀随机选，不点 AI', () => {
    const p1 = mkUnit('p1', { isPlayer: true });
    const p2 = mkUnit('p2', { isHumanControlled: true });
    const ais = [mkUnit('ai1'), mkUnit('ai2'), mkUnit('ai3')];
    const pool = [p1, p2, ...ais];

    let seed = 9876543;
    const rng = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    const trials = 4_000;
    let p1Hits = 0;
    let p2Hits = 0;
    for (let i = 0; i < trials; i++) {
      const picked = pickWeightedBossTarget(pool, rng);
      assert.ok(picked?.id === 'p1' || picked?.id === 'p2', `不应点中 AI: ${picked?.id}`);
      if (picked.id === 'p1') p1Hits++;
      else p2Hits++;
    }
    assert.ok(Math.abs(p1Hits / trials - 0.5) < 0.04, `玩家间应均匀随机，p1 占比 ${(p1Hits / trials).toFixed(3)}`);
    assert.ok(Math.abs(p2Hits / trials - 0.5) < 0.04, `玩家间应均匀随机，p2 占比 ${(p2Hits / trials).toFixed(3)}`);
  });

  it('3. 条件池全 AI 时 100% 从 AI 池随机选；有玩家时 100% 优先点玩家', () => {
    const aiTank1 = mkUnit('t_ai1', { role: 'TANK' });
    const aiTank2 = mkUnit('t_ai2', { role: 'TANK' });
    const pickedAiOnly = pickWeightedBossTarget([aiTank1, aiTank2]);
    assert.ok(pickedAiOnly && (pickedAiOnly.id === 't_ai1' || pickedAiOnly.id === 't_ai2'));

    const humanTank = mkUnit('t_human', { role: 'TANK', isPlayer: true });
    const mixedTankPool = [humanTank, aiTank1];
    for (let i = 0; i < 100; i++) {
      assert.equal(pickWeightedBossTarget(mixedTankPool)?.id, 't_human');
    }
  });

  it('4. pickWeightedBossTargets 优先点完所有玩家，玩家不够再从 AI 补齐，且不重复、排除宠物', () => {
    const pet = mkUnit('pet1', { isPet: true, unitKind: 'PET', isPlayer: false });
    const p1 = mkUnit('p1', { isPlayer: true });
    const p2 = mkUnit('p2', { isHumanControlled: true });
    const ai1 = mkUnit('ai1');
    const ai2 = mkUnit('ai2');

    // 1 玩家 + 2 AI，点 2 人：必含 p1，另 1 人从 AI 补齐
    for (let i = 0; i < 50; i++) {
      const picks1 = pickWeightedBossTargets([pet, p1, ai1, ai2], 2);
      assert.equal(picks1.length, 2);
      assert.notEqual(picks1[0].id, picks1[1].id);
      assert.ok(picks1.every((u) => !u.isPet));
      assert.ok(picks1.some((u) => u.id === 'p1'), '1 玩家点 2 人时玩家必被点中');
    }

    // 2 玩家 + 2 AI，点 2 人：全为玩家，不点 AI
    for (let i = 0; i < 50; i++) {
      const picks2 = pickWeightedBossTargets([pet, p1, p2, ai1, ai2], 2);
      assert.equal(picks2.length, 2);
      const ids = new Set(picks2.map((u) => u.id));
      assert.deepEqual(ids, new Set(['p1', 'p2']), '玩家足够时应全部点中玩家');
    }
  });
});
