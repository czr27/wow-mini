#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
独立小工具：从 Wowhead 拉取技能 large 图标，保存到 ART/resources/未审计。

用法:
  python tools/wowhead_icon_dl.py "https://www.wowhead.com/classic/cn/spell=379/大地之盾"
  python tools/wowhead_icon_dl.py 树皮术
  python tools/wowhead_icon_dl.py 清除腐蚀 树皮术 --flavor classic
  python tools/wowhead_icon_dl.py --test

输入可以是 Wowhead URL，也可以是技能中文/英文名（自动用搜索引擎找 wowhead spell 链接）。
绕过 CloudFront: 优先 curl_cffi（TLS 指纹），再 cloudscraper，最后 requests。
主路径走 nether.wowhead.com/tooltip（通常不被拦），页面 HTML 仅作兜底。
"""

from __future__ import print_function, unicode_literals

import argparse
import json
import os
import re
import sys
from datetime import datetime

try:
    from urllib.parse import unquote, quote, urlparse, parse_qs
except ImportError:
    from urlparse import unquote, urlparse, parse_qs  # type: ignore
    from urllib import quote  # type: ignore

# 中文显示名 -> 游戏内 spellId（文件名）
CN_TO_SPELL_ID = {
    "大地之盾": "earth_shield",
    "激流": "riptide",
    "治疗波": "healing_wave",
    "治疗链": "chain_heal",
    "治疗之雨": "healing_rain",
    "灵魂链接图腾": "spirit_link",
    "风剪": "wind_shear",
    "嗜血": "bloodlust",
    "英勇": "bloodlust",
    "先祖之魂": "ancestral_spirit",
    "闪电箭": "lightning_bolt",
    "熔岩爆裂": "lava_burst",
    "闪电链": "chain_lightning",
    "生命释放": "unleash_life",
    "治疗之潮图腾": "healing_tide",
    "治疗之潮": "healing_tide",
    "升腾": "ascendance",
    "先祖指引": "ancestral_guidance",
    "雷霆风暴": "thunderstorm",
    "烈焰震击": "flame_shock",
    "大地震击": "earth_shock",
    "治疗之涌": "healing_surge",
    "净化灵魂": "cleanse_spirit",
    "宁静": "tranquility",
    "回春术": "rejuvenation",
    "愈合": "regrowth",
    "生命绽放": "lifebloom",
    "迅捷治愈": "swiftmend",
    "野性成长": "wild_growth",
    "野性印记": "mark_of_the_wild",
    "治疗之触": "healing_touch",
    "滋养": "nourish",
    "激活": "innervate",
    "复生": "rebirth",
    "起死回生": "revive",
    "自然迅捷": "natures_swiftness",
    "法力之潮": "mana_tide",
    "法力之潮图腾": "mana_tide",
    "风怒图腾": "windfury_totem",
    "清除腐蚀": "remove_corruption",
    "解除腐蚀": "remove_corruption",
    "树皮术": "barkskin",
    # Druid feral / balance extras
    "狂暴": "berserk",
    "凶猛撕咬": "ferocious_bite",
    "飓风": "hurricane",
    "斜掠": "rake",
    "割裂": "rip",
    "撕碎": "shred",
    "迎头痛击": "skull_bash",
    "星辰坠落": "starfall",
    "横扫": "swipe",
    # Shaman extras
    "野性狼魂": "feral_spirit",
    "火焰新星": "fire_nova",
    "强效治疗波": "greater_healing_wave",
    "熔岩猛击": "lava_lash",
    "萨满之怒": "shamanistic_rage",
    "风暴打击": "stormstrike",
    "元素释放": "unleash_elements",
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
}

# 英文 tooltip 名 -> spellId（CN 未命中时）
EN_TO_SPELL_ID = {
    "earth shield": "earth_shield",
    "ascendance": "ascendance",
    "mana tide": "mana_tide",
    "mana tide totem": "mana_tide",
    "lifebloom": "lifebloom",
    "ancestral guidance": "ancestral_guidance",
    "windfury totem": "windfury_totem",
    "barkskin": "barkskin",
    "remove corruption": "remove_corruption",
}

# 搜索结果 flavor 优先级（本项目偏 Cata/MoP）
FLAVOR_SCORE = {
    "mop-classic": 100,
    "mop": 95,
    "classic": 90,
    "cata": 88,
    "wotlk": 70,
    "tbc": 60,
    "sod": 50,
    "retail": 40,
    "": 40,
}

SPELL_URL_RE = re.compile(
    r"https?://(?:www\.)?wowhead\.com/[^\s\"'<>]*?spell=\d+[^\s\"'<>]*",
    re.I,
)
SPELL_REL_RE = re.compile(
    r"(?:https?://(?:www\.)?wowhead\.com)?(/[^\s\"'<>]*?spell=\d+[^\s\"'<>]*)",
    re.I,
)

# URL 路径段 -> 优先尝试的 dataEnv 列表（Wowhead nether tooltip）
# classic=4；mop-classic 在 4/5/8 上常 404，用 retail 系 env 可取到同 spellId 图标
DATA_ENV_BY_FLAVOR = {
    "classic": [4, 1, 0],
    "wotlk": [3, 4, 1],
    "tbc": [2, 4, 1],
    "sod": [8, 4, 1],
    "cata": [4, 1, 0],
    "mop-classic": [1, 0, 2, 3, 10, 12, 13, 15],
    "mop": [1, 0, 2, 3, 10, 12, 13, 15],
    "ptr": [2, 1],
    "beta": [3, 1],
    "retail": [1, 0],
    "": [1, 0, 4],
}

TEST_URLS = [
    "https://www.wowhead.com/classic/cn/spell=379/%E5%A4%A7%E5%9C%B0%E4%B9%8B%E7%9B%BE",
    "https://www.wowhead.com/mop-classic/cn/spell=114049/%E5%8D%87%E8%85%BE",
    "https://www.wowhead.com/mop-classic/cn/spell=16191/%E6%B3%95%E5%8A%9B%E4%B9%8B%E6%BD%AE",
    "https://www.wowhead.com/cn/spell=33763/%E7%94%9F%E5%91%BD%E7%BB%BD%E6%94%BE",
    "https://www.wowhead.com/mop-classic/cn/spell=108281/%E5%85%88%E7%A5%96%E6%8C%87%E5%BC%95",
    "https://www.wowhead.com/classic/cn/spell=10613/%E9%A3%8E%E6%80%92%E5%9B%BE%E8%85%BE",
]

ICON_URL_RE = re.compile(
    r"https?://wow\.zamimg\.com/images/wow/icons/(?:large|medium|small)/([a-z0-9_]+)\.(?:jpg|png)",
    re.I,
)


def eprint(*args):
    try:
        sys.stderr.write(" ".join(_to_text(a) for a in args) + "\n")
    except Exception:
        sys.stderr.write(" ".join(repr(a) for a in args) + "\n")


def _to_text(v):
    if isinstance(v, bytes):
        return v.decode("utf-8", "replace")
    return str(v)


def repo_root():
    return os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def default_out_dir():
    return os.path.join(repo_root(), "ART", "resources", "未审计")


def make_session():
    """优先 curl_cffi（可过 CloudFront），再 cloudscraper，最后 requests。"""
    # curl_cffi
    try:
        from curl_cffi import requests as cffi_requests

        impersonate = None
        for cand in ("chrome110", "chrome107", "chrome104", "chrome101", "chrome100", "chrome99"):
            try:
                r = cffi_requests.get(
                    "https://nether.wowhead.com/tooltip/spell/379?dataEnv=4",
                    impersonate=cand,
                    timeout=15,
                )
                if r.status_code == 200:
                    impersonate = cand
                    break
            except Exception:
                continue
        if impersonate is None:
            raise RuntimeError("curl_cffi 无可用 impersonate")

        class _CffiSession(object):
            def get(self, url, **kwargs):
                kwargs = dict(kwargs)
                kwargs.setdefault("impersonate", impersonate)
                kwargs.setdefault("timeout", 60)
                headers = kwargs.pop("headers", None)
                if headers:
                    kwargs["headers"] = headers
                return cffi_requests.get(url, **kwargs)

        return _CffiSession(), "curl_cffi:" + impersonate
    except Exception as ex:
        eprint("[warn] curl_cffi 不可用:", ex)

    try:
        import cloudscraper

        s = cloudscraper.create_scraper(
            browser={"browser": "chrome", "platform": "windows", "mobile": False}
        )
        return s, "cloudscraper"
    except Exception as ex:
        eprint("[warn] cloudscraper 不可用:", ex)

    try:
        import requests

        return requests.Session(), "requests"
    except Exception as ex:
        raise SystemExit(
            "需要: pip install curl_cffi cloudscraper requests\n" + str(ex)
        )


def is_wowhead_url(text):
    t = (text or "").strip()
    return bool(re.search(r"wowhead\.com/.+spell=\d+", t, re.I)) or (
        t.startswith("http") and "spell=" in t
    )


def normalize_wowhead_url(url):
    """清洗搜索结果里的脏 URL（截断、&amp;、uddg 包装等）。"""
    u = unquote(url.strip())
    u = u.replace("&amp;", "&")
    # DuckDuckGo 跳转包装
    if "uddg=" in u:
        qs = parse_qs(urlparse(u).query)
        if qs.get("uddg"):
            u = unquote(qs["uddg"][0])
    # 只保留到 spell 段，去掉查询串
    m = re.search(
        r"(https?://(?:www\.)?wowhead\.com/[^\s?#\"']*?spell=\d+(?:/[^\s?#\"']*)?)",
        u,
        re.I,
    )
    if m:
        u = m.group(1)
    # 去掉尾部标点
    u = u.rstrip(").,;\"'")
    # 拒绝被错误拼接的镜像站 URL
    if re.search(r"wowhead\.com/+[^/]*\.(?:com|net|org)/", u, re.I):
        sm = re.search(r"spell=(\d+)", u, re.I)
        if sm:
            return "https://www.wowhead.com/classic/cn/spell=" + sm.group(1)
    return u


def parse_wowhead_url(url):
    """返回 (flavor, spell_num, cn_name)。"""
    url = normalize_wowhead_url(url)
    m = re.search(r"wowhead\.com/([^?]*)", url, re.I)
    path = m.group(1) if m else url
    parts = [p for p in path.split("/") if p]

    flavor = ""
    # 常见: classic/cn/spell=379/... 或 cn/spell=... 或 mop-classic/cn/spell=...
    known = set(DATA_ENV_BY_FLAVOR.keys()) - {""}
    if parts and parts[0].lower() in known:
        flavor = parts[0].lower()

    sm = re.search(r"spell=(\d+)(?:/([^?#]+))?", url, re.I)
    if not sm:
        raise ValueError("URL 中未找到 spell=<id>")
    spell_num = sm.group(1)
    cn_name = unquote(sm.group(2) or "").strip().strip("/")
    return flavor, spell_num, cn_name


def _looks_like_wowhead_spell_path(path):
    """仅接受真正的 Wowhead 相对路径，拒绝镜像站路径。"""
    p = (path or "").lower()
    if "://" in p or p.startswith("//"):
        return False
    if any(bad in p for bad in ("nfuwow", "3dmgame", "wowdb", "warcraft", "gamespot")):
        return False
    # /classic/cn/spell=22812/... 或 /spell=22812/... 或 /cn/spell=...
    return bool(re.search(r"(?:^|/)(?:[\w-]+/)*(?:cn/)?spell=\d+", p, re.I))


def _extract_spell_links(html):
    found = []
    seen = set()
    for m in SPELL_URL_RE.finditer(html):
        u = normalize_wowhead_url(m.group(0))
        if u not in seen and "wowhead.com" in u and "spell=" in u:
            seen.add(u)
            found.append(u)
    for m in SPELL_REL_RE.finditer(html):
        path = m.group(1)
        if not _looks_like_wowhead_spell_path(path):
            continue
        if not path.startswith("http"):
            path = "https://www.wowhead.com" + path
        u = normalize_wowhead_url(path)
        if u not in seen and "wowhead.com" in u and "spell=" in u:
            seen.add(u)
            found.append(u)
    return found


def _score_spell_url(url, query, preferred_flavor):
    try:
        flavor, spell_num, slug = parse_wowhead_url(url)
    except Exception:
        return -1
    score = FLAVOR_SCORE.get(flavor, 40)
    if preferred_flavor:
        if flavor == preferred_flavor.lower():
            score += 200
        elif preferred_flavor.lower() == "classic" and flavor in ("classic", "cata"):
            score += 150
    q = (query or "").strip().lower()
    slug_l = (slug or "").lower()
    # 中文名完全在 slug 中
    if q and q in slug_l:
        score += 50
    # 英文 slug 匹配（barkskin / remove-corruption）
    q_slug = slugify_en(q).replace("_", "-")
    if q_slug and q_slug in slug_l.replace("_", "-"):
        score += 40
    # forever / study 噪音
    if "/forever/" in url.lower():
        score -= 80
    # 版本页带 /cn/ 略加分
    if "/cn/" in url.lower():
        score += 5
    return score


SEARCH_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}

# spellId -> 常见英文名（用于搜索补强）
SPELL_ID_TO_EN = dict((v, k) for k, v in EN_TO_SPELL_ID.items())


def _http_get(session, url, **kwargs):
    headers = dict(SEARCH_HEADERS)
    if kwargs.get("headers"):
        headers.update(kwargs.pop("headers"))
    return session.get(url, headers=headers, **kwargs)


def _uniq(seq):
    seen = set()
    out = []
    for x in seq:
        if x and x not in seen:
            seen.add(x)
            out.append(x)
    return out


def _extract_spell_ids(html):
    """从搜索页抽 spell id（含镜像站 data-mdurl / ?spell=）。"""
    ids = []
    for m in re.finditer(
        r"(?:wowhead\.com/[^\s\"'<>]*?spell=|/\?spell=|[?&]spell=|spell/)(\d{2,7})",
        html,
        re.I,
    ):
        ids.append(m.group(1))
    # nfuwow / 3dmgame 等
    for m in re.finditer(r"data-mdurl=\"([^\"]*spell=(\d+)[^\"]*)\"", html, re.I):
        ids.append(m.group(2))
    return _uniq(ids)


def _build_wowhead_url(spell_num, query, preferred_flavor):
    flavor = (preferred_flavor or "classic").lower()
    if flavor == "retail":
        flavor = ""
    slug = quote(query.strip())
    if flavor:
        return "https://www.wowhead.com/{}/cn/spell={}/{}".format(flavor, spell_num, slug)
    return "https://www.wowhead.com/cn/spell={}/{}".format(spell_num, slug)


def _parse_search_html(html, query, preferred_flavor):
    """从任意搜索引擎 HTML 抽出 wowhead URL；必要时用 spellId 拼链接。"""
    links = list(_extract_spell_links(html))
    # 360/搜狗跳转参数里可能藏着真实 URL
    for m in re.finditer(r"[?&](?:u|url|target|mdurl)=([^&\"']+)", html, re.I):
        cand = unquote(m.group(1))
        if "wowhead.com" in cand and "spell=" in cand:
            links.append(normalize_wowhead_url(cand))
    for m in re.finditer(r"data-mdurl=\"([^\"]+)\"", html, re.I):
        cand = unquote(m.group(1))
        if "wowhead.com" in cand and "spell=" in cand:
            links.append(normalize_wowhead_url(cand))

    # 用搜到的 spell id 构造规范 Wowhead URL（镜像站也能贡献 id）
    for sid in _extract_spell_ids(html):
        links.append(_build_wowhead_url(sid, query, preferred_flavor or "classic"))
        for fl in ("classic", "mop-classic", "cata", "retail"):
            if fl != (preferred_flavor or "classic"):
                links.append(_build_wowhead_url(sid, query, fl))

    # 只保留真正的 wowhead.com 链接
    links = [u for u in _uniq(links) if "wowhead.com/" in u and "spell=" in u]
    return links


def _search_terms(query):
    """生成搜索关键词：中文原词 + 英文名（若有映射）。"""
    terms = [query]
    sid = CN_TO_SPELL_ID.get(query)
    if sid and sid in SPELL_ID_TO_EN:
        en = SPELL_ID_TO_EN[sid]
        # earth shield -> Earth Shield 风格不重要，搜索用原串即可
        terms.append(en)
        terms.append(en.title())
    # 反向：英文输入
    key = query.strip().lower()
    if key in EN_TO_SPELL_ID:
        # 已是英文
        pass
    return _uniq(terms)


def search_ddg(session, query, preferred_flavor=None):
    links = []
    # GET
    q = "site:wowhead.com {} spell".format(query)
    url = "https://html.duckduckgo.com/html/?q=" + quote(q)
    r = _http_get(session, url)
    status = getattr(r, "status_code", 0)
    html = r.text if hasattr(r, "text") else r.content.decode("utf-8", "replace")
    if status == 200:
        links.extend(_parse_search_html(html, query, preferred_flavor))
    # POST（有时比 GET 少验证码）
    try:
        from curl_cffi import requests as cffi_requests

        r2 = cffi_requests.post(
            "https://html.duckduckgo.com/html/",
            data={"q": q, "b": ""},
            impersonate="chrome110",
            timeout=40,
            headers=dict(
                SEARCH_HEADERS,
                **{
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Referer": "https://html.duckduckgo.com/",
                }
            ),
        )
        if getattr(r2, "status_code", 0) == 200:
            links.extend(_parse_search_html(r2.text, query, preferred_flavor))
    except Exception:
        pass
    if not links and status >= 400:
        raise RuntimeError("DuckDuckGo HTTP {}".format(status))
    return _uniq(links), "duckduckgo"


def search_bing(session, query, preferred_flavor=None):
    q = "{} wowhead spell".format(query)
    url = "https://www.bing.com/search?q=" + quote(q) + "&setlang=zh-CN"
    r = _http_get(session, url)
    status = getattr(r, "status_code", 0)
    html = r.text if hasattr(r, "text") else r.content.decode("utf-8", "replace")
    if status >= 400:
        raise RuntimeError("Bing HTTP {}".format(status))
    return _parse_search_html(html, query, preferred_flavor), "bing"


def search_so360(session, query, preferred_flavor=None):
    # 360 搜索对中文技能名较稳，常能给出 spell id / 镜像站
    q = "{} wowhead".format(query)
    url = "https://www.so.com/s?q=" + quote(q)
    r = _http_get(session, url)
    status = getattr(r, "status_code", 0)
    html = r.text if hasattr(r, "text") else r.content.decode("utf-8", "replace")
    if status >= 400:
        raise RuntimeError("360so HTTP {}".format(status))
    return _parse_search_html(html, query, preferred_flavor), "so360"


def search_sogou(session, query, preferred_flavor=None):
    q = "{} wowhead".format(query)
    url = "https://www.sogou.com/web?query=" + quote(q) + "&ie=utf8"
    r = _http_get(session, url)
    status = getattr(r, "status_code", 0)
    html = r.text if hasattr(r, "text") else r.content.decode("utf-8", "replace")
    if status >= 400:
        raise RuntimeError("Sogou HTTP {}".format(status))
    return _parse_search_html(html, query, preferred_flavor), "sogou"


def _validate_wowhead_candidate(session, url):
    """用 tooltip 验证拼出来的链接是否真有图标。"""
    try:
        flavor, spell_num, _cn = parse_wowhead_url(url)
        meta = fetch_tooltip(session, spell_num, flavor)
        return bool(meta and meta.get("icon"))
    except Exception:
        return False


def resolve_query_to_url(session, query, preferred_flavor=None, engine="auto"):
    """URL 直接返回；技能名则搜索引擎找 / 拼 Wowhead spell 页。"""
    q = (query or "").strip()
    if not q:
        raise ValueError("空查询")
    if is_wowhead_url(q):
        return normalize_wowhead_url(q), None, []

    engine_map = {
        "bing": [search_bing],
        "ddg": [search_ddg],
        "duckduckgo": [search_ddg],
        "so360": [search_so360],
        "360": [search_so360],
        "sogou": [search_sogou],
        "auto": [search_so360, search_ddg, search_sogou, search_bing],
    }
    engines = engine_map.get(engine, engine_map["auto"])
    terms = _search_terms(q)

    last_err = None
    all_links = []
    used = None
    for term in terms:
        for fn in engines:
            try:
                links, used_now = fn(session, term, preferred_flavor)
                if links:
                    used = used_now
                    all_links.extend(links)
                    eprint(
                        "[info] 搜索命中:",
                        used_now,
                        "词=",
                        term,
                        "条数=",
                        len(links),
                    )
                    break
            except Exception as ex:
                last_err = ex
                eprint("[warn] 搜索失败 ({}/{})：{}".format(fn.__name__, term, ex))
        if all_links:
            break

    all_links = _uniq(all_links)
    if not all_links:
        raise RuntimeError(
            "搜索引擎未找到 Wowhead 技能链接：「{}」{}".format(
                q, (" / " + str(last_err)) if last_err else ""
            )
        )

    ranked = sorted(
        all_links,
        key=lambda u: _score_spell_url(u, q, preferred_flavor),
        reverse=True,
    )

    # 优先选能通过 tooltip 验证的
    best = None
    for cand in ranked[:12]:
        if _validate_wowhead_candidate(session, cand):
            best = cand
            break
    if best is None:
        best = ranked[0]
        if _score_spell_url(best, q, preferred_flavor) < 0:
            raise RuntimeError("未找到可用的 Wowhead spell 链接：「{}」".format(q))

    eprint("[info] 搜索引擎:", used, "候选", len(ranked), "条，选用:", best)
    return best, used, ranked[:8]


def slugify_en(name):
    s = re.sub(r"[^a-z0-9]+", "_", name.strip().lower())
    return s.strip("_")


def resolve_spell_id(cn_name, en_name, explicit_name, extra_map):
    if explicit_name:
        return slugify_en(explicit_name)
    if cn_name and cn_name in extra_map:
        return extra_map[cn_name]
    if cn_name and cn_name in CN_TO_SPELL_ID:
        return CN_TO_SPELL_ID[cn_name]
    if cn_name:
        for key, sid in CN_TO_SPELL_ID.items():
            if key in cn_name or cn_name in key:
                return sid
    if en_name:
        key = en_name.strip().lower()
        if key in EN_TO_SPELL_ID:
            return EN_TO_SPELL_ID[key]
        return slugify_en(en_name)
    raise ValueError("无法解析 spellId，请用 --name 指定")


def fetch_tooltip(session, spell_num, flavor):
    envs = list(DATA_ENV_BY_FLAVOR.get(flavor, DATA_ENV_BY_FLAVOR[""]))
    # 兜底再扫一轮常见 env
    for extra in (1, 0, 4, 2, 3, 10, 12, 13, 15):
        if extra not in envs:
            envs.append(extra)

    last_err = None
    for env in envs:
        url = "https://nether.wowhead.com/tooltip/spell/{}?dataEnv={}".format(
            spell_num, env
        )
        try:
            r = session.get(url)
            status = getattr(r, "status_code", 0)
            text = r.text if hasattr(r, "text") else r.content.decode("utf-8", "replace")
            if status != 200:
                last_err = "HTTP {} env={}".format(status, env)
                continue
            data = json.loads(text)
            if data.get("error"):
                last_err = data.get("error")
                continue
            icon = (data.get("icon") or "").strip()
            name = (data.get("name") or "").strip()
            if icon:
                return {
                    "icon": icon.lower(),
                    "name": name,
                    "dataEnv": env,
                    "source": "tooltip",
                    "url": url,
                }
        except Exception as ex:
            last_err = str(ex)
            continue
    raise RuntimeError(
        "tooltip 未找到 spell={} flavor={} ({})".format(spell_num, flavor or "retail", last_err)
    )


def extract_icon_from_html(html):
    large = None
    for m in ICON_URL_RE.finditer(html):
        name = m.group(1).lower()
        if "/large/" in m.group(0).lower():
            return name
        if large is None:
            large = name
    m = re.search(r"""["']icon["']\s*:\s*["']([a-z0-9_]+)["']""", html, re.I)
    if m:
        return m.group(1).lower()
    return large


