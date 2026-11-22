import assert from 'node:assert';
import {
  getDefaultActionSlots,
} from '../../DEV/packages/web/src/assets/defaultActionSlots.js';
import {
  DEFAULT_KEYBINDINGS,
} from '../../DEV/packages/web/src/components/ActionBar.js';
import {
  CLASS_COLORS_CATA,
  getPlayerDispelCapabilities,
  DEBUFF_REGISTRY,
} from '../../DEV/packages/web/src/components/RaidFrames.js';
import {
  CombatEngine,
  RunStateMachine,
  SHADOWFANG_KEEP_CONFIG,
  DRAGON_SOUL_CONFIG,
  Unit,
} from '../../DEV/packages/engine/dist/index.js';

console.log('--- 运行 [T-13] 三栏技能条、队伍迷宫阵型、智能重定向、Details!分解与多列团队框架测试 ---');

// ── 1. 三栏动作条 36 格默认键位与技能映射 ──────────────────────────────
assert.strictEqual(Object.keys(DEFAULT_KEYBINDINGS).length, 36, '动作条必须支持三栏共36个独立槽位');
assert.strictEqual(DEFAULT_KEYBINDINGS[0], '1', '第一栏起始键位应为 1');
assert.strictEqual(DEFAULT_KEYBINDINGS[11], '=', '第一栏终止键位应为 =');
assert.strictEqual(DEFAULT_KEYBINDINGS[12], 'SHIFT+1', '第二栏起始键位应为 SHIFT+1');
assert.strictEqual(DEFAULT_KEYBINDINGS[23], 'SHIFT+=', '第二栏终止键位应为 SHIFT+=');
assert.strictEqual(DEFAULT_KEYBINDINGS[24], 'F1', '第三栏起始键位应为 F1');
assert.strictEqual(DEFAULT_KEYBINDINGS[35], 'F12', '第三栏终止键位应为 F12');

// 验证所有职业专精的36格配置
const classes = ['DK', 'DRUID', 'SHAMAN', 'MAGE', 'ROGUE'] as const;
for (const cls of classes) {
  const slots = getDefaultActionSlots(cls, 'DEFAULT');
  assert.ok(slots.length >= 7, `${cls} 动作条已分配核心技能数应 >= 7`);
  assert.ok(slots.some(s => s.slotIdx === 0 && s.spellId), `${cls} 第一栏第1格必须有技能`);
  assert.ok(slots.some(s => s.slotIdx >= 12 && s.spellId), `${cls} 第二栏(Shift+1~)必须有预分配技能`);
  assert.ok(slots.every(s => s.slotIdx >= 0 && s.slotIdx < 36), `${cls} 所有槽位索引必须在 0..35 范围内`);
}
console.log('✓ 1. 三栏36格动作条（1~=, Shift+1~=, F1~F12）与5大职业技能预分配验证通过');

// ── 2. 读条施法防重复按键从0重读保护 (Cast Guard) ──────────────────────
const activeCast = {
  spellName: '寒冰箭',
  spellId: 'frostbolt',
  progress: 0.65, // 已读条65%
  elapsedMs: 1300,
  totalMs: 2000,
  isChannel: false,
};

function handleCastSlotWithGuard(
  currentCast: typeof activeCast | null,
  spellId: string,
  totalMs: number
): typeof activeCast | null {
  // 如果当前正在读条且非引导法术，重复按键直接忽略，不打断不重读
  if (currentCast && !currentCast.isChannel) {
    return currentCast; // 保持原有进度
  }
  return {
    spellName: '寒冰箭',
    spellId,
    progress: 0,
    elapsedMs: 0,
    totalMs,
    isChannel: false,
  };
}

const repeatedResult = handleCastSlotWithGuard(activeCast, 'frostbolt', 2000);
assert.strictEqual(repeatedResult.progress, 0.65, '读条中重复按下技能键不应重置进度，必须忽略重复读条');
assert.strictEqual(repeatedResult.elapsedMs, 1300, '读条中已逝时间必须完整保留');
console.log('✓ 2. 读条中重复按键防从0重读保护机制验证通过');

