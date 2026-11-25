import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CombatEngine } from '@cata-raid-sim/engine';
import {
  STABLE_TANK_THREAT_THRESHOLD,
  filterEnemiesWithStableTankThreat,
  isTankThreatStableForEnemy,
} from '../aiCombatExecutor.js';

function makeUnit(id: string, role: 'TANK' | 'DPS' | 'HEALER' | 'ENEMY'): any {
  return {
    id,
    name: id,
    classId: role === 'TANK' ? 'WARRIOR' : role === 'HEALER' ? 'PRIEST' : 'MAGE',
    role,
    isPlayer: false,
    isAlive: true,
    alive: true,
    hp: 40000,
    maxHp: 40000,
    position: { x: 300, y: 200 },
    stats: {
      attackPower: 100,
      spellPower: 100,
      critChance: 0.2,
      haste: 0,
      armor: 1000,
      dodge: 0,
      parry: 0,
      block: 0,
      spellResist: 0,
    },
    buffs: [],
    resources: [],
  };
}

describe('aiThreatWait', () => {
  it('T 尚未建立稳定仇恨前 AI DPS 等待；T 仇恨稳定后才输出', () => {
    const engine = new CombatEngine();
    const tank = makeUnit('tank_1', 'TANK');
    const dps = makeUnit('dps_1', 'DPS');
    const boss = makeUnit('boss_1', 'ENEMY');
    engine.addUnit(tank);
    engine.addUnit(dps);
    engine.addUnit(boss);

    // 1. 刚开怪无仇恨：等待
    assert.equal(isTankThreatStableForEnemy(engine, boss, dps), false);
    assert.equal(filterEnemiesWithStableTankThreat(engine, [boss], dps).length, 0);

    // 2. 仅嘲讽（仇恨=1，未打技能）：仍等待
    engine.threatManager.applyTaunt(boss.id, tank.id);
    assert.equal(isTankThreatStableForEnemy(engine, boss, dps), false);

    // 3. T 打出技能建立稳定仇恨：允许 AI DPS 输出
    engine.threatManager.addThreat(boss.id, tank.id, STABLE_TANK_THREAT_THRESHOLD);
    assert.equal(isTankThreatStableForEnemy(engine, boss, dps), true);
    assert.equal(filterEnemiesWithStableTankThreat(engine, [boss], dps).length, 1);

    // 4. DPS 仇恨逼近 T 的 95% 时主动停手防 OT
    engine.threatManager.addThreat(boss.id, dps.id, STABLE_TANK_THREAT_THRESHOLD * 0.96);
    assert.equal(isTankThreatStableForEnemy(engine, boss, dps), false);
  });

  it('无存活坦克时 AI DPS 不被永久锁死', () => {
    const engine = new CombatEngine();
    const tank = makeUnit('tank_1', 'TANK');
    tank.isAlive = false;
    tank.alive = false;
    tank.hp = 0;
    const dps = makeUnit('dps_1', 'DPS');
    const boss = makeUnit('boss_1', 'ENEMY');
    engine.addUnit(tank);
    engine.addUnit(dps);
    engine.addUnit(boss);

    assert.equal(isTankThreatStableForEnemy(engine, boss, dps), true);
    assert.equal(filterEnemiesWithStableTankThreat(engine, [boss], dps).length, 1);
  });
});
