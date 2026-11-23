# 副本介绍：影牙城堡（Shadowfang Keep）

> 本文由开发工具 `tools/dungeon_guide_research.py` 合并多站攻略与本地引擎备注生成。
> 生成时间：2026-11-23 18:48

## 1. 概览

- **类型**：5 人副本（大灾变翻新 / 英雄 85）
- **位置**：银松森林西南；联盟可经希尔斯布莱德飞入或排队进本
- **主题**：大灾变翻新后由狼人据点变为亡灵盘踞的城堡。尾王不再是阿鲁高，而是高弗雷勋爵。通道狭窄、易 ADD、治疗易卡视角，拉怪节奏比机制本身更常灭团。
- **Boss 顺序**：
  1. 亚什布里男爵 (Baron Ashbury)
  2. 席瓦莱恩男爵 (Baron Silverlaine)
  3. 指挥官斯普林瓦尔 (Commander Springvale)
  4. 沃登勋爵 (Lord Walden)
  5. 高弗雷勋爵 (Lord Godfrey)

## 2. 副本流程环节

1. 入口螺旋楼梯 / 监牢区：精英食尸鬼 + 跳跃者，分波拉、宽处打，勿冲过头
2. 1 号 BOSS：亚什布里男爵（原监狱位）
3. 庭院 → 厨房 / 餐厅：无面者（群体恐惧）与鬼魂仆人（锁/控），勿拉多
4. 2 号 BOSS：席瓦莱恩男爵（餐厅 / 岔路下旋梯）
5. 上楼走廊 → 守卫室
6. 3 号 BOSS：指挥官斯普林瓦尔（守卫室，部分攻略称可跳过但常规流程会打）
7. 城墙 / 阁楼：剧毒食尸鬼（死后毒爆）、石像鬼（恐惧需打断）
8. 4 号 BOSS：沃登勋爵（炼金室）
9. 上层通道清骷髅法师与卫兵
10. 5 号尾王：高弗雷勋爵（双枪厅，建议拉至下层开阔处）

## 3. 各 Boss 机制详解（合并多站）

### 1. 亚什布里男爵（Baron Ashbury）

**定位**：打断 + 群疗压力测试；英雄难度核心教学王

#### 阶段
- P1（100%–约 25%/20%）：窒息 → 暂缓处决节奏；穿插苦痛/修补打断与毁坏之痛叠层
- P2（约 ≤25%/20%）：暗影大天使 + 灾祸持续全团 AOE，爆发速杀

#### 技能 / CD / 要点

| 技能 | 英文 | CD/节奏 | 机制与注意 |
| --- | --- | --- | --- |
| 窒息术 | Asphyxiate | 约 32s（引擎标定 cast 4s / CD 32s） | 不可打断；全员血量压至 1（或极低），落地后立刻需要治疗 |
| 暂缓处决 | Stay of Execution | 窒息后立刻引导（引擎 cast 约 6s / CD 约 30s） | 每跳治疗 Boss 与玩家（英雄常见每跳约 10%）。通常让 1–2 跳后打断：太早 T 可能秒死，太晚 Boss 回血过多 |
| 修补烂肉 | Mend Rotten Flesh | 约 26s（引擎 cast 2.5s） | Boss 自疗（英雄约 25%），最高优先级打断 |
| 苦痛与折磨 / 苦痛灾厄 | Pain and Suffering | 脉冲约 12s 量级 | 可打断的暗影引导/鞭笞；低血时极易死人，窒息后尤其危险 |
| 毁坏之痛 | Wracking Pain | 战斗中周期性 | 全团暗影伤害并提高暗影易伤（约 +20%/层，可持续叠），为 P2 埋雷 |
| 灾祸 | Calamity | 进入暗天使阶段后持续 | 全团持续暗影 AOE + 易伤递增；尽量避免刚窒息完立刻进阶段；嗜血/英勇与大招留此阶段 |

#### 注意事项
- 开打前排好打断链：修补烂肉 / 苦痛 专人负责，暂缓处决约定跳数
- 个人减伤、瞬疗、药水在窒息落地与 P2 前备好
- 成就「缓刑驳回 / Pardon Denied」：全程不让暂缓处决跳治疗
- 中文站与英文站对变身阈值写法不一（约 25% / 20%），以实际读条与血线为准，控制进阶段时机

#### 参考来源标签
- Icy Veins、GotWarcraft、17173、WilfridWong、本仓库 ashbury.ts

<details><summary>多站原文摘录（自动截取，供核对）</summary>

1. then take a look at our gold guide or a far more extensive gold (and more) guide: WoW Crusher . Baron Ashbury: This fight places a lot of demands on the healer. The Baron casts a number of interruptable spells. Consider assigning players to look out for and interrupt particular spells, such as his Mend Rotten Flesh. For example: Player A interrupts Mend , player B gets Pain and Suffering , etc. Any self-heals that the players have will make the healer’s job that much easier. Casts Pain and Suffering . Interru

2. Try to be healed as much as possible before he pops this. And that’s it. Easy, right? 😉 How to Baron Ashbury Baron Silverlaine: This one’s a bit easier than the last fight. Two choices: Zerg boss, or DPS down adds then DPS boss. Your mileage may vary. Commander Springvale: This is an optional boss. He places a lot of demands on your interrupts and CC abilities. At some point in the video they mention their iLevel 333 gear. Yours is probably higher, so you might find the fight easier. Sp

3. t makes things worse. Casts Mend Rotten Flesh . You must interrupt this. It heals him for 30%. Casts Asphyxiate . Brings everyone to 1 hp. Immediately casts Stay of Execution after. Every tick of Stay of Execution heals you and the boss for 10% health. If the healer can immediately bring the tank back up then you don’t have to wait on interrupting this spell. Otherwise let it tick 1-2 times (to heal party somewhat) before interrupting, as the healer will run out of mana pretty quickly otherwise. Wait too long and th

