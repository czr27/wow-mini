# L2 实操手册（SOP）：修改前端界面、房间流与 HUD 布局

> **上级域指南**：`DOCS/domains/UI_AND_ROOMS.md`

---

## 1. 设计原则与核心不变量

- **页面职责清晰解耦**：
  - **首页（`AuthAndCharacterModal.tsx`）**：仅负责账号登录、角色新建/切换、专精天赋与快捷键/全技能书准备、通关证明查看及「进入大厅」入口。**严禁**放回副本模式或挑战难度的前置选择面板。
  - **房间大厅与详情（`RoomListView.tsx` / `RoomDetailView.tsx`）**：负责全部副本选择（5 人/20 人）、难度选择（普通/英雄/自定义及 10 项系数）、AI 成员换职与开战校验。
- **HUD 默认停靠与重置契约**：
  - 动作条默认停靠于**窗体下方中部**（水平居中，距底 `16px`）。
  - 持久化字段 `uiLayout.actionBar` 为 `undefined / null` 时代表“使用默认底部居中位置”；点击「重置」必须将组件状态置 `null` 并向持久化传递 `null`（从存储中删除该字段），**绝对禁止传入 `{ x: 0, y: 0 }`**。
- **可访问性与可测性**：所有交互按钮使用原生 `<button>` 并带清晰文案或 `aria-label`，方便真实用户与浏览器自动化精准定位。

---

## 2. 标准修改流程（Step-by-Step Checklist）

1. **先判定修改归属哪一层**：
   - 首页角色准备界面 → 直接改 `DEV/packages/web/src/components/AuthAndCharacterModal.tsx`（并清理 `App.tsx` 中不再需要的透传 props）。
   - 房间列表/详情/自定义难度 → 改 `DEV/packages/web/src/components/room/RoomListView.tsx` 或 `RoomDetailView.tsx` 及 `DEV/packages/engine/src/room/RoomManager.ts`。
   - 战斗动作条/快捷键/位置重置 → 改 `DEV/packages/web/src/utils/hudLayout.ts` + `DEV/packages/web/src/components/ActionBar.tsx`。
   - 团队框架/目标框/统计面板 → 改 `DEV/packages/web/src/components/{RaidFrames,TargetUnitFrame,StatsPanel}.tsx`。
   - 前端蓝耗/能量等回退表 → 改 `DEV/packages/web/src/combat/spellCosts.ts`（优先仍读 `ClassRegistry`；**不要**再往 `App.tsx` 塞常量）。
   - 房间大厅 leave/create/join/queue/start → 改 `DEV/packages/web/src/hooks/useRoomLobby.ts`。
   - 房间 WS 消息（列表/开战/战斗快照/投票） → 改 `DEV/packages/web/src/hooks/useNetworkRoomSync.ts`。
   - 开本阵容 / 5·20 人 AI 池 / 难度 HP·MP 系数 → 改 `DEV/packages/web/src/combat/setupRaidUnits.ts`。
   - 大厅路由壳 / 战斗 HUD 组合 → 改 `DEV/packages/web/src/screens/LobbyScreen.tsx` 或 `CombatHudScreen.tsx`（Auth 回调仍可留在 App 经 `authPanel` 注入）。
   - 共享 CD / GCD 计算 / 起手资源闸 → 改 `combat/sharedCooldowns.ts`、`playerGcd.ts`、`castResourceGates.ts`。
   - 读条完成结算效果 → 改 `combat/resolvePlayerCast.ts`（App 只留 deps 薄包装）。
   - 瞬发 / HoT / DoT / 数据驱动效果 → 改 `combat/executePlayerInstantEffects.ts`。
   - 自然迅捷 / 硬编码读条启动 → 改 `combat/startPlayerCastBranches.ts`。
   - 玩家起手闸门（guest/GCD/准星/选目标） → 改 `combat/handlePlayerCastSlot.ts`（App 只装配 deps-bag）。
   - 友方 AI 施法执行 / 决策循环 → 改 `combat/aiCombatExecutor.ts`。
   - 20Hz 战斗帧（guest HUD / host 广播 / 读条推进 / 普攻） → 改 `combat/runCombatTick.ts` + `hooks/useCombatTick.ts`。
   - 继续保持 `App.tsx` 装配壳 → 严格按 `DOCS/domains/UI_AND_ROOMS.md` §4；P1–P8 已完成，新增逻辑勿堆回 App。
2. **凡涉及可拖拽 HUD 定位/重置**：
   - 必须调用 `DEV/packages/web/src/utils/hudLayout.ts` 中的纯函数（`sanitizeSavedActionBarPos`、`clampHudPosToViewport`、`computeBottomCenterPos`）。
   - 持久化回调签名支持 `(pos: { x: number; y: number } | null) => void`，并在 `AccountManager.saveCharacterUiLayout` 中遇到 `null` 时 `delete char.uiLayout[key]`。
3. **防回归核对**：
   - 修改首页后，确认房间内仍可正常切换 5人/20人、普通/英雄/自定义难度且首战立即生效。
   - 修改 HUD 布局后，确认拖拽、点「重置」、刷新页面后位置均符合预期（动作条位于窗体下方中部，不在左上角）。

---

## 3. 单一事实源（SSOT）声明

- HUD 坐标清洗、底部居中计算与视口钳制：`DEV/packages/web/src/utils/hudLayout.ts`。
- 角色 UI 布局持久化：`DEV/packages/engine/src/auth/AccountManager.ts` (`saveCharacterUiLayout`)。
- 房间配置（副本规格、难度、自定义系数、成员列表）：`DEV/packages/engine/src/room/RoomManager.ts`。
- 前端资源消耗回退表：`DEV/packages/web/src/combat/spellCosts.ts`（技能权威数值仍归 `ClassRegistry`）。
- 单位资源镜像与 AI 扣费：`DEV/packages/web/src/combat/unitResources.ts`。
- 玩家施法起手编排：`DEV/packages/web/src/combat/handlePlayerCastSlot.ts`。
- 友方 AI 战斗执行：`DEV/packages/web/src/combat/aiCombatExecutor.ts`。
- 20Hz 战斗帧：`DEV/packages/web/src/combat/runCombatTick.ts`（由 `hooks/useCombatTick.ts` 驱动）。

---

## 4. 常见反模式与防坑指南

- ❌ **重置时传 `{ x: 0, y: 0 }`**：`{ x: 0, y: 0 }` 在 JS 中是 truthy 对象，会被组件当作用户手动拖到了左上角 (`fixed left: 0 top: 0`)！
- ❌ **把副本难度配置塞回首页**：会与房间内的难度配置形成双事实源冲突，造成用户困惑。
- ❌ **在 `App.tsx` 里堆积大段渲染细节或战斗表**：任何新面板、消耗表、独立状态机应封装为子组件、`combat/` 纯模块、自定义 Hook 或 `utils/` 纯函数。
- ❌ **把 state 迁入未接线的 `store/gameStore`**：避免第二真相源；tick/施法已走 deps-bag。

---

## 5. 最小验收与测试命令

```bash
npx --yes tsx --test DEV/packages/engine/src/__tests__/cast_lifecycle_and_hud_reset.test.ts \
  DEV/packages/engine/src/__tests__/room_lifecycle_and_sync.test.ts
```
并在真实浏览器（1440×900）核查对应页面快照与视觉布局。
