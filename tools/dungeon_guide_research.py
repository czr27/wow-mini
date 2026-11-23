#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
副本攻略研究小工具：输入副本中文/英文名，从多个资料站抓取攻略并合并为「副本介绍」文本。

用法:
  python tools/dungeon_guide_research.py 影牙城堡
  python tools/dungeon_guide_research.py "Shadowfang Keep" --out tools/dungeon_guides
  python tools/dungeon_guide_research.py 影牙城堡 --no-fetch   # 仅用内置合并稿 + 本地引擎备注

资料来源（默认可抓取）:
  - Wowhead / Icy Veins / GotWarcraft（英）
  - 17173 等中文站（若可访问）
  - DuckDuckGo HTML 搜索补充链接
  - 本仓库 bosses/*.ts 技能 CD 备注（若存在）

输出为 Markdown，强调：流程环节、Boss 顺序、机制、技能、CD、阶段、注意事项。
"""

from __future__ import print_function, unicode_literals

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime
from html import unescape

try:
    from urllib.parse import quote_plus, urlparse
    from urllib.request import Request, urlopen
except ImportError:
    from urllib import quote_plus  # type: ignore
    from urlparse import urlparse  # type: ignore
    from urllib2 import Request, urlopen  # type: ignore

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DEFAULT_OUT_DIR = os.path.join(ROOT, "tools", "dungeon_guides")
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)

# ── 副本别名 → 规范键 ──────────────────────────────────────────
DUNGEON_ALIASES = {
    "影牙城堡": "shadowfang_keep",
    "影牙": "shadowfang_keep",
    "shadowfang keep": "shadowfang_keep",
    "shadowfang": "shadowfang_keep",
    "sfk": "shadowfang_keep",
    "巨龙之魂": "dragon_soul",
    "dragon soul": "dragon_soul",
    "ds": "dragon_soul",
    "死亡矿井": "deadmines",
    "死矿": "deadmines",
    "the deadmines": "deadmines",
    "deadmines": "deadmines",
    "dm": "deadmines",
    "血色修道院": "scarlet_monastery",
    "血色": "scarlet_monastery",
    "scarlet monastery": "scarlet_monastery",
    "sm": "scarlet_monastery",
    "斯坦索姆": "stratholme",
    "strat": "stratholme",
    "stratholme": "stratholme",
    "祖尔格拉布": "zulgurub",
    "祖格": "zulgurub",
    "zul'gurub": "zulgurub",
    "zulgurub": "zulgurub",
    "zg": "zulgurub",
}

# 已知资料站种子 URL（优先抓取，再搜索补充）
SEED_URLS = {
    "shadowfang_keep": [
        "https://www.icy-veins.com/cataclysm-classic/shadowfang-keep-dungeon-guide",
        "https://gotwarcraft.com/heroic-shadowfang-keep/",
        "https://www.wowhead.com/cata/guide/shadowfang-keep-overview",
        "https://www.wilfridwong.com/articles/world-of-warcraft/cataclysm-heroic-dungeons-quick-reference-guide/",
        "https://wow.17173.com/content/05112024/142024923.shtml",
        "http://ctm.17173.com/content/2010-12-13/20101213144745376,1.shtml",
        "http://ctm.17173.com/content/2010-12-13/20101213144745376,2.shtml",
    ],
    "dragon_soul": [
        "https://www.icy-veins.com/cataclysm-classic/dragon-soul-raid-guide",
        "https://www.warcrafttavern.com/cataclysm/guides/dragon-soul-raid-overview/",
        "https://www.wowhead.com/cata/guide/raids/dragon-soul/morchok-strategy-overview",
        "https://www.wowhead.com/cata/guide/raids/dragon-soul/ultraxion-strategy-overview",
        "https://www.warcrafttavern.com/cataclysm/guides/ultraxion-raid-guide/",
    ],
    "deadmines": [
        "https://www.icy-veins.com/cataclysm-classic/the-deadmines-dungeon-guide",
        "https://www.wowhead.com/cata/guide/the-deadmines-overview",
        "https://warcraft.wiki.gg/wiki/Vanessa_VanCleef_(tactics)",
        "https://www.warcrafttavern.com/cataclysm/guides/the-deadmines-dungeon-guide/",
    ],
    "scarlet_monastery": [
        "https://wowcalc.net/zh-CN/classic/guides/dungeons/scarlet-monastery",
        "https://www.wowhead.com/guide/scarlet-monastery-dungeon-strategy-guide",
        "https://warcraft.wiki.gg/wiki/Scarlet_Monastery",
        "https://www.icy-veins.com/wow-classic/scarlet-monastery-dungeon-guide",
    ],
    "stratholme": [
        "https://wowcalc.net/zh-CN/classic/wiki/dungeons/stratholme",
        "https://www.wowhead.com/guide/stratholme-dungeon-strategy-guide",
        "https://warcraft.wiki.gg/wiki/Stratholme",
        "https://www.icy-veins.com/wow-classic/stratholme-dungeon-guide",
    ],
    "zulgurub": [
        "https://www.icy-veins.com/cataclysm-classic/zul-gurub-dungeon-guide",
        "https://www.wowhead.com/cata/guide/dungeons/zulgurub-overview",
        "https://www.warcrafttavern.com/cataclysm/guides/zulgurub-dungeon-guide/",
        "https://warcraft.wiki.gg/wiki/Zul%27Gurub_(instance)",
    ],
}

# 搜索关键词
SEARCH_QUERIES = {
    "shadowfang_keep": [
        "影牙城堡 大灾变 英雄 攻略 首领机制",
        "Shadowfang Keep Cataclysm Classic heroic dungeon guide bosses",
        "Heroic Shadowfang Keep Baron Ashbury Springvale Godfrey",
    ],
    "dragon_soul": [
        "巨龙之魂 大灾变 团本 攻略 莫卓克 奥卓克希昂",
        "Dragon Soul Cataclysm Classic raid guide Morchok Ultraxion Hagara",
        "Dragon Soul Warlord Zonozz Yorsahj Spine Madness of Deathwing",
    ],
    "deadmines": [
        "死亡矿井 大灾变 英雄 攻略 梵妮莎",
        "Deadmines Cataclysm Classic heroic dungeon guide Vanessa VanCleef",
        "Heroic Deadmines Glubtok Helix Foe Reaper Ripsnarl Cookie",
    ],
    "scarlet_monastery": [
        "血色修道院 经典旧世 攻略 墓地 图书馆 军械库 大教堂",
        "Scarlet Monastery Classic dungeon guide bosses Herod Whitemane",
        "血色修道院 杜安 钥匙 怀特迈恩",
    ],
    "stratholme": [
        "斯坦索姆 经典旧世 攻略 血色区 亡灵区 瑞文戴尔",
        "Stratholme Classic dungeon guide Living Undead Baron Rivendare",
        "斯坦索姆 巴纳扎尔 炮手威利 限时男爵",
    ],
    "zulgurub": [
        "祖尔格拉布 大灾变 5人本 英雄 攻略 金度",
        "Zul'Gurub Cataclysm Classic heroic 5-man dungeon guide Jindo",
        "Heroic ZulGurub Venoxis Mandokir Kilnara Zanzil",
    ],
}

# 内置合并稿：多站交叉核对后的结构化骨架（抓取失败时仍可出稿）
CURATED = {
    "shadowfang_keep": {
        "cn_name": "影牙城堡",
        "en_name": "Shadowfang Keep",
        "tier": "5 人副本（大灾变翻新 / 英雄 85）",
        "location": "银松森林西南；联盟可经希尔斯布莱德飞入或排队进本",
        "theme": (
            "大灾变翻新后由狼人据点变为亡灵盘踞的城堡。"
            "尾王不再是阿鲁高，而是高弗雷勋爵。"
            "通道狭窄、易 ADD、治疗易卡视角，拉怪节奏比机制本身更常灭团。"
        ),
        "route": [
            "入口螺旋楼梯 / 监牢区：精英食尸鬼 + 跳跃者，分波拉、宽处打，勿冲过头",
            "1 号 BOSS：亚什布里男爵（原监狱位）",
            "庭院 → 厨房 / 餐厅：无面者（群体恐惧）与鬼魂仆人（锁/控），勿拉多",
            "2 号 BOSS：席瓦莱恩男爵（餐厅 / 岔路下旋梯）",
            "上楼走廊 → 守卫室",
            "3 号 BOSS：指挥官斯普林瓦尔（守卫室，部分攻略称可跳过但常规流程会打）",
            "城墙 / 阁楼：剧毒食尸鬼（死后毒爆）、石像鬼（恐惧需打断）",
            "4 号 BOSS：沃登勋爵（炼金室）",
            "上层通道清骷髅法师与卫兵",
            "5 号尾王：高弗雷勋爵（双枪厅，建议拉至下层开阔处）",
        ],
        "boss_order": [
            "亚什布里男爵 (Baron Ashbury)",
            "席瓦莱恩男爵 (Baron Silverlaine)",
            "指挥官斯普林瓦尔 (Commander Springvale)",
            "沃登勋爵 (Lord Walden)",
            "高弗雷勋爵 (Lord Godfrey)",
        ],
        "bosses": [
            {
                "order": 1,
                "cn": "亚什布里男爵",
                "en": "Baron Ashbury",
                "role": "打断 + 群疗压力测试；英雄难度核心教学王",
                "phases": [
                    "P1（100%–约 25%/20%）：窒息 → 暂缓处决节奏；穿插苦痛/修补打断与毁坏之痛叠层",
                    "P2（约 ≤25%/20%）：暗影大天使 + 灾祸持续全团 AOE，爆发速杀",
                ],
                "skills": [
                    {
                        "cn": "窒息术",
                        "en": "Asphyxiate",
                        "cd": "约 32s（引擎标定 cast 4s / CD 32s）",
                        "note": "不可打断；全员血量压至 1（或极低），落地后立刻需要治疗",
                    },
                    {
                        "cn": "暂缓处决",
                        "en": "Stay of Execution",
                        "cd": "窒息后立刻引导（引擎 cast 约 6s / CD 约 30s）",
                        "note": "每跳治疗 Boss 与玩家（英雄常见每跳约 10%）。通常让 1–2 跳后打断：太早 T 可能秒死，太晚 Boss 回血过多",
                    },
                    {
                        "cn": "修补烂肉",
                        "en": "Mend Rotten Flesh",
                        "cd": "约 26s（引擎 cast 2.5s）",
                        "note": "Boss 自疗（英雄约 25%），最高优先级打断",
                    },
                    {
                        "cn": "苦痛与折磨 / 苦痛灾厄",
                        "en": "Pain and Suffering",
                        "cd": "脉冲约 12s 量级",
                        "note": "可打断的暗影引导/鞭笞；低血时极易死人，窒息后尤其危险",
                    },
                    {
                        "cn": "毁坏之痛",
                        "en": "Wracking Pain",
                        "cd": "战斗中周期性",
                        "note": "全团暗影伤害并提高暗影易伤（约 +20%/层，可持续叠），为 P2 埋雷",
                    },
                    {
                        "cn": "灾祸",
                        "en": "Calamity",
                        "cd": "进入暗天使阶段后持续",
                        "note": "全团持续暗影 AOE + 易伤递增；尽量避免刚窒息完立刻进阶段；嗜血/英勇与大招留此阶段",
                    },
                ],
                "tips": [
                    "开打前排好打断链：修补烂肉 / 苦痛 专人负责，暂缓处决约定跳数",
                    "个人减伤、瞬疗、药水在窒息落地与 P2 前备好",
                    "成就「缓刑驳回 / Pardon Denied」：全程不让暂缓处决跳治疗",
                    "中文站与英文站对变身阈值写法不一（约 25% / 20%），以实际读条与血线为准，控制进阶段时机",
                ],
                "sources": ["Icy Veins", "GotWarcraft", "17173", "WilfridWong", "本仓库 ashbury.ts"],
            },
            {
                "order": 2,
                "cn": "席瓦莱恩男爵",
                "en": "Baron Silverlaine",
                "role": "驱散诅咒 + 处理狼人增援；相对简单",
                "phases": [
                    "全程：周期性降疗诅咒 + 召唤狼人之灵（不同旧影牙名人魂）",
                    "低血阶段：部分攻略称约 25% 强力召唤，优先处理增援或选择直压 Boss",
                ],
                "skills": [
                    {
                        "cn": "阴影面纱 / 降受疗诅咒",
                        "en": "Veil of Shadow / Cursed Veil",
                        "cd": "约 14–18s",
                        "note": "受治疗降低约 75%（约 15s），优先驱散主坦与被重点治疗目标",
                    },
                    {
                        "cn": "召唤狼人之灵",
                        "en": "Summon Worgen Spirit",
                        "cd": "约 25s",
                        "note": "可能召唤盲眼奥杜、屠夫刃爪、雷希戈尔、狼王南杜斯等；T 立刻拉怪，DPS 可先清增援再回 Boss，或直压",
                    },
                ],
                "tips": [
                    "狼人召唤后有短暂延迟，T 预留嘲讽/仇恨技能",
                    "第三次召唤后若输出足够可放弃小怪直杀 Boss（中文攻略常见建议）",
                    "庭院无面者群体恐惧无法打断，尽量拉回台阶/室内打",
                ],
                "sources": ["Icy Veins", "17173", "本仓库 silverlaine.ts"],
            },
            {
                "order": 3,
                "cn": "指挥官斯普林瓦尔",
                "en": "Commander Springvale",
                "role": "空间管理 + 增援打断/CC；英雄难度协调要求最高之一",
                "phases": [
                    "开场即带哀嚎卫兵 + 痛苦军官；战斗中反复从两侧楼梯口增援",
                    "不洁能量叠满（约 3 层）触发正面锥形或羞愧之语",
                    "低血（部分资料约 30%）后羞愧之语 debuff 使战斗偏限时",
                ],
                "skills": [
                    {
                        "cn": "背信之盾",
                        "en": "Shield of the Perfidious",
                        "cd": "约 18s（或不洁能量满时）",
                        "note": "正面锥形高伤引导；T 背对团队，所有人禁止站 Boss 正面",
                    },
                    {
                        "cn": "亵渎",
                        "en": "Desecration",
                        "cd": "约 20s",
                        "note": "点名脚下毒圈，近战立刻离开；T 尽量把圈甩到墙外/楼梯外",
                    },
                    {
                        "cn": "邪恶打击 / 不洁赋能相关",
                        "en": "Malefic Strike / Unholy Empowerment",
                        "cd": "近战打击叠能量；小怪读条赋能",
                        "note": "小怪 Unholy Empowerment 必须打断（治疗 Boss / 强化）；成就「躺地板吧你! / To the Ground!」要求不让其获得赋能",
                    },
                    {
                        "cn": "羞愧之语",
                        "en": "Word of Shame",
                        "cd": "能量满时二选一",
                        "note": "目标每 3 秒损失约 5% 生命直至战斗结束，推高治疗压力",
                    },
                    {
                        "cn": "哀嚎卫兵 / 痛苦军官",
                        "en": "Wailing Guardsman / Tormented Officer",
                        "cd": "开场 + 周期性增援",
                        "note": "卫兵有 AOE 沉默（过去的尖啸），远程拉开；军官可锁/恐；优先打断赋能并尽快减员",
                    },
                ],
                "tips": [
                    "T 站远端墙边，团队靠原站位一侧，减少锥形与亵渎覆盖",
                    "分配副 T/近战或锁怪处理增援；远程与 Boss 保持距离躲沉默",
                    "输出不足时可跳过清小怪直压；输出足够则控怪清场更稳",
                ],
                "sources": ["Icy Veins", "GotWarcraft", "WilfridWong", "17173", "本仓库 springvale.ts"],
            },
            {
                "order": 4,
                "cn": "沃登勋爵",
                "en": "Lord Walden",
                "role": "走位王：绿走红停 + 躲开冰霜落点",
                "phases": [
                    "全程：毒瓶/霜瓶投掷 + 冰碎片落点",
                    "神秘毒素：绿混合物必须持续移动；红混合物必须静止（红灯停绿灯走）",
                    "约 30% 后红药相关压力上升（中文攻略强调）",
                ],
                "skills": [
                    {
                        "cn": "配制剧毒/冰霜混合物",
                        "en": "Conjure Poisonous / Frost Mixture",
                        "cd": "高频投掷（引擎三色魔药约 14s）",
                        "note": "飞弹落地有指示，躲开；队伍散开避免多人同中",
                    },
                    {
                        "cn": "寒冰碎片",
                        "en": "Ice Shards",
                        "cd": "约 16s",
                        "note": "地面蓝圈落点，离开落点",
                    },
                    {
                        "cn": "神秘毒素（绿/红）",
                        "en": "Conjure Mystery Toxin (Green/Red)",
                        "cd": "战斗中穿插",
                        "note": "绿：保持移动/跳跃消层；红：站住输出（移动会吃 Toxic Catalyst）。可驱散的毒优先驱",
                    },
                ],
                "tips": [
                    "T 承伤通常不高，成败在 DPS 走位意识",
                    "散开站位，预读读条颜色/特效再决定动或停",
                ],
                "sources": ["Icy Veins", "GotWarcraft", "17173", "本仓库 walden.ts"],
            },
            {
                "order": 5,
                "cn": "高弗雷勋爵",
                "en": "Lord Godfrey",
                "role": "尾王：弹幕走位 + 诅咒打断驱散 + 食尸鬼清理",
                "phases": [
                    "建议开战将 Boss 拉至下层；周期性召唤嗜血食尸鬼 → 手枪弹幕",
                    "穿插诅咒之弹与重伤叠层",
                ],
                "skills": [
                    {
                        "cn": "召唤嗜血食尸鬼",
                        "en": "Summon Bloodthirsty Ghouls",
                        "cd": "弹幕前常见组合",
                        "note": "小怪血薄；可用弹幕扫掉；成就「子弹时间 / Bullet Time」要求弹幕击杀足够数量后再击杀 Boss",
                    },
                    {
                        "cn": "双枪弹幕",
                        "en": "Pistol Barrage",
                        "cd": "约 32s（引擎 cast 约 3s）",
                        "note": "正面锥形超高伤持续扫射；T 与全体离开正面；可用俯视角看弹幕方向",
                    },
                    {
                        "cn": "诅咒之弹",
                        "en": "Cursed Bullets",
                        "cd": "约 16s（引擎 cast 约 2s）",
                        "note": "高额暗影伤害 + DOT，可打断、可驱散，优先处理",
                    },
                    {
                        "cn": "重伤 / 致死伤口",
                        "en": "Mortal Wound",
                        "cd": "约 15s",
                        "note": "降低受治疗，叠层时治疗注意主坦",
                    },
                ],
                "tips": [
                    "团队站 Boss 一侧（如 6 点），T 弹幕时绕侧面换位",
                    "打断 + 驱散诅咒是治疗减负关键",
                    "中英文攻略一致认为：躲好弹幕后该战相对简单",
                ],
                "sources": ["Icy Veins", "GotWarcraft", "17173", "本仓库 godfrey.ts"],
            },
        ],
        "achievements": [
            "Heroic: Shadowfang Keep — 英雄击杀高弗雷",
            "Pardon Denied / 缓刑驳回 — 不让亚什布里暂缓处决产生治疗",
            "To the Ground! — 不让斯普林瓦尔获得 Unholy Empowerment",
            "Bullet Time / 子弹时间 — 弹幕击杀足够嗜血食尸鬼后再击杀高弗雷",
        ],
        "party_notes": [
            "英雄装等以当时 5H 入门装为准；打断职业越多越稳（1 号、3 号尤其）",
            "驱散：诅咒（席瓦莱恩、高弗雷）、魔法/毒（沃登等）按阵容分配",
            "通道狭小：分波、别跳崖式开怪；治疗站高处/扶手防卡视角",
        ],
    },
    "dragon_soul": {
        "cn_name": "巨龙之魂",
        "en_name": "Dragon Soul",
        "tier": "10/25 人团本（模拟器按 20 人档标定）· 大灾变终章",
        "location": "时光之穴（塔纳利斯）；可达途径含达拉然紫堡传送等",
        "theme": (
            "大灾变终章团本：协助萨尔与龙族守护者使用巨龙之魂对抗死亡之翼。"
            "共 8 场首领战，分「龙眠神殿围攻」与「死亡之翼陨落」两翼；"
            "除佐诺兹/约萨希可互换顺序外，其余基本线性推进。"
        ),
        "route": [
            "入口：龙眠神殿外围战场 → 1 号莫卓克",
            "神殿门口乘龙：南门绿龙 → 戈拉斯之喉（佐诺兹）；西门铜龙 → 舒玛之喉（约萨希）；二者可任选顺序",
            "打完前三后乘东门红龙上神殿顶 → 传送至永恒之眼 → 4 号哈甲拉",
            "返回神殿顶 → 暮光龙潮 → 5 号奥卓克希昂",
            "登舰天火号 → 6 号战争领主黑角",
            "跳伞至死亡之翼背脊 → 7 号背脊",
            "大漩涡 → 8 号死亡之翼的疯狂（尾王）",
        ],
        "boss_order": [
            "莫卓克 (Morchok)",
            "督军佐诺兹 (Warlord Zon'ozz) ↔ 不眠的约萨希 (Yor'sahj)（可互换）",
            "缚风者哈甲拉 (Hagara the Stormbinder)",
            "奥卓克希昂 (Ultraxion)",
            "战争领主黑角 (Warmaster Blackhorn)",
            "死亡之翼的背脊 (Spine of Deathwing)",
            "死亡之翼的疯狂 (Madness of Deathwing)",
        ],
        "bosses": [
            {
                "order": 1,
                "cn": "莫卓克",
                "en": "Morchok",
                "role": "教学向：分摊践踏 + 共鸣水晶近距吸收 + 黑血躲柱间歇",
                "phases": [
                    "主阶段：践踏分摊、共鸣水晶、击碎护甲换坦（普通）",
                    "间歇（约 55s）：大地之怒拉人 + 碎石柱，黑血期间躲柱后",
                    "≤20%：Furious 增伤加速；英雄 90% 分裂出 Kohcrom 双王",
                ],
                "skills": [
                    {
                        "cn": "践踏",
                        "en": "Stomp",
                        "cd": "主阶段周期性",
                        "note": "近距分摊巨额物理；双坦叠身（英雄两侧各自叠人）；最近目标吃双份",
                    },
                    {
                        "cn": "共鸣水晶",
                        "en": "Resonating Crystal",
                        "cd": "主阶段",
                        "note": "连线最近 3/7 人，12s 后爆炸，距离越近伤害越低（蓝好红差）",
                    },
                    {
                        "cn": "击碎护甲",
                        "en": "Crush Armor",
                        "cd": "普通模式为主",
                        "note": "-10% 护甲可叠，约 2–3 层换坦",
                    },
                    {
                        "cn": "大地黑血",
                        "en": "Black Blood of the Earth",
                        "cd": "间歇",
                        "note": "躲在碎石柱后；非躲柱位持续重伤",
                    },
                ],
                "tips": [
                    "水晶优先远程/治疗吃，减少 Boss 走位",
                    "20% 后开嗜血并给坦强减伤",
                ],
                "sources": ["Wowhead Morchok", "Icy Veins", "Warcraft Tavern", "本仓库 morchok.ts"],
            },
            {
                "order": 2,
                "cn": "督军佐诺兹",
                "en": "Warlord Zon'ozz",
                "role": "球传递（黑光）叠易伤；虚空区域与触须管理",
                "phases": [
                    "主阶段：心理阴影伤害、专注干扰、传递黑光球撞 Boss 叠易伤",
                    "虚空阶段：触须/虚空地带，处理完回主阶段",
                ],
                "skills": [
                    {
                        "cn": "黑光",
                        "en": "Black Blood / Focused Anger related ball",
                        "cd": "主循环",
                        "note": "球需玩家顶传撞 Boss；失败则打团或丢失易伤窗口",
                    },
                    {
                        "cn": "心理阴影等",
                        "en": "Psychic Drain / Shadow",
                        "cd": "周期性",
                        "note": "坦克与团队暗影压力；注意站位与治疗",
                    },
                ],
                "tips": [
                    "传球路线预演；英雄难度对打断/站位要求更高",
                    "模拟器现状为通用模板，需按本机制重做",
                ],
                "sources": ["Icy Veins", "Warcraft Tavern"],
            },
            {
                "order": 3,
                "cn": "不眠的约萨希",
                "en": "Yor'sahj the Unsleeping",
                "role": "血滴颜色组合决定机制；点杀血滴控combo",
                "phases": [
                    "全程：召唤多色血滴，存活者与 Boss 融合触发对应效果",
                    "颜色组合决定 AOE、治疗、增伤、软狂暴等",
                ],
                "skills": [
                    {
                        "cn": "召唤血滴",
                        "en": "Call Blood",
                        "cd": "周期性",
                        "note": "红/绿/黄/蓝/紫/黑等；优先击杀危险组合",
                    },
                    {
                        "cn": "消化/融合效果",
                        "en": "Digestive Acid / combos",
                        "cd": "血滴抵达后",
                        "note": "不同颜色 = 不同团队机制，英雄更严",
                    },
                ],
                "tips": [
                    "分配点杀优先级；避免「全员危险combo」",
                    "模拟器现状为通用模板，需按颜色系统重做",
                ],
                "sources": ["Icy Veins", "Warcraft Tavern"],
            },
            {
                "order": 4,
                "cn": "缚风者哈甲拉",
                "en": "Hagara the Stormbinder",
                "role": "冰/雷阶段转阶段；冰环走位与雷传导",
                "phases": [
                    "主阶段：冰箭/集中攻击等",
                    "冰霜阶段：冰墓、冰墙/冰环，打破后回主阶段",
                    "闪电阶段：传导水晶/水上导电，正确传导打断阶段",
                ],
                "skills": [
                    {
                        "cn": "冰霜之墓等",
                        "en": "Ice Tomb / Frost phases",
                        "cd": "冰阶段",
                        "note": "打破冰墓救人；注意冰环边缘伤害",
                    },
                    {
                        "cn": "闪电风暴/传导",
                        "en": "Lightning Storm / Conductive",
                        "cd": "雷阶段",
                        "note": "沿水晶正确传电结束阶段",
                    },
                ],
                "tips": [
                    "两阶段机制完全不同，需单独时间轴",
                    "模拟器现状为通用模板",
                ],
                "sources": ["Icy Veins", "Warcraft Tavern"],
            },
            {
                "order": 5,
                "cn": "奥卓克希昂",
                "en": "Ultraxion",
                "role": "暮光领域 + 英勇意志进出；畸变加速心跳；暮光时刻分摊",
                "phases": [
                    "单阶段限时（约 6 分钟暮光爆发硬狂暴）",
                    "畸变脉冲间隔从 6s 逐步缩短至 1s",
                ],
                "skills": [
                    {
                        "cn": "不稳定的畸变",
                        "en": "Unstable Monstrosity",
                        "cd": "起始 6s，每分钟 -1s 直至 1s",
                        "note": "暮光领域内近距分摊暗影伤害",
                    },
                    {
                        "cn": "暮光时刻",
                        "en": "Hour of Twilight",
                        "cd": "周期性",
                        "note": "多数人用英勇意志离开领域；需留指定人数分摊，无人则守护者死亡灭团",
                    },
                    {
                        "cn": "凋零之光",
                        "en": "Fading Light",
                        "cd": "点名坦+随机",
                        "note": "计时结束仍在暮光领域则秒杀；需提前英勇意志离开并换坦",
                    },
                    {
                        "cn": "暮光爆发",
                        "en": "Twilight Eruption",
                        "cd": "约 6 分钟硬狂暴",
                        "note": "有短暂读条，超时团灭",
                    },
                ],
                "tips": [
                    "分摊组轮换（英雄有 Looming Darkness 限制连续分摊）",
                    "本仓库已有简化版畸变+审判，缺领域/意志/加速/点名",
                ],
                "sources": ["Wowhead Ultraxion", "Warcraft Tavern", "本仓库 ultraxion.ts"],
            },
            {
                "order": 6,
                "cn": "战争领主黑角",
                "en": "Warmaster Blackhorn",
                "role": "舰船防守：龙潮与甲板小怪 → 黑角着陆",
                "phases": [
                    "P1：天火号甲板，抵御暮光龙与降兵，保护舰船",
                    "P2：黑角着陆，坦克技能 + 冲击波等",
                ],
                "skills": [
                    {
                        "cn": "龙息/燃烧甲板",
                        "en": "Onslaught / deck fires",
                        "cd": "P1",
                        "note": "处理火焰与空中单位，舰船血量归零则失败",
                    },
                    {
                        "cn": "冲击波等",
                        "en": "Shockwave / landed phase",
                        "cd": "P2",
                        "note": "着陆后近战侧与走位",
                    },
                ],
                "tips": ["需舰船/波次系统；模拟器现为通用模板"],
                "sources": ["Icy Veins", "Warcraft Tavern"],
            },
            {
                "order": 7,
                "cn": "死亡之翼的背脊",
                "en": "Spine of Deathwing",
                "role": "撕甲片 → 腐蚀残渣 → 滚转；独特平台机制",
                "phases": [
                    "打开甲片暴露腐蚀脓肿/残渣",
                    "残渣死亡相关滚转；重复直至足够甲片",
                ],
                "skills": [
                    {
                        "cn": "灼热血浆/腐蚀",
                        "en": "Searing Plasma / Corruption",
                        "cd": "平台机制",
                        "note": "驱散/点杀腐蚀；注意粘附与滚落",
                    },
                    {
                        "cn": "滚转",
                        "en": "Roll",
                        "cd": "残渣条件触发",
                        "note": "全团需抓稳，否则摔死",
                    },
                ],
                "tips": ["非传统站桩战；模拟器需专用场景逻辑"],
                "sources": ["Icy Veins", "Warcraft Tavern"],
            },
            {
                "order": 8,
                "cn": "死亡之翼的疯狂",
                "en": "Madness of Deathwing",
                "role": "多平台肢体重伤 → 狂乱阶段；大漩涡终局",
                "phases": [
                    "依次重创四肢平台（ leg/arm ）并处理小怪与机制",
                    "躯干暴露后最终阶段爆发输出",
                ],
                "skills": [
                    {
                        "cn": "催化/元素攻击",
                        "en": "Elementium / cataclysmic abilities",
                        "cd": "分平台",
                        "note": "每肢不同元素主题；失败平台影响最终",
                    },
                    {
                        "cn": "毁灭",
                        "en": "Cataclysm / final",
                        "cd": "终局",
                        "note": "硬狂暴与爆发窗口",
                    },
                ],
                "tips": ["尾王为多阶段多平台；模拟器现为通用模板"],
                "sources": ["Icy Veins", "Warcraft Tavern"],
            },
        ],
        "achievements": [
            "Fall of Deathwing — 普通通关后解锁英雄（怀旧服规则以版本为准）",
            "各首领独立英雄成就与速通/机制成就（详见 Wowhead/Icy Veins）",
        ],
        "party_notes": [
            "双坦配置为主；部分英雄战可能需要更多坦或治疗弹性",
            "狂暴紧，远程比例通常高于近战",
            "模拟器 20 人档：优先把莫卓克/奥卓克希昂做成「可玩机制」，其余再逐个替换通用模板",
        ],
    },
    "deadmines": {
        "cn_name": "死亡矿井",
        "en_name": "The Deadmines",
        "tier": "5 人副本（大灾变翻新；普通升级 / 英雄 85）",
        "location": "西部荒野月溪镇；部落可经荆棘谷或排队进本",
        "theme": (
            "大灾变翻新后由迪菲亚矿坑变为蒸汽朋克式地下工厂与海盗船。"
            "普通难度尾王为曲奇；英雄额外挑战梵妮莎·范克里夫（点笔记开启）。"
            "走位、炸弹与机械小怪是主旋律。"
        ),
        "route": [
            "入口矿道清迪菲亚矿工 / 地精 → 开阔大厅",
            "1 号：戈洛克托克（法师大厅）",
            "通道 → 伐木场",
            "2 号：赫利克斯·碎轮（骑木虱）",
            "工厂区 → 收割机平台",
            "3 号：死神 5000（可上原型收割机打熔渣）",
            "上船甲板",
            "4 号：撕心船长利普斯纳尔（迷雾阶段点蒸汽）",
            "厨房区",
            "5 号：曲奇（普通尾王；注意坏食物）",
            "英雄：点地上笔记 → 梦魇连环 → 梵妮莎·范克里夫",
        ],
        "boss_order": [
            "戈洛克托克 (Glubtok)",
            "赫利克斯·碎轮 (Helix Gearbreaker)",
            "死神 5000 (Foe Reaper 5000)",
            "撕心船长利普斯纳尔 (Admiral Ripsnarl)",
            "曲奇 (\"Captain\" Cookie)",
            "梵妮莎·范克里夫 (Vanessa VanCleef，仅英雄)",
        ],
        "bosses": [
            {
                "order": 1,
                "cn": "戈洛克托克",
                "en": "Glubtok",
                "role": "火焰/冰霜拳轮换 + 闪现；半血后花瓣与火墙",
                "phases": [
                    "P1：火焰之拳 / 冰霜之拳轮换，换拳时闪现重置仇恨，T 立刻接回",
                    "P2（约 50%）：中心轰炸火焰/冰霜花瓣，英雄会刷小花；火墙绕圈躲避",
                ],
                "skills": [
                    {"cn": "火焰之拳 / 冰霜之拳", "en": "Fists of Flame / Frost", "cd": "轮换", "note": "近战勿站 T 旁叠伤害"},
                    {"cn": "闪现", "en": "Blink", "cd": "换拳时", "note": "仇恨清空，T 预判接怪"},
                    {"cn": "火焰/冰霜花瓣", "en": "Fire/Frost Blossom", "cd": "P2 地面", "note": "看地躲开落点"},
                    {"cn": "火墙", "en": "Fire Wall", "cd": "英雄 P2", "note": "绕 Boss 圆周移动，勿穿墙"},
                ],
                "tips": ["半血后空间变小，远程优先站外圈"],
                "sources": ["Icy Veins", "Wowhead"],
            },
            {
                "order": 2,
                "cn": "赫利克斯·碎轮",
                "en": "Helix Gearbreaker",
                "role": "先打木虱，再打跳背的侏儒；胸弹散开",
                "phases": [
                    "P1：赫利克斯骑在笨拙木虱上，铺粘性炸弹 + 胸弹；木虱会抓人砸墙",
                    "P2：木虱死后赫利克斯每约 10s 跳到队友背上普攻并放胸弹",
                ],
                "skills": [
                    {"cn": "粘性炸弹", "en": "Sticky Bomb", "cd": "持续铺地", "note": "定时爆炸，躲开落点"},
                    {"cn": "胸弹", "en": "Chest Bomb", "cd": "随机点名", "note": "中弹者远离队友，免全团击飞"},
                    {"cn": "木虱砸击", "en": "Oaf Smash", "cd": "P1", "note": "被抓者承伤，尽快击杀木虱"},
                    {"cn": "跳跃", "en": "Leap", "cd": "P2 ~10s", "note": "被骑者需额外治疗"},
                ],
                "tips": ["胸弹是灭团主因；喊话跑出人群"],
                "sources": ["Icy Veins"],
            },
            {
                "order": 3,
                "cn": "死神 5000",
                "en": "Foe Reaper 5000",
                "role": "散开躲收割；一人上原型收割机清熔渣",
                "phases": [
                    "全程：远离正面收割打击；过载时远离 Boss 乱跑路径",
                    "约 30%：安全限制解除，伤害翻倍，开减伤/爆发",
                ],
                "skills": [
                    {"cn": "收割", "en": "Harvest", "cd": "点名落点", "note": "离开 Boss 行进路线与落点"},
                    {"cn": "过载", "en": "Overdrive", "cd": "全场乱跑", "note": "远离 Boss"},
                    {"cn": "熔渣", "en": "Molten Slag", "cd": "持续刷出", "note": "原型收割机优先清熔渣"},
                    {"cn": "安全限制解除", "en": "Safety Restrictions Off-line", "cd": "~30%", "note": "Boss 伤害大幅提升"},
                ],
                "tips": ["DPS/治疗开局散开；指定一人上机"],
                "sources": ["Icy Veins", "Wowhead"],
            },
            {
                "order": 4,
                "cn": "撕心船长利普斯纳尔",
                "en": "Admiral Ripsnarl",
                "role": "迷雾阶段点杀蒸汽；注意恐惧与冲锋",
                "phases": [
                    "甲板阶段：常规坦克战",
                    "迷雾：能见度下降，优先点蒸汽（Vapors），防止其长大",
                ],
                "skills": [
                    {"cn": "迷雾", "en": "Fog", "cd": "阶段转换", "note": "集火蒸汽小怪"},
                    {"cn": "冲锋/恐惧类", "en": "Charge / Fear-like", "cd": "战斗中", "note": "治疗预读；散开减连锁"},
                ],
                "tips": ["蒸汽长大后极痛，宁可读条也要点掉"],
                "sources": ["Icy Veins"],
            },
            {
                "order": 5,
                "cn": "曲奇",
                "en": "\"Captain\" Cookie",
                "role": "普通难度尾王；只吃好食物，躲坏食物",
                "phases": ["单一阶段：场地刷食物，好食物增益/回能，坏食物重伤"],
                "skills": [
                    {"cn": "抛掷食物", "en": "Throw Food", "cd": "持续", "note": "绿/好的可吃；坏的躲开"},
                ],
                "tips": ["近战注意脚下；治疗看谁误吃坏食物"],
                "sources": ["Icy Veins", "Wowhead"],
            },
            {
                "order": 6,
                "cn": "梵妮莎·范克里夫",
                "en": "Vanessa VanCleef",
                "role": "仅英雄；笔记开启；绳索躲爆 + 梦魇回忆关卡",
                "phases": [
                    "点笔记 → 中毒昏迷 → 依次经历前几位 Boss 的梦魇场景",
                    "回甲板打梵妮莎：偏折时停手或打小怪；50%/25% 拉绳躲开烈焰爆",
                    "火药爆炸前站到甲板边缘安全区",
                ],
                "skills": [
                    {"cn": "偏折", "en": "Deflection", "cd": "阶段", "note": "对 Boss 反伤，转火小怪"},
                    {"cn": "烈焰爆 / 绳索", "en": "Fiery Blaze / Ropes", "cd": "50% / 25%", "note": "抓紧绳索荡离甲板再回来"},
                    {"cn": "火药爆炸", "en": "Powder Explosion", "cd": "终局", "note": "站甲板边缘"},
                ],
                "tips": ["开打前确认全员会找绳；灭团多在 Ignored 绳索"],
                "sources": ["Icy Veins", "Wowhead", "warcraft.wiki.gg"],
            },
        ],
        "achievements": [
            "英雄通关与梵妮莎相关成就（以版本为准）",
            "各 Boss 机制成就（火墙零受伤、胸弹等）",
        ],
        "party_notes": [
            "标准 1T1N3D；死神战指定上机手",
            "英雄尾王前喝水、清 CD",
        ],
    },
    "scarlet_monastery": {
        "cn_name": "血色修道院",
        "en_name": "Scarlet Monastery",
        "tier": "5 人副本群（经典旧世 28–45；墓地/图书馆/军械库/大教堂）",
        "location": "提瑞斯法林地；庭院四个独立入口",
        "theme": (
            "四翼独立五人本，升级向宝地。"
            "图书馆杜安后的箱子开出血色钥匙，用于军械库与大教堂门（盗贼可开锁）。"
            "人形怪残血逃跑，卡视野与控场很重要。"
        ),
        "route": [
            "约 30–32：墓地（审讯员韦沙斯 → 血法师萨尔诺斯；注意稀有）",
            "约 32–35：图书馆（驯犬者洛克希 → 奥法师杜安；拿钥匙）",
            "约 36–38：军械库（赫洛德；死后学徒潮）",
            "约 38–40：大教堂（可选法尔班克斯 → 莫格莱尼 → 怀特迈恩）",
        ],
        "boss_order": [
            "审讯员韦沙斯 / 血法师萨尔诺斯（墓地）",
            "驯犬者洛克希 / 奥法师杜安（图书馆）",
            "赫洛德（军械库）",
            "莫格莱尼 + 怀特迈恩（大教堂）",
        ],
        "bosses": [
            {
                "order": 1,
                "cn": "墓地翼",
                "en": "Graveyard",
                "role": "升级向；幽灵群拉走廊；萨尔诺斯注意火焰新星",
                "phases": ["韦沙斯短战 → 墓地广场 → 萨尔诺斯"],
                "skills": [
                    {"cn": "暗言术：痛", "en": "SW:Pain（韦沙斯）", "cd": "DoT", "note": "可驱散"},
                    {"cn": "火焰新星 / 烈焰尖刺", "en": "萨尔诺斯火焰技能", "cd": "战斗中", "note": "治疗站外围；近战注意新星"},
                ],
                "tips": ["广场僵尸单拉；幽灵可两波；稀有随机刷"],
                "sources": ["Wowcalc", "中文怀旧攻略"],
            },
            {
                "order": 2,
                "cn": "奥法师杜安",
                "en": "Arcanist Doan",
                "role": "图书馆尾；变羊、沉默、半血奥术气泡后自爆",
                "phases": ["常规施法 → 半血气泡（全员远离）→ 自爆后继续"],
                "skills": [
                    {"cn": "变形术", "en": "Polymorph", "cd": "随机", "note": "被羊者附近可能被魔爆波及"},
                    {"cn": "奥术气泡 / 自爆", "en": "Arcane Bubble / Detonate", "cd": "~50%", "note": "气泡出现立刻跑出近战圈"},
                    {"cn": "沉默", "en": "Silence", "cd": "AoE", "note": "治疗预读"},
                ],
                "tips": ["击杀后开身后箱子拿血色钥匙"],
                "sources": ["Wowcalc", "Wowhead"],
            },
            {
                "order": 3,
                "cn": "赫洛德",
                "en": "Herod",
                "role": "军械库；旋风斩远离；死后学徒冲锋",
                "phases": ["单目标战 → 死后学徒潮 AoE"],
                "skills": [
                    {"cn": "旋风斩", "en": "Whirlwind", "cd": "低血/狂暴相关", "note": "近战退出"},
                    {"cn": "冲锋 / 狂暴", "en": "Charge / Enrage", "cd": "战斗中", "note": "T 中央拉住"},
                ],
                "tips": ["学徒潮前留怒气/群攻技能"],
                "sources": ["Wowcalc"],
            },
            {
                "order": 4,
                "cn": "莫格莱尼 + 怀特迈恩",
                "en": "Mograine & Whitemane",
                "role": "大教堂双王：先清礼拜堂全部小怪再开战",
                "phases": [
                    "打莫格莱尼至假死 → 怀特迈恩进场复活他",
                    "优先打断/集火怀特迈恩，再收莫格莱尼",
                ],
                "skills": [
                    {"cn": "复活", "en": "Whitemane Resurrection", "cd": "阶段", "note": "打断怀特迈恩关键技能"},
                    {"cn": "神圣打击等", "en": "Holy abilities", "cd": "战斗中", "note": "双目标治疗压力上升"},
                ],
                "tips": ["开打前必须清光教堂小怪，否则会加入战斗"],
                "sources": ["Wowcalc", "Wowhead"],
            },
        ],
        "achievements": ["经典成就以服务器版本为准"],
        "party_notes": [
            "1T1N3D；控场（羊/陷阱/恐惧）对逃跑人形极有用",
            "先图书馆拿钥匙再打军械库/教堂",
        ],
    },
    "stratholme": {
        "cn_name": "斯坦索姆",
        "en_name": "Stratholme",
        "tier": "5 人副本（经典旧世 55–60；血色侧 / 亡灵侧）",
        "location": "东瘟疫之地；正门进血色区，侧门（城市大门钥匙）进亡灵区",
        "theme": (
            "燃烧的城市，血色十字军与天灾对峙。"
            "血色线止于巴纳扎尔；亡灵线清三通灵塔后开屠宰场打到瑞文戴尔。"
            "可选限时营救男爵（邮差/精英路线）。"
        ),
        "route": [
            "血色侧（正门）：不可宽恕者 → 悲惨的提米 → 炮手威利（用炮）→ 加尔福特 → 巴纳扎尔",
            "亡灵侧：清三座通灵塔（杀塔内侍僧才算）→ 安娜丝塔丽 / 奈鲁布恩坎 等 → 屠宰场 → 拉姆斯登 → 瑞文戴尔",
            "巴瑟拉斯镇长掉落城市大门钥匙（开侧门）",
        ],
        "boss_order": [
            "不可宽恕者 / 悲惨的提米 / 炮手威利 / 档案管理员加尔福特 / 巴纳扎尔（血色）",
            "通灵塔首领们 / 拉姆斯登 / 瑞文戴尔男爵（亡灵）",
        ],
        "bosses": [
            {
                "order": 1,
                "cn": "炮手威利",
                "en": "Cannon Master Willey",
                "role": "血色线；安排一人开炮打火枪手增援",
                "phases": ["单阶段 + 增援波"],
                "skills": [
                    {"cn": "召唤火枪手", "en": "Summon Riflemen", "cd": "战斗中", "note": "用房间大炮清理"},
                    {"cn": "击退", "en": "Knockback", "cd": "战斗中", "note": "注意站位别撞增援"},
                ],
                "tips": ["开炮手与 T 沟通节奏"],
                "sources": ["Wowcalc", "Wowhead"],
            },
            {
                "order": 2,
                "cn": "巴纳扎尔",
                "en": "Balnazzar",
                "role": "血色线尾；达索汉变身恶魔",
                "phases": ["人形过渡 → 恶魔形态"],
                "skills": [
                    {"cn": "支配 / 恐惧类", "en": "Mind Control / Fear", "cd": "战斗中", "note": "驱散魔法；控被支配队友"},
                ],
                "tips": ["提前清王座区小怪"],
                "sources": ["Wowcalc"],
            },
            {
                "order": 3,
                "cn": "通灵塔与屠宰场",
                "en": "Ziggurats & Slaughterhouse",
                "role": "亡灵线开门条件：三塔侍僧都要清",
                "phases": ["逐塔击杀 → 开门 → 屠宰场序列"],
                "skills": [
                    {"cn": "塔内侍僧", "en": "Acolytes", "cd": "结构", "note": "只杀 Boss 不开门"},
                ],
                "tips": ["勿随便开补给箱（疾病/害虫）；石像鬼逃跑会 ADD"],
                "sources": ["Wowcalc"],
            },
            {
                "order": 4,
                "cn": "瑞文戴尔男爵",
                "en": "Baron Rivendare",
                "role": "亡灵线尾王；限时营救则需更快路线",
                "phases": ["单阶段高强度物理 + 召唤"],
                "skills": [
                    {"cn": "暗影打击 / 召唤", "en": "Shadow Strike / Adds", "cd": "战斗中", "note": "T 背对队伍；处理骷髅"},
                ],
                "tips": ["限时营救前规划路线，少绕路"],
                "sources": ["Wowhead", "Wowcalc"],
            },
        ],
        "achievements": ["经典声望：银色黎明；限时男爵相关"],
        "party_notes": [
            "出发前约定打血色还是亡灵或双开",
            "带驱散（魔法/疾病）与强力 AoE",
        ],
    },
    "zulgurub": {
        "cn_name": "祖尔格拉布",
        "en_name": "Zul'Gurub",
        "tier": "5 人英雄副本（大灾变翻新；仅英雄 85）",
        "location": "北荆棘谷东部；由原 20 人团本改为 5 人英雄本",
        "theme": (
            "巨魔神殿开放世界式路线，可多线。"
            "主线：温诺希斯 → 曼多基尔 → 基尔娜拉 → 赞吉尔 → 碎神者金度。"
            "考古可开疯狂宝箱（四王随机其一）。"
        ),
        "route": [
            "入口过桥 → 1 号高阶祭司温诺希斯",
            "竞技场 → 2 号血领主曼多基尔（斩首 + 奥根抢灵魂）",
            "可选：考古开疯狂宝箱（哈扎拉尔/雷纳塔基/乌苏雷/格里雷克）",
            "豹神殿地窖 → 3 号高阶祭司基尔娜拉（先清豹再过 50%）",
            "赞吉尔区域用大锅增益应对药剂 → 4 号赞吉尔",
            "尾王平台 → 5 号碎神者金度（破脆障）",
        ],
        "boss_order": [
            "高阶祭司温诺希斯 (High Priest Venoxis)",
            "血领主曼多基尔 (Bloodlord Mandokir)",
            "疯狂宝箱四选一（可选）",
            "高阶祭司基尔娜拉 (High Priestess Kilnara)",
            "赞吉尔 (Zanzil)",
            "碎神者金度 (Jin'do the Godbreaker)",
        ],
        "bosses": [
            {
                "order": 1,
                "cn": "高阶祭司温诺希斯",
                "en": "High Priest Venoxis",
                "role": "打断低语；毒链接散开；蛇神形态躲毒池与吐息",
                "phases": [
                    "人形：打断赫希斯低语；毒链接两人迅速拉开",
                    "蛇神祝福：躲毒液迷宫/酸泪池；吐息转到背后",
                    "回坛放毒云后血毒触须；撤退期 100% 易伤爆发",
                ],
                "skills": [
                    {"cn": "赫希斯低语", "en": "Whispers of Hethiss", "cd": "高频", "note": "必须打断"},
                    {"cn": "毒性链接", "en": "Toxic Link", "cd": "点两人", "note": "立刻散开扯断"},
                    {"cn": "血毒", "en": "Bloodvenom", "cd": "回坛后", "note": "风筝触须"},
                    {"cn": "毒液戒断", "en": "Venom Withdrawal", "cd": "易伤窗", "note": "全力爆发"},
                ],
                "tips": ["开场靠后站堆，给毒池留空间"],
                "sources": ["Icy Veins", "Wowhead"],
            },
            {
                "order": 2,
                "cn": "血领主曼多基尔",
                "en": "Bloodlord Mandokir",
                "role": "斩首会死；灵魂复活次数有限；必杀奥根保灵魂",
                "phases": [
                    "斩首点杀随机玩家 → 灵魂链复活（仅 8 次）",
                    "奥根下场后会杀灵魂，必须优先击杀；曼多基尔会复活奥根",
                ],
                "skills": [
                    {"cn": "斩首", "en": "Decapitate", "cd": "周期", "note": "秒杀；叠 Level Up 增伤"},
                    {"cn": "毁灭猛击", "en": "Devastating Slam", "cd": "地面指示", "note": "躲开冲击波"},
                    {"cn": "放血", "en": "Bloodletting", "cd": "点名", "note": "Debuff 期间少奶，落地后再抬"},
                    {"cn": "复活奥根", "en": "Reanimate Ohgan", "cd": "周期", "note": "再次集火狗"},
                ],
                "tips": ["输出永远优先奥根；拖太久灵魂耗尽必灭"],
                "sources": ["Icy Veins"],
            },
            {
                "order": 3,
                "cn": "高阶祭司基尔娜拉",
                "en": "High Priestess Kilnara",
                "role": "50% 前清光房间豹群，否则狂暴难打",
                "phases": [
                    "拉怪前/战中清理地下室豹包",
                    "半血后变形压力上升，需豹已清完",
                ],
                "skills": [
                    {"cn": "豹群", "en": "Panther packs", "cd": "房间机制", "note": "逐包清，勿一次全拉"},
                    {"cn": "半血变身", "en": "50% transform", "cd": "阶段", "note": "未清豹极易灭团"},
                ],
                "tips": ["进房间先清场再开 Boss"],
                "sources": ["Icy Veins", "Wowhead"],
            },
            {
                "order": 4,
                "cn": "赞吉尔",
                "en": "Zanzil",
                "role": "大锅提供抗性/解毒类增益；按药剂类型应对",
                "phases": ["单一多药剂循环"],
                "skills": [
                    {"cn": "药剂 / 大锅", "en": "Elixirs / Cauldrons", "cd": "机制", "note": "先喝对的大锅再解机制"},
                ],
                "tips": ["开打前认准三口锅位置"],
                "sources": ["Icy Veins"],
            },
            {
                "order": 5,
                "cn": "碎神者金度",
                "en": "Jin'do the Godbreaker",
                "role": "打破三层脆障（蛮力撞/裂隙等）才能稳定输出本体",
                "phases": [
                    "灵界/障碍阶段：按指示破坏 Brittle Barrier",
                    "障碍破碎后集火金度",
                ],
                "skills": [
                    {"cn": "脆弱屏障", "en": "Brittle Barrier", "cd": "三层", "note": "用场景技能/裂隙砸破"},
                    {"cn": "躯体猛击 / 裂隙", "en": "Body Slam / Sunder Rift", "cd": "破障手段", "note": "听指挥站位"},
                ],
                "tips": ["尾王教学成本高，第一次慢慢打障碍"],
                "sources": ["Icy Veins", "Wowhead"],
            },
        ],
        "achievements": [
            "英雄通关与各 Boss 机制成就",
            "疯狂宝箱相关成就（需考古）",
        ],
        "party_notes": [
            "仅英雄；装备与熟练度要求高于死矿/影牙",
            "曼多基尔与金度最吃配合",
        ],
    },
}


def http_get(url, timeout=25):
    req = Request(url, headers={"User-Agent": USER_AGENT, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"})
    with urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
        charset = "utf-8"
        try:
            ctype = resp.headers.get_content_charset()  # type: ignore
            if ctype:
                charset = ctype
        except Exception:
            pass
        return raw.decode(charset, errors="replace")


def strip_html(html):
    html = re.sub(r"(?is)<script[^>]*>.*?</script>", " ", html)
    html = re.sub(r"(?is)<style[^>]*>.*?</style>", " ", html)
    html = re.sub(r"(?is)<!--.*?-->", " ", html)
    html = re.sub(r"(?is)<br\s*/?>", "\n", html)
    html = re.sub(r"(?is)</p>", "\n\n", html)
    html = re.sub(r"(?is)</h[1-6]>", "\n\n", html)
    html = re.sub(r"(?is)<[^>]+>", " ", html)
    text = unescape(html)
    text = text.replace("\xa0", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def ddg_search(query, max_results=8):
    """DuckDuckGo HTML 轻量搜索，返回 URL 列表。"""
    url = "https://html.duckduckgo.com/html/?q=" + quote_plus(query)
    try:
        html = http_get(url, timeout=20)
    except Exception as e:
        print("[warn] DDG search failed: %s" % e, file=sys.stderr)
        return []
    urls = []
    for m in re.finditer(r'uddg=([^&"]+)', html):
        try:
            from urllib.parse import unquote

            u = unquote(m.group(1))
        except Exception:
            u = m.group(1)
        if u.startswith("http") and u not in urls:
            urls.append(u)
        if len(urls) >= max_results:
            break
    if not urls:
        for m in re.finditer(r'href="(https?://[^"]+)"', html):
            u = m.group(1)
            if "duckduckgo" in u or "google." in u:
                continue
            if u not in urls:
                urls.append(u)
            if len(urls) >= max_results:
                break
    return urls


def extract_relevant_snippets(text, keywords, window=420, max_snips=12):
    low = text.lower()
    hits = []
    seen = set()
    for kw in keywords:
        start = 0
        kl = kw.lower()
        while True:
            idx = low.find(kl, start)
            if idx < 0:
                break
            a = max(0, idx - window // 4)
            b = min(len(text), idx + window)
            snip = re.sub(r"\s+", " ", text[a:b]).strip()
            key = snip[:80]
            if key not in seen and len(snip) > 40:
                seen.add(key)
                hits.append(snip)
            start = idx + len(kl)
            if len(hits) >= max_snips:
                return hits
    return hits


def resolve_dungeon_key(name):
    key = DUNGEON_ALIASES.get(name.strip().lower()) or DUNGEON_ALIASES.get(name.strip())
    if key:
        return key
    # fuzzy
    n = name.strip().lower()
    for alias, k in DUNGEON_ALIASES.items():
        if alias in n or n in alias:
            return k
    return None


def read_local_boss_notes(dungeon_key):
    """从本仓库 bosses 目录抽取技能名/CD/描述，供合并进介绍。"""
    folder_map = {
        "shadowfang_keep": os.path.join(ROOT, "DEV", "packages", "engine", "src", "bosses", "shadowfang"),
        "dragon_soul": os.path.join(ROOT, "DEV", "packages", "engine", "src", "bosses", "dragonsoul"),
    }
    folder = folder_map.get(dungeon_key)
    if not folder or not os.path.isdir(folder):
        return []
    notes = []
    for fn in sorted(os.listdir(folder)):
        if not fn.endswith(".ts") or fn == "index.ts":
            continue
        path = os.path.join(folder, fn)
        try:
            with open(path, "r", encoding="utf-8") as f:
                src = f.read()
        except Exception:
            continue
        m_name = re.search(r"name:\s*'([^']+)'", src)
        boss_name = m_name.group(1) if m_name else fn
        skills = []
        for block in re.finditer(
            r"name:\s*'([^']+)'[\s\S]*?castTimeMs:\s*(\d+)[\s\S]*?cooldownMs:\s*(\d+)[\s\S]*?description:\s*'([^']*)'",
            src,
        ):
            skills.append(
                {
                    "name": block.group(1),
                    "cast_ms": int(block.group(2)),
                    "cd_ms": int(block.group(3)),
                    "desc": block.group(4),
                }
            )
        notes.append({"file": fn, "boss": boss_name, "skills": skills})
    return notes


def fetch_sources(dungeon_key, max_extra=6):
    urls = list(SEED_URLS.get(dungeon_key, []))
    for q in SEARCH_QUERIES.get(dungeon_key, []):
        print("[search] %s" % q)
        for u in ddg_search(q, max_results=5):
            if u not in urls:
                urls.append(u)
        time.sleep(0.4)
    # 过滤明显无关
    filtered = []
    for u in urls:
        host = urlparse(u).netloc.lower()
        if any(x in host for x in ("youtube.com", "twitter.com", "facebook.com", "reddit.com")):
            continue
        filtered.append(u)
    urls = filtered[: len(SEED_URLS.get(dungeon_key, [])) + max_extra]

    pages = []
    for u in urls:
        print("[fetch] %s" % u)
        try:
            html = http_get(u)
            text = strip_html(html)
            pages.append({"url": u, "text": text, "chars": len(text)})
            print("  -> %d chars" % len(text))
        except Exception as e:
            print("  -> FAIL: %s" % e, file=sys.stderr)
        time.sleep(0.35)
    return pages


def render_markdown(dungeon_key, pages, local_notes):
    curated = CURATED.get(dungeon_key)
    if not curated:
        return render_generic(dungeon_key, pages, local_notes)

    lines = []
    lines.append("# 副本介绍：%s（%s）" % (curated["cn_name"], curated["en_name"]))
    lines.append("")
    lines.append("> 本文由开发工具 `tools/dungeon_guide_research.py` 合并多站攻略与本地引擎备注生成。")
    lines.append("> 生成时间：%s" % datetime.now().strftime("%Y-%m-%d %H:%M"))
    lines.append("")
    lines.append("## 1. 概览")
    lines.append("")
    lines.append("- **类型**：%s" % curated["tier"])
    lines.append("- **位置**：%s" % curated["location"])
    lines.append("- **主题**：%s" % curated["theme"])
    lines.append("- **Boss 顺序**：")
    for i, b in enumerate(curated["boss_order"], 1):
        lines.append("  %d. %s" % (i, b))
    lines.append("")
    lines.append("## 2. 副本流程环节")
    lines.append("")
    for i, step in enumerate(curated["route"], 1):
        lines.append("%d. %s" % (i, step))
    lines.append("")
    lines.append("## 3. 各 Boss 机制详解（合并多站）")
    lines.append("")

    boss_keywords = {
        1: ["Ashbury", "亚什布里", "艾胥柏利", "灰葬", "Asphyxiate", "Stay of Execution", "Calamity", "窒息", "暂缓"],
        2: ["Silverlaine", "席瓦莱恩", "Worgen", "Veil of Shadow", "狼人之灵", "阴影面纱"],
        3: ["Springvale", "斯普林瓦尔", "Desecration", "Perfidious", "Unholy", "亵渎", "背信", "羞愧"],
        4: ["Walden", "沃登", "瓦尔登", "Mixture", "Toxin", "Ice Shards", "绿", "红", "毒素"],
        5: ["Godfrey", "高弗雷", "高佛雷", "Pistol Barrage", "Cursed Bullets", "弹幕", "诅咒之弹"],
    }

    for boss in curated["bosses"]:
        lines.append("### %d. %s（%s）" % (boss["order"], boss["cn"], boss["en"]))
        lines.append("")
        lines.append("**定位**：%s" % boss["role"])
        lines.append("")
        lines.append("#### 阶段")
        for p in boss["phases"]:
            lines.append("- %s" % p)
        lines.append("")
        lines.append("#### 技能 / CD / 要点")
        lines.append("")
        lines.append("| 技能 | 英文 | CD/节奏 | 机制与注意 |")
        lines.append("| --- | --- | --- | --- |")
        for sk in boss["skills"]:
            lines.append(
                "| %s | %s | %s | %s |"
                % (sk["cn"], sk["en"], sk["cd"].replace("|", "/"), sk["note"].replace("|", "/"))
            )
        lines.append("")
        lines.append("#### 注意事项")
        for t in boss["tips"]:
            lines.append("- %s" % t)
        lines.append("")
        lines.append("#### 参考来源标签")
        lines.append("- " + "、".join(boss["sources"]))
        lines.append("")

        # 附加抓取摘录
        kws = boss_keywords.get(boss["order"], [boss["en"], boss["cn"]])
        snips = []
        for page in pages:
            snips.extend(extract_relevant_snippets(page["text"], kws, max_snips=3))
        if snips:
            lines.append("<details><summary>多站原文摘录（自动截取，供核对）</summary>")
            lines.append("")
            for i, s in enumerate(snips[:8], 1):
                lines.append("%d. %s" % (i, s))
                lines.append("")
            lines.append("</details>")
            lines.append("")

    lines.append("## 4. 团队通用注意")
    lines.append("")
    for n in curated["party_notes"]:
        lines.append("- %s" % n)
    lines.append("")
    lines.append("## 5. 相关成就")
    lines.append("")
    for a in curated["achievements"]:
        lines.append("- %s" % a)
    lines.append("")

    if local_notes:
        lines.append("## 6. 本地模拟器技能 CD 备注（仓库 bosses）")
        lines.append("")
        for bn in local_notes:
            lines.append("### %s（%s）" % (bn["boss"], bn["file"]))
            if not bn["skills"]:
                lines.append("- （未解析到技能块）")
            for sk in bn["skills"]:
                lines.append(
                    "- **%s**：读条 %dms / CD %dms — %s"
                    % (sk["name"], sk["cast_ms"], sk["cd_ms"], sk["desc"])
                )
            lines.append("")

    lines.append("## 7. 本次抓取来源 URL")
    lines.append("")
    if not pages:
        lines.append("- （未抓取或全部失败；以上正文主要来自内置多站合并稿）")
    for p in pages:
        lines.append("- %s （%d 字符）" % (p["url"], p["chars"]))
    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append(
        "说明：不同站点对血线百分比、伤害数字、召唤时机可能略有出入；"
        "以实际战斗读条与团队通关经验校准。本工具目标是为模拟器/文案提供详尽「副本介绍」底稿。"
    )
    lines.append("")
    return "\n".join(lines)


def render_generic(dungeon_key, pages, local_notes):
    lines = []
    lines.append("# 副本介绍：%s" % dungeon_key)
    lines.append("")
    lines.append("> 尚无内置合并骨架，以下为多站抓取原文去 HTML 后的拼接摘要。")
    lines.append("> 生成时间：%s" % datetime.now().strftime("%Y-%m-%d %H:%M"))
    lines.append("")
    for i, p in enumerate(pages, 1):
        lines.append("## 来源 %d：%s" % (i, p["url"]))
        lines.append("")
        body = p["text"][:8000]
        lines.append(body)
        lines.append("")
        lines.append("---")
        lines.append("")
    if local_notes:
        lines.append("## 本地引擎备注")
        lines.append(json.dumps(local_notes, ensure_ascii=False, indent=2))
    return "\n".join(lines)


def main(argv=None):
    # Windows 控制台：尽量用 UTF-8，避免搜索词/路径乱码
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8")
            sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

    parser = argparse.ArgumentParser(description="多站合并副本攻略 → 副本介绍 Markdown")
    parser.add_argument("name", help='副本名，如「影牙城堡」或 "Shadowfang Keep"')
    parser.add_argument("--out", default=DEFAULT_OUT_DIR, help="输出目录")
    parser.add_argument("--no-fetch", action="store_true", help="不联网，仅用内置合并稿+本地备注")
    parser.add_argument("--max-extra", type=int, default=6, help="搜索补充 URL 上限")
    args = parser.parse_args(argv)

    key = resolve_dungeon_key(args.name)
    if not key:
        print("未识别副本：「%s」。已知：%s" % (args.name, ", ".join(sorted(set(DUNGEON_ALIASES.values())))), file=sys.stderr)
        print("可将别名与 SEED_URLS 加入本脚本后重试。", file=sys.stderr)
        return 2

    print("[info] dungeon key = %s" % key)
    local_notes = read_local_boss_notes(key)
    pages = []
    if not args.no_fetch:
        pages = fetch_sources(key, max_extra=args.max_extra)
    else:
        print("[info] --no-fetch：跳过联网")

    md = render_markdown(key, pages, local_notes)
    out_dir = os.path.abspath(args.out)
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "%s_副本介绍.md" % key)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(md)
    print("[ok] wrote %s (%d chars)" % (out_path, len(md)))
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
