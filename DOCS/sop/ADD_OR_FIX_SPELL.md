# L2 实操手册（SOP）：增加或修正技能（数值 / 真实机制 / 冷却）

> **上级域指南**：`DOCS/domains/COMBAT_AND_CLASSES.md`  
> **强关联手册**：若涉及读条/引导/打断/资源消耗时机，必同时阅读 `DOCS/sop/CAST_AND_AI_RULES.md`。

---

## 1. 设计原则与核心不变量

- **拒绝“空壳技能”**：每个技能不能只在 Tooltip 里写说明，必须在 `CombatEngine` 或 `ClassRegistry` 中有真实生效的效果（直伤/直疗/DoT/HoT/吸收盾/减伤/回蓝/嘲讽/打断/派生联动）。
- **三类施法契约强一致**：
  - 瞬发（`castTimeMs === 0`）：起手立即扣资源 + 进 GCD + 进 CD + 生效。
  - 读条（`castTimeMs > 0` 且非引导）：起手仅检查资源 + 进 GCD；**读条成功完成才扣资源并进 CD**；打断不扣资源不进 CD。
  - 引导（`isChannel` / `castTimeMs === -1` / `channelDurationMs > 0`）：**起手即扣资源 + 立即进 CD + 进 GCD**；周期跳数依次结算；打断后保留已生效跳数与冷却，结束时不重复进 CD。
- **80 级满级满急速标尺**：GCD 遵循 `NORMAL`（1.5s 受 50% 急速缩至 1.0s）、`ROGUE`（1.0s 固定）、`OFF_GCD`（0ms）。
- **AI 数据驱动**：新技能只要在 `ClassRegistry` 标好语义标签，通用 AI **自动纳入**评估与执行；**禁止**再写 `if (spellId === 'xxx')` 专精脚本。

---

## 2. 标准扩展流程（Step-by-Step Checklist）

> 改/加一个技能时，按下面清单**逐项确认**；缺任一项都会出现“技能书有、施放无效 / AI 不用 / 动作栏没有”等半成品状态。

### A. 必做（每个技能）

1. **定义技能数据** — `DEV/packages/engine/src/classes/<Class>.ts`
   - 填写准确 `id`、`name`、`school`、资源消耗、`castTimeMs`、`channelDurationMs`（引导必填）、`cooldownMs`、`gcdCategory` / `gcdType`、`effects`、`targetType`、`spec`（专精限定时）。
   - 叠层 Buff（如大地之盾）必须写 `maxStacks`；数值按 **80 级满级**标定。
2. **确认注册表标准化** — `DEV/packages/engine/src/classes/ClassRegistry.ts`
   - 确认 `normalizeLegacySpell` / `normalizeModernSpell` 能正确产出：`isAOE`、`isHeal`、`isDamage`、`isBuff`、`isDefensive`、`isInterrupt`、`isTaunt`、`isResourceRestore`、`isMajorCd`、`maxStacks`、`groundKind`、`channelDurationMs` 等。
   - 若 UI / 旧存档使用短 ID 别名（如 `healing_tide` → `shaman_healing_tide_totem`），在 `SHORT_ID_ALIASES` 补映射。
3. **前端展示与默认槽位**
   - `DEV/packages/web/src/assets/pixelIcons.ts`：SVG 图标与 Tooltip（可回退读 `ClassRegistry`）。
   - `DEV/packages/web/src/assets/defaultActionSlots.ts`：核心技能放入对应专精默认动作栏。
   - `OFF_GCD`：确保注册表 `gcdCategory: 'OFF_GCD'`（`ActionBar` 会自动同步）。

### B. 按技能类型选做（配合完成）

4. **特殊机制钩子**（受击触发、伤害/治疗转化、下一口增效、形态复制等）— `DEV/packages/engine/src/engine/CombatEngine.ts`
   - 在 `SPELL_ID_TO_NAME` 补中文名（Details! 统计）。
   - 在 `applyDamage` / `applyHeal` / `resolveSpell` 挂钩子；`reset()` 清理内置 CD 缓存。
   - 派生治疗必须 `isDerived = true`，防递归。
