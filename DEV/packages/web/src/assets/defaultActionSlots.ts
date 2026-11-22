import type { ClassId } from '@cata-raid-sim/engine';
import type { ActionSlot } from '../components/ActionBar.js';

export const DEFAULT_SPELL_COOLDOWNS: Record<string, number> = {
  // Druid
  innervate: 180000,
  tranquility: 180000,
  natures_swiftness: 120000,
  swiftmend: 15000,
  wild_growth: 8000,
  starsurge: 15000,
  rebirth: 600000,
  natures_cure: 8000,
  remove_corruption: 8000,

  // Shaman
  spirit_link: 180000,
  healing_rain: 10000,
  riptide: 6000,
  cleanse_spirit: 8000,
  remove_curse: 8000,
  bloodlust: 300000,
  lava_burst: 8000,
  chain_lightning: 3000,
  flame_shock: 6000,
  earth_shock: 6000,
  wind_shear: 6000,

  // Mage
  time_warp: 300000,
  combustion: 120000,
  counterspell: 24000,
  deep_freeze: 30000,
  frozen_orb: 60000,
  arcane_power: 90000,
  arcane_barrage: 3000,

  // Death Knight
  mind_freeze: 10000,
  dark_command: 8000,
  death_and_decay: 30000,
  bone_shield: 60000,
  vampiric_blood: 60000,
  pillar_of_frost: 60000,
  horn_of_winter: 20000,

  // Rogue
  kick: 10000,
  adrenaline_rush: 180000,
  vendetta: 120000,
};

