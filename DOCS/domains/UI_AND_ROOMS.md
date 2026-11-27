# L1 域指南：前端界面、HUD 布局与房间联机流（UI & Rooms）

> **上级入口**：`MASTER_INDEX.md`  
> **下级实操手册（L2）**：
> - `DOCS/sop/MODIFY_UI_AND_HUD.md`（修改页面流、弹窗、可拖拽 HUD 与持久化）

---

## 1. 页面流转与职责分工

```
┌───────────────────────────┐
│  首页角色面板              │  AuthAndCharacterModal.tsx
│  · 登录/新建/切换角色      │  职责边界：只管角色、专精、全技能书/快捷键、通关证明
│  · ❌ 不放副本与难度选择    │  主按钮：「进入大厅」
└─────────────┬─────────────┘
              ▼
┌───────────────────────────┐
│  房间大厅（RoomListView）  │  展示活跃房间（自动清理纯 AI 僵尸房）、创建房间
└─────────────┬─────────────┘
              ▼
┌───────────────────────────┐
│  房间详情（RoomDetailView）│  职责边界：唯一配置副本规格、普通/英雄/自定义难度、
│  · 槽位不绑死职责提示       │  调换 AI 职业专精（自动同步对应职业魔兽名）、开战校验
└─────────────┬─────────────┘
              ▼
┌───────────────────────────┐
│  副本战斗界面（Combat HUD）│  Canvas + UnitFrames + RaidFrames + StatsPanel + ActionBar + PlayerCastBar
│  · 退房/战斗失败彻底清理    │  所有可拖拽 HUD 共用统一默认停靠与 null 重置契约
└───────────────────────────┘
```

---

## 2. 关键模块边界速查

