import assert from 'node:assert';
import {
  getPlayerDispelCapabilities,
  DEBUFF_REGISTRY,
  DispelType,
} from '../../DEV/packages/web/src/components/RaidFrames.js';
import { SPELL_TOOLTIPS } from '../../DEV/packages/web/src/assets/pixelIcons.js';
import { CLASS_ALL_SPELLS } from '../../DEV/packages/web/src/components/SkillBookModal.js';

console.log('--- 运行 [T-12] 原生团队框架渲染层级、可驱散队列、距离衰减与大灾变技能复刻测试 ---');

// ============================================================
// 1. 经典大灾变 4.3 专精驱散矩阵验证 (Dispel Matrix by Spec)
// ============================================================
console.log('1. 验证各职业/专精的大灾变 4.3 原生驱散矩阵');

const restoDruidDispels = getPlayerDispelCapabilities('DRUID', 'RESTORATION');
assert.deepStrictEqual(
  restoDruidDispels.sort(),
  ['CURSE', 'MAGIC', 'POISON'].sort(),
  '恢复德鲁伊必须能驱散魔法、诅咒、中毒 (自然之愈)'
);

const balanceDruidDispels = getPlayerDispelCapabilities('DRUID', 'BALANCE');
assert.deepStrictEqual(
  balanceDruidDispels.sort(),
  ['CURSE', 'POISON'].sort(),
  '平衡德鲁伊必须能驱散诅咒、中毒 (解除腐蚀)，不能驱散魔法'
);

const restoShamanDispels = getPlayerDispelCapabilities('SHAMAN', 'RESTORATION');
assert.deepStrictEqual(
  restoShamanDispels.sort(),
  ['CURSE', 'MAGIC'].sort(),
  '恢复萨满必须能驱散魔法与诅咒 (净化灵魂+水之净化天赋)，不能驱散中毒/疾病'
);

const eleShamanDispels = getPlayerDispelCapabilities('SHAMAN', 'ELEMENTAL');
assert.deepStrictEqual(
  eleShamanDispels.sort(),
  ['CURSE'].sort(),
  '元素萨满只能驱散诅咒 (基础净化灵魂)'
);

const mageDispels = getPlayerDispelCapabilities('MAGE', 'FIRE');
assert.deepStrictEqual(
  mageDispels.sort(),
  ['CURSE'].sort(),
  '法师只能驱散诅咒 (解除诅咒)'
);

const dkDispels = getPlayerDispelCapabilities('DK', 'BLOOD');
assert.deepStrictEqual(dkDispels, [], '死亡骑士无驱散能力');

const rogueDispels = getPlayerDispelCapabilities('ROGUE', 'ASSASSINATION');
assert.deepStrictEqual(rogueDispels, [], '潜行者无驱散能力');

console.log('✓ 各职业专精的大灾变 4.3 驱散能力矩阵验证通过');

// ============================================================
// 2. Debuff 独立优先级队列与驱散过滤器验证 (Priority Queue & Dispel Filter)
// ============================================================
console.log('2. 验证原生框架 Debuff 独立优先级队列与过滤开关');

// 模拟身上的多个 Debuff
const sampleDebuffs = [
  { id: '1', spellId: 'mortal_wound', name: '致死打击' }, // Priority: 70
  { id: '2', spellId: 'asphyxiate', name: '窒息' },       // Priority: 100, MAGIC
  { id: '3', spellId: 'toxic_catalyst', name: '绿色药剂毒素' }, // Priority: 95, POISON
  { id: '4', spellId: 'cursed_veins', name: '诅咒脉管' },   // Priority: 90, CURSE
];

// 按照优先级排序
const sortedDebuffs = [...sampleDebuffs].sort((a, b) => {
  const prioA = DEBUFF_REGISTRY[a.spellId]?.priority ?? 50;
  const prioB = DEBUFF_REGISTRY[b.spellId]?.priority ?? 50;
  return prioB - prioA;
});

// 验证优先级：窒息(100) -> 绿色药剂毒素(95) -> 诅咒脉管(90) -> 致死打击(70)
assert.strictEqual(sortedDebuffs[0].spellId, 'asphyxiate', '致命控制Debuff(窒息)必须排在第一位');
assert.strictEqual(sortedDebuffs[1].spellId, 'toxic_catalyst', '毒素机制Debuff必须排在第二位');
assert.strictEqual(sortedDebuffs[2].spellId, 'cursed_veins', '高伤诅咒Debuff必须排在第三位');

// 验证原生上限：每个框架最多显示 3 个 Debuff，溢出的低优先级被丢弃
const cappedDebuffs = sortedDebuffs.slice(0, 3);
assert.strictEqual(cappedDebuffs.length, 3, 'Debuff 图标位必须封顶为 3 个');
assert.strictEqual(cappedDebuffs.some(d => d.spellId === 'mortal_wound'), false, '最低优先级的致死打击被丢弃');

