# -*- coding: utf-8 -*-
"""
下载各职业图标到 ART/resources（沿用 wowhead_icon_dl 的 session / CDN 下载路径）。

Wowhead 职业页 (class=11/德鲁伊) 常被 CloudFront/WAF 拦截，nether tooltip 也不支持
entity type=class。实际图标与页面展示同源，固定为 zamimg large/classicon_*.jpg。

用法:
  python tools/fill_class_icons.py
  python tools/fill_class_icons.py --dry-run
  python tools/fill_class_icons.py --out ART/resources
"""
from __future__ import print_function, unicode_literals

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from wowhead_icon_dl import (  # noqa: E402
    default_out_dir,
    download,
    icon_cdn_url,
    make_session,
)

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
RES = os.path.join(ROOT, "ART", "resources")

# 游戏 ClassId -> (Wowhead class id, 中文名, zamimg classicon 名)
CLASS_ICONS = [
    ("WARRIOR", 1, "战士", "classicon_warrior"),
    ("PALADIN", 2, "圣骑士", "classicon_paladin"),
    ("HUNTER", 3, "猎人", "classicon_hunter"),
    ("ROGUE", 4, "潜行者", "classicon_rogue"),
    ("PRIEST", 5, "牧师", "classicon_priest"),
    ("DK", 6, "死亡骑士", "classicon_deathknight"),
    ("SHAMAN", 7, "萨满", "classicon_shaman"),
    ("MAGE", 8, "法师", "classicon_mage"),
    ("WARLOCK", 9, "术士", "classicon_warlock"),
    ("DRUID", 11, "德鲁伊", "classicon_druid"),
]


def class_filename(class_id):
    return "class_{}.jpg".format(class_id.lower())


def main(argv=None):
    parser = argparse.ArgumentParser(description="下载各职业 classicon 到 ART/resources")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--out",
        default=None,
        help="输出目录（默认 ART/resources，可改未审计）",
    )
    args = parser.parse_args(argv)

    out_dir = os.path.abspath(args.out or RES)
    if not os.path.isdir(out_dir):
        os.makedirs(out_dir)

    plan = []
    for class_id, wh_id, cn, icon_name in CLASS_ICONS:
        plan.append(
            {
                "classId": class_id,
                "wowheadClassId": wh_id,
                "cnName": cn,
                "iconName": icon_name,
                "filename": class_filename(class_id),
                "pageUrl": "https://www.wowhead.com/cn/class={}/{}".format(wh_id, cn),
                "cdnUrl": icon_cdn_url(icon_name),
            }
        )

    if args.dry_run:
        print(json.dumps({"dryRun": True, "outDir": out_dir.replace("\\", "/"), "plan": plan}, ensure_ascii=False, indent=2))
        return 0

    session, backend = make_session()
    results = []
    failed = 0
    for row in plan:
        dest = os.path.join(out_dir, row["filename"])
        try:
            nbytes = download(session, row["cdnUrl"], dest)
            entry = dict(row)
            entry.update(
                {
                    "ok": True,
                    "bytes": nbytes,
                    "savedAs": dest.replace("\\", "/"),
                    "httpBackend": backend,
                    "source": "zamimg_classicon",
                }
            )
            results.append(entry)
            sys.stderr.write(
                "[ok] {} {} -> {}\n".format(row["classId"], row["iconName"], row["filename"])
            )
        except Exception as ex:
            failed += 1
            results.append(
                {
                    "ok": False,
                    "classId": row["classId"],
                    "iconName": row["iconName"],
                    "error": str(ex),
                }
            )
            sys.stderr.write("[fail] {} : {}\n".format(row["classId"], ex))

    # 同步根目录 manifest（仅当写到 ART/resources）
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
                json.dump({"files": files, "updatedAt": int(time.time() * 1000)}, f, ensure_ascii=False, indent=2)
        except Exception as ex:
            sys.stderr.write("[warn] manifest: {}\n".format(ex))

    out = {
        "ok": failed == 0,
        "total": len(results),
        "success": len(results) - failed,
        "failed": failed,
        "outDir": out_dir.replace("\\", "/"),
        "httpBackend": backend,
        "note": "职业页常被 WAF 拦截；图标与 Wowhead class 页同源，直接取 zamimg classicon_*",
        "results": results,
    }
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