| 子模块 | 所在路径 | 职责边界 |
|---|---|---|
| **HUD 布局锚点纯工具** | `DEV/packages/web/src/utils/hudLayout.ts` | 动作条默认底部居中计算、视口拖拽钳制、重置语义与历史 `{ x: 0, y: 0 }` 脏数据清洗 |
| **玩家施法/引导 Hook** | `DEV/packages/web/src/hooks/usePlayerCastController.ts` | 玩家侧读条/引导资源校验与周期结算，避免业务逻辑继续堆回 `App.tsx` |
| **前端法术消耗表** | `DEV/packages/web/src/combat/spellCosts.ts` | `SPELL_*_COSTS` 回退矩阵（优先仍用 `ClassRegistry.resourceCostAmount`） |
| **单位资源同步** | `DEV/packages/web/src/combat/unitResources.ts` | `syncUnitResources`、`deductAiResource`（HUD / AI 共用） |
| **房间大厅动作 Hook** | `DEV/packages/web/src/hooks/useRoomLobby.ts` | leave/create/join/queue/quickJoin/start |
| **房间 WS 同步 Hook** | `DEV/packages/web/src/hooks/useNetworkRoomSync.ts` | connect + subscribe（房间/战斗/投票消息） |
| **开本阵容装配** | `DEV/packages/web/src/combat/setupRaidUnits.ts` | 5/20 人 roster、房间成员注入、难度 HP/MP 系数 |
| **大厅 / 战斗画面壳** | `DEV/packages/web/src/screens/LobbyScreen.tsx`<br>`DEV/packages/web/src/screens/CombatHudScreen.tsx` | 页面 JSX 组合；Auth 仍由 App 注入 `authPanel`；业务逻辑不进壳 |
| **施法 CD/GCD/资源闸** | `combat/sharedCooldowns.ts`<br>`combat/playerGcd.ts`<br>`combat/castResourceGates.ts` | 共享 CD、GCD 毫秒、起手资源校验 |
| **读条完成结算** | `combat/resolvePlayerCast.ts` | 目标/射程校验 + 读条完成效果表；App 仅薄包装 |
| **瞬发/数据驱动效果** | `combat/executePlayerInstantEffects.ts` | 驱散/HoT/DoT/通用瞬发与数据驱动分支；由 `handlePlayerCastSlot` 调用 |
| **起手闸门编排** | `combat/handlePlayerCastSlot.ts` | 网络 guest / GCD / CD / 资源 / 准星 / 选目标 / 距离；`App.handleCastSlot` 仅装配 deps-bag |
| **读条启动分支** | `combat/startPlayerCastBranches.ts` | 自然迅捷 + 硬编码读条/引导起手 |
| **施法动作组合入口** | `hooks/usePlayerCastActions.ts` | 再导出施法管线模块（含 P6e `handlePlayerCastSlot`） |
| **友方 AI 战斗执行** | `combat/aiCombatExecutor.ts` | `executeAiNormalizedSpell` + `runFriendlyAiCombatTick`；tick 内仅调用 |
| **20Hz 战斗帧** | `combat/runCombatTick.ts`<br>`hooks/useCombatTick.ts` | guest HUD / host 广播 / 读条推进 / AI / 普攻；App 装配 deps |
| **网络战斗权威** | `combat/networkCombatAuthority.ts`<br>`combat/hostAuthorityTickGuard.ts` | Host/Guest 战斗权威判定、世界快照过滤、防止未授权状态覆盖 |
| **网络客机施法同步** | `combat/castLifecycleNet.ts`<br>`combat/withNetworkVitals.ts` | 客机网络施法生命周期、带网络生命体征的单位镜像 |
| **战斗效果总线** | `combat/combatEffectBus.ts`<br>`combat/applyCombatEffect.ts` | 统一事件通道（伤害/治疗/护盾/驱散/击杀），解耦 UI 渲染与引擎状态 |
| **DK 独立符文系统** | `combat/dkResources.ts` | 死亡骑士 6 符文（血/霜/邪/死）与符能刷新/消耗状态机 |
| **全团嗜血与衰竭** | `combat/raidLustBuff.ts` | 嗜血/英勇/时间扭曲 40s 急速加成与 10min 衰竭/心满意足互斥 Debuff |
| **本地战斗录像器** | `combat/localEncounterRecorder.ts` | 客户端首领战事件流捕获、阶段统计与战报本地持久化 |
| **地面目标确认** | `combat/confirmGroundTarget.ts` | DnD / 治疗之雨 / 图腾落点与 CD |
| **驱散** | `combat/dispelUnit.ts` | Cata 驱散矩阵 + 距离/CD/GCD |
| **AI 单位辅助** | `combat/aiUnitHelpers.ts` | 预测治疗量、AI CD、专精推断、OOM 提示 |
| **迷宫拓扑与联机桥接** | `combat/mazeRuntime.ts`<br>`combat/mazeSyncBridge.ts` | 迷宫连通分支、动态怪物组与房主-客机同步 |
| **账号与 UI 持久化** | `DEV/packages/engine/src/auth/AccountManager.ts` | 角色列表、按专精独立快捷键、`saveCharacterUiLayout`（支持 `null` 清除已保存坐标） |
| **房间生命周期管理** | `DEV/packages/engine/src/room/RoomManager.ts` | 建房、入房、退房清理、纯 AI 房间自动回收、AI 换职业自动同步 Lore 名称、自定义难度系数持久化 |
| **动作条与读条条** | `DEV/packages/web/src/components/ActionBar.tsx`<br>`DEV/packages/web/src/components/PlayerCastBar.tsx` | 三栏 36 格快捷键、扇形 CD、资源不足/超距提示、解锁拖拽与底部居中重置 |
| **角色首页与房间视图** | `DEV/packages/web/src/components/AuthAndCharacterModal.tsx`<br>`DEV/packages/web/src/components/room/RoomDetailView.tsx` | 首页仅做角色与天赋准备；房间详情掌控副本模式、难度与自定义系数 |

---

## 3. 本域绝对不变量

