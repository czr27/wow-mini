# L2 实操手册（SOP）：新增/调整英雄职业与专精

> **上级域指南**：`DOCS/domains/COMBAT_AND_CLASSES.md`

---

## 1. 设计原则与核心不变量

- **80 级满级满急速数值基线**：基础急速 `LEVEL_80_MAX_HASTE = 0.50`，基础属性/血量/法力/输出治疗数值需与既有 10 大职业（DK、德鲁伊、萨满、法师、潜行者、战士、圣骑士、猎人、牧师、术士）处于同一档位。
- **三专精完整性**：每个职业包含 3 套完整专精，每套专精均需明确职责（`TANK` / `HEALER` / `DPS`）、资源体系（`MANA` / `RAGE` / `ENERGY` / `FOCUS` / `RUNIC_POWER` / `HOLY_POWER` / `COMBO_POINTS`）与默认 36 格动作条映射。
- **数据驱动优先**：新增职业尽量走 `ClassRegistry` 通用执行管线，避免在 `App.tsx` 中追加大量硬编码分支。

---

## 2. 标准扩展流程（Step-by-Step Checklist）

1. **类型注册** — `DEV/packages/engine/src/types.ts`
   - 在 `ClassId` 联合类型与 `SpecId` 相关定义中加入新职业/专精枚举。
2. **职业与技能表定义** — `DEV/packages/engine/src/classes/<NewClass>.ts` + `DEV/packages/engine/src/index.ts`
   - 定义 3 专精核心技能（含 `castTimeMs`、`channelDurationMs`、`cooldownMs`、`gcdCategory`、资源消耗、AoE/单抬/减伤/打断/嘲讽标签）。
   - 在 `engine/src/index.ts` 导出该职业常量。
3. **单一总注册表接入** — `DEV/packages/engine/src/classes/ClassRegistry.ts`
   - 在 `ALL_CLASSES`、`getSpellsForClassSpec`、`getSpellByAnyId`、`CLASS_BASE_STATS` 等映射中注册，确保 AI 与玩家都能通过统一接口检索技能。
4. **房间与账号名称/角色映射**
   - `DEV/packages/engine/src/room/RoomTypes.ts`：补充职业中文名、职业色、专精职责映射 `getRoleBySpec`。
   - `DEV/packages/engine/src/room/RoomManager.ts`：在 `CLASS_LORE_NAMES` 补充该职业专属魔兽风 NPC 名字池，保证换职同步改名。
5. **前端图标、默认动作栏与角色创建入口**
   - `DEV/packages/web/src/assets/pixelIcons.ts`：补齐职业像素头像 `CLASS_PIXEL_AVATARS`、技能 SVG 图标 `SPELL_ICONS` 与 4.3 Tooltip。
   - `DEV/packages/web/src/utils/defaultActionSlots.ts`：为每个专精配置默认 1~36 槽位布局。
   - `DEV/packages/web/src/components/AuthAndCharacterModal.tsx`：确认新职业出现在创建角色列表中。

---

## 3. 单一事实源（SSOT）声明

- 职业基础属性、急速、GCD 分组与标准化技能元数据唯一来源：`DEV/packages/engine/src/classes/ClassRegistry.ts`。
- 职业职责推导唯一来源：`DEV/packages/engine/src/room/RoomTypes.ts` (`getRoleBySpec`)。

---

## 4. 常见反模式与防坑指南

- ❌ **漏配 `CLASS_LORE_NAMES`**：导致在房间中切换 AI 为新职业后，名字仍停留在上一个职业（如切换成术士名字还叫“圣骑士小王”）。
- ❌ **前端写死一套平行冷却或施法时间**：必须从 `ClassRegistry` 读取 `cooldownMs` / `castTimeMs` / `channelDurationMs` / `gcdCategory`。
- ❌ **忘记配置引导标识**：引导技能必须在职业定义中标明 `castTimeMs: -1` 或 `channelDurationMs > 0`，否则打断不会保留 CD。

---

## 5. 最小验收与测试命令

```bash
npx --yes tsx --test DEV/packages/engine/src/__tests__/classes_and_universal_ai.test.ts \
  DEV/packages/engine/src/__tests__/room_lifecycle_and_sync.test.ts
```