export function getDefaultActionSlots(classId: ClassId, specId: string): ActionSlot[] {
  const slots: ActionSlot[] = [];

  const add = (slotIdx: number, spellId: string, name: string, iconText: string, totalCdMs: number, colorHex: string) => {
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
    if (specId === 'FROST') {
      // Row 1 (0..11): Core Rotation & Interrupt
      add(0, 'howling_blast', '凛风冲击', '凛', 0, '#00BFFF');
      add(1, 'frost_strike', '冰霜打击', '击', 0, '#0070DE');
      add(2, 'obliterate', '湮灭', '湮', 0, '#8B0000');
      add(3, 'pillar_of_frost', '冰霜之柱', '柱', 60000, '#56CCF2');
      add(4, 'mind_freeze', '心灵冰冻', '断', 10000, '#0070DE');
      add(5, 'horn_of_winter', '寒冬号角', '角', 20000, '#A0C4FF');
      add(6, 'death_and_decay', '枯萎凋零', '枯', 30000, '#8B0000');
      // Row 2 (12..23): Defense & Utility (Shift+1..)
      add(12, 'dark_command', '黑暗命令', '嘲', 8000, '#800080');
      add(13, 'death_strike', '灵界打击', '灵', 0, '#C41F3B');
    } else {
      // Blood Tank
      // Row 1 (0..11)
      add(0, 'death_strike', '灵界打击', '灵', 0, '#C41F3B');
      add(1, 'heart_strike', '心脏打击', '心', 0, '#C41F3B');
      add(2, 'death_and_decay', '枯萎凋零', '枯', 30000, '#8B0000');
      add(3, 'rune_strike', '符文打击', '符', 0, '#C41F3B');
      add(4, 'mind_freeze', '心灵冰冻', '断', 10000, '#0070DE');
      add(5, 'dark_command', '黑暗命令', '嘲', 8000, '#800080');
      add(6, 'bone_shield', '白骨之盾', '骨', 60000, '#D4AF37');
      add(7, 'vampiric_blood', '吸血鬼之血', '血', 60000, '#FF0000');
      // Row 2 (12..23)
      add(12, 'horn_of_winter', '寒冬号角', '角', 20000, '#A0C4FF');
    }
  } else if (classId === 'DRUID') {
    if (specId === 'BALANCE') {
      // Balance DPS
      // Row 1 (0..11)
      add(0, 'starsurge', '星涌术', '涌', 15000, '#9966CC');
      add(1, 'wrath', '愤怒', '怒', 0, '#2E8B57');
      add(2, 'starfire', '星火术', '火', 0, '#E0A3FF');
      add(3, 'moonfire', '月火术', '月', 0, '#87CEEB');
      add(4, 'sunfire', '日火术', '日', 0, '#FFA500');
      add(5, 'remove_corruption', '解除腐蚀', '驱', 8000, '#22C55E');
      add(6, 'innervate', '激活', '活', 180000, '#00CED1');
      add(7, 'revive', '起死回生', '起', 0, '#FACC15');
      add(8, 'rebirth', '复生', '复', 600000, '#10B981');
      // Row 2 (12..23)
      add(12, 'rejuvenation', '回春术', '春', 0, '#FF7D0A');
      add(13, 'tranquility', '宁静', '宁', 180000, '#90EE90');
    } else {
      // Restoration Healer
      // Row 1 (0..11)
      add(0, 'lifebloom', '生命绽放', '绽', 0, '#FF7D0A');
      add(1, 'rejuvenation', '回春术', '春', 0, '#FF7D0A');
      add(2, 'regrowth', '愈合', '愈', 0, '#FF7D0A');
      add(3, 'nourish', '滋养', '滋', 0, '#10B981');
      add(4, 'swiftmend', '迅捷治愈', '迅', 15000, '#6FCF97');
      add(5, 'wild_growth', '野性成长', '野', 8000, '#2E8B57');
      add(6, 'tranquility', '宁静', '宁', 180000, '#90EE90');
      add(7, 'natures_cure', '自然之愈', '愈', 8000, '#14B8A6');
      add(8, 'revive', '起死回生', '起', 0, '#FACC15');
      add(9, 'natures_swiftness', '自然迅捷', '捷', 120000, '#10B981');
      add(10, 'healing_touch', '治疗之触', '触', 0, '#34D399');
      add(11, 'rebirth', '复生', '复', 600000, '#10B981');
      // Row 2 (12..23)
      add(12, 'innervate', '激活', '活', 180000, '#00CED1');
      add(13, 'moonfire', '月火术', '月', 0, '#87CEEB');
      add(14, 'wrath', '愤怒', '怒', 0, '#2E8B57');
    }
  } else if (classId === 'SHAMAN') {
    if (specId === 'ELEMENTAL') {
      // Elemental DPS
      // Row 1 (0..11)
      add(0, 'lightning_bolt', '闪电箭', '箭', 0, '#56CCF2');
      add(1, 'lava_burst', '熔岩爆裂', '爆', 8000, '#FF4500');
      add(2, 'chain_lightning', '闪电链', '链', 3000, '#00BFFF');
      add(3, 'flame_shock', '烈焰震击', '火', 6000, '#FF6347');
      add(4, 'earth_shock', '大地震击', '震', 6000, '#D2B48C');
      add(5, 'cleanse_spirit', '净化灵魂', '驱', 8000, '#2DD4BF');
      add(6, 'wind_shear', '风剪', '断', 6000, '#E0E8FF');
      add(7, 'bloodlust', '嗜血', '嗜', 300000, '#DC143C');
      add(8, 'ancestral_spirit', '先祖之魂', '复', 0, '#5EEAD4');
      // Row 2 (12..23)
      add(12, 'healing_surge', '治疗之涌', '涌', 0, '#38BDF8');
    } else {
      // Restoration Healer
      // Row 1 (0..11)
      add(0, 'riptide', '激流', '激', 6000, '#0070DE');
      add(1, 'healing_wave', '治疗波', '波', 0, '#0070DE');
      add(2, 'healing_surge', '治疗之涌', '涌', 0, '#38BDF8');
      add(3, 'greater_healing_wave', '强效治疗波', '强', 0, '#0284C7');
      add(4, 'chain_heal', '治疗链', '链', 0, '#56CCF2');
      add(5, 'healing_rain', '治疗之雨', '雨', 10000, '#4169E1');
      add(6, 'spirit_link', '灵魂链接', '图', 180000, '#00CED1');
      add(7, 'cleanse_spirit', '净化灵魂', '驱', 8000, '#2DD4BF');
      add(8, 'ancestral_spirit', '先祖之魂', '复', 0, '#5EEAD4');
      // Row 2 (12..23)
      add(12, 'bloodlust', '嗜血', '嗜', 300000, '#DC143C');
      add(13, 'wind_shear', '风剪', '断', 6000, '#E0E8FF');
      add(14, 'lightning_bolt', '闪电箭', '箭', 0, '#56CCF2');
    }
  } else if (classId === 'MAGE') {
    if (specId === 'FROST') {
      // Frost DPS
      add(0, 'frostbolt', '寒冰箭', '箭', 0, '#56CCF2');
      add(1, 'ice_lance', '冰枪术', '枪', 0, '#00BFFF');
      add(2, 'deep_freeze', '深度冻结', '冻', 30000, '#1E90FF');
      add(3, 'frozen_orb', '寒冰宝珠', '球', 60000, '#00FFFF');
      add(4, 'remove_curse', '解除诅咒', '驱', 8000, '#C084FC');
      add(5, 'counterspell', '法术反制', '断', 24000, '#69CCF0');
      // Row 2 (12..23)
      add(12, 'time_warp', '时间扭曲', '嗜', 300000, '#E0A3FF');
      add(13, 'arcane_brilliance', '奥术光辉', '智', 0, '#93C5FD');
    } else if (specId === 'ARCANE') {
      // Arcane DPS
      add(0, 'arcane_blast', '奥术冲击', '冲', 0, '#8A2BE2');
      add(1, 'arcane_missiles', '奥术飞弹', '弹', 0, '#BA55D3');
      add(2, 'arcane_barrage', '奥术弹幕', '幕', 3000, '#9370DB');
      add(3, 'arcane_power', '奥术强化', '强', 90000, '#DA70D6');
      add(4, 'remove_curse', '解除诅咒', '驱', 8000, '#C084FC');
      add(5, 'counterspell', '法术反制', '断', 24000, '#69CCF0');
      // Row 2 (12..23)
      add(12, 'time_warp', '时间扭曲', '嗜', 300000, '#E0A3FF');
      add(13, 'arcane_brilliance', '奥术光辉', '智', 0, '#93C5FD');
    } else {
      // Fire DPS
      add(0, 'fireball', '火球术', '火', 0, '#FF6B35');
      add(1, 'living_bomb', '活动炸弹', '炸', 0, '#FF4500');
      add(2, 'pyroblast', '炎爆术', '炎', 0, '#FF0000');
      add(3, 'combustion', '燃烧', '燃', 120000, '#DC143C');
      add(4, 'remove_curse', '解除诅咒', '驱', 8000, '#C084FC');
      add(5, 'counterspell', '法术反制', '断', 24000, '#69CCF0');
      // Row 2 (12..23)
      add(12, 'time_warp', '时间扭曲', '嗜', 300000, '#E0A3FF');
      add(13, 'arcane_brilliance', '奥术光辉', '智', 0, '#93C5FD');
    }
  } else {
    // ROGUE
    if (specId === 'ASSASSINATION') {
      add(0, 'mutilate', '毁伤', '毁', 0, '#32CD32');
      add(1, 'envenom', '毒化', '毒', 0, '#228B22');
      add(2, 'rupture', '割裂', '割', 0, '#8B0000');
      add(3, 'vendetta', '宿敌', '宿', 120000, '#FF4500');
      add(4, 'kick', '脚踢', '断', 10000, '#FFA500');
      // Row 2 (12..23)
      add(12, 'slice_and_dice', '切割', '切', 0, '#FFF569');
      add(13, 'eviscerate', '刺骨', '刺', 0, '#FFD700');
      add(14, 'feint', '佯攻', '佯', 0, '#A3E635');
    } else {
      // Combat DPS
      add(0, 'sinister_strike', '影袭', '影', 0, '#FFF569');
      add(1, 'slice_and_dice', '切割', '切', 0, '#FFF569');
      add(2, 'eviscerate', '刺骨', '刺', 0, '#FFD700');
      add(3, 'kick', '脚踢', '断', 10000, '#FFA500');
      add(4, 'adrenaline_rush', '冲动', '冲', 120000, '#FF4500');
      // Row 2 (12..23)
      add(12, 'mutilate', '毁伤', '毁', 0, '#32CD32');
      add(13, 'rupture', '割裂', '割', 0, '#8B0000');
      add(14, 'feint', '佯攻', '佯', 0, '#A3E635');
    }
  }

  return slots;
}
