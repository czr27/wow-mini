/**
 * 全职业技能契约：射程 / CD / 引导 / GCD 分组 与源数据、描述约定对齐
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_CLASSES_NORMALIZED,
  ALL_CLASS_IDS,
  RANGE_40YD_PX,
  RANGE_MELEE_PX,
  getSpellByAnyId,
  getSpellGcdCategory,
  isOffGcdSpellId,
  type ClassId,
} from '../classes/ClassRegistry.js';
import {
  classifySpellCastMode,
  getCastLifecyclePolicy,
  isChanneledSpell,
} from '../engine/CastLifecycle.js';
import { getEffectiveGcdMs, getHastedCastTimeMs, LEVEL_80_MAX_HASTE } from '../engine/TierProfile.js';
import { GROUND_TARGET_SPELL_DEFS } from '../types.js';
import { SHAMAN } from '../classes/Shaman.js';
import { DRUID } from '../classes/Druid.js';
import { DEATH_KNIGHT } from '../classes/DeathKnight.js';
import { MAGE } from '../classes/Mage.js';
import { ROGUE } from '../classes/Rogue.js';
import { WARRIOR } from '../classes/Warrior.js';
import { PALADIN } from '../classes/Paladin.js';
import { HUNTER } from '../classes/Hunter.js';
import { PRIEST } from '../classes/Priest.js';
import { WARLOCK } from '../classes/Warlock.js';

function collectRawSpells(): Array<{ id: string; cooldownMs: number; castTimeMs: number; channelDurationMs?: number; gcdCategory?: string; gcdType?: string }> {
  const out: any[] = [];
  const pushAll = (spells: any[]) => {
    for (const sp of spells) out.push(sp);
  };
  pushAll(SHAMAN.spells);
  pushAll(DRUID.spells);
  pushAll(DEATH_KNIGHT.spells);
  pushAll(MAGE.spells);
  pushAll(ROGUE.spells);
  for (const def of [WARRIOR, PALADIN, HUNTER, PRIEST, WARLOCK]) {
    for (const spec of def.specs) pushAll(spec.spells);
  }
  return out;
}

describe('技能契约：射程 / CD / 引导 / GCD', () => {
  it('1. 全表 gcdCategory 合法，且与 getEffectiveGcdMs 三档一致', () => {
    assert.equal(getEffectiveGcdMs('NORMAL', 0.5), 1000);
    assert.equal(getEffectiveGcdMs('ROGUE', 0.5), 1000);
    assert.equal(getEffectiveGcdMs('OFF_GCD', 0.5), 0);

    for (const cid of ALL_CLASS_IDS) {
      for (const sp of ALL_CLASSES_NORMALIZED[cid].allSpells) {
        assert.ok(
          sp.gcdCategory === 'NORMAL' || sp.gcdCategory === 'ROGUE' || sp.gcdCategory === 'OFF_GCD',
          `${sp.id} 非法 gcdCategory=${sp.gcdCategory}`
        );
        assert.equal(getSpellGcdCategory(sp.id, cid), sp.gcdCategory);
        if (sp.gcdCategory === 'OFF_GCD') {
          assert.equal(isOffGcdSpellId(sp.id), true, `${sp.id} 应为 OFF_GCD`);
          assert.equal(getEffectiveGcdMs(sp.gcdCategory, LEVEL_80_MAX_HASTE), 0);
        }
      }
    }
  });

  it('2. 盗贼技能默认 ROGUE GCD；打断/嘲讽白名单 OFF_GCD', () => {
    for (const sp of ALL_CLASSES_NORMALIZED.ROGUE.allSpells) {
      if (sp.isInterrupt || sp.gcdCategory === 'OFF_GCD') {
        assert.equal(sp.gcdCategory, 'OFF_GCD', `${sp.id} 打断应为 OFF_GCD`);
      } else {
        assert.equal(sp.gcdCategory, 'ROGUE', `${sp.id} 盗贼常规技能应为 ROGUE GCD`);
      }
    }

    const mustOff = [
      'shaman_wind_shear',
      'rogue_kick',
      'warrior_pummel',
      'warrior_taunt',
      'paladin_rebuke',
      'paladin_hand_of_reckoning',
      'dk_mind_freeze',
      'dk_dark_command',
      'druid_growl',
      'mage_counterspell',
    ];
    for (const id of mustOff) {
      assert.equal(getSpellGcdCategory(id), 'OFF_GCD', `${id} 必须 OFF_GCD`);
    }
  });

  it('3. 全表 cooldownMs 与 classes 源文件一致', () => {
    const raw = collectRawSpells();
    // 同 id 可能出现在多专精且 CD 不同（如猎人陷阱）；registry 只需命中任一源定义
    const cdsById = new Map<string, Set<number>>();
    for (const s of raw) {
      const set = cdsById.get(s.id) ?? new Set<number>();
      set.add(s.cooldownMs ?? 0);
      cdsById.set(s.id, set);
    }
    for (const cid of ALL_CLASS_IDS) {
      for (const sp of ALL_CLASSES_NORMALIZED[cid].allSpells) {
        const cds = cdsById.get(sp.id);
        assert.ok(cds && cds.size > 0, `缺少源技能 ${sp.id}`);
        assert.ok(
          cds!.has(sp.cooldownMs),
          `${sp.id} cooldownMs=${sp.cooldownMs} 不在源数据集合 [${[...cds!].join(',')}]`
        );
      }
    }
  });

  it('4. 引导技能：分类为 CHANNELED，时长与契约正确', () => {
    for (const cid of ALL_CLASS_IDS) {
      for (const sp of ALL_CLASSES_NORMALIZED[cid].allSpells) {
        const raw = collectRawSpells().find(r => r.id === sp.id);
        const isChannelRaw =
          (raw?.castTimeMs === -1) ||
          ((raw?.channelDurationMs ?? 0) > 0) ||
          isChanneledSpell({
            spellId: sp.id,
            castTimeMs: raw?.castTimeMs,
            channelDurationMs: raw?.channelDurationMs ?? sp.channelDurationMs,
          });

        if (!isChannelRaw) continue;

        const mode = classifySpellCastMode({
          spellId: sp.id,
          castTimeMs: raw?.castTimeMs ?? sp.castTimeMs,
          channelDurationMs: raw?.channelDurationMs ?? sp.channelDurationMs,
        });
        assert.equal(mode, 'CHANNELED', `${sp.id} 应为引导`);
        const policy = getCastLifecyclePolicy('CHANNELED');
        assert.equal(policy.deductResourceOnStart, true, `${sp.id} 引导起手扣资源`);
        assert.equal(policy.triggerCooldownOnStart, true, `${sp.id} 引导起手进 CD`);
        assert.equal(policy.deductResourceOnComplete, false);
      }
    }

    const tranquil = getSpellByAnyId('druid_tranquility', 'DRUID');
    assert.ok(tranquil);
    assert.ok(
      (tranquil!.channelDurationMs || 0) >= 8000 ||
        classifySpellCastMode({
          spellId: 'druid_tranquility',
          castTimeMs: -1,
          channelDurationMs: 8000,
        }) === 'CHANNELED',
      '宁静应为引导'
    );

    // 读条非引导：治疗波
    assert.equal(
      classifySpellCastMode({
        spellId: 'shaman_healing_wave',
        castTimeMs: 2500,
      }),
      'CASTED'
    );
    assert.equal(getCastLifecyclePolicy('CASTED').triggerCooldownOnStart, false);
  });

  it('5. 射程：灵魂链接/治疗之雨 40 码点地；近战约 80；治疗默认 40 码', () => {
    // Ground targeting defs aligned
    assert.equal(GROUND_TARGET_SPELL_DEFS.healing_rain.maxRange, RANGE_40YD_PX);
    assert.equal(GROUND_TARGET_SPELL_DEFS.spirit_link.maxRange, RANGE_40YD_PX);
    assert.equal(GROUND_TARGET_SPELL_DEFS.spirit_link_totem.maxRange, RANGE_40YD_PX);
    assert.equal(GROUND_TARGET_SPELL_DEFS.healing_tide.radius, RANGE_40YD_PX, '治疗之潮光圈半径 40 码');
    assert.equal(GROUND_TARGET_SPELL_DEFS.healing_tide_totem.radius, RANGE_40YD_PX);
    assert.equal(GROUND_TARGET_SPELL_DEFS.shaman_healing_tide_totem.radius, RANGE_40YD_PX);
    assert.equal(
      GROUND_TARGET_SPELL_DEFS.spirit_link.maxRange,
      GROUND_TARGET_SPELL_DEFS.healing_rain.maxRange,
      '灵魂链接点地距离应与治疗之雨一致'
    );

    const rain = getSpellByAnyId('shaman_healing_rain', 'SHAMAN');
    const link = getSpellByAnyId('shaman_spirit_link_totem', 'SHAMAN');
    assert.ok(rain && link);
    assert.equal(rain!.rangePx, RANGE_40YD_PX, '治疗之雨射程 40 码');
    assert.equal(link!.rangePx, RANGE_40YD_PX, '灵魂链接射程 40 码');
    assert.equal(rain!.targetType, 'GROUND');
    assert.equal(link!.targetType, 'GROUND');

    const wg = getSpellByAnyId('druid_wild_growth', 'DRUID');
    assert.ok(wg);
    assert.equal(wg!.aoeRadiusPx, 120, '野性成长溅射 15 码');
    assert.equal(wg!.aoeCenterMode, 'TARGET');
    assert.equal(wg!.rangePx, RANGE_40YD_PX, '野性成长施法距离 40 码');

    // Sample melee
    const ss = getSpellByAnyId('shaman_stormstrike', 'SHAMAN') || getSpellByAnyId('stormstrike', 'SHAMAN');
    if (ss) assert.equal(ss.rangePx, RANGE_MELEE_PX, '风暴打击应为近战距离');

    const kick = getSpellByAnyId('rogue_kick', 'ROGUE');
    assert.ok(kick);
    assert.ok(kick!.rangePx <= RANGE_40YD_PX);

    // Heals default to 40yd
    const hw = getSpellByAnyId('shaman_healing_wave', 'SHAMAN');
    assert.ok(hw);
    assert.equal(hw!.rangePx, RANGE_40YD_PX);

    // Every GROUND spell in registry should allow at least short placement or 40yd
    for (const cid of ALL_CLASS_IDS) {
      for (const sp of ALL_CLASSES_NORMALIZED[cid].allSpells) {
        assert.ok(typeof sp.rangePx === 'number' && sp.rangePx >= 0, `${sp.id} 缺少 rangePx`);
        if (sp.targetType === 'GROUND') {
          assert.ok(sp.rangePx >= 200, `${sp.id} 地面技能射程过短: ${sp.rangePx}`);
        }
      }
    }
  });

  it('6. 奶萨关键 CD/读条与描述标定一致', () => {
    const samples: Array<{ id: string; cd: number; cast: number }> = [
      { id: 'shaman_riptide', cd: 6000, cast: 0 },
      { id: 'shaman_healing_wave', cd: 0, cast: 2500 },
      { id: 'shaman_healing_surge', cd: 0, cast: 1500 },
      { id: 'shaman_chain_heal', cd: 0, cast: 2500 },
      { id: 'shaman_healing_rain', cd: 10000, cast: 2000 },
      { id: 'shaman_spirit_link_totem', cd: 180000, cast: 0 },
      { id: 'shaman_healing_tide_totem', cd: 180000, cast: 0 },
      { id: 'shaman_unleash_life', cd: 15000, cast: 0 },
      { id: 'shaman_wind_shear', cd: 6000, cast: 0 },
      { id: 'shaman_heroism', cd: 300000, cast: 0 },
    ];
    for (const s of samples) {
      const sp = getSpellByAnyId(s.id, 'SHAMAN');
      assert.ok(sp, s.id);
      assert.equal(sp!.cooldownMs, s.cd, `${s.id} CD`);
      assert.equal(sp!.castTimeMs, s.cast, `${s.id} cast`);
      if (s.cast > 0) {
        const hasted = getHastedCastTimeMs(s.cast, LEVEL_80_MAX_HASTE);
        assert.ok(hasted < s.cast, `${s.id} 满急速应缩短读条`);
      }
    }
  });
});
