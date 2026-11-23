# 副本介绍：巨龙之魂（Dragon Soul）

> 本文由开发工具 `tools/dungeon_guide_research.py` 合并多站攻略与本地引擎备注生成。
> 生成时间：2026-11-23 18:58

## 1. 概览

- **类型**：10/25 人团本（模拟器按 20 人档标定）· 大灾变终章
- **位置**：时光之穴（塔纳利斯）；可达途径含达拉然紫堡传送等
- **主题**：大灾变终章团本：协助萨尔与龙族守护者使用巨龙之魂对抗死亡之翼。共 8 场首领战，分「龙眠神殿围攻」与「死亡之翼陨落」两翼；除佐诺兹/约萨希可互换顺序外，其余基本线性推进。
- **Boss 顺序**：
  1. 莫卓克 (Morchok)
  2. 督军佐诺兹 (Warlord Zon'ozz) ↔ 不眠的约萨希 (Yor'sahj)（可互换）
  3. 缚风者哈甲拉 (Hagara the Stormbinder)
  4. 奥卓克希昂 (Ultraxion)
  5. 战争领主黑角 (Warmaster Blackhorn)
  6. 死亡之翼的背脊 (Spine of Deathwing)
  7. 死亡之翼的疯狂 (Madness of Deathwing)

## 2. 副本流程环节

1. 入口：龙眠神殿外围战场 → 1 号莫卓克
2. 神殿门口乘龙：南门绿龙 → 戈拉斯之喉（佐诺兹）；西门铜龙 → 舒玛之喉（约萨希）；二者可任选顺序
3. 打完前三后乘东门红龙上神殿顶 → 传送至永恒之眼 → 4 号哈甲拉
4. 返回神殿顶 → 暮光龙潮 → 5 号奥卓克希昂
5. 登舰天火号 → 6 号战争领主黑角
6. 跳伞至死亡之翼背脊 → 7 号背脊
7. 大漩涡 → 8 号死亡之翼的疯狂（尾王）

## 3. 各 Boss 机制详解（合并多站）

### 1. 莫卓克（Morchok）

**定位**：教学向：分摊践踏 + 共鸣水晶近距吸收 + 黑血躲柱间歇

#### 阶段
- 主阶段：践踏分摊、共鸣水晶、击碎护甲换坦（普通）
- 间歇（约 55s）：大地之怒拉人 + 碎石柱，黑血期间躲柱后
- ≤20%：Furious 增伤加速；英雄 90% 分裂出 Kohcrom 双王

#### 技能 / CD / 要点

| 技能 | 英文 | CD/节奏 | 机制与注意 |
| --- | --- | --- | --- |
| 践踏 | Stomp | 主阶段周期性 | 近距分摊巨额物理；双坦叠身（英雄两侧各自叠人）；最近目标吃双份 |
| 共鸣水晶 | Resonating Crystal | 主阶段 | 连线最近 3/7 人，12s 后爆炸，距离越近伤害越低（蓝好红差） |
| 击碎护甲 | Crush Armor | 普通模式为主 | -10% 护甲可叠，约 2–3 层换坦 |
| 大地黑血 | Black Blood of the Earth | 间歇 | 躲在碎石柱后；非躲柱位持续重伤 |

#### 注意事项
- 水晶优先远程/治疗吃，减少 Boss 走位
- 20% 后开嗜血并给坦强减伤

#### 参考来源标签
- Wowhead Morchok、Icy Veins、Warcraft Tavern、本仓库 morchok.ts

### 2. 督军佐诺兹（Warlord Zon'ozz）

**定位**：球传递（黑光）叠易伤；虚空区域与触须管理

#### 阶段
- 主阶段：心理阴影伤害、专注干扰、传递黑光球撞 Boss 叠易伤
- 虚空阶段：触须/虚空地带，处理完回主阶段

#### 技能 / CD / 要点

| 技能 | 英文 | CD/节奏 | 机制与注意 |
| --- | --- | --- | --- |
| 黑光 | Black Blood / Focused Anger related ball | 主循环 | 球需玩家顶传撞 Boss；失败则打团或丢失易伤窗口 |
| 心理阴影等 | Psychic Drain / Shadow | 周期性 | 坦克与团队暗影压力；注意站位与治疗 |

