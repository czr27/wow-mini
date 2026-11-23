/**
 * 团队增益范围：野性赐福 30 码施法 → 全团生效（非 30 码溅射 / 非单目标）
 * 旧测试未覆盖原因见本文件末尾注释。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RANGE_30YD_PX,
  RANGE_40YD_PX,
  getSpellByAnyId,
  selectRaidBuffTargets,
  isRaidWideBuffSpellId,
} from '../index.js';
import { CombatEngine } from '../engine/CombatEngine.js';
import {
  registerClassSpells,
  makeHealer,
  makeAlly,
  makeBoss,
  castAndResolve,
} from './helpers/combatFixtures.js';

describe('团队增益：野性赐福 / 同类全团 Buff', () => {
  it('1. Registry：MotW 施法 30 码、aoeCenterMode=RAID、非治疗溅射', () => {
    const motw = getSpellByAnyId('druid_mark_of_the_wild', 'DRUID');
    assert.ok(motw);
    assert.equal(motw!.rangePx, RANGE_30YD_PX, '施法距离应为 30 码');
    assert.notEqual(motw!.rangePx, RANGE_40YD_PX);
    assert.equal(motw!.aoeCenterMode, 'RAID');
    assert.equal(motw!.aoeRadiusPx, 0, '全团 buff 无溅射半径');
    assert.equal(motw!.isRaidBuff, true);
    assert.ok(isRaidWideBuffSpellId('mark_of_the_wild'));

    const ab = getSpellByAnyId('mage_arcane_brilliance', 'MAGE');
    assert.ok(ab);
    assert.equal(ab!.rangePx, RANGE_30YD_PX);
    assert.equal(ab!.aoeCenterMode, 'RAID');

    const horn = getSpellByAnyId('dk_horn_of_winter', 'DK');
    assert.ok(horn);
    assert.equal(horn!.rangePx, 0, '寒冬号角自身施放');
    assert.equal(horn!.aoeCenterMode, 'CASTER');
    assert.equal(horn!.aoeRadiusPx, RANGE_30YD_PX);
  });

  it('2. selectRaidBuffTargets：远处队友仍拿野性赐福（全团，不是 30 码圈）', () => {
    const caster = {
      id: 'druid',
      hp: 10000,
      maxHp: 10000,
      position: { x: 0, y: 0 },
      isAlive: true,
    };
    const near = {
      id: 'near',
      hp: 10000,
      maxHp: 10000,
      position: { x: 50, y: 0 },
      isAlive: true,
    };
    // 远超 30 码（240px）——野性成长溅射会漏，野性赐福必须仍命中
    const far = {
      id: 'far',
      hp: 10000,
      maxHp: 10000,
      position: { x: RANGE_30YD_PX + 200, y: 0 },
      isAlive: true,
    };
    const chosen = selectRaidBuffTargets({
      spellId: 'druid_mark_of_the_wild',
      allies: [caster, near, far] as any,
      caster: caster as any,
      isRaidBuff: true,
    });
    const ids = chosen.map(u => u.id).sort();
    assert.deepEqual(ids, ['druid', 'far', 'near']);
  });

  it('3. CombatEngine.castSpell：野性赐福给全团上 buff，含超距队友', () => {
    const engine = new CombatEngine();
    registerClassSpells(engine, 'DRUID');
    const druid = makeHealer('DRUID', { id: 'druid', mp: 50_000, maxMp: 50_000 });
    druid.position = { x: 0, y: 0 };
    const tank = makeAlly('tank', 1);
    tank.position = { x: 40, y: 0 };
    const far = makeAlly('far', 1);
    far.position = { x: RANGE_30YD_PX + 180, y: 0 };
    engine.addUnit(druid);
    engine.addUnit(tank);
    engine.addUnit(far);
    engine.addUnit(makeBoss());

    assert.equal(castAndResolve(engine, 'druid', 'druid_mark_of_the_wild', tank.id), true);

    const hasMotw = (u: { buffs: Array<{ spellId?: string }> }) =>
      u.buffs.some(b => (b.spellId || '').includes('mark_of_the_wild'));

    assert.ok(hasMotw(druid as any), '施法者应有野性赐福');
    assert.ok(hasMotw(tank as any), '近处队友应有');
    assert.ok(hasMotw(far as any), '超距队友仍应有（全团生效）');
  });
});

/*
 * 为何旧测试没拦住：
 * 1. smoke / 专精 suite 只断言「能施放 / Registry 有标签」，不查 buff 落点人数与距离。
 * 2. fixture 单位挤在同一坐标，单目标 vs 全团 vs 30 码溅射结果无法区分。
 * 3. 契约测试覆盖 healing/ground rangePx，从未断言 isRaidBuff 的 rangePx=30 与 aoeCenterMode=RAID。
 * 4. 开战 RunStateMachine.applyRaidBuffs 已全团上 buff，掩盖了手动 castSpell 只打单目标的 bug。
 */
