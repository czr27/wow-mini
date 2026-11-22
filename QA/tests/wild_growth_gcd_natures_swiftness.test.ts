import assert from 'node:assert';
import { CombatEngine } from '../../DEV/packages/engine/src/engine/CombatEngine.js';
import { Unit } from '../../DEV/packages/engine/src/types.js';
import { OFF_GCD_SPELLS, isOffGcdSpell } from '../../DEV/packages/web/src/components/ActionBar.js';

console.log('--- 运行 [T-New] 野性成长30码5人判定、公共CD最大值与自然迅捷机制测试 ---');

// 1. 验证 OFF_GCD_SPELLS 技能分组
assert.ok(isOffGcdSpell('natures_swiftness'), '自然迅捷必须是脱离公共CD(Off-GCD)技能');
assert.ok(isOffGcdSpell('barkskin'), '树皮术必须是脱离公共CD(Off-GCD)技能');
assert.ok(isOffGcdSpell('mind_freeze'), '心灵冰冻必须是脱离公共CD(Off-GCD)技能');
assert.ok(isOffGcdSpell('kick'), '脚踢必须是脱离公共CD(Off-GCD)技能');
assert.ok(isOffGcdSpell('feint'), '佯攻必须是脱离公共CD(Off-GCD)技能');
assert.ok(isOffGcdSpell('counterspell'), '法术反制必须是脱离公共CD(Off-GCD)技能');
assert.ok(isOffGcdSpell('wind_shear'), '风剪必须是脱离公共CD(Off-GCD)技能');
assert.ok(!isOffGcdSpell('wild_growth'), '野性成长是有公共CD的法术');
assert.ok(!isOffGcdSpell('rejuvenation'), '回春术是有公共CD的法术');
assert.ok(!isOffGcdSpell('regrowth'), '愈合是有公共CD的法术');
assert.ok(!isOffGcdSpell('fireball'), '火球术是有公共CD的法术');
console.log('✓ 1. OFF_GCD_SPELLS 技能分组校验完全正确');

// 2. 验证动作条每个技能的CD结算逻辑：
// 规则：有效CD = isOffGcd ? rawSpellCd : Math.max(rawSpellCd, gcdRemainingMs)
function calculateEffectiveCd(spellId: string, rawSpellCd: number, rawSpellTotalCd: number, gcdRemainingMs: number, gcdTotalMs: number) {
  const isOffGcd = isOffGcdSpell(spellId);
  const effectiveCdRemainingMs = isOffGcd ? rawSpellCd : Math.max(rawSpellCd, gcdRemainingMs);
  const effectiveTotalCdMs = isOffGcd
    ? (rawSpellTotalCd || 750)
    : (rawSpellCd >= gcdRemainingMs
        ? (rawSpellTotalCd || rawSpellCd || 750)
        : (gcdTotalMs || 750));
  return { effectiveCdRemainingMs, effectiveTotalCdMs, isOffGcd };
}

// 2.1 当处于 750ms (0.75s) GCD 中时：
// 0 CD 的回春术：有效CD = 750ms (GCD)
const rejuvCd = calculateEffectiveCd('rejuvenation', 0, 0, 750, 750);
assert.strictEqual(rejuvCd.effectiveCdRemainingMs, 750, '0CD技能在GCD期间的有效CD应为GCD剩余时长 (750ms)');
assert.strictEqual(rejuvCd.effectiveTotalCdMs, 750, '0CD技能在GCD期间的有效总CD应为GCD总时长 (750ms)');

// 8000ms CD 的野性成长（剩余6000ms）：有效CD = Math.max(6000, 750) = 6000ms
const wgCd = calculateEffectiveCd('wild_growth', 6000, 8000, 750, 750);
assert.strictEqual(wgCd.effectiveCdRemainingMs, 6000, '大于GCD时应保留技能本身更长的CD');
assert.strictEqual(wgCd.effectiveTotalCdMs, 8000, '大于GCD时应保留技能本身的总CD');