#### 注意事项
- 传球路线预演；英雄难度对打断/站位要求更高
- 模拟器现状为通用模板，需按本机制重做

#### 参考来源标签
- Icy Veins、Warcraft Tavern

### 3. 不眠的约萨希（Yor'sahj the Unsleeping）

**定位**：血滴颜色组合决定机制；点杀血滴控combo

#### 阶段
- 全程：召唤多色血滴，存活者与 Boss 融合触发对应效果
- 颜色组合决定 AOE、治疗、增伤、软狂暴等

#### 技能 / CD / 要点

| 技能 | 英文 | CD/节奏 | 机制与注意 |
| --- | --- | --- | --- |
| 召唤血滴 | Call Blood | 周期性 | 红/绿/黄/蓝/紫/黑等；优先击杀危险组合 |
| 消化/融合效果 | Digestive Acid / combos | 血滴抵达后 | 不同颜色 = 不同团队机制，英雄更严 |

#### 注意事项
- 分配点杀优先级；避免「全员危险combo」
- 模拟器现状为通用模板，需按颜色系统重做

#### 参考来源标签
- Icy Veins、Warcraft Tavern

<details><summary>多站原文摘录（自动截取，供核对）</summary>

1. & Cooldowns Gems, Enchants & Consumables Stat Priority & Reforging Best Professions Addons & Macros PvE Unholy Death Knight Pre-Raid Best in Slot (BiS) Best in Slot (BiS) Talents, Builds & Glyphs Rotation & Cooldowns Gems, Enchants & Consumables Stat Priority & Reforging Best Professions Addons & Macros PvE Frost Death Knight Pre-Raid Best in Slot (BiS) Best in Slot (BiS) Talents, Builds & Glyphs Rotation & Cooldowns Gems, Enchants & Consumables Best Professions Stat Priority & Reforging Addons & Macros Druid Guides Dr

2. te drake riders of Deathwing’s personal escort. Led by the insidious Warmaster Blackhorn, they move with unholy purpose, driven to protect their dark master. Warmaster Blackhorn Boss Guide Warmaster Blackhorn Abilities Warmaster Blackhorn Location Warmaster Blackhorn Boss Loot Warmaster Blackhorn & the Skyfire Spine of Deathwing When Deathwing first channeled the Dragon Soul’s power against the other flights, the massive energies that we

3. & Cooldowns Gems, Enchants & Consumables Stat Priority & Reforging Best Professions Addons & Macros PvE Unholy Death Knight Pre-Raid Best in Slot (BiS) Best in Slot (BiS) Talents, Builds & Glyphs Rotation & Cooldowns Gems, Enchants & Consumables Stat Priority & Reforging Best Professions Addons & Macros PvE Frost Death Knight Pre-Raid Best in Slot (BiS) Best in Slot (BiS) Talents, Builds & Glyphs Rotation & Cooldowns Gems, Enchants & Consumables Best Professions Stat Priority & Reforging Addons & Macros Druid Guides Dr

</details>

### 4. 缚风者哈甲拉（Hagara the Stormbinder）

**定位**：冰/雷阶段转阶段；冰环走位与雷传导

#### 阶段
- 主阶段：冰箭/集中攻击等
- 冰霜阶段：冰墓、冰墙/冰环，打破后回主阶段
- 闪电阶段：传导水晶/水上导电，正确传导打断阶段

#### 技能 / CD / 要点

| 技能 | 英文 | CD/节奏 | 机制与注意 |
| --- | --- | --- | --- |
| 冰霜之墓等 | Ice Tomb / Frost phases | 冰阶段 | 打破冰墓救人；注意冰环边缘伤害 |
| 闪电风暴/传导 | Lightning Storm / Conductive | 雷阶段 | 沿水晶正确传电结束阶段 |

#### 注意事项
- 两阶段机制完全不同，需单独时间轴
- 模拟器现状为通用模板

