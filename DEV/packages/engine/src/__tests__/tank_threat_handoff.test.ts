/**
 * 主坦危险 → 健康副坦接仇；主坦恢复 → 副坦压仇恨，主坦可嘲讽拉回。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  evaluateTankThreatDecision,
  orderTanksByThreatPriority,
  pickPreferredTankTaunt,
  shouldCastTankTaunt,
  TANK_HEALTHY_THRESHOLD,
  TANK_LOW_CD_TAUNT_MS,
  TANK_PULL_TAUNT_WINDOW_MS,
} from '../ai/TankAI.js';
import { CombatEngine } from '../engine/CombatEngine.js';
import type { Unit } from '../types.js';

function makeTank(
  partial: Partial<Unit> & Pick<Unit, 'id' | 'name'> & { hpPct: number; isPlayer?: boolean }
): Unit {
  const maxHp = 100_000;
  const hp = Math.round(maxHp * partial.hpPct);
  return {
    isPlayer: !!partial.isPlayer,
    isAlive: true,
    alive: true,
    hp,
    maxHp,
    mp: 0,
    maxMp: 0,
    absorb: 0,
    resources: [],
    buffs: [],
    threatTable: [],
    position: { x: 100, y: 100 },
    classId: 'DK',
    role: 'TANK',
    stats: {
      attackPower: 500,
      spellPower: 100,
      critChance: 0.1,
      haste: 0.1,
      armor: 100,
      spellResist: 0,
      block: 0,
      parry: 0,
      dodge: 0.05,
      mastery: 0.1,
      versatility: 0,
      speed: 0,
    },
    ...partial,
    hp,
    maxHp,
  };
}

describe('主副坦仇恨交接', () => {
  it('玩家坦始终排主坦顺位（即使 id 字典序靠后）', () => {
    const ot = makeTank({ id: 'ai_a', name: '副坦', hpPct: 1 });
    const mt = makeTank({ id: 'z_player', name: '主坦', hpPct: 1, isPlayer: true });
    const ranked = orderTanksByThreatPriority([ot, mt]);
    assert.equal(ranked[0].id, mt.id);
    assert.equal(ranked[1].id, ot.id);
  });

  it('主坦危险且副坦健康 → 副坦应嘲讽接仇，主坦压仇恨', () => {
    const mt = makeTank({
      id: 'mt',
      name: '主坦',
      hpPct: TANK_HEALTHY_THRESHOLD - 0.05,
      isPlayer: true,
    });
    const ot = makeTank({ id: 'ot', name: '副坦', hpPct: 0.95 });
    const tanks = [ot, mt]; // 故意打乱传入顺序

    const mtDec = evaluateTankThreatDecision(mt, tanks, mt.id, true);
    assert.equal(mtDec.pauseThreat, true);
    assert.equal(mtDec.shouldTaunt, false);
    assert.equal(mtDec.reason, 'SELF_UNHEALTHY_PAUSE_THREAT');

    const otDec = evaluateTankThreatDecision(ot, tanks, mt.id, false);
    assert.equal(otDec.pauseThreat, false);
    assert.equal(otDec.shouldTaunt, true);
    assert.equal(otDec.reason, 'LOWER_TANK_TAUNT_HIGHER_UNHEALTHY');
  });

  it('主坦恢复后 → 副坦压仇恨停嘲讽，主坦应嘲讽拉回', () => {
    const mt = makeTank({ id: 'mt', name: '主坦', hpPct: 0.8, isPlayer: true });
    const ot = makeTank({ id: 'ot', name: '副坦', hpPct: 0.9 });
    const tanks = [mt, ot];

    // 副坦仍握有最高仇恨 / Boss 目标
    const otDec = evaluateTankThreatDecision(ot, tanks, ot.id, true);
    assert.equal(otDec.shouldTaunt, false);
    assert.equal(otDec.pauseThreat, true);
    assert.equal(otDec.reason, 'LOWER_TANK_PAUSE_HIGHER_HEALTHY');

    const mtDec = evaluateTankThreatDecision(mt, tanks, ot.id, false);
    assert.equal(mtDec.pauseThreat, false);
    assert.equal(mtDec.shouldTaunt, true);
    assert.equal(mtDec.reason, 'PRIMARY_TANK_HEALTHY_ACTIVE');
  });

  it('嘲讽施放门闩：开战窗 / 失仇 / 多嘲讽含低CD；优先低CD', () => {
    assert.equal(
      shouldCastTankTaunt({
        shouldTaunt: true,
        elapsedMs: 500,
        threatTargetId: 'mt',
        selfId: 'mt',
      }),
      true,
      '开战窗口内即使自己握仇也可嘲讽'
    );
    assert.equal(
      shouldCastTankTaunt({
        shouldTaunt: true,
        elapsedMs: TANK_PULL_TAUNT_WINDOW_MS + 100,
        threatTargetId: 'ot',
        selfId: 'mt',
      }),
      true,
      '仇恨不在自己身上必须嘲讽'
    );
    assert.equal(
      shouldCastTankTaunt({
        shouldTaunt: true,
        elapsedMs: TANK_PULL_TAUNT_WINDOW_MS + 100,
        threatTargetId: 'mt',
        selfId: 'mt',
        availableTauntCooldownMs: [8_000],
      }),
      false,
      '已握仇且过开战窗、仅单一嘲讽 → 不用'
    );
    assert.equal(
      shouldCastTankTaunt({
        shouldTaunt: true,
        elapsedMs: TANK_PULL_TAUNT_WINDOW_MS + 100,
        threatTargetId: 'mt',
        selfId: 'mt',
        availableTauntCooldownMs: [8_000, 60_000],
      }),
      true,
      '多嘲讽且含低CD → 可用低CD嘲讽'
    );
    assert.equal(
      shouldCastTankTaunt({
        shouldTaunt: true,
        elapsedMs: TANK_PULL_TAUNT_WINDOW_MS + 100,
        threatTargetId: 'mt',
        selfId: 'mt',
        availableTauntCooldownMs: [45_000, 60_000],
      }),
      false,
      '多嘲讽但全是高CD → 不用'
    );
    assert.equal(
      shouldCastTankTaunt({
        shouldTaunt: false,
        elapsedMs: 0,
        threatTargetId: 'ot',
        selfId: 'mt',
        availableTauntCooldownMs: [8_000, 60_000],
      }),
      false,
      '接仇未满足绝不嘲讽'
    );

    const picked = pickPreferredTankTaunt([
      { id: 'long', cooldownMs: TANK_LOW_CD_TAUNT_MS + 5_000 },
      { id: 'short', cooldownMs: 8_000 },
      { id: 'mid', cooldownMs: 20_000 },
    ]);
    assert.equal(picked?.id, 'short');
  });

  it('ThreatManager：副坦嘲讽后主坦恢复嘲讽可拉回目标', () => {
    const engine = new CombatEngine();
    const mt = makeTank({ id: 'mt', name: '主坦', hpPct: 0.4, isPlayer: true });
    const ot = makeTank({ id: 'ot', name: '副坦', hpPct: 1 });
    const boss = makeTank({ id: 'boss', name: 'Boss', hpPct: 1 });
    boss.role = 'ENEMY';
    boss.classId = 'BOSS';
    boss.maxHp = 5_000_000;
    boss.hp = 5_000_000;

    engine.addUnit(mt);
    engine.addUnit(ot);
    engine.addUnit(boss);

    // 主坦危险期间副坦建立并嘲讽接仇
    engine.threatManager.addThreat(boss.id, mt.id, 10_000);
    engine.threatManager.addThreat(boss.id, ot.id, 2_000);
    engine.threatManager.applyTaunt(boss.id, ot.id);
    assert.equal(engine.threatManager.getTopThreatSource(boss.id), ot.id);

    // 主坦回血后嘲讽拉回
    mt.hp = Math.round(mt.maxHp * 0.85);
    const tanks = orderTanksByThreatPriority([mt, ot]);
    const mtDec = evaluateTankThreatDecision(
      mt,
      tanks,
      engine.threatManager.getTopThreatSource(boss.id),
      false
    );
    assert.equal(mtDec.shouldTaunt, true);
    engine.threatManager.applyTaunt(boss.id, mt.id);
    assert.equal(engine.threatManager.getTopThreatSource(boss.id), mt.id);

    const otDec = evaluateTankThreatDecision(
      ot,
      tanks,
      engine.threatManager.getTopThreatSource(boss.id),
      false
    );
    assert.equal(otDec.pauseThreat, true);
    assert.equal(otDec.shouldTaunt, false);
  });
});