1. **HUD 重置一律清空为默认停靠位（`null`）**：动作条默认停靠在**窗体下方中部**；点击“重置”必须清空持久化坐标（传 `null` 并从 `uiLayout` 删除该键），绝对禁止传入 `{ x: 0, y: 0 }`！
2. **房间生命周期无残留**：房主退房、战斗失败解散或仅剩 AI 的房间必须立即销毁，大厅列表中不允许出现无真人玩家的 Demo/僵尸房间。
3. **UI 与引擎同步**：更换房间内 AI 职业/专精时必须同步更新成员名称与槽位状态，开战后副本首帧即使用房间最终阵容。
4. **保持 `App.tsx` 只做装配**：新增独立 UI 交互或计算逻辑优先放进 `combat/`、`hooks/`、`utils/` 或专用组件，不要再向 `App.tsx` 直接追加数百行内联逻辑。

---

## 4. App.tsx 瘦身现状与拆分顺序（低风险 → 高风险）

> **现状**：`App.tsx` 装配壳约 2.9k 行（P1–P8 + WS + 战斗事件总线/网络权威/DK符文/战斗录制/地面确认/驱散/AI 辅助已抽出）。目标保持装配壳；新增逻辑优先进 `combat/` / `hooks/` / `screens/`。

| 阶段 | 目标落点 | 内容 | 状态 |
|---|---|---|---|
| **P1** | `combat/spellCosts.ts` | 纯数据 `SPELL_*_COSTS` | ✅ 已完成 |
| **P2** | `combat/unitResources.ts` | `syncUnitResources` / AI 扣资源共用 | ✅ 已完成 |
| **P3** | `hooks/useRoomLobby.ts` | create/join/queue/leave/start | ✅ 已完成 |
| **P3b** | `hooks/useNetworkRoomSync.ts` | WS connect + room/combat/vote subscribe | ✅ 已完成 |
| **P4** | `combat/setupRaidUnits.ts` | 5/20 人 roster 池与难度系数注入 | ✅ 已完成 |
| **P5** | `screens/LobbyScreen.tsx`<br>`screens/CombatHudScreen.tsx` | 大厅/战斗 JSX 壳，逻辑仍由 hooks 注入 | ✅ 已完成 |
| **P6a** | `combat/sharedCooldowns.ts`<br>`combat/playerGcd.ts`<br>`combat/castResourceGates.ts` | 共享 CD / GCD 计算 / 起手资源闸 | ✅ 已完成 |
| **P6b** | `combat/resolvePlayerCast.ts` | 读条完成结算效果表（App 薄包装） | ✅ 已完成 |
| **P6c** | `combat/executePlayerInstantEffects.ts` | 驱散/瞬发/数据驱动效果表（自 `handleCastSlot` 抽离） | ✅ 已完成 |
| **P6d** | `combat/startPlayerCastBranches.ts`<br>`hooks/usePlayerCastActions.ts` | 自然迅捷+硬编码读条启动；组合再导出入口 | ✅ 已完成 |
| **P6e** | `combat/handlePlayerCastSlot.ts`<br>`hooks/usePlayerCastActions.ts`（扩） | 剩余 `handleCastSlot` 起手闸门整包迁入（网络 guest/GCD/准星/选目标）；App 仅 deps-bag | ✅ 已完成 |
| **P7** | `combat/aiCombatExecutor.ts` | `executeAiNormalizedSpell` + `runFriendlyAiCombatTick`（AI 决策循环） | ✅ 已完成 |
| **P8** | `combat/runCombatTick.ts`<br>`hooks/useCombatTick.ts` | 20Hz 帧逻辑 + interval 钩子；App 仅装配 deps-bag | ✅ 已完成 |

**现阶段仍慎动（易改 timing / 断 ref 热路径）**：
- `startAdventureRef` / `setupRaidUnitsRef` / wipe-vote ref 交叉调用链
- 把 state 迁入未接线的 `store/gameStore`（避免第二真相源）