#### 参考来源标签
- Icy Veins、Warcraft Tavern

<details><summary>多站原文摘录（自动截取，供核对）</summary>

1. 拉点仇恨。 8号BOSS：死亡之翼的狂乱 推荐打法视频：星辰解说 H死亡之翼的狂乱 灭团点： ①跳台子摔死：绿台跳蓝台的时候尽可能的从面对蓝台右边突起处起跳，基本很难空难，实在不行...换电脑吧 ②发呆打法导致大灾变：RL请判断本团战力，如果MT够硬就不要等完技能CD，如果实在不行，找个穿DPS装MT待命应急，牧师翅膀备用。 ③第四个台子单点触须过慢团刷台不上：全体贴着BOSS站，远程打高的触须，读条输出职业看到当前目标触须血量低于40%时请在手上技能未读完时果断切换目标至血量尚高的目标以压榨DPS。 ④P2源质碎片处理不当大量减员：会有三十秒内连续点同一个人的情况，虽然情况比较罕见，但是请有减伤技能的职业不要只顾着输出BOSS，看下自己血量及时开好减伤技能。有能力的团员迅速与治疗职业沟通寻求减伤保护。 关于17173 | 人才招聘 | 广告服务 |

</details>

### 5. 奥卓克希昂（Ultraxion）

**定位**：暮光领域 + 英勇意志进出；畸变加速心跳；暮光时刻分摊

#### 阶段
- 单阶段限时（约 6 分钟暮光爆发硬狂暴）
- 畸变脉冲间隔从 6s 逐步缩短至 1s

#### 技能 / CD / 要点

| 技能 | 英文 | CD/节奏 | 机制与注意 |
| --- | --- | --- | --- |
| 不稳定的畸变 | Unstable Monstrosity | 起始 6s，每分钟 -1s 直至 1s | 暮光领域内近距分摊暗影伤害 |
| 暮光时刻 | Hour of Twilight | 周期性 | 多数人用英勇意志离开领域；需留指定人数分摊，无人则守护者死亡灭团 |
| 凋零之光 | Fading Light | 点名坦+随机 | 计时结束仍在暮光领域则秒杀；需提前英勇意志离开并换坦 |
| 暮光爆发 | Twilight Eruption | 约 6 分钟硬狂暴 | 有短暂读条，超时团灭 |

#### 注意事项
- 分摊组轮换（英雄有 Looming Darkness 限制连续分摊）
- 本仓库已有简化版畸变+审判，缺领域/意志/加速/点名

#### 参考来源标签
- Wowhead Ultraxion、Warcraft Tavern、本仓库 ultraxion.ts

### 6. 战争领主黑角（Warmaster Blackhorn）

**定位**：舰船防守：龙潮与甲板小怪 → 黑角着陆

#### 阶段
- P1：天火号甲板，抵御暮光龙与降兵，保护舰船
- P2：黑角着陆，坦克技能 + 冲击波等

#### 技能 / CD / 要点

| 技能 | 英文 | CD/节奏 | 机制与注意 |
| --- | --- | --- | --- |
| 龙息/燃烧甲板 | Onslaught / deck fires | P1 | 处理火焰与空中单位，舰船血量归零则失败 |
| 冲击波等 | Shockwave / landed phase | P2 | 着陆后近战侧与走位 |

#### 注意事项
- 需舰船/波次系统；模拟器现为通用模板

#### 参考来源标签
- Icy Veins、Warcraft Tavern

<details><summary>多站原文摘录（自动截取，供核对）</summary>

1. gnaros Dragon Soul Raid Morchok Warlord Zon’ozz Yor’sahj the Unsleeping Hagara the Stormbinder Ultraxion Warmaster Blackhorn Spine of Deathwing Madness of Deathwing Reputation Bilgewater Cartel Guardians of Hyjal Therazane Hellscream’s Reach Baradin’s Wardens Wildhammer Clan Earthen Ring Dragonmaw Clan Ramkahen Tools Talent Calculator Death Knight Druid Hunter Mage Paladin Priest Rogue Shaman Warlock Warrior Cataclysm Server Population Cataclysm Arena Leaderboard Cataclysm Database Dungeon Journal Raid Journal Guides Ho

