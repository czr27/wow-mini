import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CombatEngine } from '@cata-raid-sim/engine';
import {
  beginCombatEffectEpoch,
  configureCombatAuthority,
  ingestCombatEffect,
  mergeOwnerSnapshotUnits,
} from '../networkCombatAuthority.js';
import { withNetworkVitals } from '../withNetworkVitals.js';

function makeUnit(id: string, overrides: Record<string, any> = {}): any {
  return {
    id,
    name: id,
    classId: 'PRIEST',
    role: 'HEALER',
    isPlayer: false,
    isAlive: true,
    alive: true,
    hp: 20000,
    maxHp: 40000,
    position: { x: 200, y: 200 },
    stats: {
      attackPower: 100,
      spellPower: 1000,
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

function resetAuthority() {
  configureCombatAuthority({
    activeRoomId: null,
    isNetworkHost: false,
    isNetworkGuest: false,
    localPlayerId: null,
    isUnitLocalAuthority: () => true,
  });
}

describe('withNetworkVitals healing stats', () => {
  it('客机治疗远端目标时保留目标血量由远端结算，同时本地立即计入自身治疗统计', () => {
    resetAuthority();
    const engine = new CombatEngine();
    const guestHealer = makeUnit('guest_1', { isPlayer: true, isHumanControlled: true, hp: 40000 });
    const hostTank = makeUnit('host_tank', { role: 'TANK', hp: 20000, maxHp: 40000 });
    engine.addUnit(guestHealer);
    engine.addUnit(hostTank);

    configureCombatAuthority({
      activeRoomId: 'room_test',
      isNetworkHost: false,
      isNetworkGuest: true,
      localPlayerId: 'guest_1',
      isUnitLocalAuthority: (id) => id === 'guest_1',
    });

    withNetworkVitals(engine, () => {
      engine.healUnit(guestHealer, hostTank, 8000, false, '强效治疗术');
    });

    assert.equal(hostTank.hp, 20000, '远端目标血量不由客机直接改写');
    assert.equal(guestHealer.combatStats?.healingDone, 8000, '自身治疗统计必须记账');
    assert.equal(guestHealer.combatStats?.skillHealing?.['强效治疗术'], 8000);
    resetAuthority();
  });

  it('mergeOwnerSnapshotUnits 单调合并 combatStats，不被陈旧快照的 0 覆盖', () => {
    resetAuthority();
    const engine = new CombatEngine();
    const host = makeUnit('host_1', { isPlayer: true, isHumanControlled: true });
    const guest = makeUnit('guest_1', {
      isHumanControlled: true,
      combatStats: {
        damageDealt: 0,
        healingDone: 12000,
        overhealDone: 1000,
        damageTaken: 0,
        interruptCount: 0,
        skillHealing: { '快速治疗': 12000 },
      },
    });
    engine.addUnit(host);
    engine.addUnit(guest);

    configureCombatAuthority({
      activeRoomId: 'room_test',
      isNetworkHost: true,
      isNetworkGuest: false,
      localPlayerId: 'host_1',
      isUnitLocalAuthority: (id) => id === 'host_1',
    });

    const staleSnap = {
      ...engine.buildNetworkUnitSnapshots().find((u) => u.id === 'guest_1')!,
      combatStats: {
        damageDealt: 0,
        healingDone: 0,
        overhealDone: 0,
        damageTaken: 0,
        interruptCount: 0,
        skillHealing: {},
      },
    };

    mergeOwnerSnapshotUnits(engine, {
      ownerId: 'guest_1',
      timeMs: Date.now(),
      units: [staleSnap],
    });

    const after = engine.getUnit('guest_1');
    assert.equal(after?.combatStats?.healingDone, 12000, '已累计的治疗统计不应被 0 覆盖');
    assert.equal(after?.combatStats?.skillHealing?.['快速治疗'], 12000);
    resetAuthority();
  });

  it('统一权威：非本地权威目标跳字以 server 为准（本地不预弹、不重复消费回包）；自己与宝宝受治疗本地消费跳字；自己与宝宝特效忽略 server 回包', () => {
    resetAuthority();
    beginCombatEffectEpoch();
    const engine = new CombatEngine();
    const me = makeUnit('me_1', { isPlayer: true, isHumanControlled: true, hp: 20000, maxHp: 40000 });
    const myPet = makeUnit('pet_1', { isPet: true, ownerId: 'me_1', hp: 10000, maxHp: 20000 });
    const otherPlayer = makeUnit('other_1', { role: 'TANK', hp: 20000, maxHp: 40000 });
    engine.addUnit(me);
    engine.addUnit(myPet);
    engine.addUnit(otherPlayer);

    const loggedActions: any[] = [];
    engine.onCombatAction = (ev) => loggedActions.push(ev);

    configureCombatAuthority({
      activeRoomId: 'room_test',
      isNetworkHost: false,
      isNetworkGuest: true,
      localPlayerId: 'me_1',
      isUnitLocalAuthority: (id) => id === 'me_1' || id === 'pet_1',
    });

    // 1. 自己治疗非本地权威目标：不预弹跳字，仅统计自身治疗量
    withNetworkVitals(engine, () => {
      engine.healUnit(me, otherPlayer, 6000, false, '治疗之触');
    });
    assert.equal(engine.effectsManager?.floatingTexts.length ?? 0, 0, '非本地权威目标本地不应预弹跳字');

    // 2. 收到非本地权威目标的 HEAL/DAMAGE 回包：也不本地弹字（以 server COMBAT_STATE 为准）
    ingestCombatEffect(engine, {
      effectId: 'eff_foreign_heal',
      sourceId: 'me_1',
      targetId: 'other_1',
      spellId: 'healing_touch',
      spellName: '治疗之触',
      kind: 'HEAL',
      amount: 6000,
    });
    assert.equal(engine.effectsManager?.floatingTexts.length ?? 0, 0, '非本地权威目标不消费回包跳字');

    // 3. 他人治疗自己与自己宝宝：本地权威消费血量与跳字
    ingestCombatEffect(engine, {
      effectId: 'eff_heal_me',
      sourceId: 'other_1',
      targetId: 'me_1',
      spellId: 'rejuvenation',
      spellName: '回春术',
      kind: 'HEAL',
      amount: 5000,
    });
    ingestCombatEffect(engine, {
      effectId: 'eff_heal_pet',
      sourceId: 'other_1',
      targetId: 'pet_1',
      spellId: 'rejuvenation',
      spellName: '回春术',
      kind: 'HEAL',
      amount: 3000,
    });
    assert.equal(me.hp, 25000, '自己受到他人治疗应本地生效');
    assert.equal(myPet.hp, 13000, '自己宝宝受到他人治疗应本地生效');
    assert.equal(engine.effectsManager?.floatingTexts.length, 2, '自己和宝宝受到他人治疗应本地产生跳字');

    // 4. 自己与自己宝宝发起的特效回包：忽略 server，不重复触发 onCombatAction
    ingestCombatEffect(engine, {
      effectId: 'eff_self_fx',
      sourceId: 'me_1',
      targetId: 'other_1',
      spellId: 'tranquility',
      kind: 'AOE_PULSE',
      x: 200,
      y: 200,
      radius: 360,
    });
    ingestCombatEffect(engine, {
      effectId: 'eff_pet_fx',
      sourceId: 'pet_1',
      targetId: 'other_1',
      spellId: 'claw',
      kind: 'CAST_LAND',
    });
    assert.equal(loggedActions.length, 0, '自己与宝宝发起的特效回包应被忽略');

    // 5. 他人发起的特效：正常消费
    ingestCombatEffect(engine, {
      effectId: 'eff_other_fx',
      sourceId: 'other_1',
      targetId: 'me_1',
      spellId: 'healing_wave',
      kind: 'CAST_LAND',
    });
    assert.equal(loggedActions.length, 1, '他人发起的特效仍应正常消费');

    // 6. 自己发给自己的所有效果（即使广播包带着服务端新生成的 effectId）：当场已结算，广播一律忽略
    const hpBeforeSelfEcho = me.hp;
    const fctBeforeSelfEcho = engine.effectsManager?.floatingTexts.length ?? 0;
    ingestCombatEffect(engine, {
      effectId: 'srv_eff_dup_self_heal',
      sourceId: 'me_1',
      targetId: 'me_1',
      spellId: 'rejuvenation',
      spellName: '回春术',
      kind: 'HEAL',
      amount: 4000,
    });
    ingestCombatEffect(engine, {
      effectId: 'srv_eff_dup_self_buff',
      sourceId: 'me_1',
      targetId: 'me_1',
      spellId: 'barkskin',
      spellName: '树皮术',
      kind: 'APPLY_BUFF',
      buff: { spellId: 'barkskin', name: '树皮术', durationMs: 12000, stacks: 1 },
    });
    ingestCombatEffect(engine, {
      effectId: 'srv_eff_dup_self_pet_heal',
      sourceId: 'me_1',
      targetId: 'pet_1',
      spellId: 'rejuvenation',
      spellName: '回春术',
      kind: 'HEAL',
      amount: 3000,
    });
    assert.equal(me.hp, hpBeforeSelfEcho, '广播包中自己给自己的治疗不得重复结算');
    assert.equal(myPet.hp, 13000, '广播包中自己给自己宝宝的治疗不得重复结算');
    assert.equal(me.buffs.some((b) => b.spellId === 'barkskin'), false, '广播包中自己给自己的 Buff 不得重复施加');
    assert.equal(
      engine.effectsManager?.floatingTexts.length ?? 0,
      fctBeforeSelfEcho,
      '广播包中自己给自己的效果不得重复弹字'
    );

    resetAuthority();
  });
});
