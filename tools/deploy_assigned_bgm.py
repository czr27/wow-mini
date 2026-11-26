#!/usr/bin/env python3
"""
Deploy ONLY the user-assigned Neon Abyss OGG tracks into DEV/packages/web/public/audio/bgm/,
normalizing loudness via ffmpeg (I=-16 LUFS, TP=-1.5 dB) so quiet/loud tracks match.
"""
import os
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
RAW_DIR = os.path.join(ROOT, "tools", "_neon_bgm_raw")
OUT_DIR = os.path.join(ROOT, "DEV", "packages", "web", "public", "audio", "bgm")
FFMPEG_BIN = r"C:\Users\chenzhuoru27\scoop\shims\ffmpeg.exe"
if not os.path.exists(FFMPEG_BIN):
    FFMPEG_BIN = "ffmpeg"

# Map: output_filename -> source relative path under tools/_neon_bgm_raw
ASSIGNED = {
    # 未登录
    "auth_unlogged.ogg": "C_战斗短循环_28至40s/[038s] Music_final2.ogg",
    # 房间外（选角/首页）
    "outside_1.ogg": "E_待试听_未命名或特殊房间/[021s] Music.ogg",
    "outside_2.ogg": "E_待试听_未命名或特殊房间/[055s] chan_music.ogg",
    # 房间等待列表
    "room_wait_1.ogg": "D_开场与结算_INTRO_OUTRO/[015s] Neon Abyss Black Market _Rv100 (128bpm).ogg",
    "room_wait_2.ogg": "D_开场与结算_INTRO_OUTRO/[015s] Neon Abyss Black Market _Rv201 (128bpm).ogg",
    "room_wait_3.ogg": "D_开场与结算_INTRO_OUTRO/[019s] gameroom_track1.ogg",
    "room_wait_4.ogg": "D_开场与结算_INTRO_OUTRO/[019s] gameroom_track2.ogg",
    "room_wait_5.ogg": "E_待试听_未命名或特殊房间/[030s] Neon Abyss Holy Room _Rv01_ (128bpm).ogg",
    "room_wait_6.ogg": "E_待试听_未命名或特殊房间/[066s] Untitled.ogg",
    "room_wait_7.ogg": "E_待试听_未命名或特殊房间/[128s] 普通.ogg",
    "room_wait_8.ogg": "F_环境音_雨声雷声/[036s] ambient_forest.ogg",
    "room_wait_9.ogg": "F_环境音_雨声雷声/[036s] ambient_lake.ogg",
    # 进本瞬间
    "enter_dungeon.ogg": "D_开场与结算_INTRO_OUTRO/[004s] Level 3 _Rv09_ INTRO.ogg",
    # 迷宫赶路（随机）
    "maze_1.ogg": "E_待试听_未命名或特殊房间/[026s] fishingroom_track1.ogg",
    "maze_2.ogg": "E_待试听_未命名或特殊房间/[026s] fishingroom_track2.ogg",
    # 全体友方增益 Buff 特效音
    "sfx_raid_buff.ogg": "D_开场与结算_INTRO_OUTRO/[002s] Level_9_outro.ogg",
    # 死亡矿井 Boss
    "boss_dm_glubtok.ogg": "E_待试听_未命名或特殊房间/[032s] 赌博.ogg",
    "boss_dm_helix.ogg": "A_主力长曲_55s以上/[060s] Level 1 _SEARCH _bpm128 _in D _Rv103_.ogg",
    "boss_dm_foereaper.ogg": "E_待试听_未命名或特殊房间/[062s] Test_Searching_1.ogg",
    "boss_dm_ripsnarl.ogg": "B_可用曲目_40至55s/[045s] Level 1 _FLIGHT _bpm128 _in D _Rv103_.ogg",
    "boss_dm_cookie.ogg": "A_主力长曲_55s以上/[057s] Neon Abyss BOSS 2 _Rv203_ BODY bpm135.ogg",
    "boss_dm_vanessa.ogg": "B_可用曲目_40至55s/[050s] Neon Abyss BOSS _Rv01_ BODY (135bpm).ogg",
    # 影牙城堡 Boss
    "boss_sfk_ashbury.ogg": "A_主力长曲_55s以上/[060s] Level 3 _Rv09_ SEARCHING.ogg",
    "boss_sfk_silverlaine.ogg": "A_主力长曲_55s以上/[060s] Level 3 _Rv09_ FIGHTING.ogg",
    "boss_sfk_springvale.ogg": "E_待试听_未命名或特殊房间/[034s] Test_Fighting_3.ogg",
    "boss_sfk_walden.ogg": "B_可用曲目_40至55s/[046s] Level 2 _SEARCH _bpm126 _Rv05_.ogg",
    "boss_sfk_godfrey.ogg": "A_主力长曲_55s以上/[057s] Neon Abyss BOSS 3 Rv03_ BODY.ogg",
    # 血色修道院 Boss
    "boss_sm_vishas.ogg": "A_主力长曲_55s以上/[060s] Level 4 SEARCH _bpm128 _Rv02_.ogg",
    "boss_sm_loksey.ogg": "C_战斗短循环_28至40s/[030s] Level 4 FIGHT _bpm128 _Rv02_.ogg",
    "boss_sm_doan.ogg": "B_可用曲目_40至55s/[045s] Neon Abyss - Level 6 _Search _bpm129 _Rv01_.ogg",
    "boss_sm_herod.ogg": "E_待试听_未命名或特殊房间/[040s] Test_Fighting_4.ogg",
    "boss_sm_mograine.ogg": "C_战斗短循环_28至40s/[031s] Level 4 BOSS _Rv03_ BODY 140bpm.ogg",
    # 斯坦索姆 Boss
    "boss_strat_balnazzar.ogg": "E_待试听_未命名或特殊房间/[064s] Test_Searching_2.ogg",
    "boss_strat_willey.ogg": "E_待试听_未命名或特殊房间/[032s] Test_Fighting_2.ogg",
    "boss_strat_ramstein.ogg": "B_可用曲目_40至55s/[046s] Level 2 _FIGHT _bpm126 _Rv05_.ogg",
    "boss_strat_rivendare.ogg": "A_主力长曲_55s以上/[060s] Music_athena.ogg",
    # 祖尔格拉布 Boss
    "boss_zg_venoxis.ogg": "A_主力长曲_55s以上/[060s] Neon Aybss - Level 5 Seach bpm127 Rv01_.ogg",
    "boss_zg_mandokir.ogg": "C_战斗短循环_28至40s/[030s] Neon Aybss - Level 5 Fight bpm127 Rv02_.ogg",
    "boss_zg_kilnara.ogg": "C_战斗短循环_28至40s/[030s] Neon Abyss - Level 6 _Fight _bpm129 _Rv01_.ogg",
    "boss_zg_zanzil.ogg": "E_待试听_未命名或特殊房间/[031s] Test_Fighting_1.ogg",
    "boss_zg_jindo.ogg": "C_战斗短循环_28至40s/[028s] Neon Abyss Boss 5 _Rv04_ bpm135 _BODY.ogg",
    # 巨龙之魂 Boss
    "boss_ds_morchok.ogg": "A_主力长曲_55s以上/[062s] Neon Aybss - Level 7 _Search bpm124 _Rv01_.ogg",
    "boss_ds_zonozz.ogg": "C_战斗短循环_28至40s/[031s] Neon Aybss - Level 7 _Fight bpm124 _Rv01_.ogg",
    "boss_ds_yorsahj.ogg": "E_待试听_未命名或特殊房间/[066s] Test_Searching_3.ogg",
    "boss_ds_hagara.ogg": "E_待试听_未命名或特殊房间/[066s] Test_Searching_4.ogg",
    "boss_ds_ultraxion.ogg": "E_待试听_未命名或特殊房间/[032s] animation_music.ogg",
    "boss_ds_blackhorn.ogg": "E_待试听_未命名或特殊房间/[096s] normal.ogg",
    "boss_ds_spine.ogg": "C_战斗短循环_28至40s/[029s] Music_final.ogg",
    "boss_ds_madness.ogg": "A_主力长曲_55s以上/[073s] Music_athena_02.ogg",
    # 过 Boss 非最后关
    "clear_mid_deadmines.ogg": "D_开场与结算_INTRO_OUTRO/[008s] Level 2 _INTRO _bpm126 _Rv05_.ogg",
    "clear_mid_sfk.ogg": "D_开场与结算_INTRO_OUTRO/[003s] SP_1_outro.ogg",
    "clear_mid_sm.ogg": "D_开场与结算_INTRO_OUTRO/[004s] Level_10_outro.ogg",
    "clear_mid_strat.ogg": "D_开场与结算_INTRO_OUTRO/[004s] Neon Aybss - Level 5 INTRO bpm127 _Rv01_.ogg",
    "clear_mid_zg.ogg": "D_开场与结算_INTRO_OUTRO/[002s] Neon Aybss - Level 7 _INTRO bpm124 _Rv01_.ogg",
    "clear_mid_ds.ogg": "D_开场与结算_INTRO_OUTRO/[002s] Neon Aybss - Level 7 _INTRO bpm124 _Rv01_.ogg",
    # 过尾王大通关
    "clear_final_deadmines.ogg": "D_开场与结算_INTRO_OUTRO/[007s] Neon Abyss BOSS _Rv01_ INTRO (135bpm).ogg",
    "clear_final_sfk.ogg": "D_开场与结算_INTRO_OUTRO/[007s] Neon Abyss BOSS 3 Rv03_ INTRO.ogg",
    "clear_final_sm.ogg": "D_开场与结算_INTRO_OUTRO/[007s] Level 4 BOSS _Rv03_ INTRO 140bpm.ogg",
    "clear_final_strat.ogg": "D_开场与结算_INTRO_OUTRO/[007s] Neon Abyss BOSS 2 _Rv202_ INTRO bpm135.ogg",
    "clear_final_zg.ogg": "D_开场与结算_INTRO_OUTRO/[007s] Neon Abyss Boss 5 _Rv01_ bpm135 _INTRO.ogg",
    "clear_final_ds.ogg": "D_开场与结算_INTRO_OUTRO/[004s] Neon Aybss - Level 7 _OUTRO bpm124 _Rv01_.ogg",
    # 非尾王团灭
    "wipe_deadmines.ogg": "D_开场与结算_INTRO_OUTRO/[008s] Level 1 _OUTRO _bpm128 _in D _Rv103_.ogg",
    "wipe_sfk.ogg": "D_开场与结算_INTRO_OUTRO/[007s] Level 3 _OUTRO _bpm128 _Rv09_ 选择1.ogg",
    "wipe_sm.ogg": "D_开场与结算_INTRO_OUTRO/[008s] Level 4 OUTRO _bpm128 _Rv02_.ogg",
    "wipe_strat.ogg": "D_开场与结算_INTRO_OUTRO/[008s] Level 2 _OUTRO _bpm126 _Rv05_.ogg",
    "wipe_zg.ogg": "D_开场与结算_INTRO_OUTRO/[006s] Neon Abyss Boss 5 _Rv01_ bpm135 _OUTRO.ogg",
    "wipe_ds.ogg": "D_开场与结算_INTRO_OUTRO/[009s] Neon Abyss BOSS _Rv01_ OUTRO (135bpm).ogg",
    # 尾王团灭雷声
    "wipe_thunder_1.ogg": "F_环境音_雨声雷声/[008s] thunder1.ogg",
    "wipe_thunder_2.ogg": "F_环境音_雨声雷声/[004s] thunder2.ogg",
    "wipe_thunder_3.ogg": "F_环境音_雨声雷声/[012s] thunder3.ogg",
    "wipe_thunder_4.ogg": "F_环境音_雨声雷声/[009s] thunder4.ogg",
}


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    # Remove any unassigned files in OUT_DIR
    for existing in os.listdir(OUT_DIR):
        if existing not in ASSIGNED:
            try:
                os.remove(os.path.join(OUT_DIR, existing))
            except OSError:
                pass

    total = len(ASSIGNED)
    for idx, (dst_name, src_rel) in enumerate(ASSIGNED.items(), 1):
        src_path = os.path.join(RAW_DIR, src_rel.replace("/", os.sep))
        dst_path = os.path.join(OUT_DIR, dst_name)
        if not os.path.exists(src_path):
            print(f"MISSING SOURCE: {src_path}", file=sys.stderr)
            sys.exit(1)
        if os.path.exists(dst_path):
            continue
        r = subprocess.run(
            [
                FFMPEG_BIN,
                "-y",
                "-i",
                src_path,
                "-af",
                "loudnorm=I=-16:TP=-1.5:LRA=11",
                "-ar",
                "48000",
                "-c:a",
                "libvorbis",
                "-b:a",
                "128k",
                dst_path,
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        if r.returncode != 0:
            print(f"FAILED {dst_name}: {r.stderr.decode('utf-8', 'ignore')[-300:]}", file=sys.stderr)
            sys.exit(1)
        if idx % 10 == 0 or idx == total:
            print(f"Normalized & deployed {idx}/{total}")
    print(f"All {total} assigned tracks ready in {OUT_DIR}")


if __name__ == "__main__":
    main()
