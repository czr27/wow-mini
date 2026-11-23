# -*- coding: utf-8 -*-
"""
审计缺图标技能，并用 wowhead_icon_dl 按优先级补齐（默认：德鲁伊→萨满→DK）。

用法:
  python tools/fill_missing_icons.py
  python tools/fill_missing_icons.py --classes DRUID SHAMAN DK
  python tools/fill_missing_icons.py --dry-run
"""
from __future__ import print_function, unicode_literals

import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from wowhead_icon_dl import (  # noqa: E402
    CN_TO_SPELL_ID,
    default_out_dir,
    make_session,
    process_one,
)

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SLOTS = os.path.join(
    ROOT, "DEV", "packages", "web", "src", "assets", "defaultActionSlots.ts"
)
RES = os.path.join(ROOT, "ART", "resources")

# classId in defaultActionSlots.ts -> 显示名
CLASS_META = {
    "DK": ("死亡骑士", 2),
    "DRUID": ("德鲁伊", 0),
    "SHAMAN": ("萨满", 1),
    "MAGE": ("法师", 3),
    "ROGUE": ("潜行者", 4),
    "PRIEST": ("牧师", 5),
    "PALADIN": ("圣骑士", 6),
    "WARRIOR": ("战士", 7),
    "HUNTER": ("猎人", 8),
    "WARLOCK": ("术士", 9),
}

DEFAULT_PRIORITY = ["DRUID", "SHAMAN", "DK"]

# ClassRegistry 自动布局职业：技能不在 defaultActionSlots 硬编码，需从 TS 解析
REGISTRY_CLASS_FILES = {
    "WARRIOR": "Warrior.ts",
    "HUNTER": "Hunter.ts",
    "PRIEST": "Priest.ts",
    "WARLOCK": "Warlock.ts",
    "PALADIN": "Paladin.ts",
}
CLASS_SPELL_PREFIX = {
    "WARRIOR": "warrior_",
    "HUNTER": "hunter_",
    "PRIEST": "priest_",
    "WARLOCK": "warlock_",
    "PALADIN": "paladin_",
}
ENGINE_CLASS_DIR = os.path.join(
    ROOT, "DEV", "packages", "engine", "src", "classes"
)