4. ch higher. And … avoid storm clouds at all time. * * * * * [7] SHADOWFANG KEEP Boss #1 – Baron Ashbury Interrupt or dispel pain and suffering debuff if possible. In phase 1, after Asphyxiate that brings all party members’ health to 1, the boss casts Stay of Execution that heals players as well as himself. This spell should be interrupted after 1 to 2 ticks because leaving it too long will heal the boss too much. In phase 2, the boss enrages with calamity unleashing his true power in dark angel form AoE all

5. Boss #1 – Baron Ashbury Interrupt or dispel pain and suffering debuff if possible. In phase 1, after Asphyxiate that brings all party members’ health to 1, the boss casts Stay of Execution that heals players as well as himself. This spell should be interrupted after 1 to 2 ticks because leaving it too long will heal the boss too much. In phase 2, the boss enrages with calamity unleashing his true power in dark angel form AoE all members. All cool-downs should be saved for this moment and the boss has to be burned fa

6. uff if possible. In phase 1, after Asphyxiate that brings all party members’ health to 1, the boss casts Stay of Execution that heals players as well as himself. This spell should be interrupted after 1 to 2 ticks because leaving it too long will heal the boss too much. In phase 2, the boss enrages with calamity unleashing his true power in dark angel form AoE all members. All cool-downs should be saved for this moment and the boss has to be burned fast before healer runs out of mana. * * * * * Boss #2 – Baron Si

7. 后，偷袭希尔瓦娜斯未遂，躲入影牙要塞称王称霸。 同级副本难度：4（1-5数量越高越难） 相关成就 影牙城堡 英雄:影牙城堡 英雄:影牙城堡公会团 缓刑驳回 躺地板吧你! 子弹时间 艾胥柏利男爵 BOSS生命值 普通模式：11,600/英雄模式：2,489,000 曾经充满狼人和白狼的纵横交错的阶梯中，现在布满的是精英食尸鬼和普通跳跃者，这里空间狭小而且怪物的攻击力也不弱，所以建议尽量一批怪一批怪的杀，避免 T扛不住或者引到多余的怪。解决4-5波怪以后，在原来的监狱的位置，就可以看到新影牙的第一个BOSS-艾胥柏利男爵。 打法、心得 头目艾胥柏利男爵可以选择要在上面打还是下面打，如果在上面，直接把头目拉上楼梯即可，要在下面则所有人在楼梯头往左侧跳下去。头目算是个超强的暗影牧师，主要在玩的是断法。 第一阶段 当开战不久之后，他会随机使用窒息术，这是个引导法术，会让团队血量直接降低到1%，使用完之后他会马上的使用“暂缓 处决”来帮自己和大家补血，这是个范围超大的引导型神圣新星，每次可以治疗10%的血量，可以被中断，但是中断后会马上攻击，建议是让他跳个一次到2次先 让坦克补血，虽然头

8. ，现在布满的是精英食尸鬼和普通跳跃者，这里空间狭小而且怪物的攻击力也不弱，所以建议尽量一批怪一批怪的杀，避免 T扛不住或者引到多余的怪。解决4-5波怪以后，在原来的监狱的位置，就可以看到新影牙的第一个BOSS-艾胥柏利男爵。 打法、心得 头目艾胥柏利男爵可以选择要在上面打还是下面打，如果在上面，直接把头目拉上楼梯即可，要在下面则所有人在楼梯头往左侧跳下去。头目算是个超强的暗影牧师，主要在玩的是断法。 第一阶段 当开战不久之后，他会随机使用窒息术，这是个引导法术，会让团队血量直接降低到1%，使用完之后他会马上的使用“暂缓 处决”来帮自己和大家补血，这是个范围超大的引导型神圣新星，每次可以治疗10%的血量，可以被中断，但是中断后会马上攻击，建议是让他跳个一次到2次先 让坦克补血，虽然头目也会被补血，但是如果没有这样治疗，坦克只要没有招架闪躲的话就会被秒杀。只要断法处理好，这场战斗已经算赢一半了。 第二阶段 场上会有毁坏之痛的效果，主要除了会有造成伤害以外，还会让玩家受到的暗影伤害增加，这如果堆叠太高，在第二阶段会有 危险。“修补烂肉”是头目对自己的治疗招式，这也需要专人负责断法，一次会补头目25%的血量。“苦痛受难

</details>

### 2. 席瓦莱恩男爵（Baron Silverlaine）

**定位**：驱散诅咒 + 处理狼人增援；相对简单

#### 阶段
- 全程：周期性降疗诅咒 + 召唤狼人之灵（不同旧影牙名人魂）
- 低血阶段：部分攻略称约 25% 强力召唤，优先处理增援或选择直压 Boss

#### 技能 / CD / 要点

| 技能 | 英文 | CD/节奏 | 机制与注意 |
| --- | --- | --- | --- |
| 阴影面纱 / 降受疗诅咒 | Veil of Shadow / Cursed Veil | 约 14–18s | 受治疗降低约 75%（约 15s），优先驱散主坦与被重点治疗目标 |
| 召唤狼人之灵 | Summon Worgen Spirit | 约 25s | 可能召唤盲眼奥杜、屠夫刃爪、雷希戈尔、狼王南杜斯等；T 立刻拉怪，DPS 可先清增援再回 Boss，或直压 |

#### 注意事项
- 狼人召唤后有短暂延迟，T 预留嘲讽/仇恨技能
- 第三次召唤后若输出足够可放弃小怪直杀 Boss（中文攻略常见建议）
- 庭院无面者群体恐惧无法打断，尽量拉回台阶/室内打

#### 参考来源标签
- Icy Veins、17173、本仓库 silverlaine.ts

<details><summary>多站原文摘录（自动截取，供核对）</summary>

