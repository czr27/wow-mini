# 📜 变更历史（Changelog）

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
