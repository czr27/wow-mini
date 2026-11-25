/**
 * 自定义难度大厅规则：不限职业配额 / 不限人数下限；禁超员；
 * AI 补齐仍按默认配额；热加入顶替 AI 优先 T(同职业)→DPS→奶。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RoomManager,
  DEFAULT_CUSTOM_DIFFICULTY,
  validateStartGame,
  hasJoinableSeat,
  pickHotJoinAiReplacement,
} from '../index.js';

describe('自定义难度大厅规则', () => {
  it('1. 人数不足也可开局；职责配比不拦；超员不可', () => {
    const mgr = new RoomManager();
    const room = mgr.createRoom({
      name: '自定义宽松',
      dungeonId: 'shadowfang_keep',
      difficulty: 'CUSTOM',
      customDifficulty: { ...DEFAULT_CUSTOM_DIFFICULTY },
      host: { id: 'h1', name: '房主', classId: 'MAGE', spec: 'FIRE', role: 'DPS' },
    });
    assert.equal(room.members.length, 1);
    const v1 = validateStartGame(room);
    assert.equal(v1.canStart, true, `应可开局: ${v1.reasons.join(';')}`);

    // 人为塞超员
    for (let i = 0; i < 5; i++) {
      room.members.push({
        id: `x${i}`,
        name: `超额${i}`,
        classId: 'MAGE',
        spec: 'FIRE',
        role: 'DPS',
        isPlayer: true,
        isAi: false,
        isHost: false,
        isReady: true,
        slotIndex: 10 + i,
      });
    }
    const v2 = validateStartGame(room);
    assert.equal(v2.canStart, false);
    assert.ok(v2.reasons.some((r) => r.includes('超出')));
  });

  it('2. AI 补齐仍按默认 1T1H3DPS', () => {
    const mgr = new RoomManager();
    const room = mgr.createRoom({
      name: '自定义补齐',
      dungeonId: 'shadowfang_keep',
      difficulty: 'CUSTOM',
      customDifficulty: { ...DEFAULT_CUSTOM_DIFFICULTY },
      host: { id: 'h1', name: '房主奶', classId: 'PRIEST', spec: 'HOLY', role: 'HEALER' },
    });
    mgr.autoFillAi(room.id);
    const r = mgr.getRoom(room.id)!;
    assert.equal(r.members.length, 5);
    assert.equal(r.members.filter((m) => m.role === 'TANK').length, 1);
    assert.equal(r.members.filter((m) => m.role === 'HEALER').length, 1);
    assert.equal(r.members.filter((m) => m.role === 'DPS').length, 3);
  });

  it('2b. replaceExistingAi：踢光旧 AI 后重分配，真人保留', () => {
    const mgr = new RoomManager();
    const room = mgr.createRoom({
      name: '一键重分',
      dungeonId: 'shadowfang_keep',
      difficulty: 'HEROIC',
      host: { id: 'h1', name: '房主坦', classId: 'WARRIOR', spec: 'PROTECTION', role: 'TANK' },
    });
    const first = mgr.autoFillAi(room.id);
    assert.equal(first.addedCount, 4);
    const idsBefore = new Set(mgr.getRoom(room.id)!.members.filter((m) => m.isAi).map((m) => m.id));
    const second = mgr.autoFillAi(room.id, { replaceExistingAi: true });
    assert.equal(second.removedCount, 4);
    assert.equal(second.addedCount, 4);
    const after = mgr.getRoom(room.id)!;
    assert.equal(after.members.length, 5);
    assert.ok(after.members.some((m) => m.id === 'h1' && !m.isAi));
    const idsAfter = after.members.filter((m) => m.isAi).map((m) => m.id);
    assert.equal(idsAfter.length, 4);
    assert.ok(idsAfter.every((id) => !idsBefore.has(id)), '旧 AI id 应全部被替换');
  });

  it('3. 自定义满员时 DPS 优先顶替同职责 AI（不先顶坦）并保持自己职责', () => {
    const mgr = new RoomManager();
    const room = mgr.createRoom({
      name: '自定义热加入',
      dungeonId: 'shadowfang_keep',
      difficulty: 'CUSTOM',
      customDifficulty: { ...DEFAULT_CUSTOM_DIFFICULTY },
      host: { id: 'h1', name: '房主奶', classId: 'PRIEST', spec: 'HOLY', role: 'HEALER' },
    });
    mgr.autoFillAi(room.id);
    assert.equal(room.members.length, 5);
    const dpsAis = room.members.filter((m) => m.isAi && m.role === 'DPS');
    assert.ok(dpsAis.length > 0);
    const dpsAiIds = new Set(dpsAis.map((m) => m.id));
    const tankAi = room.members.find((m) => m.isAi && m.role === 'TANK');
    assert.ok(tankAi);

    const join = mgr.joinOrHotSwapPlayer(room.id, {
      id: 'p_dps',
      name: '法丝',
      classId: 'MAGE',
      spec: 'FIRE',
      role: 'DPS',
    });
    assert.equal(join.ok, true, join.reason);
    assert.equal(join.member?.role, 'DPS');
    assert.ok(
      join.replacedAiId && dpsAiIds.has(join.replacedAiId),
      '满员热加入应优先顶同职责 DPS AI，不先顶坦克'
    );
    assert.ok(room.members.some((m) => m.id === tankAi!.id), '坦克 AI 应保留');
  });

  it('4. pickHotJoinAiReplacement：踢 AI 优先 DPS → 奶 → 坦（同职业优先）', () => {
    const ais = [
      {
        id: 'h1',
        name: '奶',
        classId: 'PRIEST' as const,
        spec: 'HOLY',
        role: 'HEALER' as const,
        isPlayer: false,
        isAi: true,
        isHost: false,
        isReady: true,
        slotIndex: 0,
      },
      {
        id: 'd1',
        name: '输出',
        classId: 'MAGE' as const,
        spec: 'FIRE',
        role: 'DPS' as const,
        isPlayer: false,
        isAi: true,
        isHost: false,
        isReady: true,
        slotIndex: 1,
      },
      {
        id: 't1',
        name: '防战',
        classId: 'WARRIOR' as const,
        spec: 'PROTECTION',
        role: 'TANK' as const,
        isPlayer: false,
        isAi: true,
        isHost: false,
        isReady: true,
        slotIndex: 2,
      },
      {
        id: 't2',
        name: '血DK',
        classId: 'DK' as const,
        spec: 'BLOOD',
        role: 'TANK' as const,
        isPlayer: false,
        isAi: true,
        isHost: false,
        isReady: true,
        slotIndex: 3,
      },
    ];
    const pickHealer = pickHotJoinAiReplacement(ais as any, 'PRIEST', 'HEALER');
    assert.equal(pickHealer?.id, 'd1', '无编制约束时仍先踢 DPS');
    const pickDps = pickHotJoinAiReplacement(ais as any, 'MAGE', 'DPS');
    assert.equal(pickDps?.id, 'd1', '输出加入应顶输出 AI');
    const pickNoPreferred = pickHotJoinAiReplacement(ais as any, 'DK');
    assert.equal(pickNoPreferred?.id, 'd1', '先 DPS，坦最后');
    const pickTankOnly = pickHotJoinAiReplacement(
      ais.filter((a) => a.role === 'TANK') as any,
      'DK',
      'DPS'
    );
    assert.equal(pickTankOnly?.id, 't2', '仅剩坦时同职业坦优先');
  });

  it('5. hasJoinableSeat：真人职责未满且有可踢 AI（编制合法）', () => {
    const mgr = new RoomManager();
    const room = mgr.createRoom({
      name: '座位',
      dungeonId: 'shadowfang_keep',
      difficulty: 'HEROIC',
      host: { id: 'h1', name: '坦', classId: 'DK', spec: 'BLOOD', role: 'TANK' },
    });
    mgr.autoFillAi(room.id);
    assert.equal(room.members.length, 5);
    assert.equal(hasJoinableSeat(room, 'DPS'), true, '有 DPS AI 可顶');
    // 踢光 DPS AI 并封死空席后：踢奶/坦会破 1/1/3 → 不可进
    for (const m of [...room.members]) {
      if (m.isAi && m.role === 'DPS') mgr.kickMember(room.id, m.id);
    }
    for (const s of room.slots) {
      if (!s.occupied) {
        s.occupied = true;
        s.role = 'TANK';
      }
    }
    assert.equal(hasJoinableSeat(room, 'DPS'), false, '无合法可踢 AI 时拒绝');
  });

  it('6. 自定义 startGame 不自动补齐（允许人少开打）', () => {
    const mgr = new RoomManager();
    const room = mgr.createRoom({
      name: '少人开打',
      dungeonId: 'shadowfang_keep',
      difficulty: 'CUSTOM',
      customDifficulty: { ...DEFAULT_CUSTOM_DIFFICULTY },
      host: { id: 'h1', name: '独行', classId: 'ROGUE', spec: 'COMBAT', role: 'DPS' },
    });
    const start = mgr.startGame(room.id, 'h1');
    assert.equal(start.success, true, start.reason);
    assert.equal(mgr.getRoom(room.id)!.members.length, 1);
  });
});
