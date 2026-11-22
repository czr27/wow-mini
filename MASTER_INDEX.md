# 🐉 Cata Raid Sim — 顶层管理总览（AI 交接索引）

> **文档用途**：本文件是整个项目的"导航地图"，AI Agent 接手项目时第一个读取此文件，快速定位各职能目录、当前进度与关键决策。
> **当前版本**：v0.6.0
> **最后更新**：2026-11-21

---

## 1. 项目一句话定位

**Cata Raid Sim** = 浏览器即开即玩的魔兽世界 85 级大地的裂变（4.3 巨龙之魂）副本模拟战斗游戏。  
TypeScript + React + HTML5 Canvas + Node.js WebSocket；无需安装，聚焦副本连战体验。

---

## 2. 目录树与职能分工

```
wow_simu/
├── MASTER_INDEX.md          ← 你正在看这里（顶层导航与AI接手第一入口）
├── wow_classic_raid_sim_gdd.md  ← 原始GDD策划书（需求基准）
│
├── PM/                      ← 项目策划与管理
│   ├── TASK_BOARD.md        ← 任务看板（全生命周期任务跟踪）
│   ├── MILESTONES.md        ← 里程碑与阶段目标
│   ├── DECISIONS_LOG.md     ← 重要技术/设计决策日志（D-001 ~ D-010）
│   ├── tasks/               ← 细粒度任务单
│   ├── milestones/          ← 里程碑详细计划
│   └── reports/             ← 周报/阶段报告
│
├── DEV/                     ← 程序开发（Monorepo）
│   ├── DEV_README.md        ← 开发环境搭建与规范
│   ├── packages/
│   │   ├── engine/          ← 战斗与游戏引擎（纯TS，20Hz Tick，无浏览器DOM强依赖）
│   │   │   ├── src/
│   │   │   │   ├── types.ts           ← 全局Schema（包含用户、角色、快捷键、通关证明、世界榜单）
│   │   │   │   ├── engine/            ← 战斗循环、计算器、仇恨、光环、资源、状态机、战报导出
│   │   │   │   ├── classes/           ← 5大职业（DK、德鲁伊、萨满、法师、潜行者）
│   │   │   │   ├── bosses/            ← 影牙城堡5首领与巨龙之魂Boss时间轴
│   │   │   │   ├── ai/                ← 坦、奶、DPS、Boss AI
│   │   │   │   ├── auth/              ← 用户账号注册登录与多角色管理系统
│   │   │   │   └── leaderboard/       ← 世界排行榜（最快击杀、最高输出、最高有效治疗）
│   │   ├── web/             ← React前端（HUD + Canvas渲染 + 账号角色 + 奖励与世界排行榜）
│   │   │   ├── src/
│   │   │   │   ├── components/        ← HUD组件（RaidFrames/BossBar/ActionBar/Stats/Auth/Leaderboard/Rewards）
│   │   │   │   ├── canvas/            ← HTML5 Canvas 2D渲染（像素精灵、分级SCT跳字、地面法阵图腾）
│   │   │   │   ├── store/             ← Zustand状态管理
│   │   │   │   └── App.tsx            ← 顶层应用路由与视图切换
│   │   └── server/          ← Node.js WebSocket联机服务（Phase 3）
│   └── package.json         ← Monorepo根配置（npm workspaces）
│
├── ART/                     ← 美术开发
│   ├── ART_SPEC.md          ← 美术规范（像素风格/配色/尺寸/SCT色系）
│   ├── sprites/             ← 职业与Boss像素精灵配置与生成工具
│   ├── effects/             ← 粒子/法阵/图腾特效定义
│   └── ui/                  ← UI主题与调色板配置
│
├── QA/                      ← 测试
│   ├── QA_PLAN.md           ← 整体测试计划与用例规范
│   ├── unit-tests/          ← 单元测试（engine伤害/仇恨/光环/资源/账号/排行榜）
│   ├── integration-tests/   ← 集成测试（副本全流程/职业联动/Boss机制）
│   ├── visual-tests/        ← 画面验证（SCT跳字/图腾法阵/Boss预警区域截图与像素测试）
│   └── reports/             ← 详细测试报告（report_xxx.md）
│
└── DOCS/                    ← 通用文档
    └── CHANGELOG.md         ← 版本变更历史
```

