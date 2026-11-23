# L1 域指南：战斗核心、10 大职业与通用 AI（Combat & Classes）

> **上级入口**：`MASTER_INDEX.md`  
> **下级实操手册（L2）**：
> - `DOCS/sop/ADD_HERO_CLASS.md`（添加/调整英雄职业与专精）
> - `DOCS/sop/ADD_OR_FIX_SPELL.md`（增加/修正技能机制、数值与钩子）
> - `DOCS/sop/CAST_AND_AI_RULES.md`（读条/引导/打断状态机与 AI 通用决策规则）

---

## 1. 域职责与核心数据流

本域负责所有“进入副本后如何施法、如何算伤算疗、AI 如何决策”的规则，核心完全沉淀在纯 TypeScript 引擎包（`DEV/packages/engine/src/`）中，前端仅消费状态与渲染反馈。

```
[玩家输入 / AI 200ms 决策]
         │
         ▼
[CastLifecycle 纯规则机] ── 判断 INSTANT / CASTED / CHANNELED
         │                   决定：起手是否扣资源？起手是否进CD？打断如何处理？
         ▼
[CombatEngine 20Hz Tick] ── ResourceManager / CooldownManager / AuraManager / ThreatManager
         │                   └─ applyDamage / applyHeal / resolveSpell 真实技能钩子
         ▼
[EffectsManager + CombatStats] ── 地面法阵、跳字、Details! 统计、战报汇总
         │
         ▼
[Web 表现层消费] ── usePlayerCastController / ActionBar / PlayerCastBar / RaidFrames / Canvas
```

---

## 2. 关键模块边界速查

| 子模块 | 所在路径 | 职责边界 |
|---|---|---|
| **施法生命周期纯规则** | `DEV/packages/engine/src/engine/CastLifecycle.ts` | 瞬发/读条/引导三类技能的起手消耗、起手冷却、打断行为、结束结算唯一事实源 |
| **战斗核心引擎** | `DEV/packages/engine/src/engine/CombatEngine.ts` | 20Hz 主循环、单位管理、`castSpell` / `interruptCast`、`applyDamage` / `applyHeal` 真实联动钩子（升腾/大地之盾/生命释放/先祖指引/圣光道标等） |
| **10 职业定义与总注册表** | `DEV/packages/engine/src/classes/*.ts`<br>`DEV/packages/engine/src/classes/ClassRegistry.ts` | 10 职业 30 专精技能表、`LEVEL_80_MAX_HASTE = 0.50`、`getEffectiveGcdMs`、`getHastedCastTimeMs`、`getSpellByAnyId`、标准化 `NormalizedSpell` |
| **通用规则 AI** | `DEV/packages/engine/src/ai/SkillMetricEvaluator.ts`<br>`DEV/packages/engine/src/ai/{Tank,Healer,Dps}AI.ts` | 依据单位可用技能动态评分：治疗（危机保坦 → 多人低于健康线优先 AoE → 性价比单抬）、DPS（≥3 目标优先 AoE → 性价比循环）、坦克（嘲讽/仇恨/减伤） |
| **前端玩家施法控制器** | `DEV/packages/web/src/hooks/usePlayerCastController.ts` | 封装玩家侧读条与引导推进、周期跳数、移动/ESC/超距打断，直接调用 `CastLifecycle` 纯规则 |

---

## 3. 本域绝对不变量

1. **所有 10 职业共享同一标准管线**：`DK / DRUID / SHAMAN / MAGE / ROGUE / WARRIOR / PALADIN / HUNTER / PRIEST / WARLOCK`，禁止前端为某个职业编写与引擎定义相冲突的平行数值表。
2. **引导判定单一来源**：只要 `spell.castTimeMs === -1` 或 `spell.channelDurationMs > 0`（或显式标记 `isChannel: true`），在引擎与前端两侧**均必须**走 `CHANNELED` 分支。
3. **派生治疗防递归**：由先祖指引、圣光道标、吸血鬼拥抱等被动钩子触发的派生治疗，必须传 `isDerived = true` 防止无限递归。
4. **纯逻辑必须可单测**：任何数值公式、施法状态转移、AI 权重评分必须无浏览器 DOM 依赖，可直接通过 `npx --yes tsx --test` 验证。
