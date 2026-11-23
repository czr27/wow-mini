# -*- coding: utf-8 -*-
"""
审计技能/Buff 图标：ART/resources 是否缺失，或 spellId 与文件名无法匹配。

用法:
  python tools/audit_icon_mismatches.py
  python tools/audit_icon_mismatches.py --json
"""
from __future__ import print_function, unicode_literals

import argparse
import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
RES = os.path.join(ROOT, "ART", "resources")
SLOTS = os.path.join(ROOT, "DEV", "packages", "web", "src", "assets", "defaultActionSlots.ts")
CLASSES = os.path.join(ROOT, "DEV", "packages", "engine", "src", "classes")
RSM = os.path.join(ROOT, "DEV", "packages", "engine", "src", "engine", "RunStateMachine.ts")
PIXEL = os.path.join(ROOT, "DEV", "packages", "web", "src", "assets", "pixelIcons.ts")

CLASS_PREFIXES = (
    "druid_",
    "dk_",
    "shaman_",
    "mage_",
    "rogue_",
    "priest_",
    "paladin_",
    "warrior_",
    "hunter_",
    "warlock_",
)

VALID_EXT = {".jpg", ".jpeg", ".png", ".webp", ".svg", ".gif", ".bmp"}


def normalize(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def strip_prefix(sid):
    for p in CLASS_PREFIXES:
        if sid.startswith(p):
            return sid[len(p) :]
    return sid


def list_art():
    """basename(lower) -> filename"""
    by_norm = {}
    files = []
    if not os.path.isdir(RES):
        return by_norm, files
    for name in os.listdir(RES):
        path = os.path.join(RES, name)
        if os.path.isdir(path) or name.startswith(".") or name == "manifest.json":
            continue
        dot = name.rfind(".")
        if dot < 0:
            continue
        ext = name[dot:].lower()
        if ext not in VALID_EXT:
            continue
        base = name[:dot]
        files.append(name)
        by_norm[normalize(base)] = name
    return by_norm, files


def parse_action_slots():
    text = open(SLOTS, "r", encoding="utf-8").read()
    add_re = re.compile(r"add\(\s*\d+\s*,\s*'([a-z0-9_]+)'\s*,\s*'([^']+)'", re.I)
    current = "UNKNOWN"
    rows = []
    for line in text.splitlines():
        cm = re.search(r"classId\s*===\s*'([A-Z_]+)'", line)
        if cm:
            current = cm.group(1)
        for am in add_re.finditer(line):
            rows.append(
                {
                    "spellId": am.group(1),
                    "cnName": am.group(2),
                    "class": current,
                    "source": "defaultActionSlots",
                }
            )
    return rows


def parse_engine_spells():
    rows = []
    id_name = re.compile(
        r"id:\s*'([a-z0-9_]+)'\s*,\s*\n\s*name:\s*'([^']+)'", re.M
    )
    aura_re = re.compile(r"auraId:\s*'([a-z0-9_]+)'")
    for fn in os.listdir(CLASSES):
        if not fn.endswith(".ts"):
            continue
        if fn in ("ClassRegistry.ts", "index.ts", "types.ts"):
            continue
        path = os.path.join(CLASSES, fn)
        text = open(path, "r", encoding="utf-8").read()
        for m in id_name.finditer(text):
            rows.append(
                {
                    "spellId": m.group(1),
                    "cnName": m.group(2),
                    "class": fn.replace(".ts", "").upper(),
                    "source": "engine:" + fn,
                    "kind": "spell",
                }
            )
        for m in aura_re.finditer(text):
            rows.append(
                {
                    "spellId": m.group(1),
                    "cnName": "",
                    "class": fn.replace(".ts", "").upper(),
                    "source": "engine:" + fn,
                    "kind": "aura",
                }
            )
    if os.path.isfile(RSM):
        text = open(RSM, "r", encoding="utf-8").read()
        for m in re.finditer(
            r"spellId:\s*'([a-z0-9_]+)'\s*,\s*\n\s*name:\s*'([^']+)'", text
        ):
            rows.append(
                {
                    "spellId": m.group(1),
                    "cnName": m.group(2),
                    "class": "RAID",
                    "source": "RunStateMachine",
                    "kind": "autobuff",
                }
            )
    return rows


def parse_explicit_svg_keys():
    text = open(PIXEL, "r", encoding="utf-8").read()
    return set(re.findall(r"^ {2}([a-z0-9_]+):\s*`<svg", text, re.M))


def art_match(spell_id, cn_name, art_by_norm):
    candidates = [
        normalize(spell_id),
        normalize(strip_prefix(spell_id)),
        normalize(cn_name) if cn_name else "",
    ]
    for c in candidates:
        if c and c in art_by_norm:
            return art_by_norm[c]
    return None


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)

    art_by_norm, art_files = list_art()
    svg_keys = parse_explicit_svg_keys()

    entries = {}
    for row in parse_action_slots() + parse_engine_spells():
        sid = row["spellId"]
        short = strip_prefix(sid)
        key = sid
        if key not in entries:
            entries[key] = {
                "spellId": sid,
                "shortId": short,
                "cnName": row.get("cnName") or "",
                "sources": [],
                "kinds": set(),
                "classes": set(),
            }
        e = entries[key]
        e["sources"].append(row["source"])
        e["kinds"].add(row.get("kind") or "slot")
        e["classes"].add(row.get("class") or "?")
        if row.get("cnName") and not e["cnName"]:
            e["cnName"] = row["cnName"]

    missing = []
    matched = []
    for sid, e in sorted(entries.items()):
        hit = art_match(sid, e["cnName"], art_by_norm)
        short = e["shortId"]
        has_svg = sid in svg_keys or short in svg_keys
        rec = {
            "spellId": sid,
            "shortId": short,
            "cnName": e["cnName"],
            "kinds": sorted(e["kinds"]),
            "classes": sorted(e["classes"]),
            "sources": sorted(set(e["sources"]))[:6],
            "artFile": hit,
            "hasExplicitSvg": has_svg,
        }
        if hit:
            matched.append(rec)
        else:
            missing.append(rec)

    # ART orphans: file not matching any known spellId/shortId/cn
    known_norms = set()
    for sid, e in entries.items():
        known_norms.add(normalize(sid))
        known_norms.add(normalize(e["shortId"]))
        if e["cnName"]:
            known_norms.add(normalize(e["cnName"]))
    orphans = []
    for norm, fname in sorted(art_by_norm.items()):
        if fname.lower().startswith("class_"):
            continue
        if norm not in known_norms:
            orphans.append(fname)

    # Highlight: slots / autobuff missing art (user-visible)
    priority = [
        m
        for m in missing
        if "slot" in m["kinds"] or "autobuff" in m["kinds"] or "aura" in m["kinds"]
    ]

    out = {
        "artFileCount": len(art_files),
        "knownSpellCount": len(entries),
        "matchedCount": len(matched),
        "missingArtCount": len(missing),
        "priorityMissingCount": len(priority),
        "orphanArtCount": len(orphans),
        "priorityMissing": priority,
        "allMissing": missing,
        "orphanArtFiles": orphans,
        "motw": {
            "spellId": "mark_of_the_wild",
            "inEntries": "mark_of_the_wild" in entries
            or "druid_mark_of_the_wild" in entries,
            "artFile": art_match("mark_of_the_wild", "野性印记", art_by_norm),
            "hasExplicitSvg": "mark_of_the_wild" in svg_keys,
            "diagnosis": (
                "missing_download"
                if not art_match("mark_of_the_wild", "野性印记", art_by_norm)
                else "ok"
            ),
        },
    }

    if args.json:
        print(json.dumps(out, ensure_ascii=False, indent=2))
        return 0

    print("=== Icon audit ===")
    print("ART files: %d | known spells/auras: %d | matched: %d | missing ART: %d" % (
        out["artFileCount"], out["knownSpellCount"], out["matchedCount"], out["missingArtCount"]
    ))
    print()
    print("--- 野性印记 ---")
    print("spellId keys: mark_of_the_wild / druid_mark_of_the_wild")
    print("ART file: %s" % (out["motw"]["artFile"] or "MISSING"))
    print("hand-drawn SVG: %s" % out["motw"]["hasExplicitSvg"])
    print("diagnosis: %s (资源未下载，不是 spellId 对不上已有文件)" % out["motw"]["diagnosis"])
    print()
    print("--- Priority missing (action bar / autobuff / aura), no ART ---")
    for m in priority:
        print(
            "%-28s %-16s kinds=%-20s svg=%s  %s"
            % (
                m["spellId"],
                m["cnName"] or "-",
                ",".join(m["kinds"]),
                "Y" if m["hasExplicitSvg"] else "N",
                ",".join(m["classes"][:3]),
            )
        )
    print()
    print("--- Orphan ART files (no matching spellId) ---")
    for f in orphans:
        print(" ", f)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