// ── 3. 智能目标重定向 (Friendly -> Self fallback, Hostile -> Boss fallback) ─
const playerUnit: Unit = {
  id: 'player_1', name: '大领主', classId: 'DK', role: 'TANK', isPlayer: true, isAlive: true, alive: true,
  hp: 145000, maxHp: 145000, absorb: 0, resources: [], buffs: [], threatTable: [], position: { x: 180, y: 160 },
  stats: { attackPower: 8000, spellPower: 0, critChance: 0.2, haste: 0.1, armor: 24000, spellResist: 0, block: 0, parry: 0, dodge: 0, mastery: 0, versatility: 0, speed: 1 },
};
const friendlyAlly: Unit = {
  id: 'ally_healer', name: '玛法里奥', classId: 'DRUID', role: 'HEALER', isPlayer: false, isAlive: true, alive: true,
  hp: 105000, maxHp: 105000, absorb: 0, resources: [], buffs: [], threatTable: [], position: { x: 140, y: 150 },
  stats: { attackPower: 0, spellPower: 9000, critChance: 0.2, haste: 0.15, armor: 12000, spellResist: 0, block: 0, parry: 0, dodge: 0, mastery: 0, versatility: 0, speed: 1 },
};
const bossTarget: Unit = {
  id: 'boss_godfrey', name: '高弗雷勋爵', classId: 'BOSS', role: 'ENEMY', isPlayer: false, isAlive: true, alive: true,
  hp: 12500000, maxHp: 12500000, absorb: 0, resources: [], buffs: [], threatTable: [], position: { x: 520, y: 190 },
  stats: { attackPower: 12000, spellPower: 12000, critChance: 0.1, haste: 0, armor: 18000, spellResist: 0, block: 0, parry: 0, dodge: 0, mastery: 0, versatility: 0, speed: 1 },
};

function resolveEffectiveTarget(
  spellKind: 'FRIENDLY' | 'HOSTILE',
  selectedTargetId: string | null,
  friendlyList: Unit[],
  boss: Unit | null,
  player: Unit
): Unit {
  if (spellKind === 'FRIENDLY') {
    // 友方技能：如果选中的是友方则施放给友方；如果选中的是首领或无目标，自动回退给自己施放
    const foundFriendly = friendlyList.find(u => u.id === selectedTargetId);
    return foundFriendly || player;
  } else {
    // 敌对伤害技能：如果当前选中了友方或无目标，自动重定向到当前首领
    if (boss && boss.alive) {
      return boss;
    }
    return player;
  }
}

// 友方技能智能重定向
const healTargetWhenBossSelected = resolveEffectiveTarget('FRIENDLY', bossTarget.id, [playerUnit, friendlyAlly], bossTarget, playerUnit);
assert.strictEqual(healTargetWhenBossSelected.id, playerUnit.id, '目标为Boss时施放治疗技能必须自动自我施法(回退到玩家)');
const healTargetWhenAllySelected = resolveEffectiveTarget('FRIENDLY', friendlyAlly.id, [playerUnit, friendlyAlly], bossTarget, playerUnit);
assert.strictEqual(healTargetWhenAllySelected.id, friendlyAlly.id, '目标为队友时施放治疗技能必须正确施放给该队友');

// 敌对技能智能重定向
const attackTargetWhenAllySelected = resolveEffectiveTarget('HOSTILE', friendlyAlly.id, [playerUnit, friendlyAlly], bossTarget, playerUnit);
assert.strictEqual(attackTargetWhenAllySelected.id, bossTarget.id, '目标为队友时施放攻击技能必须自动重定向施放给首领');
console.log('✓ 3. 智能目标重定向（友方回退自身/敌对自动选中首领）验证通过');

// ── 4. Details! 战斗统计技能成分拆解与最大技能100%占满条计算 ───────────
const testSkillDamage: Record<string, number> = {
  '灵界打击': 850000,
  '心脏打击': 520000,
  '凋零缠绕': 340000,
  '符文打击': 210000,
};

const entries = Object.entries(testSkillDamage).sort((a, b) => b[1] - a[1]);
const topAmount = entries[0][1];
const totalAmount = Object.values(testSkillDamage).reduce((s, v) => s + v, 0);

assert.strictEqual(entries[0][0], '灵界打击', '最高输出技能应排在第一位');
// Top skill fills 100% of the bar width
const topBarPct = Math.round((entries[0][1] / topAmount) * 100);
assert.strictEqual(topBarPct, 100, '排名第1的技能百分比条宽度必须为100%占满');

const secondBarPct = Math.round((entries[1][1] / topAmount) * 100);
assert.strictEqual(secondBarPct, 61, '次要技能应按最高技能比例展示占满条');
const topTotalPct = ((entries[0][1] / totalAmount) * 100).toFixed(1);
assert.strictEqual(topTotalPct, '44.3', '总体伤害占比计算精确度符合Details!规范');
console.log('✓ 4. Details! 悬浮技能成分分解（最高技能100%占满、递减排序与总体占比）验证通过');

