#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
独立小工具：从 Wowhead 拉取技能 large 图标，保存到 ART/resources/未审计。

用法:
  python tools/wowhead_icon_dl.py "https://www.wowhead.com/classic/cn/spell=379/大地之盾"
  python tools/wowhead_icon_dl.py --test
  python tools/wowhead_icon_dl.py URL1 URL2 --name-map 大地之盾=earth_shield

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
    from urllib.parse import unquote
except ImportError:
    from urlparse import unquote  # type: ignore

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
}

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


def parse_wowhead_url(url):
    """返回 (flavor, spell_num, cn_name)。"""
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


def process_one(session, backend, url, out_dir, explicit_name, extra_map, ext):
    flavor, spell_num, cn_name = parse_wowhead_url(url)
    eprint("[info] ----")
    eprint("[info] URL:", url)
    eprint("[info] flavor={} spell={} cn={}".format(flavor or "retail", spell_num, cn_name or "?"))

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
        "httpBackend": backend,
    }
    manifest = update_unaudited_manifest(out_dir, entry)
    entry["ok"] = True
    entry["manifest"] = manifest.replace("\\", "/")
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
    parser = argparse.ArgumentParser(description="Wowhead 技能图标下载 -> ART/resources/未审计")
    parser.add_argument("urls", nargs="*", help="Wowhead 技能页 URL（可多个）")
    parser.add_argument("--test", action="store_true", help="跑内置测试用例并保留图标")
    parser.add_argument("--name", help="单个 URL 时强制 spellId 文件名")
    parser.add_argument(
        "--name-map",
        nargs="*",
        default=[],
        help="额外中文映射：大地之盾=earth_shield",
    )
    parser.add_argument(
        "--out",
        default=None,
        help="输出目录，默认 ART/resources/未审计",
    )
    parser.add_argument("--ext", default="jpg", choices=("jpg", "png"))
    args = parser.parse_args(argv)

    urls = list(args.urls)
    if args.test:
        urls.extend(TEST_URLS)
    if not urls:
        parser.error("请提供 URL，或使用 --test")

    out_dir = os.path.abspath(args.out or default_out_dir())
    if not os.path.isdir(out_dir):
        os.makedirs(out_dir)

    extra_map = parse_name_map(args.name_map)
    session, backend = make_session()
    eprint("[info] HTTP 后端:", backend)
    eprint("[info] 输出目录:", out_dir)

    results = []
    failed = 0
    for i, url in enumerate(urls):
        explicit = args.name if (args.name and len(urls) == 1) else None
        try:
            results.append(
                process_one(session, backend, url, out_dir, explicit, extra_map, args.ext)
            )
        except Exception as ex:
            failed += 1
            err = {
                "ok": False,
                "pageUrl": url,
                "error": str(ex),
                "httpBackend": backend,
            }
            results.append(err)
            eprint("[error]", url, ex)

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