2. Raid Composition Bosses Morchok Warlord Zon’ozz Yor’sahj the Unsleeping Hagara the Stormbinder Ultraxion Warmaster Blackhorn Spine of Deathwing Madness of Deathwing Dragon Soul is the sixth and final raid of the Cataclysm expansion. Arriving with Phase 4 of Cataclysm Classic, this raid takes players to a version of the Dragonblight zone that has been overrun by Deathwing’s forces. There players must assist Thrall and the Dragon Aspects in using Deathwing’s own creation, the Dragon Soul, to end his reign of terror.

3. ord Zon’ozz Yor’sahj the Unsleeping Hagara the Stormbinder Ultraxion Warmaster Blackhorn Spine of Deathwing Madness of Deathwing Location & Entrance The entrance to the Dragon Soul raid is located inside the Caverns of Time in Tanaris. The best way to get there is by taking the portal in the Violet Citadel in Dalaran. You can also take the portal to Uldum in your faction’s capital city and fly across. From the cave entran

4. gnaros Dragon Soul Raid Morchok Warlord Zon’ozz Yor’sahj the Unsleeping Hagara the Stormbinder Ultraxion Warmaster Blackhorn Spine of Deathwing Madness of Deathwing Reputation Bilgewater Cartel Guardians of Hyjal Therazane Hellscream’s Reach Baradin’s Wardens Wildhammer Clan Earthen Ring Dragonmaw Clan Ramkahen Tools Talent Calculator Death Knight Druid Hunter Mage Paladin Priest Rogue Shaman Warlock Warrior Cataclysm Server Population Cataclysm Arena Leaderboard Cataclysm Database Dungeon Journal Raid Journal Guides Ho

5. ord Zon’ozz Yor’sahj the Unsleeping Hagara the Stormbinder Ultraxion Warmaster Blackhorn Spine of Deathwing Madness of Deathwing “ I am the beginning of the end… the shadow which blots out the sun… the bell which tolls your doom… “ – Ultraxion Raid Composition These are our recommendations for your raid composition for this fight. You will need 2 tanks for this encounter regardless of the raid’s size or difficulty. You should also try to bring the

</details>

### 7. 死亡之翼的背脊（Spine of Deathwing）

**定位**：撕甲片 → 腐蚀残渣 → 滚转；独特平台机制

#### 阶段
- 打开甲片暴露腐蚀脓肿/残渣
- 残渣死亡相关滚转；重复直至足够甲片

#### 技能 / CD / 要点

| 技能 | 英文 | CD/节奏 | 机制与注意 |
| --- | --- | --- | --- |
| 灼热血浆/腐蚀 | Searing Plasma / Corruption | 平台机制 | 驱散/点杀腐蚀；注意粘附与滚落 |
| 滚转 | Roll | 残渣条件触发 | 全团需抓稳，否则摔死 |

#### 注意事项
- 非传统站桩战；模拟器需专用场景逻辑

#### 参考来源标签
- Icy Veins、Warcraft Tavern

<details><summary>多站原文摘录（自动截取，供核对）</summary>

1. aid Morchok Warlord Zon’ozz Yor’sahj the Unsleeping Hagara the Stormbinder Ultraxion Warmaster Blackhorn Spine of Deathwing Madness of Deathwing Reputation Bilgewater Cartel Guardians of Hyjal Therazane Hellscream’s Reach Baradin’s Wardens Wildhammer Clan Earthen Ring Dragonmaw Clan Ramkahen Tools Talent Calculator Death Knight Druid Hunter Mage Paladin Priest Rogue Shaman Warlock Warrior Cataclysm Server Population Cataclysm Arena Leaderboard Cataclysm Database Dungeon Journal Raid Journal Guides Holidays & Events Molt