1. ch as possible before he pops this. And that’s it. Easy, right? 😉 How to Baron Ashbury Baron Silverlaine: This one’s a bit easier than the last fight. Two choices: Zerg boss, or DPS down adds then DPS boss. Your mileage may vary. Commander Springvale: This is an optional boss. He places a lot of demands on your interrupts and CC abilities. At some point in the video they mention their iLevel 333 gear. Yours is probably higher, so you might find the fight easier. Springvale will summon a

2. ment and the boss has to be burned fast before healer runs out of mana. * * * * * Boss #2 – Baron Silverlaine This boss casts curse veil debuff that reduces healing by 75% for 15 seconds. Dispel it if need to (if the target is not going to be healed immediately, don’t bother). At 25% of health, Baron Silverlaine summons one of the ancient Worgen spirits to his aid. Take down the add first before going back to the boss. A simple tank-and-spank routine. * * * * * Boss #3 – Commander Springvale This enc

3. if need to (if the target is not going to be healed immediately, don’t bother). At 25% of health, Baron Silverlaine summons one of the ancient Worgen spirits to his aid. Take down the add first before going back to the boss. A simple tank-and-spank routine. * * * * * Boss #3 – Commander Springvale This encounter will require a high level of coordination. This boss should be tanked at the furthest side of the wall. When he casts shield of the perfidious, all must stay out of the torrent of damage. Hence, the t

4. to be healed immediately, don’t bother). At 25% of health, Baron Silverlaine summons one of the ancient Worgen spirits to his aid. Take down the add first before going back to the boss. A simple tank-and-spank routine. * * * * * Boss #3 – Commander Springvale This encounter will require a high level of coordination. This boss should be tanked at the furthest side of the wall. When he casts shield of the perfidious, all must stay out of the torrent of damage. Hence, the tank must make sure that (1) the boss sh

5. 补充点 开始的小怪和后面刷新的小怪均可以被锁，如果DPS欠佳，可以选择让QS恐惧或者MS锁一个，但是DPS要注意不要破控制。如果BOSS血量较低，同时刷小怪的话，可以选择直接RUSH BOSS。 席瓦莱恩男爵 BOSS生命值 普通模式：3,560/7,120英雄模式：829,000/2,074,000 干掉艾胥柏利男爵以后，我们沿着熟悉的路线来到庭院里，现在的庭院里充斥着各种无面者和鬼魂以及跳跳。注意，无面者最好拉回台阶上来单独杀，因为它会施放无法打断的3秒群体恐惧。 清完庭院的怪，该进入厨房了，这里的鬼魂仆人多为4个一组 需要锁、纠缠开怪。鬼魂仆人技能为生命吸取，伤害一般，但CD很短，容易造成仇恨混乱以及阵型不佳，需要坦克走位和打断交替进行，拥有暗影形态的鬼魂仆人会在地上召唤出黑暗漩涡，需要近战远离以避免伤害。清完小怪以后，大家熟悉的老朋友席瓦莱恩男爵就在面前等着我们了。 打法、心得 到了有岔路的地方，左手边下楼2个回旋楼 梯是头目席瓦莱恩男爵，主攻技能几乎没有，只会降低被治疗量的诅咒，和每25%的召唤一只狼人之灵来协助战斗。应对上要针对狼人之灵，不过狼人之灵也只能 算小菜一叠。这边除了解咒要

6. 开怪。鬼魂仆人技能为生命吸取，伤害一般，但CD很短，容易造成仇恨混乱以及阵型不佳，需要坦克走位和打断交替进行，拥有暗影形态的鬼魂仆人会在地上召唤出黑暗漩涡，需要近战远离以避免伤害。清完小怪以后，大家熟悉的老朋友席瓦莱恩男爵就在面前等着我们了。 打法、心得 到了有岔路的地方，左手边下楼2个回旋楼 梯是头目席瓦莱恩男爵，主攻技能几乎没有，只会降低被治疗量的诅咒，和每25%的召唤一只狼人之灵来协助战斗。应对上要针对狼人之灵，不过狼人之灵也只能 算小菜一叠。这边除了解咒要解好以外，王在呼叫狼人之灵后，狼人不会马上出来，大概要过几秒，到时候坦克一定要准备好自己的仇恨技能赶快抓，团队也都要把 火力放在狼人身上，直到第三次叫狼人之后，团队可以选择直接把席瓦莱恩男爵打死，而不打狼人。 瓦尔登领主 BOSS生命值 普通模式：11,600/英雄模式：2,489,000 走出守卫室就可以登上城墙，城墙上仍然有游荡的鬼魂卫兵，清理掉以后就来到盲眼守卫奥杜曾经镇守的阁楼，不过这里现在遍布剧毒食尸鬼和骷髅法师，其中食尸鬼死后会毒爆，近战注意远离。 走出阁楼，看见城墙上的雕像没有？小心，它们会活化成石像鬼！这些石像鬼会远程攻击会恐惧

7. 替进行，拥有暗影形态的鬼魂仆人会在地上召唤出黑暗漩涡，需要近战远离以避免伤害。清完小怪以后，大家熟悉的老朋友席瓦莱恩男爵就在面前等着我们了。 打法、心得 到了有岔路的地方，左手边下楼2个回旋楼 梯是头目席瓦莱恩男爵，主攻技能几乎没有，只会降低被治疗量的诅咒，和每25%的召唤一只狼人之灵来协助战斗。应对上要针对狼人之灵，不过狼人之灵也只能 算小菜一叠。这边除了解咒要解好以外，王在呼叫狼人之灵后，狼人不会马上出来，大概要过几秒，到时候坦克一定要准备好自己的仇恨技能赶快抓，团队也都要把 火力放在狼人身上，直到第三次叫狼人之后，团队可以选择直接把席瓦莱恩男爵打死，而不打狼人。 瓦尔登领主 BOSS生命值 普通模式：11,600/英雄模式：2,489,000 走出守卫室就可以登上城墙，城墙上仍然有游荡的鬼魂卫兵，清理掉以后就来到盲眼守卫奥杜曾经镇守的阁楼，不过这里现在遍布剧毒食尸鬼和骷髅法师，其中食尸鬼死后会毒爆，近战注意远离。 走出阁楼，看见城墙上的雕像没有？小心，它们会活化成石像鬼！这些石像鬼会远程攻击会恐惧，注意打断就很好解决了。一路清理掉回旋廊道里的骷髅守卫和狂暴食尸鬼，炼金室就在眼前，现在里面蹲着的是瓦