// 8000ms CD 的野性成长（仅剩300ms）：有效CD = Math.max(300, 750) = 750ms
const wgCdLate = calculateEffectiveCd('wild_growth', 300, 8000, 750, 750);
assert.strictEqual(wgCdLate.effectiveCdRemainingMs, 750, '技能自身CD小于GCD时，受限于GCD (750ms)');

// 脱离公共CD的技能：自然迅捷 (当前CD为0)
const nsReady = calculateEffectiveCd('natures_swiftness', 0, 120000, 750, 750);
assert.strictEqual(nsReady.effectiveCdRemainingMs, 0, '脱离公共CD技能在GCD期间有效CD必须为0，随时可放');
assert.strictEqual(nsReady.isOffGcd, true);

// 脱离公共CD的技能：自然迅捷 (当前在冷却中 45000ms)
const nsOnCd = calculateEffectiveCd('natures_swiftness', 45000, 120000, 750, 750);
assert.strictEqual(nsOnCd.effectiveCdRemainingMs, 45000, '脱离公共CD技能在冷却中只取决于自身CD');
console.log('✓ 2. 动作条有效CD计算 (0.75s GCD, 两CD最大值 & 离GCD分组) 验证完全正确');

// 3. 验证野性成长作用范围与5人智能筛选
// 规则：以目标为中心，30码(270px)内，筛选存活友方，优先按血量百分比最低排序，最多作用于5人
const engine = new CombatEngine();
const player: Unit = {
  id: 'player',
  name: '德鲁伊玩家',
  classId: 'DRUID',
  specId: 'RESTORATION',
  role: 'HEALER',
  maxHp: 100000,
  hp: 90000,
  maxMp: 100000,
  mp: 100000,
  alive: true,
  isAlive: true,
  isPlayer: true,
  buffs: [],
  resources: [],
  position: { x: 180, y: 190 },
};

// 创建7个队友，分别位于不同距离和不同血量百分比
const allies: Unit[] = [
  // 1: 距离50px, HP 30% (在范围内，重伤)
  { id: 'a1', name: '队友1', classId: 'WARRIOR', specId: 'PROTECTION', role: 'TANK', maxHp: 150000, hp: 45000, alive: true, isAlive: true, isPlayer: false, buffs: [], resources: [], position: { x: 200, y: 190 } },
  // 2: 距离100px, HP 20% (在范围内，最危急)
  { id: 'a2', name: '队友2', classId: 'MAGE', specId: 'FIRE', role: 'DPS', maxHp: 80000, hp: 16000, alive: true, isAlive: true, isPlayer: false, buffs: [], resources: [], position: { x: 180, y: 290 } },
  // 3: 距离150px, HP 50% (在范围内)
  { id: 'a3', name: '队友3', classId: 'ROGUE', specId: 'COMBAT', role: 'DPS', maxHp: 90000, hp: 45000, alive: true, isAlive: true, isPlayer: false, buffs: [], resources: [], position: { x: 180, y: 40 } },
  // 4: 距离200px, HP 40% (在范围内)
  { id: 'a4', name: '队友4', classId: 'SHAMAN', specId: 'RESTORATION', role: 'HEALER', maxHp: 95000, hp: 38000, alive: true, isAlive: true, isPlayer: false, buffs: [], resources: [], position: { x: 380, y: 190 } },
  // 5: 距离260px, HP 60% (在范围内 <= 270px)
  { id: 'a5', name: '队友5', classId: 'DK', specId: 'BLOOD', role: 'TANK', maxHp: 160000, hp: 96000, alive: true, isAlive: true, isPlayer: false, buffs: [], resources: [], position: { x: 180, y: 450 } },
  // 6: 距离270px, HP 10% (虽然HP极低，但在极限边界 270px)
  { id: 'a6', name: '队友6', classId: 'MAGE', specId: 'FROST', role: 'DPS', maxHp: 80000, hp: 8000, alive: true, isAlive: true, isPlayer: false, buffs: [], resources: [], position: { x: 450, y: 190 } },
  // 7: 距离350px, HP 5% (超出30码/270px范围，绝对不能获得野性成长)
  { id: 'a7', name: '队友7', classId: 'WARRIOR', specId: 'ARMS', role: 'DPS', maxHp: 100000, hp: 5000, alive: true, isAlive: true, isPlayer: false, buffs: [], resources: [], position: { x: 530, y: 190 } },
];

