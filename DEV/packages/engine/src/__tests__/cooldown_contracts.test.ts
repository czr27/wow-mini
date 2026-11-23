/**
 * 全表 CD 契约：战斗复活标定 + 源文件一致性 + 关键大招黄金表
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ALL_CLASSES_NORMALIZED,
  ALL_CLASS_IDS,
  getSpellByAnyId,
  type ClassId,
} from '../classes/ClassRegistry.js';
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

const MIN = 60_000;

function collectRawSpells(): Array<{ id: string; cooldownMs: number }> {
  const out: Array<{ id: string; cooldownMs: number }> = [];
  const pushAll = (spells: any[]) => {
    for (const sp of spells) out.push({ id: sp.id, cooldownMs: sp.cooldownMs ?? 0 });
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

/** Cata 标定：战斗复活 / 脱战复活 / 若干大招 CD（ms） */
const GOLDEN_COOLDOWNS: Record<string, number> = {
  // 战斗复活
  druid_rebirth: 10 * MIN, // 10 分钟
  warlock_soulstone: 15 * MIN, // 15 分钟
  // 脱战复活：无 CD
  druid_revive: 0,
  shaman_ancestral_spirit: 0,
  paladin_redemption: 0,
  priest_resurrection: 0,
  // 团辅 / 大招抽样
  shaman_heroism: 5 * MIN,
  shaman_spirit_link_totem: 3 * MIN,
  shaman_healing_tide_totem: 3 * MIN,
  shaman_mana_tide_totem: 3 * MIN,
  shaman_ascendance: 3 * MIN,
  shaman_ancestral_guidance: 2 * MIN,
  shaman_unleash_life: 15_000,
  shaman_riptide: 6_000,
  shaman_healing_rain: 10_000,
  shaman_wind_shear: 6_000,
  druid_tranquility: 3 * MIN,
  druid_barkskin: 1 * MIN,
  druid_natures_swiftness: 2 * MIN,
  warrior_shield_wall: 2 * MIN,
  warrior_taunt: 8_000,
  dk_dark_command: 8_000,
  dk_icebound_fortitude: 3 * MIN,
  mage_ice_block: 5 * MIN,
  mage_counterspell: 24_000,
  priest_pain_suppression: 3 * MIN,
  paladin_divine_shield: 5 * MIN,
  paladin_hand_of_reckoning: 8_000,
};

describe('CD 契约：战斗复活 + 全表 cooldownMs', () => {
  it('1. 战斗复活 CD：复生 10 分钟 / 灵魂石 15 分钟，且可战中使用', () => {
    const rebirth = getSpellByAnyId('druid_rebirth', 'DRUID');
    const soulstone = getSpellByAnyId('warlock_soulstone', 'WARLOCK');
    assert.ok(rebirth && soulstone);
    assert.equal(rebirth!.cooldownMs, 10 * MIN, '复生应为 10 分钟');
    assert.equal(soulstone!.cooldownMs, 15 * MIN, '灵魂石应为 15 分钟');
    assert.equal(rebirth!.isResurrect, true);
    assert.equal(soulstone!.isResurrect, true);
    assert.equal(rebirth!.isOutOfCombatOnly, false, '复生可战斗中使用');
    assert.equal(soulstone!.isOutOfCombatOnly, false, '灵魂石可战斗中使用');
  });

  it('2. 脱战复活无 CD，且标记 isOutOfCombatOnly', () => {
    const oocIds = [
      'druid_revive',
      'shaman_ancestral_spirit',
      'paladin_redemption',
      'priest_resurrection',
    ] as const;
    for (const id of oocIds) {
      const sp = getSpellByAnyId(id);
      assert.ok(sp, `缺少 ${id}`);
      assert.equal(sp!.cooldownMs, 0, `${id} 脱战复活应为无 CD`);
      assert.equal(sp!.isResurrect, true, `${id} 应为复活类`);
      assert.equal(sp!.isOutOfCombatOnly, true, `${id} 应为脱战专用`);
    }
  });

  it('3. 黄金 CD 表：关键技能 cooldownMs 与 Cata 标定一致', () => {
    for (const [id, expectCd] of Object.entries(GOLDEN_COOLDOWNS)) {
      const sp = getSpellByAnyId(id);
      assert.ok(sp, `缺少技能 ${id}`);
      assert.equal(sp!.cooldownMs, expectCd, `${id} CD 期望 ${expectCd} 实际 ${sp!.cooldownMs}`);
    }
  });

  it('4. 全表 cooldownMs 与 classes 源文件一致（含战斗复活）', () => {
    const raw = collectRawSpells();
    const cdsById = new Map<string, Set<number>>();
    for (const s of raw) {
      const set = cdsById.get(s.id) ?? new Set<number>();
      set.add(s.cooldownMs ?? 0);
      cdsById.set(s.id, set);
    }
    for (const cid of ALL_CLASS_IDS) {
      for (const sp of ALL_CLASSES_NORMALIZED[cid as ClassId].allSpells) {
        const cds = cdsById.get(sp.id);
        assert.ok(cds && cds.size > 0, `缺少源技能 ${sp.id}`);
        assert.ok(
          cds!.has(sp.cooldownMs),
          `${sp.id} cooldownMs=${sp.cooldownMs} 不在源数据 [${[...cds!].join(',')}]`
        );
        assert.ok(Number.isFinite(sp.cooldownMs) && sp.cooldownMs >= 0, `${sp.id} CD 非法`);
      }
    }
  });

  it('5. 复活类技能集合完整：战复仅 rebirth/soulstone；其余脱战', () => {
    const battleRez = new Set(['druid_rebirth', 'warlock_soulstone']);
    const found: string[] = [];
    for (const cid of ALL_CLASS_IDS) {
      for (const sp of ALL_CLASSES_NORMALIZED[cid as ClassId].allSpells) {
        if (!sp.isResurrect) continue;
        found.push(sp.id);
        if (battleRez.has(sp.id)) {
          assert.equal(sp.isOutOfCombatOnly, false, `${sp.id} 应为战复`);
          assert.ok(sp.cooldownMs >= 10 * MIN, `${sp.id} 战复 CD 至少 10 分钟`);
        } else {
          assert.equal(sp.isOutOfCombatOnly, true, `${sp.id} 应为脱战复活`);
          assert.equal(sp.cooldownMs, 0, `${sp.id} 脱战复活无 CD`);
        }
      }
    }
    for (const id of battleRez) {
      assert.ok(found.includes(id), `应注册战复 ${id}`);
    }
  });

  it('6. 同 shortId 在各专精不应出现互相矛盾的 CD（除多专精同名允许集合）', () => {
    const byShort = new Map<string, Set<number>>();
    for (const cid of ALL_CLASS_IDS) {
      for (const sp of ALL_CLASSES_NORMALIZED[cid as ClassId].allSpells) {
        const set = byShort.get(sp.shortId) ?? new Set<number>();
        set.add(sp.cooldownMs);
        byShort.set(sp.shortId, set);
      }
    }
    // 战复 shortId 必须唯一且正确
    assert.deepEqual([...(byShort.get('rebirth') || [])], [10 * MIN]);
    assert.deepEqual([...(byShort.get('soulstone') || [])], [15 * MIN]);
  });
});
