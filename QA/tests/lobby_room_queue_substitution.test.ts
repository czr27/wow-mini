import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  RoomManager,
  validateMapSwitch,
  validateStartGame,
  buildDefaultSlots,
  DUNGEON_ROLE_QUOTAS,
} from '../../DEV/packages/engine/src/room/index.js';
import { CombatEngine } from '../../DEV/packages/engine/src/engine/CombatEngine.js';
import { RunStateMachine, SHADOWFANG_KEEP_CONFIG, DRAGON_SOUL_CONFIG } from '../../DEV/packages/engine/src/engine/RunStateMachine.js';
import { ReportManager } from '../../DEV/packages/engine/src/engine/ReportManager.js';

describe('T-17 CF-Style Lobby, Room Management & Waiting Queue Substitution (仿CF房间逻辑、槽位约束与等待替补测试)', () => {

  // =========================================================================
  // Sub-Suite 1: 房间创建与槽位分工约束 (Room Creation & Slot Composition)
  // =========================================================================
  describe('1. 房间创建与槽位分工约束', () => {
    it('Case 1.1: 影牙城堡房间创建：严格生成 1T 1H 3DPS 槽位结构 (共5槽)', () => {
      const manager = new RoomManager();
      const room = manager.createRoom({
        name: '影牙英雄刷装队',
        dungeonId: 'shadowfang_keep',
        difficulty: 'HEROIC',
        host: { id: 'host_1', name: '阿尔萨斯', classId: 'DK', spec: 'BLOOD' },
      });

      assert.strictEqual(room.dungeonId, 'shadowfang_keep');
      assert.strictEqual(room.slots.length, 5, '影牙城堡必须严格生成 5 个槽位');

      const tanks = room.slots.filter(s => s.role === 'TANK').length;
      const healers = room.slots.filter(s => s.role === 'HEALER').length;
      const dps = room.slots.filter(s => s.role === 'DPS').length;

      assert.strictEqual(tanks, 1, '必须正好有 1 个坦克槽位');
      assert.strictEqual(healers, 1, '必须正好有 1 个治疗槽位');
      assert.strictEqual(dps, 3, '必须正好有 3 个输出槽位');
    });

    it('Case 1.2: 巨龙之魂房间创建：严格生成 2T 4-5H 13-14DPS 槽位结构 (共20槽)', () => {
      const manager = new RoomManager();
      const room = manager.createRoom({
        name: '巨龙之魂开荒全通团',
        dungeonId: 'dragon_soul',
        difficulty: 'HEROIC',
        host: { id: 'host_1', name: '阿尔萨斯', classId: 'DK', spec: 'BLOOD' },
      });

      assert.strictEqual(room.dungeonId, 'dragon_soul');
      assert.strictEqual(room.slots.length, 20, '巨龙之魂必须严格生成 20 个槽位');

      const tanks = room.slots.filter(s => s.role === 'TANK').length;
      const healers = room.slots.filter(s => s.role === 'HEALER').length;
      const dps = room.slots.filter(s => s.role === 'DPS').length;

      assert.strictEqual(tanks, 2, '坦克槽位必须为 2');
      assert.ok(healers === 4 || healers === 5, '治疗槽位必须为 4 或 5');
      assert.ok(dps === 13 || dps === 14, '输出槽位必须为 13 或 14');
      assert.strictEqual(tanks + healers + dps, 20, '总槽位数必须正好为 20');
    });

    it('Case 1.3: 房主创建房间后，自身角色根据专精自动归入匹配分工的第1槽位', () => {
      const manager = new RoomManager();

      // DPS 房主 (法师 火焰)
      const mageRoom = manager.createRoom({
        name: '法师带队',
        dungeonId: 'shadowfang_keep',
        host: { id: 'p_mage', name: '卡德加徒弟', classId: 'MAGE', spec: 'FIRE' },
      });
      const mageHost = mageRoom.members[0];
      assert.strictEqual(mageHost.role, 'DPS');
      assert.strictEqual(mageHost.slotIndex, 2, 'DPS房主应自动归入首个DPS槽位 (槽位2)');
      assert.strictEqual(mageRoom.slots[2].occupied, true);
      assert.strictEqual(mageRoom.slots[2].member?.id, 'p_mage');

      // TANK 房主 (DK 鲜血)
      const dkRoom = manager.createRoom({
        name: 'DKT带队',
        dungeonId: 'shadowfang_keep',
        host: { id: 'p_dk', name: '主坦莫格', classId: 'DK', spec: 'BLOOD' },
      });
      const dkHost = dkRoom.members[0];
      assert.strictEqual(dkHost.role, 'TANK');
      assert.strictEqual(dkHost.slotIndex, 0, 'TANK房主应自动归入坦克槽位 (槽位0)');

      // HEALER 房主 (德鲁伊 恢复)
      const druidRoom = manager.createRoom({
        name: '奶德带队',
        dungeonId: 'shadowfang_keep',
        host: { id: 'p_druid', name: '玛法里奥迷弟', classId: 'DRUID', spec: 'RESTORATION' },
      });
      const druidHost = druidRoom.members[0];
      assert.strictEqual(druidHost.role, 'HEALER');
      assert.strictEqual(druidHost.slotIndex, 1, 'HEALER房主应自动归入治疗槽位 (槽位1)');
    });

    it('Case 1.4: 难度模式（NORMAL/HEROIC）在房间创建及元数据中正确绑定与持久化', () => {
      const manager = new RoomManager();

      const normalRoom = manager.createRoom({
        name: '普通影牙速推',
        dungeonId: 'shadowfang_keep',
        difficulty: 'NORMAL',
        host: { id: 'h1', name: '房主1', classId: 'DK', spec: 'BLOOD' },
      });
      assert.strictEqual(normalRoom.difficulty, 'NORMAL', '难度必须正确记录为 NORMAL');

      const heroicRoom = manager.createRoom({
        name: '英雄巨龙开荒',
        dungeonId: 'dragon_soul',
        difficulty: 'HEROIC',
        host: { id: 'h2', name: '房主2', classId: 'DK', spec: 'BLOOD' },
      });
      assert.strictEqual(heroicRoom.difficulty, 'HEROIC', '难度必须正确记录为 HEROIC');
    });
  });

  // =========================================================================
  // Sub-Suite 2: AI 成员增删、一键补齐与专精选择置灰
  // =========================================================================
  describe('2. AI 成员增删、一键补齐与专精选择置灰', () => {
    it('Case 2.1: 房主点击“一键添加 AI”，精准补齐各分工缺额槽位至副本要求上限', () => {
      const manager = new RoomManager();
      const room = manager.createRoom({
        name: '一键补全测试',
        dungeonId: 'shadowfang_keep',
        host: { id: 'h1', name: '房主坦', classId: 'DK', spec: 'BLOOD' },
      });

      assert.strictEqual(room.members.length, 1);
      const res = manager.autoFillAi(room.id);
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.addedCount, 4);

      assert.strictEqual(room.members.length, 5);
      const tanks = room.members.filter(m => m.role === 'TANK').length;
      const healers = room.members.filter(m => m.role === 'HEALER').length;
      const dps = room.members.filter(m => m.role === 'DPS').length;

      assert.strictEqual(tanks, 1, '补齐后必须正好 1 坦克');
      assert.strictEqual(healers, 1, '补齐后必须正好 1 治疗');
      assert.strictEqual(dps, 3, '补齐后必须正好 3 输出');
    });

    it('Case 2.2: 所有新添加的 AI 成员状态强制且始终保持 isReady === true', () => {
      const manager = new RoomManager();
      const room = manager.createRoom({
        name: 'AI准备就绪测试',
        dungeonId: 'shadowfang_keep',
        host: { id: 'h1', name: '房主坦', classId: 'DK', spec: 'BLOOD' },
      });

      manager.autoFillAi(room.id);
      const ais = room.members.filter(m => m.isAi);
      assert.strictEqual(ais.length, 4);
      for (const ai of ais) {
        assert.strictEqual(ai.isReady, true, `AI 成员 ${ai.name} 状态必须恒为已准备`);
      }
    });

    it('Case 2.3: 房主可主动踢出 AI 成员，槽位释放为 open 状态', () => {
      const manager = new RoomManager();
      const room = manager.createRoom({
        name: '踢出AI测试',
        dungeonId: 'shadowfang_keep',
        host: { id: 'h1', name: '房主坦', classId: 'DK', spec: 'BLOOD' },
      });
      manager.autoFillAi(room.id);

      const aiMember = room.members.find(m => m.isAi);
      assert.ok(aiMember, '必须找到一个 AI 成员');
      const targetSlotIndex = aiMember.slotIndex;

      const kicked = manager.kickMember(room.id, aiMember.id);
      assert.strictEqual(kicked, true, '踢出 AI 必须成功');
      assert.strictEqual(room.members.length, 4);

      const slot = room.slots.find(s => s.index === targetSlotIndex);
      assert.ok(slot);
      assert.strictEqual(slot?.occupied, false, '槽位必须被释放为 open 状态');
      assert.strictEqual(slot?.member, undefined);
    });

    it('Case 2.4: 房主修改 AI 专精：当目标专精对应分工已达上限时，该专精选项返回 disabled=true 与置灰原因', () => {
      const manager = new RoomManager();
      const room = manager.createRoom({
        name: '专精置灰测试',
        dungeonId: 'shadowfang_keep',
        host: { id: 'h1', name: '房主坦', classId: 'DK', spec: 'BLOOD' },
      });
      manager.autoFillAi(room.id);

      // 找出一个输出分工的 AI
      const dpsAi = room.members.find(m => m.isAi && m.role === 'DPS');
      assert.ok(dpsAi);

      // 当前队伍已有 1 坦克（上限1），若将输出 AI 改为鲜血DK (主坦)，必须置灰拦截
      const checkTank = manager.canSelectSpec(room.id, dpsAi.id, 'BLOOD', 'DK');
      assert.strictEqual(checkTank.allowed, false, '分工超额不可选择');
      assert.strictEqual(checkTank.disabled, true, '选项必须置灰');
      assert.ok(checkTank.reason?.includes('坦克人数已满'), `必须给出提示原因: ${checkTank.reason}`);

      // 当前队伍已有 1 治疗（上限1），若改为恢复德/恢复萨，必须置灰拦截
      const checkHealer = manager.canSelectSpec(room.id, dpsAi.id, 'RESTORATION', 'DRUID');
      assert.strictEqual(checkHealer.allowed, false);
      assert.strictEqual(checkHealer.disabled, true);
      assert.ok(checkHealer.reason?.includes('治疗人数已满'), `必须给出提示原因: ${checkHealer.reason}`);
    });

    it('Case 2.5: 房主修改 AI 专精：同分工专精切换（如冰法切火法）或有缺额分工切换可成功生效', () => {
      const manager = new RoomManager();
      const room = manager.createRoom({
        name: '同分工切换测试',
        dungeonId: 'shadowfang_keep',
        host: { id: 'h1', name: '房主坦', classId: 'DK', spec: 'BLOOD' },
      });
      manager.autoFillAi(room.id);

      const dpsAi = room.members.find(m => m.isAi && m.role === 'DPS');
      assert.ok(dpsAi);

      // 同为输出分工：法师 火焰(DPS) -> 冰霜(DPS)
      const checkSameRole = manager.canSelectSpec(room.id, dpsAi.id, 'FROST', 'MAGE');
      assert.strictEqual(checkSameRole.allowed, true, '同分工切换必须允许');
      assert.strictEqual(checkSameRole.disabled, false);

      const switched = manager.changeMemberSpec(room.id, dpsAi.id, 'MAGE', 'FROST');
      assert.strictEqual(switched, true);
      assert.strictEqual(dpsAi.spec, 'FROST');
      assert.strictEqual(dpsAi.role, 'DPS');
    });
  });

  // =========================================================================
  // Sub-Suite 3: 地图变更分工校验规则 (Map Switching Validation)
  // =========================================================================
  describe('3. 地图变更分工校验规则', () => {
    it('Case 3.1: 20人本切5人本超额拦截：输出超额11名时，目标地图置灰并提示“输出人员超出 11 名”', () => {
      const manager = new RoomManager();
      const room = manager.createRoom({
        name: '20人转5人拦截',
        dungeonId: 'dragon_soul',
        host: { id: 'h1', name: '房主坦', classId: 'DK', spec: 'BLOOD' },
      });
      manager.autoFillAi(room.id); // 20人满额 (2T 4H 14DPS)

      const validation = manager.validateMapSwitch(room.id, 'shadowfang_keep');
      assert.strictEqual(validation.canSwitch, false, '超额时禁止切换');
      assert.ok(
        validation.errors.some(e => e.includes('输出人员超出 11 名')),
        `必须包含输出人员超额11名提示，实际: ${JSON.stringify(validation.errors)}`
      );
    });

    it('Case 3.2: 20人本切5人本多分工超额：坦克超1名、治疗超3名时，返回具体各分工超额提示清单', () => {
      const manager = new RoomManager();
      const room = manager.createRoom({
        name: '全方位超额测试',
        dungeonId: 'dragon_soul',
        host: { id: 'h1', name: '房主坦', classId: 'DK', spec: 'BLOOD' },
      });
      manager.autoFillAi(room.id); // 2T 4H 14DPS

      const validation = manager.validateMapSwitch(room.id, 'shadowfang_keep');
      assert.strictEqual(validation.canSwitch, false);

      // 坦克 2 - 1 = 1
      assert.ok(validation.errors.some(e => e.includes('坦克人员超出 1 名')), '提示坦克超额1名');
      // 治疗 4 - 1 = 3
      assert.ok(validation.errors.some(e => e.includes('治疗人员超出 3 名')), '提示治疗超额3名');
      // 输出 14 - 3 = 11
      assert.ok(validation.errors.some(e => e.includes('输出人员超出 11 名')), '提示输出超额11名');
    });

    it('Case 3.3: 5人满员阵容切20人本：当前分工(1T 1H 3DPS)均满足小于等于目标上限，允许切换', () => {
      const manager = new RoomManager();
      const room = manager.createRoom({
        name: '小队切大团',
        dungeonId: 'shadowfang_keep',
        host: { id: 'h1', name: '房主坦', classId: 'DK', spec: 'BLOOD' },
      });
      manager.autoFillAi(room.id); // 1T 1H 3DPS

      const validation = manager.validateMapSwitch(room.id, 'dragon_soul');
      assert.strictEqual(validation.canSwitch, true, '所有分工均未超额，必须允许切换');
      assert.strictEqual(validation.errors.length, 0);
    });

    it('Case 3.4: 切换地图成功后，房间槽位上限与缺额槽位自动平滑重构', () => {
      const manager = new RoomManager();
      const room = manager.createRoom({
        name: '小队平滑重构',
        dungeonId: 'shadowfang_keep',
        host: { id: 'h1', name: '房主坦', classId: 'DK', spec: 'BLOOD' },
      });
      manager.autoFillAi(room.id); // 5人满员

      const success = manager.switchMap(room.id, 'dragon_soul');
      assert.strictEqual(success, true);
      assert.strictEqual(room.dungeonId, 'dragon_soul');
      assert.strictEqual(room.slots.length, 20, '切换后槽位总数必须扩展至 20');
      assert.strictEqual(room.members.length, 5, '原先 5 名成员完好保留');

      // 验证未占用的 15 个槽位处于 open 状态
      const emptySlots = room.slots.filter(s => !s.occupied);
      assert.strictEqual(emptySlots.length, 15);
    });
  });

  // =========================================================================
  // Sub-Suite 4: 开始游戏限制与阻碍原因校验 (Game Start Conditions)
  // =========================================================================
  describe('4. 开始游戏限制与阻碍原因校验', () => {
    it('Case 4.1: 人数未满时，“开始游戏”置灰不可点击，并明确提示缺额原因（如“缺少输出 1 名”）', () => {
      const manager = new RoomManager();
      const room = manager.createRoom({
        name: '缺额阻碍测试',
        dungeonId: 'shadowfang_keep',
        host: { id: 'h1', name: '房主坦', classId: 'DK', spec: 'BLOOD' },
      });
      // 手动添加 1 治疗与 2 输出 (共4人，缺1输出)
      manager.addAiMember(room.id, 'HEALER');
      manager.addAiMember(room.id, 'DPS');
      manager.addAiMember(room.id, 'DPS');

      assert.strictEqual(room.members.length, 4);

      const validation = manager.validateStartGame(room.id);
      assert.strictEqual(validation.canStart, false, '未满员不能开始');
      assert.strictEqual(validation.isFull, false);
      assert.ok(
        validation.reasons.some(r => r.includes('缺少输出 1 名')),
        `必须明确提示缺少输出 1 名，实际: ${JSON.stringify(validation.reasons)}`
      );
    });

    it('Case 4.2: 全员满额但存在真实玩家未准备时，“开始游戏”置灰并提示“有玩家未准备”', () => {
      const manager = new RoomManager();
      const room = manager.createRoom({
        name: '未就绪阻碍测试',
        dungeonId: 'shadowfang_keep',
        host: { id: 'h1', name: '房主坦', classId: 'DK', spec: 'BLOOD' },
      });
      manager.autoFillAi(room.id); // 满员 5 人

      // 将其中一个位置替换为未准备的人类玩家
      const aiDps = room.members.find(m => m.isAi && m.role === 'DPS');
      assert.ok(aiDps);
      manager.kickMember(room.id, aiDps.id);

      // 人类玩家加入
      const targetSlot = room.slots.find(s => !s.occupied);
      assert.ok(targetSlot);
      const humanPlayer = {
        id: 'p_unready',
        name: '摸鱼术士',
        classId: 'MAGE' as const,
        spec: 'FIRE',
        role: 'DPS' as const,
        isPlayer: true,
        isAi: false,
        isHost: false,
        isReady: false, // 未准备！
        slotIndex: targetSlot.index,
      };
      targetSlot.occupied = true;
      targetSlot.member = humanPlayer;
      room.members.push(humanPlayer);

      const validation = manager.validateStartGame(room.id);
      assert.strictEqual(validation.canStart, false, '有未准备玩家时不可开始游戏');
      assert.strictEqual(validation.allReady, false);
      assert.ok(
        validation.reasons.some(r => r.includes('有玩家未准备')),
        `必须提示有玩家未准备，实际: ${JSON.stringify(validation.reasons)}`
      );
    });

    it('Case 4.3: 非房主玩家无权触发“开始游戏”操作', () => {
      const manager = new RoomManager();
      const room = manager.createRoom({
        name: '权限测试',
        dungeonId: 'shadowfang_keep',
        host: { id: 'host_p1', name: '正牌房主', classId: 'DK', spec: 'BLOOD' },
      });
      manager.autoFillAi(room.id);

      const result = manager.startGame(room.id, 'imposter_999');
      assert.strictEqual(result.success, false, '非房主不得启动游戏');
      assert.strictEqual(result.reason, '只有房主可以开始游戏');
    });

    it('Case 4.4: 全员槽位满额且所有玩家与 AI 均处于准备就绪状态时，允许开始游戏并成功启动战斗', () => {
      const manager = new RoomManager();
      const room = manager.createRoom({
        name: '全员就绪开局测试',
        dungeonId: 'shadowfang_keep',
        host: { id: 'host_p1', name: '正牌房主', classId: 'DK', spec: 'BLOOD' },
      });
      manager.autoFillAi(room.id); // 全员 5 人，AI 和房主均为 ready

      const validation = manager.validateStartGame(room.id);
      assert.strictEqual(validation.canStart, true, '全员就绪且分工齐全时必须允许开始');
      assert.strictEqual(validation.reasons.length, 0);

      const startResult = manager.startGame(room.id, 'host_p1');
      assert.strictEqual(startResult.success, true);
      assert.strictEqual(room.status, 'IN_COMBAT', '房间状态应流转至 IN_COMBAT');
    });
  });

  // =========================================================================
  // Sub-Suite 5: 战斗中等待加入与脱战替补 (Waiting Queue & Out-of-Combat Substitution)
  // =========================================================================
  describe('5. 战斗中等待加入与脱战替补', () => {
    it('Case 5.1: 玩家选择专精后，若目标房间对应分工有缺额或包含AI，可发现并成功加入等待队列', () => {
      const manager = new RoomManager();
      const room = manager.createRoom({
        name: '战斗排队测试',
        dungeonId: 'shadowfang_keep',
        host: { id: 'h1', name: '房主坦', classId: 'DK', spec: 'BLOOD' },
      });
      manager.autoFillAi(room.id);
      manager.startGame(room.id, 'h1');

      const joinRes = manager.joinWaitingQueue(room.id, {
        id: 'p_queue_1',
        name: '排队盗贼',
        classId: 'ROGUE',
        spec: 'COMBAT',
      });

      assert.strictEqual(joinRes.success, true);
      assert.ok(joinRes.entry);
      assert.strictEqual(joinRes.entry?.role, 'DPS');
      assert.strictEqual(room.waitingQueue.length, 1);
    });

    it('Case 5.2: 房间战斗中 (BOSS_COMBAT)，队列实时暴露主 Boss 当前生命百分比 (如 65%)', () => {
      const manager = new RoomManager();
      const room = manager.createRoom({
        name: 'Boss血量暴露测试',
        dungeonId: 'shadowfang_keep',
        host: { id: 'h1', name: '房主坦', classId: 'DK', spec: 'BLOOD' },
      });
      manager.autoFillAi(room.id);
      manager.startGame(room.id, 'h1');

      manager.joinWaitingQueue(room.id, {
        id: 'p_queue_1',
        name: '排队盗贼',
        classId: 'ROGUE',
        spec: 'COMBAT',
      });

      // 模拟战斗引擎同步 Boss 状态: 亚什布里男爵当前血量 3,770,000 / 5,800,000 = 65%
      manager.updateCombatBossState(room.id, '亚什布里男爵', 3770000, 5800000, 'ashbury');

      const queueStatus = manager.getWaitingQueueStatus(room.id, 'p_queue_1');
      assert.strictEqual(queueStatus.inCombat, true);
      assert.strictEqual(queueStatus.bossName, '亚什布里男爵');
      assert.strictEqual(queueStatus.bossHpPct, 65, 'Boss生命百分比必须准确计算为 65%');
      assert.strictEqual(queueStatus.queuePosition, 1);
    });

    it('Case 5.3: 等待中的玩家随时点击退出等待，即刻从队列安全移除，不影响房间战斗', () => {
      const manager = new RoomManager();
      const room = manager.createRoom({
        name: '主动退出队列测试',
        dungeonId: 'shadowfang_keep',
        host: { id: 'h1', name: '房主坦', classId: 'DK', spec: 'BLOOD' },
      });
      manager.autoFillAi(room.id);
      manager.startGame(room.id, 'h1');

      manager.joinWaitingQueue(room.id, {
        id: 'p_queue_1',
        name: '排队盗贼',
        classId: 'ROGUE',
        spec: 'COMBAT',
      });
      assert.strictEqual(room.waitingQueue.length, 1);

      const left = manager.leaveWaitingQueue(room.id, 'p_queue_1');
      assert.strictEqual(left, true, '退出排队必须成功');
      assert.strictEqual(room.waitingQueue.length, 0, '队列应已被清空');
      assert.strictEqual(room.status, 'IN_COMBAT', '房间战斗继续正常运行');
    });

    it('Case 5.4: 战斗中 (BOSS_COMBAT) 严禁中途插队替补，等待玩家保持队列状态', () => {
      const manager = new RoomManager();
      const room = manager.createRoom({
        name: '战斗中防插队测试',
        dungeonId: 'shadowfang_keep',
        host: { id: 'h1', name: '房主坦', classId: 'DK', spec: 'BLOOD' },
      });
      manager.autoFillAi(room.id);
      manager.startGame(room.id, 'h1');

      manager.joinWaitingQueue(room.id, {
        id: 'p_queue_1',
        name: '排队盗贼',
        classId: 'ROGUE',
        spec: 'COMBAT',
      });

      const engine = new CombatEngine();
      const reportManager = new ReportManager();
      const rsm = new RunStateMachine(SHADOWFANG_KEEP_CONFIG, engine, reportManager);
      rsm.phase = 'BOSS_COMBAT'; // 战斗进行中

      const subResult = manager.substituteOutOfCombat(room.id, engine, rsm);
      assert.strictEqual(subResult.substituted.length, 0, '战斗中严禁发生替补');
      assert.strictEqual(room.waitingQueue.length, 1, '等待中玩家必须保持在队列中');
    });

    it('Case 5.5: 首领击杀脱战 (BOSS_COMBAT -> TRAVEL_RECOVERY)：等待玩家自动随机顶替一名同分工 AI，无缝接管角色', () => {
      const manager = new RoomManager();
      const room = manager.createRoom({
        name: 'Boss击杀替补测试',
        dungeonId: 'shadowfang_keep',
        host: { id: 'h1', name: '房主坦', classId: 'DK', spec: 'BLOOD' },
      });
      manager.autoFillAi(room.id);
      manager.startGame(room.id, 'h1');

      // 等待加入的盗贼玩家
      manager.joinWaitingQueue(room.id, {
        id: 'p_sub_rogue',
        name: '疾风盗贼',
        classId: 'ROGUE',
        spec: 'COMBAT',
      });

      const engine = new CombatEngine();
      // 向引擎中注册房间成员
      for (const m of room.members) {
        engine.addUnit({
          id: m.id,
          name: m.name,
          classId: m.classId,
          role: m.role,
          isPlayer: m.isPlayer,
          isAlive: true,
          alive: true,
          hp: 105000,
          maxHp: 105000,
          energy: 100,
          resources: [{ kind: 'ENERGY', current: 100, max: 100 }],
          buffs: [],
          threatTable: [],
          position: { x: 180, y: 160 },
          stats: {
            attackPower: 8000,
            spellPower: 8000,
            critChance: 0.25,
            haste: 0.15,
            armor: 12000,
            spellResist: 0,
            block: 0,
            parry: 0,
            dodge: 0.10,
            mastery: 0.18,
            versatility: 0.05,
            speed: 1,
          },
        });
      }

      const reportManager = new ReportManager();
      const rsm = new RunStateMachine(SHADOWFANG_KEEP_CONFIG, engine, reportManager);
      // 首领击杀，推进至脱战休整 TRAVEL_RECOVERY 状态
      rsm.phase = 'TRAVEL_RECOVERY';

      const subResult = manager.substituteOutOfCombat(room.id, engine, rsm);
      assert.strictEqual(subResult.substituted.length, 1, '必须成功完成 1 次替补');

      const sub = subResult.substituted[0];
      assert.strictEqual(sub.player.id, 'p_sub_rogue');
      assert.strictEqual(sub.player.role, 'DPS');
      assert.strictEqual(sub.replacedAi.role, 'DPS', '被替换的必须是同分工 DPS AI');
      assert.strictEqual(sub.replacedAi.isAi, true);

      // 验证队列中已被移除
      assert.strictEqual(room.waitingQueue.length, 0);

      // 验证房间槽位已更新为该人类玩家
      const replacedSlot = room.slots.find(s => s.index === sub.player.slotIndex);
      assert.ok(replacedSlot);
      assert.strictEqual(replacedSlot?.member?.id, 'p_sub_rogue');
      assert.strictEqual(replacedSlot?.member?.isPlayer, true);

      // 验证战斗引擎中的 Unit 已被无缝替换且脱战满血
      assert.strictEqual(engine.getUnit(sub.replacedAi.id), undefined, '旧 AI Unit 必须已从引擎移除');
      const newUnit = engine.getUnit('p_sub_rogue');
      assert.ok(newUnit, '新玩家 Unit 必须已插入引擎');
      assert.strictEqual(newUnit?.isAlive, true);
      assert.strictEqual(newUnit?.hp, newUnit?.maxHp, '新玩家必须脱战满血');
    });

    it('Case 5.6: 团灭重试脱战 (WIPE_VOTE -> RETRY -> TRAVEL_RECOVERY)：等待玩家自动顶替一名同分工 AI，参与下一次开怪', () => {
      const manager = new RoomManager();
      const room = manager.createRoom({
        name: '灭团重试替补测试',
        dungeonId: 'dragon_soul',
        host: { id: 'h1', name: '团长坦', classId: 'DK', spec: 'BLOOD' },
      });
      manager.autoFillAi(room.id);
      manager.startGame(room.id, 'h1');

      // 等待加入的恢复德鲁伊（治疗）
      manager.joinWaitingQueue(room.id, {
        id: 'p_sub_healer',
        name: '大祭司',
        classId: 'DRUID',
        spec: 'RESTORATION',
      });

      const engine = new CombatEngine();
      for (const m of room.members) {
        engine.addUnit({
          id: m.id,
          name: m.name,
          classId: m.classId,
          role: m.role,
          isPlayer: m.isPlayer,
          isAlive: true,
          alive: true,
          hp: 105000,
          maxHp: 105000,
          mp: 95000,
          maxMp: 95000,
          resources: [{ kind: 'MANA', current: 95000, max: 95000 }],
          buffs: [],
          threatTable: [],
          position: { x: 140, y: 150 },
          stats: {
            attackPower: 8000,
            spellPower: 8000,
            critChance: 0.25,
            haste: 0.15,
            armor: 12000,
            spellResist: 0,
            block: 0,
            parry: 0,
            dodge: 0.10,
            mastery: 0.18,
            versatility: 0.05,
            speed: 1,
          },
        });
      }

      const reportManager = new ReportManager();
      const rsm = new RunStateMachine(DRAGON_SOUL_CONFIG, engine, reportManager);
      // 灭团投票 RETRY -> TRAVEL_RECOVERY
      rsm.phase = 'WIPE_VOTE';
      rsm.handleWipeVoteChoice('RETRY');
      assert.strictEqual(rsm.phase, 'TRAVEL_RECOVERY');

      const subResult = manager.substituteOutOfCombat(room.id, engine, rsm);
      assert.strictEqual(subResult.substituted.length, 1);

      const sub = subResult.substituted[0];
      assert.strictEqual(sub.player.id, 'p_sub_healer');
      assert.strictEqual(sub.player.role, 'HEALER');
      assert.strictEqual(sub.replacedAi.role, 'HEALER', '必须顶替同为治疗分工的 AI');
      assert.strictEqual(room.waitingQueue.length, 0);

      const newUnit = engine.getUnit('p_sub_healer');
      assert.ok(newUnit);
      assert.strictEqual(newUnit?.role, 'HEALER');
      assert.strictEqual(newUnit?.hp, newUnit?.maxHp);
      assert.strictEqual(newUnit?.mp, newUnit?.maxMp);
    });
  });
});