---

## 3. 当前开发进度与功能概览

| 模块 | 核心功能 | 状态 | 交付文件 |
|------|----------|:---:|----------|
| **基础工程架构** | npm workspaces Monorepo, TS配置, 目录规范 | ✅ 完成 | `DEV/package.json`, `tsconfig.base.json` |
| **战斗核心引擎** | 20Hz Tick, 伤害/暴击/吸收, 仇恨表, 光环DoT/HoT, 符文/法力/能量, CD管理器 | ✅ 完成 | `DEV/packages/engine/src/engine/` |
| **5大职业体系** | 死亡骑士、德鲁伊、萨满祭司、法师、潜行者技能库 | ✅ 完成 | `DEV/packages/engine/src/classes/` |
| **AI决策系统** | 200ms周期, 坦克减伤/仇恨, 治疗智能团刷/急救/复活, DPS循环/打断 | ✅ 完成 | `DEV/packages/engine/src/ai/` |
| **影牙城堡5首领** | 亚什布里、席瓦莱恩、斯普林瓦尔、沃登、高弗雷全机制 | ✅ 完成 | `DEV/packages/engine/src/ai/BossAI.ts` |
| **副本状态机** | LOBBY → TRAVEL_RECOVERY(12-15s) → BOSS_COMBAT → WIPE_VOTE(15s) → SUMMARY | ✅ 完成 | `DEV/packages/engine/src/engine/RunStateMachine.ts` |
| **用户与角色系统** | 用户注册/登录, 新建/删除角色, 记录名称/职业/最后天赋 | ✅ 完成 | `DEV/packages/engine/src/auth/AccountManager.ts` |
| **按天赋独立快捷键** | 每个角色针对不同天赋独立保存快捷键偏好习惯 | ✅ 完成 | `AccountManager.ts`, `ActionBar.tsx` |
| **通关证明与奖励** | 副本通关发放证明道具，点击可查看该本全套详细战斗数据 | ✅ 完成 | `ReportManager.ts`, `ClearCertificateModal.tsx` |
| **世界排行榜** | 最快击杀某Boss榜、最高DPS榜、最高非Over有效治疗榜 | ✅ 完成 | `LeaderboardManager.ts`, `LeaderboardModal.tsx` |
| **像素职业头像与4.3图标** | 德鲁伊等5职业精致像素头像（无溢出），原版4.3重绘SVG技能图标与高拟真Tooltip | ✅ 完成 | `DEV/packages/web/src/assets/pixelIcons.ts` |
| **真实技能生效机制** | 回春术HoT周期每3s跳血、生命绽放叠层绽放、宁静8s引导施法、活动炸弹跳火伤与爆炸、骨盾与吸血鬼之血真实减伤与临时血上限 | ✅ 完成 | `CombatEngine.ts`, `AuraManager.ts`, `App.tsx` |
| **影牙城堡5首领真实4.3机制** | 亚什布里窒息抽1血与处决打断、席瓦莱恩诅咒与狼人、斯普林瓦尔亵渎毒圈与顺劈、沃登红绿魔药(走动/静止)、高弗雷60°红色扇形弹幕几何扫射 | ✅ 完成 | `DEV/packages/engine/src/ai/BossAI.ts` |
| **进本前全技能书与快捷键** | 大厅内置全技能书弹窗，查看全技能4.3 Tooltip，直接绑定1~12快捷键至角色账号 | ✅ 完成 | `DEV/packages/web/src/components/SkillBookModal.tsx` |
| **平滑赶路与T开怪衔接** | PULL_APPROACH阶段，主坦领队走在最前开怪进场，喊话挑衅开怪，首领吼叫应战 | ✅ 完成 | `CombatCanvas.tsx`, `App.tsx` |
| **真实范围生效法阵与危险区** | EffectsManager基于距离半径与60°扇形几何判定，圈内生效/圈外无效，百花齐放/治疗之雨/亵渎/双枪弹幕 | ✅ 完成 | `DEV/packages/engine/src/engine/EffectsManager.ts` |
| **WASD键盘移动与打断** | 支持W/A/S/D与方向键自由走位，走动自动打断读条施法与引导，应对毒圈、扇形预警与红绿魔药 | ✅ 完成 | `CombatCanvas.tsx`, `App.tsx` |
| **AI队友智能倾向与Boss追击** | 近战贴脸65px、远程保持220px、残血主动走近治疗法阵、主动躲毒圈；Boss动态追击仇恨目标 | ✅ 完成 | `CombatCanvas.tsx`, `App.tsx` |
| **仇恨OT与首领转火** | 首领目标框显示，近战110%/远程130% OT判定，团队框架红框高亮报警，主坦死亡转火 | ✅ 完成 | `ThreatManager.ts`, `RaidFrames.tsx`, `BossBar.tsx` |
| **动态战斗画面** | 近战贴脸挥砍弧光，远程火球/炎爆飞弹弹道爆破，治疗光束粒子，微移动步态，点击画面选目标 | ✅ 完成 | `DEV/packages/web/src/canvas/CombatCanvas.tsx` |
| **动作栏拖拽与读条** | 技能栏支持HTML5拖拽自由换位，鼠标悬停4.3详细说明，玩家读条施法条与移动打断 | ✅ 完成 | `DEV/packages/web/src/components/ActionBar.tsx` |
| **首领停手与起死回生** | Boss死亡立即终止施法，休整阶段存活治疗读条3秒起死回生复活全员，全员存活方可推进 | ✅ 完成 | `BossAI.ts`, `TravelRecovery.tsx`, `CombatEngine.ts` |
| **右下角Details战斗统计** | 右下角原版Details风格，伤害/有效HPS/承伤/打断多Tab自由切换，职业色直方图 | ✅ 完成 | `DEV/packages/web/src/components/StatsPanel.tsx` |
| **队伍严格5职业补全** | 5人英雄本固定1T+1H+3DPS，玩家选择任意职业切入，AI补齐其余4个互不重复职业(DK/德/萨/法/贼) | ✅ 完成 | `DEV/packages/web/src/App.tsx` |
| **矩形团队框架与HoT扇面** | 56px经典长方形网格，去除AI冗余读条聚焦玩家与Boss，HoT以conic-gradient扇面顺时针转圈展示剩余时长 | ✅ 完成 | `DEV/packages/web/src/components/RaidFrames.tsx` |
| **动作栏扇形CD与就绪高亮** | 本地技能栏黑色半透明扇形扫面CD+倒计时秒数，可释放时呈现金色呼吸流光与光晕边框 | ✅ 完成 | `DEV/packages/web/src/components/ActionBar.tsx` |
| **主坦拉怪背对与常速走位** | T血线安全(>=60%)引Boss至右侧(540,190)背对全团，低血进治疗圈；NPC以min(dist, 2.0)自然步长走位杜绝瞬移 | ✅ 完成 | `DEV/packages/web/src/canvas/CombatCanvas.tsx` |
| **5大首领与职业高精建模** | 亚什布里黑暗大天使虚空之翼、席瓦莱恩青碧幽魂狼人、斯普林瓦尔铁甲巨剑塔盾、沃登双色目镜冒烟药剂、高弗雷双持燧发火枪 | ✅ 完成 | `DEV/packages/web/src/canvas/CombatCanvas.tsx` |
| **暴雪原版Compact团队框架** | 暴雪官方原版紧凑团队框架，金色"小队 1"列标题、高饱和职业纯色全填充、缺血右侧裁切、底部3px高精细亮蓝法力条，四角标准布局 | ✅ 完成 | `DEV/packages/web/src/components/RaidFrames.tsx` |
| **时钟顺时针走扇形倒计时** | Buff全亮→全黑自然消失；动作条CD全黑→全亮金色高亮微光；生命绽放1~3叠层刷新，回春术重置12秒时长 | ✅ 完成 | `RaidFrames.tsx`, `ActionBar.tsx` |
| **脱战技能与全员复活赶路门禁** | 起死回生/先祖之魂战斗中禁用；全员未复活赶路/快进锁定，AI/玩家复活全员方可赶路；CombatEngine.reset彻底清空 | ✅ 完成 | `RunStateMachine.ts`, `CombatEngine.ts`, `App.tsx` |
| **随机地牢迷宫与三类开怪** | 赶路Canvas随机石砖迷宫走廊与摇曳火把探索；首领战备入场；坦克拉怪、靠近<=110px警戒、技能命中三类开怪判定 | ✅ 完成 | `CombatCanvas.tsx`, `App.tsx` |
| **施法距离与Alt+1~9快速选人** | 近战<=80px，远程/治疗<=360px，超距技能动作条红点提示并阻止施法；全局Alt+1~9按团队框架顺序快速切选队友 | ✅ 完成 | `App.tsx`, `ActionBar.tsx` |
| **副本失败灭团统计** | 记录首领剩余血量%、灭团存活时间、首位致死阵亡原因、灭团尝试次数并在灭团投票与总结页面可视化呈现 | ✅ 完成 | `ReportManager.ts`, `WipeVoteModal.tsx`, `SummaryPage.tsx` |
| **连通迷宫与自动寻路** | 种子路径算法确保主干通路连通，赶路10~15s时间控制；提供一键自动寻路与自由操控无缝接管 | ✅ 完成 | `DEV/packages/web/src/canvas/CombatCanvas.tsx` |
| **平滑长按WASD与点地跑动** | 按键状态持续采样消除系统打字延迟，鼠标左键点地平滑匀速奔跑并伴随翠绿水波涟漪特效 | ✅ 完成 | `DEV/packages/web/src/canvas/CombatCanvas.tsx` |
| **纯净半透明范围光环与智能质心** | 彻底去除多余线框；绿治疗、红毒区、橙友伤；治疗之雨自动计算360px内伤员密集几何质心定位 | ✅ 完成 | `CombatCanvas.tsx`, `App.tsx` |
| **专精切换一致性与全职业图标** | 专精切换即时更新技能槽与快捷键，自适应补齐5职业差异阵容，重进副本100%一致；全专精高精SVG像素图标与4.3法术书 | ✅ 完成 | `SkillBookModal.tsx`, `pixelIcons.ts`, `App.tsx` |
| **80/85级基准同比例时长平衡** | 5人英雄本秒伤42k测算，小Boss 2~3分钟(5.8M~6.8M HP)，大Boss 5分钟(12.5M HP)；20人本秒伤250k测算，小Boss 5分钟(75M)，大Boss 8分钟(120M) | ✅ 完成 | `RunStateMachine.ts`, `App.tsx` |
| **移动施法保护与引导保留** | 移动中按读条/引导技能弹出 `⚠️ 移动中无法施法！` 且不进CD不扣蓝；施法启动具备 150ms 缓冲防按键抖动打断；引导中途打断已完成跳数完全保留 | ✅ 完成 | `App.tsx`, `CombatCanvas.tsx` |
| **原生团队框架五层渲染** | Layer 1 基础职业色血条、Layer 2 浅色条纹吸收盾叠加前方不扣真血、Layer 3 预治疗半透明翠绿条、Layer 4 深黑底色、Layer 5 独立角标与图标区 | ✅ 完成 | `RaidFrames.tsx`, `App.tsx` |
| **专精驱散矩阵与独立优先级** | 4.3官方驱散矩阵（恢复德魔/诅/毒；平衡德诅/毒；恢复萨魔/诅；元素萨诅；法师诅；DK/贼无）；内置优先级排序（致命CC>DoT>普通，限3个）；「只看可驱散」过滤与高亮指示器 | ✅ 完成 | `RaidFrames.tsx`, `App.tsx` |
| **UnitInRange 距离衰减与悬停施法** | 依据实际欧氏距离判定，超距（>340px）自动降至40%透明度；鼠标悬停施法（Clique/Mouseover）与右键快捷驱散 | ✅ 完成 | `RaidFrames.tsx`, `App.tsx` |
| **大灾变4.3技能库完整复刻** | 补齐滋养（2.5s读条带HoT增幅20%）、自然之愈、治疗之涌（1.5s快速）、强效治疗波（2.5s大抬血）、净化灵魂、解除诅咒；配套高精像素SVG图标与Tooltip说明 | ✅ 完成 | `pixelIcons.ts`, `SkillBookModal.tsx`, `App.tsx` |
| **三栏动作条36格系统** | 第一栏 `1~=`，第二栏 `Shift+1~Shift+=`，第三栏 `F1~F12`，支持全局监听、拖拽换位与专精持久化 | ✅ 完成 | `ActionBar.tsx`, `defaultActionSlots.ts` |
| **迷宫分列与首领平滑开怪** | 真实深长迷宫（>1000px，10~15s）坦克近战带头、远程治疗跟随；PULL_APPROACH状态全员平滑入场杜绝瞬移 | ✅ 完成 | `CombatCanvas.tsx`, `App.tsx` |
| **读条防从0重读与智能重定向** | 读条期间重复按压技能忽略并不重置进度；友方技能目标为敌对时自动回退自身施法，敌对技能目标为友方时自动重定向首领 | ✅ 完成 | `App.tsx` (`handleCastSlot`) |
| **超距自动靠近与画布单击移动** | 施法距离不足自动步向目标刚好距离并触发施法；画布单击移动、双击选人，团队框架单机一键选中 | ✅ 完成 | `CombatCanvas.tsx`, `App.tsx` |
| **Details! 悬浮技能成分降序拆解** | 鼠标悬浮角色行弹出技能分解卡片，最高输出/治疗技能进度条100%占满，其余技能等比缩放并标明总占比 | ✅ 完成 | `StatsPanel.tsx`, `CombatEngine.ts` |
| **原版紧凑多列团队框架** | 严格复刻魔兽世界实机截图，支持5人单列 / 20人4列（小队1~小队4）金色小队标题，全底职业色，右下角职责银盾，左下角Debuff方块 | ✅ 完成 | `RaidFrames.tsx`, `App.tsx` |
| **5人本与20人团本双模式切换** | 顶部导航一键切换 5人地下城（影牙城堡）与 20人团队副本（巨龙之魂），自适应生成20人全团大名单与小队分配 | ✅ 完成 | `App.tsx`, `RunStateMachine.ts` |
| **自动化测试与验证** | 13套全量测试集（含三栏动作条、迷宫阵型、智能重定向、Details!分解、多列团队框架），13/13 100%全通 | ✅ 完成 | `QA/run_all_tests.ts`, `QA/tests/action_bars_and_maze_formation.test.ts` |

---

## 4. AI 接手操作指引（必须遵循）

1. **先读本文档（`MASTER_INDEX.md`）** 确认顶层目录树与当前定位。
2. **读 `PM/TASK_BOARD.md`** 查看最新完成状态和待办项。
3. **读 `PM/DECISIONS_LOG.md`** 了解架构与业务逻辑裁定，严格避免逆向推翻既有决策。
4. **功能开发分职能存放**：
   - 策划与管理文档存放在 `PM/`
   - 核心逻辑写在 `DEV/packages/engine/src/`
   - 前端界面写在 `DEV/packages/web/src/`
   - 美术资源定义在 `ART/`
   - 测试脚本与验证报告写在 `QA/`
5. **功能完成后执行测试**，并在 `QA/reports/` 记录测试报告。
6. **更新 `PM/TASK_BOARD.md`** 标记进度为 ✅。
