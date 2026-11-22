# 🧪 测试报告：Phase 1.9 连通迷宫寻路、平滑操控、纯净范围光环、专精切换一致性与副本时长平衡测试

> **测试时间**：2026-11-21  
> **执行环境**：Node.js ESM + Vite 5.4 + TypeScript 5.6 (Windows 11)  
> **测试状态**：🎉 全部通过（11/11 测试集，100% 通过率）  
> **覆盖范围**：保证连通迷宫通路、Auto-Pathfinding自动寻路、长按WASD连续平滑移动、点地跑动、无边框半透明地面光环、智能伤员质心定位、专精切换一致性、全职业4.3像素图标法术书、5人本(2~3m / 5m)与20人本(5m / 8m)数值平衡。

---

## 1. 测试集概览

| 测试套件 ID | 模块名称 | 测试项数 | 通过项 | 失败项 | 结果 |
|------------|----------|:--------:|:------:|:------:|:----:|
| **T-01** | 战斗引擎核心系统（伤害、暴击、过量治疗、仇恨表与嘲讽） | 6 | 6 | 0 | ✅ PASS |
| **T-02** | 5大职业核心技能机制联动（鲜血护盾、生命绽放、嗜血疲惫） | 4 | 4 | 0 | ✅ PASS |
| **T-03** | 副本状态机（LOBBY→TRAVEL→COMBAT→WIPE→SUMMARY） | 5 | 5 | 0 | ✅ PASS |
| **T-04** | 影牙城堡 5 位首领核心机制端到端测试 | 5 | 5 | 0 | ✅ PASS |
| **T-05** | 账号、角色、独立天赋快捷键习惯与世界排行榜 | 5 | 5 | 0 | ✅ PASS |
| **T-06** | 画面视觉渲染与色彩体系规范自动化验证 | 4 | 4 | 0 | ✅ PASS |
| **T-07** | 仇恨OT机制、首领转火、起死回生与交互系统验证 | 4 | 4 | 0 | ✅ PASS |
| **T-08** | 真实技能机制 (HoT/DoT/引导/Buff/区域效果) 与首领机制 | 4 | 4 | 0 | ✅ PASS |
| **T-09** | 队伍阵容补全差异化、矩形框架HoT扇面、动作条CD与首领视觉AI | 5 | 5 | 0 | ✅ PASS |
| **T-10** | 原版团队框架规范、迷宫赶路复活门禁、三类开怪判定与灭团统计 | 6 | 6 | 0 | ✅ PASS |
| **T-11** | 天赋专精切换一致性、迷宫通道寻路与副本数值时长控制测试 | 5 | 5 | 0 | ✅ PASS |
| **总计** | **全系统集成与端到端验证** | **53** | **53** | **0** | **✅ 100%** |

---

## 2. Phase 1.9 关键测试详情

### 2.1 天赋专精切换一致性（Spec Switching Consistency）
- **用例**：
  - DK角色自鲜血专精（主坦，`BLOOD`）切换至冰霜专精（输出，`FROST`）。
  - 德鲁伊自恢复专精（治疗，`RESTORATION`）切换至平衡专精（输出，`BALANCE`）。
  - 萨满自恢复专精切换至元素专精（`ELEMENTAL`）。
  - 法师切换火焰 / 冰霜 / 奥术专精。
  - 潜行者切换战斗 / 刺杀专精。
- **校验点**：
  1. `customSlotLayout` 自动清空重置，动作条技能槽精确切换为对应专精的原版技能组。
  2. 角色职责即时刷新（`TANK` / `HEALER` / `DPS`），AI队友自动自适应重新分配（始终保持 1T+1H+3DPS，5职业互不重复）。
  3. 各专精独立快捷键习惯即时加载，重进副本保持 100% 一致。
- **结论**：✅ **验证通过**。

### 2.2 保证连通迷宫通路与自动寻路（Guaranteed Corridor & Auto-Pathfinding）
- **用例**：
  - 基于固定航路点算法（Waypoint Corridor），自入口坐标 `(120, 180)` 至出口传送门 `(680, 180)` 生成连续开放的石砌主走廊。
  - 自动寻路系统（Auto-Pathfinding）：顶部横幅一键启闭，全自动匀速引导玩家角色沿航路点前往传送门，全程用时约 12 秒（严格控制在 10~15 秒需求区间内）。
  - 玩家按下任意 WASD 或点地移动时无缝接管控制。
- **结论**：✅ **验证通过**。