def fetch_icon_via_page(session, page_url):
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    }
    r = session.get(page_url, headers=headers)
    status = getattr(r, "status_code", 0)
    html = r.text if hasattr(r, "text") else r.content.decode("utf-8", "replace")
    if status >= 400:
        raise RuntimeError("页面 HTTP {}".format(status))
    icon = extract_icon_from_html(html)
    if not icon:
        raise RuntimeError("页面未解析到图标")
    return {"icon": icon, "name": "", "dataEnv": None, "source": "page", "url": page_url}


def icon_cdn_url(icon_name):
    return "https://wow.zamimg.com/images/wow/icons/large/{}.jpg".format(icon_name)


def download(session, url, dest_path):
    r = session.get(url)
    status = getattr(r, "status_code", None)
    if status and status >= 400:
        raise RuntimeError("下载失败 HTTP {} : {}".format(status, url))
    content = r.content
    if not content or len(content) < 100:
        raise RuntimeError("下载内容过短: {}".format(url))
    parent = os.path.dirname(dest_path)
    if parent and not os.path.isdir(parent):
        os.makedirs(parent)
    with open(dest_path, "wb") as f:
        f.write(content)
    return len(content)


def update_unaudited_manifest(out_dir, entry):
    """未审计目录独立清单，不改 ART/resources/manifest.json。"""
    path = os.path.join(out_dir, "manifest.json")
    data = {"files": [], "items": [], "updatedAt": 0}
    if os.path.isfile(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            pass
    files = list(data.get("files") or [])
    items = list(data.get("items") or [])
    fname = entry["filename"]
    if fname not in files:
        files.append(fname)
    # 按 filename 去重更新
    items = [it for it in items if it.get("filename") != fname]
    items.append(entry)
    files = sorted(set(files), key=lambda x: x.lower())
    payload = {
        "files": files,
        "items": items,
        "updatedAt": int(datetime.utcnow().timestamp() * 1000),
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")
    return path


def process_one(
    session,
    backend,
    query,
    out_dir,
    explicit_name,
    extra_map,
    ext,
    preferred_flavor=None,
    engine="auto",
):
    eprint("[info] ----")
    eprint("[info] 输入:", query)
    url, search_engine, candidates = resolve_query_to_url(
        session, query, preferred_flavor=preferred_flavor, engine=engine
    )
    flavor, spell_num, cn_name = parse_wowhead_url(url)
    # 用户直接输入中文名时，优先用查询词作为 cnName
    if not is_wowhead_url(query):
        cn_name = query.strip() or cn_name
    eprint("[info] URL:", url)
    eprint(
        "[info] flavor={} spell={} cn={}".format(
            flavor or "retail", spell_num, cn_name or "?"
        )
    )

    meta = None
    try:
        meta = fetch_tooltip(session, spell_num, flavor)
        eprint(
            "[info] tooltip ok env={} icon={} name={}".format(
                meta["dataEnv"], meta["icon"], meta["name"]
            )
        )
    except Exception as ex:
        eprint("[warn] tooltip 失败，尝试页面:", ex)
        meta = fetch_icon_via_page(session, url)
        eprint("[info] page ok icon={}".format(meta["icon"]))

    spell_id = resolve_spell_id(cn_name, meta.get("name") or "", explicit_name, extra_map)
    filename = "{}.{}".format(spell_id, ext)
    dest = os.path.join(out_dir, filename)
    cdn = icon_cdn_url(meta["icon"])
    eprint("[info] spellId={} -> {}".format(spell_id, dest))
    eprint("[info] CDN:", cdn)

    size = download(session, cdn, dest)
    entry = {
        "filename": filename,
        "spellId": spell_id,
        "cnName": cn_name,
        "enName": meta.get("name") or "",
        "wowheadSpell": int(spell_num),
        "flavor": flavor or "retail",
        "iconName": meta["icon"],
        "iconUrl": cdn,
        "source": meta.get("source"),
        "dataEnv": meta.get("dataEnv"),
        "bytes": size,
        "savedAs": dest.replace("\\", "/"),
        "pageUrl": url,
        "query": query,
        "searchEngine": search_engine,
        "searchCandidates": candidates or [],
        "httpBackend": backend,
    }
    # 未审计目录才维护独立清单；写到 ART/resources 根时跳过（避免锁/覆盖主 manifest）
    unaudited = os.path.normcase(os.path.abspath(out_dir)) == os.path.normcase(
        os.path.abspath(default_out_dir())
    )
    if unaudited:
        try:
            manifest = update_unaudited_manifest(out_dir, entry)
            entry["manifest"] = manifest.replace("\\", "/")
        except Exception as ex:
            eprint("[warn] unaudited manifest:", ex)
    entry["ok"] = True
    return entry


def parse_name_map(pairs):
    out = {}
    if not pairs:
        return out
    for p in pairs:
        if "=" not in p:
            raise SystemExit("--name-map 格式应为 中文=english_id，收到: " + p)
        k, v = p.split("=", 1)
        out[k.strip()] = slugify_en(v)
    return out


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Wowhead 技能图标下载 -> ART/resources/未审计（支持 URL 或技能名搜索）"
    )
    parser.add_argument(
        "queries",
        nargs="*",
        help="Wowhead URL 或技能名（如 树皮术），可多个",
    )
    parser.add_argument("--test", action="store_true", help="跑内置测试用例并保留图标")
    parser.add_argument("--name", help="单个查询时强制 spellId 文件名")
    parser.add_argument(
        "--name-map",
        nargs="*",
        default=[],
        help="额外中文映射：大地之盾=earth_shield",
    )
    parser.add_argument(
        "--flavor",
        default=None,
        help="搜索时优先版本：classic / mop-classic / cata / retail 等",
    )
    parser.add_argument(
        "--engine",
        default="auto",
        choices=("auto", "so360", "360", "ddg", "duckduckgo", "sogou", "bing"),
        help="技能名搜索引擎，默认 auto（360 → DDG → 搜狗 → Bing）",
    )
    parser.add_argument(
        "--out",
        default=None,
        help="输出目录，默认 ART/resources/未审计",
    )
    parser.add_argument("--ext", default="jpg", choices=("jpg", "png"))
    args = parser.parse_args(argv)

    queries = list(args.queries)
    if args.test:
        queries.extend(TEST_URLS)
    if not queries:
        parser.error("请提供 URL/技能名，或使用 --test")

    out_dir = os.path.abspath(args.out or default_out_dir())
    if not os.path.isdir(out_dir):
        os.makedirs(out_dir)

    extra_map = parse_name_map(args.name_map)
    session, backend = make_session()
    eprint("[info] HTTP 后端:", backend)
    eprint("[info] 输出目录:", out_dir)

    results = []
    failed = 0
    for query in queries:
        explicit = args.name if (args.name and len(queries) == 1) else None
        try:
            results.append(
                process_one(
                    session,
                    backend,
                    query,
                    out_dir,
                    explicit,
                    extra_map,
                    args.ext,
                    preferred_flavor=args.flavor,
                    engine=args.engine,
                )
            )
        except Exception as ex:
            failed += 1
            err = {
                "ok": False,
                "query": query,
                "error": str(ex),
                "httpBackend": backend,
            }
            results.append(err)
            eprint("[error]", query, ex)

    summary = {
        "ok": failed == 0,
        "total": len(results),
        "success": len(results) - failed,
        "failed": failed,
        "outDir": out_dir.replace("\\", "/"),
        "httpBackend": backend,
        "results": results,
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
    except Exception as ex:
        eprint("[error]", ex)
        print(json.dumps({"ok": False, "error": str(ex)}, ensure_ascii=False, indent=2))
        sys.exit(1)