2. ses Morchok Warlord Zon’ozz Yor’sahj the Unsleeping Hagara the Stormbinder Ultraxion Warmaster Blackhorn Spine of Deathwing Madness of Deathwing Dragon Soul is the sixth and final raid of the Cataclysm expansion. Arriving with Phase 4 of Cataclysm Classic, this raid takes players to a version of the Dragonblight zone that has been overrun by Deathwing’s forces. There players must assist Thrall and the Dragon Aspects in using Deathwing’s own creation, the Dragon Soul, to end his reign of terror. This storyline follo

3. the Unsleeping Hagara the Stormbinder Ultraxion Warmaster Blackhorn Spine of Deathwing Madness of Deathwing Location & Entrance The entrance to the Dragon Soul raid is located inside the Caverns of Time in Tanaris. The best way to get there is by taking the portal in the Violet Citadel in Dalaran. You can also take the portal to Uldum in your faction’s capital city and fly across. From the cave entrance, head down through the tu

4. aid Morchok Warlord Zon’ozz Yor’sahj the Unsleeping Hagara the Stormbinder Ultraxion Warmaster Blackhorn Spine of Deathwing Madness of Deathwing Reputation Bilgewater Cartel Guardians of Hyjal Therazane Hellscream’s Reach Baradin’s Wardens Wildhammer Clan Earthen Ring Dragonmaw Clan Ramkahen Tools Talent Calculator Death Knight Druid Hunter Mage Paladin Priest Rogue Shaman Warlock Warrior Cataclysm Server Population Cataclysm Arena Leaderboard Cataclysm Database Dungeon Journal Raid Journal Guides Holidays & Events Molt

5. the Unsleeping Hagara the Stormbinder Ultraxion Warmaster Blackhorn Spine of Deathwing Madness of Deathwing “ I am the beginning of the end… the shadow which blots out the sun… the bell which tolls your doom… “ – Ultraxion Raid Composition These are our recommendations for your raid composition for this fight. You will need 2 tanks for this encounter regardless of the raid’s size or difficulty. You should also try to bring the minimum number of healers yo

</details>

### 8. 死亡之翼的疯狂（Madness of Deathwing）

**定位**：多平台肢体重伤 → 狂乱阶段；大漩涡终局

#### 阶段
- 依次重创四肢平台（ leg/arm ）并处理小怪与机制
- 躯干暴露后最终阶段爆发输出

#### 技能 / CD / 要点

| 技能 | 英文 | CD/节奏 | 机制与注意 |
| --- | --- | --- | --- |
| 催化/元素攻击 | Elementium / cataclysmic abilities | 分平台 | 每肢不同元素主题；失败平台影响最终 |
| 毁灭 | Cataclysm / final | 终局 | 硬狂暴与爆发窗口 |

#### 注意事项
- 尾王为多阶段多平台；模拟器现为通用模板

#### 参考来源标签
- Icy Veins、Warcraft Tavern

<details><summary>多站原文摘录（自动截取，供核对）</summary>

1. Zon’ozz Yor’sahj the Unsleeping Hagara the Stormbinder Ultraxion Warmaster Blackhorn Spine of Deathwing Madness of Deathwing Reputation Bilgewater Cartel Guardians of Hyjal Therazane Hellscream’s Reach Baradin’s Wardens Wildhammer Clan Earthen Ring Dragonmaw Clan Ramkahen Tools Talent Calculator Death Knight Druid Hunter Mage Paladin Priest Rogue Shaman Warlock Warrior Cataclysm Server Population Cataclysm Arena Leaderboard Cataclysm Database Dungeon Journal Raid Journal Guides Holidays & Events Molten Front Event Dark

2. ara the Stormbinder Ultraxion Warmaster Blackhorn Spine of Deathwing Madness of Deathwing Location & Entrance The entrance to the Dragon Soul raid is located inside the Caverns of Time in Tanaris. The best way to get there is by taking the portal in the Violet Citadel in Dalaran. You can also take the portal to Uldum in your faction’s capital city and fly across. From the cave entrance, head down through the tunnels until you reach the l

