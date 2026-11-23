# L2 实操手册（SOP）：施法/引导状态机与通用 AI 规则调优

> **上级域指南**：`DOCS/domains/COMBAT_AND_CLASSES.md`

---

## 1. 设计原则与核心不变量

### A. 三类施法状态机铁律（`CastLifecycle.ts`）
| 技能类型 | 判定条件 | 起手瞬间（Start） | 中途打断（Interrupt / Move / ESC / Out-of-Range） | 正常结束（Complete） |
|---|---|---|---|---|
| **瞬发 (`INSTANT`)** | `castTimeMs === 0 && !isChannel` | 扣资源 + 进 GCD + 进技能 CD + 立即生效 | — | — |
| **读条 (`CASTED`)** | `castTimeMs > 0 && !isChannel` | 仅检查资源充足 + 启动读条 + 进 GCD；**不扣资源、不进技能 CD** | **0 效果、0 资源消耗、0 技能 CD** | 二次校验资源 → **扣资源 + 进技能 CD + 结算效果** |
| **引导 (`CHANNELED`)** | `isChannel \|\| castTimeMs === -1 \|\| channelDurationMs > 0` | **立即扣资源 + 立即进技能 CD + 进 GCD** + 启动引导条 | 已完成跳数保留，**消耗已发生、技能保持 CD 中** | 结束引导（**禁止再次触发 CD**） |

### B. 通用规则驱动 AI 铁律（禁止按专精硬编码脚本）
- **治疗 AI（`HealerAI.ts` + `SkillMetricEvaluator.ts`）**：
  1. 优先判断坦克是否处于危险线（危机保坦）且多名队友低于健康线 → 若同时满足或 ≥2 名伤员集中掉血，在所有可用技能中**优先挑选 AoE 团抬技能**（如治疗链、治疗之雨、野性成长、宁静、治疗祷言等）；
  2. 其次按 HPM（性价比）与 HPS 综合评分选择单抬或 HoT，禁止所有技能都只无脑刷单一基础治疗波。
- **DPS AI（`DpsAI.ts` + `SkillMetricEvaluator.ts`）**：
  1. 当可命中敌方目标数 `>= 3` 时，在可用技能中**优先选择 AoE 技能**；
  2. 否则按 DPS 期望与资源性价比打循环，并响应打断窗口。

---

## 2. 标准修改流程（Step-by-Step Checklist）

1. **修改施法/引导/打断时机规则**：
   - 先改纯规则源 `DEV/packages/engine/src/engine/CastLifecycle.ts`（零 DOM 依赖）。
   - 确认两端消费者保持同步：
     - 引擎侧：`DEV/packages/engine/src/engine/CombatEngine.ts` (`castSpell` / `tick` / `interruptCast`)
     - 前端玩家侧：`DEV/packages/web/src/hooks/usePlayerCastController.ts` 与 `combat/handlePlayerCastSlot.ts`（`App.handleCastSlot` 仅装配）
2. **修改 AI 决策权重或 AoE 阈值**：
   - 仅改 `DEV/packages/engine/src/ai/SkillMetricEvaluator.ts` 及 `TankAI.ts` / `HealerAI.ts` / `DpsAI.ts` 的通用规则函数。
   - 任何新技能只要在 `ClassRegistry` 正确标注 `isAOE`、`isHeal`、`isBuff`、`isDamage`、`isMajorCd`、`targetType`、`maxStacks`、`cooldownMs`、`resourceCostAmount`，AI 会自动纳入评估与执行，无需在 AI 文件里写 `if (spellId === 'xxx')`。
   - 增/改技能的完整配套清单见 `DOCS/sop/ADD_OR_FIX_SPELL.md`（数据表 → 注册表 → 钩子 → 动作栏/图标 → 地面落点 → AI 标签）。
3. **编写/更新纯逻辑单测**：
   - 必须使用 `node:test` + `node:assert/strict` 在 `DEV/packages/engine/src/__tests__/` 补充可复现断言。

---

## 3. 单一事实源（SSOT）声明

- 瞬发/读条/引导判定与时机策略：`DEV/packages/engine/src/engine/CastLifecycle.ts`。
- 玩家侧读条与引导推进 Hook：`DEV/packages/web/src/hooks/usePlayerCastController.ts`。
- AI 通用评分引擎：`DEV/packages/engine/src/ai/SkillMetricEvaluator.ts`。

---

## 4. 常见反模式与防坑指南

- ❌ **通用技能执行器把所有 `castTimeMs > 0` 标成 `isChannel: false`**：必须先检查 `normSlotSpell.channelDurationMs > 0 || normSlotSpell.castTimeMs === -1`，否则神圣赞美诗、苦修、精神鞭笞、吸取灵魂、唤醒、亡者大军都会丢失引导行为。
- ❌ **引导结束时再次 `triggerCooldown`**：会导致引导技能的 CD 在 8 秒结束时被重置成满 CD（比如 180s 变成 188s）。
- ❌ **读条被打断后仍然扣蓝或进 CD**：违反 WoW 与本项目的核心手感契约。

---

## 5. 最小验收与测试命令

```bash
npx --yes tsx --test DEV/packages/engine/src/__tests__/cast_lifecycle_and_hud_reset.test.ts \
  DEV/packages/engine/src/__tests__/classes_and_universal_ai.test.ts \
  DEV/packages/engine/src/__tests__/smart_ai_metrics_and_personality.test.ts
```
