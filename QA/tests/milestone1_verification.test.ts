import assert from 'node:assert';
import {
  MAGE, SHAMAN, DRUID, ROGUE, DEATH_KNIGHT,
  BossAI, findOptimalGroundAuraCentroid, CombatEngine, CLASS_SPECS_MAP
} from '../../DEV/packages/engine/dist/index.js';
import { SPELL_TOOLTIPS } from '../../DEV/packages/web/src/assets/pixelIcons.js';
import { DEBUFF_REGISTRY } from '../../DEV/packages/web/src/components/RaidFrames.js';
import { getDefaultActionSlots } from '../../DEV/packages/web/src/assets/defaultActionSlots.js';

export function runMilestone1Verification() {
  console.log('=== Running Milestone 1 Comprehensive Verification ===');

  // 1. Spells Alignment (R4)
  console.log('1. Checking Cataclysm 85 Spells Alignment...');
  const livingBomb = MAGE.spells.find(s => s.id === 'mage_living_bomb')!;
  assert.strictEqual(livingBomb.cooldownMs, 0, 'Living Bomb must have 0s CD');

  const pyro = MAGE.spells.find(s => s.id === 'mage_pyroblast')!;
  assert.strictEqual(pyro.castTimeMs, 3500, 'Pyroblast must have 3.5s cast time');

  const fireball = MAGE.spells.find(s => s.id === 'mage_fireball')!;
  assert.strictEqual(fireball.castTimeMs, 2250, 'Fireball must have 2.25s cast time');

  const frostbolt = MAGE.spells.find(s => s.id === 'mage_frostbolt')!;
  assert.strictEqual(frostbolt.castTimeMs, 2000, 'Frostbolt must have 2.0s cast time');

  const evocation = MAGE.spells.find(s => s.id === 'mage_evocation')!;
  assert.strictEqual(evocation.cooldownMs, 240000, 'Evocation must have 4m CD');

  const surge = SHAMAN.spells.find(s => s.id === 'shaman_healing_surge')!;
  assert.strictEqual(surge.castTimeMs, 1500, 'Healing Surge must have 1.5s cast');
  assert.strictEqual(surge.cooldownMs, 0, 'Healing Surge must have 0s CD');

  const hwave = SHAMAN.spells.find(s => s.id === 'shaman_healing_wave')!;
  assert.strictEqual(hwave.castTimeMs, 2500, 'Healing Wave must have 2.5s cast');

  const heroism = SHAMAN.spells.find(s => s.id === 'shaman_heroism')!;
  assert.strictEqual(heroism.cooldownMs, 300000, 'Heroism must have 5m CD');

  const nourish = DRUID.spells.find(s => s.id === 'druid_nourish')!;
  assert.strictEqual(nourish.castTimeMs, 2500, 'Nourish must have 2.5s cast');

  const starsurge = DRUID.spells.find(s => s.id === 'druid_starsurge')!;
  assert.strictEqual(starsurge.castTimeMs, 2000, 'Starsurge must have 2.0s cast');
  assert.strictEqual(starsurge.targetType, 'SINGLE_ENEMY', 'Starsurge must be single enemy');

  const feint = ROGUE.spells.find(s => s.id === 'rogue_evasion')!;
  assert.strictEqual(feint.cooldownMs, 0, 'Feint must have 0s CD');
  assert.strictEqual(feint.resourceCostAmount, 20, 'Feint must cost 20 Energy');

  const dnd = DEATH_KNIGHT.spells.find(s => s.id === 'dk_dnd')!;
  assert.strictEqual(dnd.cooldownMs, 30000, 'DnD must have 30s CD');

  // Check Web action slots and tooltips for Rogue feint
  const rogueCombatSlots = getDefaultActionSlots('ROGUE', 'COMBAT');
  assert.ok(rogueCombatSlots.find(s => s.spellId === 'feint'), 'Rogue Combat action bar must contain feint');
  const rogueAssassinationSlots = getDefaultActionSlots('ROGUE', 'ASSASSINATION');
  assert.ok(rogueAssassinationSlots.find(s => s.spellId === 'feint'), 'Rogue Assassination action bar must contain feint');
  assert.ok(SPELL_TOOLTIPS['feint'], 'SPELL_TOOLTIPS must contain feint');

  // Check Cursed Bullets in DEBUFF_REGISTRY
  assert.ok(DEBUFF_REGISTRY['cursed_bullets'], 'DEBUFF_REGISTRY must contain cursed_bullets');
  assert.strictEqual(DEBUFF_REGISTRY['cursed_bullets'].dispelType, 'CURSE', 'cursed_bullets must be CURSE dispelType');

  console.log('✓ All Cataclysm 85 Spells Alignment assertions passed!');

  // 2. Ground Auras & Smart Placement (R5)
  console.log('2. Checking Ground Aura Smart Placement & Expiry...');
  const caster = { position: { x: 200, y: 200 } };
  const alliesSplit = [
    { id: '1', hp: 100000, maxHp: 100000, alive: true, position: { x: 100, y: 200 } },
    { id: '2', hp: 100000, maxHp: 100000, alive: true, position: { x: 105, y: 200 } },
    { id: '3', hp: 100000, maxHp: 100000, alive: true, position: { x: 500, y: 200 } },
  ];
  const centroidSplit = findOptimalGroundAuraCentroid(caster, alliesSplit, 55, 360);
  assert.ok(centroidSplit.x < 150, `Centroid must cover dense group near x=100, got ${centroidSplit.x}`);

  // Weighted injured cluster
  const alliesHurt = [
    { id: '1', hp: 100000, maxHp: 100000, alive: true, position: { x: 150, y: 200 } },
    { id: '2', hp: 100000, maxHp: 100000, alive: true, position: { x: 155, y: 200 } },
    { id: '3', hp: 20000, maxHp: 100000, alive: true, position: { x: 250, y: 200 } },
    { id: '4', hp: 25000, maxHp: 100000, alive: true, position: { x: 255, y: 200 } },
  ];
  const centroidHurt = findOptimalGroundAuraCentroid(caster, alliesHurt, 55, 360);
  assert.ok(centroidHurt.x > 230, `Centroid must target critically injured cluster near x=250, got ${centroidHurt.x}`);

  // Engine reset lifecycle clear
  const engine = new CombatEngine();
  engine.effectsManager.addGroundEffect({
    id: 'test_eff',
    kind: 'HEAL_ZONE',
    spellId: 'healing_rain',
    ownerId: 'u1',
    x: 200,
    y: 200,
    radius: 50,
    colorHex: '#4169E1',
    remainingMs: 10000,
  });
  assert.strictEqual(engine.effectsManager.getActiveHealZones().length, 1);
  engine.reset();
  assert.strictEqual(engine.effectsManager.getActiveHealZones().length, 0, 'CombatEngine.reset() must clear all ground effects');

  console.log('✓ All Ground Aura assertions passed!');

  // 3. Boss Encounters & Raid Pressure (R6)
  console.log('3. Checking Boss AI Skills & Pressure...');
  const ashbury = new BossAI('ashbury');
  const calamity = ashbury.skills.find(s => s.id === 'calamity')!;
  assert.ok(calamity, 'Ashbury must have calamity');
  assert.strictEqual(calamity.interruptible, false);

  const silver = new BossAI('silverlaine');
  const veil = silver.skills.find(s => s.id === 'veil_of_shadows')!;
  assert.ok(veil, 'Silverlaine must have veil_of_shadows AoE pulse');

  const spring = new BossAI('springvale');
  const unholy = spring.skills.find(s => s.id === 'unholy_empowerment')!;
  assert.ok(unholy, 'Springvale must have unholy_empowerment AoE pulse');

  const walden = new BossAI('walden');
  const shards = walden.skills.find(s => s.id === 'ice_shards')!;
  assert.ok(shards, 'Walden must have ice_shards frost AoE');

  const godfrey = new BossAI('godfrey');
  const bullets = godfrey.skills.find(s => s.id === 'cursed_bullets')!;
  assert.ok(bullets, 'Godfrey must have cursed_bullets');
  const barrage = godfrey.skills.find(s => s.id === 'pistol_barrage')!;
  assert.ok(barrage, 'Godfrey must have pistol_barrage');

  const morchok = new BossAI('morchok');
  assert.ok(morchok.skills.find(s => s.id === 'stomp'), 'Morchok must have stomp');
  assert.ok(morchok.skills.find(s => s.id === 'black_blood'), 'Morchok must have black_blood');

  const ultraxion = new BossAI('ultraxion');
  assert.ok(ultraxion.skills.find(s => s.id === 'unstable_monstrosity'), 'Ultraxion must have unstable_monstrosity');
  assert.ok(ultraxion.skills.find(s => s.id === 'hour_of_twilight'), 'Ultraxion must have hour_of_twilight');

  console.log('✓ All Boss AI assertions passed!');

  // 4. Milestone 1 Core Types & 10 Classes Verification
  console.log('4. Checking Milestone 1 Core Types & 10 Classes...');
  const expectedClasses = ['DK', 'DRUID', 'SHAMAN', 'MAGE', 'ROGUE', 'WARRIOR', 'PALADIN', 'HUNTER', 'PRIEST', 'WARLOCK'] as const;
  for (const c of expectedClasses) {
    assert.ok(CLASS_SPECS_MAP[c], `CLASS_SPECS_MAP must have entry for ${c}`);
    assert.strictEqual(CLASS_SPECS_MAP[c].length, 3, `${c} must have 3 specs in CLASS_SPECS_MAP`);
  }

  // 5. Existing 5 Classes Spec Completion Verification
  console.log('5. Checking Existing 5 Classes 3-Spec Completion...');
  // DK (Blood, Frost, Unholy)
  const dkBlood = DEATH_KNIGHT.spells.filter(s => s.spec === 'BLOOD_TANK');
  const dkFrost = DEATH_KNIGHT.spells.filter(s => s.spec === 'FROST_DPS');
  const dkUnholy = DEATH_KNIGHT.spells.filter(s => s.spec === 'UNHOLY_DPS');
  assert.ok(dkBlood.length >= 8, 'DK Blood Tank must have spells');
  assert.ok(dkFrost.length >= 4, 'DK Frost DPS must have spells');
  assert.strictEqual(dkUnholy.length, 6, 'DK Unholy DPS must have 6 spells');
  assert.ok(DEATH_KNIGHT.spells.find(s => s.id === 'dk_scourge_strike'), 'Scourge Strike must exist');
  assert.ok(DEATH_KNIGHT.spells.find(s => s.id === 'dk_festering_strike'), 'Festering Strike must exist');
  assert.ok(DEATH_KNIGHT.spells.find(s => s.id === 'dk_death_coil'), 'Death Coil must exist');
  assert.ok(DEATH_KNIGHT.spells.find(s => s.id === 'dk_dark_transformation'), 'Dark Transformation must exist');
  assert.ok(DEATH_KNIGHT.spells.find(s => s.id === 'dk_summon_gargoyle'), 'Summon Gargoyle must exist');
  assert.ok(DEATH_KNIGHT.spells.find(s => s.id === 'dk_army_of_the_dead'), 'Army of the Dead must exist');

  // Druid (Restoration, Balance, Feral)
  const druidResto = DRUID.spells.filter(s => s.spec === 'RESTO_HEAL');
  const druidBalance = DRUID.spells.filter(s => s.spec === 'BALANCE_DPS');
  const druidFeral = DRUID.spells.filter(s => s.spec === 'FERAL');
  assert.ok(druidResto.length >= 10, 'Druid Resto must have spells');
  assert.ok(druidBalance.length >= 4, 'Druid Balance must have spells');
  assert.strictEqual(druidFeral.length, 6, 'Druid Feral must have 6 spells');
  assert.ok(DRUID.spells.find(s => s.id === 'druid_mangle'), 'Mangle must exist');
  assert.ok(DRUID.spells.find(s => s.id === 'druid_lacerate'), 'Lacerate must exist');
  assert.ok(DRUID.spells.find(s => s.id === 'druid_shred'), 'Shred must exist');
  assert.ok(DRUID.spells.find(s => s.id === 'druid_rip'), 'Rip must exist');
  assert.ok(DRUID.spells.find(s => s.id === 'druid_frenzied_regeneration'), 'Frenzied Regeneration must exist');
  assert.ok(DRUID.spells.find(s => s.id === 'druid_growl'), 'Growl must exist');

  // Shaman (Restoration, Elemental, Enhancement)
  const shamanResto = SHAMAN.spells.filter(s => s.spec === 'RESTO_HEAL');
  const shamanEle = SHAMAN.spells.filter(s => s.spec === 'ELEMENTAL_DPS');
  const shamanEnh = SHAMAN.spells.filter(s => s.spec === 'ENHANCEMENT_DPS');
  assert.ok(shamanResto.length >= 8, 'Shaman Resto must have spells');
  assert.ok(shamanEle.length >= 3, 'Shaman Elemental must have spells');
  assert.strictEqual(shamanEnh.length, 5, 'Shaman Enhancement must have 5 spells');
  assert.ok(SHAMAN.spells.find(s => s.id === 'shaman_stormstrike'), 'Stormstrike must exist');
  assert.ok(SHAMAN.spells.find(s => s.id === 'shaman_lava_lash'), 'Lava Lash must exist');
  assert.ok(SHAMAN.spells.find(s => s.id === 'shaman_feral_spirit'), 'Feral Spirit must exist');
  assert.ok(SHAMAN.spells.find(s => s.id === 'shaman_shamanistic_rage'), 'Shamanistic Rage must exist');
  assert.ok(SHAMAN.spells.find(s => s.id === 'shaman_unleash_elements'), 'Unleash Elements must exist');

  // Mage (Fire, Ice, Arcane)
  const mageFire = MAGE.spells.filter(s => s.spec === 'FIRE_DPS');
  const mageIce = MAGE.spells.filter(s => s.spec === 'ICE_DPS');
  const mageArcane = MAGE.spells.filter(s => s.spec === 'ARCANE_DPS');
  assert.ok(mageFire.length >= 4, 'Mage Fire must have spells');
  assert.ok(mageIce.length >= 3, 'Mage Ice must have spells');
  assert.strictEqual(mageArcane.length, 4, 'Mage Arcane must have 4 spells');
  assert.ok(MAGE.spells.find(s => s.id === 'mage_arcane_blast'), 'Arcane Blast must exist');
  assert.ok(MAGE.spells.find(s => s.id === 'mage_arcane_missiles'), 'Arcane Missiles must exist');
  assert.ok(MAGE.spells.find(s => s.id === 'mage_arcane_barrage'), 'Arcane Barrage must exist');
  assert.ok(MAGE.spells.find(s => s.id === 'mage_arcane_power'), 'Arcane Power must exist');
  assert.ok(MAGE.spells.find(s => s.id === 'mage_ice_lance'), 'Ice Lance must exist');
  assert.ok(MAGE.spells.find(s => s.id === 'mage_deep_freeze'), 'Deep Freeze must exist');

  // Rogue (Combat, Assassination, Subtlety)
  const rogueCombat = ROGUE.spells.filter(s => s.spec === 'COMBAT_DPS');
  const rogueAss = ROGUE.spells.filter(s => s.spec === 'ASSASSINATION_DPS');
  const rogueSub = ROGUE.spells.filter(s => s.spec === 'SUBTLETY_DPS');
  assert.ok(rogueCombat.length >= 3, 'Rogue Combat must have spells');
  assert.strictEqual(rogueAss.length, 4, 'Rogue Assassination must have 4 spells');
  assert.strictEqual(rogueSub.length, 6, 'Rogue Subtlety must have 6 spells');
  assert.ok(ROGUE.spells.find(s => s.id === 'rogue_mutilate'), 'Mutilate must exist');
  assert.ok(ROGUE.spells.find(s => s.id === 'rogue_envenom'), 'Envenom must exist');
  assert.ok(ROGUE.spells.find(s => s.id === 'rogue_rupture'), 'Rupture must exist');
  assert.ok(ROGUE.spells.find(s => s.id === 'rogue_vendetta'), 'Vendetta must exist');
  assert.ok(ROGUE.spells.find(s => s.id === 'rogue_shadow_dance'), 'Shadow Dance must exist');
  assert.ok(ROGUE.spells.find(s => s.id === 'rogue_backstab'), 'Backstab must exist');
  assert.ok(ROGUE.spells.find(s => s.id === 'rogue_ambush'), 'Ambush must exist');
  assert.ok(ROGUE.spells.find(s => s.id === 'rogue_premeditation'), 'Premeditation must exist');
  assert.ok(ROGUE.spells.find(s => s.id === 'rogue_shadowstep'), 'Shadowstep must exist');
  assert.ok(ROGUE.spells.find(s => s.id === 'rogue_preparation'), 'Preparation must exist');

  // 6. GCD Grouping Standard Verification
  console.log('6. Checking GCD Grouping Standards...');
  // Assert ALL spells in [DEATH_KNIGHT, DRUID, SHAMAN, MAGE, ROGUE] have both gcdType and gcdCategory
  const checkedClasses = [DEATH_KNIGHT, DRUID, SHAMAN, MAGE, ROGUE];
  let verifiedSpellCount = 0;
  for (const c of checkedClasses) {
    for (const s of c.spells) {
      verifiedSpellCount++;
      assert.ok(s.gcdType, `Spell ${s.id} in class ${c.classId} must have gcdType`);
      assert.ok(s.gcdCategory, `Spell ${s.id} in class ${c.classId} must have gcdCategory`);
      if (s.gcdType === 'off') {
        assert.strictEqual(s.gcdCategory, 'OFF_GCD', `Spell ${s.id} with gcdType 'off' must have gcdCategory 'OFF_GCD'`);
      } else if (s.gcdType === 'rogue') {
        assert.strictEqual(s.gcdCategory, 'ROGUE', `Spell ${s.id} with gcdType 'rogue' must have gcdCategory 'ROGUE'`);
      } else if (s.gcdType === 'normal') {
        assert.strictEqual(s.gcdCategory, 'NORMAL', `Spell ${s.id} with gcdType 'normal' must have gcdCategory 'NORMAL'`);
      }
    }
  }
  assert.ok(verifiedSpellCount >= 100, `Must verify at least 100 spells across 5 classes (verified: ${verifiedSpellCount})`);

  const normalGcdSpells = [
    MAGE.spells.find(s => s.id === 'mage_arcane_blast')!,
    SHAMAN.spells.find(s => s.id === 'shaman_stormstrike')!,
    DEATH_KNIGHT.spells.find(s => s.id === 'dk_scourge_strike')!,
    DRUID.spells.find(s => s.id === 'druid_lacerate')!,
  ];
  for (const s of normalGcdSpells) {
    assert.strictEqual(s.gcdType, 'normal');
    assert.strictEqual(s.gcdCategory, 'NORMAL');
  }

  const rogueGcdSpells = [
    ROGUE.spells.find(s => s.id === 'rogue_mutilate')!,
    ROGUE.spells.find(s => s.id === 'rogue_backstab')!,
    DRUID.spells.find(s => s.id === 'druid_mangle')!,
    DRUID.spells.find(s => s.id === 'druid_shred')!,
    DRUID.spells.find(s => s.id === 'druid_rip')!,
  ];
  for (const s of rogueGcdSpells) {
    assert.strictEqual(s.gcdType, 'rogue');
    assert.strictEqual(s.gcdCategory, 'ROGUE');
  }

  const offGcdSpells = [
    // Preexisting off-GCD spells
    MAGE.spells.find(s => s.id === 'mage_counterspell')!,
    MAGE.spells.find(s => s.id === 'mage_time_warp')!,
    SHAMAN.spells.find(s => s.id === 'shaman_wind_shear')!,
    SHAMAN.spells.find(s => s.id === 'shaman_heroism')!,
    DEATH_KNIGHT.spells.find(s => s.id === 'dk_mind_freeze')!,
    DEATH_KNIGHT.spells.find(s => s.id === 'dk_dark_command')!,
    DEATH_KNIGHT.spells.find(s => s.id === 'dk_rune_strike')!,
    DRUID.spells.find(s => s.id === 'druid_barkskin')!,
    DRUID.spells.find(s => s.id === 'druid_natures_swiftness')!,
    // Newly added spec off-GCD spells
    ROGUE.spells.find(s => s.id === 'rogue_vendetta')!,
    ROGUE.spells.find(s => s.id === 'rogue_shadow_dance')!,
    ROGUE.spells.find(s => s.id === 'rogue_premeditation')!,
    ROGUE.spells.find(s => s.id === 'rogue_preparation')!,
    SHAMAN.spells.find(s => s.id === 'shaman_shamanistic_rage')!,
    DRUID.spells.find(s => s.id === 'druid_growl')!,
    DRUID.spells.find(s => s.id === 'druid_frenzied_regeneration')!,
    MAGE.spells.find(s => s.id === 'mage_arcane_power')!,
  ];
  for (const s of offGcdSpells) {
    assert.strictEqual(s.gcdType, 'off');
    assert.strictEqual(s.gcdCategory, 'OFF_GCD');
  }

  // Verify off-GCD abilities can be cast while gcdRemainingMs > 0 and do not start/reset GCD
  const gcdEngine = new CombatEngine();
  const gcdMage: any = {
    id: 'gcd_mage_u',
    name: 'GCD Mage',
    classId: 'MAGE',
    role: 'DPS',
    isPlayer: true,
    isAlive: true,
    hp: 40000,
    maxHp: 40000,
    mp: 50000,
    maxMp: 50000,
    stats: { haste: 0 },
    resources: [{ kind: 'MANA', current: 50000, max: 50000 }],
    buffs: [],
    threatTable: [],
    absorb: 0,
    position: { x: 0, y: 0 },
  };
  const gcdDummy: any = {
    id: 'gcd_dummy_u',
    name: 'Dummy',
    classId: 'BOSS',
    role: 'TANK',
    isPlayer: false,
    isAlive: true,
    hp: 500000,
    maxHp: 500000,
    stats: { armor: 0 },
    resources: [],
    buffs: [],
    threatTable: [],
    absorb: 0,
    position: { x: 10, y: 10 },
  };
  gcdEngine.addUnit(gcdMage);
  gcdEngine.addUnit(gcdDummy);

  const livingBombSpell = MAGE.spells.find(s => s.id === 'mage_living_bomb')!;
  const counterspellSpell = MAGE.spells.find(s => s.id === 'mage_counterspell')!;
  const windShearSpell = SHAMAN.spells.find(s => s.id === 'shaman_wind_shear')!;
  const mindFreezeSpell = DEATH_KNIGHT.spells.find(s => s.id === 'dk_mind_freeze')!;
  const barkskinSpell = DRUID.spells.find(s => s.id === 'druid_barkskin')!;

  gcdEngine.registerSpell(livingBombSpell as any);
  gcdEngine.registerSpell(counterspellSpell as any);
  gcdEngine.registerSpell(windShearSpell as any);
  gcdEngine.registerSpell(mindFreezeSpell as any);
  gcdEngine.registerSpell(barkskinSpell as any);

  // Cast living_bomb -> triggers 1500ms GCD
  assert.strictEqual(gcdEngine.castSpell(gcdMage.id, livingBombSpell.id, gcdDummy.id), true);
  const gcdBefore = gcdEngine.cooldownManager.getGcdRemaining(gcdMage.id);
  assert.strictEqual(gcdBefore, 1500, 'Living Bomb must set GCD to 1500ms');

  // Cast counterspell during active GCD
  assert.strictEqual(gcdEngine.castSpell(gcdMage.id, counterspellSpell.id, gcdDummy.id), true, 'Counterspell must be castable while GCD > 0');
  assert.strictEqual(gcdEngine.cooldownManager.getGcdRemaining(gcdMage.id), gcdBefore, 'Counterspell must not start or reset GCD');

  // Verify other off-GCD abilities can cast during active GCD without throwing or failing
  assert.strictEqual(gcdEngine.cooldownManager.canCastSpell(gcdMage.id, windShearSpell as any), true, 'Wind Shear must be castable during GCD');
  assert.strictEqual(gcdEngine.cooldownManager.canCastSpell(gcdMage.id, mindFreezeSpell as any), true, 'Mind Freeze must be castable during GCD');
  assert.strictEqual(gcdEngine.cooldownManager.canCastSpell(gcdMage.id, barkskinSpell as any), true, 'Barkskin must be castable during GCD');

  // 7. Resource Management Mechanics Verification
  console.log('7. Checking Resource Management Mechanics (Focus, Rage, Holy Power, Runes)...');
  const testEngine = new CombatEngine();
  const testUnit: any = {
    id: 'test_u1',
    name: 'Test Hunter',
    classId: 'HUNTER',
    role: 'DPS',
    isPlayer: true,
    isAlive: true,
    hp: 50000,
    maxHp: 50000,
    focus: 50,
    rage: 50,
    holyPower: 2,
    runicPower: 50,
    stats: { haste: 0.1 },
    resources: [
      { kind: 'FOCUS', current: 50, max: 100 },
      { kind: 'RAGE', current: 50, max: 100 },
      { kind: 'RUNIC_POWER', current: 50, max: 100 },
      { kind: 'HOLY_POWER', current: 2, max: 3 },
    ],
    runes: [
      { index: 0, runeType: 'BLOOD', cooldownMs: 0, totalCdMs: 10000 },
      { index: 1, runeType: 'BLOOD', cooldownMs: 0, totalCdMs: 10000 },
      { index: 2, runeType: 'FROST', cooldownMs: 0, totalCdMs: 10000 },
      { index: 3, runeType: 'FROST', cooldownMs: 0, totalCdMs: 10000 },
      { index: 4, runeType: 'UNHOLY', cooldownMs: 0, totalCdMs: 10000 },
      { index: 5, runeType: 'UNHOLY', cooldownMs: 0, totalCdMs: 10000 },
    ],
    buffs: [],
    threatTable: [],
    absorb: 0,
    position: { x: 0, y: 0 },
  };
  testEngine.addUnit(testUnit);

  // Focus passive regen: (4 * (1 + 0.1)) / 1000 * 1000ms = +4.4 Focus
  testEngine.resourceManager.tickAll(new Map([[testUnit.id, testUnit]]), 1000);
  assert.strictEqual(Math.round(testUnit.focus * 10) / 10, 54.4, 'Focus regen should be 4.4/s with 10% haste');

  // Rage out-of-combat decay: -1/s -> 50 - 1 = 49
  assert.strictEqual(Math.round(testUnit.rage), 49, 'Rage out of combat should decay by 1/s');

  // Runic Power out-of-combat decay: -2/s -> 50 - 2 = 48
  assert.strictEqual(Math.round(testUnit.runicPower), 48, 'Runic Power out of combat should decay by 2/s');

  // FillAll resets RAGE, RP, Holy Power to 0, Focus to 100
  testEngine.resourceManager.fillAll(testUnit.id);
  assert.strictEqual(testUnit.rage, 0, 'fillAll must reset Rage to 0');
  assert.strictEqual(testUnit.runicPower, 0, 'fillAll must reset RP to 0');
  assert.strictEqual(testUnit.holyPower, 0, 'fillAll must reset Holy Power to 0');
  assert.strictEqual(testUnit.focus, 100, 'fillAll must fill Focus to 100');

  // 8. CombatEngine Cast & Multi-Resource Verification
  console.log('8. Checking CombatEngine Cast & Multi-Resource Consumption...');
  const testTarget: any = {
    id: 'test_target',
    name: 'Target Dummy',
    classId: 'WARRIOR',
    role: 'TANK',
    isPlayer: false,
    isAlive: true,
    hp: 100000,
    maxHp: 100000,
    stats: { haste: 0 },
    resources: [{ kind: 'RAGE', current: 0, max: 100 }],
    buffs: [],
    threatTable: [],
    absorb: 0,
    position: { x: 10, y: 10 },
  };
  testEngine.addUnit(testTarget);

  // Register a Rage spell and test blocking when insufficient
  testEngine.registerSpell({
    id: 'test_mortal_strike',
    name: '致死打击',
    classId: 'BOSS',
    school: 'PHYSICAL',
    targetType: 'SINGLE_ENEMY',
    castTimeMs: 0,
    gcdCategory: 'NORMAL',
    resourceCost: { RAGE: 30 },
    cooldownMs: 0,
    effects: [{ kind: 'DAMAGE', school: 'PHYSICAL', baseValue: 10000, valueVariance: 0 }],
  });

  // Target currently has 0 rage -> casting test_mortal_strike should fail
  assert.strictEqual(testEngine.castSpell(testTarget.id, 'test_mortal_strike', testUnit.id), false, 'Should fail to cast when Rage is insufficient');

  // Restore 40 rage and cast -> should succeed and leave 10 rage
  testEngine.resourceManager.restore(testTarget.id, 'RAGE', 40);
  assert.strictEqual(testTarget.rage, 40);
  assert.strictEqual(testEngine.castSpell(testTarget.id, 'test_mortal_strike', testUnit.id), true, 'Should succeed to cast when Rage is sufficient');
  assert.strictEqual(testTarget.rage, 10, 'Should deduct 30 rage leaving 10');

  // Real DK spells testing: dk_death_strike and dk_obliterate
  const dkDeathStrike = DEATH_KNIGHT.spells.find(s => s.id === 'dk_death_strike')!;
  const dkObliterate = DEATH_KNIGHT.spells.find(s => s.id === 'dk_obliterate')!;
  const dkScourgeStrike = DEATH_KNIGHT.spells.find(s => s.id === 'dk_scourge_strike')!;
  testEngine.registerSpell(dkDeathStrike as any);
  testEngine.registerSpell(dkObliterate as any);
  testEngine.registerSpell(dkScourgeStrike as any);

  // When runes are on cooldown, real DK spells must fail to cast
  for (const rune of testUnit.runes) {
    rune.cooldownMs = 10000;
  }
  assert.strictEqual(testEngine.castSpell(testUnit.id, dkDeathStrike.id, testTarget.id), false, 'Death Strike must fail when runes are on cooldown');
  assert.strictEqual(testEngine.castSpell(testUnit.id, dkObliterate.id, testTarget.id), false, 'Obliterate must fail when runes are on cooldown');

  // Make frost and unholy runes ready (index 2: FROST, index 4: UNHOLY)
  testUnit.runes[2].cooldownMs = 0;
  testUnit.runes[4].cooldownMs = 0;
  testUnit.runicPower = 0;
  assert.strictEqual(testEngine.castSpell(testUnit.id, dkDeathStrike.id, testTarget.id), true, 'Death Strike must succeed when runes are ready');
  assert.strictEqual(testUnit.runicPower, 20, 'Death Strike spending 2 runes must generate 20 Runic Power');
  assert.strictEqual(testUnit.runes[2].cooldownMs, 10000, 'Frost rune must be consumed');
  assert.strictEqual(testUnit.runes[4].cooldownMs, 10000, 'Unholy rune must be consumed');

  // Verify real spell deals genuine damage to target
  testEngine.cooldownManager.startGcd(testUnit.id, 0); // Clear GCD from Death Strike
  const targetHpBefore = testTarget.hp;
  // Ready unholy rune (index 5) for scourge strike
  testUnit.runes[5].cooldownMs = 0;
  assert.strictEqual(testEngine.castSpell(testUnit.id, dkScourgeStrike.id, testTarget.id), true, 'Scourge Strike must cast successfully');
  const dmgDealt = targetHpBefore - testTarget.hp;
  assert.ok(dmgDealt > 8000, `Real spell must deal damage to target (dealt: ${dmgDealt})`);

  // Verify combo points generation with real rogue spell
  const realRogue: any = {
    id: 'test_real_rogue',
    name: 'Real Rogue',
    classId: 'ROGUE',
    role: 'DPS',
    isPlayer: true,
    isAlive: true,
    hp: 40000,
    maxHp: 40000,
    energy: 100,
    comboPoints: 0,
    stats: { haste: 0 },
    resources: [
      { kind: 'ENERGY', current: 100, max: 100 },
      { kind: 'COMBO_POINTS', current: 0, max: 5 },
    ],
    buffs: [],
    threatTable: [],
    absorb: 0,
    position: { x: 0, y: 0 },
  };
  testEngine.addUnit(realRogue);
  const rogueMutilate = ROGUE.spells.find(s => s.id === 'rogue_mutilate')!;
  testEngine.registerSpell(rogueMutilate as any);
  assert.strictEqual(testEngine.castSpell(realRogue.id, rogueMutilate.id, testTarget.id), true, 'Mutilate must cast successfully');
  assert.strictEqual(realRogue.energy, 40, 'Mutilate must deduct 60 energy');
  assert.strictEqual(realRogue.comboPoints, 2, 'Mutilate must generate 2 combo points');

  console.log('✓ All Milestone 1 Core Types, Specs, GCD & Resource mechanics passed!');
  console.log('=== Milestone 1 Verification Complete: 100% PASS ===\n');
}

runMilestone1Verification();
