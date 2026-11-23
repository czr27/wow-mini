import {
  ALL_CLASSES_NORMALIZED,
  getSpellsForClassSpec,
  type ClassId,
} from '@cata-raid-sim/engine';
import type { ActionSlot } from '../components/ActionBar.js';

const SCHOOL_COLOR_MAP: Record<string, string> = {
  PHYSICAL: '#C79C6E',
  FIRE: '#FF6B35',
  FROST: '#56CCF2',
  SHADOW: '#9482C9',
  NATURE: '#10B981',
  ARCANE: '#BA55D3',
  HOLY: '#FACC15',
};

// Auto-build cooldown table from unified ClassRegistry + UI aliases
export const DEFAULT_SPELL_COOLDOWNS: Record<string, number> = {
  // Aliases kept for backwards-compatibility
  spirit_link: 180000,
  mana_tide: 180000,
  healing_tide: 180000,
  healing_tide_totem: 180000,
  ascendance: 180000,
  ancestral_guidance: 120000,
  unleash_life: 15000,
  earth_shield: 0,
  thunderstorm: 45000,
  bloodlust: 300000,
  natures_cure: 0,
  remove_corruption: 0,
  cleanse_spirit: 0,
  remove_curse: 0,
  earth_shock: 6000,
  deep_freeze: 30000,
  frozen_orb: 60000,
  arcane_barrage: 3000,
  starsurge: 15000,
  natures_swiftness: 120000,
  vendetta: 120000,
  rebirth: 600000,
};

for (const cls of Object.values(ALL_CLASSES_NORMALIZED)) {
  for (const sp of cls.allSpells) {
    if (sp.cooldownMs > 0) {
      DEFAULT_SPELL_COOLDOWNS[sp.shortId] = sp.cooldownMs;
      DEFAULT_SPELL_COOLDOWNS[sp.id] = sp.cooldownMs;
    }
  }
}

