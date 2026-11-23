import type { MazeDungeonProfile } from './MazeGenerator.js';

/** 影牙城堡 — 青石暗堡 */
export const SHADOWFANG_MAZE_PROFILE: MazeDungeonProfile = {
  dungeonId: 'shadowfang_keep',
  name: '影牙城堡',
  tier: '5man',
  targetTravelMs: 7000,
  theme: {
    id: 'sfk_cobble',
    floorColor: '#3a3a42',
    wallColor: '#1a1a22',
    pathAccent: '#6b7280',
    ambienceColor: '#0f172a',
    torchColor: '#f59e0b',
  },
  trash: {
    packNames: [
      '影牙巡逻狼人',
      '狂暴黑狼守卫',
      '堕落庄园仆从',
      '嚎叫暗影猎手',
      '血牙斥候',
    ],
    models: ['WORGEN_PATROL', 'DARK_WOLF', 'WORGEN_PATROL', 'DARK_WOLF'],
  },
};

/** 巨龙之魂 — 暮光熔岩 */
export const DRAGON_SOUL_MAZE_PROFILE: MazeDungeonProfile = {
  dungeonId: 'dragon_soul',
  name: '巨龙之魂',
  tier: '20man',
  targetTravelMs: 14000,
  theme: {
    id: 'ds_obsidian',
    floorColor: '#2a1520',
    wallColor: '#12080e',
    pathAccent: '#a855f7',
    ambienceColor: '#1c0a14',
    torchColor: '#fb923c',
  },
  trash: {
    packNames: [
      '暮光狂热龙人',
      '炽热熔岩幼龙',
      '暮光腐化织法者',
      '巨龙之魂毁灭者',
      '裂隙暮光卫士',
      '黑角军团斥候',
    ],
    models: ['TWILIGHT_DRAKONID', 'LAVA_DRAKE', 'TWILIGHT_VOIDWEAVER', 'DRAGON_ANNIHILATOR'],
  },
};

/** 死亡矿井 — 蒸汽矿道 */
export const DEADMINES_MAZE_PROFILE: MazeDungeonProfile = {
  dungeonId: 'deadmines',
  name: '死亡矿井',
  tier: '5man',
  targetTravelMs: 7000,
  theme: {
    id: 'dm_steam',
    floorColor: '#3f3a32',
    wallColor: '#1c1814',
    pathAccent: '#d97706',
    ambienceColor: '#1a1510',
    torchColor: '#fbbf24',
  },
  trash: {
    packNames: ['迪菲亚矿工', '地精技师', '机械监工', '海盗水手', '伐木场劳工'],
    models: ['DEFIAS_MINER', 'GOBLIN_TECH', 'DEFIAS_MINER', 'GOBLIN_TECH'],
  },
};

/** 血色修道院 — 白石回廊 */
export const SCARLET_MONASTERY_MAZE_PROFILE: MazeDungeonProfile = {
  dungeonId: 'scarlet_monastery',
  name: '血色修道院',
  tier: '5man',
  targetTravelMs: 7000,
  theme: {
    id: 'sm_marble',
    floorColor: '#4a4040',
    wallColor: '#2a1e1e',
    pathAccent: '#dc2626',
    ambienceColor: '#1a1010',
    torchColor: '#f87171',
  },
  trash: {
    packNames: ['血色新兵', '血色僧侣', '血色仆从', '血色百夫长', '血色追踪者'],
    models: ['SCARLET_FOOTMAN', 'SCARLET_ACOLYTE', 'SCARLET_FOOTMAN', 'SCARLET_ACOLYTE'],
  },
};

/** 斯坦索姆 — 焦土街巷 */
export const STRATHOLME_MAZE_PROFILE: MazeDungeonProfile = {
  dungeonId: 'stratholme',
  name: '斯坦索姆',
  tier: '5man',
  targetTravelMs: 7000,
  theme: {
    id: 'strat_ash',
    floorColor: '#3a322c',
    wallColor: '#1a1410',
    pathAccent: '#ea580c',
    ambienceColor: '#140e0a',
    torchColor: '#fb923c',
  },
  trash: {
    packNames: ['血色火枪手', '天灾憎恶', '通灵塔侍僧', '石像鬼哨兵', '食尸鬼群'],
    models: ['SCOURGE_ABOM', 'GARGOYLE_SENTRY', 'SCOURGE_ABOM', 'GARGOYLE_SENTRY'],
  },
};

/** 祖尔格拉布 — 丛林神殿 */
export const ZULGURUB_MAZE_PROFILE: MazeDungeonProfile = {
  dungeonId: 'zulgurub',
  name: '祖尔格拉布',
  tier: '5man',
  targetTravelMs: 7000,
  theme: {
    id: 'zg_jungle',
    floorColor: '#2f3a28',
    wallColor: '#141a10',
    pathAccent: '#84cc16',
    ambienceColor: '#0c1408',
    torchColor: '#a3e635',
  },
  trash: {
    packNames: ['古拉巴什狂战士', '剧毒术士', '毒蜂群', '巨魔猎头者', '神殿守卫'],
    models: ['TROLL_BERSERKER', 'VENOM_WARLOCK', 'TROLL_BERSERKER', 'VENOM_WARLOCK'],
  },
};

const PROFILES: Record<string, MazeDungeonProfile> = {
  shadowfang_keep: SHADOWFANG_MAZE_PROFILE,
  dragon_soul: DRAGON_SOUL_MAZE_PROFILE,
  deadmines: DEADMINES_MAZE_PROFILE,
  scarlet_monastery: SCARLET_MONASTERY_MAZE_PROFILE,
  stratholme: STRATHOLME_MAZE_PROFILE,
  zulgurub: ZULGURUB_MAZE_PROFILE,
};

export function getMazeProfile(dungeonId: string): MazeDungeonProfile {
  return PROFILES[dungeonId] || SHADOWFANG_MAZE_PROFILE;
}

export function registerMazeProfile(profile: MazeDungeonProfile): void {
  PROFILES[profile.dungeonId] = profile;
}

export function listMazeProfiles(): MazeDungeonProfile[] {
  return Object.values(PROFILES);
}