8. 艾胥柏利男爵 席瓦莱恩男爵 指挥官斯普林瓦尔 瓦尔登领主 高佛雷领主 副本简介 和之前的死亡矿井一样，CTM里影牙城堡也进行了翻新，变成了一个全新的5人副本。 不过盘踞于其中的最终BOSS不再是大法师阿鲁高，而是高佛雷领主。 副本位置没变，仍然位于银松森林。 影牙城堡拥有5个BOSS 副本地图 副本视频 1 2 3 4 5 下一页 末页 [ 复制本页网址 ] [ 加入收藏夹 ] [ 进入游戏论坛 ] [ 我要投稿 ] 我要评论 相关推荐

</details>

### 3. 指挥官斯普林瓦尔（Commander Springvale）

**定位**：空间管理 + 增援打断/CC；英雄难度协调要求最高之一

#### 阶段
- 开场即带哀嚎卫兵 + 痛苦军官；战斗中反复从两侧楼梯口增援
- 不洁能量叠满（约 3 层）触发正面锥形或羞愧之语
- 低血（部分资料约 30%）后羞愧之语 debuff 使战斗偏限时

#### 技能 / CD / 要点

| 技能 | 英文 | CD/节奏 | 机制与注意 |
| --- | --- | --- | --- |
| 背信之盾 | Shield of the Perfidious | 约 18s（或不洁能量满时） | 正面锥形高伤引导；T 背对团队，所有人禁止站 Boss 正面 |
| 亵渎 | Desecration | 约 20s | 点名脚下毒圈，近战立刻离开；T 尽量把圈甩到墙外/楼梯外 |
| 邪恶打击 / 不洁赋能相关 | Malefic Strike / Unholy Empowerment | 近战打击叠能量；小怪读条赋能 | 小怪 Unholy Empowerment 必须打断（治疗 Boss / 强化）；成就「躺地板吧你! / To the Ground!」要求不让其获得赋能 |
| 羞愧之语 | Word of Shame | 能量满时二选一 | 目标每 3 秒损失约 5% 生命直至战斗结束，推高治疗压力 |
| 哀嚎卫兵 / 痛苦军官 | Wailing Guardsman / Tormented Officer | 开场 + 周期性增援 | 卫兵有 AOE 沉默（过去的尖啸），远程拉开；军官可锁/恐；优先打断赋能并尽快减员 |

#### 注意事项
- T 站远端墙边，团队靠原站位一侧，减少锥形与亵渎覆盖
- 分配副 T/近战或锁怪处理增援；远程与 Boss 保持距离躲沉默
- 输出不足时可跳过清小怪直压；输出足够则控怪清场更稳

#### 参考来源标签
- Icy Veins、GotWarcraft、WilfridWong、17173、本仓库 springvale.ts

<details><summary>多站原文摘录（自动截取，供核对）</summary>

1. . Two choices: Zerg boss, or DPS down adds then DPS boss. Your mileage may vary. Commander Springvale: This is an optional boss. He places a lot of demands on your interrupts and CC abilities. At some point in the video they mention their iLevel 333 gear. Yours is probably higher, so you might find the fight easier. Springvale will summon a Tormented Officer and a Wailing Guardsman. Frequently during the fight, Springvale will call for aid, summoning another pair of the same adds. Interrupt everyth

2. eo they mention their iLevel 333 gear. Yours is probably higher, so you might find the fight easier. Springvale will summon a Tormented Officer and a Wailing Guardsman. Frequently during the fight, Springvale will call for aid, summoning another pair of the same adds. Interrupt everything the adds do. The most important thing is to stop then from casting, otherwise this becomes a very long fight. Kill the adds as time permits (such as with the AoEs you’re tossing on the boss.) Consider locking down the adds as t

3. er. Springvale will summon a Tormented Officer and a Wailing Guardsman. Frequently during the fight, Springvale will call for aid, summoning another pair of the same adds. Interrupt everything the adds do. The most important thing is to stop then from casting, otherwise this becomes a very long fight. Kill the adds as time permits (such as with the AoEs you’re tossing on the boss.) Consider locking down the adds as they appear. Interrupt adds’ Unholy Empowerment if possible. It heals him for 4%. Ranged should

4. rst before going back to the boss. A simple tank-and-spank routine. * * * * * Boss #3 – Commander Springvale This encounter will require a high level of coordination. This boss should be tanked at the furthest side of the wall. When he casts shield of the perfidious, all must stay out of the torrent of damage. Hence, the tank must make sure that (1) the boss should not be facing the group and (2) he or she must stay outside of the torrent. When the boss does desecration, all melee players must move away. Caste

5. melee players must move away. Casters and ranged DPS should stay as far away from the boss as possible. Springvale summons Guardsman that does AoE silence and mortal strike. He also summons Officer. Crowd control the Officer and burn down Guardsman. Assign someone else to tank the adds and these adds should be dispatched before going back to the boss. Last but not the least, unholy empowerment casts by Guardsman and Office must be interrupted. This spell buffs up the boss a great deal and will make the fight unbearable