export function getDefaultActionSlots(classId: ClassId, specId: string): ActionSlot[] {
  const slots: ActionSlot[] = [];
  const specUpper = (specId || '').toUpperCase();

  const add = (
    slotIdx: number,
    spellId: string,
    name: string,
    iconText: string,
    totalCdMs: number,
    colorHex: string
  ) => {
    slots.push({
      slotIdx,
      spellId,
      name,
      iconText,
      totalCdMs,
      cdRemainingMs: 0,
      colorHex,
    });
  };

  if (classId === 'DK') {
    if (specUpper === 'FROST') {
      add(0, 'howling_blast', '凛风冲击', '凛', 0, '#00BFFF');
      add(1, 'frost_strike', '冰霜打击', '击', 0, '#0070DE');
      add(2, 'obliterate', '湮灭', '湮', 0, '#8B0000');
      add(3, 'pillar_of_frost', '冰霜之柱', '柱', 60000, '#56CCF2');
      add(4, 'mind_freeze', '心灵冰冻', '断', 10000, '#0070DE');
      add(5, 'horn_of_winter', '寒冬号角', '角', 20000, '#A0C4FF');
      add(6, 'death_and_decay', '枯萎凋零', '枯', 30000, '#8B0000');
      add(7, 'blood_boil', '血液沸腾', '沸', 0, '#B91C1C');
      add(12, 'dark_command', '黑暗命令', '嘲', 8000, '#800080');
      add(13, 'death_strike', '灵界打击', '灵', 0, '#C41F3B');
      add(14, 'icebound_fortitude', '冰封之韧', '韧', 180000, '#38BDF8');
      add(15, 'anti_magic_shell', '反魔法护罩', '罩', 45000, '#22C55E');
    } else if (specUpper === 'UNHOLY') {
      add(0, 'scourge_strike', '天灾打击', '天', 0, '#22C55E');
      add(1, 'festering_strike', '脓疮打击', '脓', 0, '#65A30D');
      add(2, 'death_coil', '凋零缠绕', '缠', 0, '#4ADE80');
      add(3, 'death_and_decay', '枯萎凋零', '枯', 30000, '#8B0000');
      add(4, 'blood_boil', '血液沸腾', '沸', 0, '#B91C1C');
      add(5, 'summon_gargoyle', '召唤石像鬼', '鬼', 180000, '#7C3AED');
      add(6, 'mind_freeze', '心灵冰冻', '断', 10000, '#0070DE');
      add(7, 'horn_of_winter', '寒冬号角', '角', 20000, '#A0C4FF');
      add(12, 'anti_magic_shell', '反魔法护罩', '罩', 45000, '#22C55E');
      add(13, 'icebound_fortitude', '冰封之韧', '韧', 180000, '#38BDF8');
    } else {
      add(0, 'death_strike', '灵界打击', '灵', 0, '#C41F3B');
      add(1, 'heart_strike', '心脏打击', '心', 0, '#C41F3B');
      add(2, 'death_and_decay', '枯萎凋零', '枯', 30000, '#8B0000');
      add(3, 'blood_boil', '血液沸腾', '沸', 0, '#B91C1C');
      add(4, 'rune_strike', '符文打击', '符', 0, '#C41F3B');
      add(5, 'mind_freeze', '心灵冰冻', '断', 10000, '#0070DE');
      add(6, 'dark_command', '黑暗命令', '嘲', 8000, '#800080');
      add(7, 'bone_shield', '白骨之盾', '骨', 60000, '#D4AF37');
      add(8, 'vampiric_blood', '吸血鬼之血', '血', 60000, '#FF0000');
      add(12, 'icebound_fortitude', '冰封之韧', '韧', 180000, '#38BDF8');
      add(13, 'anti_magic_shell', '反魔法护罩', '罩', 45000, '#22C55E');
      add(14, 'horn_of_winter', '寒冬号角', '角', 20000, '#A0C4FF');
    }
  } else if (classId === 'DRUID') {
    if (specUpper === 'BALANCE') {
      add(0, 'starsurge', '星涌术', '涌', 15000, '#9966CC');
      add(1, 'wrath', '愤怒', '怒', 0, '#2E8B57');
      add(2, 'starfire', '星火术', '火', 0, '#E0A3FF');
      add(3, 'moonfire', '月火术', '月', 0, '#87CEEB');
      add(4, 'sunfire', '日火术', '日', 0, '#FFA500');
      add(5, 'hurricane', '飓风', '飓', 0, '#38BDF8');
      add(6, 'starfall', '星辰坠落', '坠', 90000, '#A855F7');
      add(7, 'remove_corruption', '清除腐蚀', '驱', 0, '#22C55E');
      add(8, 'innervate', '激活', '活', 180000, '#00CED1');
      add(9, 'revive', '起死回生', '起', 0, '#FACC15');
      add(10, 'rebirth', '复生', '复', 600000, '#10B981');
      add(12, 'rejuvenation', '回春术', '春', 0, '#FF7D0A');
      add(13, 'tranquility', '宁静', '宁', 180000, '#90EE90');
    } else if (specUpper === 'FERAL') {
      add(0, 'mangle', '裂伤', '裂', 0, '#FF7D0A');
      add(1, 'shred', '撕碎', '碎', 0, '#F97316');
      add(2, 'rake', '斜掠', '掠', 0, '#EF4444');
      add(3, 'swipe', '横扫', '扫', 0, '#EA580C');
      add(4, 'ferocious_bite', '凶猛撕咬', '咬', 0, '#DC2626');
      add(5, 'rip', '割裂', '割', 0, '#B91C1C');
      add(6, 'skull_bash', '迎头痛击', '断', 10000, '#EAB308');
      add(7, 'berserk', '狂暴', '狂', 180000, '#DC2626');
      add(12, 'barkskin', '树皮术', '皮', 60000, '#854D0E');
      add(13, 'rebirth', '复生', '复', 600000, '#10B981');
    } else {
      add(0, 'lifebloom', '生命绽放', '绽', 0, '#FF7D0A');
      add(1, 'rejuvenation', '回春术', '春', 0, '#FF7D0A');
      add(2, 'regrowth', '愈合', '愈', 0, '#FF7D0A');
      add(3, 'nourish', '滋养', '滋', 0, '#10B981');
      add(4, 'swiftmend', '迅捷治愈', '迅', 15000, '#6FCF97');
      add(5, 'wild_growth', '野性成长', '野', 8000, '#2E8B57');
      add(6, 'tranquility', '宁静', '宁', 180000, '#90EE90');
      add(7, 'natures_cure', '自然之愈', '驱', 0, '#14B8A6');
      add(8, 'revive', '起死回生', '起', 0, '#FACC15');
      add(9, 'natures_swiftness', '自然迅捷', '捷', 120000, '#10B981');
      add(10, 'healing_touch', '治疗之触', '触', 0, '#34D399');
      add(11, 'rebirth', '复生', '复', 600000, '#10B981');
      add(12, 'innervate', '激活', '活', 180000, '#00CED1');
      add(13, 'moonfire', '月火术', '月', 0, '#87CEEB');
      add(14, 'wrath', '愤怒', '怒', 0, '#2E8B57');
    }
  } else if (classId === 'SHAMAN') {
    if (specUpper === 'ELEMENTAL') {
      add(0, 'lightning_bolt', '闪电箭', '箭', 0, '#56CCF2');
      add(1, 'lava_burst', '熔岩爆裂', '爆', 8000, '#FF4500');
      add(2, 'chain_lightning', '闪电链', '链', 3000, '#00BFFF');
      add(3, 'flame_shock', '烈焰震击', '火', 6000, '#FF6347');
      add(4, 'earth_shock', '大地震击', '震', 6000, '#D2B48C');
      add(5, 'thunderstorm', '雷霆风暴', '雷', 45000, '#38BDF8');
      add(6, 'wind_shear', '风剪', '断', 6000, '#E0E8FF');
      add(7, 'ascendance', '升腾', '升', 180000, '#FACC15');
      add(8, 'ancestral_guidance', '先祖指引', '祖', 120000, '#A78BFA');
      add(9, 'bloodlust', '嗜血', '嗜', 300000, '#DC143C');
      add(12, 'healing_surge', '治疗之涌', '涌', 0, '#38BDF8');
      add(13, 'cleanse_spirit', '净化灵魂', '驱', 0, '#2DD4BF');
    } else if (specUpper === 'ENHANCEMENT') {
      add(0, 'stormstrike', '风暴打击', '风', 8000, '#38BDF8');
      add(1, 'lava_lash', '熔岩猛击', '熔', 10000, '#FF4500');
      add(2, 'flame_shock', '烈焰震击', '火', 6000, '#FF6347');
      add(3, 'fire_nova', '火焰新星', '星', 4000, '#F97316');
      add(4, 'unleash_elements', '元素释放', '释', 15000, '#FB923C');
      add(5, 'wind_shear', '风剪', '断', 6000, '#E0E8FF');
      add(6, 'feral_spirit', '野性狼魂', '狼', 120000, '#0EA5E9');
      add(7, 'shamanistic_rage', '萨满之怒', '怒', 60000, '#2563EB');
      add(8, 'ascendance', '升腾', '升', 180000, '#FACC15');
      add(9, 'ancestral_guidance', '先祖指引', '祖', 120000, '#A78BFA');
      add(12, 'bloodlust', '嗜血', '嗜', 300000, '#DC143C');
      add(13, 'cleanse_spirit', '净化灵魂', '驱', 0, '#2DD4BF');
    } else {
      add(0, 'riptide', '激流', '激', 6000, '#0070DE');
      add(1, 'healing_wave', '治疗波', '波', 0, '#0070DE');
      add(2, 'healing_surge', '治疗之涌', '涌', 0, '#38BDF8');
      add(3, 'greater_healing_wave', '强效治疗波', '强', 0, '#0284C7');
      add(4, 'chain_heal', '治疗链', '链', 0, '#56CCF2');
      add(5, 'healing_rain', '治疗之雨', '雨', 10000, '#4169E1');
      add(6, 'earth_shield', '大地之盾', '盾', 0, '#D2B48C');
      add(7, 'unleash_life', '生命释放', '释', 15000, '#34D399');
      add(8, 'healing_tide', '治疗之潮', '潮', 180000, '#0EA5E9');
      add(9, 'spirit_link', '灵魂链接', '图', 180000, '#00CED1');
      add(10, 'ascendance', '升腾', '升', 180000, '#FACC15');
      add(11, 'ancestral_guidance', '先祖指引', '祖', 120000, '#A78BFA');
      add(12, 'mana_tide', '法力之潮', '蓝', 180000, '#38BDF8');
      add(13, 'bloodlust', '嗜血', '嗜', 300000, '#DC143C');
      add(14, 'wind_shear', '风剪', '断', 6000, '#E0E8FF');
      add(15, 'cleanse_spirit', '净化灵魂', '驱', 0, '#2DD4BF');
    }
  } else if (classId === 'MAGE') {
    if (specUpper === 'FROST') {
      add(0, 'frostbolt', '寒冰箭', '箭', 0, '#56CCF2');
      add(1, 'ice_lance', '冰枪术', '枪', 0, '#00BFFF');
      add(2, 'blizzard', '暴风雪', '雪', 0, '#38BDF8');
      add(3, 'deep_freeze', '深度冻结', '冻', 30000, '#1E90FF');
      add(4, 'frozen_orb', '寒冰宝珠', '球', 60000, '#00FFFF');
      add(5, 'remove_curse', '解除诅咒', '驱', 0, '#C084FC');
      add(6, 'counterspell', '法术反制', '断', 24000, '#69CCF0');
      add(12, 'ice_barrier', '寒冰护体', '盾', 30000, '#7DD3FC');
      add(13, 'ice_block', '寒冰屏障', '冰', 300000, '#0284C7');
      add(14, 'time_warp', '时间扭曲', '嗜', 300000, '#E0A3FF');
      add(15, 'arcane_brilliance', '奥术光辉', '智', 0, '#93C5FD');
    } else if (specUpper === 'ARCANE') {
      add(0, 'arcane_blast', '奥术冲击', '冲', 0, '#8A2BE2');
      add(1, 'arcane_missiles', '奥术飞弹', '弹', 0, '#BA55D3');
      add(2, 'arcane_barrage', '奥术弹幕', '幕', 3000, '#9370DB');
      add(3, 'arcane_explosion', '魔爆术', '爆', 0, '#A855F7');
      add(4, 'arcane_power', '奥术强化', '强', 90000, '#DA70D6');
      add(5, 'remove_curse', '解除诅咒', '驱', 0, '#C084FC');
      add(6, 'counterspell', '法术反制', '断', 24000, '#69CCF0');
      add(12, 'evocation', '唤醒', '唤', 120000, '#818CF8');
      add(13, 'ice_block', '寒冰屏障', '冰', 300000, '#0284C7');
      add(14, 'time_warp', '时间扭曲', '嗜', 300000, '#E0A3FF');
      add(15, 'arcane_brilliance', '奥术光辉', '智', 0, '#93C5FD');
    } else {
      add(0, 'fireball', '火球术', '火', 0, '#FF6B35');
      add(1, 'living_bomb', '活动炸弹', '炸', 0, '#FF4500');
      add(2, 'pyroblast', '炎爆术', '炎', 0, '#FF0000');
      add(3, 'flamestorm', '烈焰风暴', '暴', 0, '#EA580C');
      add(4, 'combustion', '燃烧', '燃', 120000, '#DC143C');
      add(5, 'remove_curse', '解除诅咒', '驱', 0, '#C084FC');
      add(6, 'counterspell', '法术反制', '断', 24000, '#69CCF0');
      add(12, 'evocation', '唤醒', '唤', 120000, '#818CF8');
      add(13, 'ice_block', '寒冰屏障', '冰', 300000, '#0284C7');
      add(14, 'time_warp', '时间扭曲', '嗜', 300000, '#E0A3FF');
      add(15, 'arcane_brilliance', '奥术光辉', '智', 0, '#93C5FD');
    }
  } else if (classId === 'ROGUE') {
    if (specUpper === 'ASSASSINATION') {
      add(0, 'mutilate', '毁伤', '毁', 0, '#32CD32');
      add(1, 'envenom', '毒化', '毒', 0, '#228B22');
      add(2, 'rupture', '割裂', '割', 0, '#8B0000');
      add(3, 'fan_of_knives', '刀扇', '扇', 0, '#EAB308');
      add(4, 'vendetta', '宿敌', '宿', 120000, '#FF4500');
      add(5, 'kick', '脚踢', '断', 10000, '#FFA500');
      add(12, 'slice_and_dice', '切割', '切', 0, '#FFF569');
      add(13, 'eviscerate', '刺骨', '刺', 0, '#FFD700');
      add(14, 'feint', '佯攻', '佯', 10000, '#A3E635');
      add(15, 'evasion', '闪避', '闪', 180000, '#94A3B8');
    } else if (specUpper === 'SUBTLETY') {
      add(0, 'backstab', '背刺', '背', 0, '#A855F7');
      add(1, 'hemorrhage', '出血', '血', 0, '#C026D3');
      add(2, 'eviscerate', '刺骨', '刺', 0, '#FFD700');
      add(3, 'fan_of_knives', '刀扇', '扇', 0, '#EAB308');
      add(4, 'shadow_dance', '暗影之舞', '舞', 60000, '#7C3AED');
      add(5, 'kick', '脚踢', '断', 10000, '#FFA500');
      add(12, 'slice_and_dice', '切割', '切', 0, '#FFF569');
      add(13, 'feint', '佯攻', '佯', 10000, '#A3E635');
      add(14, 'evasion', '闪避', '闪', 180000, '#94A3B8');
    } else {
      add(0, 'sinister_strike', '影袭', '影', 0, '#FFF569');
      add(1, 'slice_and_dice', '切割', '切', 0, '#FFF569');
      add(2, 'eviscerate', '刺骨', '刺', 0, '#FFD700');
      add(3, 'fan_of_knives', '刀扇', '扇', 0, '#EAB308');
      add(4, 'kick', '脚踢', '断', 10000, '#FFA500');
      add(5, 'adrenaline_rush', '冲动', '冲', 180000, '#FF4500');
      add(12, 'rupture', '割裂', '割', 0, '#8B0000');
      add(13, 'feint', '佯攻', '佯', 10000, '#A3E635');
      add(14, 'evasion', '闪避', '闪', 180000, '#94A3B8');
    }
  } else {
    // WARRIOR, PALADIN, HUNTER, PRIEST, WARLOCK: auto-layout from unified ClassRegistry
    const specSpells = getSpellsForClassSpec(classId, specUpper);
    const bar1Spells = specSpells.filter(s => !s.isMajorCd && !s.isRaidBuff && !s.isOutOfCombatOnly);
    const bar2Spells = specSpells.filter(s => s.isMajorCd || s.isRaidBuff || s.isOutOfCombatOnly);

    bar1Spells.slice(0, 12).forEach((sp, i) => {
      add(i, sp.shortId, sp.name, sp.name.slice(0, 1), sp.cooldownMs, SCHOOL_COLOR_MAP[sp.school] || '#D4AF37');
    });
    bar2Spells.slice(0, 12).forEach((sp, i) => {
      add(12 + i, sp.shortId, sp.name, sp.name.slice(0, 1), sp.cooldownMs, SCHOOL_COLOR_MAP[sp.school] || '#D4AF37');
    });
  }

  return slots;
}
