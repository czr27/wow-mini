# L2 实操手册（SOP）：设计 Boss 首领与战斗机制

> **上级域指南**：`DOCS/domains/DUNGEONS_AND_BOSSES.md`

---

## 1. 设计原则与核心不变量

- **机制可辨识、可应对**：每个首领核心技能应属于清晰的可交互类别——可打断读条、地面危险区（圆形毒圈/60° 扇形扫射）、可驱散 Debuff（魔法/诅咒/毒）、坦克高压顺劈或全团周期 AOE。
- **几何判定真实生效**：地面危险区必须通过 `EffectsManager` 的半径或扇形角度判定真实伤害，站圈外不受伤、站圈内受罚，玩家 WASD/点地走位与 AI 自动避险均依赖此坐标。
- **首领阵亡绝对停手**：Boss 死亡瞬间立刻中断当前读条并清理其敌方预警区域，杜绝死后继续放技能。

---

## 2. 标准设计流程（Step-by-Step Checklist）

1. **定义首领档案与技能表** — `DEV/packages/engine/src/bosses/<dungeon>/<Boss>.ts`
   - 填写 `id`、`name`、`maxHp`、基础普攻伤害、各技能的 `cooldownMs`、`castTimeMs`、`interruptible`、`damage`、`debuffType`（如可驱散需标明 `MAGIC` / `CURSE` / `POISON` / `DISEASE`）。
2. **编排时间轴与特殊机制** — `DEV/packages/engine/src/bosses/<dungeon>/` + `DEV/packages/engine/src/bosses/core/`
   - 首领 AI 继承 `BaseBossAI`（`bosses/core/BaseBossAI.ts`），重写阶段流转与技能周期。
   - 在 `bosses/<dungeon>/index.ts` 中通过 `BossRegistry.registerBoss(...)` 或 `register<Dungeon>Bosses()` 注册到总线，并在 `bosses/index.ts` 统一调用初始化。
   - **禁止**直接向 `DEV/packages/engine/src/ai/BossAI.ts` 追加首领代码（该文件已降级为仅 6 行的兼容重导出）。
   - 若技能生成地面区域（毒圈/扇形弹幕），调用 `engine.effectsManager.addGroundZone(...)` 写入坐标、半径/角度、持续时间与跳伤。
3. **根据副本攻略补充 DBM 播报信息** — `BossTypes.ts` (`BossSkill.dbm`) & `DEV/packages/engine/src/engine/DbmManager.ts`
   - **自动推导兜底**：`BaseBossAI.initBossSkills()` 会自动为可打断读条、AOE 技能、高威胁冷却生成默认 DBM 规则；召唤敌方 `ADD` 小怪与敌方地面危险区也会自动触发「先杀小怪」「注意躲避」提示。
   - **攻略特殊机制显式标注**：对照副本攻略，凡涉及「分散 / 近距分摊」「躲柱子 / 安全区」「安全治疗窗」「转阶段 / 狂暴」等引擎无法从数值反推的机制，**必须**在 `BossSkill.dbm` 中填写简短建议（`advice`、`severity`、`roleHint`、`preWarnMs`），并在 `onTick` / `execute` 阶段切换处调用 `engine.emitDbmAlert(...)`（由房主权威同步给全团客机）。
4. **仇恨与坦伤校验** — `DEV/packages/engine/src/engine/ThreatManager.ts`
   - 确保首领普攻与顺劈优先锁定第一仇恨目标（近战 110% / 远程 130% OT 阈值），坦克阵亡时平滑转火第二仇恨。
4. **Canvas 像素形象与预警渲染** — `DEV/packages/web/src/canvas/CombatCanvas.tsx`
   - 为新 Boss 添加高辨识度像素造型（或复用模板配色），确保预警光环使用纯净半透明色（红=敌方危险区、绿=友方治疗圈、橙=友伤提示）。
5. **数值压力核对**
   - 确认普通、英雄（血量 1.5x / 输出 1.2x）、自定义难度下坦克可承压、治疗在通用 AI 规则下不会瞬间 OOM 或无解秒杀。

---

## 3. 单一事实源（SSOT）声明

- 首领静态属性与技能清单：`DEV/packages/engine/src/bosses/<dungeon>/*.ts`。
- 首领公共决策与时间轴基类：`DEV/packages/engine/src/bosses/core/BaseBossAI.ts` 与各副本派生 AI。
- 首领总注册表与工厂：`DEV/packages/engine/src/bosses/core/BossRegistry.ts` (`createBossAI`)。
- 地面范围几何判定：`DEV/packages/engine/src/engine/EffectsManager.ts`。
- DBM 规则推导与房主权威播报队列：`DEV/packages/engine/src/engine/DbmManager.ts`。

---

## 4. 常见反模式与防坑指南

- ❌ **直接往 `ai/BossAI.ts` 写死新 Boss 脚本**：新首领必须按副本拆分进 `bosses/<dungeon>/` 并走 `BossRegistry`。
- ❌ **把不可驱散 Debuff 标成可驱散或忘记标类型**：团队框架的「只看可驱散」和专精驱散矩阵完全依赖 Debuff 类型字段。
- ❌ **只画视觉特效不写 `EffectsManager` 判定**：会导致玩家躲出红圈仍然掉血，破坏走位体验。
- ❌ **首领技能伤害绕过 `CombatEngine.applyDamage`**：会导致自定义难度 `enemyDamageCoeff`、坦克减伤、大地之盾与承伤统计全部失效。

---

## 5. 最小验收与测试命令

```bash
npx --yes tsx --test DEV/packages/engine/src/__tests__/classes_and_universal_ai.test.ts \
  DEV/packages/engine/src/__tests__/dbm_alerts.test.ts \
  QA/tests/smart_ai_metrics_and_personality.test.ts
```