6. ss should not be facing the group and (2) he or she must stay outside of the torrent. When the boss does desecration, all melee players must move away. Casters and ranged DPS should stay as far away from the boss as possible. Springvale summons Guardsman that does AoE silence and mortal strike. He also summons Officer. Crowd control the Officer and burn down Guardsman. Assign someone else to tank the adds and these adds should be dispatched before going back to the boss. Last but not the least, unholy empowerment casts

7. 英勇就要在这个阶段之前开启，然后站位让治疗者比较好发挥，且所有的DPS要把大招全开，尽量缩短此阶段 的战斗时间。 补充点 开始BOSS之前，最好分配好打断链，因为这场战斗需要打断的技能很多。 指挥官斯普林瓦尔 BOSS生命值 普通模式：11,600/英雄模式：不详 解决掉男爵以后上楼，走廊里仍然会遇到骷髅卫兵和鬼魂卫兵，稍微注意即可。前方就是守卫室，指挥官斯普林瓦尔仍然带着俩小弟镇守在里面。 打法、心得 这只头目比起前面来说稍微难一点 点，会用邪恶打击来集不洁能量，当能量满的时候就会用盾牌施放背信之盾，这看起来有点像是龙类的暗息术，只不过是引导型的伤害，另外一招则是在地板上放亵 渎。亵渎在这狭小空间里面会造成满大伤害，再加上不时又会有地址来搅局，场面会变的有点乱。坦克就尽量把王坦在小兵会上来的2个楼梯口，团队则尽量往王一 开始的地方移动，这样无论是亵渎，小兵的断法尖啸，或是背信之盾都比较不会影响到团队。 第一阶段 坦克除了要尽量避免头目面对团队，以及帮头目找好放亵渎的地方以外，如果仇恨技能不够用，没办法抓住所有小兵，则建议是先抓会尖啸断法的哀嚎的卫兵，痛苦的士官就先让其他人缓速之类的控场，王

8. 斗需要打断的技能很多。 指挥官斯普林瓦尔 BOSS生命值 普通模式：11,600/英雄模式：不详 解决掉男爵以后上楼，走廊里仍然会遇到骷髅卫兵和鬼魂卫兵，稍微注意即可。前方就是守卫室，指挥官斯普林瓦尔仍然带着俩小弟镇守在里面。 打法、心得 这只头目比起前面来说稍微难一点 点，会用邪恶打击来集不洁能量，当能量满的时候就会用盾牌施放背信之盾，这看起来有点像是龙类的暗息术，只不过是引导型的伤害，另外一招则是在地板上放亵 渎。亵渎在这狭小空间里面会造成满大伤害，再加上不时又会有地址来搅局，场面会变的有点乱。坦克就尽量把王坦在小兵会上来的2个楼梯口，团队则尽量往王一 开始的地方移动，这样无论是亵渎，小兵的断法尖啸，或是背信之盾都比较不会影响到团队。 第一阶段 坦克除了要尽量避免头目面对团队，以及帮头目找好放亵渎的地方以外，如果仇恨技能不够用，没办法抓住所有小兵，则建议是先抓会尖啸断法的哀嚎的卫兵，痛苦的士官就先让其他人缓速之类的控场，王则是右上，左上这样坦，让亵渎至少有大半的部份是被丢在墙壁外。 第二阶段 当头目血量被打到30%左右时会进入第二阶段，所有人会被染上羞愧之语的的debuff，每3秒扣血5

</details>

### 4. 沃登勋爵（Lord Walden）

**定位**：走位王：绿走红停 + 躲开冰霜落点

#### 阶段
- 全程：毒瓶/霜瓶投掷 + 冰碎片落点
- 神秘毒素：绿混合物必须持续移动；红混合物必须静止（红灯停绿灯走）
- 约 30% 后红药相关压力上升（中文攻略强调）

#### 技能 / CD / 要点

| 技能 | 英文 | CD/节奏 | 机制与注意 |
| --- | --- | --- | --- |
| 配制剧毒/冰霜混合物 | Conjure Poisonous / Frost Mixture | 高频投掷（引擎三色魔药约 14s） | 飞弹落地有指示，躲开；队伍散开避免多人同中 |
| 寒冰碎片 | Ice Shards | 约 16s | 地面蓝圈落点，离开落点 |
| 神秘毒素（绿/红） | Conjure Mystery Toxin (Green/Red) | 战斗中穿插 | 绿：保持移动/跳跃消层；红：站住输出（移动会吃 Toxic Catalyst）。可驱散的毒优先驱 |

#### 注意事项
- T 承伤通常不高，成败在 DPS 走位意识
- 散开站位，预读读条颜色/特效再决定动或停

#### 参考来源标签
- Icy Veins、GotWarcraft、17173、本仓库 walden.ts

<details><summary>多站原文摘录（自动截取，供核对）</summary>

1. tiest spells completely. It is now a DPS race. Kill boss. How to Commander Springvale Lord Walden: Casts Conjure Mystery Toxin. Red for stop. If you get the red debuff, stop moving. (just like when you’re driving.) Green for go: If you get the green debuff, keep moving . (Jumping is a form of moving.) He also casts frost shards which are indicated by him shooting small little frost shards to small blue circles on the floor. Stay out of the circles. How to Lord Walden Lord Godfrey: P

2. g small little frost shards to small blue circles on the floor. Stay out of the circles. How to Lord Walden Lord Godfrey: Pull Godrey down to the main floor, you’ll have more room. DPS adds. They have pretty low health. Try and interrupt Cursed Bullet as best as you can, it’s hits very hard. Stay away from the front of the boss when he casts Pistol Barrage (it’s a cone), even the tank. How to Lord Godfrey: Our class guides for whichever class you’re playing: Death Knights – Druid – Hunte

