# -*- coding: utf-8 -*-
import re
import pathlib

root = pathlib.Path(r"G:/Desktop/wow_simu/DEV/packages/engine/src")
ce = (root / "engine/CombatEngine.ts").read_text(encoding="utf-8")
m = re.search(r"export const SPELL_ID_TO_NAME[^=]*=\s*\{(.*?)\n\};", ce, re.S)
if not m:
    raise SystemExit("SPELL_ID_TO_NAME not found")
body = m.group(1)
# keys may be unquoted identifiers
mapped = set(re.findall(r"(?:^|,|\n)\s*([A-Za-z_][A-Za-z0-9_]*)\s*:", body))
print("mapped_keys", len(mapped))

prefixes = [
    "mage_",
    "warlock_",
    "priest_",
    "shaman_",
    "druid_",
    "dk_",
    "rogue_",
    "paladin_",
    "hunter_",
    "warrior_",
]


def short(sid: str) -> str:
    for p in prefixes:
        if sid.startswith(p):
            return sid[len(p) :]
    return sid


# Collect id/name/auraId triples by scanning near id lines
entries = []
for f in sorted((root / "classes").glob("*.ts")):
    if f.name in ("ClassRegistry.ts", "index.ts"):
        continue
    text = f.read_text(encoding="utf-8")
    # Find each spell id declaration and look ahead ~800 chars for name/auraId
    for m_id in re.finditer(r"\bid:\s*['\"]([^'\"]+)['\"]", text):
        sid = m_id.group(1)
        if not (sid.startswith(tuple(prefixes)) or "_" in sid):
            # still keep class-prefixed or snake ids
            if not re.match(r"^[a-z][a-z0-9_]+$", sid):
                continue
        window = text[m_id.start() : m_id.start() + 900]
        # stop window early if next top-level-ish id appears after some content
        nm = re.search(r"\bname:\s*['\"]([^'\"]+)['\"]", window)
        aura = re.search(r"\bauraId:\s*['\"]([^'\"]+)['\"]", window)
        # Heuristic: only treat as spell if it has a Chinese-ish or English name nearby
        if not nm:
            continue
        name = nm.group(1)
        # Skip non-spell objects that happen to have id+name (e.g. specs)
        if "baseValue" not in window and "cooldownMs" not in window and "castTimeMs" not in window and "effects" not in window:
            continue
        entries.append((sid, name, aura.group(1) if aura else None, f.name))

missing = []
seen = set()
for sid, name, aura, src in entries:
    keys = {sid, short(sid)}
    if aura:
        keys.add(aura)
    for k in keys:
        if k in mapped:
            continue
        if re.search(r"[\u4e00-\u9fff]", k):
            continue
        if k in seen:
            continue
        seen.add(k)
        missing.append((k, name, sid, src))

missing.sort(key=lambda x: (x[3], x[0]))
print("spell_entries", len(entries))
print("missing_count", len(missing))
out = pathlib.Path(r"G:/Desktop/wow_simu/tools/_spell_name_gaps.txt")
lines = [f"{k}\t{name}\tfrom:{sid}\t{src}" for k, name, sid, src in missing]
out.write_text("\n".join(lines) + "\n", encoding="utf-8")
print("wrote", out)
for line in lines[:80]:
    print(line)
if len(lines) > 80:
    print(f"... and {len(lines) - 80} more")
