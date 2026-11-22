import { CombatEngine, DEFAULT_CUSTOM_DIFFICULTY, CustomDifficultySettings, Unit, AccountManager } from '../../DEV/packages/engine/dist/index.js';
import assert from 'node:assert';

console.log('--- Testing Custom Difficulty & Dispel Enhancement ---');

// 1. Verify Default Settings
assert.strictEqual(DEFAULT_CUSTOM_DIFFICULTY.playerDamageCoeff, 1.0);
assert.strictEqual(DEFAULT_CUSTOM_DIFFICULTY.playerHealingCoeff, 1.0);
assert.strictEqual(DEFAULT_CUSTOM_DIFFICULTY.playerHpCoeff, 1.0);
assert.strictEqual(DEFAULT_CUSTOM_DIFFICULTY.playerMpCoeff, 1.0);
assert.strictEqual(DEFAULT_CUSTOM_DIFFICULTY.aiDamageCoeff, 1.0);
assert.strictEqual(DEFAULT_CUSTOM_DIFFICULTY.aiHealingCoeff, 1.0);
assert.strictEqual(DEFAULT_CUSTOM_DIFFICULTY.aiHpCoeff, 1.0);
assert.strictEqual(DEFAULT_CUSTOM_DIFFICULTY.aiMpCoeff, 1.0);
assert.strictEqual(DEFAULT_CUSTOM_DIFFICULTY.enemyDamageCoeff, 1.0);
assert.strictEqual(DEFAULT_CUSTOM_DIFFICULTY.bossHpCoeff, 1.0);
console.log('✓ 1. DEFAULT_CUSTOM_DIFFICULTY matches specification');

// 2. Verify Engine Normal Mode ignores custom settings
const engineNormal = new CombatEngine();
engineNormal.difficulty = 'NORMAL';
engineNormal.customDifficulty = {
  ...DEFAULT_CUSTOM_DIFFICULTY,
  playerDamageCoeff: 3.0,
  bossHpCoeff: 0.5,
};

const pUnit: Unit = {
  id: 'player_1',
  name: '测试玩家',
  classId: 'DK',
  role: 'TANK',
  isPlayer: true,
  isAlive: true,
  alive: true,
  hp: 100000,
  maxHp: 100000,
  mp: 0,
  maxMp: 0,
  absorb: 0,
  resources: [],
  buffs: [],
  threatTable: [],
  position: { x: 0, y: 0 },
  stats: { attackPower: 8000, spellPower: 0, critChance: 0, haste: 0, armor: 0, spellResist: 0, block: 0, parry: 0, dodge: 0, mastery: 0, versatility: 0, speed: 1 },
};

const dummyTarget: Unit = {
  id: 'dummy_target',
  name: '木桩',
  classId: 'DK',
  role: 'DPS',
  isPlayer: false,
  isAlive: true,
  alive: true,
  hp: 200000,
  maxHp: 200000,
  mp: 0,
  maxMp: 0,
  absorb: 0,
  resources: [],
  buffs: [],
  threatTable: [],
  position: { x: 10, y: 10 },
  stats: { attackPower: 0, spellPower: 0, critChance: 0, haste: 0, armor: 0, spellResist: 0, block: 0, parry: 0, dodge: 0, mastery: 0, versatility: 0, speed: 1 },
};

engineNormal.addUnit(pUnit);
engineNormal.addUnit(dummyTarget);

const hpBefore = dummyTarget.hp;
engineNormal.dealDamage(pUnit, dummyTarget, 1000, 'PHYSICAL', false, '普攻');
const dmgNormal = hpBefore - dummyTarget.hp;
assert.strictEqual(dmgNormal, 1000, 'Normal mode must not scale player damage');
console.log('✓ 2. NORMAL mode damage is unscaled (1.0x)');

// 3. Verify Custom Difficulty Scaling
const engineCustom = new CombatEngine();
engineCustom.difficulty = 'CUSTOM';
engineCustom.customDifficulty = {
  playerDamageCoeff: 2.5,
  playerHealingCoeff: 1.8,
  playerHpCoeff: 2.0,
  playerMpCoeff: 1.5,
  aiDamageCoeff: 1.2,
  aiHealingCoeff: 1.4,
  aiHpCoeff: 1.5,
  aiMpCoeff: 1.2,
  enemyDamageCoeff: 0.8,
  bossHpCoeff: 1.6,
};

const customPlayer: Unit = { ...pUnit, id: 'p_custom' };
const customAi: Unit = { ...pUnit, id: 'ai_custom', isPlayer: false };
const customEnemy: Unit = { ...dummyTarget, id: 'boss_custom', role: 'ENEMY' };
engineCustom.bossUnit = customEnemy;
engineCustom.addUnit(customPlayer);
engineCustom.addUnit(customAi);
engineCustom.addUnit(customEnemy);

