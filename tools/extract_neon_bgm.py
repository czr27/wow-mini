#!/usr/bin/env python3
"""
Extract all 93 BGM tracks from Neon Abyss Music.bank (FSB5 Vorbis)
using vgmstream-cli + ffmpeg, and organize them into review folders by tier.
"""
import os
import re
import subprocess
import sys
import fsb5

BANK_PATH = r"S:\SteamLibrary\steamapps\common\Neon Abyss\NeonAbyss_Data\StreamingAssets\Music.bank"
FSB_OFFSET = 187040
OUT_ROOT = os.path.join(os.path.dirname(__file__), "_neon_bgm_raw")
VGMSTREAM_CLI = os.path.join(os.path.dirname(__file__), "vgmstream", "vgmstream-cli.exe")
FFMPEG_BIN = r"C:\Users\chenzhuoru27\scoop\shims\ffmpeg.exe"
if not os.path.exists(FFMPEG_BIN):
    FFMPEG_BIN = "ffmpeg"


def sanitize_filename(name: str) -> str:
    cleaned = re.sub(r'[\\/:*?"<>|]+', "_", name).strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned or "unnamed"


def classify_track(name: str, dur_sec: float) -> str:
    low = name.lower()
    if any(k in low for k in ["rain", "thunder", "ambient_forest", "ambient_lake"]):
        return "F_环境音_雨声雷声"
    if dur_sec < 20.0 or any(k in low for k in ["intro", "inrto", "outro", "stab"]):
        return "D_开场与结算_INTRO_OUTRO"
    if any(
        k in low
        for k in [
            "普通",
            "normal",
            "dream punk",
            "20-4-21",
            "untitled",
            "chan_music",
            "1.5",
            "progress_bg",
            "game_muse",
            "animation_music",
            "gameroom",
            "fishingroom",
            "holy room",
            "black market",
            "天使",
            "恶魔",
            "赌博",
            "滚字幕",
            "applause",
            "test_searching",
            "test_fighting",
        ]
    ) or name.strip() == "Music":
        return "E_待试听_未命名或特殊房间"
    if dur_sec >= 55.0:
        return "A_主力长曲_55s以上"
    if dur_sec >= 40.0:
        return "B_可用曲目_40至55s"
    return "C_战斗短循环_28至40s"


def main():
    if not os.path.exists(VGMSTREAM_CLI):
        print(f"Missing vgmstream-cli at {VGMSTREAM_CLI}", file=sys.stderr)
        sys.exit(1)

    os.makedirs(OUT_ROOT, exist_ok=True)
    fsb_path = os.path.join(OUT_ROOT, "_temp_music.fsb")

    print(f"Reading {BANK_PATH} from offset {FSB_OFFSET}...")
    with open(BANK_PATH, "rb") as f:
        f.seek(FSB_OFFSET)
        fsb_bytes = f.read()

    with open(fsb_path, "wb") as f:
        f.write(fsb_bytes)

    fsb = fsb5.FSB5(fsb_bytes)
    total = len(fsb.samples)
    print(f"Found {total} samples in FSB5. Extracting and transcoding to OGG (128kbps)...")

    index_lines = ["# 霓虹深渊 Music.bank 解包曲目索引（共 93 首）\n\n"]
    used_names = {}

    for idx, sample in enumerate(fsb.samples):
        subsong = idx + 1  # vgmstream -s is 1-based
        dur_sec = sample.samples / float(sample.frequency or 48000)
        raw_name = (sample.name or f"track_{subsong:02d}").strip()
        group = classify_track(raw_name, dur_sec)
        group_dir = os.path.join(OUT_ROOT, group)
        os.makedirs(group_dir, exist_ok=True)

        safe = sanitize_filename(raw_name)
        count = used_names.get((group, safe), 0) + 1
        used_names[(group, safe)] = count
        if count > 1:
            safe = f"{safe}_{count}"

        prefix = f"[{int(round(dur_sec)):03d}s]"
        wav_tmp = os.path.join(OUT_ROOT, f"_tmp_{subsong:02d}.wav")
        ogg_out = os.path.join(group_dir, f"{prefix} {safe}.ogg")

        if not os.path.exists(ogg_out):
            r1 = subprocess.run(
                [VGMSTREAM_CLI, "-s", str(subsong), "-o", wav_tmp, fsb_path],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
            )
            if r1.returncode != 0 or not os.path.exists(wav_tmp):
                print(f"[{subsong}/{total}] FAILED vgmstream: {raw_name}", file=sys.stderr)
                continue

            r2 = subprocess.run(
                [FFMPEG_BIN, "-y", "-i", wav_tmp, "-c:a", "libvorbis", "-b:a", "128k", ogg_out],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
            )
            try:
                os.remove(wav_tmp)
            except OSError:
                pass
            if r2.returncode != 0:
                print(f"[{subsong}/{total}] FAILED ffmpeg: {raw_name}", file=sys.stderr)
                continue

        index_lines.append(f"- `{group}` | **{dur_sec:.1f}s** | `{prefix} {safe}.ogg` (原名: `{raw_name}`)\n")
        if subsong % 10 == 0 or subsong == total:
            print(f"Progress: {subsong}/{total}")

    try:
        os.remove(fsb_path)
    except OSError:
        pass

    index_path = os.path.join(OUT_ROOT, "INDEX.md")
    with open(index_path, "w", encoding="utf-8") as f:
        f.writelines(index_lines)

    print(f"Done! All tracks organized in: {OUT_ROOT}")


if __name__ == "__main__":
    main()