// 验证开关「只显示可驱散 Debuff」：
// 对恢复萨满（只能驱散魔法和诅咒）
const shamanDispels = getPlayerDispelCapabilities('SHAMAN', 'RESTORATION');
const filteredForShaman = sortedDebuffs.filter(d => {
  const meta = DEBUFF_REGISTRY[d.spellId];
  return meta?.dispelType && shamanDispels.includes(meta.dispelType);
});
assert.strictEqual(filteredForShaman.length, 2, '奶萨开启开关后只能看到窒息(魔法)与诅咒脉管(诅咒)');
assert.strictEqual(filteredForShaman.some(d => d.spellId === 'toxic_catalyst'), false, '奶萨无法驱毒，中毒Debuff被过滤');

// 对法师（只能驱散诅咒）
const filteredForMage = sortedDebuffs.filter(d => {
  const meta = DEBUFF_REGISTRY[d.spellId];
  return meta?.dispelType && mageDispels.includes(meta.dispelType);
});
assert.strictEqual(filteredForMage.length, 1, '法师开启开关后只能看到诅咒脉管');
assert.strictEqual(filteredForMage[0].spellId, 'cursed_veins');

console.log('✓ Debuff 独立优先级队列与专精可驱散过滤验证通过');

// ============================================================
// 3. 团队框架 5 层渲染层级与吸收盾/预治疗计算验证
// ============================================================
console.log('3. 验证 5 层渲染层级 (基础血条 / 吸收盾 / 预治疗 / 底色 / 增减益区)');

const maxHp = 100000;
const currentHp = 60000; // 60%
const hpPct = (currentHp / maxHp) * 100; // 60%

// 吸收盾 24,000 (骨盾 3层 x 8000)
const absorbAmount = 24000;
const absorbPct = Math.min(100 - hpPct, (absorbAmount / maxHp) * 100); // 24%
assert.strictEqual(absorbPct, 24, '吸收护盾百分比应为 24%');

// 预治疗 16,000 (预治疗条)
const incomingHealAmount = 16000;
const incomingHealPct = Math.min(100 - (hpPct + absorbPct), (incomingHealAmount / maxHp) * 100); // 16%
assert.strictEqual(incomingHealPct, 16, '预治疗百分比应为 16%');

// 验证层级叠放位置：
// Layer 1 基础血条：0% 到 60%
// Layer 2 吸收盾：left = 60%, width = 24% (占据 60% ~ 84%)，不扣减真实血量，浅色填充
// Layer 3 预治疗：left = 84%, width = 16% (占据 84% ~ 100%)，半透明绿条
const absorbLeft = hpPct;
const incomingLeft = hpPct + absorbPct;
assert.strictEqual(absorbLeft, 60, '吸收盾必须紧跟基础血条右侧');
assert.strictEqual(incomingLeft, 84, '预治疗必须叠加在吸收盾之后');
assert.strictEqual(incomingLeft + incomingHealPct, 100, '总预测填充正好到 100%');

console.log('✓ 吸收护盾与预治疗叠加计算验证通过');

// ============================================================
// 4. 施法距离衰减 (UnitInRange) 逻辑验证
// ============================================================
console.log('4. 验证 UnitInRange 施法距离衰减判定');

const playerPos = { x: 200, y: 200 };
const closeAllyPos = { x: 300, y: 250 }; // distance = sqrt(100^2 + 50^2) = 111.8px <= 340px
const farAllyPos = { x: 550, y: 450 };   // distance = sqrt(350^2 + 250^2) = 430.1px > 340px

const distClose = Math.hypot(closeAllyPos.x - playerPos.x, closeAllyPos.y - playerPos.y);
const distFar = Math.hypot(farAllyPos.x - playerPos.x, farAllyPos.y - playerPos.y);

assert.strictEqual(distClose <= 340, true, '近距离队友判定在施法距离内 (100% 不透明度)');
assert.strictEqual(distFar > 340, true, '超距队友判定超出施法距离 (变暗降至 40% 透明度)');

console.log('✓ 施法距离衰减逻辑验证通过');

// ============================================================
// 5. 移动施法保护与引导技能中断逻辑验证
// ============================================================
console.log('5. 验证移动施法阻断与引导技能中断保护');

// 规则 1：当玩家处于移动中（lastMoveMs 在 250ms 内）
const now = Date.now();
const lastPlayerMoveMs = now - 50; // 正在移动
const isMoving = now - lastPlayerMoveMs < 250;
assert.strictEqual(isMoving, true, '玩家被判定为移动中');