# Cata / Classic 常用 Wowhead spell id（有则跳过搜索，直接 tooltip）
WOWHEAD_SPELL_IDS = {
    # Druid
    "berserk": 50334,
    "ferocious_bite": 22568,
    "hurricane": 16914,
    "mark_of_the_wild": 1126,
    "rake": 1822,
    "rip": 1079,
    "shred": 5221,
    "skull_bash": 80965,
    "starfall": 48505,
    "swipe": 779,
    # Shaman
    "feral_spirit": 51533,
    "fire_nova": 1535,
    "greater_healing_wave": 77472,
    "lava_lash": 60103,
    "shamanistic_rage": 30823,
    "stormstrike": 17364,
    "thunderstorm": 51490,
    "unleash_elements": 73680,
    "unleash_life": 73685,
    # DK
    "howling_blast": 49184,
    "frost_strike": 49143,
    "obliterate": 49020,
    "pillar_of_frost": 51271,
    "mind_freeze": 47528,
    "horn_of_winter": 57330,
    "death_and_decay": 43265,
    "blood_boil": 48721,
    "dark_command": 56222,
    "death_strike": 49998,
    "icebound_fortitude": 48792,
    "anti_magic_shell": 48707,
    "scourge_strike": 55090,
    "festering_strike": 85948,
    "death_coil": 47541,
    "summon_gargoyle": 49206,
    "heart_strike": 55050,
    "rune_strike": 56815,
    "bone_shield": 49222,
    "vampiric_blood": 55233,
    # Mage
    "arcane_barrage": 44425,
    "arcane_blast": 30451,
    "arcane_brilliance": 1459,
    "arcane_explosion": 1449,
    "arcane_missiles": 5143,
    "arcane_power": 12042,
    "blizzard": 10,
    "combustion": 11129,
    "counterspell": 2139,
    "deep_freeze": 44572,
    "evocation": 12051,
    "fireball": 133,
    "flamestorm": 2120,
    "frostbolt": 116,
    "frozen_orb": 84714,
    "ice_barrier": 11426,
    "ice_block": 45438,
    "ice_lance": 30455,
    "living_bomb": 44457,
    "pyroblast": 11366,
    "remove_curse": 475,
    "time_warp": 80353,
    # Rogue
    "adrenaline_rush": 13750,
    "backstab": 53,
    "envenom": 32645,
    "evasion": 5277,
    "eviscerate": 2098,
    "fan_of_knives": 51723,
    "feint": 1966,
    "hemorrhage": 16511,
    "kick": 1766,
    "mutilate": 1329,
    "rupture": 1943,
    "shadow_dance": 51713,
    "sinister_strike": 1752,
    "slice_and_dice": 5171,
    "vendetta": 79140,
    # Warrior
    "shield_slam": 23922,
    "revenge": 6572,
    "devastate": 20243,
    "thunder_clap": 6343,
    "shockwave": 46968,
    "taunt": 355,
    "shield_wall": 871,
    "last_stand": 12975,
    "pummel": 6552,
    "battle_shout": 6673,
    "mortal_strike": 12294,
    "colossus_smash": 86346,
    "overpower": 7384,
    "slam": 1464,
    "execute": 5308,
    "bladestorm": 46924,
    "whirlwind": 1680,
    "bloodthirst": 23881,
    "raging_blow": 85288,
    "berserker_rage": 18499,
    # Hunter
    "kill_command": 34026,
    "cobra_shot": 77767,
    "arcane_shot": 3044,
    "serpent_sting": 1978,
    "multi_shot": 2643,
    "explosive_trap": 13813,
    "bestial_wrath": 19574,
    "silencing_shot": 34490,
    "chimera_shot": 53209,
    "aimed_shot": 19434,
    "steady_shot": 56641,
    "kill_shot": 53351,
    "rapid_fire": 3045,
    "explosive_shot": 53301,
    "black_arrow": 3674,
    "deterrence": 19263,
    # Priest
    "power_word_shield": 17,
    "penance": 47540,
    "flash_heal": 2061,
    "heal": 2050,
    "greater_heal": 2060,
    "prayer_of_healing": 596,
    "prayer_of_mending": 33076,
    "power_word_barrier": 62618,
    "pain_suppression": 33206,
    "shadowfiend": 34433,
    "purify": 527,
    "resurrection": 2006,
    "circle_of_healing": 34861,
    "divine_hymn": 64843,
    "guardian_spirit": 47788,
    "shadow_word_pain": 589,
    "vampiric_touch": 34914,
    "mind_blast": 8092,
    "mind_flay": 15407,
    "mind_sear": 48045,
    "shadow_word_death": 32379,
    "dispersion": 47585,
    "silence": 15487,
    "power_word_fortitude": 21562,
    # Warlock
    "corruption": 172,
    "bane_of_agony": 980,
    "unstable_affliction": 30108,
    "haunt": 48181,
    "shadow_bolt": 686,
    "drain_soul": 1120,
    "seed_of_corruption": 27243,
    "life_tap": 1454,
    "fel_hunter_spell_lock": 19647,
    "soulstone": 20707,
    "metamorphosis": 47241,
    "hand_of_guldan": 71521,
    "immolation_aura": 50589,
    "immolation": 348,
    "incinerate": 29722,
    "chaos_bolt": 50796,
    "conflagrate": 17962,
    "shadowburn": 17877,
    "rain_of_fire": 5740,
    # Paladin
    "holy_shock": 20473,
    "flash_of_light": 19750,
    "holy_light": 635,
    "divine_light": 82326,
    "word_of_glory": 85673,
    "light_of_dawn": 85222,
    "holy_radiance": 82327,
    "beacon_of_light": 53563,
    "divine_plea": 54428,
    "cleanse": 4987,
    "avenging_wrath": 31884,
    "redemption": 7328,
    "shield_of_the_righteous": 53600,
    "avengers_shield": 31935,
    "hammer_of_the_righteous": 53595,
    "consecration": 26573,
    "judgement": 20271,
    "hand_of_reckoning": 62124,
    "rebuke": 96231,
    "divine_protection": 498,
    "ardent_defender": 31850,
    "divine_shield": 642,
    "crusader_strike": 35395,
    "templars_verdict": 85256,
    "divine_storm": 53385,
    "blessing_of_kings": 20217,
}

