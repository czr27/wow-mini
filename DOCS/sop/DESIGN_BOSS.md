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
3. **根据副本攻略补充 DBM 播报信息（严控密集度）** — `BossTypes.ts` (`BossSkill.dbm`) & `DEV/packages/engine/src/engine/DbmManager.ts`
   - **克制原则（防刷屏）**：**禁止**为常规掉血、普通 AOE 治疗或坦克常规减伤配置报警（玩家看血条即可反应）。引擎仅自动为 `interruptible: true` 读条生成「注意打断」及敌方 `ADD` 增援生成「先杀小怪」。
   - **只报“必须知道的机制”**：对照副本攻略，仅针对「注意分散」「近距分摊」「躲柱子后」「安全抬血」「转阶段」等光看血条无法判断的机制，在 `BossSkill.dbm` 显式填写简短建议（`advice`）、4 字短语音（`voiceText`，如 `"注意分散"`）、`severity` 与 `preWarnMs`。
   - **同技能顶替与密集度控制**：同一技能的 `即将施放` 预告与 `正在施放` 提示共用 `replaceKey`（自动原地顶替，不新起条目）；阶段切换调用 `engine.emitDbmAlert(...)` 时也应控制冷却与条数，避免同一时间点连续弹出多条干扰判断。
   - **高威胁大招个性狠话（不重复随机）** — `DEV/packages/engine/src/bosses/core/BossTrashTalk.ts`：每个首领必须在 `BOSS_TRASH_TALK_LINES[bossId]` 中配置至少 **4 句**贴合自身人设与技能风格的狠话（如用毒者强调“最新研制的毒药”、炮手强调火力轰炸、奥法强调禁言/爆轰等），**不同 Boss 之间台词不得雷同**；引擎在释放高威胁技能时通过 `BossTrashTalkDeck` 洗牌袋机制随机抽取，确保一轮内**不重复**播报。
4. **仇恨与坦伤校验** — `DEV/packages/engine/src/engine/ThreatManager.ts`
   - 确保首领普攻与顺劈优先锁定第一仇恨目标（近战 110% / 远程 130% OT 阈值），坦克阵亡时平滑转火第二仇恨。
4. **Canvas 像素形象、预警与机制特效渲染** — `DEV/packages/web/src/canvas/CombatCanvas.tsx` / `DEV/packages/web/src/combat/bossLinkFx.ts`
   - 为新 Boss 添加高辨识度像素造型（或复用模板配色），确保预警光环使用纯净半透明色（红=敌方危险区、绿=友方治疗圈、橙=友伤提示）。
   - **空间与持续性机制必须有对应视觉特效**：凡涉及空间连线/拉开扯断（如 `toxic_link`、`resonating_crystal`、`conductive_crystal` → `bossLinkFx.ts`）、控场/形变（如 `asphyxiate` 悬空窒息环、`ice_tomb` 冰晶包裹、`STUN`/`SILENCE` 头顶状态环）、随人移动的警戒圈（如 `chest_bomb` 55px 爆炸圈）等，**必须**在 Canvas 实装对应特效，并由光环（`APPLY_BUFF`/`REMOVE_BUFF`）或 `groundEffects` 权威驱动，保证单机与联机同步可见；禁止“只扣血/只飘字但画面无特效”。
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
  DEV/packages/engine/src/__tests__/dbm_necessity.test.ts \
  QA/tests/smart_ai_metrics_and_personality.test.ts
```

## 强制验收：DBM 双向必要性测试
每次新增副本/首领或调整 Boss 技能机制时，**必须**同步校验 DBM（参考 `DEV/packages/engine/src/__tests__/dbm_necessity.test.ts`）：
1. **正向校验（严重后果 → 必须有 DBM）**：在 AI 模拟测试副本中，凡是会导致严重后果的机制（灭团、秒杀、大额掉血、强控、降疗、必须转火/走位/分摊），反过来检查该机制是否已配置 `skill.dbm`、高威胁 `interruptible` 或阶段 `emitDbmAlert`。
2. **反向校验（已设 DBM → 故意反着做验证必要性）**：对已设置 DBM 的技能，在测试用例中故意**反着做**（如提示「保持移动」却站桩、提示「躲柱子后」却站柱外、提示「注意远离」却贴近、提示「注意打断」却不打断），验证确实会产生严重后果；若反着做毫无痛痒，说明该 DBM 属于无效噪音，应删除以防刷屏。

## 强制验收：全随机 AI 普通模式通关测试
每完成一个首领（或机制改动）后，**必须**新增/运行普通模式全随机 AI 通关测试（参考 `DEV/packages/engine/src/__tests__/dungeon_normal_ai_clear.test.ts`）：
1. **随机填满队伍**：按副本规模填满全 AI 队伍（5 人本：1 坦 1 治 3 DPS），各位置从可用职业池中**随机抽取**。
2. **至少重复 3 轮**：连续跑 **3 轮**以上不同职业组合，确保覆盖多职业搭配。
3. **必须通关普通模式**：每轮均须在合理战斗时长内击杀首领并通关普通模式；若未通过，必须排查是 **AI 未理解机制**（如未打断、未躲圈、未拉小怪）还是 **Boss 数值/机制设计不合理**，修复后再提交。