3. hrall . When you do, Deathwing will make a surprise return and you’ll face him for the final time in the Madness of Deathwing . Raid Composition Tanks : For both 10- and 25-player raid sizes, you’ll need to have two tanks. One should have a DPS offspec since many fights only require one tank. For 25-player Heroic, some groups like to use 4 tanks for the first boss and/or 3 tanks for the 7th boss. In that case you will need a couple of DPS with a tank offspec.

4. Zon’ozz Yor’sahj the Unsleeping Hagara the Stormbinder Ultraxion Warmaster Blackhorn Spine of Deathwing Madness of Deathwing Reputation Bilgewater Cartel Guardians of Hyjal Therazane Hellscream’s Reach Baradin’s Wardens Wildhammer Clan Earthen Ring Dragonmaw Clan Ramkahen Tools Talent Calculator Death Knight Druid Hunter Mage Paladin Priest Rogue Shaman Warlock Warrior Cataclysm Server Population Cataclysm Arena Leaderboard Cataclysm Database Dungeon Journal Raid Journal Guides Holidays & Events Molten Front Event Dark

5. ara the Stormbinder Ultraxion Warmaster Blackhorn Spine of Deathwing Madness of Deathwing “ I am the beginning of the end… the shadow which blots out the sun… the bell which tolls your doom… “ – Ultraxion Raid Composition These are our recommendations for your raid composition for this fight. You will need 2 tanks for this encounter regardless of the raid’s size or difficulty. You should also try to bring the minimum number of healers you can manage, as this fight

</details>

## 4. 团队通用注意

- 双坦配置为主；部分英雄战可能需要更多坦或治疗弹性
- 狂暴紧，远程比例通常高于近战
- 模拟器 20 人档：优先把莫卓克/奥卓克希昂做成「可玩机制」，其余再逐个替换通用模板

## 5. 相关成就

- Fall of Deathwing — 普通通关后解锁英雄（怀旧服规则以版本为准）
- 各首领独立英雄成就与速通/机制成就（详见 Wowhead/Icy Veins）

## 6. 本地模拟器技能 CD 备注（仓库 bosses）

### 暮光喷涌脉冲（generic.ts）
- **暮光喷涌脉冲**：读条 1500ms / CD 10000ms — 巨龙之魂首领暗影能量喷涌，对全团造成 22,000 点暗影伤害
- **巨龙重击**：读条 0ms / CD 12000ms — 对主坦造成 36,000 点物理重击

### 莫卓克（morchok.ts）
- **莫卓克**：读条 2500ms / CD 12000ms — 莫卓克重踏大地，对全团所有目标造成 28,000 点物理震荡伤害
- **大地黑血沸腾**：读条 3000ms / CD 22000ms — 莫卓克召唤大地黑血沸腾喷涌，全团受到 22,000 点暗影伤害
- **击碎护甲**：读条 0ms / CD 12000ms — 击碎主坦护甲，造成 38,000 点物理重击

### 奥卓克希昂（ultraxion.ts）
- **奥卓克希昂**：读条 1000ms / CD 6000ms — 暮光能量极不稳定，每6秒对全团20人爆发出剧烈暗影脉冲，造成 24,000 点暗影伤害
- **暮光审判**：读条 4000ms / CD 28000ms — 毁灭性的暮光审判，全团受到 42,000 点致命暗影伤害！

## 7. 本次抓取来源 URL

- https://www.warcrafttavern.com/cataclysm/guides/dragon-soul-raid-overview/ （24847 字符）
- https://www.warcrafttavern.com/cataclysm/guides/ultraxion-raid-guide/ （28983 字符）
- https://wow.17173.com/videofile/zhuanti/wow120315.shtml （3610 字符）
- https://www.bilibili.com/video/BV1xMFuebEDA/ （20851 字符）
- https://baike.baidu.com/item/%E5%B7%A8%E9%BE%99%E4%B9%8B%E9%AD%82/11013453 （4 字符）
- https://www.bilibili.com/video/BV1BP1qB5EFs/ （28233 字符）

---

说明：不同站点对血线百分比、伤害数字、召唤时机可能略有出入；以实际战斗读条与团队通关经验校准。本工具目标是为模拟器/文案提供详尽「副本介绍」底稿。
