# 📜 变更历史（Changelog）

## [0.3.1] — 2026-11-23

### 架构（App 瘦身 Phase-1〜8）
- **抽出前端消耗表**：`DEV/packages/web/src/combat/spellCosts.ts`（`SPELL_*_COSTS`），`App.tsx` 改为 import，无行为变更。
- **抽出单位资源工具**：`DEV/packages/web/src/combat/unitResources.ts`（`syncUnitResources`、`deductAiResource`）。
- **抽出房间大厅动作**：`DEV/packages/web/src/hooks/useRoomLobby.ts`（leave/create/join/queue/quickJoin/start；WS subscribe 仍在 App）。
- **抽出开本阵容装配**：`DEV/packages/web/src/combat/setupRaidUnits.ts`（5/20 人 roster + 房间成员 + 难度系数）。
- **抽出画面壳**：`screens/LobbyScreen.tsx`（房间列表/详情 + Auth 注入）、`screens/CombatHudScreen.tsx`（Canvas + HUD）。
- **抽出施法闸门（P6a）**：`sharedCooldowns.ts` / `playerGcd.ts` / `castResourceGates.ts`。
- **抽出读条结算（P6b）**：`combat/resolvePlayerCast.ts`。
- **抽出瞬发效果表（P6c）**：`combat/executePlayerInstantEffects.ts`。
- **抽出读条启动分支（P6d）**：`combat/startPlayerCastBranches.ts` + `hooks/usePlayerCastActions.ts` 组合入口。
- **抽出起手闸门编排（P6e）**：`combat/handlePlayerCastSlot.ts`（网络 guest/GCD/准星/选目标）；`App.handleCastSlot` 仅装配 deps-bag。
- **抽出 AI 战斗执行（P7）**：`combat/aiCombatExecutor.ts`（`executeAiNormalizedSpell` + `runFriendlyAiCombatTick`）。
- **抽出 20Hz 战斗帧（P8）**：`combat/runCombatTick.ts` + `hooks/useCombatTick.ts`；App 仅装配 deps-bag。
- **抽出房间 WS 同步（P3b）**：`hooks/useNetworkRoomSync.ts`；tick deps 分组为 `refs` / `setters` / `callbacks`；施法管线经 `usePlayerCastActions` barrel 导入。
- **文档对齐**：`MASTER_INDEX.md` 分层图增加 `combat/` / `screens/`；`UI_AND_ROOMS.md` §4；`MODIFY_UI_AND_HUD.md` / `DEV_README.md` 同步。

## [0.3.0] — 2026-11-22

### 架构改造（AI 开发提效）
- **L0→L1→L2 渐进式文档体系**：`MASTER_INDEX.md` 改为意图路由总纲；新增 3 份域指南与 6 份 SOP（见 `DOCS/`）。
- **施法三态契约单一事实源**：新增 `CastLifecycle.ts`；引擎与玩家侧统一瞬发/读条/引导的资源与 CD 时机。
- **HUD 布局 SSOT**：新增 `hudLayout.ts`；动作条重置改为持久化 `null`，自动清洗历史 `{0,0}` 脏坐标。
- **首页瘦身**：移除角色首页副本模式/挑战难度前置面板及无用透传 props；难度配置唯一归属房间流。
- **基准验收单测**：`cast_lifecycle_and_hud_reset.test.ts` 覆盖引导打断保 CD、读条打断零消耗、HUD 底部居中重置。

## [0.2.0] — 2026-11-21

### 新增功能
- **用户账号与认证系统** (`auth/AccountManager.ts`, `AuthAndCharacterModal.tsx`)：
  - 用户注册与登录，支持多账号隔离与本地持久化。
  - 账号下多角色管理：支持角色创建（职业选择：DK/德鲁伊/萨满/法师/潜行者）、角色删除。
  - 记录角色名称、职业、最后使用的天赋专精（Last Active Spec）。
- **独立天赋快捷键习惯系统** (`AccountManager.ts`, `ActionBar.tsx`)：
  - 为每个角色在不同天赋下独立持久化存储快捷键习惯方案（例如 DK 鲜血坦快捷键与冰霜输出快捷键互相独立隔离）。
  - 切换专精天赋时，技能栏自动无缝应用该天赋绑定的快捷键偏好。
- **副本通关证明与奖励系统** (`ReportManager.ts`, `ClearCertificateModal.tsx`)：
  - 击败尾王通关后发放“副本通关证明”道具，存入角色背包。
  - 点击通关证明可打开详细战报弹窗：调阅总耗时、逐 Boss 击杀用时、DPS、HPS、有效治疗（非 Overheal）、打断次数、承受伤害与团队排名。
  - 支持导出原始战报 JSON 证据与 CSV。
- **世界战力排行榜** (`leaderboard/LeaderboardManager.ts`, `LeaderboardModal.tsx`)：
  - **首领极限速杀榜（FAST_KILL）**：记录全服击杀各 Boss 最快秒数。
  - **最高输出极限榜（MAX_DPS）**：记录全服最高伤害秒伤。
  - **非过量有效治疗榜（MAX_EFFECTIVE_HPS）**：精准滤除 Overheal，记录全服纯净有效秒疗。
  - 支持按职业进行筛选。
- **5首领影牙城堡连战** (`ai/BossAI.ts`, `RunStateMachine.ts`)：
  - 亚什布里男爵、席瓦莱恩男爵、指挥官斯普林瓦尔、沃登勋爵、高弗雷勋爵全机制闭环。
- **HTML5 Canvas 2D 渲染与分级 SCT** (`canvas/CombatCanvas.tsx`)：
  - 32×32 职业像素精灵、64×64~112×112 首领模型、高逼真度暴击金橙加粗震屏跳字、图腾光环与 60° 红色双枪弹幕扇形预警。
- **全系统 41 项自动化测试与画面验证** (`QA/run_all_tests.ts`, `QA/reports/report_20261121_phase1_full.md`)：
  - 6 大测试集 41 个用例全部 100% 通过。

## [0.1.0] — 2026-11-21
- 项目工程初始化、Monorepo 脚手架、管理文档与美术规范制定。
