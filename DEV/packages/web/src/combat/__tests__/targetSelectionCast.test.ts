import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CombatEngine } from '@cata-raid-sim/engine';
import { resolvePlayerCast } from '../resolvePlayerCast.js';
import { confirmGroundTarget } from '../confirmGroundTarget.js';

function makeUnit(id: string, role: 'DPS' | 'ENEMY', overrides: Record<string, any> = {}): any {
  return {
    id,
    name: id,
    classId: role === 'ENEMY' ? 'BOSS' : 'SHAMAN',
    role,
    isPlayer: role !== 'ENEMY',
    isAlive: true,
    alive: true,
    hp: 50000,
    maxHp: 50000,
    mp: 20000,
    maxMp: 20000,
    position: { x: 200, y: 200 },
    stats: {
      attackPower: 1000,
      spellPower: 3800,
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
    ...overrides,
  };
}

describe('targetSelectionCast', () => {
  it('选中敌对小怪施放读条技能时，伤害与抛掷特效均指向选中小怪而非 Boss', () => {
    const engine = new CombatEngine();
    const player = makeUnit('p1', 'DPS', { position: { x: 180, y: 200 } });
    const boss = makeUnit('boss_1', 'ENEMY', { isBoss: true, position: { x: 540, y: 200 } });
    const add = makeUnit('add_1', 'ENEMY', { classId: 'NPC', isBoss: false, position: { x: 320, y: 240 } });
    engine.addUnit(player);
    engine.addUnit(boss);
    engine.addUnit(add);

    const logged: any[] = [];
    engine.onCombatAction = (ev) => logged.push(ev);

    const ok = resolvePlayerCast('lightning_bolt', 0, {
      engine,
      castTargetId: add.id,
      selectedTargetId: add.id,
      onScreenShake: () => {},
      onTriggerCooldown: () => {},
      onFriendlyUnitsChanged: () => {},
    });

    assert.equal(ok, true);
    assert.ok(add.hp < 50000, '小怪应受到伤害');
    assert.equal(boss.hp, 50000, '未选中的 Boss 不应受到单体伤害');
    assert.equal(logged[0]?.targetId, add.id, 'CAST_LAND 特效目标应为选中小怪');
  });

  it('地面放置技能（confirmGroundTarget）记录点击坐标且 targetId 为 null（不绑定 Boss）', () => {
    const engine = new CombatEngine();
    const player = makeUnit('p1', 'DPS', { classId: 'SHAMAN' });
    const boss = makeUnit('boss_1', 'ENEMY', { isBoss: true, position: { x: 540, y: 200 } });
    engine.addUnit(player);
    engine.addUnit(boss);

    const logged: any[] = [];
    engine.onCombatAction = (ev) => logged.push(ev);

    confirmGroundTarget({
      engine,
      player,
      boss,
      slot: { slotIdx: 0, spellId: 'healing_rain', name: '治疗之雨', cooldownMs: 10000, cdRemainingMs: 0, totalCdMs: 10000 } as any,
      spellId: 'healing_rain',
      x: 280,
      y: 220,
      triggerCooldown: () => {},
      triggerGcd: () => {},
      clearGroundTarget: () => {},
    });

    assert.equal(logged.length, 1);
    assert.equal(logged[0].kind, 'GROUND_PLACE');
    assert.equal(logged[0].x, 280);
    assert.equal(logged[0].y, 220);
    assert.equal(logged[0].targetId, null);
  });
});