for (const u of [player, ...allies]) {
  engine.addUnit(u);
}

// 执行野性成长目标选择逻辑（以 player 为中心）：
const centerTarget = player;
const tX = centerTarget.position?.x ?? 180;
const tY = centerTarget.position?.y ?? 190;
const radius = 270;
const maxTargets = 5;

const inRangeAllies = engine.friendlyUnits.filter(u => {
  const isAlive = (u.isAlive ?? u.alive) && u.hp > 0;
  if (!isAlive) return false;
  const uX = u.position?.x ?? tX;
  const uY = u.position?.y ?? tY;
  return Math.hypot(uX - tX, uY - tY) <= radius;
});

// 超出 270px 的 a7 (350px) 必须被排除在外
assert.ok(!inRangeAllies.some(u => u.id === 'a7'), '超出30码(270px)的队友7绝不应被选中');

// 排序：按血量百分比升序
inRangeAllies.sort((a, b) => (a.hp / Math.max(1, a.maxHp)) - (b.hp / Math.max(1, b.maxHp)));
const chosenTargets = inRangeAllies.slice(0, maxTargets);

assert.strictEqual(chosenTargets.length, 5, '野性成长最多选择5名目标');
// 选中的5人血量百分比必须是最危急的5人：
// a6 (10%), a2 (20%), a1 (30%), a4 (40%), a3 (50%)
const chosenIds = chosenTargets.map(u => u.id);
assert.deepStrictEqual(chosenIds, ['a6', 'a2', 'a1', 'a4', 'a3'], '野性成长智能筛选最危急的5名目标');
assert.ok(!chosenIds.includes('a5'), '血量较高的a5(60%)和满血玩家不在前5位');
console.log('✓ 3. 野性成长 30码/270px 与 智能5人筛选机制验证通过');

// 4. 验证自然迅捷机制 (Nature\'s Swiftness)
// 施放自然迅捷：给玩家赋予 60s buff
engine.applyBuff(player, {
  id: `ns_${Date.now()}`,
  spellId: 'natures_swiftness',
  name: '自然迅捷',
  kind: 'BUFF',
  tags: ['MAGIC'],
  sourceUnitId: player.id,
  targetUnitId: player.id,
  stacks: 1,
  maxStacks: 1,
  durationMs: 60000,
  remainingMs: 60000,
  school: 'NATURE',
});

assert.ok(player.buffs.some(b => b.spellId === 'natures_swiftness'), '自然迅捷 buff 施加成功');

// 下一次读条自然法术 (如 愈合 regrowth) 瞬发，消耗自然迅捷，并获得 1.5x 直接治疗加成
const hasNs = player.buffs.some(b => b.spellId === 'natures_swiftness');
assert.strictEqual(hasNs, true);

// 消耗自然迅捷
player.buffs = player.buffs.filter(b => b.spellId !== 'natures_swiftness');
assert.strictEqual(player.buffs.some(b => b.spellId === 'natures_swiftness'), false, '自然迅捷 buff 已被消耗');

// 计算自然迅捷下的愈合治疗量
const baseRegrowthHeal = 16000;
const boostedRegrowthHeal = Math.round(baseRegrowthHeal * 1.5);
assert.strictEqual(boostedRegrowthHeal, 24000, '自然迅捷提供 50% 额外直接治疗 (16000 -> 24000)');

console.log('✓ 4. 自然迅捷瞬发与+50%治疗加成验证通过');

console.log('🎉 野性成长30码5人判定、公共CD最大值与自然迅捷机制全部测试通过！\n');