3. ow a DPS race. Kill boss. How to Commander Springvale Lord Walden: Casts Conjure Mystery Toxin. Red for stop. If you get the red debuff, stop moving. (just like when you’re driving.) Green for go: If you get the green debuff, keep moving . (Jumping is a form of moving.) He also casts frost shards which are indicated by him shooting small little frost shards to small blue circles on the floor. Stay out of the circles. How to Lord Walden Lord Godfrey: Pull Godrey down to the main floor,

4. spell buffs up the boss a great deal and will make the fight unbearable. * * * * * Boss #4 – Lord Walden Through toxin mixture, this boss either glows in red or green. When he is green, the group must keep moving (or jumping). Or the stacks of debuff will kill you. When he is red, you are buffed and hence, should stop and focus on DPS. In addition, there is a toxic debuff that can be cleansed. As for the frost mixture, you should see the floor marked before the mixture lands. Hence, move away when you see it c

5. a great deal and will make the fight unbearable. * * * * * Boss #4 – Lord Walden Through toxin mixture, this boss either glows in red or green. When he is green, the group must keep moving (or jumping). Or the stacks of debuff will kill you. When he is red, you are buffed and hence, should stop and focus on DPS. In addition, there is a toxic debuff that can be cleansed. As for the frost mixture, you should see the floor marked before the mixture lands. Hence, move away when you see it coming your way. The grou

6. hould stop and focus on DPS. In addition, there is a toxic debuff that can be cleansed. As for the frost mixture, you should see the floor marked before the mixture lands. Hence, move away when you see it coming your way. The group should spread out for this fight. * * * * * Boss #5 – Lord Godfrey Tank him on the lower floor with a group making a circle on him. He randomly targets one person and casts pistol barrage after he summons the ghouls. The person targeted should move away from the barrage. If it helps

7. 以外，王在呼叫狼人之灵后，狼人不会马上出来，大概要过几秒，到时候坦克一定要准备好自己的仇恨技能赶快抓，团队也都要把 火力放在狼人身上，直到第三次叫狼人之后，团队可以选择直接把席瓦莱恩男爵打死，而不打狼人。 瓦尔登领主 BOSS生命值 普通模式：11,600/英雄模式：2,489,000 走出守卫室就可以登上城墙，城墙上仍然有游荡的鬼魂卫兵，清理掉以后就来到盲眼守卫奥杜曾经镇守的阁楼，不过这里现在遍布剧毒食尸鬼和骷髅法师，其中食尸鬼死后会毒爆，近战注意远离。 走出阁楼，看见城墙上的雕像没有？小心，它们会活化成石像鬼！这些石像鬼会远程攻击会恐惧，注意打断就很好解决了。一路清理掉回旋廊道里的骷髅守卫和狂暴食尸鬼，炼金室就在眼前，现在里面蹲着的是瓦尔登领主。 打法、心得 到了瓦尔登领主的链金间之后，我们赫然发现居然终于有一次部落的军队比玩家还早到达，友方全国人大高阶领主克罗穆斯已经超越玩家到达链金房的楼上，可是很可惜就算开战之后，克罗穆斯也不会有任何协助。 这场战斗也算简单，主要要闪2种药水的攻击，第一种是绿色药剂，这种会堆叠的药剂，当瓦尔登领主使用这种时只要移动就 可以消除堆叠，不要堆叠到5个以上就不会有

8. 毒爆，近战注意远离。 走出阁楼，看见城墙上的雕像没有？小心，它们会活化成石像鬼！这些石像鬼会远程攻击会恐惧，注意打断就很好解决了。一路清理掉回旋廊道里的骷髅守卫和狂暴食尸鬼，炼金室就在眼前，现在里面蹲着的是瓦尔登领主。 打法、心得 到了瓦尔登领主的链金间之后，我们赫然发现居然终于有一次部落的军队比玩家还早到达，友方全国人大高阶领主克罗穆斯已经超越玩家到达链金房的楼上，可是很可惜就算开战之后，克罗穆斯也不会有任何协助。 这场战斗也算简单，主要要闪2种药水的攻击，第一种是绿色药剂，这种会堆叠的药剂，当瓦尔登领主使用这种时只要移动就 可以消除堆叠，不要堆叠到5个以上就不会有大碍。另外种是蓝色的药剂，会有明显的冰锥飞向玩家，也是靠移动闪躲即可，当血量降低到30%的时候会搓红色的 药水，让玩家血量每2秒受到10000点的伤害，并且爆击率提高100%，打完之后即可继续上楼。 补充点 这场BOSS战是极为典型的BOSS放什么躲什么的战斗，随时注意躲开奇怪的东西就好了。坦克本身受到的伤害很低，主要在于DPS的灵活程度了。 高佛雷领主 BOSS生命值 普通模式：13,920/英雄模式：2,593,000 从炼

</details>

### 5. 高弗雷勋爵（Lord Godfrey）

**定位**：尾王：弹幕走位 + 诅咒打断驱散 + 食尸鬼清理

#### 阶段
- 建议开战将 Boss 拉至下层；周期性召唤嗜血食尸鬼 → 手枪弹幕
- 穿插诅咒之弹与重伤叠层

#### 技能 / CD / 要点

| 技能 | 英文 | CD/节奏 | 机制与注意 |
| --- | --- | --- | --- |
| 召唤嗜血食尸鬼 | Summon Bloodthirsty Ghouls | 弹幕前常见组合 | 小怪血薄；可用弹幕扫掉；成就「子弹时间 / Bullet Time」要求弹幕击杀足够数量后再击杀 Boss |
| 双枪弹幕 | Pistol Barrage | 约 32s（引擎 cast 约 3s） | 正面锥形超高伤持续扫射；T 与全体离开正面；可用俯视角看弹幕方向 |
| 诅咒之弹 | Cursed Bullets | 约 16s（引擎 cast 约 2s） | 高额暗影伤害 + DOT，可打断、可驱散，优先处理 |
| 重伤 / 致死伤口 | Mortal Wound | 约 15s | 降低受治疗，叠层时治疗注意主坦 |