# 补充中文映射（写入本脚本运行时的 CN_TO_SPELL_ID）
EXTRA_CN = {
    # Druid
    "狂暴": "berserk",
    "凶猛撕咬": "ferocious_bite",
    "飓风": "hurricane",
    "野性印记": "mark_of_the_wild",
    "斜掠": "rake",
    "割裂": "rip",
    "撕碎": "shred",
    "迎头痛击": "skull_bash",
    "星辰坠落": "starfall",
    "横扫": "swipe",
    # Shaman
    "野性狼魂": "feral_spirit",
    "火焰新星": "fire_nova",
    "强效治疗波": "greater_healing_wave",
    "熔岩猛击": "lava_lash",
    "萨满之怒": "shamanistic_rage",
    "风暴打击": "stormstrike",
    "雷霆风暴": "thunderstorm",
    "元素释放": "unleash_elements",
    "生命释放": "unleash_life",
    # DK
    "凛风冲击": "howling_blast",
    "冰霜打击": "frost_strike",
    "湮灭": "obliterate",
    "冰霜之柱": "pillar_of_frost",
    "心灵冰冻": "mind_freeze",
    "寒冬号角": "horn_of_winter",
    "枯萎凋零": "death_and_decay",
    "血液沸腾": "blood_boil",
    "黑暗命令": "dark_command",
    "灵界打击": "death_strike",
    "冰封之韧": "icebound_fortitude",
    "反魔法护罩": "anti_magic_shell",
    "天灾打击": "scourge_strike",
    "脓疮打击": "festering_strike",
    "凋零缠绕": "death_coil",
    "召唤石像鬼": "summon_gargoyle",
    "心脏打击": "heart_strike",
    "符文打击": "rune_strike",
    "白骨之盾": "bone_shield",
    "吸血鬼之血": "vampiric_blood",
    # Mage
    "奥术弹幕": "arcane_barrage",
    "奥术冲击": "arcane_blast",
    "奥术光辉": "arcane_brilliance",
    "魔爆术": "arcane_explosion",
    "奥术飞弹": "arcane_missiles",
    "奥术强化": "arcane_power",
    "暴风雪": "blizzard",
    "燃烧": "combustion",
    "法术反制": "counterspell",
    "深度冻结": "deep_freeze",
    "唤醒": "evocation",
    "火球术": "fireball",
    "烈焰风暴": "flamestorm",
    "寒冰箭": "frostbolt",
    "寒冰宝珠": "frozen_orb",
    "寒冰护体": "ice_barrier",
    "寒冰屏障": "ice_block",
    "冰枪术": "ice_lance",
    "活动炸弹": "living_bomb",
    "炎爆术": "pyroblast",
    "解除诅咒": "remove_curse",
    "时间扭曲": "time_warp",
    # Rogue
    "冲动": "adrenaline_rush",
    "背刺": "backstab",
    "毒化": "envenom",
    "闪避": "evasion",
    "刺骨": "eviscerate",
    "刀扇": "fan_of_knives",
    "佯攻": "feint",
    "出血": "hemorrhage",
    "脚踢": "kick",
    "毁伤": "mutilate",
    "割裂": "rupture",
    "暗影之舞": "shadow_dance",
    "影袭": "sinister_strike",
    "切割": "slice_and_dice",
    "宿敌": "vendetta",
    # Warrior
    "盾牌猛击": "shield_slam",
    "复仇": "revenge",
    "毁灭打击": "devastate",
    "雷霆一击": "thunder_clap",
    "震荡波": "shockwave",
    "嘲讽": "taunt",
    "盾墙": "shield_wall",
    "破釜沉舟": "last_stand",
    "拳击": "pummel",
    "战斗怒吼": "battle_shout",
    "致死打击": "mortal_strike",
    "巨人打击": "colossus_smash",
    "压制": "overpower",
    "猛击": "slam",
    "斩杀": "execute",
    "剑刃风暴": "bladestorm",
    "旋风斩": "whirlwind",
    "嗜血": "bloodthirst",
    "怒击": "raging_blow",
    "狂暴之怒": "berserker_rage",
    # Hunter
    "杀戮命令": "kill_command",
    "眼镜蛇射击": "cobra_shot",
    "奥术射击": "arcane_shot",
    "毒蛇钉刺": "serpent_sting",
    "多重射击": "multi_shot",
    "爆炸陷阱": "explosive_trap",
    "狂野怒火": "bestial_wrath",
    "沉默射击": "silencing_shot",
    "奇美拉射击": "chimera_shot",
    "瞄准射击": "aimed_shot",
    "稳固射击": "steady_shot",
    "杀戮射击": "kill_shot",
    "急速射击": "rapid_fire",
    "爆炸射击": "explosive_shot",
    "黑箭": "black_arrow",
    "威慑": "deterrence",
    # Priest
    "真言术：盾": "power_word_shield",
    "苦修": "penance",
    "快速治疗": "flash_heal",
    "治疗术": "heal",
    "强效治疗术": "greater_heal",
    "治疗祷言": "prayer_of_healing",
    "愈合祷言": "prayer_of_mending",
    "真言术：障": "power_word_barrier",
    "痛苦压制": "pain_suppression",
    "暗影魔": "shadowfiend",
    "纯净术": "purify",
    "复活术": "resurrection",
    "治疗之环": "circle_of_healing",
    "神圣赞美诗": "divine_hymn",
    "守护之魂": "guardian_spirit",
    "暗言术：痛": "shadow_word_pain",
    "吸血鬼之触": "vampiric_touch",
    "心灵震爆": "mind_blast",
    "精神鞭笞": "mind_flay",
    "精神灼烧": "mind_sear",
    "暗言术：灭": "shadow_word_death",
    "消散": "dispersion",
    "沉默": "silence",
    "真言术：韧": "power_word_fortitude",
    # Warlock
    "腐蚀术": "corruption",
    "痛苦诅咒": "bane_of_agony",
    "痛苦无常": "unstable_affliction",
    "鬼影缠身": "haunt",
    "暗影箭": "shadow_bolt",
    "吸取灵魂": "drain_soul",
    "腐蚀之种": "seed_of_corruption",
    "生命分流": "life_tap",
    "法术封锁": "fel_hunter_spell_lock",
    "灵魂石": "soulstone",
    "恶魔变形": "metamorphosis",
    "古尔丹之手": "hand_of_guldan",
    "献祭光环": "immolation_aura",
    "献祭": "immolation",
    "烧尽": "incinerate",
    "混乱之箭": "chaos_bolt",
    "燃烧": "conflagrate",
    "暗影灼烧": "shadowburn",
    "火焰之雨": "rain_of_fire",
    # Paladin
    "神圣震击": "holy_shock",
    "圣光闪现": "flash_of_light",
    "圣光术": "holy_light",
    "神圣之光": "divine_light",
    "荣耀圣令": "word_of_glory",
    "黎明圣光": "light_of_dawn",
    "圣光普照": "holy_radiance",
    "圣光道标": "beacon_of_light",
    "神圣恳求": "divine_plea",
    "清洁术": "cleanse",
    "复仇之怒": "avenging_wrath",
    "救赎": "redemption",
    "正义盾击": "shield_of_the_righteous",
    "复仇者之盾": "avengers_shield",
    "正义之锤": "hammer_of_the_righteous",
    "奉献": "consecration",
    "审判": "judgement",
    "清算之手": "hand_of_reckoning",
    "责难": "rebuke",
    "圣佑术": "divine_protection",
    "炽热防御者": "ardent_defender",
    "圣盾术": "divine_shield",
    "十字军打击": "crusader_strike",
    "圣殿骑士的裁决": "templars_verdict",
    "神圣风暴": "divine_storm",
    "王者祝福": "blessing_of_kings",
}


