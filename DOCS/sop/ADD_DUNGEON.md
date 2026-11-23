# L2 实操手册（SOP）：新增副本（5 人地下城 / 20 人团队副本）

> **上级域指南**：`DOCS/domains/DUNGEONS_AND_BOSSES.md`

---

## 1. 设计原则与核心不变量

- **时长与数值按人数比例平衡**：
  - 5 人英雄本基准：小 Boss 2~3 分钟（约 5.8M~6.8M HP），尾王 ~5 分钟（约 12.5M HP）。
  - 20 人团本基准：小 Boss ~5 分钟（约 75M HP），尾王 ~8 分钟（约 120M HP）。
- **难度系数透明叠加**：副本只需提供标准基线数值，`HEROIC` 倍率与 `CUSTOM` 的 10 项系数（`bossHpCoeff`、`enemyDamageCoeff` 等）统一由 `CombatEngine` 与 `TierProfile` 注入，禁止在副本定义里硬编码绕过难度系数。
- **开战前阵容校验解耦**：房间空槽位不强制展示固定职责文字，开战前由 `RoomManager` 校验通过（总人数与基本坦克/治疗需求）即可进入。

---

## 2. 标准扩展流程（Step-by-Step Checklist）

1. **注册副本规格与名额** — `DEV/packages/engine/src/room/RoomTypes.ts`
   - 在 `DUNGEON_ROLE_QUOTAS` 中添加新 `dungeonId`（含中文名、人数上限、职责配额与默认难度）。
2. **定义首领序列与状态机映射** — `DEV/packages/engine/src/bosses/` + `DEV/packages/engine/src/engine/RunStateMachine.ts`
   - 在 `bosses/` 新建副本首领配置并在 `bosses/index.ts` 导出。
   - 在 `RunStateMachine.ts` 中将新 `dungeonId` 映射到对应的首领列表与 `TRAVEL_RECOVERY` 赶路时间。
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

---

## 4. 常见反模式与防坑指南

- ❌ **把副本选择写死在首页角色面板**：副本规格只在房间大厅/房间详情内选择。
- ❌ **进本时忽略房间 AI 阵容**：`setupRaidUnits` 必须严格读取 `room.members` 的职业、专精和名称，不可再硬编码 5 职业补位覆盖。
- ❌ **切本或退房忘记重置引擎**：离开副本必须销毁/清理房间并执行 `engine.reset()`。

---

## 5. 最小验收与测试命令

```bash
npx --yes tsx --test DEV/packages/engine/src/__tests__/room_lifecycle_and_sync.test.ts \
  QA/tests/lobby_room_queue_substitution.test.ts
```