#### 注意事项
- 团队站 Boss 一侧（如 6 点），T 弹幕时绕侧面换位
- 打断 + 驱散诅咒是治疗减负关键
- 中英文攻略一致认为：躲好弹幕后该战相对简单

#### 参考来源标签
- Icy Veins、GotWarcraft、17173、本仓库 godfrey.ts

<details><summary>多站原文摘录（自动截取，供核对）</summary>

1. shards to small blue circles on the floor. Stay out of the circles. How to Lord Walden Lord Godfrey: Pull Godrey down to the main floor, you’ll have more room. DPS adds. They have pretty low health. Try and interrupt Cursed Bullet as best as you can, it’s hits very hard. Stay away from the front of the boss when he casts Pistol Barrage (it’s a cone), even the tank. How to Lord Godfrey: Our class guides for whichever class you’re playing: Death Knights – Druid – Hunter – Mage – Paladin

2. away from the front of the boss when he casts Pistol Barrage (it’s a cone), even the tank. How to Lord Godfrey: Our class guides for whichever class you’re playing: Death Knights – Druid – Hunter – Mage – Paladin Priest – Rogue – Shaman – Warlock – Warrior The GotWarcraft Gold Guide – Cataclysm Heroic Guides Like this page? How about recommending it? Leave a Reply Cancel reply Your email address will not be published. Required fields are marked * Name * Email * Website Comm

3. sed Bullet as best as you can, it’s hits very hard. Stay away from the front of the boss when he casts Pistol Barrage (it’s a cone), even the tank. How to Lord Godfrey: Our class guides for whichever class you’re playing: Death Knights – Druid – Hunter – Mage – Paladin Priest – Rogue – Shaman – Warlock – Warrior The GotWarcraft Gold Guide – Cataclysm Heroic Guides Like this page? How about recommending it? Leave a Reply Cancel reply Your email address will not be published. Required

4. you see it coming your way. The group should spread out for this fight. * * * * * Boss #5 – Lord Godfrey Tank him on the lower floor with a group making a circle on him. He randomly targets one person and casts pistol barrage after he summons the ghouls. The person targeted should move away from the barrage. If it helps, pan the camera to top down view to see where the direction of the fire is. Adds should be AoE fast. * * * * * [8] GRIM BATOL Boss #1 – General Umbriss This boss periodically summ

5. ank him on the lower floor with a group making a circle on him. He randomly targets one person and casts pistol barrage after he summons the ghouls. The person targeted should move away from the barrage. If it helps, pan the camera to top down view to see where the direction of the fire is. Adds should be AoE fast. * * * * * [8] GRIM BATOL Boss #1 – General Umbriss This boss periodically summons 1 Malignant Trogg and 3 Trogg Dwellers. Crowd control the malignant one throughout the boss fight if possible. It

6. 低，主要在于DPS的灵活程度了。 高佛雷领主 BOSS生命值 普通模式：13,920/英雄模式：2,593,000 从炼金室绕道而上，狼王早已不在，过关斩将除掉挡路的骷髅法师和卫兵之后，领主高弗雷的阴谋就在眼前，注意高弗雷可是超帅手持双枪的，猎人梦寐以求的凶残能力！ 打法、心得 这场战斗和前面比起来倒是意外的简单，主要技能有四招： 第一招是召唤食尸鬼，召唤出来之后坦克抓好曝光掉即可，血量都很少。 第二招是手枪弹幕，这招会对正前方的方向施展，每秒造成42000的伤害，持续6秒，坦克被放了之后就赶快绕到王背后即可。 第三招则是对团队放暗影尖刺，也是扩散引导型的暗影法术。 最后一招则是致死伤口，简单讲就是附带有流血效果和降低治疗效果的50%点。 攻略方式 打法就团队站六点钟方向，坦克把王坦在看要在中间还是靠墙都可以，当王放技能的时候，坦克就从三点绕到六点，再放一次技能就六点跑回三点，这样无论怎么放技能，都不会对团队造成威胁。当打完之后任务全国人大会跑到房间门口让玩家回报。 补充点 注意打断，注意驱散，坦克注意躲好AOE。 总结：以上是魔兽世界大灾变怀旧服影牙城堡副本打法攻略介绍

7. 度了。 高佛雷领主 BOSS生命值 普通模式：13,920/英雄模式：2,593,000 从炼金室绕道而上，狼王早已不在，过关斩将除掉挡路的骷髅法师和卫兵之后，领主高弗雷的阴谋就在眼前，注意高弗雷可是超帅手持双枪的，猎人梦寐以求的凶残能力！ 打法、心得 这场战斗和前面比起来倒是意外的简单，主要技能有四招： 第一招是召唤食尸鬼，召唤出来之后坦克抓好曝光掉即可，血量都很少。 第二招是手枪弹幕，这招会对正前方的方向施展，每秒造成42000的伤害，持续6秒，坦克被放了之后就赶快绕到王背后即可。 第三招则是对团队放暗影尖刺，也是扩散引导型的暗影法术。 最后一招则是致死伤口，简单讲就是附带有流血效果和降低治疗效果的50%点。 攻略方式 打法就团队站六点钟方向，坦克把王坦在看要在中间还是靠墙都可以，当王放技能的时候，坦克就从三点绕到六点，再放一次技能就六点跑回三点，这样无论怎么放技能，都不会对团队造成威胁。当打完之后任务全国人大会跑到房间门口让玩家回报。 补充点 注意打断，注意驱散，坦克注意躲好AOE。 总结：以上是魔兽世界大灾变怀旧服影牙城堡副本打法攻略介绍，希望这篇文章能帮助到大家