5. **地面目标技能**（治疗之雨、治疗之潮、枯萎凋零、灵魂链接等）
   - `DEV/packages/engine/src/types.ts` → `GROUND_TARGET_SPELL_DEFS` 增加半径/颜色/最大距离。
   - 确认 `EffectsManager` 对 `TOTEM` / `HEAL_ZONE` / `DAMAGE_ZONE` 跳字逻辑能识别该 `spellId`（必要时加别名匹配）。
6. **资源与读条**
   - 读条/引导时机改动：同步看 `CastLifecycle.ts` + `usePlayerCastController.ts`（详见 `CAST_AND_AI_RULES.md`）。
   - 避免在 `App.tsx` 再堆技能专属 `if/else`；优先走 ClassRegistry 执行器。

### C. AI（通常不必改代码）

7. **AI 自动纳入条件**（`SkillMetricEvaluator.buildUsableCandidatesForUnit`）
   - 治疗：`isHeal` 或治疗向支持 Buff（友方 `isBuff` / 自身 `isMajorCd` 增效）。
   - 伤害：`isDamage` 或输出向增效 Buff。
   - 团抬：正确标 `isAOE` + 治疗量；大招 CD ≥ 45s → `isMajorCd`。
   - **不要**为单个新技能去改 `HealerAI` / `DpsAI` / `TankAI` 的 spellId 白名单。
8. 仅当要改**全局优先级阈值**（如 AoE 人数门槛、危急血线）时，才动 `SkillMetricEvaluator.ts` 的通用规则。

---

## 3. 单一事实源（SSOT）声明

| 内容 | 事实源 |
|---|---|
| 技能数值 / CD / GCD / 标签 | `classes/*.ts` → `ClassRegistry.ts` |
| 瞬发/读条/引导时机 | `CastLifecycle.ts` |
| 特殊被动联动 | `CombatEngine` 钩子（`applyDamage` / `applyHeal`） |
| AI 候选与评分 | `SkillMetricEvaluator`（读 ClassRegistry，禁止 spellId 脚本） |
| 默认动作栏 | `assets/defaultActionSlots.ts` |
| 地面落点 UI | `GROUND_TARGET_SPELL_DEFS`（`types.ts`） |

---

## 4. 常见反模式与防坑指南

- ❌ **只改 Tooltip / 动作栏，不改 `classes/*.ts`**：AI 与引擎看不到技能。
- ❌ **空壳技能**（只有描述、无 `effects` / 无钩子）：注册表会标成无效或 AI 永不选用。
- ❌ **把引导 CD 写在结束分支**：移动/ESC 打断后 CD 失效。
- ❌ **读条起手就扣蓝**：打断会白扣资源。
- ❌ **在 `App.tsx` 为每个新技能加专属分支**：应走 ClassRegistry + 通用执行器；仅特殊被动进 `CombatEngine` 钩子。
- ❌ **地面技能忘了 `GROUND_TARGET_SPELL_DEFS`**：玩家无法进落点模式。
- ❌ **维护 Buff 未标 `targetType` / `maxStacks` / `isBuff`**：AI 不会自动补大地之盾/道标一类技能。

---

## 5. 最小验收与测试命令

```bash
npx --yes tsx --test \
  DEV/packages/engine/src/__tests__/cast_lifecycle_and_hud_reset.test.ts \
  DEV/packages/engine/src/__tests__/classes_and_universal_ai.test.ts \
  DEV/packages/engine/src/__tests__/ai_data_driven_spells.test.ts \
  DEV/packages/engine/src/__tests__/shaman_spell_hooks.test.ts
```

建议自测：技能书可见 → 动作栏可拖/默认可放 → 实战有效果与 CD → AI 队友在对应场景会选用（治疗/AOE/维护 Buff）。
