# L2 实操手册（SOP）：新增副本（5 人地下城 / 20 人团队副本）

> **上级域指南**：`DOCS/domains/DUNGEONS_AND_BOSSES.md`

---

## 1. 设计原则与核心不变量

- **时长与数值按 AI 队伍 DPS 预算平衡（`TierProfile.ts`）**：
  - 单人秒伤基准 5000（坦克 ×0.8，输出 ×1.0，治疗不计入）。5 人队伍预算 DPS = 19,000；20 人队伍预算 DPS = 73,000。
  - 英雄模式系数：Boss 血量 `HEROIC_DIFFICULTY_MULT = 1.5`，敌方输出 `HEROIC_ENEMY_DAMAGE_MULT = 1.2`。
  - 5 人英雄本基准：非尾王 120 秒（约 3.4M HP），尾王 180 秒（约 5.1M HP）。
  - 20 人团本基准：非尾王 180 秒（约 19.7M HP），尾王 300 秒（约 32.8M HP）。
  - 赶路目标时长：5 人本 7s / 20 人团本 14s（`RunStateMachine.ts`）。
- **难度系数透明叠加**：副本只需提供标准基线数值，`HEROIC` 倍率与 `CUSTOM` 的 10 项系数（`bossHpCoeff`、`enemyDamageCoeff` 等）统一由 `CombatEngine` 与 `TierProfile` 注入，禁止在副本定义里硬编码绕过难度系数。
- **开战前阵容校验解耦**：房间空槽位不强制展示固定职责文字，开战前由 `RoomManager` 校验通过（总人数与基本坦克/治疗需求）即可进入。

---

## 2. 标准扩展流程（Step-by-Step Checklist）

1. **注册副本规格与名额** — `DEV/packages/engine/src/room/RoomTypes.ts`
   - 在 `DUNGEON_ROLE_QUOTAS` 中添加新 `dungeonId`（含中文名、人数上限、职责配额与默认难度；现已支持影牙城堡、死亡矿井、血色修道院、斯坦索姆、祖尔格拉布、巨龙之魂）。
2. **定义首领序列与模块化注册** — `DEV/packages/engine/src/bosses/<new_dungeon>/` + `DEV/packages/engine/src/engine/RunStateMachine.ts`
   - 新建 `DEV/packages/engine/src/bosses/<new_dungeon>/` 目录，编写各 Boss 技能档案与派生自 `BaseBossAI` 的 AI 类。
   - **对照攻略控制 DBM 密集度并补全战术建议**：仅对玩家光看血条无法判断的核心机制（分散、分摊、躲柱子、转火、安全治疗窗等）按 `DOCS/sop/DESIGN_BOSS.md` 第 3 步补充 `skill.dbm`（含 4 字 `voiceText`）与 `engine.emitDbmAlert(...)`，避免常规掉血/治疗刷屏。
   - 在该目录 `index.ts` 导出 `register<Dungeon>Bosses()` 并注册进 `BossRegistry`，并在 `src/bosses/index.ts` 引入初始化。
   - 在 `RunStateMachine.ts` 中配置 `DungeonConfig`，使用 `buildDungeonBossHpList(tier, bossCount)` 计算英雄本血量梯度，并指定 `travelMs`。
3. **配置缩放基线** — `DEV/packages/engine/src/engine/TierProfile.ts`
   - 确认新副本的 `tier`（`5man` / `20man` 或新增档位）正确映射血量/伤害基准与通关证明元数据。
4. **房间创建与详情选项接入** — `DEV/packages/web/src/components/room/RoomListView.tsx` & `RoomDetailView.tsx`
   - 在建房弹窗与房间详情的副本选择器中列出新副本选项。
5. **迷宫视觉主题（可选）** — `DEV/packages/web/src/canvas/CombatCanvas.tsx`
   - 如需专属地板/走廊色调，按 `dungeonId` 分支配置背景色盘，保持连通种子路径算法不变。

---

## 3. 单一事实源（SSOT）声明

- 副本元数据、名额与名称：`DEV/packages/engine/src/room/RoomTypes.ts` (`DUNGEON_ROLE_QUOTAS`)。
- 副本首领推进顺序与阶段切换：`DEV/packages/engine/src/engine/RunStateMachine.ts`。
- 首领血量预算与时长标尺：`DEV/packages/engine/src/engine/TierProfile.ts` (`BOSS_KILL_TIME_SEC`, `buildDungeonBossHpList`)。
- 首领注册与 AI 工厂：`DEV/packages/engine/src/bosses/core/BossRegistry.ts`。

---

## 4. 常见反模式与防坑指南

- ❌ **把副本选择写死在首页角色面板**：副本规格只在房间大厅/房间详情内选择。
- ❌ **进本时忽略房间 AI 阵容**：`setupRaidUnits` 必须严格读取 `room.members` 的职业、专精和名称，不可再硬编码 5 职业补位覆盖。
- ❌ **切本或退房忘记重置引擎**：离开副本必须销毁/清理房间并执行 `engine.reset()`。

---

## 5. 最小验收与测试命令

```

## 强制验收：全随机 AI 普通模式通关测试
每新增一个副本，设计完成后**必须**补充普通模式全随机 AI 通关测试（参考 `DEV/packages/engine/src/__tests__/dungeon_normal_ai_clear.test.ts`）：
- 使用随机职业组合填满 AI 队伍，**至少重复 3 轮**覆盖多职业；
- 验证全随机 AI 队伍能够稳定通关该副本的**普通模式**；
- 若出现灭团或超时，必须定位是 **AI 未理解副本机制** 还是 **Boss 数值/机制设计存在缺陷** 并修复。bash
npx --yes tsx --test DEV/packages/engine/src/__tests__/room_lifecycle_and_sync.test.ts \
  QA/tests/lobby_room_queue_substitution.test.ts
```

## 强制验收：全随机 AI 普通模式通关测试
每新增一个副本，设计完成后**必须**补充普通模式全随机 AI 通关测试（参考 `DEV/packages/engine/src/__tests__/dungeon_normal_ai_clear.test.ts`）：
- 使用随机职业组合填满 AI 队伍，**至少重复 3 轮**覆盖多职业；
- 验证全随机 AI 队伍能够稳定通关该副本的**普通模式**；
- 若出现灭团或超时，必须定位是 **AI 未理解副本机制** 还是 **Boss 数值/机制设计存在缺陷** 并修复。
