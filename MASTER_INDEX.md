# Cata Raid Sim — L0 顶层架构路由总纲（AI 唯一第一入口）

> **用途**：本文件是 AI 接手任何需求的**唯一第一入口**（严格控制在 ~120 行内，严禁堆砌历史功能流水账；历史版本记录见 `DOCS/CHANGELOG.md`）。  
> **AI 读取纪律（由简入深，按需读取）**：  
> 1. 先查下方**意图路由表**，命中 1 个大域（L1）和 1~2 份实操手册（L2）；  
> 2. **只读命中的 L1 与 L2 文档**，不要全仓盲搜或通读无关模块；  
> 3. 严格按 L2 清单修改对应代码与单一事实源，跑通该模块规定的最小测试命令；  
> 4. 若本次修改变更了架构契约或新增了扩展点，必须顺手更新对应 L2 文档，防止文档过时。

---

## 1. 系统一句话定位与分层边界

**Cata Raid Sim** = 魔兽世界 80/85 级大灾变副本模拟战斗游戏（10 大职业 30 专精，5 人本/20 人团本，通用规则驱动 AI，房间联机大厅）。

```
┌─────────────────────────────────────────────────────────────────────────┐
│  DEV/packages/web/src/         前端表现层（React + Tailwind + Canvas）   │
│  · components/                 登录角色、房间大厅/详情、动作条、团队框架  │
│  · screens/                    大厅/战斗画面壳（LobbyScreen、CombatHud） │
│  · combat/                     消耗/阵容/网络权威/效果总线/AI执行/20Hz帧  │
│  · hooks/ & utils/             大厅/WS 同步/tick/施法 barrel、HUD 布局     │
│  · App.tsx                     顶层装配壳（状态 + deps 装配；见 L1 §4）    │
├─────────────────────────────────────────────────────────────────────────┤
│  DEV/packages/server/src/      Node.js 服务端（Phase 3 多人联机服务）    │
│  · roomWs.ts / roomVotes.ts / RoomCombatSession.ts 大厅广播、权威会话与投票 │
├─────────────────────────────────────────────────────────────────────────┤
│  DEV/packages/engine/src/      纯引擎核心层（纯 TS，零 DOM 依赖，可单测） │
│  · engine/                     20Hz 战斗引擎、施法状态机、光环/CD/仇恨   │
│  · classes/                    10 职业技能定义 + ClassRegistry 单一注册表 │
│  · bosses/ & ai/               模块化 6 副本 Boss 机制 + 通用规则 AI     │
│  · room/ & auth/               房间生命周期、排队替补、账号角色与持久化   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 需求意图路由表（从这里进入 L1 → L2）

| 你的需求类型 | 先读 L1 域指南 | 再读 L2 实操手册（SOP） | 最小必跑验证命令 |
|---|---|---|---|
| **新增/调整英雄职业或专精** | `DOCS/domains/COMBAT_AND_CLASSES.md` | `DOCS/sop/ADD_HERO_CLASS.md` | `npx --yes tsx --test DEV/packages/engine/src/__tests__/classes_and_universal_ai.test.ts` |
| **新增/修正技能效果、CD、蓝耗、读条/引导** | `DOCS/domains/COMBAT_AND_CLASSES.md` | `DOCS/sop/ADD_OR_FIX_SPELL.md`<br>`DOCS/sop/CAST_AND_AI_RULES.md` | `npx --yes tsx --test DEV/packages/engine/src/__tests__/cast_lifecycle_and_hud_reset.test.ts` |
| **优化 AI 治疗/输出/坦克决策逻辑** | `DOCS/domains/COMBAT_AND_CLASSES.md` | `DOCS/sop/CAST_AND_AI_RULES.md` | `npx --yes tsx --test QA/tests/smart_ai_metrics_and_personality.test.ts` |
| **修改首页、大厅、房间或战斗 HUD/动作条** | `DOCS/domains/UI_AND_ROOMS.md` | `DOCS/sop/MODIFY_UI_AND_HUD.md` | `npx --yes tsx --test DEV/packages/engine/src/__tests__/cast_lifecycle_and_hud_reset.test.ts` |
| **修改房间组队、AI 槽位、开战/退房生命周期** | `DOCS/domains/UI_AND_ROOMS.md` | `DOCS/sop/MODIFY_UI_AND_HUD.md` | `npx --yes tsx --test DEV/packages/engine/src/__tests__/room_lifecycle_and_sync.test.ts` |
| **新增 5 人地下城或 20 人团本** | `DOCS/domains/DUNGEONS_AND_BOSSES.md` | `DOCS/sop/ADD_DUNGEON.md` | `npx --yes tsx --test DEV/packages/engine/src/__tests__/room_lifecycle_and_sync.test.ts` |
| **设计/调整 Boss 技能、预警、转阶段机制** | `DOCS/domains/DUNGEONS_AND_BOSSES.md` | `DOCS/sop/DESIGN_BOSS.md` | `npx --yes tsx --test DEV/packages/engine/src/__tests__/classes_and_universal_ai.test.ts` |
| **修改多人联机同步、权威边界、投票或重连协议** | `DOCS/domains/NETWORK_AND_SYNC.md` | `DOCS/domains/UI_AND_ROOMS.md`（参考大厅/Hook 边界） | `npx --yes tsx --test DEV/packages/server/src/__tests__/combat_sync_authority.test.ts DEV/packages/server/src/__tests__/multiplayer_room_ws_flow.test.ts` |

---

## 3. 全局架构红线（不可违背的不变量）

1. **80 级满级满急速基线**：全职业属性、技能施法/冷却与 AI 决策均基于 `LEVEL_80_MAX_HASTE = 0.50` 与三档 GCD（`NORMAL` 1.5s 受急速缩至 1.0s、`ROGUE` 固定 1.0s、`OFF_GCD` 0ms），由 `TierProfile.ts`（`getEffectiveGcdMs` / `getHastedCastTimeMs`）与 `ClassRegistry.ts`（`gcdCategory` 等技能元数据）协同计算。
2. **三类施法语义红线（瞬发 / 读条 / 引导）**：
   - **瞬发**：起手即扣资源、进 GCD、进技能 CD、生效。
   - **读条（非引导）**：起手仅校验资源并启动读条与 GCD，**不扣资源、不进技能 CD**；读条成功结束才扣资源并进 CD；中途打断无效果、不扣资源、不进 CD。
   - **引导（Channel）**：**起手瞬间即扣资源并立即进入技能 CD 与 GCD**；中途打断保留已完成跳数，资源不退还、CD 照常冷却；自然结束不重复触发 CD。
3. **单一事实源（SSOT）优先**：技能元数据归 `ClassRegistry`；施法/引导判定归 `CastLifecycle.ts`；HUD 坐标锚点与重置归 `hudLayout.ts`；房间成员与难度归 `RoomManager`；前端消耗表回退归 `combat/spellCosts.ts`；单位资源镜像归 `combat/unitResources.ts`。禁止在 `App.tsx` 中继续新增冗长的硬编码 `if/else` 副本。
4. **UI 职责边界**：首页角色面板只负责角色选择、专精/快捷键与“进入大厅”；副本规格与挑战难度（普通/英雄/自定义）唯一归属房间创建/房间详情流。
5. **HUD 重置语义**：可拖拽 HUD（动作条等）以 `null / undefined` 表示“语义默认停靠位（如窗体下方中部）”，**严禁**将 `{ x: 0, y: 0 }` 当作重置值写入持久化。
6. **通用规则驱动 AI**：AI 通过 `SkillMetricEvaluator` 与可用技能集合自动评分（含群体危险/多目标 AoE 优先规则），禁止按单个专精写死技能名称脚本。
7. **App 瘦身纪律**：新逻辑优先落入 `combat/`、`hooks/`、`utils/`、`components/`；**禁止**向 `App.tsx` 追加大段 tick/施法效果/房间 handler。拆分顺序与禁抽清单见 `DOCS/domains/UI_AND_ROOMS.md` §4。

---

## 4. 全量验证命令速查

```bash
# 引擎核心 + 施法/HUD + 职业AI + 房间生命周期 全部单测
npx --yes tsx --test DEV/packages/engine/src/__tests__/cast_lifecycle_and_hud_reset.test.ts \
  DEV/packages/engine/src/__tests__/classes_and_universal_ai.test.ts \
  DEV/packages/engine/src/__tests__/room_lifecycle_and_sync.test.ts \
  QA/tests/smart_ai_metrics_and_personality.test.ts \
  QA/tests/lobby_room_queue_substitution.test.ts
```
