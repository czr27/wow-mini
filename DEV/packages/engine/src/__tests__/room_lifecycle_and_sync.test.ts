import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RoomManager,
  DEFAULT_CUSTOM_DIFFICULTY,
} from '../index.js';

describe('Room Lifecycle, AI-Only Cleanup, AI Name Sync & Custom Difficulty', () => {
  it('1. 仅含 AI 的房间自动清理，房主退房后无真人房间立即销毁', () => {
    const manager = new RoomManager();
    const room = manager.createRoom({
      name: '测试房主退房销毁',
      dungeonId: 'shadowfang_keep',
      difficulty: 'HEROIC',
      host: { id: 'player_1', name: '提里奥', classId: 'PALADIN', spec: 'HOLY' },
    });
    manager.autoFillAi(room.id);
    assert.strictEqual(manager.listRooms().length, 1);

    // 房主退房后，剩余 4 人全为 AI -> 房间必须立即删除，不可留存
    const res = manager.leaveRoom(room.id, 'player_1');
    assert.strictEqual(res.removed, true);
    assert.strictEqual(res.roomDeleted, true);
    assert.strictEqual(manager.getRoom(room.id), undefined);
    assert.strictEqual(manager.listRooms().length, 0);
  });

  it('2. 人工构造纯 AI 房间在 listRooms / cleanupAiOnlyRooms 时被自动清理', () => {
    const manager = new RoomManager();
    const room = manager.createRoom({
      name: '残余纯AI房间',
      dungeonId: 'shadowfang_keep',
      host: { id: 'player_1', name: '瓦里安', classId: 'WARRIOR', spec: 'ARMS' },
    });
    manager.autoFillAi(room.id);
    // 模拟房主变成 AI（纯 AI 房间）
    room.members.forEach(m => {
      m.isPlayer = false;
      m.isAi = true;
    });
    const visible = manager.listRooms();
    assert.strictEqual(visible.length, 0, '纯 AI 房间不应出现在房间列表中');
    assert.strictEqual(manager.getRoom(room.id), undefined, '纯 AI 房间必须被彻底清理');
  });

  it('3. 切换 AI 职业/专精时，AI 名称、职业、专精、分工同步更新，且支持自由编排 + 开局前统一校验', () => {
    const manager = new RoomManager();
    const room = manager.createRoom({
      name: 'AI改名与自由编排测试',
      dungeonId: 'shadowfang_keep',
      host: { id: 'player_1', name: '提里奥', classId: 'PALADIN', spec: 'HOLY' },
    });
    manager.autoFillAi(room.id);

    const dpsAi = room.members.find(m => m.isAi && m.role === 'DPS');
    assert.ok(dpsAi);

    // 切换为 猎人·射击 -> 名称应自动同步为猎人英雄名（如 希尔瓦娜斯/奥蕾莉亚 等）
    const okHunter = manager.changeMemberSpec(room.id, dpsAi.id, 'HUNTER', 'MARKSMANSHIP', { allowOverQuota: true });
    assert.strictEqual(okHunter, true);
    assert.strictEqual(dpsAi.classId, 'HUNTER');
    assert.strictEqual(dpsAi.spec, 'MARKSMANSHIP');
    assert.strictEqual(dpsAi.role, 'DPS');
    assert.ok(['希尔瓦娜斯', '奥蕾莉亚', '温蕾萨', '雷克萨', '布莱恩', '赫米特'].includes(dpsAi.name), `猎人AI名称应匹配职业: got ${dpsAi.name}`);

    // 自由切换为 战士·防护（此时队伍暂时有 2 坦克，自由编排允许，但开局校验会拦住）
    const okTank = manager.changeMemberSpec(room.id, dpsAi.id, 'WARRIOR', 'PROTECTION', { allowOverQuota: true });
    assert.strictEqual(okTank, true);
    assert.strictEqual(dpsAi.classId, 'WARRIOR');
    assert.strictEqual(dpsAi.role, 'TANK');
    assert.ok(['穆拉丁', '瓦里安', '洛萨之影', '萨鲁法尔', '加尔鲁什', '布洛克斯'].some(n => dpsAi.name.startsWith(n)), `防战AI名称应匹配职业: got ${dpsAi.name}`);

    const invalidStart = manager.validateStartGame(room.id);
    assert.strictEqual(invalidStart.canStart, false, '2坦克阵容开局前校验必须拦截');
    assert.ok(invalidStart.reasons.some(r => r.includes('队伍分工不符合副本要求')));

    // 将其切回 术士·痛苦 -> 阵容恢复 1T 1H 3DPS，开局校验通过
    manager.changeMemberSpec(room.id, dpsAi.id, 'WARLOCK', 'AFFLICTION', { allowOverQuota: true });
    assert.ok(['古尔丹之影', '朱贝卡', '耐奥祖', '威尔弗雷德', '坎雷萨德'].some(n => dpsAi.name.startsWith(n)), `术士AI名称应匹配职业: got ${dpsAi.name}`);
    const validStart = manager.validateStartGame(room.id);
    assert.strictEqual(validStart.canStart, true, '恢复 1T 1H 3DPS 后开局校验必须通过');
  });

  it('3b. 未先点 AI 补齐时 startGame 会自动补齐并开局成功', () => {
    const manager = new RoomManager();
    const room = manager.createRoom({
      name: '开局自动补齐',
      dungeonId: 'shadowfang_keep',
      host: { id: 'player_1', name: '提里奥', classId: 'PALADIN', spec: 'HOLY' },
    });
    assert.ok(room.members.length < 5, '创建后不应已满员');
    const beforeValidate = manager.validateStartGame(room.id);
    assert.strictEqual(beforeValidate.canStart, false);
    assert.ok(beforeValidate.reasons.some((r) => r.includes('未满')));

    const start = manager.startGame(room.id, 'player_1');
    assert.strictEqual(start.success, true, `开局应自动补齐后成功: ${start.reason || ''}`);
    const after = manager.getRoom(room.id)!;
    assert.strictEqual(after.members.length, 5);
    assert.strictEqual(after.status, 'IN_COMBAT');
  });

  it('4. 房间支持创建与切换自定义模式 (CUSTOM) 并保存自定义系数', () => {
    const manager = new RoomManager();
    const customSettings = {
      ...DEFAULT_CUSTOM_DIFFICULTY,
      enemyDamageCoeff: 0.5,
      bossHpCoeff: 0.6,
      playerDamageCoeff: 2.0,
    };
    const room = manager.createRoom({
      name: '自定义模式测试房',
      dungeonId: 'shadowfang_keep',
      difficulty: 'CUSTOM',
      customDifficulty: customSettings,
      host: { id: 'player_1', name: '吉安娜', classId: 'MAGE', spec: 'FIRE' },
    });
    assert.strictEqual(room.difficulty, 'CUSTOM');
    assert.strictEqual(room.customDifficulty?.bossHpCoeff, 0.6);

    // 房主在房内切换为普通模式再切回自定义模式并更新系数
    manager.setRoomDifficulty(room.id, 'NORMAL');
    assert.strictEqual(room.difficulty, 'NORMAL');
    manager.setRoomDifficulty(room.id, 'CUSTOM', { ...customSettings, bossHpCoeff: 2.5 });
    assert.strictEqual(room.difficulty, 'CUSTOM');
    assert.strictEqual(room.customDifficulty?.bossHpCoeff, 2.5);
  });

  it('4b. 祖尔格拉布可选普通难度（血量按英雄÷1.5）', () => {
    const manager = new RoomManager();
    const room = manager.createRoom({
      name: 'ZG普通',
      dungeonId: 'zulgurub',
      difficulty: 'NORMAL',
      host: { id: 'player_1', name: '吉安娜', classId: 'MAGE', spec: 'FIRE' },
    });
    assert.strictEqual(room.difficulty, 'NORMAL');
    manager.setRoomDifficulty(room.id, 'HEROIC');
    assert.strictEqual(room.difficulty, 'HEROIC');
    manager.setRoomDifficulty(room.id, 'NORMAL');
    assert.strictEqual(room.difficulty, 'NORMAL');
  });

  it('5. 房主战斗快照只写入目标房间，多房间互不干扰；SUMMARY 写结算', () => {
    const manager = new RoomManager();
    const roomA = manager.createRoom({
      name: '房间A',
      dungeonId: 'shadowfang_keep',
      host: { id: 'pA', name: 'A', classId: 'MAGE', spec: 'FIRE' },
    });
    const roomB = manager.createRoom({
      name: '房间B',
      dungeonId: 'shadowfang_keep',
      host: { id: 'pB', name: 'B', classId: 'PRIEST', spec: 'HOLY' },
    });
    manager.startGame(roomA.id, 'pA');
    manager.startGame(roomB.id, 'pB');

    manager.applyHostCombatSnapshot(roomA.id, {
      runPhase: 'BOSS_COMBAT',
      currentBossIndex: 0,
      units: [{ id: 'bossA', name: '亚什布里男爵', hp: 500, maxHp: 1000, isBoss: true }],
    });
    manager.applyHostCombatSnapshot(roomB.id, {
      runPhase: 'TRAVEL_RECOVERY',
      travelRemainingMs: 8000,
      currentBossIndex: 1,
    });

    assert.strictEqual(roomA.status, 'IN_COMBAT');
    assert.strictEqual(roomA.inCombatBossName, '亚什布里男爵');
    assert.strictEqual(roomA.inCombatBossHp, 500);
    assert.equal(roomA.runPhase, 'BOSS_COMBAT');

    assert.strictEqual(roomB.status, 'OUT_OF_COMBAT');
    assert.equal(roomB.travelRemainingMs, 8000);
    assert.equal(roomB.currentBossIndex, 1);
    assert.equal(roomB.inCombatBossHp, undefined, '房间B不应吃到房间A的首领血量');

    manager.applyHostCombatSnapshot(roomA.id, {
      runPhase: 'SUMMARY',
      isCleared: true,
      currentBossIndex: 2,
    });
    assert.strictEqual(roomA.status, 'CLEARED');
    // Settled rooms must not linger for lobby / 快速加入
    assert.ok(manager.cleanupSettledRooms() >= 1);
    assert.equal(manager.getRoom(roomA.id), undefined);
    assert.ok(roomA.lastSettlement?.cleared);
    assert.strictEqual(roomB.status, 'OUT_OF_COMBAT', '结算房间A不得改写房间B');
  });
});