### 2.3 连续平滑操控与点地跑动（Smooth WASD & Click-to-Move）
- **用例**：
  - 键盘操作采用持续按键状态采样（`Set<string>`），长按 W/A/S/D 或方向键无操作系统按键重复延迟（Key-repeat delay）或卡顿，连续平滑推进。
  - 鼠标左键点击画布任意可行走区域，在目标位置生成向外扩散淡出的翠绿色水波涟漪特效，角色以 2.0px/帧 自然跑步速度奔向目标点。
  - 任何移动立即打断正在进行的施法读条或引导法术。
- **结论**：✅ **验证通过**。

### 2.4 纯净半透明范围光环与智能伤员质心定位（Glow Rings without Wireframes & Smart Centroid）
- **用例**：
  - 彻底去除所有地面技能的多余线框与描边，全部采用柔和径向渐变（Radial Gradient）高精纯净半透明光晕渲染：
    - 友方治疗类技能（百花齐放、治疗之雨）：翠绿半透明柔和光晕（`rgba(34, 197, 94, 0.40)`）+ 晶莹粒子点缀。
    - 首领危险地面毒区（亵渎、三色魔药）：深红半透明危险光环，常驻于地面直到技能完全消失。
    - 友方对敌对目标伤害效果（枯萎凋零、寒冰宝珠）：暖橙半透明光环。
    - 图腾效果（灵魂链接）：青蓝图腾光环。
  - **智能质心定位**：治疗之雨自动扫描施法者 360px 范围内的存活友方，优先筛选受伤队友并计算伤员几何质心（Centroid：`avgX, avgY`），将治疗雨精准释放在伤员最密集处。百花齐放/灵魂链接锚定在目标队友脚下。
- **结论**：✅ **验证通过**。

### 2.5 80/85级同等级基准数值平衡与Boss击杀时长严格控制
- **标准测算基准**：
  - 5人英雄本：团队秒伤按 42,000 DPS 计算（1坦 ~4,000 DPS，3输出 ~38,000 DPS）。
  - 20人团队本（巨龙之魂）：团队秒伤按 250,000 DPS 计算。
- **Boss 血量与时长对应**：
  - 5人本小 Boss（亚什布里、席瓦莱恩、斯普林瓦尔、沃登）：血量 5.8M ~ 6.8M HP，战斗时长 138s ~ 162s（**严格控制在 2~3 分钟**）。
  - 5人本大 Boss（高弗雷勋爵）：血量 12.5M HP，战斗时长 298s（**严格控制在 5 分钟**）。
  - 20人本小 Boss（莫卓克等）：血量 75M HP，战斗时长 300s（**严格控制在 5 分钟**）。
  - 20人本大 Boss（死亡之翼的疯狂）：血量 120M HP，战斗时长 480s（**严格控制在 8 分钟**）。
- **结论**：✅ **验证通过**。

---

## 3. 产出物文件索引

1. 战斗引擎与副本配置：
   - [RunStateMachine.ts](file:///g:/Desktop/wow_simu/DEV/packages/engine/src/engine/RunStateMachine.ts)
   - [CombatEngine.ts](file:///g:/Desktop/wow_simu/DEV/packages/engine/src/engine/CombatEngine.ts)
   - [types.ts](file:///g:/Desktop/wow_simu/DEV/packages/engine/src/types.ts)
2. 前端界面与渲染：
   - [CombatCanvas.tsx](file:///g:/Desktop/wow_simu/DEV/packages/web/src/canvas/CombatCanvas.tsx)
   - [App.tsx](file:///g:/Desktop/wow_simu/DEV/packages/web/src/App.tsx)
   - [pixelIcons.ts](file:///g:/Desktop/wow_simu/DEV/packages/web/src/assets/pixelIcons.ts)
   - [SkillBookModal.tsx](file:///g:/Desktop/wow_simu/DEV/packages/web/src/components/SkillBookModal.tsx)
   - [AuthAndCharacterModal.tsx](file:///g:/Desktop/wow_simu/DEV/packages/web/src/components/AuthAndCharacterModal.tsx)
3. 测试文件：
   - [spec_switch_and_corridor_balance.test.ts](file:///g:/Desktop/wow_simu/QA/tests/spec_switch_and_corridor_balance.test.ts)
   - [run_all_tests.ts](file:///g:/Desktop/wow_simu/QA/run_all_tests.ts)
4. 管理与决策：
   - [TASK_BOARD.md](file:///g:/Desktop/wow_simu/PM/TASK_BOARD.md)
   - [DECISIONS_LOG.md](file:///g:/Desktop/wow_simu/PM/DECISIONS_LOG.md)
   - [MASTER_INDEX.md](file:///g:/Desktop/wow_simu/MASTER_INDEX.md)