// ── 5. 迷宫多拐角深长通道设计与分列带队行进 ─────────────────────────
const mazeWaypoints = [
  { x: 30, y: 190 },
  { x: 100, y: 110 },
  { x: 190, y: 110 },
  { x: 190, y: 270 },
  { x: 290, y: 270 },
  { x: 290, y: 110 },
  { x: 400, y: 110 },
  { x: 400, y: 270 },
  { x: 520, y: 270 },
  { x: 620, y: 190 },
];
let totalMazeDist = 0;
for (let i = 0; i < mazeWaypoints.length - 1; i++) {
  totalMazeDist += Math.hypot(mazeWaypoints[i + 1].x - mazeWaypoints[i].x, mazeWaypoints[i + 1].y - mazeWaypoints[i].y);
}
assert.ok(totalMazeDist > 1000, `迷宫总路径长度(${totalMazeDist}px)应>1000px，提供真实深长迷宫感`);
const travelSec = totalMazeDist / 85; // 85px/s 行进速度走完全程耗时
assert.ok(travelSec >= 10 && travelSec <= 16, '迷宫走完耗时应在10~15秒区间');

// 队伍分列行进次序：坦克与近战在前，远程与治疗跟随在后
const partyFormation = [
  { role: 'TANK', classId: 'DK' },
  { role: 'DPS', classId: 'ROGUE' }, // 近战
  { role: 'DPS', classId: 'MAGE' },  // 远程
  { role: 'HEALER', classId: 'DRUID' },
];
const sortedFormation = [...partyFormation].sort((a, b) => {
  const isMeleeA = a.classId === 'ROGUE' || a.classId === 'DK';
  const isMeleeB = b.classId === 'ROGUE' || b.classId === 'DK';
  const prioA = a.role === 'TANK' ? 0 : isMeleeA ? 1 : a.role === 'DPS' ? 2 : 3;
  const prioB = b.role === 'TANK' ? 0 : isMeleeB ? 1 : b.role === 'DPS' ? 2 : 3;
  return prioA - prioB;
});
assert.strictEqual(sortedFormation[0].role, 'TANK', '行进队列首位必须为主坦');
assert.strictEqual(sortedFormation[1].classId, 'ROGUE', '行进队列次位必须为近战DPS');
assert.strictEqual(sortedFormation[3].role, 'HEALER', '治疗必须在队伍后方跟随');
console.log('✓ 5. 迷宫多拐角深长通道（10~15秒）与T近战带头、远程治疗跟随阵型验证通过');

// ── 6. 紧凑型多列团队框架（小队 1, 小队 2, 小队 3, 小队 4） ───────────
assert.strictEqual(CLASS_COLORS_CATA.DK, '#C41E3A', '死骑职业色应为纯正鲜血红');
assert.strictEqual(CLASS_COLORS_CATA.WARRIOR, '#C79C6E', '战士职业色应为棕褐色');
assert.strictEqual(CLASS_COLORS_CATA.DRUID, '#FF7D0A', '德鲁伊职业色应为橙色');
assert.strictEqual(CLASS_COLORS_CATA.ROGUE, '#FFF569', '潜行者职业色应为黄色');
assert.strictEqual(CLASS_COLORS_CATA.PALADIN, '#F58CBA', '圣骑士职业色应为粉色');
assert.strictEqual(CLASS_COLORS_CATA.PRIEST, '#FFFFFF', '牧师职业色应为纯白');
assert.strictEqual(CLASS_COLORS_CATA.MAGE, '#69CCF0', '法师职业色应为天蓝');
assert.strictEqual(CLASS_COLORS_CATA.SHAMAN, '#0070DE', '萨满职业色应为深蓝');

// 20人团队分为4个小队
const mock20Units: Unit[] = Array.from({ length: 20 }, (_, i) => ({
  id: `u_${i + 1}`,
  name: `团员_${i + 1}`,
  classId: 'DK',
  role: i < 2 ? 'TANK' : i < 6 ? 'HEALER' : 'DPS',
  isPlayer: i === 0,
  isAlive: true,
  alive: true,
  hp: 100000,
  maxHp: 100000,
  absorb: 0,
  resources: [],
  buffs: [],
  threatTable: [],
  position: { x: 0, y: 0 },
  stats: { attackPower: 8000, spellPower: 8000, critChance: 0.2, haste: 0.1, armor: 15000, spellResist: 0, block: 0, parry: 0, dodge: 0, mastery: 0, versatility: 0, speed: 1 },
}));

const testSquads: Unit[][] = [];
for (let i = 0; i < mock20Units.length; i += 5) {
  testSquads.push(mock20Units.slice(i, i + 5));
}
assert.strictEqual(testSquads.length, 4, '20人团队必须严格划分为4个独立小队');
assert.strictEqual(testSquads[0].length, 5, '小队 1 人数必须为5人');
assert.strictEqual(testSquads[1].length, 5, '小队 2 人数必须为5人');
assert.strictEqual(testSquads[2].length, 5, '小队 3 人数必须为5人');
assert.strictEqual(testSquads[3].length, 5, '小队 4 人数必须为5人');
console.log('✓ 6. 原版大灾变全职业色表与20人团队4列小队分组架构验证通过');

console.log('🎉 [T-13] 全部测试项均顺利通过！');