8. 害，并且爆击率提高100%，打完之后即可继续上楼。 补充点 这场BOSS战是极为典型的BOSS放什么躲什么的战斗，随时注意躲开奇怪的东西就好了。坦克本身受到的伤害很低，主要在于DPS的灵活程度了。 高佛雷领主 BOSS生命值 普通模式：13,920/英雄模式：2,593,000 从炼金室绕道而上，狼王早已不在，过关斩将除掉挡路的骷髅法师和卫兵之后，领主高弗雷的阴谋就在眼前，注意高弗雷可是超帅手持双枪的，猎人梦寐以求的凶残能力！ 打法、心得 这场战斗和前面比起来倒是意外的简单，主要技能有四招： 第一招是召唤食尸鬼，召唤出来之后坦克抓好曝光掉即可，血量都很少。 第二招是手枪弹幕，这招会对正前方的方向施展，每秒造成42000的伤害，持续6秒，坦克被放了之后就赶快绕到王背后即可。 第三招则是对团队放暗影尖刺，也是扩散引导型的暗影法术。 最后一招则是致死伤口，简单讲就是附带有流血效果和降低治疗效果的50%点。 攻略方式 打法就团队站六点钟方向，坦克把王坦在看要在中间还是靠墙都可以，当王放技能的时候，坦克就从三点绕到六点，再放一次技能就六点跑回三点，这样无论怎么放技能，都不会对团队造成威

</details>

## 4. 团队通用注意

- 英雄装等以当时 5H 入门装为准；打断职业越多越稳（1 号、3 号尤其）
- 驱散：诅咒（席瓦莱恩、高弗雷）、魔法/毒（沃登等）按阵容分配
- 通道狭小：分波、别跳崖式开怪；治疗站高处/扶手防卡视角

## 5. 相关成就

- Heroic: Shadowfang Keep — 英雄击杀高弗雷
- Pardon Denied / 缓刑驳回 — 不让亚什布里暂缓处决产生治疗
- To the Ground! — 不让斯普林瓦尔获得 Unholy Empowerment
- Bullet Time / 子弹时间 — 弹幕击杀足够嗜血食尸鬼后再击杀高弗雷

## 6. 本地模拟器技能 CD 备注（仓库 bosses）

### 亚什布里男爵（ashbury.ts）
- **亚什布里男爵**：读条 4000ms / CD 32000ms — 引导锁住全团，并将全员生命值强制抽干至 1 点！
- **暂缓处决**：读条 6000ms / CD 30000ms — 窒息术后自愈全场并自愈Boss自身，必须被打断以防Boss回满血！
- **修补烂肉**：读条 2500ms / CD 26000ms — Boss大量自愈25%，必须被打断
- **苦痛灾厄脉冲**：读条 1500ms / CD 12000ms — 向全团释放暗影苦痛灾厄，全团持续掉血，30%血量以下狂暴形态伤害剧增！

### 高弗雷勋爵（godfrey.ts）
- **高弗雷勋爵**：读条 0ms / CD 15000ms — 降低主坦受疗叠层
- **重伤**：读条 2000ms / CD 16000ms — 强力多目标点名诅咒，造成22,000暗影伤害并附加每3秒6,500高额DOT，可打断与驱散
- **诅咒之弹 (DoT)**：读条 3000ms / CD 32000ms — 60°红色扇形预警后扫射全团，扇形内秒杀级伤害，全场流弹受到11,000物理波及

### 席瓦莱恩男爵（silverlaine.ts）
- **席瓦莱恩男爵**：读条 1500ms / CD 18000ms — 对主坦及随机队员施加降受疗75%诅咒与暗影DOT，持续15秒，急需驱散！
- **降受疗诅咒**：读条 1500ms / CD 14000ms — 向全团释放席瓦莱恩阴影面纱，造成 15,000 点暗影伤害
- **召唤狼人之灵**：读条 1500ms / CD 25000ms — 召唤先祖狼人之灵突袭后排治疗/DPS

### 指挥官斯普林瓦尔（springvale.ts）
- **指挥官斯普林瓦尔**：读条 1500ms / CD 18000ms — 正面顺劈斩高额伤害
- **邪恶充能脉冲**：读条 2000ms / CD 15000ms — 释放体内积聚的邪恶亡灵能量，对全团造成 16,000 点暗影伤害
- **暗绿亵渎**：读条 1000ms / CD 20000ms — 在一名玩家脚下生成暗绿亵渎毒圈，按范围生效，必须迅速走出！

### 沃登勋爵（walden.ts）
- **沃登勋爵**：读条 1500ms / CD 14000ms — 剧毒催化剂(必须走动)/凝固毒素(必须静止)强力DOT，急需治疗与驱散
- **寒冰碎片爆轰**：读条 1500ms / CD 16000ms — 投掷凝华冰霜药剂，全团受到 18,000 点冰霜伤害

## 7. 本次抓取来源 URL

- https://gotwarcraft.com/heroic-shadowfang-keep/ （10800 字符）
- https://www.wilfridwong.com/articles/world-of-warcraft/cataclysm-heroic-dungeons-quick-reference-guide/ （53713 字符）
- https://wow.17173.com/content/05112024/142024923.shtml （4903 字符）
- http://ctm.17173.com/content/2010-12-13/20101213144745376,1.shtml （1873 字符）
- http://ctm.17173.com/content/2010-12-13/20101213144745376,2.shtml （3693 字符）
- http://ctm.17173.com/content/2011-01-28/20110128152904344.shtml （6043 字符）
- https://ctm.17173.com/content/2010-12-13/20101213144745376,1.shtml （1873 字符）
- https://games.sina.com.cn/o/z/wow/2010-12-15/1003393538.shtml （10064 字符）
- https://games.sina.com.cn/o/z/wow/2011-07-07/1458416863.shtml （24288 字符）

---

说明：不同站点对血线百分比、伤害数字、召唤时机可能略有出入；以实际战斗读条与团队通关经验校准。本工具目标是为模拟器/文案提供详尽「副本介绍」底稿。
