// ============================================================
// Cata Raid Sim — 像素风格职业头像与魔兽世界 4.3 经典技能图标库
// ============================================================

import {
  ALL_CLASSES_NORMALIZED,
  getHastedCastTimeMs,
  LEVEL_80_MAX_HASTE,
  type ClassId,
  type NormalizedSpell,
} from '@cata-raid-sim/engine';

/**
 * 经典职业像素头像 SVG 数据 (32x32 规范) — 手绘默认；运行时优先被 ART/resources/class_*.jpg 覆盖
 */
export const DEFAULT_CLASS_PIXEL_AVATARS: Record<ClassId, string> = {
  DK: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="100%" height="100%">
    <rect width="32" height="32" rx="4" fill="#120407"/>
    <!-- Outer Runic Steel Plate Frame -->
    <rect x="1" y="1" width="30" height="30" rx="3" stroke="#881337" stroke-width="1.2" fill="none"/>
    <!-- Horned Dark Helm of the Scourge -->
    <path d="M4 6 L10 12 L10 20 L6 26 L4 26 Z" fill="#4a0f18"/>
    <path d="M28 6 L22 12 L22 20 L26 26 L28 26 Z" fill="#4a0f18"/>
    <path d="M10 7 L22 7 L24 16 L20 28 L12 28 L8 16 Z" fill="#2d0a11"/>
    <!-- Iron Plate Visor & Runic Brow -->
    <rect x="11" y="10" width="10" height="3" fill="#8b1c2b"/>
    <rect x="10" y="14" width="12" height="2" fill="#4c0519"/>
    <!-- Glowing Blue Eyes of the Lich King's champion -->
    <rect x="11" y="17" width="3" height="2" fill="#00ffff"/>
    <rect x="18" y="17" width="3" height="2" fill="#00ffff"/>
    <rect x="12" y="18" width="1" height="1" fill="#ffffff"/>
    <rect x="19" y="18" width="1" height="1" fill="#ffffff"/>
    <!-- Faceguard & Frost/Blood Runes -->
    <path d="M14 20 L18 20 L16 26 Z" fill="#c41f3b"/>
    <rect x="15" y="22" width="2" height="3" fill="#ff4d6a"/>
    <line x1="16" y1="21" x2="16" y2="25" stroke="#bae6fd" stroke-width="1"/>
  </svg>`,

  DRUID: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="100%" height="100%">
    <rect width="32" height="32" rx="4" fill="#0c170e"/>
    <!-- Outer Emerald Wooden Frame -->
    <rect x="1" y="1" width="30" height="30" rx="3" stroke="#166534" stroke-width="1.2" fill="none"/>
    <!-- Emerald & Amber Antlers -->
    <path d="M5 4 L9 8 L7 13 L10 10 L12 13 L10 7 Z" fill="#d97706"/>
    <path d="M27 4 L23 8 L25 13 L22 10 L20 13 L22 7 Z" fill="#d97706"/>
    <circle cx="5" cy="4" r="1.5" fill="#10b981"/>
    <circle cx="27" cy="4" r="1.5" fill="#10b981"/>
    <!-- Night Elf / Bear Mane & Fur -->
    <path d="M8 12 L24 12 L26 22 L21 28 L11 28 L6 22 Z" fill="#78350f"/>
    <path d="M10 14 L22 14 L23 20 L16 26 L9 20 Z" fill="#b45309"/>
    <!-- Glowing Amber Nature Eyes -->
    <rect x="11" y="17" width="3" height="2" fill="#fbbf24"/>
    <rect x="18" y="17" width="3" height="2" fill="#fbbf24"/>
    <circle cx="12.5" cy="18" r="0.8" fill="#ffffff"/>
    <circle cx="19.5" cy="18" r="0.8" fill="#ffffff"/>
    <!-- Snout & Whiskers -->
    <rect x="14" y="21" width="4" height="3" fill="#451a03"/>
    <!-- Emerald Leaf Forehead Gem -->
    <polygon points="16,12 18,15 16,18 14,15" fill="#10b981"/>
    <circle cx="16" cy="15" r="1" fill="#86efac"/>
  </svg>`,

  SHAMAN: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="100%" height="100%">
    <rect width="32" height="32" rx="4" fill="#041226"/>
    <!-- Outer Stormcaller Oceanic Frame -->
    <rect x="1" y="1" width="30" height="30" rx="3" stroke="#0284c7" stroke-width="1.2" fill="none"/>
    <!-- Wolf Headdress / Elemental Mask -->
    <path d="M7 8 L11 3 L14 9 L18 9 L21 3 L25 8 L24 16 L8 16 Z" fill="#0369a1"/>
    <!-- Pointed Wolf Ears -->
    <polygon points="7,8 10,2 12,8" fill="#0284c7"/>
    <polygon points="25,8 22,2 20,8" fill="#0284c7"/>
    <!-- Face / Shamanic Beard & Fangs -->
    <path d="M9 14 L23 14 L22 24 L16 29 L10 24 Z" fill="#075985"/>
    <path d="M11 20 L21 20 L16 27 Z" fill="#0c4a6e"/>
    <polygon points="12,19 13,22 14,19" fill="#ffffff"/>
    <polygon points="20,19 19,22 18,19" fill="#ffffff"/>
    <!-- Lightning Totem Eyes -->
    <rect x="11" y="15" width="3" height="2" fill="#38bdf8"/>
    <rect x="18" y="15" width="3" height="2" fill="#38bdf8"/>
    <circle cx="12.5" cy="16" r="0.8" fill="#ffffff"/>
    <circle cx="19.5" cy="16" r="0.8" fill="#ffffff"/>
    <!-- Lightning Bolt Crest -->
    <polygon points="16,7 18,11 15,11 17,15 13,10 16,10" fill="#facc15"/>
  </svg>`,

  MAGE: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="100%" height="100%">
    <rect width="32" height="32" rx="4" fill="#0c0e24"/>
    <!-- Outer Dalaran Kirin Tor Violet Frame -->
    <rect x="1" y="1" width="30" height="30" rx="3" stroke="#7e22ce" stroke-width="1.2" fill="none"/>
    <!-- Dalaran Arcane Hood & Cowl -->
    <path d="M16 2 L26 12 L24 24 L20 29 L12 29 L8 24 L6 12 Z" fill="#1e3a5f"/>
    <!-- Hood Shadow Depth -->
    <path d="M16 6 L22 12 L21 21 L16 25 L11 21 L10 12 Z" fill="#0d1b2a"/>
    <!-- Arcane Gold Filigree & Kirin Tor Eye -->
    <path d="M16 4 L19 8 L16 10 L13 8 Z" fill="#e0a3ff"/>
    <circle cx="16" cy="7" r="1.5" fill="#facc15"/>
    <line x1="8" y1="14" x2="24" y2="14" stroke="#69ccf0" stroke-width="1"/>
    <!-- Glowing Arcane Eyes -->
    <rect x="12" y="16" width="3" height="2" fill="#93c5fd"/>
    <rect x="17" y="16" width="3" height="2" fill="#93c5fd"/>
    <circle cx="13.5" cy="17" r="0.8" fill="#ffffff"/>
    <circle cx="18.5" cy="17" r="0.8" fill="#ffffff"/>
    <!-- Floating Mana Sparkles -->
    <rect x="4" y="8" width="2" height="2" fill="#60a5fa"/>
    <rect x="26" y="20" width="2" height="2" fill="#c084fc"/>
  </svg>`,

  ROGUE: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="100%" height="100%">
    <rect width="32" height="32" rx="4" fill="#121305"/>
    <!-- Outer Shadowcraft Leather Frame -->
    <rect x="1" y="1" width="30" height="30" rx="3" stroke="#a16207" stroke-width="1.2" fill="none"/>
    <!-- Shadowstalker Leather Cowl -->
    <path d="M7 6 L25 6 L26 18 L21 28 L11 28 L6 18 Z" fill="#2d2d0f"/>
    <!-- Leather Bandana / Face Mask -->
    <path d="M9 17 L23 17 L21 27 L11 27 Z" fill="#4d4d1a"/>
    <!-- Sinister Eye Slits -->
    <path d="M10 13 L15 15 L14 16 L9 14 Z" fill="#000000"/>
    <path d="M22 13 L17 15 L18 16 L23 14 Z" fill="#000000"/>
    <rect x="11" y="14" width="3" height="1.5" fill="#fde047"/>
    <rect x="18" y="14" width="3" height="1.5" fill="#fde047"/>
    <!-- Poison Droplet on Mask -->
    <circle cx="16" cy="23" r="1.5" fill="#22c55e"/>
    <circle cx="16" cy="22.5" r="0.7" fill="#86efac"/>
  </svg>`,

  WARRIOR: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="100%" height="100%">
    <rect width="32" height="32" rx="4" fill="#1f140e"/>
    <rect x="1" y="1" width="30" height="30" rx="3" stroke="#c79c6e" stroke-width="1.2" fill="none"/>
    <path d="M6 10 L16 4 L26 10 L24 24 L16 28 L8 24 Z" fill="#78350f"/>
    <polygon points="16,8 22,14 10,14" fill="#c79c6e"/>
    <rect x="11" y="16" width="3" height="2" fill="#ef4444"/>
    <rect x="18" y="16" width="3" height="2" fill="#ef4444"/>
  </svg>`,

  PALADIN: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="100%" height="100%">
    <rect width="32" height="32" rx="4" fill="#260f1c"/>
    <rect x="1" y="1" width="30" height="30" rx="3" stroke="#f58cba" stroke-width="1.2" fill="none"/>
    <polygon points="16,4 20,12 28,12 21,17 24,25 16,20 8,25 11,17 4,12 12,12" fill="#fde047"/>
    <rect x="11" y="15" width="3" height="2" fill="#67e8f9"/>
    <rect x="18" y="15" width="3" height="2" fill="#67e8f9"/>
  </svg>`,

  HUNTER: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="100%" height="100%">
    <rect width="32" height="32" rx="4" fill="#131e0b"/>
    <rect x="1" y="1" width="30" height="30" rx="3" stroke="#abd473" stroke-width="1.2" fill="none"/>
    <circle cx="16" cy="16" r="10" stroke="#abd473" stroke-width="2" fill="none"/>
    <line x1="16" y1="4" x2="16" y2="28" stroke="#abd473" stroke-width="1.5"/>
    <line x1="4" y1="16" x2="28" y2="16" stroke="#abd473" stroke-width="1.5"/>
    <circle cx="16" cy="16" r="3" fill="#bef264"/>
  </svg>`,

  PRIEST: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="100%" height="100%">
    <rect width="32" height="32" rx="4" fill="#1a1a24"/>
    <rect x="1" y="1" width="30" height="30" rx="3" stroke="#e2e8f0" stroke-width="1.2" fill="none"/>
    <circle cx="16" cy="12" r="6" stroke="#fef08a" stroke-width="2" fill="none"/>
    <path d="M10 20 L22 20 L19 28 L13 28 Z" fill="#f8fafc"/>
    <rect x="15" y="18" width="2" height="8" fill="#eab308"/>
    <rect x="12" y="21" width="8" height="2" fill="#eab308"/>
  </svg>`,

  WARLOCK: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="100%" height="100%">
    <rect width="32" height="32" rx="4" fill="#160d24"/>
    <rect x="1" y="1" width="30" height="30" rx="3" stroke="#9482c9" stroke-width="1.2" fill="none"/>
    <polygon points="16,6 24,24 8,24" stroke="#a855f7" stroke-width="1.5" fill="none"/>
    <circle cx="16" cy="17" r="4" fill="#84cc16"/>
    <circle cx="16" cy="17" r="2" fill="#facc15"/>
  </svg>`,
};

/** 运行时可变：优先 ART/resources/class_*.jpg，否则手绘 DEFAULT */
export const CLASS_PIXEL_AVATARS: Record<ClassId, string> = {
  ...DEFAULT_CLASS_PIXEL_AVATARS,
};

/**
 * 4.3 原版风格经典自绘技能图标 SVG 矢量图库 (统一 36x36 视口与立体暗色斜角边框)
 */