def normalize(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def list_art_bases():
    bases = set()
    if not os.path.isdir(RES):
        return bases
    for name in os.listdir(RES):
        path = os.path.join(RES, name)
        if os.path.isdir(path):
            try:
                for sub in os.listdir(path):
                    if "." in sub and not sub.startswith("."):
                        bases.add(normalize(sub.rsplit(".", 1)[0]))
            except Exception:
                pass
            continue
        if name.startswith(".") or name == "manifest.json":
            continue
        if "." in name:
            bases.add(normalize(name.rsplit(".", 1)[0]))
    return bases


def parse_registry_class_spells(class_id):
    """Parse shortId -> cnName from engine ClassDef TS (auto-layout classes)."""
    fname = REGISTRY_CLASS_FILES.get(class_id)
    if not fname:
        return {}
    path = os.path.join(ENGINE_CLASS_DIR, fname)
    if not os.path.isfile(path):
        return {}
    text = open(path, "r", encoding="utf-8").read()
    pat = re.compile(r"id:\s*'([a-z0-9_]+)'\s*,\s*\n\s*name:\s*'([^']+)'", re.M)
    pref = CLASS_SPELL_PREFIX.get(class_id, "")
    skip = {
        class_id,
        "PROTECTION",
        "ARMS",
        "FURY",
        "BEAST_MASTERY",
        "MARKSMANSHIP",
        "SURVIVAL",
        "DISCIPLINE",
        "HOLY",
        "SHADOW",
        "AFFLICTION",
        "DEMONOLOGY",
        "DESTRUCTION",
        "RETRIBUTION",
    }
    out = {}
    for sid, cn in pat.findall(text):
        if sid in skip:
            continue
        short = sid[len(pref) :] if pref and sid.startswith(pref) else sid
        out[short] = cn
    return out


def parse_action_spells():
    text = open(SLOTS, "r", encoding="utf-8").read()
    add_re = re.compile(r"add\(\s*\d+\s*,\s*'([a-z0-9_]+)'\s*,\s*'([^']+)'", re.I)
    current = "UNKNOWN"
    by_class = {}
    for line in text.splitlines():
        cm = re.search(r"classId\s*===\s*'([A-Z_]+)'", line)
        if cm:
            current = cm.group(1)
            by_class.setdefault(current, {})
        for am in add_re.finditer(line):
            sid, cn = am.group(1), am.group(2)
            by_class.setdefault(current, {})[sid] = cn
    # Merge ClassRegistry-backed classes (WARRIOR/HUNTER/PRIEST/WARLOCK/PALADIN)
    for cls in REGISTRY_CLASS_FILES:
        reg = parse_registry_class_spells(cls)
        if not reg:
            continue
        bucket = by_class.setdefault(cls, {})
        for sid, cn in reg.items():
            bucket.setdefault(sid, cn)
    return by_class


def find_missing(classes):
    art = list_art_bases()
    by_class = parse_action_spells()
    missing = []
    for cls in classes:
        for sid, cn in sorted(by_class.get(cls, {}).items()):
            if normalize(sid) in art or normalize(cn) in art:
                continue
            missing.append({"class": cls, "spellId": sid, "cnName": cn})
    return missing


def main(argv=None):
    parser = argparse.ArgumentParser(description="补齐缺图标技能")
    parser.add_argument(
        "--classes",
        nargs="*",
        default=DEFAULT_PRIORITY,
        help="职业 classId，默认 DRUID SHAMAN DK",
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--flavor", default="classic")
    parser.add_argument("--out", default=None)
    parser.add_argument("--limit", type=int, default=0, help="最多下载 N 个（0=不限）")
    args = parser.parse_args(argv)

    # 合并映射
    CN_TO_SPELL_ID.update(EXTRA_CN)

    missing = find_missing(args.classes)
    # 按职业优先级排序
    prio = {c: i for i, c in enumerate(args.classes)}
    missing.sort(key=lambda r: (prio.get(r["class"], 99), r["spellId"]))

    summary = {
        "classes": args.classes,
        "missingCount": len(missing),
        "missing": missing,
        "dryRun": args.dry_run,
    }
    if args.dry_run:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 0

    if args.limit and args.limit > 0:
        missing = missing[: args.limit]

    out_dir = os.path.abspath(args.out or default_out_dir())
    if not os.path.isdir(out_dir):
        os.makedirs(out_dir)

    session, backend = make_session()
    results = []
    failed = 0
    for row in missing:
        sid = row["spellId"]
        cn = row["cnName"]
        wh_id = WOWHEAD_SPELL_IDS.get(sid)
        if wh_id:
            # 直接构造 Wowhead URL，避免搜索引擎限流
            from urllib.parse import quote as _quote

            slug = _quote(cn)
            flavor = args.flavor or "classic"
            if flavor == "retail":
                query = "https://www.wowhead.com/cn/spell={}/{}".format(wh_id, slug)
            else:
                query = "https://www.wowhead.com/{}/cn/spell={}/{}".format(
                    flavor, wh_id, slug
                )
        else:
            query = cn
        try:
            entry = process_one(
                session,
                backend,
                query,
                out_dir,
                explicit_name=sid,
                extra_map=EXTRA_CN,
                ext="jpg",
                preferred_flavor=args.flavor,
                engine="auto",
            )
            entry["class"] = row["class"]
            results.append(entry)
            sys.stderr.write(
                "[ok] {} {} -> {}\n".format(row["class"], row["spellId"], entry.get("iconName"))
            )
        except Exception as ex:
            failed += 1
            results.append(
                {
                    "ok": False,
                    "class": row["class"],
                    "spellId": row["spellId"],
                    "cnName": row["cnName"],
                    "error": str(ex),
                }
            )
            sys.stderr.write("[fail] {} {} : {}\n".format(row["class"], row["spellId"], ex))

    # 写到 ART/resources 根目录时同步 manifest，供前端 /api 与加载器扫描
    if os.path.abspath(out_dir) == os.path.abspath(RES):
        try:
            import time

            files = sorted(
                f
                for f in os.listdir(out_dir)
                if os.path.isfile(os.path.join(out_dir, f))
                and not f.startswith(".")
                and f != "manifest.json"
            )
            with open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf-8") as f:
                json.dump(
                    {"files": files, "updatedAt": int(time.time() * 1000)},
                    f,
                    ensure_ascii=False,
                    indent=2,
                )
            sys.stderr.write("[ok] manifest updated ({} files)\n".format(len(files)))
        except Exception as ex:
            sys.stderr.write("[warn] manifest: {}\n".format(ex))

    out = {
        "ok": failed == 0,
        "total": len(results),
        "success": len(results) - failed,
        "failed": failed,
        "outDir": out_dir.replace("\\", "/"),
        "httpBackend": backend,
        "results": results,
    }
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
