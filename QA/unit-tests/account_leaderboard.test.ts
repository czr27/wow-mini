import assert from 'node:assert';
import {
  AccountManager,
  LeaderboardManager,
  ReportManager,
  SHADOWFANG_KEEP_CONFIG,
  CombatEngine,
  RunStateMachine,
  getDefaultSpecKeybindings,
} from '../../DEV/packages/engine/dist/index.js';

export function runAccountAndLeaderboardTests() {
  console.log('--- 运行 [T-05] 账号、角色、快捷键习惯与世界排行榜测试 ---');

  const accMgr = new AccountManager();
  const lbMgr = new LeaderboardManager();
  const repMgr = new ReportManager();

  // Test 1: User Registration & Login
  const username = `Hero_${Date.now()}`;
  const registered = accMgr.register(username, 'pass123');
  assert.ok(registered, '用户应成功注册');
  assert.strictEqual(registered.username, username);

  const loggedIn = accMgr.login(username, 'pass123');
  assert.ok(loggedIn, '用户应成功登录');
  assert.strictEqual(accMgr.getCurrentAccount()?.username, username);

  // Test 2: Character Creation
  const char1 = accMgr.createCharacter('阿尔萨斯', 'DK', 'BLOOD');
  assert.ok(char1, '角色1（DK）应创建成功');
  assert.strictEqual(char1.name, '阿尔萨斯');
  assert.strictEqual(char1.classId, 'DK');
  assert.strictEqual(char1.lastSpec, 'BLOOD');

  const char2 = accMgr.createCharacter('泰兰德', 'DRUID', 'RESTORATION');
  assert.ok(char2, '角色2（德鲁伊）应创建成功');
  assert.strictEqual(char2.classId, 'DRUID');

  const curAcc = accMgr.getCurrentAccount();
  assert.strictEqual(curAcc?.characters.length, 2, '当前账号下应有2名角色');

  // Test 3: Per-spec Keybinding Habits
  // Set DK Blood keybinding
  accMgr.saveSpecKeybinding(char1.id, 'BLOOD', 0, '1');
  accMgr.saveSpecKeybinding(char1.id, 'BLOOD', 4, 'F'); // Mind freeze on F

  // Switch to Frost spec and configure different keybinding habit
  accMgr.setCharacterSpec(char1.id, 'FROST');
  assert.strictEqual(char1.lastSpec, 'FROST', '角色当前天赋应更新为FROST');
  accMgr.saveSpecKeybinding(char1.id, 'FROST', 0, 'Q'); // Obliterate on Q for Frost
  accMgr.saveSpecKeybinding(char1.id, 'FROST', 4, 'E');

  // Verify that Frost keybindings and Blood keybindings are independently preserved
  assert.strictEqual(char1.specKeybindings['BLOOD'][0], '1', '鲜血天赋快捷键习惯槽位0应为1');
  assert.strictEqual(char1.specKeybindings['BLOOD'][4], 'F', '鲜血天赋快捷键习惯槽位4应为F');
  assert.strictEqual(char1.specKeybindings['FROST'][0], 'Q', '冰霜天赋快捷键习惯槽位0应为Q');
  assert.strictEqual(char1.specKeybindings['FROST'][4], 'E', '冰霜天赋快捷键习惯槽位4应为E');
  console.log('✓ 独立天赋快捷键习惯记忆与持久化验证通过');

  // Test 4: Dungeon Clear Certificate Generation & Viewing
  const dummyEncounters = [
    {
      bossIndex: 0,
      bossId: 'ashbury',
      bossName: '亚什布里男爵',
      result: 'KILL' as const,
      durationSec: 48.5,
      wipesBeforeKill: 0,
      unitStats: [
        {
          unitId: 'p1',
          name: '阿尔萨斯',
          classId: 'DK',
          role: 'TANK',
          isPlayer: true,
          totalDamage: 520000,
          dps: 10721,
          totalHealing: 680000,
          hps: 14020,
          overhealPct: 15.2,
          damageTaken: 450000,
          interrupts: 3,
          deaths: 0,
        },
      ],
    },
    {
      bossIndex: 4,
      bossId: 'godfrey',
      bossName: '高弗雷勋爵',
      result: 'KILL' as const,
      durationSec: 82.0,
      wipesBeforeKill: 1,
      unitStats: [
        {
          unitId: 'p1',
          name: '阿尔萨斯',
          classId: 'DK',
          role: 'TANK',
          isPlayer: true,
          totalDamage: 850000,
          dps: 10365,
          totalHealing: 920000,
          hps: 11219,
          overhealPct: 18.0,
          damageTaken: 620000,
          interrupts: 4,
          deaths: 0,
        },
      ],
    },
  ];

  const cert = repMgr.createClearCertificate(
    'shadowfang_keep',
    '影牙城堡（英雄模式）',
    char1.name,
    char1.classId,
    char1.lastSpec,
    130.5,
    dummyEncounters
  );

  assert.ok(cert.id.startsWith('cert_'), '通关证明应有唯一ID');
  assert.strictEqual(cert.characterName, '阿尔萨斯');
  assert.strictEqual(cert.encounters.length, 2);
  assert.ok(cert.characterStats.dps > 0, '通关证明应计算总DPS');
  assert.ok(cert.characterStats.effectiveHealing > 0, '通关证明应包含有效治疗数据');

  // Add certificate to character
  accMgr.addClearCertificate(char1.id, cert);
  assert.strictEqual(char1.clearCertificates.length, 1, '角色背包中应存入1张通关证明');
  console.log('✓ 副本通关证明奖励生成与背包存储验证通过');

  // Test 5: World Leaderboards Submission & Querying
  lbMgr.submitRunCertificate(cert);

  // Check Fast Kill Leaderboard
  const fastKillsAshbury = lbMgr.getLeaderboard('FAST_KILL', { bossId: 'ashbury' });
  assert.ok(fastKillsAshbury.length > 0, '亚什布里击杀榜应有记录');
  const ashburyPlayerRecord = fastKillsAshbury.find(e => e.characterName === '阿尔萨斯');
  assert.ok(ashburyPlayerRecord, '击杀榜中应包含玩家阿尔萨斯的击杀成绩');
  assert.strictEqual(ashburyPlayerRecord.value, 48.5);

  // Check Max DPS Leaderboard
  const dpsRanks = lbMgr.getLeaderboard('MAX_DPS');
  assert.ok(dpsRanks.length > 0, '最高DPS榜应有数据');
  const dpsPlayerRecord = dpsRanks.find(e => e.characterName === '阿尔萨斯');
  assert.ok(dpsPlayerRecord, 'DPS榜应包含玩家成绩');

  // Check Effective HPS Leaderboard
  const hpsRanks = lbMgr.getLeaderboard('MAX_EFFECTIVE_HPS');
  assert.ok(hpsRanks.length > 0, '有效治疗榜应有数据');
  const hpsPlayerRecord = hpsRanks.find(e => e.characterName === '阿尔萨斯');
  assert.ok(hpsPlayerRecord, '有效治疗榜应包含玩家非overheal治疗数据');

  // Check Class Filter
  const dkDpsRanks = lbMgr.getLeaderboard('MAX_DPS', { classId: 'DK' });
  assert.ok(dkDpsRanks.every(r => r.characterClass === 'DK'), 'DK职业筛选应仅返回DK角色');

  console.log('✓ 世界排名（最快击杀/最高输出/最高有效治疗）提报与筛选验证通过');

  // Test 6: Character Deletion
  const deleteResult = accMgr.deleteCharacter(char2.id);
  assert.strictEqual(deleteResult, true, '角色2应成功删除');
  assert.strictEqual(accMgr.getCurrentAccount()?.characters.length, 1, '删除后账号下应剩余1名角色');
  console.log('✓ 角色新建与删除生命周期验证通过');

  console.log('✅ 所有账号、角色、快捷键习惯、通关证明与世界排行榜用例全部通过！\n');
}