export const DEFAULT_SPELL_ICONS: Record<string, string> = {
  // ── Death Knight ──────────────────────────────
  death_strike: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#180407"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#881337" stroke-width="1.5"/>
    <path d="M6 30 L28 8 M28 8 L22 8 M28 8 L28 14" stroke="#e11d48" stroke-width="3" stroke-linecap="round"/>
    <circle cx="15" cy="21" r="5.5" fill="#4c0519" stroke="#fda4af" stroke-width="1.5"/>
    <circle cx="13" cy="20" r="1" fill="#fff"/>
    <circle cx="17" cy="20" r="1" fill="#fff"/>
    <path d="M13 23 L17 23" stroke="#fff" stroke-width="1"/>
    <!-- Blood Shield Crest -->
    <path d="M22 16 Q28 20 25 28 Q20 27 18 20 Z" fill="#059669" opacity="0.9" stroke="#34d399" stroke-width="1"/>
  </svg>`,

  heart_strike: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#220306"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#9f1239" stroke-width="1.5"/>
    <!-- Beating Anatomical Heart Silhouette -->
    <path d="M18 30 C9 22 5 15 9 9 C13 5 17 7 18 10 C19 7 23 5 27 9 C31 15 27 22 18 30 Z" fill="#be123c"/>
    <path d="M18 11 C20 8 23 7 25 10 C27 14 24 19 18 25 C12 19 9 14 11 10 C13 7 16 8 18 11 Z" fill="#e11d48"/>
    <!-- Cleaving Strike Slash -->
    <path d="M5 18 L31 18" stroke="#fecdd3" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M12 6 L24 30" stroke="#f43f5e" stroke-width="2" stroke-linecap="round"/>
  </svg>`,

  death_and_decay: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#140205"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#4c0519" stroke-width="1.5"/>
    <circle cx="18" cy="18" r="13" stroke="#881337" stroke-width="2" stroke-dasharray="3 2"/>
    <circle cx="18" cy="18" r="7.5" fill="#4c0519" stroke="#be123c" stroke-width="1"/>
    <!-- Defile Corrupted Runes -->
    <path d="M18 5 L18 11 M18 25 L18 31 M5 18 L11 18 M25 18 L31 18 M9 9 L13 13 M23 23 L27 27 M9 27 L13 23 M23 9 L27 13" stroke="#f43f5e" stroke-width="1.8" stroke-linecap="round"/>
    <circle cx="18" cy="18" r="2.5" fill="#fecdd3"/>
  </svg>`,

  rune_strike: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#1a0407"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#be123c" stroke-width="1.5"/>
    <polygon points="18,4 25,14 21,14 27,28 17,28 20,17 14,17" fill="#fb7185" stroke="#ffe4e6" stroke-width="1"/>
    <circle cx="18" cy="18" r="12" stroke="#f43f5e" stroke-width="1.5" stroke-dasharray="2 2"/>
    <line x1="8" y1="28" x2="28" y2="28" stroke="#f43f5e" stroke-width="2" stroke-linecap="round"/>
  </svg>`,

  mind_freeze: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#041226"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#0284c7" stroke-width="1.5"/>
    <!-- Glacial Snowflake Crystal -->
    <polygon points="18,4 22,14 32,18 22,22 18,32 14,22 4,18 14,14" fill="#38bdf8"/>
    <circle cx="18" cy="18" r="4.5" fill="#ffffff"/>
    <!-- Interruption Clash -->
    <path d="M9 9 L27 27 M27 9 L9 27" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round"/>
  </svg>`,

  dark_command: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#18051e"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#7e22ce" stroke-width="1.5"/>
    <!-- Taunting Warhorn -->
    <path d="M9 25 C9 15 15 9 24 7 L24 29 C15 27 9 25 9 25 Z" fill="#9333ea" stroke="#c084fc" stroke-width="1.2"/>
    <circle cx="26" cy="18" r="3.5" fill="#facc15"/>
    <!-- Shouting Waves -->
    <path d="M6 13 Q2 18 6 23 M4 9 Q-1 18 4 27" stroke="#e9d5ff" stroke-width="2" stroke-linecap="round"/>
  </svg>`,

  bone_shield: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#141205"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#a16207" stroke-width="1.5"/>
    <circle cx="18" cy="18" r="13" stroke="#ca8a04" stroke-width="2" stroke-dasharray="4 3"/>
    <!-- Whirling Runic Bone Segments -->
    <rect x="16" y="5" width="4" height="8" rx="2" fill="#fef08a" stroke="#ca8a04" stroke-width="0.8"/>
    <rect x="23" y="16" width="8" height="4" rx="2" fill="#fef08a" stroke="#ca8a04" stroke-width="0.8"/>
    <rect x="16" y="23" width="4" height="8" rx="2" fill="#fef08a" stroke="#ca8a04" stroke-width="0.8"/>
    <rect x="5" y="16" width="8" height="4" rx="2" fill="#fef08a" stroke="#ca8a04" stroke-width="0.8"/>
    <circle cx="18" cy="18" r="4" fill="#854d0e"/>
  </svg>`,

  vampiric_blood: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#250307"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#be123c" stroke-width="1.5"/>
    <!-- Lifedrain Blood Droplet -->
    <path d="M18 5 C18 5 9 15 9 23 C9 28 13 32 18 32 C23 32 27 28 27 23 C27 15 18 5 18 5 Z" fill="#e11d48"/>
    <path d="M18 10 C18 10 12 17 12 23 C12 26 15 29 18 29 C21 29 24 26 24 23 C24 17 18 10 18 10 Z" fill="#f43f5e"/>
    <circle cx="15" cy="22" r="2.5" fill="#fff" opacity="0.7"/>
  </svg>`,

  howling_blast: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#031628"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#0284c7" stroke-width="1.5"/>
    <!-- Screaming Frost Skull -->
    <circle cx="18" cy="18" r="10" fill="#0c4a6e" stroke="#38bdf8" stroke-width="2"/>
    <circle cx="14" cy="16" r="2" fill="#e0f2fe"/>
    <circle cx="22" cy="16" r="2" fill="#e0f2fe"/>
    <path d="M14 22 Q18 26 22 22" stroke="#bae6fd" stroke-width="2" fill="none"/>
    <!-- Arctic Gale Winds -->
    <path d="M5 9 Q18 3 31 9 M4 27 Q18 33 32 27" stroke="#7dd3fc" stroke-width="1.8" stroke-dasharray="4 2"/>
  </svg>`,

  frost_strike: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#021526"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#0369a1" stroke-width="1.5"/>
    <!-- Glacial Runeblade Blade -->
    <path d="M7 29 L27 9 L29 11 L9 31 Z" fill="#38bdf8"/>
    <path d="M27 9 L31 5 L29 3 L25 7 Z" fill="#e0f2fe"/>
    <polygon points="17,17 22,12 28,14 23,20" fill="#0284c7"/>
    <path d="M11 5 L29 23" stroke="#67e8f9" stroke-width="2" stroke-linecap="round"/>
  </svg>`,

  obliterate: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#1c0307"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#be123c" stroke-width="1.5"/>
    <!-- DK Class Icon: Horned Skull Cleave -->
    <path d="M5 5 L31 31 M31 5 L5 31" stroke="#f43f5e" stroke-width="4.5" stroke-linecap="round"/>
    <path d="M5 5 L31 31 M31 5 L5 31" stroke="#fecdd3" stroke-width="2" stroke-linecap="round"/>
    <circle cx="18" cy="18" r="6.5" fill="#881337" stroke="#fda4af" stroke-width="1.5"/>
  </svg>`,

  pillar_of_frost: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#02182b"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#0284c7" stroke-width="1.5"/>
    <!-- Rising Glacial Ice Obelisk -->
    <polygon points="18,3 26,12 23,33 13,33 10,12" fill="#0284c7"/>
    <polygon points="18,3 21,12 18,33 15,33 12,12" fill="#7dd3fc"/>
    <line x1="5" y1="33" x2="31" y2="33" stroke="#bae6fd" stroke-width="2.5" stroke-linecap="round"/>
    <polygon points="7,25 10,17 12,27" fill="#38bdf8"/>
    <polygon points="29,25 26,17 24,27" fill="#38bdf8"/>
  </svg>`,

  horn_of_winter: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#041726"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#0284c7" stroke-width="1.5"/>
    <!-- Carved Warhorn with Freezing Wind -->
    <path d="M9 27 C11 16 17 9 27 7 L27 15 C19 17 15 21 13 29 Z" fill="#67e8f9" stroke="#bae6fd" stroke-width="1"/>
    <circle cx="27" cy="11" r="3.5" fill="#e0f2fe"/>
    <path d="M5 17 Q1 22 5 27" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/>
  </svg>`,

  // ── Druid ─────────────────────────────────────
  lifebloom: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#041c10"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#15803d" stroke-width="1.5"/>
    <!-- Glowing Floral Bloom -->
    <circle cx="18" cy="18" r="4.5" fill="#fef08a"/>
    <ellipse cx="18" cy="9" rx="4" ry="6" fill="#10b981"/>
    <ellipse cx="18" cy="27" rx="4" ry="6" fill="#10b981"/>
    <ellipse cx="9" cy="18" rx="6" ry="4" fill="#10b981"/>
    <ellipse cx="27" cy="18" rx="6" ry="4" fill="#10b981"/>
    <circle cx="18" cy="18" r="9" stroke="#34d399" stroke-width="1.5" opacity="0.7"/>
  </svg>`,

  rejuvenation: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#041a0e"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#166534" stroke-width="1.5"/>
    <!-- Curled Emerald Leaf with Life Dewdrop -->
    <path d="M7 29 C7 15 15 7 29 7 C29 21 21 29 7 29 Z" fill="#059669"/>
    <path d="M7 29 L29 7" stroke="#6ee7b7" stroke-width="2.2" stroke-linecap="round"/>
    <circle cx="22" cy="14" r="3.5" fill="#a7f3d0"/>
  </svg>`,

  regrowth: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#031f12"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#15803d" stroke-width="1.5"/>
    <!-- Sprouting Nature Fern -->
    <path d="M18 31 L18 11 M18 21 Q11 16 9 23 M18 16 Q25 11 27 18 M18 11 Q13 7 18 3" stroke="#34d399" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="18" cy="5" r="3.5" fill="#fde047"/>
  </svg>`,

  healing_touch: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#021c10"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#10b981" stroke-width="1.5"/>
    <!-- Radiant Life Energy Core -->
    <circle cx="18" cy="15" r="9" fill="#047857" opacity="0.6"/>
    <circle cx="18" cy="15" r="5" fill="#34d399"/>
    <circle cx="18" cy="15" r="2.5" fill="#fef08a"/>
    <!-- Healing Hand Palm & Reaching Fingers -->
    <path d="M11 29 C11 25 13 23 15 21 L15 15 C15 14 16 13 17 13 C18 13 19 14 19 15 L19 21 C20 21 21 16 22 16 C23 16 24 17 24 18 L24 22 C25 22 26 19 27 19 C28 19 29 20 29 21 L29 25 C28 29 24 31 18 31 C14 31 11 30 11 29 Z" fill="#6ee7b7"/>
    <!-- Divine Nature Rays -->
    <line x1="18" y1="3" x2="18" y2="7" stroke="#fde047" stroke-width="2" stroke-linecap="round"/>
    <line x1="8" y1="8" x2="11" y2="11" stroke="#a7f3d0" stroke-width="1.5" stroke-linecap="round"/>
    <line x1="28" y1="8" x2="25" y2="11" stroke="#a7f3d0" stroke-width="1.5" stroke-linecap="round"/>
  </svg>`,

  swiftmend: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#021c10"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#047857" stroke-width="1.5"/>
    <!-- Idol of Rejuvenation Emblem -->
    <circle cx="18" cy="18" r="11.5" fill="#047857"/>
    <polygon points="18,5 23,13 31,18 23,23 18,31 13,23 5,18 13,13" fill="#6ee7b7"/>
    <circle cx="18" cy="18" r="3.5" fill="#ffffff"/>
  </svg>`,

  wild_growth: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#031e0f"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#15803d" stroke-width="1.5"/>
    <!-- Flourishing Leafy Canopies -->
    <path d="M5 31 Q13 9 25 5 M11 31 Q17 13 31 11 M3 19 Q11 25 17 31" stroke="#10b981" stroke-width="2.2" stroke-linecap="round"/>
    <circle cx="25" cy="5" r="3.5" fill="#a7f3d0"/>
    <circle cx="31" cy="11" r="3" fill="#a7f3d0"/>
  </svg>`,

  natures_swiftness: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#022115"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#059669" stroke-width="1.5"/>
    <!-- Emerald Wings of Swiftness & Nature Gust Trails -->
    <path d="M6 24 C10 18 16 14 26 10 C20 16 16 22 10 28 Z" fill="#10b981"/>
    <path d="M12 28 C16 22 22 17 31 13 C26 19 22 24 16 30 Z" fill="#34d399"/>
    <!-- Radiant Golden Energy Feather Core -->
    <path d="M18 10 C24 8 28 8 32 6 C30 11 28 15 24 18 Z" fill="#fbbf24"/>
    <circle cx="20" cy="16" r="2.5" fill="#fef08a"/>
    <line x1="8" y1="26" x2="28" y2="10" stroke="#a7f3d0" stroke-width="1.5" stroke-linecap="round"/>
    <!-- Wind speed lines -->
    <line x1="5" y1="12" x2="15" y2="7" stroke="#6ee7b7" stroke-width="1.2" stroke-linecap="round"/>
    <line x1="14" y1="32" x2="26" y2="28" stroke="#34d399" stroke-width="1.2" stroke-linecap="round"/>
  </svg>`,

  tranquility: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <!-- Dark Beveled Stone Frame -->
    <rect width="36" height="36" rx="3" fill="#031b0e"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#14532d" stroke-width="1.5"/>
    <!-- Canopy of Emerald Leaves -->
    <path d="M4 4 C10 12 14 6 18 10 C22 6 26 12 32 4 C32 14 26 16 18 14 C10 16 4 14 4 4 Z" fill="#15803d"/>
    <path d="M8 6 C12 12 16 8 18 11 C20 8 24 12 28 6" stroke="#4ade80" stroke-width="1.2" fill="none"/>
    <!-- Night Elf Druidess Face in Serene Meditation -->
    <path d="M12 14 C12 10 24 10 24 14 C24 22 21 28 18 28 C15 28 12 22 12 14 Z" fill="#6b21a8"/>
    <path d="M13 15 C13 12 23 12 23 15 C23 20 20 25 18 25 C16 25 13 20 13 15 Z" fill="#9333ea"/>
    <!-- Gentle Closed Slanted Eyes -->
    <path d="M14 17 L16 18" stroke="#fef08a" stroke-width="1.2" stroke-linecap="round"/>
    <path d="M22 17 L20 18" stroke="#fef08a" stroke-width="1.2" stroke-linecap="round"/>
    <!-- Long Night Elf Ears Arching Upward -->
    <path d="M12 15 L5 11 L11 18 Z" fill="#7e22ce"/>
    <path d="M24 15 L31 11 L25 18 Z" fill="#7e22ce"/>
    <!-- Cascading Glowing Rain Droplets (Tranquility Rain) -->
    <circle cx="8" cy="22" r="1.2" fill="#86efac"/>
    <circle cx="10" cy="28" r="1.5" fill="#fef08a"/>
    <circle cx="18" cy="31" r="1.8" fill="#4ade80"/>
    <circle cx="26" cy="24" r="1.2" fill="#86efac"/>
    <circle cx="28" cy="30" r="1.5" fill="#fef08a"/>
    <!-- Downward Beams of Starlight -->
    <line x1="8" y1="18" x2="8" y2="25" stroke="#bbf7d0" stroke-width="1" stroke-linecap="round"/>
    <line x1="28" y1="19" x2="28" y2="26" stroke="#bbf7d0" stroke-width="1" stroke-linecap="round"/>
    <line x1="18" y1="28" x2="18" y2="34" stroke="#fef08a" stroke-width="1.5" stroke-linecap="round"/>
  </svg>`,

  revive: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#1e1602"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#b45309" stroke-width="1.5"/>
    <!-- Golden Ankh / Resurrect Sunbeam -->
    <circle cx="18" cy="11" r="5.5" stroke="#facc15" stroke-width="2.5"/>
    <line x1="18" y1="16.5" x2="18" y2="31" stroke="#facc15" stroke-width="3" stroke-linecap="round"/>
    <line x1="11" y1="21" x2="25" y2="21" stroke="#facc15" stroke-width="3" stroke-linecap="round"/>
    <circle cx="18" cy="11" r="2.5" fill="#fff"/>
  </svg>`,

  rebirth: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#022c16"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#16a34a" stroke-width="1.5"/>
    <!-- Combat Rebirth Ankh & Sprouting Life Vine -->
    <circle cx="18" cy="11" r="5.5" stroke="#4ade80" stroke-width="2.5"/>
    <line x1="18" y1="16.5" x2="18" y2="31" stroke="#4ade80" stroke-width="3" stroke-linecap="round"/>
    <line x1="11" y1="21" x2="25" y2="21" stroke="#4ade80" stroke-width="3" stroke-linecap="round"/>
    <!-- Radiant Life Leaves -->
    <path d="M11 15 C9 11 13 8 16 10 C15 13 13 15 11 15 Z" fill="#86efac"/>
    <path d="M25 15 C27 11 23 8 20 10 C21 13 23 15 25 15 Z" fill="#86efac"/>
    <circle cx="18" cy="11" r="2" fill="#fef08a"/>
    <circle cx="9" cy="27" r="1.5" fill="#a7f3d0"/>
    <circle cx="27" cy="27" r="1.5" fill="#a7f3d0"/>
  </svg>`,

  nourish: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#041d13"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#059669" stroke-width="1.5"/>
    <!-- Sprouting Life Leaf -->
    <path d="M18 29 C18 20 11 16 7 16 C7 25 13 29 18 29 Z" fill="#059669"/>
    <path d="M18 29 C18 18 25 11 31 9 C31 21 23 29 18 29 Z" fill="#10b981"/>
    <path d="M18 29 L18 11 C18 7 20 5 22 3" stroke="#6ee7b7" stroke-width="2.2" stroke-linecap="round"/>
    <circle cx="22" cy="5" r="2" fill="#d1fae5"/>
    <circle cx="11" cy="18" r="1.5" fill="#a7f3d0"/>
  </svg>`,

  natures_cure: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#02211a"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#0f766e" stroke-width="1.5"/>
    <!-- Purifying Dewdrop & Emerald Sparkle -->
    <path d="M18 3 C18 3 8 16 8 24 C8 29 12 33 18 33 C24 33 28 29 28 24 C28 16 18 3 18 3 Z" fill="#0d9488" stroke="#5eead4" stroke-width="1.5"/>
    <path d="M15 18 C15 13 18 9 18 9 C18 9 21 13 21 18 C21 21 19 23 18 23 C17 23 15 21 15 18 Z" fill="#99f6e4"/>
    <polygon points="18,11 20,16 25,18 20,20 18,25 16,20 11,18 16,16" fill="#fef08a"/>
  </svg>`,

  remove_corruption: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#082110"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#15803d" stroke-width="1.5"/>
    <!-- Emerald Leaf Dispel -->
    <path d="M18 5 C25 9 29 16 29 23 C29 29 23 31 18 31 C13 31 7 29 7 23 C7 16 11 9 18 5 Z" fill="#15803d" stroke="#86efac" stroke-width="1.5"/>
    <path d="M18 11 L18 26 M13 18 L18 23 M23 15 L18 20" stroke="#fef08a" stroke-width="1.8" stroke-linecap="round"/>
  </svg>`,

  starsurge: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#0d0924"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#6366f1" stroke-width="1.5"/>
    <!-- Celestial Astral Surge -->
    <circle cx="18" cy="18" r="10.5" fill="#6366f1"/>
    <polygon points="18,2 22,14 34,18 22,22 18,34 14,22 2,18 14,14" fill="#facc15"/>
    <circle cx="18" cy="18" r="5" fill="#fef08a"/>
  </svg>`,

  wrath: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#051a0d"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#16a34a" stroke-width="1.5"/>
    <!-- Emerald Nature Orb -->
    <circle cx="18" cy="18" r="10.5" fill="#10b981"/>
    <circle cx="18" cy="18" r="6" fill="#a7f3d0"/>
    <path d="M7 7 Q18 12 29 7 M7 29 Q18 24 29 29" stroke="#34d399" stroke-width="2.2" stroke-linecap="round"/>
  </svg>`,

  starfire: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#130826"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#9333ea" stroke-width="1.5"/>
    <!-- Pillar of Moon & Star Light -->
    <path d="M13 3 L23 3 L21 33 L15 33 Z" fill="#c084fc"/>
    <circle cx="18" cy="18" r="8.5" fill="#e9d5ff" opacity="0.6"/>
    <polygon points="18,7 21,14 29,18 21,22 18,29 15,22 7,18 15,14" fill="#fef08a"/>
  </svg>`,

  moonfire: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#080e26"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#2563eb" stroke-width="1.5"/>
    <!-- Crescent Moon & Silvery Beam -->
    <path d="M23 5 C14 5 9 13 9 22 C9 26 11 29 13 31 C9 26 11 17 18 13 C23 10 27 11 29 13 C27 8 25 5 23 5 Z" fill="#60a5fa"/>
    <circle cx="20" cy="18" r="3.5" fill="#ffffff"/>
  </svg>`,

  sunfire: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#240a02"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#d97706" stroke-width="1.5"/>
    <!-- Solar Flare -->
    <circle cx="18" cy="18" r="8.5" fill="#f97316"/>
    <circle cx="18" cy="18" r="4.5" fill="#fef08a"/>
    <path d="M18 3 L18 8 M18 28 L18 33 M3 18 L8 18 M28 18 L33 18" stroke="#facc15" stroke-width="2.5" stroke-linecap="round"/>
  </svg>`,

  innervate: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#041c18"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#0891b2" stroke-width="1.5"/>
    <!-- Font of Blue/Green Mana -->
    <path d="M18 5 C11 13 7 20 11 27 C15 31 21 31 25 27 C29 20 25 13 18 5 Z" fill="#06b6d4"/>
    <circle cx="18" cy="20" r="3.5" fill="#67e8f9"/>
    <path d="M13 16 L23 16" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round"/>
  </svg>`,

  // ── Shaman ────────────────────────────────────
  riptide: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#03162b"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#0284c7" stroke-width="1.5"/>
    <path d="M5 27 C11 13 20 13 25 17 C29 21 29 9 25 7 C18 5 9 17 5 27 Z" fill="#0284c7"/>
    <path d="M7 29 C15 20 24 20 31 13" stroke="#7dd3fc" stroke-width="2.8" stroke-linecap="round"/>
  </svg>`,

  healing_wave: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#021a30"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#0369a1" stroke-width="1.5"/>
    <path d="M3 23 C10 16 14 24 20 18 C26 12 30 20 35 15" stroke="#38bdf8" stroke-width="3.2" stroke-linecap="round"/>
    <circle cx="18" cy="11" r="4.5" fill="#7dd3fc"/>
  </svg>`,

  healing_surge: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#042036"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#0284c7" stroke-width="1.5"/>
    <!-- Surging Wave Crest -->
    <path d="M3 29 Q10 20 18 22 Q26 24 33 13 L33 33 L3 33 Z" fill="#0284c7"/>
    <path d="M5 25 Q14 14 22 16 Q28 18 33 7 L33 21 Q24 25 5 25 Z" fill="#38bdf8"/>
    <path d="M22 13 C26 11 30 5 33 3 C30 9 26 13 20 15 Z" fill="#bae6fd"/>
    <circle cx="14" cy="11" r="2.2" fill="#e0f2fe"/>
    <circle cx="21" cy="7" r="1.8" fill="#ffffff"/>
  </svg>`,

  greater_healing_wave: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#021b33"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#0369a1" stroke-width="1.5"/>
    <!-- Massive Oceanic Healing Wave -->
    <path d="M3 31 Q12 18 20 20 Q28 22 33 9 L33 33 L3 33 Z" fill="#0369a1"/>
    <path d="M7 27 Q16 12 24 14 Q30 16 33 5 L33 17 Q24 23 7 27 Z" fill="#0284c7"/>
    <path d="M16 13 Q22 5 31 3 Q27 11 18 15 Z" fill="#38bdf8"/>
    <circle cx="29" cy="5" r="3" fill="#fde047"/>
    <polygon points="29,1 31,5 35,7 31,9 29,13 27,9 23,7 27,5" fill="#ffffff"/>
  </svg>`,

  chain_heal: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#031e36"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#0284c7" stroke-width="1.5"/>
    <!-- Chain linking 3 nodes -->
    <circle cx="8" cy="25" r="4.5" fill="#38bdf8"/>
    <circle cx="18" cy="11" r="5.5" fill="#7dd3fc"/>
    <circle cx="28" cy="23" r="4.5" fill="#38bdf8"/>
    <line x1="10" y1="22" x2="15" y2="14" stroke="#bae6fd" stroke-width="3" stroke-linecap="round"/>
    <line x1="21" y1="14" x2="26" y2="21" stroke="#bae6fd" stroke-width="3" stroke-linecap="round"/>
  </svg>`,

  healing_rain: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#031c2e"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#0284c7" stroke-width="1.5"/>
    <ellipse cx="18" cy="28" rx="13" ry="4.5" stroke="#38bdf8" stroke-width="1.8"/>
    <line x1="11" y1="7" x2="10" y2="18" stroke="#7dd3fc" stroke-width="2.2" stroke-linecap="round"/>
    <line x1="18" y1="5" x2="17" y2="21" stroke="#7dd3fc" stroke-width="2.2" stroke-linecap="round"/>
    <line x1="25" y1="9" x2="24" y2="20" stroke="#7dd3fc" stroke-width="2.2" stroke-linecap="round"/>
  </svg>`,

  spirit_link: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#022121"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#0d9488" stroke-width="1.5"/>
    <circle cx="18" cy="18" r="12.5" stroke="#2dd4bf" stroke-width="2" stroke-dasharray="4 2"/>
    <rect x="16" y="9" width="4" height="18" fill="#14b8a6"/>
    <rect x="12" y="9" width="12" height="4" fill="#facc15"/>
  </svg>`,

  cleanse_spirit: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#032626"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#0f766e" stroke-width="1.5"/>
    <path d="M18 3 C13 9 9 15 9 22 C9 29 13 33 18 33 C23 33 27 29 27 22 C27 15 23 9 18 3 Z" fill="#0f766e" stroke="#2dd4bf" stroke-width="1.5"/>
    <path d="M18 9 C15 14 12 18 12 22 C12 26 15 29 18 29 C21 29 24 26 24 22 C24 18 21 14 18 9 Z" fill="#14b8a6"/>
    <polygon points="18,13 20,17 25,18 20,20 18,25 16,20 11,18 16,17" fill="#e0e7ff"/>
  </svg>`,

  wind_shear: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#061a29"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#0284c7" stroke-width="1.5"/>
    <path d="M5 9 C18 5 22 17 31 13" stroke="#e0f2fe" stroke-width="3" stroke-linecap="round"/>
    <path d="M7 25 C16 21 22 31 31 23" stroke="#93c5fd" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M13 11 L23 25 M23 11 L13 25" stroke="#ef4444" stroke-width="2.2" stroke-linecap="round"/>
  </svg>`,

  bloodlust: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#2d0303"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#991b1b" stroke-width="1.5"/>
    <!-- Orc Roaring Silhouette with Flaming Eyes -->
    <path d="M9 29 L13 16 L18 9 L23 16 L27 29 Z" fill="#991b1b"/>
    <circle cx="13" cy="18" r="2.2" fill="#facc15"/>
    <circle cx="23" cy="18" r="2.2" fill="#facc15"/>
    <path d="M13 25 L18 23 L23 25 L18 27 Z" fill="#ffffff"/>
  </svg>`,

  ancestral_spirit: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#032024"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#0d9488" stroke-width="1.5"/>
    <path d="M18 5 C11 5 9 13 9 20 C9 27 13 31 18 31 C23 31 27 27 27 20 C27 13 25 5 18 5 Z" fill="#5eead4" opacity="0.85"/>
    <circle cx="14.5" cy="16" r="1.8" fill="#042f2e"/>
    <circle cx="21.5" cy="16" r="1.8" fill="#042f2e"/>
  </svg>`,

  lightning_bolt: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#041226"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#0284c7" stroke-width="1.5"/>
    <!-- Yellow/Cyan Lightning Zigzag -->
    <polygon points="21,3 11,18 18,18 14,33 26,16 19,16" fill="#facc15" stroke="#38bdf8" stroke-width="1"/>
  </svg>`,

  lava_burst: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#2d0505"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#b91c1c" stroke-width="1.5"/>
    <!-- Molten Magma Boulder -->
    <circle cx="18" cy="18" r="10.5" fill="#dc2626"/>
    <circle cx="18" cy="18" r="6.5" fill="#f97316"/>
    <circle cx="18" cy="18" r="3" fill="#fef08a"/>
    <path d="M11 13 Q18 7 25 13 M11 23 Q18 29 25 23" stroke="#ea580c" stroke-width="2.2" stroke-linecap="round"/>
  </svg>`,

  chain_lightning: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="4" fill="#041226"/>
    <!-- Classic Beveled Dark Border -->
    <rect x="1" y="1" width="34" height="34" rx="3" stroke="#2563eb" stroke-width="1.5"/>
    <!-- Branching Blue/White Forked Lightning -->
    <path d="M18 4 L13 15 L20 15 L14 26 L23 18 L17 18 L24 4 Z" fill="#38bdf8" stroke="#bae6fd" stroke-width="1"/>
    <path d="M20 15 L28 22 M14 26 L8 32 M17 18 L26 28" stroke="#e0f2fe" stroke-width="2" stroke-linecap="round"/>
    <circle cx="18" cy="16" r="3" fill="#ffffff"/>
  </svg>`,

  flame_shock: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#260606"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#dc2626" stroke-width="1.5"/>
    <!-- Flame Tongue / Shockwave -->
    <path d="M18 5 C13 12 11 16 14 23 C15 26 18 29 22 29 C25 29 27 25 25 21 C23 17 25 12 18 5 Z" fill="#ef4444"/>
    <path d="M18 11 Q21 18 18 25" stroke="#fde047" stroke-width="2.2" stroke-linecap="round"/>
  </svg>`,

  earth_shock: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#1c1106"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#b45309" stroke-width="1.5"/>
    <!-- Shattered Earth Stone -->
    <polygon points="18,5 29,13 25,29 11,29 7,13" fill="#b45309"/>
    <line x1="18" y1="5" x2="18" y2="29" stroke="#fde68a" stroke-width="1.8"/>
    <line x1="7" y1="13" x2="29" y2="13" stroke="#fde68a" stroke-width="1.8"/>
  </svg>`,

  // ── Mage ──────────────────────────────────────
  fireball: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#290702"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#c2410c" stroke-width="1.5"/>
    <!-- Flaming Meteor -->
    <circle cx="21" cy="15" r="8.5" fill="#ea580c"/>
    <circle cx="22" cy="14" r="5" fill="#facc15"/>
    <circle cx="23" cy="13" r="2.2" fill="#ffffff"/>
    <path d="M13 19 C7 25 5 29 7 31 C11 31 15 27 17 23" fill="#c2410c"/>
    <path d="M9 13 C3 18 3 24 6 27" stroke="#fb923c" stroke-width="2.2" stroke-linecap="round"/>
  </svg>`,

  living_bomb: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#260402"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#b91c1c" stroke-width="1.5"/>
    <circle cx="18" cy="21" r="10.5" fill="#dc2626"/>
    <rect x="16" y="8" width="4" height="4" fill="#451a03"/>
    <path d="M18 8 Q24 3 29 5" stroke="#fbbf24" stroke-width="2.2" stroke-linecap="round"/>
    <circle cx="29" cy="5" r="2.5" fill="#f97316"/>
  </svg>`,

  pyroblast: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#300302"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#dc2626" stroke-width="1.5"/>
    <circle cx="18" cy="18" r="13.5" fill="#b91c1c"/>
    <circle cx="18" cy="18" r="9.5" fill="#f97316"/>
    <circle cx="18" cy="18" r="5.5" fill="#fde047"/>
    <circle cx="18" cy="18" r="2.5" fill="#ffffff"/>
  </svg>`,

  combustion: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#240402"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#ea580c" stroke-width="1.5"/>
    <polygon points="18,2 24,13 34,18 26,24 29,35 18,27 7,35 10,24 2,18 12,13" fill="#f97316"/>
    <circle cx="18" cy="18" r="5.5" fill="#fef08a"/>
  </svg>`,

  counterspell: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#061426"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#0284c7" stroke-width="1.5"/>
    <polygon points="18,5 29,11 29,25 18,31 7,25 7,11" stroke="#38bdf8" stroke-width="2.2" fill="none"/>
    <line x1="7" y1="7" x2="29" y2="29" stroke="#ef4444" stroke-width="3.2" stroke-linecap="round"/>
  </svg>`,

  time_warp: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#180726"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#7e22ce" stroke-width="1.5"/>
    <!-- Hourglass of Time -->
    <path d="M9 7 L27 7 L18 18 L27 29 L9 29 L18 18 Z" fill="#c084fc" stroke="#f3e8ff" stroke-width="1.8"/>
    <circle cx="18" cy="18" r="2.5" fill="#ffffff"/>
  </svg>`,

  arcane_blast: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#140526"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#9333ea" stroke-width="1.5"/>
    <polygon points="18,3 25,13 35,18 25,23 18,33 11,23 1,18 11,13" fill="#c084fc"/>
    <circle cx="18" cy="18" r="5.5" fill="#fdf4ff"/>
  </svg>`,

  arcane_missiles: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#120424"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#a855f7" stroke-width="1.5"/>
    <!-- 3 Tracking Arcane Darts -->
    <polygon points="9,7 14,14 7,14" fill="#e879f9"/>
    <polygon points="27,9 29,16 23,16" fill="#e879f9"/>
    <polygon points="18,19 23,29 13,29" fill="#c084fc"/>
  </svg>`,

  arcane_barrage: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#160329"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#7e22ce" stroke-width="1.5"/>
    <circle cx="18" cy="18" r="9.5" fill="#a855f7"/>
    <circle cx="18" cy="18" r="4.5" fill="#ffffff"/>
    <line x1="5" y1="5" x2="31" y2="31" stroke="#f0abfc" stroke-width="2.2" stroke-linecap="round"/>
  </svg>`,

  arcane_power: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#1c0533"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#a855f7" stroke-width="1.5"/>
    <circle cx="18" cy="18" r="11.5" stroke="#e879f9" stroke-width="2"/>
    <polygon points="18,7 27,25 9,25" stroke="#c084fc" stroke-width="2" fill="none"/>
  </svg>`,

  frostbolt: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#021426"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#0284c7" stroke-width="1.5"/>
    <!-- Frost Arrow / Spear -->
    <polygon points="18,3 24,15 20,15 20,33 16,33 16,15 12,15" fill="#38bdf8"/>
    <circle cx="18" cy="9" r="3.5" fill="#ffffff"/>
  </svg>`,

  ice_lance: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#031629"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#38bdf8" stroke-width="1.5"/>
    <!-- Quick Ice Shard -->
    <polygon points="7,29 29,7 25,5 5,25" fill="#7dd3fc"/>
    <line x1="9" y1="27" x2="27" y2="9" stroke="#ffffff" stroke-width="1.8"/>
  </svg>`,

  deep_freeze: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#021121"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#0369a1" stroke-width="1.5"/>
    <!-- Frozen Block with Glacial Cracks -->
    <rect x="7" y="7" width="22" height="22" rx="2" fill="#0284c7" stroke="#bae6fd" stroke-width="2"/>
    <line x1="7" y1="7" x2="29" y2="29" stroke="#ffffff" stroke-width="1.8"/>
  </svg>`,

  frozen_orb: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#03182b"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#0284c7" stroke-width="1.5"/>
    <!-- Whirling Blizzard Orb -->
    <circle cx="18" cy="18" r="10.5" fill="#0284c7" stroke="#38bdf8" stroke-width="2"/>
    <path d="M9 18 Q18 9 27 18 Q18 27 9 18" stroke="#ffffff" stroke-width="2.2" fill="none"/>
  </svg>`,

  remove_curse: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#1b1236"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#7c3aed" stroke-width="1.5"/>
    <!-- Arcane Dispel Rune -->
    <circle cx="18" cy="18" r="12.5" stroke="#a855f7" stroke-width="2" stroke-dasharray="4 2"/>
    <path d="M11 11 L25 25 M25 11 L11 25" stroke="#c084fc" stroke-width="2.8" stroke-linecap="round"/>
    <polygon points="18,7 20,13 27,15 21,17 19,25 17,19 11,17 17,15" fill="#facc15"/>
  </svg>`,

  arcane_brilliance: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="4" fill="#13082b"/>
    <rect x="1" y="1" width="34" height="34" rx="3" stroke="#9333ea" stroke-width="1.5"/>
    <!-- Dalaran Arcane Eye of Kirin Tor -->
    <path d="M6 18 Q18 6 30 18 Q18 30 6 18 Z" fill="#3b0764" stroke="#c084fc" stroke-width="2"/>
    <circle cx="18" cy="18" r="6" fill="#facc15" stroke="#fef08a" stroke-width="1"/>
    <circle cx="18" cy="18" r="2.5" fill="#581c87"/>
    <!-- Radiant Sunburst Rays -->
    <line x1="18" y1="3" x2="18" y2="7" stroke="#fde047" stroke-width="2"/>
    <line x1="18" y1="29" x2="18" y2="33" stroke="#fde047" stroke-width="2"/>
    <line x1="3" y1="18" x2="7" y2="18" stroke="#fde047" stroke-width="2"/>
    <line x1="29" y1="18" x2="33" y2="18" stroke="#fde047" stroke-width="2"/>
  </svg>`,

  // ── Rogue ─────────────────────────────────────
  sinister_strike: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#1e1803"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#ca8a04" stroke-width="1.5"/>
    <!-- Crossed Sinister Daggers -->
    <path d="M7 29 L29 7 M29 7 L23 7 M29 7 L29 13" stroke="#eab308" stroke-width="3" stroke-linecap="round"/>
    <path d="M29 29 L7 7 M7 7 L13 7 M7 7 L7 13" stroke="#ca8a04" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="18" cy="18" r="3.5" fill="#facc15"/>
  </svg>`,

  slice_and_dice: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#1c1602"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#eab308" stroke-width="1.5"/>
    <!-- Speed Slices -->
    <path d="M5 11 Q20 7 31 9 M5 18 Q20 18 31 18 M5 25 Q20 29 31 27" stroke="#facc15" stroke-width="2.8" stroke-linecap="round"/>
  </svg>`,

  eviscerate: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#290305"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#dc2626" stroke-width="1.5"/>
    <polygon points="18,3 23,15 35,18 25,24 28,35 18,27 8,35 11,24 1,18 13,15" fill="#ef4444"/>
    <circle cx="18" cy="18" r="4.5" fill="#fef08a"/>
  </svg>`,

  kick: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#210f03"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#d97706" stroke-width="1.5"/>
    <!-- Striking Boot with Impact Stars -->
    <path d="M7 7 L13 21 L24 23 L26 27 L9 27 Z" fill="#d97706"/>
    <polygon points="26,11 28,15 33,15 29,18 30,22 26,19 22,22 23,18 19,15 24,15" fill="#facc15"/>
  </svg>`,

  adrenaline_rush: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#290505"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#ef4444" stroke-width="1.5"/>
    <!-- Rushing Adrenaline Heart / Speed Waves -->
    <path d="M18 29 C11 23 7 16 11 10 C14 6 18 9 18 9 C18 9 22 6 25 10 C29 16 25 23 18 29 Z" fill="#f87171"/>
    <polygon points="18,5 20,13 27,13 22,17 24,25 18,20 12,25 14,17 9,13 16,13" fill="#fbbf24"/>
  </svg>`,

  mutilate: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#1a0407"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#991b1b" stroke-width="1.5"/>
    <!-- Dual Crossed Poison Daggers -->
    <path d="M7 7 L25 25 L23 29 L5 11 Z" fill="#22c55e"/>
    <path d="M29 7 L11 25 L13 29 L31 11 Z" fill="#ef4444"/>
    <circle cx="18" cy="18" r="3.5" fill="#facc15"/>
  </svg>`,

  envenom: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#041a08"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#15803d" stroke-width="1.5"/>
    <!-- Dripping Green Venom Skull -->
    <circle cx="18" cy="15" r="8.5" fill="#15803d"/>
    <circle cx="15" cy="14" r="1.8" fill="#4ade80"/>
    <circle cx="21" cy="14" r="1.8" fill="#4ade80"/>
    <path d="M18 23 L18 33 M15 25 L15 31" stroke="#86efac" stroke-width="2.2" stroke-linecap="round"/>
  </svg>`,

  rupture: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#240305"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#b91c1c" stroke-width="1.5"/>
    <!-- Deep Bleeding Gash -->
    <path d="M7 7 C13 16 17 24 29 29" stroke="#dc2626" stroke-width="4.5" stroke-linecap="round"/>
    <circle cx="13" cy="22" r="2.5" fill="#ef4444"/>
    <circle cx="22" cy="26" r="3" fill="#ef4444"/>
  </svg>`,

  vendetta: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#1a0306"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#991b1b" stroke-width="1.5"/>
    <!-- Death Mark Eye -->
    <path d="M5 18 Q18 7 31 18 Q18 29 5 18 Z" fill="#991b1b" stroke="#fca5a5" stroke-width="1.8"/>
    <circle cx="18" cy="18" r="5.5" fill="#fef08a"/>
    <circle cx="18" cy="18" r="2.5" fill="#000000"/>
  </svg>`,

  feint: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#141f05"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#65a30d" stroke-width="1.5"/>
    <!-- Crossed Daggers Parry / Feint -->
    <path d="M7 9 L27 29 M9 29 L29 9" stroke="#a3e635" stroke-width="3.2" stroke-linecap="round"/>
    <circle cx="18" cy="18" r="8.5" stroke="#facc15" stroke-width="1.8" stroke-dasharray="3 2"/>
    <path d="M13 5 L23 5 L18 11 Z" fill="#bef264"/>
  </svg>`,

  // ── Boss Debuffs & Special Buffs ───────────────
  asphyxiate: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#0f0c24"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#3b82f6" stroke-width="1.5"/>
    <path d="M18 4 C13 4 11 9 11 15 C11 21 14 26 18 31 C22 26 25 21 25 15 C25 9 23 4 18 4 Z" fill="#1e1b4b"/>
    <path d="M6 14 C10 14 14 17 22 17" stroke="#60a5fa" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M5 19 C10 19 14 21 21 21" stroke="#93c5fd" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M7 24 C11 24 14 25 20 25" stroke="#3b82f6" stroke-width="2" stroke-linecap="round"/>
    <circle cx="18" cy="11" r="2.5" fill="#ef4444"/>
  </svg>`,

  toxic_catalyst: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#021a08"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#22c55e" stroke-width="1.5"/>
    <path d="M15 4 L21 4 L21 11 L28 26 C30 30 27 33 22 33 L14 33 C9 33 6 30 8 26 L15 11 Z" fill="#14532d" stroke="#4ade80" stroke-width="1.2"/>
    <path d="M10 24 Q18 20 26 24 L24 30 Q18 32 12 30 Z" fill="#22c55e"/>
    <circle cx="18" cy="23" r="2" fill="#bbf7d0"/>
    <circle cx="15" cy="27" r="1.5" fill="#bbf7d0"/>
    <circle cx="21" cy="28" r="1.2" fill="#bbf7d0"/>
  </svg>`,

  potion_catalyst: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#260404"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#ef4444" stroke-width="1.5"/>
    <path d="M15 4 L21 4 L21 11 L28 26 C30 30 27 33 22 33 L14 33 C9 33 6 30 8 26 L15 11 Z" fill="#7f1d1d" stroke="#f87171" stroke-width="1.2"/>
    <path d="M10 24 Q18 19 26 24 L24 30 Q18 32 12 30 Z" fill="#ef4444"/>
    <circle cx="18" cy="22" r="2.2" fill="#fef08a"/>
    <circle cx="14" cy="27" r="1.5" fill="#fef08a"/>
  </svg>`,

  toxic_coagulant: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#041829"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#16a34a" stroke-width="1.5"/>
    <polygon points="18,4 27,15 23,32 13,32 9,15" fill="#065f46" stroke="#34d399" stroke-width="1.2"/>
    <polygon points="18,8 24,16 20,28 16,28 12,16" fill="#10b981"/>
    <circle cx="18" cy="18" r="3" fill="#67e8f9"/>
  </svg>`,

  cursed_veins: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#180424"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#a855f7" stroke-width="1.5"/>
    <circle cx="18" cy="18" r="9" fill="#3b0764"/>
    <circle cx="15" cy="16" r="2" fill="#c084fc"/>
    <circle cx="21" cy="16" r="2" fill="#c084fc"/>
    <path d="M18 5 L18 12 M18 24 L18 31 M6 18 L12 18 M24 18 L30 18" stroke="#e879f9" stroke-width="2" stroke-linecap="round"/>
    <path d="M9 9 L14 13 M22 22 L27 27 M9 27 L13 23 M23 13 L27 9" stroke="#c084fc" stroke-width="1.5" stroke-linecap="round"/>
  </svg>`,

  cursed_bullets: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#1a0426"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#9333ea" stroke-width="1.5"/>
    <path d="M7 29 L27 9 M9 31 L29 11" stroke="#c084fc" stroke-width="3" stroke-linecap="round"/>
    <path d="M29 29 L9 9 M31 31 L11 11" stroke="#7e22ce" stroke-width="2" stroke-linecap="round"/>
    <circle cx="27" cy="9" r="2.5" fill="#facc15"/>
  </svg>`,

  shadow_prison: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#0d0926"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#818cf8" stroke-width="1.5"/>
    <rect x="7" y="6" width="22" height="24" rx="2" fill="#1e1b4b" stroke="#6366f1" stroke-width="1.2"/>
    <line x1="12" y1="6" x2="12" y2="30" stroke="#a5b4fc" stroke-width="2"/>
    <line x1="18" y1="6" x2="18" y2="30" stroke="#a5b4fc" stroke-width="2"/>
    <line x1="24" y1="6" x2="24" y2="30" stroke="#a5b4fc" stroke-width="2"/>
    <circle cx="18" cy="18" r="3" fill="#c084fc"/>
  </svg>`,

  desecration: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#021c1f"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#38bdf8" stroke-width="1.5"/>
    <ellipse cx="18" cy="20" rx="13" ry="8" fill="#0e7490" stroke="#38bdf8" stroke-width="1.5"/>
    <ellipse cx="18" cy="20" rx="7" ry="4" fill="#06b6d4"/>
    <circle cx="14" cy="17" r="1.5" fill="#a5f3fc"/>
    <circle cx="21" cy="22" r="1.2" fill="#a5f3fc"/>
  </svg>`,

  ice_chains: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#021626"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#38bdf8" stroke-width="1.5"/>
    <ellipse cx="13" cy="13" rx="6" ry="4" fill="none" stroke="#7dd3fc" stroke-width="2.2" transform="rotate(-30 13 13)"/>
    <ellipse cx="23" cy="23" rx="6" ry="4" fill="none" stroke="#7dd3fc" stroke-width="2.2" transform="rotate(-30 23 23)"/>
    <line x1="15" y1="15" x2="21" y2="21" stroke="#e0f2fe" stroke-width="2.5"/>
  </svg>`,

  mortal_wound: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#240404"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#ef4444" stroke-width="1.5"/>
    <path d="M8 8 L28 28 M28 8 L8 28" stroke="#dc2626" stroke-width="3.5" stroke-linecap="round"/>
    <circle cx="18" cy="18" r="3" fill="#f87171"/>
  </svg>`,

  mark_of_the_wild: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#1c1303"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#f59e0b" stroke-width="1.5"/>
    <ellipse cx="18" cy="23" rx="7" ry="5.5" fill="#f59e0b"/>
    <circle cx="10" cy="14" r="2.5" fill="#fbbf24"/>
    <circle cx="15" cy="10" r="2.8" fill="#fbbf24"/>
    <circle cx="21" cy="10" r="2.8" fill="#fbbf24"/>
    <circle cx="26" cy="14" r="2.5" fill="#fbbf24"/>
  </svg>`,

  exhaustion: `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="#1c0505"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="#dc2626" stroke-width="1.5"/>
    <path d="M10 8 L26 8 L18 18 L26 28 L10 28 L18 18 Z" fill="#7f1d1d" stroke="#f87171" stroke-width="1.5"/>
    <circle cx="18" cy="24" r="2" fill="#fca5a5"/>
  </svg>`,
};

/**
 * 为全量 10 职业 30 专精新增法术生成高辨识度的经典像素风 SVG 图标（按学派、定位与机制区分造型）
 */
function generateThemedSpellSvg(sp: NormalizedSpell): string {
  const paletteBySchool: Record<string, { bg: string; border: string; primary: string; accent: string }> = {
    PHYSICAL: { bg: '#21140b', border: '#c79c6e', primary: '#d97706', accent: '#fde68a' },
    HOLY: { bg: '#241a04', border: '#facc15', primary: '#f59e0b', accent: '#fef9c3' },
    FIRE: { bg: '#290702', border: '#ea580c', primary: '#ef4444', accent: '#fde047' },
    FROST: { bg: '#031729', border: '#38bdf8', primary: '#0284c7', accent: '#e0f2fe' },
    SHADOW: { bg: '#160726', border: '#a855f7', primary: '#7e22ce', accent: '#e9d5ff' },
    NATURE: { bg: '#041f12', border: '#22c55e', primary: '#16a34a', accent: '#bbf7d0' },
    ARCANE: { bg: '#130729', border: '#c084fc', primary: '#9333ea', accent: '#f3e8ff' },
  };
  const pal = paletteBySchool[sp.school] || paletteBySchool.PHYSICAL;

  // Choose iconic silhouette by spell role/mechanics
  let glyph = '';
  if (sp.isTaunt) {
    glyph = `<path d="M9 24 C9 15 15 9 25 7 L25 29 C15 27 9 24 9 24 Z" fill="${pal.primary}" stroke="${pal.accent}" stroke-width="1.3"/>
      <circle cx="26" cy="18" r="3" fill="${pal.accent}"/>
      <path d="M5 13 Q2 18 5 23" stroke="${pal.accent}" stroke-width="2" stroke-linecap="round"/>`;
  } else if (sp.isInterrupt) {
    glyph = `<polygon points="18,5 29,12 29,24 18,31 7,24 7,12" stroke="${pal.primary}" stroke-width="2" fill="none"/>
      <line x1="8" y1="8" x2="28" y2="28" stroke="#ef4444" stroke-width="3" stroke-linecap="round"/>
      <line x1="28" y1="8" x2="8" y2="28" stroke="${pal.accent}" stroke-width="1.8" stroke-linecap="round"/>`;
  } else if (sp.isDefensive || sp.isShield) {
    glyph = `<path d="M18 4 L30 9 V19 C30 26 24 30 18 33 C12 30 6 26 6 19 V9 Z" fill="${pal.primary}" stroke="${pal.accent}" stroke-width="1.6"/>
      <path d="M18 9 L18 28 M11 16 L25 16" stroke="${pal.accent}" stroke-width="2" stroke-linecap="round"/>`;
  } else if (sp.isResurrect) {
    glyph = `<circle cx="18" cy="11" r="5" stroke="${pal.accent}" stroke-width="2.4"/>
      <line x1="18" y1="16" x2="18" y2="31" stroke="${pal.accent}" stroke-width="2.8" stroke-linecap="round"/>
      <line x1="11" y1="21" x2="25" y2="21" stroke="${pal.accent}" stroke-width="2.8" stroke-linecap="round"/>`;
  } else if (sp.isDispel) {
    glyph = `<path d="M18 4 C13 11 9 16 9 22 C9 28 13 32 18 32 C23 32 27 28 27 22 C27 16 23 11 18 4 Z" fill="${pal.primary}" stroke="${pal.accent}" stroke-width="1.4"/>
      <polygon points="18,12 20,17 25,19 20,21 18,26 16,21 11,19 16,17" fill="${pal.accent}"/>`;
  } else if (sp.isResourceRestore) {
    glyph = `<polygon points="18,4 28,18 18,32 8,18" fill="${pal.primary}" stroke="${pal.accent}" stroke-width="1.5"/>
      <circle cx="18" cy="18" r="4" fill="${pal.accent}"/>`;
  } else if (sp.isHeal && sp.isAOE) {
    glyph = `<circle cx="18" cy="18" r="12" stroke="${pal.accent}" stroke-width="1.8" stroke-dasharray="3 2"/>
      <rect x="15.5" y="8" width="5" height="20" rx="1.5" fill="${pal.accent}"/>
      <rect x="8" y="15.5" width="20" height="5" rx="1.5" fill="${pal.accent}"/>
      <circle cx="18" cy="18" r="3" fill="${pal.primary}"/>`;
  } else if (sp.isHeal) {
    glyph = `<circle cx="18" cy="18" r="10" fill="${pal.primary}" opacity="0.45"/>
      <rect x="15.5" y="9" width="5" height="18" rx="1.5" fill="${pal.accent}"/>
      <rect x="9" y="15.5" width="18" height="5" rx="1.5" fill="${pal.accent}"/>`;
  } else if (sp.isAOE) {
    glyph = `<circle cx="18" cy="18" r="12.5" stroke="${pal.primary}" stroke-width="2" stroke-dasharray="4 2"/>
      <polygon points="18,5 22,14 31,18 22,22 18,31 14,22 5,18 14,14" fill="${pal.primary}" stroke="${pal.accent}" stroke-width="1.2"/>
      <circle cx="18" cy="18" r="3.5" fill="${pal.accent}"/>`;
  } else if (sp.classId === 'HUNTER') {
    glyph = `<path d="M11 7 C22 10 22 26 11 29" stroke="${pal.border}" stroke-width="2.4" fill="none"/>
      <line x1="11" y1="7" x2="11" y2="29" stroke="#e2e8f0" stroke-width="1"/>
      <line x1="7" y1="18" x2="29" y2="18" stroke="${pal.accent}" stroke-width="2.2" stroke-linecap="round"/>
      <polygon points="31,18 24,14 24,22" fill="${pal.accent}"/>`;
  } else if (sp.school === 'PHYSICAL') {
    glyph = `<path d="M8 28 L27 9" stroke="${pal.accent}" stroke-width="3.5" stroke-linecap="round"/>
      <path d="M27 9 L30 6 L24 6 Z" fill="${pal.accent}"/>
      <line x1="10" y1="21" x2="15" y2="26" stroke="${pal.primary}" stroke-width="3" stroke-linecap="round"/>
      <path d="M6 12 Q18 6 29 22" stroke="${pal.primary}" stroke-width="1.8" fill="none" stroke-dasharray="3 2"/>`;
  } else {
    glyph = `<circle cx="18" cy="18" r="9.5" fill="${pal.primary}" stroke="${pal.accent}" stroke-width="1.5"/>
      <circle cx="18" cy="18" r="4.5" fill="${pal.accent}"/>
      <path d="M6 18 Q18 6 30 18 Q18 30 6 18 Z" stroke="${pal.accent}" stroke-width="1.2" fill="none" opacity="0.7"/>`;
  }

  return `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="3" fill="${pal.bg}"/>
    <rect x="1" y="1" width="34" height="34" rx="2" stroke="${pal.border}" stroke-width="1.5"/>
    ${glyph}
  </svg>`;
}

// Auto-populate missing icons for ALL 10 classes & 30 specs so zero slots are ever blank
for (const cls of Object.values(ALL_CLASSES_NORMALIZED)) {
  for (const sp of cls.allSpells) {
    if (!DEFAULT_SPELL_ICONS[sp.shortId]) {
      DEFAULT_SPELL_ICONS[sp.shortId] = generateThemedSpellSvg(sp);
    }
    if (!DEFAULT_SPELL_ICONS[sp.id]) {
      DEFAULT_SPELL_ICONS[sp.id] = DEFAULT_SPELL_ICONS[sp.shortId];
    }
  }
}

/**
 * 实时生效的技能/Buff 图标字典。
 * 在游戏加载时，优先使用 \ART\resources\ 中发现的文件（如 Tranquility.jpg）；若无则使用 DEFAULT_SPELL_ICONS 中的自绘矢量图。
 */
export const SPELL_ICONS: Record<string, string> = { ...DEFAULT_SPELL_ICONS };

/**
 * 4.3 经典技能详细数据说明（用于 Tooltip 悬停显示）
 */
export interface SpellTooltipInfo {
  name: string;
  cost: string;
  castTime: string;
  cooldown: string;
  range: string;
  school: string;
  description: string;
}

export const SPELL_TOOLTIPS: Record<string, SpellTooltipInfo> = {
  death_strike: {
    name: '灵界打击',
    cost: '1 鲜血符文 + 1 冰霜/邪恶符文',
    castTime: '瞬发',
    cooldown: '无 (受符文冷却限制)',
    range: '近战范围',
    school: '物理',
    description: '一次强力的致命攻击，造成 150% 武器伤害加额外物理伤害，并为你恢复相当于过去 5 秒内所受伤害 20% 的生命值（最低为最大生命值的 7%）。同时生成【鲜血护盾】，吸收等同于自愈量一定百分比的物理伤害。',
  },
  heart_strike: {
    name: '心脏打击',
    cost: '1 鲜血符文',
    castTime: '瞬发',
    cooldown: '无',
    range: '近战范围',
    school: '物理',
    description: '立刻打击目标及其附近最多 2 个额外目标，造成高额武器伤害与大量仇恨。',
  },
  death_and_decay: {
    name: '枯萎凋零',
    cost: '1 鲜血符文',
    castTime: '瞬发',
    cooldown: '30 秒',
    range: '30 码',
    school: '暗影',
    description:
      '鼠标指定地面位置释放（与治疗之雨相同）：腐化该区域，每秒对范围内敌人造成暗影伤害，持续 10 秒，并产生高额群体仇恨。',
  },
  dnd: {
    name: '枯萎凋零',
    cost: '1 鲜血符文',
    castTime: '瞬发',
    cooldown: '30 秒',
    range: '30 码',
    school: '暗影',
    description:
      '鼠标指定地面位置释放（与治疗之雨相同）：腐化该区域，每秒对范围内敌人造成暗影伤害，持续 10 秒，并产生高额群体仇恨。',
  },
  lightwell: {
    name: '圣光井',
    cost: '法力',
    castTime: '瞬发',
    cooldown: '3 分钟',
    range: '40 码',
    school: '神圣',
    description:
      '点地放置圣光井（治疗图腾类）：绿色光圈持续 3 分钟，站在圈内的友方周期性获得治疗；同一施法者同时只能存在一口井，新放置会立刻替换旧井。',
  },
  blizzard: {
    name: '暴风雪',
    cost: '法力',
    castTime: '引导 8 秒',
    cooldown: '无',
    range: '40 码',
    school: '冰霜',
    description:
      '鼠标指定地面降下暴风雪（红色伤害地形）：持续打击圈内敌人，持续约 8 秒。',
  },
  rune_strike: {
    name: '符文打击',
    cost: '30 符文能量',
    castTime: '瞬发',
    cooldown: '无',
    range: '近战范围',
    school: '物理',
    description: '打击目标，造成 200% 武器伤害，此技能无法被招架、格挡或闪躲。鲜血专精主力符能消耗与仇恨技能。',
  },
  mind_freeze: {
    name: '心灵冰冻',
    cost: '无消耗 (4.3 优化)',
    castTime: '瞬发 (不受 GCD 影响)',
    cooldown: '10 秒',
    range: '近战范围',
    school: '冰霜',
    description: '用冰冻的心灵打击敌人，打断其正在施放的法术，并在 4 秒内使其无法施放该系别法术。',
  },
  dark_command: {
    name: '黑暗命令',
    cost: '无消耗',
    castTime: '瞬发',
    cooldown: '8 秒',
    range: '30 码',
    school: '暗影',
    description: '命令目标攻击你，强迫其将仇恨目标切换至施法者，并在 3 秒内使其无法攻击其他目标。核心单体嘲讽技能。',
  },
  bone_shield: {
    name: '白骨之盾',
    cost: '1 邪恶符文',
    castTime: '瞬发',
    cooldown: '1 分钟',
    range: '自身',
    school: '暗影',
    description: '召唤 4 块白骨环绕死骑，使受到的所有伤害降低 20%，并使你的攻击强度提高 2%。每次受到重击消耗一块白骨。',
  },
  vampiric_blood: {
    name: '吸血鬼之血',
    cost: '1 鲜血符文',
    castTime: '瞬发',
    cooldown: '1 分钟',
    range: '自身',
    school: '暗影',
    description: '激活体内的亡灵血脉，生命值上限提高 15%，且受到的所有治疗效果提高 25%，持续 10 秒。核心大减伤救命技能。',
  },
  howling_blast: {
    name: '凛风冲击',
    cost: '1 冰霜符文',
    castTime: '瞬发',
    cooldown: '无',
    range: '30 码',
    school: '冰霜',
    description: '向目标发射一股刺骨寒风，对其造成大量冰霜伤害，并对周围 10 码内所有敌人造成伤害与减速效果。对所有被命中目标施加冰霜疫病。',
  },
  frost_strike: {
    name: '冰霜打击',
    cost: '35 符文能量',
    castTime: '瞬发',
    cooldown: '无',
    range: '近战范围',
    school: '冰霜',
    description: '用附带冰霜能量的武器狠狠打击目标，造成 130% 武器伤害加额外冰霜伤害。冰霜专精核心符文能量泄能技能。',
  },
  obliterate: {
    name: '湮灭',
    cost: '1 冰霜符文 + 1 邪恶符文',
    castTime: '瞬发',
    cooldown: '无',
    range: '近战范围',
    school: '物理',
    description: '凶猛的一次双持/双手打击，造成 250% 武器伤害。目标身上每有一个疾病效果，湮灭伤害提高 12.5%。冰霜专精核心爆发产能技能。',
  },
  pillar_of_frost: {
    name: '冰霜之柱',
    cost: '1 冰霜符文',
    castTime: '瞬发',
    cooldown: '1 分钟',
    range: '自身',
    school: '冰霜',
    description: '召唤冰霜的力量，使你的力量提高 20%，并使你免疫一切击飞与物理位移效果，持续 20 秒。',
  },
  horn_of_winter: {
    name: '寒冬号角',
    cost: '无消耗',
    castTime: '瞬发',
    cooldown: '20 秒',
    range: '全团范围',
    school: '物理',
    description: '吹响号角，为 30 码内所有队友提供 549 点力量与敏捷增益，持续 2 分钟，同时为自身产生 10 点符文能量。',
  },

  // ── Druid ─────────────────────────────────────
  lifebloom: {
    name: '生命绽放',
    cost: '1,500 法力值',
    castTime: '瞬发',
    cooldown: '无',
    range: '40 码',
    school: '自然',
    description: '在目标身上盛开生命之花，基础持续 15 秒，每 2 秒恢复生命值，可在同一目标身上叠加最多 3 层。多层共用同一个倒计时条，层数只提高每跳治疗量。效果自然结束或被驱散时绽放产生巨额治疗。同一释放者只能对单一目标维持生效，且可被治疗之触、愈合、滋养直接刷新倒计时。',
  },
  rejuvenation: {
    name: '回春术',
    cost: '3,200 法力值',
    castTime: '瞬发',
    cooldown: '无',
    range: '40 码',
    school: '自然',
    description: '治愈目标，在 12 秒内每 3 秒恢复大量生命值。恢复专精铺垫百花齐放与迅捷治愈的核心基础 HoT。',
  },
  regrowth: {
    name: '愈合',
    cost: '4,800 法力值',
    castTime: '1.5 秒',
    cooldown: '无',
    range: '40 码',
    school: '自然',
    description: '快速治愈一名友方目标，立即恢复中等生命值，并在接下来的 6 秒内持续恢复生命。该法术暴击几率额外提高 60%，并可直接刷新目标身上的生命绽放持续时间。',
  },
  healing_touch: {
    name: '治疗之触',
    cost: '5,400 法力值',
    castTime: '2.5 秒',
    cooldown: '无',
    range: '40 码',
    school: '自然',
    description: '治愈一名友方目标，为其恢复 34,000 点生命值。数值以 80 级满级为基准，是德鲁伊单次治疗量最高的强效直接治疗法术，在坦克或队友血线危急时提供中流砥柱般的稳固抬血，并可直接刷新目标身上的生命绽放持续时间。',
  },
  swiftmend: {
    name: '迅捷治愈',
    cost: '1,600 法力值',
    castTime: '瞬发',
    cooldown: '15 秒',
    range: '40 码',
    school: '自然',
    description: '吞噬友方目标身上的回春术或愈合效果，立即为其恢复巨额生命值，并在其脚下生成【百花齐放】绿植法阵，持续治疗站在其中的团队成员。',
  },
  wild_growth: {
    name: '野性成长',
    cost: '4,200 法力值',
    castTime: '瞬发',
    cooldown: '8 秒',
    range: '40 码',
    school: '自然',
    description: '以选中的友方为圆心，在其 15 码范围内挑选血量百分比最低的最多 5 名友方，于 7 秒内持续治疗。治疗效果初始极高，随时间缓慢衰减。',
  },
  natures_swiftness: {
    name: '自然迅捷',
    cost: '无',
    castTime: '瞬发 (不受 GCD 影响)',
    cooldown: '2 分钟',
    range: '自身',
    school: '自然',
    description: '激活后，使你的下一个基础施法时间小于 10 秒的自然法术变为瞬发法术，并使其造成的治疗效果提高 50%。',
  },
  tranquility: {
    name: '宁静',
    cost: '5,600 法力值',
    castTime: '引导 (8 秒)',
    cooldown: '3 分钟 (大灾变优化)',
    range: '全团 40 码',
    school: '自然',
    description: '德鲁伊最强的团队抬血大招！引导期间每 2 秒为 40 码内全团 5 名生命值最低的队友恢复巨量生命值，并施加持续 8 秒可叠层的滋养 HoT。',
  },
  revive: {
    name: '起死回生',
    cost: '6,800 法力值',
    castTime: '10.0 秒 (非战斗状态)',
    cooldown: '无',
    range: '30 码',
    school: '自然',
    description: '令阵亡的灵魂重返肉体，使一名死亡的队友复活，恢复 35% 的生命值与法力值。仅非战斗状态可用。',
  },
  rebirth: {
    name: '复生',
    cost: '6,800 法力值',
    castTime: '2.0 秒',
    cooldown: '10 分钟',
    range: '40 码',
    school: '自然',
    description: '令阵亡盟友的灵魂重返肉体，在战斗中使其立即复活，并恢复其 60% 的生命值与 60% 的法力值。德鲁伊标志性战斗复活大招。',
  },
  starsurge: {
    name: '星涌术',
    cost: '3,100 法力值',
    castTime: '2.0 秒',
    cooldown: '15 秒',
    range: '40 码',
    school: '星界 (奥术+自然)',
    description: '融合日月星辰的力量射向目标，造成极高额星界伤害，并推动蚀星蔽月能量条 15 点。',
  },
  wrath: {
    name: '愤怒',
    cost: '1,800 法力值',
    castTime: '1.5 秒',
    cooldown: '无',
    range: '40 码',
    school: '自然',
    description: '向目标掷出一团愤怒的自然能量，造成自然伤害，并向月蚀方向推动日蚀能量条。',
  },
  starfire: {
    name: '星火术',
    cost: '2,900 法力值',
    castTime: '3.2 秒',
    cooldown: '无',
    range: '40 码',
    school: '奥术',
    description: '凝聚纯净的月神星光打击目标，造成极高额奥术伤害，并向日蚀方向推动蚀星能量。',
  },
  moonfire: {
    name: '月火术',
    cost: '1,700 法力值',
    castTime: '瞬发',
    cooldown: '无',
    range: '40 码',
    school: '奥术',
    description: '一道月光烧灼敌人，立即造成奥术伤害，并在 18 秒内造成额外持续奥术伤害。',
  },
  sunfire: {
    name: '日火术',
    cost: '1,700 法力值',
    castTime: '瞬发',
    cooldown: '无',
    range: '40 码',
    school: '自然',
    description: '一道烈日灼烧敌人，立即造成自然伤害，并在 18 秒内造成额外持续自然伤害。日蚀激活时月火术自动转化。',
  },
  innervate: {
    name: '激活',
    cost: '无消耗',
    castTime: '瞬发',
    cooldown: '3 分钟',
    range: '40 码',
    school: '自然',
    description: '使友方治疗目标在 10 秒内恢复相当于施法者自身法力值上限 20% 的法力值。核心团队回蓝技能。',
  },
  hurricane: {
    name: '飓风',
    cost: '5,000 法力值',
    castTime: '引导',
    cooldown: '无',
    range: '30 码 (10 码半径)',
    school: '自然',
    description: '在目标区域降下飓风，每秒对范围内敌人造成自然伤害。平衡德鲁伊主要 AoE 技能。',
  },
  starfall: {
    name: '星辰坠落',
    cost: '3,500 法力值',
    castTime: '瞬发',
    cooldown: '1.5 分钟',
    range: '自身 (40 码半径)',
    school: '奥术',
    description: '召唤群星坠落打击附近敌人，持续造成奥术伤害。平衡德鲁伊核心爆发 AoE。',
  },
  barkskin: {
    name: '树皮术',
    cost: '无消耗',
    castTime: '瞬发',
    cooldown: '1 分钟',
    range: '自身',
    school: '自然',
    description: '树皮包裹身体，受到的所有伤害降低 20%，持续 12 秒。可在变形与控制中施放。',
  },
  // ── Druid Feral（技能 id 与 ART/resources 下载文件名一致）──
  shred: {
    name: '撕碎',
    cost: '40 能量 + 1 连击点',
    castTime: '瞬发',
    cooldown: '无',
    range: '近战',
    school: '物理',
    description: '从背后撕碎目标，造成高额武器伤害并生成 1 点连击点数。野性猫形态主力单体技能。',
  },
  rake: {
    name: '斜掠',
    cost: '35 能量 + 1 连击点',
    castTime: '瞬发',
    cooldown: '无',
    range: '近战',
    school: '物理',
    description: '斜掠目标，立即造成伤害并施加流血效果。野性猫形态核心 DoT。',
  },
  rip: {
    name: '割裂',
    cost: '30 能量 · 终结技',
    castTime: '瞬发',
    cooldown: '无',
    range: '近战',
    school: '物理',
    description: '终结技：撕裂目标造成持续流血伤害，持续时间与连击点数相关。',
  },
  swipe: {
    name: '横扫',
    cost: '45 能量',
    castTime: '瞬发',
    cooldown: '无',
    range: '近战 AoE',
    school: '物理',
    description: '横扫攻击附近敌人，造成物理伤害。猫/熊形态群体输出技能。',
  },
  ferocious_bite: {
    name: '凶猛撕咬',
    cost: '25+ 能量 · 终结技',
    castTime: '瞬发',
    cooldown: '无',
    range: '近战',
    school: '物理',
    description: '终结技：消耗连击点数对目标造成高额物理伤害，可额外消耗能量提高伤害。',
  },
  skull_bash: {
    name: '迎头痛击',
    cost: '无消耗',
    castTime: '瞬发',
    cooldown: '10 秒',
    range: '近战 / 冲锋',
    school: '物理',
    description: '冲向目标并打断其施法，短时间内封锁该系法术。野性打断技能。',
  },
  berserk: {
    name: '狂暴',
    cost: '无消耗',
    castTime: '瞬发',
    cooldown: '3 分钟',
    range: '自身',
    school: '物理',
    description: '进入狂暴状态：能量消耗降低，并获得额外爆发效果，持续数秒。野性大冷却。',
  },
  mangle: {
    name: '裂伤',
    cost: '能量 / 怒气',
    castTime: '瞬发',
    cooldown: '无',
    range: '近战',
    school: '物理',
    description: '裂伤目标造成物理伤害，并使其受到的流血伤害提高。猫/熊形态起手技能。',
  },

  // ── Shaman ────────────────────────────────────
  riptide: {
    name: '激流',
    cost: '1,800 法力值',
    castTime: '瞬发',
    cooldown: '6 秒',
    range: '40 码',
    school: '自然',
    description: '用恢复之水冲洗一名友方目标，立即恢复生命值并在 18 秒内持续治疗。同时赋予萨满【潮汐奔涌】增益，使接下来的治疗波施法时间缩短 30%。',
  },
  healing_wave: {
    name: '治疗波',
    cost: '2,100 法力值',
    castTime: '2.5 秒',
    cooldown: '无',
    range: '40 码',
    school: '自然',
    description: '引导温和的治疗波涛，为友方目标恢复适量生命值。法力消耗低廉，是平稳刷血的核心节能技能。',
  },
  chain_heal: {
    name: '治疗链',
    cost: '2,200 法力值',
    castTime: '1.67 秒施法（基础 2.5s · 80级满急速）',
    cooldown: '无冷却',
    range: '40 码',
    school: '自然',
    description: '萨满标志性群体治疗！读条施放一道治愈之链，自动弹跳至最多 4 名受伤最重的队友，每次弹跳衰减 15%，无冷却时间。',
  },
  healing_rain: {
    name: '治疗之雨',
    cost: '6,200 法力值',
    castTime: '2.0 秒',
    cooldown: '10 秒',
    range: '40 码 (10码地面半径)',
    school: '自然',
    description: '在目标地面区域降下甘霖，每秒为区域内最多 6 名友方队友恢复生命值，持续 10 秒。大灾变萨满核心群体阵地抬血技能。',
  },
  spirit_link: {
    name: '灵魂链接图腾',
    cost: '2,800 法力值',
    castTime: '瞬发',
    cooldown: '3 分钟',
    range: '40 码 (可点地放置 · 10码图腾半径)',
    school: '自然',
    description: '与治疗之雨相同：在 40 码内鼠标点地插下图腾。图腾使 10 码内队友受到伤害降低 10%，并每秒均摊生命百分比，使血线平齐！',
  },
  wind_shear: {
    name: '风剪',
    cost: '1,200 法力值',
    castTime: '瞬发 (不受 GCD 影响)',
    cooldown: '6 秒 (极短 CD 打断)',
    range: '25 码',
    school: '自然',
    description: '用狂暴的气流冲击目标，打断其正在施放的法术，并在 2 秒内阻止其施放该系别法术。萨满超短 CD 打断神技。',
  },
  bloodlust: {
    name: '嗜血 / 英勇',
    cost: '5,200 法力值',
    castTime: '瞬发',
    cooldown: '5 分钟 (心满意足 10 分钟)',
    range: '全团 100 码',
    school: '物理',
    description: '全团狂暴大招！使全队和全团所有成员的急速提高 30%，持续 40 秒。结束后施加 10 分钟【筋疲力尽/心满意足】Debuff，期间无法再次受益。',
  },
  ancestral_spirit: {
    name: '先祖之魂',
    cost: '6,800 法力值',
    castTime: '10.0 秒 (非战斗状态)',
    cooldown: '无',
    range: '30 码',
    school: '自然',
    description: '召唤先祖的神灵，使一名阵亡的队友重获新生，恢复 35% 生命与法力值。',
  },
  lightning_bolt: {
    name: '闪电箭',
    cost: '1,400 法力值',
    castTime: '2.0 秒 (移动中可施法)',
    cooldown: '无',
    range: '40 码',
    school: '自然',
    description: '向目标射出一道闪电，造成自然伤害，并为施法者恢复法力值。元素萨满核心输出与产能技能。',
  },
  lava_burst: {
    name: '熔岩爆裂',
    cost: '2,200 法力值',
    castTime: '1.5 秒',
    cooldown: '8 秒',
    range: '40 码',
    school: '火焰',
    description: '将熔岩投向目标，造成巨额火焰伤害。若目标身上有烈焰震击效果，则必出暴击！',
  },
  chain_lightning: {
    name: '闪电链',
    cost: '2,200 法力值',
    castTime: '2.0 秒施法（基础 2.0s · 80级满急速 1.33s）',
    cooldown: '3 秒',
    range: '40 码',
    school: '自然',
    description: '射出闪电弹跳至周围最多 4 个目标，造成连锁自然伤害。每次命中敌人时通过【大地之流】为施法者恢复法力值。',
  },
  earth_shield: {
    name: '大地之盾',
    cost: '1,800 法力值',
    castTime: '瞬发',
    cooldown: '无',
    range: '40 码',
    school: '自然',
    description: '为友方目标施加 9 层大地之盾。受击时消耗 1 层回复约 6,800 生命（3 秒内置 CD），并使其受到你的治疗效果提高 20%。坦克保命核心维护技能。',
  },
  unleash_life: {
    name: '生命释放',
    cost: '1,600 法力值',
    castTime: '瞬发',
    cooldown: '15 秒',
    range: '40 码',
    school: '自然',
    description: '释放大地生命武器之力，立即治疗友方目标约 8,500 生命，并使你的下一次直接治疗或治疗之雨效果提高 30%，持续 10 秒。',
  },
  healing_tide: {
    name: '治疗之潮图腾',
    cost: '1,200 法力值',
    castTime: '瞬发',
    cooldown: '3 分钟',
    range: '40 码半径',
    school: '自然',
    description: '召唤治疗之潮图腾，持续 10 秒，每 2 秒为附近最多 5 名伤势最重的友方恢复约 5,200 生命值。恢复萨满团刷大冷却。',
  },
  ascendance: {
    name: '升腾',
    cost: '1,000 法力值',
    castTime: '瞬发',
    cooldown: '3 分钟',
    range: '自身',
    school: '自然',
    description: '化身升腾形态 15 秒：造成的伤害提高 35%。恢复专精额外将你的治疗量 100% 均摊复制给附近最多 5 名受伤友方。',
  },
  ancestral_guidance: {
    name: '先祖指引',
    cost: '无消耗',
    castTime: '瞬发',
    cooldown: '2 分钟',
    range: '自身',
    school: '自然',
    description: '激活 10 秒：你造成的直接伤害的 40%、直接治疗的 60% 转化为智能群体治疗，均摊给最多 3 名伤势最重的友方。',
  },
  thunderstorm: {
    name: '雷霆风暴',
    cost: '无消耗',
    castTime: '瞬发（不占 GCD）',
    cooldown: '45 秒',
    range: '近身 AoE',
    school: '自然',
    description: '释放雷霆风暴造成自然伤害并击退敌人，同时恢复约 15% 最大法力值。元素萨满紧急回蓝与清怪技能。',
  },
  flame_shock: {
    name: '烈焰震击',
    cost: '7% 基础法力值',
    castTime: '瞬发',
    cooldown: '6 秒 (与大地震击共享)',
    range: '40 码',
    school: '火焰',
    description: '用炽热的火焰冲击目标，造成火焰伤害并在 18 秒内造成持续燃烧。',
  },
  earth_shock: {
    name: '大地震击',
    cost: '8% 基础法力值',
    castTime: '瞬发',
    cooldown: '6 秒',
    range: '40 码',
    school: '自然',
    description: '震击目标造成自然伤害，消耗闪电盾层数造成额外巨量爆发自然伤害。',
  },

  // ── Mage ──────────────────────────────────────
  fireball: {
    name: '火球术',
    cost: '2,400 法力值',
    castTime: '2.25 秒',
    cooldown: '无',
    range: '40 码',
    school: '火焰',
    description: '发射一枚炽热的火球，造成巨量火焰伤害并在 8 秒内造成额外燃烧伤害。火法核心主力输出法术。',
  },
  living_bomb: {
    name: '活动炸弹',
    cost: '2,100 法力值',
    castTime: '瞬发',
    cooldown: '无',
    range: '40 码',
    school: '火焰',
    description: '将目标变成一颗定时活体炸弹，在 12 秒内造成持续火焰伤害。效果结束或目标死亡时引爆，对 10 码内所有敌人造成烈焰 AOE 伤害。',
  },
  pyroblast: {
    name: '炎爆术',
    cost: '3,800 法力值',
    castTime: '3.5 秒 (触发热力迸发时瞬发)',
    cooldown: '无',
    range: '40 码',
    school: '火焰',
    description: '召唤一块巨大的炽热岩石砸向敌人，造成毁灭性的火焰伤害并在 12 秒内造成燃烧持续伤害。',
  },
  combustion: {
    name: '燃烧',
    cost: '2,600 法力值',
    castTime: '瞬发',
    cooldown: '2 分钟',
    range: '40 码',
    school: '火焰',
    description: '将目标身上的所有点燃、活动炸弹和炎爆术 DoT 伤害综合计算，瞬间造成火焰伤害并生成一个合并高频超级燃烧 DoT！火法终极爆发大招。',
  },
  counterspell: {
    name: '法术反制',
    cost: '1,500 法力值',
    castTime: '瞬发 (不受 GCD 影响)',
    cooldown: '24 秒',
    range: '40 码',
    school: '奥术',
    description: '反制目标的法术施放，打断其读条并在 4 秒内无法施放该系别所有法术。法师核心打断技能。',
  },
  time_warp: {
    name: '时间扭曲',
    cost: '4,200 法力值',
    castTime: '瞬发',
    cooldown: '5 分钟 (时空移位 10 分钟)',
    range: '全团 100 码',
    school: '奥术',
    description: '扭曲时间流动，使所有小队和团队成员的急速提高 30%，持续 40 秒。法师版嗜血/英勇。',
  },
  arcane_blast: {
    name: '奥术冲击',
    cost: '1,500 ~ 6,000 法力值 (随充能翻倍)',
    castTime: '2.0 秒',
    cooldown: '无',
    range: '40 码',
    school: '奥术',
    description: '用纯净的奥术能量冲击目标，造成高额奥术伤害。每次施法使奥冲伤害提高 10%，施法时间缩短 0.1 秒，但法力消耗提高 150%，最多叠加 4 层。',
  },
  arcane_missiles: {
    name: '奥术飞弹',
    cost: '触发【飞弹连发】后无消耗',
    castTime: '引导 (2.5 秒)',
    cooldown: '无',
    range: '40 码',
    school: '奥术',
    description: '向目标连续发射 5 波奥术飞弹，造成极高额奥术伤害。只能在造成伤害触发【飞弹连发】增益后施放。',
  },
  arcane_barrage: {
    name: '奥术弹幕',
    cost: '1,800 法力值',
    castTime: '瞬发',
    cooldown: '3 秒',
    range: '40 码',
    school: '奥术',
    description: '向目标发射多枚急速奥术飞弹造成即时爆发伤害，并清空所有奥术冲击充能层数以重置法力消耗。',
  },
  arcane_power: {
    name: '奥术强化',
    cost: '无消耗',
    castTime: '瞬发',
    cooldown: '1.5 分钟',
    range: '自身',
    school: '奥术',
    description: '唤醒体内的奥术潜能，使你的法术伤害提高 20%，但法术的法力消耗提高 10%，持续 15 秒。奥法主力爆发大招。',
  },
  frostbolt: {
    name: '寒冰箭',
    cost: '2,100 法力值',
    castTime: '2.0 秒',
    cooldown: '无',
    range: '40 码',
    school: '冰霜',
    description: '射出一支寒冰飞箭，造成冰霜伤害并使目标移动速度降低 40%，持续 9 秒。同时有几率触发冰指增益。',
  },
  ice_lance: {
    name: '冰枪术',
    cost: '1,200 法力值',
    castTime: '瞬发',
    cooldown: '无',
    range: '40 码',
    school: '冰霜',
    description: '向目标投掷一柄锋利的冰矛，造成冰霜伤害。对被冰冻的目标造成双倍伤害（配合冰指可视为冻结目标）。',
  },
  deep_freeze: {
    name: '深度冻结',
    cost: '1,800 法力值',
    castTime: '瞬发',
    cooldown: '30 秒',
    range: '30 码',
    school: '冰霜',
    description: '将目标冻结在坚冰中，使其昏迷 5 秒。对永久免疫昏迷的首领级怪物，深度冻结将造成毁灭性的巨额冰霜伤害！',
  },
  frozen_orb: {
    name: '寒冰宝珠',
    cost: '2,600 法力值',
    castTime: '瞬发',
    cooldown: '1 分钟',
    range: '40 码',
    school: '冰霜',
    description: '发射旋转的冰霜宝珠，减缓敌人速度并在经过路径上持续造成范围冰霜伤害。',
  },
  arcane_brilliance: {
    name: '奥术光辉',
    cost: '2,800 法力值',
    castTime: '瞬发',
    cooldown: '无',
    range: '40 码',
    school: '奥术',
    description: '将达拉然肯瑞托的奥术智慧灌注给全团成员，使所有小队和团队成员的法术强度提高 10%，法力值上限提高 400 点，持续 1 小时。',
  },

  // ── Rogue ─────────────────────────────────────
  sinister_strike: {
    name: '影袭',
    cost: '40 能量',
    castTime: '瞬发',
    cooldown: '无',
    range: '近战范围',
    school: '物理',
    description: '凶狠地打击敌人，造成 145% 武器伤害并产生 1 个连击点数。战斗贼核心产星技能。',
  },
  slice_and_dice: {
    name: '切割',
    cost: '25 能量 + 1~5 连击点',
    castTime: '瞬发终结技',
    cooldown: '无',
    range: '自身',
    school: '物理',
    description: '终结技，消耗连击点数使你的近战近身攻击速度提高 40%，持续时间取决于消耗的连击点数。',
  },
  eviscerate: {
    name: '刺骨',
    cost: '35 能量 + 1~5 连击点',
    castTime: '瞬发终结技',
    cooldown: '无',
    range: '近战范围',
    school: '物理',
    description: '终结技，将武器深深刺入目标体内造成大量物理直接伤害，伤害随连击点数显著提高。',
  },
  kick: {
    name: '脚踢',
    cost: '15 能量',
    castTime: '瞬发 (不受 GCD 影响)',
    cooldown: '10 秒',
    range: '近战范围',
    school: '物理',
    description: '快速踢击目标，打断其正在施放的法术，并在 5 秒内使其无法施放该系别所有法术。盗贼核心打断技。',
  },
  adrenaline_rush: {
    name: '冲动',
    cost: '无消耗',
    castTime: '瞬发',
    cooldown: '2 分钟',
    range: '自身',
    school: '物理',
    description: '激发生命潜能，使你的能量回复速度提高 100%，攻击速度提高 20%，持续 15 秒。战斗贼主力爆发大招。',
  },
  mutilate: {
    name: '毁伤',
    cost: '60 能量',
    castTime: '瞬发',
    cooldown: '无',
    range: '近战范围',
    school: '物理',
    description: '用双匕首同时狠狠刺向目标，造成 200% 武器伤害并产生 2 个连击点数。对中毒目标伤害额外提高 20%。',
  },
  envenom: {
    name: '毒伤',
    cost: '35 能量 + 1~5 连击点',
    castTime: '瞬发终结技',
    cooldown: '无',
    range: '近战范围',
    school: '自然',
    description: '终结技，吞噬目标身上的致命毒药造成即时自然爆发伤害，并使毒药触发几率提高 15%。',
  },
  rupture: {
    name: '割裂',
    cost: '25 能量 + 1~5 连击点',
    castTime: '瞬发终结技',
    cooldown: '无',
    range: '近战范围',
    school: '物理',
    description: '撕裂目标伤口的终结技，在持续时间内造成极高额无视护甲的流血持续伤害。',
  },
  vendetta: {
    name: '宿敌',
    cost: '无消耗',
    castTime: '瞬发',
    cooldown: '2 分钟',
    range: '30 码',
    school: '物理',
    description: '标记一名敌人为死敌，使你对其造成的所有物理与自然伤害提高 20%，持续 20 秒。',
  },
  feint: {
    name: '佯攻',
    cost: '20 能量',
    castTime: '瞬发 (不受 GCD 影响)',
    cooldown: '无',
    range: '自身',
    school: '物理',
    description: '进行佯攻，使你受到的范围攻击 (AoE) 伤害降低 50%，持续 5 秒。无冷却时间，是潜行者应对首领全团 AOE 的核心减伤手段。',
  },
  nourish: {
    name: '滋养',
    cost: '1,800 法力值',
    castTime: '2.5 秒',
    cooldown: '无',
    range: '40 码',
    school: '自然',
    description: '为一名友方目标恢复 9,500 点生命值。若目标身上拥有你的回春术、愈合、生命绽放或野性成长，滋养的治疗效果提高 20%，并可直接刷新目标身上的生命绽放持续时间。',
  },
  natures_cure: {
    name: '自然之愈',
    cost: '2,600 法力值',
    castTime: '瞬发',
    cooldown: '8 秒',
    range: '40 码',
    school: '自然',
    description: '净化一名友方目标，移除其身上所有魔法、诅咒和中毒效果各 1 个（恢复专精核心驱散）。',
  },
  healing_surge: {
    name: '治疗之涌',
    cost: '3,800 法力值',
    castTime: '1.5 秒',
    cooldown: '无',
    range: '40 码',
    school: '自然',
    description: '一次极其迅捷的应急治疗法术，为一名友方目标恢复 16,000 点生命值。法力消耗较高。',
  },
  greater_healing_wave: {
    name: '强效治疗波',
    cost: '4,200 法力值',
    castTime: '2.5 秒',
    cooldown: '无',
    range: '40 码',
    school: '自然',
    description: '引导澎湃的潮汐之力，为一名友方目标恢复 32,000 点大量生命值。单体大抬血核心技能。',
  },
  cleanse_spirit: {
    name: '净化灵魂',
    cost: '2,400 法力值',
    castTime: '瞬发',
    cooldown: '8 秒',
    range: '40 码',
    school: '自然',
    description: '净化一名友方目标，驱散其身上的 1 个诅咒效果；恢复专精下，可同时驱散 1 个魔法效果。',
  },
  remove_curse: {
    name: '解除诅咒',
    cost: '1,500 法力值',
    castTime: '瞬发',
    cooldown: '8 秒',
    range: '40 码',
    school: '奥术',
    description: '解除一名友方目标身上的 1 个诅咒效果。',
  },
  remove_corruption: {
    name: '清除腐蚀',
    cost: '2,200 法力值',
    castTime: '瞬发',
    cooldown: '8 秒',
    range: '40 码',
    school: '自然',
    description: '移除一名友方目标身上的 1 个诅咒和 1 个中毒效果。',
  },
};

// Auto-populate Lv.80 max-haste tooltips for all spells across all 10 Cataclysm classes
const _schoolCn: Record<string, string> = {
  PHYSICAL: '物理',
  FIRE: '火焰',
  FROST: '冰霜',
  SHADOW: '暗影',
  NATURE: '自然',
  ARCANE: '奥术',
  HOLY: '神圣',
};
const _resCn: Record<string, string> = {
  MANA: '法力值',
  ENERGY: '能量',
  RAGE: '怒气',
  FOCUS: '集中值',
  RUNIC_POWER: '符文能量',
  HOLY_POWER: '神圣能量',
  COMBO_POINTS: '连击点',
  RUNE: '符文',
  NONE: '无消耗',
};
for (const cls of Object.values(ALL_CLASSES_NORMALIZED)) {
  for (const sp of cls.allSpells) {
    if (!SPELL_TOOLTIPS[sp.shortId]) {
      const hastedMs = sp.castTimeMs > 0 ? getHastedCastTimeMs(sp.castTimeMs, LEVEL_80_MAX_HASTE) : 0;
      SPELL_TOOLTIPS[sp.shortId] = {
        name: sp.name,
        cost: sp.resourceCostAmount > 0 ? `${sp.resourceCostAmount} ${_resCn[sp.resourceKind] || sp.resourceKind}` : '无消耗',
        castTime:
          sp.castTimeMs <= 0
            ? (sp.gcdCategory === 'OFF_GCD' ? '瞬发（不占 GCD）' : '瞬发')
            : `${(hastedMs / 1000).toFixed(2)} 秒施法（基础 ${(sp.castTimeMs / 1000).toFixed(1)}s）`,
        cooldown: sp.cooldownMs > 0 ? `${(sp.cooldownMs / 1000).toFixed(sp.cooldownMs % 1000 ? 1 : 0)} 秒` : '无冷却',
        range: sp.school === 'PHYSICAL' && sp.classId !== 'HUNTER' ? '近战范围' : '40 码',
        school: _schoolCn[sp.school] || sp.school,
        description: sp.description,
      };
    }
  }
}

// ============================================================
// 外部美术资源 (\ART\resources\) 图标加载与同步机制
// 优先从 \ART\resources\ 寻找图片（如宁静技能存在 Tranquility.jpg 就用它，否则用自绘画）
// ============================================================

import {
  getInitialArtFiles,
  applyArtResourcesToIcons,
  applyArtResourcesToClassAvatars,
  initArtResourceIcons as initArtLoader,
  CUSTOM_ART_URLS,
  CUSTOM_CLASS_ART_URLS,
  subscribeToIconChanges,
  findMatchingArtFile,
} from './iconLoader.js';

export {
  CUSTOM_ART_URLS,
  CUSTOM_CLASS_ART_URLS,
  subscribeToIconChanges,
  findMatchingArtFile,
};

/**
 * 游戏加载时：技能/Buff/职业图标优先 ART/resources，缺失回退手绘；可回调下载进度
 */
export async function initArtResourceIcons(
  onProgress?: import('./iconLoader.js').ArtLoadProgressCallback
) {
  return initArtLoader(
    SPELL_ICONS,
    DEFAULT_SPELL_ICONS,
    SPELL_TOOLTIPS,
    CLASS_PIXEL_AVATARS,
    DEFAULT_CLASS_PIXEL_AVATARS,
    onProgress
  );
}

/**
 * 获取技能/Buff 图标 HTML
 * 优先使用 \ART\resources\ 中的美术资源，未找到则回退到自绘画
 */
export function getSpellIcon(spellId: string, fallback?: string): string {
  return SPELL_ICONS[spellId] || fallback || DEFAULT_SPELL_ICONS[spellId] || '';
}

/** 职业头像 HTML：优先资源图，否则手绘 */
export function getClassAvatar(classId: ClassId | string): string {
  return (
    CLASS_PIXEL_AVATARS[classId as ClassId] ||
    DEFAULT_CLASS_PIXEL_AVATARS[classId as ClassId] ||
    ''
  );
}

/**
 * 获取技能在 \ART\resources\ 中的图片 URL（若不存在则返回 null）
 */
export function getSpellIconUrl(spellId: string): string | null {
  return CUSTOM_ART_URLS[spellId] || null;
}

export function getClassAvatarUrl(classId: string): string | null {
  return CUSTOM_CLASS_ART_URLS[classId] || null;
}

/**
 * 判断指定技能/Buff 是否正在使用来自 \ART\resources\ 的外部资源图标
 */
export function isArtResourceIcon(spellId: string): boolean {
  return Boolean(CUSTOM_ART_URLS[spellId]);
}

export function isClassArtResourceIcon(classId: string): boolean {
  return Boolean(CUSTOM_CLASS_ART_URLS[classId]);
}

// 模块加载：技能 + 职业头像优先匹配 ART/resources
const _initialArtFiles = getInitialArtFiles();
applyArtResourcesToIcons(_initialArtFiles, SPELL_ICONS, DEFAULT_SPELL_ICONS, SPELL_TOOLTIPS);
applyArtResourcesToClassAvatars(
  _initialArtFiles,
  CLASS_PIXEL_AVATARS,
  DEFAULT_CLASS_PIXEL_AVATARS
);