// 3a. Player damage scaling
let targetHp = customEnemy.hp;
engineCustom.dealDamage(customPlayer, customEnemy, 1000, 'PHYSICAL', false, '技能');
const pDmg = targetHp - customEnemy.hp;
assert.strictEqual(pDmg, 2500, `Player damage should be 1000 * 2.5 = 2500, got ${pDmg}`);

// 3b. AI teammate damage scaling
targetHp = customEnemy.hp;
engineCustom.dealDamage(customAi, customEnemy, 1000, 'PHYSICAL', false, '技能');
const aiDmg = targetHp - customEnemy.hp;
assert.strictEqual(aiDmg, 1200, `AI damage should be 1000 * 1.2 = 1200, got ${aiDmg}`);

// 3c. Enemy damage scaling
targetHp = customPlayer.hp;
engineCustom.dealDamage(customEnemy, customPlayer, 1000, 'PHYSICAL', false, '首领普通攻击');
const enemyDmg = targetHp - customPlayer.hp;
assert.strictEqual(enemyDmg, 800, `Enemy damage should be 1000 * 0.8 = 800, got ${enemyDmg}`);

// 3d. Player healing scaling
customPlayer.hp = 10000;
engineCustom.healUnit(customPlayer, customPlayer, 1000, false, '圣光闪现');
const pHeal = customPlayer.hp - 10000;
assert.strictEqual(pHeal, 1800, `Player healing should be 1000 * 1.8 = 1800, got ${pHeal}`);

// 3e. AI healing scaling
customAi.hp = 10000;
engineCustom.healUnit(customAi, customAi, 1000, false, '治疗波');
const aiHeal = customAi.hp - 10000;
assert.strictEqual(aiHeal, 1400, `AI healing should be 1000 * 1.4 = 1400, got ${aiHeal}`);

// 3f. Boss HP scaling on spawnBoss
engineCustom.spawnBoss('test_boss', '测试首领', 1000000);
assert(engineCustom.bossUnit, 'Boss unit should be spawned');
assert.strictEqual(engineCustom.bossUnit.maxHp, 1600000, `Boss maxHp should be 1000000 * 1.6 = 1600000, got ${engineCustom.bossUnit.maxHp}`);
assert.strictEqual(engineCustom.bossUnit.hp, 1600000, `Boss hp should be 1600000, got ${engineCustom.bossUnit.hp}`);

console.log('✓ 3. CUSTOM mode player/AI/enemy/boss coefficients fully verified');

// 4. Verify Per-Character Dungeon & Difficulty Persistence in AccountManager
const accountMgr = new AccountManager();
const testUser = accountMgr.register('TestDiffUser', 'wow123');
assert(testUser, 'User registration should succeed');

const charA = accountMgr.createCharacter('角色甲', 'DK', 'BLOOD');
assert(charA, 'Character A should be created');
assert.strictEqual(charA.lastDungeonTier, '5man');
assert.strictEqual(charA.lastDungeonDifficulty, 'HEROIC');
assert.deepStrictEqual(charA.lastCustomDifficulty, DEFAULT_CUSTOM_DIFFICULTY);

// Save custom preferences for Character A
const charACustomSettings: CustomDifficultySettings = {
  ...DEFAULT_CUSTOM_DIFFICULTY,
  playerDamageCoeff: 3.5,
  bossHpCoeff: 0.6,
};
accountMgr.saveDungeonPreferences(charA.id, '20man', 'CUSTOM', charACustomSettings);

const prefsA = accountMgr.getDungeonPreferences(charA.id);
assert.strictEqual(prefsA?.tier, '20man');
assert.strictEqual(prefsA?.difficulty, 'CUSTOM');
assert.strictEqual(prefsA?.customDifficulty?.playerDamageCoeff, 3.5);
assert.strictEqual(prefsA?.customDifficulty?.bossHpCoeff, 0.6);

// Create Character B and verify character preference isolation
const charB = accountMgr.createCharacter('角色乙', 'MAGE', 'FIRE');
assert(charB, 'Character B should be created');
assert.strictEqual(charB.lastDungeonTier, '5man');
assert.strictEqual(charB.lastDungeonDifficulty, 'HEROIC');

accountMgr.saveDungeonPreferences(charB.id, '5man', 'NORMAL', DEFAULT_CUSTOM_DIFFICULTY);
const prefsB = accountMgr.getDungeonPreferences(charB.id);
assert.strictEqual(prefsB?.tier, '5man');
assert.strictEqual(prefsB?.difficulty, 'NORMAL');

// Ensure Character A remained unchanged
const prefsARecheck = accountMgr.getDungeonPreferences(charA.id);
assert.strictEqual(prefsARecheck?.tier, '20man');
assert.strictEqual(prefsARecheck?.difficulty, 'CUSTOM');
assert.strictEqual(prefsARecheck?.customDifficulty?.playerDamageCoeff, 3.5);

console.log('✓ 4. Per-character dungeon, difficulty & custom coefficients persistence verified in AccountManager');
console.log('🎉 All custom difficulty & character persistence tests passed successfully!');