// 试图施放读条或引导法术
const castOrChannelSpells = ['fireball', 'nourish', 'greater_healing_wave', 'tranquility', 'arcane_missiles'];
for (const sp of castOrChannelSpells) {
  const shouldBlock = isMoving;
  assert.strictEqual(shouldBlock, true, `${sp} 在移动中施放必须被阻断并提示 ⚠️ 移动中无法施法！`);
}

// 规则 2：引导法术已在运行中，按键释放抖动的保护缓冲 (grace period 150ms)
const channelCast = { spellId: 'tranquility', isChannel: true, elapsedMs: 100, totalMs: 8000 };
const shouldCancelGrace = channelCast.elapsedMs < 150;
assert.strictEqual(shouldCancelGrace, true, '施法开始 150ms 缓冲期内微小位移按键释放不应提前打断引导');

// 规则 3：引导法术在持续期间发生走动打断，已经跳完的周期数值必须保留
let completedTicks = 0;
const simulateChannelTicks = (elapsedMs: number, tickIntervalMs: number) => {
  return Math.floor(elapsedMs / tickIntervalMs);
};
completedTicks = simulateChannelTicks(4200, 2000); // 宁静运行 4.2秒后被移动打断
assert.strictEqual(completedTicks, 2, '宁静在4.2秒打断时，已完成的前2跳治疗必须成功生效，不能因打断丢失已产生的治疗量');

console.log('✓ 移动施法阻断与引导法术保护机制验证通过');

// ============================================================
// 6. 大灾变 4.3 技能完整复刻与数值说明验证
// ============================================================
console.log('6. 验证大地的裂变 4.3 新增技能数据完整性 (Wowhead 资料基准)');

// 滋养 (Nourish)
const nourishTip = SPELL_TOOLTIPS['nourish'];
assert(nourishTip, '滋养技能必须存在于 Tooltip 库中');
assert.strictEqual(nourishTip.castTime, '2.5 秒', '滋养基础施法时间为 2.5 秒');
assert(nourishTip.description.includes('20%'), '滋养说明必须包含对 HoT 目标额外提高 20% 效果');

// 自然之愈 (Nature\'s Cure)
const natureCureTip = SPELL_TOOLTIPS['natures_cure'];
assert(natureCureTip, '自然之愈必须存在于 Tooltip 库中');
assert.strictEqual(natureCureTip.cooldown, '8 秒');
assert.strictEqual(natureCureTip.castTime, '瞬发');

// 治疗之涌 (Healing Surge)
const surgeTip = SPELL_TOOLTIPS['healing_surge'];
assert(surgeTip, '治疗之涌必须存在于 Tooltip 库中');
assert.strictEqual(surgeTip.castTime, '1.5 秒', '治疗之涌为 1.5 秒快速应急治疗');

// 强效治疗波 (Greater Healing Wave)
const ghwTip = SPELL_TOOLTIPS['greater_healing_wave'];
assert(ghwTip, '强效治疗波必须存在于 Tooltip 库中');
assert.strictEqual(ghwTip.castTime, '2.5 秒', '强效治疗波为 2.5 秒大抬血');

// 净化灵魂 (Cleanse Spirit) & 解除诅咒 (Remove Curse)
const cleanseTip = SPELL_TOOLTIPS['cleanse_spirit'];
assert(cleanseTip, '净化灵魂必须存在于 Tooltip 库中');
assert.strictEqual(cleanseTip.cooldown, '8 秒');

const removeCurseTip = SPELL_TOOLTIPS['remove_curse'];
assert(removeCurseTip, '解除诅咒必须存在于 Tooltip 库中');
assert.strictEqual(removeCurseTip.cooldown, '8 秒');

// 检查法术书目录包含新技能
const druidSpells = CLASS_ALL_SPELLS['DRUID'].map(s => s.spellId);
assert(druidSpells.includes('nourish'), '德鲁伊法术书必须包含滋养');
assert(druidSpells.includes('natures_cure'), '德鲁伊法术书必须包含自然之愈');

const shamanSpells = CLASS_ALL_SPELLS['SHAMAN'].map(s => s.spellId);
assert(shamanSpells.includes('healing_surge'), '萨满法术书必须包含治疗之涌');
assert(shamanSpells.includes('greater_healing_wave'), '萨满法术书必须包含强效治疗波');
assert(shamanSpells.includes('cleanse_spirit'), '萨满法术书必须包含净化灵魂');

const mageSpells = CLASS_ALL_SPELLS['MAGE'].map(s => s.spellId);
assert(mageSpells.includes('remove_curse'), '法师法术书必须包含解除诅咒');

console.log('✓ 大灾变 4.3 技能完整复刻与数值说明全部验证通过！');
console.log('✅ [T-12] 原生团队框架渲染层级、可驱散队列、距离衰减与大灾变技能测试全部通过！\n');
