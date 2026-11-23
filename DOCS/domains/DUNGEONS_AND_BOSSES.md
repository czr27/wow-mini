# L1 域指南：副本流程、难度缩放与首领机制（Dungeons & Bosses）

> **上级入口**：`MASTER_INDEX.md`  
> **下级实操手册（L2）**：
> - `DOCS/sop/ADD_DUNGEON.md`（新增 5 人地下城 / 20 人团本）
> - `DOCS/sop/DESIGN_BOSS.md`（设计 Boss 技能时间轴、预警区与数值）

---

## 1. 副本全生命周期状态机

副本运行由 `RunStateMachine`（`DEV/packages/engine/src/engine/RunStateMachine.ts`）驱动，严格按以下阶段流转：

```
  [房间开战] ──► TRAVEL_RECOVERY (12-15s 迷宫赶路 / 复活门禁)
                        │ 全员存活且到达首领房
                        ▼
                 PULL_APPROACH (主坦领队平缓接怪，防瞬移)
                        │ 靠近警戒 / 嘲讽 / 命中
                        ▼
                  BOSS_COMBAT (BossAI 时间轴 + 几何预警 + 仇恨)
                    ╱         ╲
            首领阵亡             全员阵亡
              ╱                   ╲
             ▼                     ▼
     下一首领或 SUMMARY         WIPE_VOTE (15s 重试/退出投票)
                                  │ 选择退出或房主离房
                                  ▼
                           清理房间并回大厅
```

---

## 2. 关键模块边界速查

| 子模块 | 所在路径 | 职责边界 |
|---|---|---|
| **副本状态机** | `DEV/packages/engine/src/engine/RunStateMachine.ts` | 副本阶段流转、首领队列、全员复活门禁、灭团统计与战报生成 |
| **副本规格与难度基线** | `DEV/packages/engine/src/engine/TierProfile.ts`<br>`DEV/packages/engine/src/types.ts` | 5 人本 / 20 人团本血量/伤害基准、`NORMAL` / `HEROIC` / `CUSTOM`（10 项独立系数 `CustomDifficultySettings`） |
| **首领数据与 AI** | `DEV/packages/engine/src/bosses/*.ts`<br>`DEV/packages/engine/src/ai/BossAI.ts` | 首领技能时间轴、读条打断窗口、扇形/毒圈地面预警、点名 Debuff 与狂暴 |
| **地面法阵与几何判定** | `DEV/packages/engine/src/engine/EffectsManager.ts` | 圆形半径/60°扇形区域真实范围判定、治疗圈与敌方毒圈共存 |
| **房间配置映射** | `DEV/packages/engine/src/room/RoomTypes.ts`<br>`DEV/packages/engine/src/room/RoomManager.ts` | `DUNGEON_ROLE_QUOTAS`（副本名额与 Boss 列表）、房间难度与自定义系数同步到引擎 |

---

## 3. 本域绝对不变量

1. **阵容名额严格由房间注入**：进本生成队友时，必须 100% 消费房间已配置好的成员列表（职业、专精、同步后的名称），**禁止**在首次进本时用默认假队列覆盖。
2. **难度来源唯一化**：进入副本时 `difficulty` 与 `customDifficulty` 以当前房间配置为唯一权威源（不再依赖首页前置选择）。
3. **首领死亡立即停手**：Boss 阵亡瞬间必须清空其正在读条的技能与所有敌方地面危险区，防止死后补刀灭团。
4. **复活门禁与重置干净**：战斗外复活技能战斗中禁用；灭团重置或切本时必须调用 `CombatEngine.reset()` 彻底清空光环、仇恨、CD、冷却/护盾内置 CD 缓存与地面特效。
