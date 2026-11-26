import React, { useState, useEffect, useRef } from 'react';
import { getBgmVolume, setBgmVolume } from '../utils/bgmManager.js';
import { getSfxVolume, setSfxVolume } from '../utils/combatSfx.js';
import { getDbmVoiceVolume, setDbmVoiceVolume, speakDbmVoice } from '../utils/dbmVoice.js';
import { DbmAlertBanner } from './DbmAlertBanner.js';
import { getDungeonRewardIconUrl } from '../assets/pixelIcons.js';
import type {
  CharacterRecord,
  ClassId,
  KeybindingMap,
  DungeonClearCertificate,
  CharacterUiLayout,
  CombatDisplayPrefs,
  DbmAlert,
} from '@cata-raid-sim/engine';
import {
  clampIsoViewSensitivity,
  resolveCombatDisplayPrefs,
} from '@cata-raid-sim/engine';
import { CLASS_PIXEL_AVATARS, SPELL_ICONS } from '../assets/pixelIcons.js';
import { SkillBookModal, getSpellTooltipWithFallback } from './SkillBookModal.js';
import { getDefaultActionSlots } from '../assets/defaultActionSlots.js';
import type { ActionSlot } from './ActionBar.js';
import { resolveSlotHotkey } from './ActionBar.js';

function loadSavedSlots(charId: string, specId: string, classId: ClassId): ActionSlot[] {
  try {
    const raw = localStorage.getItem(`cata_slots_${charId}_${specId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return getDefaultActionSlots(classId, specId);
}

export const CLASS_COLORS: Record<ClassId, string> = {
  DK: '#C41F3B',
  DRUID: '#FF7D0A',
  SHAMAN: '#0070DE',
  MAGE: '#69CCF0',
  ROGUE: '#FFF569',
  WARRIOR: '#C79C6E',
  PALADIN: '#F58CBA',
  HUNTER: '#ABD473',
  PRIEST: '#FFFFFF',
  WARLOCK: '#9482C9',
};

export const CLASS_NAMES: Record<ClassId, string> = {
  DK: '死亡骑士',
  DRUID: '德鲁伊',
  SHAMAN: '萨满祭司',
  MAGE: '法师',
  ROGUE: '潜行者',
  WARRIOR: '战士',
  PALADIN: '圣骑士',
  HUNTER: '猎人',
  PRIEST: '牧师',
  WARLOCK: '术士',
};

export const CLASS_SPECS: Record<ClassId, { id: string; name: string; role: 'TANK' | 'HEALER' | 'DPS' }[]> = {
  DK: [
    { id: 'BLOOD', name: '鲜血（主坦）', role: 'TANK' },
    { id: 'FROST', name: '冰霜（输出）', role: 'DPS' },
    { id: 'UNHOLY', name: '邪恶（输出）', role: 'DPS' },
  ],
  DRUID: [
    { id: 'RESTORATION', name: '恢复（治疗）', role: 'HEALER' },
    { id: 'BALANCE', name: '平衡（输出）', role: 'DPS' },
    { id: 'FERAL', name: '野性（坦克/近战）', role: 'TANK' },
  ],
  SHAMAN: [
    { id: 'RESTORATION', name: '恢复（治疗）', role: 'HEALER' },
    { id: 'ELEMENTAL', name: '元素（输出）', role: 'DPS' },
    { id: 'ENHANCEMENT', name: '增强（输出）', role: 'DPS' },
  ],
  MAGE: [
    { id: 'FIRE', name: '火焰（输出）', role: 'DPS' },
    { id: 'FROST', name: '冰霜（输出）', role: 'DPS' },
    { id: 'ARCANE', name: '奥术（输出）', role: 'DPS' },
  ],
  ROGUE: [
    { id: 'COMBAT', name: '战斗（输出）', role: 'DPS' },
    { id: 'ASSASSINATION', name: '刺杀（输出）', role: 'DPS' },
    { id: 'SUBTLETY', name: '敏锐（输出）', role: 'DPS' },
  ],
  WARRIOR: [
    { id: 'PROTECTION', name: '防护（主坦）', role: 'TANK' },
    { id: 'ARMS', name: '武器（输出）', role: 'DPS' },
    { id: 'FURY', name: '狂怒（输出）', role: 'DPS' },
  ],
  PALADIN: [
    { id: 'HOLY', name: '神圣（治疗）', role: 'HEALER' },
    { id: 'PROTECTION', name: '防护（主坦）', role: 'TANK' },
    { id: 'RETRIBUTION', name: '惩戒（输出）', role: 'DPS' },
  ],
  HUNTER: [
    { id: 'BEAST_MASTERY', name: '野兽控制（输出）', role: 'DPS' },
    { id: 'MARKSMANSHIP', name: '射击（输出）', role: 'DPS' },
    { id: 'SURVIVAL', name: '生存（输出）', role: 'DPS' },
  ],
  PRIEST: [
    { id: 'DISCIPLINE', name: '戒律（治疗）', role: 'HEALER' },
    { id: 'HOLY', name: '神圣（治疗）', role: 'HEALER' },
    { id: 'SHADOW', name: '暗影（输出）', role: 'DPS' },
  ],
  WARLOCK: [
    { id: 'AFFLICTION', name: '痛苦（输出）', role: 'DPS' },
    { id: 'DEMONOLOGY', name: '恶魔学识（输出）', role: 'DPS' },
    { id: 'DESTRUCTION', name: '毁灭（输出）', role: 'DPS' },
  ],
};

/** Cataclysm-flavored intro copy for the selected talent spec (shown on the right panel). */
export const SPEC_INTROS: Record<ClassId, Record<string, { summary: string; playstyle: string; highlights: string[] }>> = {
  DK: {
    BLOOD: {
      summary: '鲜血死亡骑士以符文与符能维持生存，是可靠的主坦克专精。',
      playstyle: '近战坦克 · 自我治疗 · 稳定仇恨',
      highlights: ['死亡打击回血', '符文打击补仇', '冰封之韧减伤'],
    },
    FROST: {
      summary: '冰霜死亡骑士以双持或双手武器打出爆发斩击，侧重单体与近战输出。',
      playstyle: '近战输出 · 爆发窗口 · 减速控制',
      highlights: ['湮灭 / 冰霜打击', '冰霜之柱爆发', '心灵冰冻打断'],
    },
    UNHOLY: {
      summary: '邪恶死亡骑士召唤食尸鬼与疫病，擅长持续与范围伤害。',
      playstyle: '近战输出 · 宠物协同 · DoT 铺垫',
      highlights: ['脓疮打击', '天灾打击', '亡者大军'],
    },
  },
  DRUID: {
    RESTORATION: {
      summary: '恢复德鲁伊以 HoT 堆叠与迅捷治愈稳住团队血线，机动治疗优秀。',
      playstyle: '治疗 · 持续回血 · 团灭救急',
      highlights: ['回春 / 愈合', '迅捷治愈', '野性成长'],
    },
    BALANCE: {
      summary: '平衡德鲁伊在日月蚀循环间切换法术，远程输出并兼顾控场。',
      playstyle: '远程法伤 · 日月蚀循环 · 多目标',
      highlights: ['愤怒 / 星火术', '星涌术', '月火 / 阳炎'],
    },
    FERAL: {
      summary: '野性德鲁伊可熊形态承担主坦，或以豹形态输出近战伤害。',
      playstyle: '坦克 / 近战 · 变形灵活 · 流血与连击',
      highlights: ['裂伤 / 割伤', '野蛮咆哮', '狂暴'],
    },
  },
  SHAMAN: {
    RESTORATION: {
      summary: '恢复萨满以激流、治疗链与治疗之雨覆盖小队，图腾辅助团队。',
      playstyle: '治疗 · 连锁治疗 · 图腾增益',
      highlights: ['激流', '治疗链 / 治疗之雨', '灵魂链接图腾'],
    },
    ELEMENTAL: {
      summary: '元素萨满以闪电与熔岩爆发打出高爆发远程法伤。',
      playstyle: '远程法伤 · 爆发 · 打断',
      highlights: ['闪电箭', '熔岩爆裂', '烈焰震击'],
    },
    ENHANCEMENT: {
      summary: '增强萨满双持近战，风暴打击与漩涡武器驱动爆发。',
      playstyle: '近战输出 · 漩涡武器 · 图腾',
      highlights: ['风暴打击', '熔岩猛击', '烈焰震击'],
    },
  },
  MAGE: {
    FIRE: {
      summary: '火焰法师以灼烧叠暴击，活体炸弹与炎爆术打出点燃爆发。',
      playstyle: '远程法伤 · 暴击爆发 · 点燃',
      highlights: ['火球术', '活体炸弹', '燃烧'],
    },
    FROST: {
      summary: '冰霜法师以减速与碎冰打出稳健输出，生存能力出色。',
      playstyle: '远程法伤 · 控场 · 碎冰',
      highlights: ['寒冰箭', '冰枪术', '冰霜新星'],
    },
    ARCANE: {
      summary: '奥术法师以奥术冲击叠层爆发，蓝量管理是核心。',
      playstyle: '远程法伤 · 蓝量循环 · 爆发窗',
      highlights: ['奥术冲击', '奥术弹幕', '唤醒'],
    },
  },
  ROGUE: {
    COMBAT: {
      summary: '战斗贼以速度与切割维持高攻速近战输出。',
      playstyle: '近战输出 · 攻速 · 终结技',
      highlights: ['邪恶攻击', '切割', '刺骨'],
    },
    ASSASSINATION: {
      summary: '刺杀贼依赖毒药与毁伤打出稳定单体伤害。',
      playstyle: '近战输出 · 毒药 · 单体',
      highlights: ['毁伤', '毒伤', '切割'],
    },
    SUBTLETY: {
      summary: '敏锐贼以暗影舞与预谋打出高爆发，机动性强。',
      playstyle: '近战输出 · 暗影爆发 · 潜行',
      highlights: ['背刺', '暗影之舞', '预谋'],
    },
  },
  WARRIOR: {
    PROTECTION: {
      summary: '防护战士以盾牌格挡与主动减伤稳住仇恨，是经典主坦克。',
      playstyle: '近战坦克 · 盾墙减伤 · 嘲讽',
      highlights: ['盾牌猛击', '复仇', '盾墙'],
    },
    ARMS: {
      summary: '武器战士以致死打击与巨人打击打出强力单体斩击。',
      playstyle: '近战输出 · 斩杀 · 爆发',
      highlights: ['致死打击', '巨人打击', '斩杀'],
    },
    FURY: {
      summary: '狂怒战士双持狂暴，嗜血与怒击堆叠高攻速输出。',
      playstyle: '近战输出 · 双持 · 狂暴',
      highlights: ['嗜血', '怒击', '斩杀'],
    },
  },
  PALADIN: {
    HOLY: {
      summary: '神圣圣骑士以圣光术与圣光闪现急救，圣光道标稳定抬血。',
      playstyle: '治疗 · 急救 · 道标',
      highlights: ['圣光闪现', '圣光术', '圣光道标'],
    },
    PROTECTION: {
      summary: '防护圣骑士以神圣怒火与圣盾技能减伤坦伤，仇恨稳定。',
      playstyle: '近战坦克 · 减伤轮换 · 神圣能量',
      highlights: ['审判', '正义盾击', '圣佑术'],
    },
    RETRIBUTION: {
      summary: '惩戒圣骑士以神圣能量驱动终结技，近战爆发强劲。',
      playstyle: '近战输出 · 神圣能量 · 爆发',
      highlights: ['十字军打击', '神圣风暴', '愤怒之锤'],
    },
  },
  HUNTER: {
    BEAST_MASTERY: {
      summary: '野兽控制猎人与宠物并肩作战，专注宠物伤害与协同。',
      playstyle: '远程物理 · 宠物输出 · 机动',
      highlights: ['杀戮命令', '稳固射击', '狂野怒火'],
    },
    MARKSMANSHIP: {
      summary: '射击猎人以瞄准射击与奇美拉射击打出精准远程伤害。',
      playstyle: '远程物理 · 瞄准爆发 · 陷阱',
      highlights: ['瞄准射击', '奇美拉射击', '稳固射击'],
    },
    SURVIVAL: {
      summary: '生存猎人偏重爆炸射击与陷阱，多目标表现优秀。',
      playstyle: '远程物理 · 爆炸射击 · 陷阱',
      highlights: ['爆炸射击', '毒蛇钉刺', '陷阱'],
    },
  },
  PRIEST: {
    DISCIPLINE: {
      summary: '戒律牧师以盾与救赎吸收伤害，预减伤型治疗专精。',
      playstyle: '治疗 · 护盾 · 救赎',
      highlights: ['真言术：盾', '苦修', '救赎'],
    },
    HOLY: {
      summary: '神圣牧师以快速治疗与治疗祷言稳住团队，应急能力强。',
      playstyle: '治疗 · 直接抬血 · 团灭救急',
      highlights: ['快速治疗', '治疗祷言', '神圣赞美诗'],
    },
    SHADOW: {
      summary: '暗影牧师以暗言术与精神鞭笞打出持续法伤。',
      playstyle: '远程法伤 · DoT · 精神鞭笞',
      highlights: ['暗言术：痛', '吸血鬼之触', '精神鞭笞'],
    },
  },
  WARLOCK: {
    AFFLICTION: {
      summary: '痛苦术士以多重诅咒与吸取灵魂维持持续伤害。',
      playstyle: '远程法伤 · DoT · 吸取',
      highlights: ['痛苦诅咒', '痛苦无常', '吸取灵魂'],
    },
    DEMONOLOGY: {
      summary: '恶魔学识术士召唤恶魔军团，变身爆发输出。',
      playstyle: '远程法伤 · 恶魔 · 变身爆发',
      highlights: ['献祭', '暗影箭', '恶魔变形'],
    },
    DESTRUCTION: {
      summary: '毁灭术士以烧尽与混乱之箭打出爆发单体法伤。',
      playstyle: '远程法伤 · 烧尽 · 混乱之箭',
      highlights: ['烧尽', '献祭', '混乱之箭'],
    },
  },
};

function getSpecIntro(classId: ClassId, specId: string) {
  const byClass = SPEC_INTROS[classId];
  const hit = byClass?.[specId] || byClass?.[specId.toUpperCase()];
  if (hit) return hit;
  return {
    summary: '选择专精后可查看玩法概要与核心技能方向。',
    playstyle: '—',
    highlights: [] as string[],
  };
}

interface Props {
  currentAccountName: string;
  characters: CharacterRecord[];
  selectedCharId: string | null;
  onSelectCharacter: (charId: string) => void;
  onCreateCharacter: (
    name: string,
    classId: ClassId,
    spec: string
  ) =>
    | { success: boolean; error?: string }
    | Promise<{ success: boolean; error?: string }>
    | void;
  onDeleteCharacter: (charId: string) => void;
  onChangeSpec: (charId: string, spec: string) => void;
  onSaveKeybinding: (charId: string, spec: string, slotIdx: number, key: string) => void;
  onViewCertificate: (cert: DungeonClearCertificate) => void;
  onOpenLeaderboard: () => void;
  onStartAdventure: () => void;
  /** mode=login | register；走服务器，返回是否成功与错误文案 */
  onAuth: (
    username: string,
    password: string,
    mode: 'login' | 'register'
  ) => Promise<{ success: boolean; error?: string }>;
  onLogout?: () => void;
  /** 注销账号（服务器删除 + 本地清除），需密码确认 */
  onDeleteAccount?: (password: string) => Promise<{ success: boolean; error?: string }>;
  /** 顶栏登录/注册点击时递增 id，打开本组件内的登录弹窗 */
  authOpenRequest?: { mode: 'login' | 'register'; id: number } | null;
  /** Session kick notice: show immediately (avoid window.alert deferral). */
  sessionKickNotice?: string | null;
  onDismissSessionKickNotice?: () => void;
  slots?: ActionSlot[];
  onSwapSlots?: (srcIdx: number, destIdx: number, targetCharId?: string, targetSpecId?: string) => void;
  onAssignSlot?: (slotIdx: number, spellId: string, targetCharId?: string, targetSpecId?: string) => void;
  onClearSlot?: (slotIdx: number, targetCharId?: string, targetSpecId?: string) => void;
  /** Persist combat canvas display prefs (per character ? server via uiLayout). */
  onSaveUiLayout?: (charId: string, patch: Partial<CharacterUiLayout>) => void;
}

const REMEMBER_AUTH_KEY = 'cata_raid_sim_remembered_auth_v1';

function loadRememberedAuth(): { username: string; password: string } | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(REMEMBER_AUTH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.username && typeof parsed.password === 'string') {
      return { username: String(parsed.username), password: String(parsed.password) };
    }
  } catch {}
  return null;
}

function saveRememberedAuth(username: string, password: string) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(REMEMBER_AUTH_KEY, JSON.stringify({ username, password }));
  } catch {}
}

function clearRememberedAuth() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(REMEMBER_AUTH_KEY);
  } catch {}
}

export const AuthAndCharacterModal: React.FC<Props> = ({
  currentAccountName,
  characters,
  selectedCharId,
  onSelectCharacter,
  onCreateCharacter,
  onDeleteCharacter,
  onChangeSpec,
  onSaveKeybinding,
  onViewCertificate,
  onOpenLeaderboard,
  onStartAdventure,
  onAuth,
  onLogout,
  onDeleteAccount,
  authOpenRequest,
  sessionKickNotice = null,
  onDismissSessionKickNotice,
  slots,
  onSwapSlots,
  onAssignSlot,
  onClearSlot,
  onSaveUiLayout,
}) => {
  const [draggedSlotIdx, setDraggedSlotIdx] = useState<number | null>(null);
  const [sniffingSlotIdx, setSniffingSlotIdx] = useState<number | null>(null);
  const [inspectedSpellId, setInspectedSpellId] = useState<string | null>(null);
  const [hoveredCertAnchor, setHoveredCertAnchor] = useState<{
    certId: string;
    x: number;
    y: number;
  } | null>(null);
  const certFirstRowRef = useRef<HTMLDivElement | null>(null);
  const [certRowHeight, setCertRowHeight] = useState<number>(0);

  useEffect(() => {
    const el = certFirstRowRef.current;
    if (!el) return;
    const update = () => {
      const h = el.getBoundingClientRect().height;
      if (h > 0) setCertRowHeight(Math.round(h));
    };
    update();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(update);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [selectedCharId]);
  const [bgmVolPct, setBgmVolPct] = useState(() => Math.round(getBgmVolume() * 100));
  const [sfxVolPct, setSfxVolPct] = useState(() => Math.round(getSfxVolume() * 100));
  const [dbmVolPct, setDbmVolPct] = useState(() => Math.round(getDbmVoiceVolume() * 100));
  const [dbmTestAlerts, setDbmTestAlerts] = useState<DbmAlert[]>([]);
  const [dbmTestIdx, setDbmTestIdx] = useState(0);
  const [isCreating, setIsCreating] = useState(false);
  const [isSkillBookOpen, setIsSkillBookOpen] = useState(false);
  const [newCharName, setNewCharName] = useState('');
  const [newCharClass, setNewCharClass] = useState<ClassId>('DK');
  const [newCharSpec, setNewCharSpec] = useState('BLOOD');
  const [createCharError, setCreateCharError] = useState<string | null>(null);
  const [editingKeybinding, setEditingKeybinding] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authUsername, setAuthUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authPasswordConfirm, setAuthPasswordConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [rememberAuth, setRememberAuth] = useState(() => !!loadRememberedAuth());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const isLoggedIn = !!(currentAccountName && currentAccountName !== '未登录');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const resetAuthForm = (keepRemembered = false) => {
    if (!keepRemembered) {
      setAuthUsername('');
      setAuthPassword('');
    }
    setAuthPasswordConfirm('');
    setAuthError(null);
    setShowPassword(false);
    setAuthBusy(false);
  };

  const openAuthModal = (mode: 'login' | 'register' = 'login') => {
    const remembered = loadRememberedAuth();
    setAuthMode(mode);
    setAuthError(null);
    setAuthPasswordConfirm('');
    setShowPassword(false);
    setAuthBusy(false);
    if (remembered) {
      setAuthUsername(remembered.username);
      setAuthPassword(remembered.password);
      setRememberAuth(true);
    } else {
      setAuthUsername('');
      setAuthPassword('');
      setRememberAuth(false);
    }
    setShowLoginModal(true);
  };

  useEffect(() => {
    if (!authOpenRequest) return;
    openAuthModal(authOpenRequest.mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open on each new request id
  }, [authOpenRequest?.id]);

  // Open login modal as soon as kick notice arrives (do not wait for Login click).
  useEffect(() => {
    if (!sessionKickNotice) return;
    openAuthModal('login');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKickNotice]);

  const handleAuthSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const user = authUsername.trim();
    const pass = authPassword;
    if (!user) {
      setAuthError('请输入用户名');
      return;
    }
    if (!pass) {
      setAuthError('请输入密码');
      return;
    }
    if (authMode === 'register') {
      if (pass.length < 4) {
        setAuthError('密码至少 4 个字符');
        return;
      }
      if (pass !== authPasswordConfirm) {
        setAuthError('两次输入的密码不一致');
        return;
      }
    }
    setAuthBusy(true);
    setAuthError(null);
    try {
      const result = await onAuth(user, pass, authMode);
      if (!result.success) {
        setAuthError(result.error || (authMode === 'login' ? '登录失败' : '注册失败'));
        return;
      }
      if (rememberAuth) {
        saveRememberedAuth(user, pass);
      } else {
        clearRememberedAuth();
      }
      onDismissSessionKickNotice?.();
      setShowLoginModal(false);
      resetAuthForm();
    } finally {
      setAuthBusy(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!onDeleteAccount) return;
    if (!deletePassword) {
      setDeleteError('请输入密码以确认删除');
      return;
    }
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const result = await onDeleteAccount(deletePassword);
      if (!result.success) {
        setDeleteError(result.error || '删除失败');
        return;
      }
      clearRememberedAuth();
      setShowDeleteConfirm(false);
      setDeletePassword('');
    } finally {
      setDeleteBusy(false);
    }
  };

  const selectedChar = characters.find(c => c.id === selectedCharId) || characters[0];

  const [createCharBusy, setCreateCharBusy] = useState(false);

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCharName.trim() || createCharBusy) return;
    setCreateCharError(null);
    setCreateCharBusy(true);
    try {
      const result = await Promise.resolve(
        onCreateCharacter(newCharName.trim(), newCharClass, newCharSpec)
      );
      if (result && result.success === false) {
        setCreateCharError(result.error || '创建失败');
        return;
      }
      setNewCharName('');
      setCreateCharError(null);
      setIsCreating(false);
    } catch (err: any) {
      setCreateCharError(err?.message || '创建失败');
    } finally {
      setCreateCharBusy(false);
    }
  };

  const handleClassChange = (cls: ClassId) => {
    setNewCharClass(cls);
    setNewCharSpec(CLASS_SPECS[cls][0].id);
  };

  const currentSpecKeybindings: KeybindingMap = selectedChar
    ? selectedChar.specKeybindings?.[selectedChar.lastSpec] || {}
    : {};

  const activeSlots = (slots !== undefined && selectedChar?.id === selectedCharId)
    ? slots
    : (selectedChar
        ? loadSavedSlots(selectedChar.id, selectedChar.lastSpec, selectedChar.classId)
        : []);

  useEffect(() => {
    setInspectedSpellId(null);
  }, [selectedCharId, selectedChar?.lastSpec]);

  // Global keydown listener for sniffing hotkey in Lobby (Supports single keys like F2 and combos like Shift+C)
  useEffect(() => {
    if (sniffingSlotIdx === null || !selectedChar) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        setSniffingSlotIdx(null);
        return;
      }

      if (e.key === 'Backspace' || e.key === 'Delete') {
        onSaveKeybinding(selectedChar.id, selectedChar.lastSpec, sniffingSlotIdx, '');
        setSniffingSlotIdx(null);
        return;
      }

      const kLower = e.key.toLowerCase();
      // Bare modifier press - wait for actual key
      if (['shift', 'control', 'alt', 'meta'].includes(kLower)) {
        return;
      }

      let baseKey = '';
      if (/^F([1-9]|1[0-2])$/i.test(e.key)) {
        baseKey = e.key.toUpperCase();
      } else if (e.code.startsWith('Digit')) {
        baseKey = e.code.replace('Digit', '');
      } else if (e.code.startsWith('Key')) {
        baseKey = e.code.replace('Key', '').toUpperCase();
      } else if (e.code === 'Minus') {
        baseKey = '-';
      } else if (e.code === 'Equal') {
        baseKey = '=';
      } else if (e.code === 'Space') {
        baseKey = 'SPACE';
      } else if (e.code === 'Tab') {
        baseKey = 'TAB';
      } else if (e.code === 'Backquote') {
        baseKey = '`';
      } else if (e.key.length === 1) {
        baseKey = e.key.toUpperCase();
      } else {
        baseKey = e.code.toUpperCase();
      }

      if (!baseKey || ['SHIFT', 'CTRL', 'ALT', 'CONTROL'].includes(baseKey)) {
        return;
      }

      const parts: string[] = [];
      if (e.ctrlKey) parts.push('CTRL');
      if (e.shiftKey) parts.push('SHIFT');
      parts.push(baseKey);

      const normalizedHotkey = parts.join('+');
      onSaveKeybinding(selectedChar.id, selectedChar.lastSpec, sniffingSlotIdx, normalizedHotkey);
      setSniffingSlotIdx(null);
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [sniffingSlotIdx, selectedChar, onSaveKeybinding]);

  return (
    <div className="flex flex-col h-full min-h-0 w-full bg-[#141424] text-gray-200 select-none overflow-hidden">
        
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-4 sm:px-6 py-3 border-b border-amber-500/30 bg-gradient-to-r from-slate-900 via-amber-950/40 to-slate-900">
          <div className="flex items-center space-x-3">
            <span className="text-2xl">⚔️</span>
            <div>
              <h2 className="text-base font-bold text-amber-300">角色与冒险厅</h2>
              <p className="text-xs text-gray-400">
                当前账号：<span className="text-amber-400 font-semibold">{currentAccountName || '未登录'}</span>
              </p>
            </div>
          </div>
        </div>

        {/* Main Content Area — character UI only when logged in */}
        {!isLoggedIn ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 p-10 bg-[#10101c] text-center">
            <span className="text-5xl opacity-80">🔐</span>
            <h3 className="text-lg font-bold text-amber-300">请先登录或注册账号</h3>
            <p className="text-sm text-gray-400 max-w-md">
              登录后才能创建与切换角色、配置快捷键，并进入副本大厅。
            </p>
            <div className="flex items-center gap-3 mt-2">
              <button
                type="button"
                onClick={() => openAuthModal('login')}
                className="px-5 py-2 text-sm bg-[#1e2a44] hover:bg-[#263556] rounded-lg transition border border-sky-700/50 text-sky-200 font-bold"
              >
                登录
              </button>
              <button
                type="button"
                onClick={() => openAuthModal('register')}
                className="px-5 py-2 text-sm bg-emerald-800/80 hover:bg-emerald-700 rounded-lg transition border border-emerald-500/40 text-emerald-100 font-bold"
              >
                注册
              </button>
            </div>
          </div>
        ) : (
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-12 overflow-hidden">
          
          {/* Left Column: Character List (3 cols / 25%) */}
          <div className="md:col-span-3 border-r border-[#2a2a44] p-4 flex flex-col overflow-y-auto bg-[#10101c]">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-gray-400">我的角色 ({characters.length})</span>
              <button
                onClick={() => {
                  setCreateCharError(null);
                  setIsCreating(true);
                }}
                className="text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-1 rounded flex items-center space-x-1 font-semibold"
              >
                <span>+</span>
                <span>创建角色</span>
              </button>
            </div>

            <div className="space-y-2 flex-1 overflow-y-auto pr-1">
              {characters.map(char => {
                const isSelected = char.id === selectedChar?.id;
                const classColor = CLASS_COLORS[char.classId];
                return (
                  <div
                    key={char.id}
                    onClick={() => onSelectCharacter(char.id)}
                    className={`p-3 rounded-lg border cursor-pointer transition flex items-center justify-between ${
                      isSelected
                        ? 'border-amber-400 bg-[#252540] shadow-md'
                        : 'border-[#2c2c46] bg-[#161628] hover:border-gray-500'
                    }`}
                  >
                    <div className="flex items-center space-x-2.5">
                      <div
                        className="w-8 h-8 rounded-md overflow-hidden border border-[#3b3b5c] flex-shrink-0 shadow"
                        dangerouslySetInnerHTML={{ __html: CLASS_PIXEL_AVATARS[char.classId] }}
                      />
                      <div>
                        <div className="font-bold text-sm" style={{ color: classColor }}>
                          {char.name}
                        </div>
                        <div className="text-xs text-gray-400">
                          {CLASS_NAMES[char.classId]} · {char.lastSpec}
                        </div>
                      </div>
                    </div>
                    {characters.length > 1 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`确定删除角色 "${char.name}" 吗？此操作无法撤销。`)) {
                            onDeleteCharacter(char.id);
                          }
                        }}
                        className="text-gray-500 hover:text-red-400 p-1 text-xs"
                      >
                        🗑️
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Middle & Right Column: Character Details, Spec & Keybindings, Clear Proofs (9 cols / 75%) */}
          <div className="md:col-span-9 p-5 flex flex-col overflow-hidden bg-[#141424]">
            {selectedChar ? (
              <>
                {/* Character Profile Banner — locked above scroll (settings etc.) */}
                <div className="flex-shrink-0 mb-5">
                  <div className="flex items-center justify-between bg-[#1d1d36] border border-[#343454] p-4 rounded-xl shadow-lg shadow-black/40">
                  <div className="flex items-center space-x-3 min-w-0">
                    <div
                      className="w-12 h-12 rounded-lg overflow-hidden border-2 border-[#444466] shadow-md flex-shrink-0"
                      dangerouslySetInnerHTML={{ __html: CLASS_PIXEL_AVATARS[selectedChar.classId] }}
                    />
                    <div className="min-w-0">
                      <h3 className="text-xl font-bold text-white flex items-center space-x-2">
                        <span className="truncate">{selectedChar.name}</span>
                        <span
                          className="text-xs px-2 py-0.5 rounded font-normal flex-shrink-0"
                          style={{
                            backgroundColor: `${CLASS_COLORS[selectedChar.classId]}25`,
                            color: CLASS_COLORS[selectedChar.classId],
                            border: `1px solid ${CLASS_COLORS[selectedChar.classId]}60`,
                          }}
                        >
                          {CLASS_NAMES[selectedChar.classId]}
                        </span>
                      </h3>
                      <p className="text-xs text-gray-400 mt-0.5">
                        创建时间：{new Date(selectedChar.createdAtIso).toLocaleDateString()} · 通关证明：
                        <span className="text-amber-400 font-bold ml-1">
                          {selectedChar.clearCertificates?.length || 0} 个
                        </span>
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={onStartAdventure}
                    className="flex-shrink-0 px-6 py-2.5 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white font-extrabold rounded-lg shadow-lg hover:shadow-amber-500/20 transform active:scale-95 transition flex items-center space-x-2 text-base"
                  >
                    <span>⚔️</span>
                    <span>进入大厅</span>
                  </button>
                </div>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto space-y-5 pr-1">
                {/* Spec talents + action bars (left ~46.7%) / intro or spell tip (right) */}
                <div
                  className="bg-[#1a1a30] border border-[#2e2e4e] p-4 rounded-xl"
                  onClick={() => setInspectedSpellId(null)}
                >
                  <div className="mb-3">
                    <h4 className="font-bold text-sm text-gray-200">专精天赋</h4>
                  </div>

                  {/* Left shrunk ~20% from previous 7/12 → ~5.6/12 */}
                  <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,46.67%)_minmax(0,1fr)] gap-4 items-start">
                    {/* Left: specs + action bars */}
                    <div className="space-y-3 min-w-0" onClick={(e) => e.stopPropagation()}>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        {CLASS_SPECS[selectedChar.classId].map(spec => {
                          const isActive = selectedChar.lastSpec === spec.id;
                          return (
                            <button
                              key={spec.id}
                              onClick={() => {
                                setInspectedSpellId(null);
                                onChangeSpec(selectedChar.id, spec.id);
                              }}
                              className={`px-3 py-2 rounded-lg border text-xs font-bold transition flex items-center justify-between ${
                                isActive
                                  ? 'border-amber-400 bg-amber-500/20 text-amber-300'
                                  : 'border-[#333355] bg-[#121222] text-gray-400 hover:border-gray-500'
                              }`}
                            >
                              <span>{spec.name}</span>
                              <span className="text-[10px] text-gray-400">
                                {spec.role === 'TANK' ? '🛡️ 坦' : spec.role === 'HEALER' ? '💚 奶' : '⚔️ DPS'}
                              </span>
                            </button>
                          );
                        })}
                      </div>

                      <div className="bg-[#10101e] p-3 rounded-lg border border-[#25253d] space-y-2">
                        <div className="flex items-center justify-between text-[11px] text-gray-400 font-semibold border-b border-[#25253d] pb-2 gap-2">
                          <span className="text-white font-bold">动作条</span>
                          <div className="flex items-center space-x-2 flex-shrink-0">
                            <button
                              type="button"
                              onClick={() => setIsSkillBookOpen(true)}
                              className="text-xs px-2.5 py-1 bg-indigo-700 hover:bg-indigo-600 text-white rounded font-bold shadow flex items-center space-x-1"
                            >
                              <span>📖</span>
                              <span>法术书</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingKeybinding(!editingKeybinding);
                                setSniffingSlotIdx(null);
                              }}
                              className={`text-xs px-2.5 py-1 rounded font-bold transition border ${
                                editingKeybinding
                                  ? 'bg-amber-500 text-black border-amber-400 shadow-md ring-2 ring-amber-400/50'
                                  : 'bg-black/40 text-gray-300 hover:text-white border-gray-600'
                              }`}
                            >
                              {editingKeybinding ? '✓ 完成改键' : '改键位'}
                            </button>
                          </div>
                        </div>

                        {/* 12 square slots fill left column width; height = width */}
                        <div className="flex flex-col space-y-0.5 pt-1 w-full">
                      {([24, 12, 0] as const).map((startIdx) => (
                        <div key={startIdx} className="grid grid-cols-12 gap-0.5 w-full border border-[#3b3b5c] rounded-lg overflow-hidden bg-[#0c0c18] shadow-md">
                            {Array.from({ length: 12 }).map((_, col) => {
                              const idx = startIdx + col;
                              const { key: currentKey, isUnbound } = resolveSlotHotkey(currentSpecKeybindings, idx);
                              const slot = activeSlots.find(s => s.slotIdx === idx);
                              const iconSvg = slot ? SPELL_ICONS[slot.spellId] : null;
                              const isInspected = !!(slot && inspectedSpellId === slot.spellId);

                              return (
                                <div
                                  key={idx}
                                  draggable={!!slot}
                                  onDragStart={(e) => {
                                    if (!slot) return;
                                    setDraggedSlotIdx(idx);
                                    (window as any).__cata_dragged_slot = idx;
                                    (window as any).__cata_dragged_spell = null;
                                    (window as any).__cata_slot_drop_handled = false;
                                    (window as any).__cata_drag_start_coord = { x: e.clientX, y: e.clientY };
                                    e.dataTransfer.effectAllowed = 'copyMove';
                                    try {
                                      e.dataTransfer.setData('text/slotIdx', idx.toString());
                                      e.dataTransfer.setData('text/plain', `slot:${idx}`);
                                    } catch {}
                                  }}
                                  onDragEnd={(e) => {
                                    const wasHandled = (window as any).__cata_slot_drop_handled;
                                    const startCoord = (window as any).__cata_drag_start_coord;
                                    const endCoord = (e.clientX || e.clientY)
                                      ? { x: e.clientX, y: e.clientY }
                                      : (window as any).__cata_last_drag_coord || startCoord;
                                    const dist = startCoord && endCoord ? Math.hypot(endCoord.x - startCoord.x, endCoord.y - startCoord.y) : 0;

                                    if (!wasHandled && dist > 35 && onClearSlot) {
                                      onClearSlot(idx, selectedChar.id, selectedChar.lastSpec);
                                    }

                                    setDraggedSlotIdx(null);
                                    setTimeout(() => {
                                      (window as any).__cata_dragged_slot = null;
                                      (window as any).__cata_slot_drop_handled = false;
                                      (window as any).__cata_drag_start_coord = null;
                                    }, 200);
                                  }}
                                  onDragOver={(e) => {
                                    e.preventDefault();
                                    e.dataTransfer.dropEffect = 'copy';
                                    (window as any).__cata_last_drag_coord = { x: e.clientX, y: e.clientY };
                                  }}
                                  onDrop={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    (window as any).__cata_slot_drop_handled = true;
                                    let spellId = (window as any).__cata_dragged_spell || '';
                                    let srcSlot: number | null = (window as any).__cata_dragged_slot !== undefined && (window as any).__cata_dragged_slot !== null
                                      ? Number((window as any).__cata_dragged_slot)
                                      : null;

                                    if (!spellId && srcSlot === null) {
                                      try {
                                        const cSpell = e.dataTransfer.getData('text/spellId');
                                        const cSlot = e.dataTransfer.getData('text/slotIdx');
                                        const plain = e.dataTransfer.getData('text/plain') || '';
                                        if (cSpell) spellId = cSpell;
                                        else if (cSlot) srcSlot = parseInt(cSlot, 10);
                                        else if (plain.startsWith('spell:')) spellId = plain.replace('spell:', '');
                                        else if (plain.startsWith('slot:')) srcSlot = parseInt(plain.replace('slot:', ''), 10);
                                        else if (plain && isNaN(parseInt(plain, 10))) spellId = plain;
                                        else if (plain && !isNaN(parseInt(plain, 10))) srcSlot = parseInt(plain, 10);
                                      } catch {}
                                    }

                                    if (spellId && onAssignSlot) {
                                      onAssignSlot(idx, spellId, selectedChar.id, selectedChar.lastSpec);
                                    } else if (srcSlot !== null && !isNaN(srcSlot) && srcSlot !== idx && onSwapSlots) {
                                      onSwapSlots(srcSlot, idx, selectedChar.id, selectedChar.lastSpec);
                                    }

                                    setDraggedSlotIdx(null);
                                    (window as any).__cata_dragged_spell = null;
                                    (window as any).__cata_dragged_slot = null;
                                  }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (editingKeybinding) {
                                      setSniffingSlotIdx(idx);
                                      return;
                                    }
                                    if (slot?.spellId) {
                                      setInspectedSpellId(slot.spellId);
                                    } else {
                                      setInspectedSpellId(null);
                                    }
                                  }}
                                  className={`w-full aspect-square min-w-0 border border-[#28283e] flex flex-col items-center justify-between relative overflow-hidden transition cursor-pointer select-none ${
                                    sniffingSlotIdx === idx
                                      ? 'border-amber-400 ring-2 ring-amber-400 bg-amber-500/20 shadow-[0_0_12px_rgba(251,191,36,0.6)] animate-pulse z-20'
                                      : draggedSlotIdx === idx
                                      ? 'opacity-50 ring-2 ring-amber-400 z-20'
                                      : isInspected
                                      ? 'bg-[#1f1f35] ring-2 ring-sky-400/80 z-10'
                                      : slot
                                      ? 'bg-[#141424] hover:bg-[#1f1f35] hover:z-10'
                                      : 'bg-[#0c0c18] hover:bg-[#131322] hover:z-10'
                                  }`}
                                >
                                  {/* Layer 1 (z-10): Authentic Spell Icon filling slot normally */}
                                  {slot ? (
                                    <div className="absolute inset-0 rounded flex items-center justify-center overflow-hidden z-10 pointer-events-none p-0.5">
                                      {iconSvg ? (
                                        <div
                                          className="w-full h-full flex items-center justify-center [&>svg]:w-full [&>svg]:h-full [&>svg]:max-w-full [&>svg]:max-h-full [&>svg]:block"
                                          dangerouslySetInnerHTML={{ __html: iconSvg }}
                                        />
                                      ) : (
                                        <div
                                          className="w-full h-full flex items-center justify-center text-xs font-bold text-white shadow-sm rounded"
                                          style={{ backgroundColor: slot.colorHex || '#38BDF8' }}
                                        >
                                          {slot.iconText}
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    <span className="text-[11px] text-gray-600 m-auto select-none pointer-events-none z-10 font-bold">#{idx + 1}</span>
                                  )}

                                  {/* Layer 2 (z-20): Slot Number (Top Left) */}
                                  <span className="absolute top-0.5 left-0.5 text-[7.5px] font-mono text-gray-300 drop-shadow-[0_1px_2px_rgba(0,0,0,1)] bg-black/80 px-1 rounded z-20 pointer-events-none leading-none">
                                    #{idx + 1}
                                  </span>

                                  {/* Layer 2 (z-20): Hotkey Badge (Top Right) — N/A in red when unbound/conflict */}
                                  <span
                                    className={`absolute top-0.5 right-0.5 text-[8.5px] font-mono font-bold drop-shadow-[0_1px_2px_rgba(0,0,0,1)] px-1 rounded z-20 pointer-events-none leading-tight border ${
                                      sniffingSlotIdx === idx
                                        ? 'bg-amber-400 text-black border-amber-300 animate-pulse'
                                        : isUnbound
                                        ? 'bg-black/90 text-red-400 border-red-500/70'
                                        : 'bg-black/85 text-amber-300 border-amber-500/50'
                                    }`}
                                  >
                                    {sniffingSlotIdx === idx
                                      ? '按键...'
                                      : isUnbound
                                      ? 'N/A'
                                      : currentKey.startsWith('SHIFT+')
                                      ? `S${currentKey.replace('SHIFT+', '')}`
                                      : currentKey}
                                  </span>

                                  {/* Layer 2 (z-20): Spell Name Label Banner (Bottom) */}
                                  {slot && (
                                    <span className="absolute bottom-0 inset-x-0 bg-black/85 text-[8px] text-gray-200 truncate text-center z-20 py-0.5 px-0.5 pointer-events-none leading-tight">
                                      {slot.name}
                                    </span>
                                  )}

                                  {/* Sniffing listening overlay */}
                                  {sniffingSlotIdx === idx && (
                                    <div className="absolute inset-0 bg-amber-500/25 ring-2 ring-amber-400 z-30 flex items-center justify-center pointer-events-none">
                                      <span className="text-[8px] font-black text-amber-200 bg-black/90 px-1 py-0.5 rounded shadow border border-amber-400">
                                        按下按键...
                                      </span>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                        </div>
                      ))}
                    </div>
                      </div>
                    </div>

                    {/* Right: spell tip when inspecting; otherwise selected spec introduction */}
                    <div className="min-w-0" onClick={(e) => e.stopPropagation()}>
                      {(() => {
                        const tip = inspectedSpellId
                          ? getSpellTooltipWithFallback(inspectedSpellId, selectedChar.classId)
                          : null;
                        if (inspectedSpellId && tip) {
                          const iconSvg = SPELL_ICONS[inspectedSpellId];
                          return (
                            <div className="h-full rounded-lg border border-[#5c4a28] bg-[#121222] p-4 space-y-3">
                              <div className="flex items-start justify-between gap-2">
                                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                                  技能详细说明
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setInspectedSpellId(null)}
                                  className="text-[10px] text-slate-400 hover:text-amber-300 transition"

                                >
                                  返回专精介绍
                                </button>
                              </div>
                              <div className="bg-[#0b0b18] border border-[#5c4a28] rounded-md p-3 text-gray-200 text-xs space-y-2">
                                <div className="flex items-center space-x-2 pb-2 border-b border-[#3e341f]">
                                  {iconSvg ? (
                                    <div
                                      className="w-10 h-10 rounded overflow-hidden flex-shrink-0 border border-black/80 p-0.5 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full [&>svg]:block"
                                      dangerouslySetInnerHTML={{ __html: iconSvg }}
                                    />
                                  ) : (
                                    <div
                                      className="w-10 h-10 rounded flex-shrink-0 border border-amber-500/50 flex items-center justify-center font-extrabold text-xs"
                                      style={{
                                        backgroundColor: '#1a1a32',
                                        color: CLASS_COLORS[selectedChar.classId],
                                      }}
                                    >
                                      {tip.name.slice(0, 2)}
                                    </div>
                                  )}
                                  <div className="min-w-0">
                                    <div className="font-extrabold text-amber-300 text-sm tracking-wide truncate">
                                      {tip.name}
                                    </div>
                                    <div className="text-gray-400 text-[11px] font-mono truncate">
                                      {tip.cost}
                                    </div>
                                  </div>
                                </div>
                                <div className="flex justify-between text-[11px] text-gray-300">
                                  <span>{tip.castTime}</span>
                                  <span>{tip.range}</span>
                                </div>
                                <div className="flex justify-between text-[11px] text-gray-300">
                                  <span>冷却：{tip.cooldown}</span>
                                  <span className="text-amber-200">{tip.school}系</span>
                                </div>
                                <div className="pt-2 border-t border-[#3e341f] text-[#ffd100] text-xs leading-relaxed">
                                  {tip.description}
                                </div>
                              </div>
                              <p className="text-[10px] text-slate-500">
                                单击空白格子或本区空白处可返回专精介绍。
                              </p>
                            </div>
                          );
                        }

                        const activeSpecMeta =
                          CLASS_SPECS[selectedChar.classId].find(s => s.id === selectedChar.lastSpec) ||
                          CLASS_SPECS[selectedChar.classId][0];
                        const intro = getSpecIntro(selectedChar.classId, selectedChar.lastSpec);
                        const roleLabel =
                          activeSpecMeta.role === 'TANK'
                            ? '坦克'
                            : activeSpecMeta.role === 'HEALER'
                            ? '治疗'
                            : '输出';
                        return (
                          <div className="h-full rounded-lg border border-[#2e2e4e] bg-[#121222] p-4 space-y-3">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                                  专精介绍
                                </div>
                                <h5
                                  className="text-base font-extrabold mt-0.5"
                                  style={{ color: CLASS_COLORS[selectedChar.classId] }}
                                >
                                  {activeSpecMeta.name}
                                </h5>
                              </div>
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded border border-slate-600 text-slate-300 bg-black/40 flex-shrink-0">
                                {roleLabel}
                              </span>
                            </div>
                            <p className="text-xs text-slate-300 leading-relaxed">{intro.summary}</p>
                            <div className="text-[11px] text-amber-300/90 font-semibold">
                              定位：{intro.playstyle}
                            </div>
                            {intro.highlights.length > 0 && (
                              <div className="space-y-1.5 pt-1 border-t border-[#2a2a44]">
                                <div className="text-[10px] text-slate-500 font-bold">核心方向</div>
                                <ul className="space-y-1">
                                  {intro.highlights.map(h => (
                                    <li
                                      key={h}
                                      className="text-[11px] text-slate-300 flex items-center gap-1.5"
                                    >
                                      <span className="text-amber-400">•</span>
                                      <span>{h}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            <p className="text-[10px] text-slate-500 pt-1">
                              每个专精独立记忆动作条与快捷键，切换后自动加载。单击动作条技能可查看说明。
                            </p>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>

                {/* Dungeon Clear Certificates (Bag-style Inventory Grid) */}
                <div className="bg-[#1a1a30] border border-[#2e2e4e] p-4 rounded-xl space-y-2.5 relative">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-sm text-gray-200 flex items-center space-x-2">
                        <span>🎒 通关证明物品栏</span>
                        <span className="text-[11px] font-mono text-amber-300/90 bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 rounded">
                          {selectedChar.clearCertificates?.length || 0} 枚
                        </span>
                      </h4>
                    </div>
                  </div>

                  {(() => {
                    const certs = selectedChar.clearCertificates || [];
                    const certRows = Math.max(1, Math.ceil(certs.length / 24));
                    const hoveredCert = hoveredCertAnchor
                      ? certs.find(c => c.id === hoveredCertAnchor.certId)
                      : null;
                    const shortDungeonTag = (name: string) => {
                      const clean = name.replace(/（.*?）|\(.*?\)/g, '').trim();
                      return clean.slice(0, 2) || '通关';
                    };
                    const resolveCertBorderStyle = (cert: DungeonClearCertificate) => {
                      const name = cert.dungeonName || '';
                      const isCustom = cert.difficulty === 'CUSTOM' || name.includes('自定义');
                      const isNormal = cert.difficulty === 'NORMAL' || name.includes('普通');
                      const is20Man =
                        cert.is20Man === true ||
                        cert.dungeonId === 'dragon_soul' ||
                        name.includes('20人') ||
                        name.includes('巨龙之魂');

                      if (isCustom) {
                        return {
                          borderClass: 'border-white hover:border-white',
                          glow: 'inset 0 0 0 1px rgba(255,255,255,0.45), 0 0 6px rgba(255,255,255,0.35)',
                          badgeColor: '#FFFFFF',
                        };
                      }
                      if (isNormal) {
                        if (is20Man) {
                          return {
                            borderClass: 'border-purple-400 hover:border-purple-300',
                            glow: 'inset 0 0 0 1px rgba(192,132,252,0.45), 0 0 6px rgba(192,132,252,0.4)',
                            badgeColor: '#C084FC',
                          };
                        }
                        return {
                          borderClass: 'border-sky-400 hover:border-sky-300',
                          glow: 'inset 0 0 0 1px rgba(56,189,248,0.45), 0 0 6px rgba(56,189,248,0.4)',
                          badgeColor: '#38BDF8',
                        };
                      }
                      // Heroic (default): 5-man purple, 20-man +1 tier -> orange
                      if (is20Man) {
                        return {
                          borderClass: 'border-orange-400 hover:border-orange-300',
                          glow: 'inset 0 0 0 1px rgba(251,146,60,0.55), 0 0 8px rgba(251,146,60,0.5)',
                          badgeColor: '#FB923C',
                        };
                      }
                      return {
                        borderClass: 'border-purple-400 hover:border-purple-300',
                        glow: 'inset 0 0 0 1px rgba(192,132,252,0.45), 0 0 6px rgba(192,132,252,0.4)',
                        badgeColor: '#C084FC',
                      };
                    };

                    return (
                      <div className="relative">
                        <div
                          className={certRows > 3 ? 'overflow-y-auto pr-0.5 min-w-0' : 'min-w-0'}
                          style={
                            certRows > 3
                              ? { maxHeight: certRowHeight > 0 ? `${certRowHeight * 3 + 6}px` : '108px' }
                              : undefined
                          }
                        >
                          <div className="flex flex-col space-y-0.5 w-full">
                            {Array.from({ length: certRows }).map((_, rowIdx) => (
                              <div
                                key={`cert-row-${rowIdx}`}
                                ref={rowIdx === 0 ? certFirstRowRef : undefined}
                                className="grid grid-cols-[repeat(24,minmax(0,1fr))] gap-0.5 w-full border border-[#3b3b5c] rounded-lg overflow-hidden bg-[#0c0c18] shadow-md"
                              >
                                {Array.from({ length: 24 }).map((__, colIdx) => {
                                  const idx = rowIdx * 24 + colIdx;
                                  const cert = certs[idx];
                                  if (!cert) {
                                    return (
                                      <div
                                        key={`empty-${idx}`}
                                        className="w-full aspect-square min-w-0 border border-[#28283e] bg-[#0c0c18] opacity-70"
                                      />
                                    );
                                  }
                                  const borderStyle = resolveCertBorderStyle(cert);
                                  const rewardUrl = getDungeonRewardIconUrl(cert.dungeonId || cert.dungeonName);
                                  return (
                                    <button
                                      key={cert.id}
                                      type="button"
                                      onClick={() => onViewCertificate(cert)}
                                      onMouseEnter={(e) => {
                                        const rect = e.currentTarget.getBoundingClientRect();
                                        setHoveredCertAnchor({
                                          certId: cert.id,
                                          x: rect.left + rect.width / 2,
                                          y: rect.top,
                                        });
                                      }}
                                      onMouseLeave={() =>
                                        setHoveredCertAnchor(prev => (prev?.certId === cert.id ? null : prev))
                                      }
                                      className={`w-full aspect-square min-w-0 border-2 ${borderStyle.borderClass} bg-[#141424] hover:bg-[#1f1f35] hover:z-10 transition relative overflow-hidden cursor-pointer select-none`}
                                      style={{ boxShadow: borderStyle.glow }}
                                    >
                                      <div className="absolute inset-0 rounded flex items-center justify-center overflow-hidden z-10 pointer-events-none p-0.5">
                                        {rewardUrl ? (
                                          <img
                                            src={rewardUrl}
                                            alt={cert.dungeonName}
                                            className="w-full h-full object-cover rounded-sm"
                                          />
                                        ) : (
                                          <span className="text-base leading-none">📜</span>
                                        )}
                                      </div>
                                      <span className="absolute bottom-0 inset-x-0 bg-black/85 text-[8px] text-gray-200 truncate text-center z-20 py-0.5 px-0.5 pointer-events-none leading-tight">
                                        {shortDungeonTag(cert.dungeonName)}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            ))}
                          </div>
                        </div>

                        {hoveredCert && hoveredCertAnchor && (() => {
                          const specLabel =
                            CLASS_SPECS[hoveredCert.characterClass]?.find(s => s.id === hoveredCert.characterSpec)?.name ||
                            hoveredCert.characterSpec;
                          const classColor = CLASS_COLORS[hoveredCert.characterClass] || '#fbbf24';
                          const borderStyle = resolveCertBorderStyle(hoveredCert);
                          const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
                          const clampedX = Math.max(150, Math.min(vw - 150, hoveredCertAnchor.x));
                          return (
                            <div
                              className="fixed z-[90] -translate-x-1/2 -translate-y-full pb-2 pointer-events-none"
                              style={{ left: `${clampedX}px`, top: `${hoveredCertAnchor.y}px` }}
                            >
                              <div
                                className="bg-[#0d0d1a]/80 backdrop-blur-md border rounded-lg px-3 py-2 text-xs shadow-2xl min-w-[230px] max-w-[320px] space-y-1"
                                style={{ borderColor: borderStyle.badgeColor }}
                              >
                                <div className="flex items-center gap-1.5 font-bold" style={{ color: borderStyle.badgeColor }}>
                                  <span>📜</span>
                                  <span className="truncate">{hoveredCert.dungeonName}</span>
                                </div>
                                <div className="text-[11px] font-bold" style={{ color: classColor }}>
                                  通关专精：{CLASS_NAMES[hoveredCert.characterClass]} · {specLabel}
                                </div>
                                <div className="text-[10px] text-gray-300/90 font-mono">
                                  {new Date(hoveredCert.clearedAtIso).toLocaleDateString()} · 耗时 {hoveredCert.totalDurationSec}s · 单击查看详情
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })()}
                </div>

                {/* Game settings (combat display prefs) */}
                <div className="bg-[#1a1a30] border border-[#2e2e4e] p-4 rounded-xl space-y-3">
                  <div>
                    <h4 className="font-bold text-sm text-gray-200">游戏设置</h4>
                    <p className="text-xs text-gray-400 mt-0.5">
                      按角色保存：血条/名称、特效、地形光圈、团队框架与跳字范围
                    </p>
                  </div>
                  {(() => {
                    const prefs = resolveCombatDisplayPrefs(selectedChar.uiLayout?.combatDisplay);
                    const patchDisplay = (next: CombatDisplayPrefs) => {
                      if (!onSaveUiLayout) return;
                      onSaveUiLayout(selectedChar.id, { combatDisplay: next });
                    };
                    const toggle = (key: keyof CombatDisplayPrefs) => {
                      const cur = prefs[key];
                      if (typeof cur !== 'boolean') return;
                      patchDisplay({ ...prefs, [key]: !cur });
                    };
                    const Check = ({
                      label,
                      k,
                      title,
                    }: {
                      label: string;
                      k: keyof CombatDisplayPrefs;
                      title?: string;
                    }) => (
                      <label
                        title={title || label}
                        className="flex items-center gap-2 text-[11px] text-gray-300 cursor-pointer select-none hover:text-white min-w-0 py-0.5"
                      >
                        <input
                          type="checkbox"
                          checked={!!prefs[k]}
                          onChange={() => toggle(k)}
                          className="accent-amber-500 w-3.5 h-3.5 shrink-0 cursor-pointer"
                        />
                        <span className="truncate leading-tight">{label}</span>
                      </label>
                    );
                    return (
                      <div className="space-y-3">
                        {/* 1. 声音 */}
                        <div className="bg-[#121224] border border-[#272744] rounded-lg p-3 space-y-2.5">
                          <div className="text-[10px] text-amber-400/90 font-bold">声音</div>
                          <label className="flex items-center gap-3 text-[11px] text-gray-300">
                            <span className="shrink-0 flex items-center gap-1.5 w-20">
                              <span>{bgmVolPct === 0 ? '🔇' : '🎵'}</span>
                              <span>音量</span>
                            </span>
                            <input
                              type="range"
                              min={0}
                              max={100}
                              step={1}
                              value={bgmVolPct}
                              onChange={(e) => {
                                const pct = Number(e.target.value);
                                setBgmVolPct(pct);
                                setBgmVolume(pct / 100);
                              }}
                              className="flex-1 max-w-xs accent-amber-500 cursor-pointer"
                            />
                            <span className="w-9 text-right tabular-nums text-amber-300 font-semibold">
                              {bgmVolPct}%
                            </span>
                          </label>
                          <label className="flex items-center gap-3 text-[11px] text-gray-300">
                            <span className="shrink-0 flex items-center gap-1.5 w-20">
                              <span>{sfxVolPct === 0 ? '🔇' : '🔊'}</span>
                              <span>音效</span>
                            </span>
                            <input
                              type="range"
                              min={0}
                              max={100}
                              step={1}
                              value={sfxVolPct}
                              onChange={(e) => {
                                const pct = Number(e.target.value);
                                setSfxVolPct(pct);
                                setSfxVolume(pct / 100);
                              }}
                              className="flex-1 max-w-xs accent-amber-500 cursor-pointer"
                            />
                            <span className="w-9 text-right tabular-nums text-amber-300 font-semibold">
                              {sfxVolPct}%
                            </span>
                          </label>
                          <label className="flex items-center gap-3 text-[11px] text-gray-300">
                            <span className="shrink-0 flex items-center gap-1.5 w-20">
                              <span>{dbmVolPct === 0 ? '🔇' : '📢'}</span>
                              <span>DBM</span>
                            </span>
                            <input
                              type="range"
                              min={0}
                              max={100}
                              step={1}
                              value={dbmVolPct}
                              onChange={(e) => {
                                const pct = Number(e.target.value);
                                setDbmVolPct(pct);
                                setDbmVoiceVolume(pct / 100);
                              }}
                              className="flex-1 max-w-xs accent-sky-400 cursor-pointer"
                            />
                            <span className="w-9 text-right tabular-nums text-sky-300 font-semibold">
                              {dbmVolPct}%
                            </span>
                          </label>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 pt-2 border-t border-[#20203a]">
                            <Check label="DBM 文字播报" k="enableDbm" />
                            <Check label="DBM 语音播报" k="enableDbmVoice" />
                          </div>
                          <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-[#20203a]">
                            <button
                              type="button"
                              data-testid="dbm-test-btn"
                              onClick={() => {
                                const samples: Array<{
                                  title: string;
                                  advice: string;
                                  voiceText: string;
                                  severity: DbmAlert['severity'];
                                  roleHint: DbmAlert['roleHint'];
                                }> = [
                                  {
                                    title: '正在施放：大地践踏',
                                    advice: '近距分摊，最近目标双倍伤害',
                                    voiceText: '近距分摊',
                                    severity: 'WARN',
                                    roleHint: 'ALL',
                                  },
                                  {
                                    title: '🚨 正在施放：大地黑血沸腾',
                                    advice: '黑血阶段，躲到碎石柱后方',
                                    voiceText: '躲柱子后',
                                    severity: 'CRITICAL',
                                    roleHint: 'ALL',
                                  },
                                  {
                                    title: '即将施放：点名胸弹',
                                    advice: '点名炸弹，注意分散远离队友',
                                    voiceText: '注意分散',
                                    severity: 'WARN',
                                    roleHint: 'ALL',
                                  },
                                ];
                                const pick = samples[dbmTestIdx % samples.length];
                                setDbmTestIdx((i) => i + 1);
                                const now = Date.now();
                                setDbmTestAlerts([
                                  {
                                    id: `dbm_test_${now}`,
                                    atMs: now,
                                    title: pick.title,
                                    advice: pick.advice,
                                    voiceText: pick.voiceText,
                                    replaceKey: 'dbm_settings_test',
                                    severity: pick.severity,
                                    ttlMs: 8000,
                                    roleHint: pick.roleHint,
                                    source: 'RUNTIME',
                                  },
                                ]);
                                if (prefs.enableDbmVoice) {
                                  speakDbmVoice(pick.voiceText, { force: true });
                                }
                              }}
                              className="px-2.5 py-1 rounded bg-sky-600/80 hover:bg-sky-500 text-white text-[11px] font-bold border border-sky-400/50 transition cursor-pointer"
                            >
                              🔔 测试DBM
                            </button>
                            <span className="text-[10px] text-gray-400">
                              {!prefs.enableDbm && !prefs.enableDbmVoice
                                ? '文字与语音均已关闭'
                                : !prefs.enableDbm
                                ? '文字播报已关闭（仅测试语音）'
                                : !prefs.enableDbmVoice || dbmVolPct === 0
                                ? '语音已关闭或音量为 0%（仅显示文字，可拖动）'
                                : '独立音量；测试横幅将出现在实际位置并可拖动'}
                            </span>
                          </div>
                          <DbmAlertBanner
                            alerts={dbmTestAlerts}
                            enabled={prefs.enableDbm}
                            initialPos={selectedChar.uiLayout?.dbmBanner ?? null}
                            onSavePos={(pos) => onSaveUiLayout?.(selectedChar.id, { dbmBanner: pos })}
                            fixedOverlay
                          />
                        </div>

                        {/* 2. 视角与插件 */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="bg-[#121224] border border-[#272744] rounded-lg p-3 space-y-2">
                            <div className="text-[10px] text-amber-400/90 font-bold">视角</div>
                            <label className="flex items-center gap-2 text-[11px] text-gray-300 cursor-pointer select-none hover:text-white py-0.5">
                              <input
                                type="checkbox"
                                checked={prefs.canvasViewMode === 'ISO'}
                                onChange={(e) =>
                                  patchDisplay({
                                    ...prefs,
                                    canvasViewMode: e.target.checked ? 'ISO' : 'TOPDOWN',
                                  })
                                }
                                className="accent-amber-500 w-3.5 h-3.5 shrink-0 cursor-pointer"
                              />
                              <span className="leading-tight">2.5D 立体视角</span>
                            </label>
                            {prefs.canvasViewMode === 'ISO' && (() => {
                              const orbitSens = clampIsoViewSensitivity(
                                prefs.isoOrbitSensitivity as number
                              );
                              const pitchSens = clampIsoViewSensitivity(
                                prefs.isoPitchSensitivity as number
                              );
                              return (
                              <div className="pt-1 space-y-1.5 border-t border-[#20203a]">
                                <label className="flex flex-col gap-0.5 text-[11px] text-gray-300">
                                  <span className="flex justify-between gap-2">
                                    <span>环绕灵敏度</span>
                                    <span className="text-amber-400/90 tabular-nums">
                                      {orbitSens.toFixed(2)}
                                    </span>
                                  </span>
                                  <input
                                    type="range"
                                    min={0.5}
                                    max={1.5}
                                    step={0.05}
                                    value={orbitSens}
                                    onChange={(e) =>
                                      patchDisplay({
                                        ...prefs,
                                        isoOrbitSensitivity: Number(e.target.value),
                                      })
                                    }
                                    className="w-full accent-amber-500"
                                  />
                                </label>
                                <label className="flex flex-col gap-0.5 text-[11px] text-gray-300">
                                  <span className="flex justify-between gap-2">
                                    <span>俯仰灵敏度</span>
                                    <span className="text-amber-400/90 tabular-nums">
                                      {pitchSens.toFixed(2)}
                                    </span>
                                  </span>
                                  <input
                                    type="range"
                                    min={0.5}
                                    max={1.5}
                                    step={0.05}
                                    value={pitchSens}
                                    onChange={(e) =>
                                      patchDisplay({
                                        ...prefs,
                                        isoPitchSensitivity: Number(e.target.value),
                                      })
                                    }
                                    className="w-full accent-amber-500"
                                  />
                                </label>
                              </div>
                              );
                            })()}
                          </div>

                          <div className="bg-[#121224] border border-[#272744] rounded-lg p-3 space-y-2">
                            <div className="text-[10px] text-amber-400/90 font-bold">战斗统计插件 (Details!)</div>
                            <Check label="按照 Boss 房间自动清空计算" k="detailsResetPerBossRoom" />
                          </div>
                        </div>
                        {/* 3. 画面显示与战斗信息（统一 4 列对齐） */}
                        <div className="bg-[#121224] border border-[#272744] rounded-lg p-3 space-y-3">
                          <div>
                            <div className="text-[10px] text-amber-400/90 font-bold mb-1.5">血条 · 名称</div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5">
                              <Check label="本人血条" k="showSelfHp" />
                              <Check label="本人名称" k="showSelfName" />
                              <Check label="全员血条" k="showAllHp" />
                              <Check label="全员名称" k="showAllNames" />
                              <Check label="Boss 血条" k="showBossHp" />
                              <Check label="Boss 名称" k="showBossName" />
                              <Check label="小怪血条" k="showAddHp" />
                              <Check label="小怪名称" k="showAddName" />
                              <Check label="目标血条" k="showTargetHp" />
                              <Check label="目标名称" k="showTargetName" />
                              <Check label="焦点血条" k="showFocusHp" />
                              <Check label="焦点名称" k="showFocusName" />
                            </div>
                          </div>

                          <div className="pt-2.5 border-t border-[#20203a]">
                            <div className="text-[10px] text-amber-400/90 font-bold mb-1.5">投掷物 · 切割</div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5">
                              <Check label="友方投掷物" k="showFriendlyProjectiles" />
                              <Check label="友方切割" k="showFriendlySlash" />
                              <Check label="敌方投掷物" k="showEnemyProjectiles" />
                              <Check label="敌方切割" k="showEnemySlash" />
                            </div>
                          </div>

                          <div className="pt-2.5 border-t border-[#20203a]">
                            <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                              <div className="text-[10px] text-amber-400/90 font-bold">地形光圈</div>
                              <span className="text-[10px] text-slate-500">
                                填充：治疗绿 / 增益黄 / 伤害红；描边：友方白 / 敌方红
                              </span>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5">
                              <Check label="治疗地形" k="showHealTerrain" />
                              <Check label="加成地形" k="showBuffTerrain" />
                              <Check label="伤害地形" k="showDamageTerrain" />
                            </div>
                          </div>

                          <div className="pt-2.5 border-t border-[#20203a]">
                            <div className="text-[10px] text-amber-400/90 font-bold mb-1.5">团队框架</div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5">
                              <Check label="框架名称" k="showRaidFrameNames" />
                              <Check label="框架 Buff" k="showRaidFrameBuffs" />
                              <Check label="框架 Debuff" k="showRaidFrameDebuffs" />
                              <Check label="常驻 Buff" k="showRaidFrameStandingBuffs" />
                            </div>
                          </div>

                          <div className="pt-2.5 border-t border-[#20203a]">
                            <div className="text-[10px] text-amber-400/90 font-bold mb-1.5">跳字</div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5">
                              <Check label="我的伤害" k="showSctMyDamage" />
                              <Check label="我的治疗" k="showSctMyHeal" />
                              <Check label="治疗于我" k="showSctHealOnMe" />
                              <Check label="伤害于我" k="showSctDamageOnMe" />
                              <Check label="友方伤害" k="showSctAllyDamage" />
                              <Check label="友方治疗" k="showSctAllyHeal" />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                </div>
              </>
            ) : (
              <div className="text-center py-12 text-gray-500">
                请先在左侧选择或创建一个角色
              </div>
            )}
          </div>
        </div>
        )}

      {/* Create Character Modal */}
      {isCreating && isLoggedIn && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1a1a30] border border-amber-400/60 rounded-xl p-5 max-w-md w-full space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-amber-300">创建新冒险者</h3>
            <form onSubmit={handleCreateSubmit} className="space-y-3">
              <div>
                <label className="text-xs text-gray-300 block mb-1">角色名称（全服唯一，不可与 AI 重名）</label>
                <input
                  type="text"
                  required
                  disabled={createCharBusy}
                  placeholder="例如：阿尔萨斯"
                  value={newCharName}
                  onChange={(e) => {
                    setNewCharName(e.target.value);
                    if (createCharError) setCreateCharError(null);
                  }}
                  className="w-full bg-[#10101e] border border-[#3b3b5c] rounded p-2 text-sm text-white focus:border-amber-400 outline-none disabled:opacity-60"
                />
                <p className="mt-1 text-[10px] text-slate-500">将校验服务器全部角色名与 AI 队友名</p>
                {createCharError && (
                  <p className="mt-1.5 text-xs text-red-400 font-semibold">{createCharError}</p>
                )}
              </div>

              <div>
                <label className="text-xs text-gray-300 block mb-1">选择职业</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['DK', 'DRUID', 'SHAMAN', 'MAGE', 'ROGUE', 'WARRIOR', 'PALADIN', 'HUNTER', 'PRIEST', 'WARLOCK'] as ClassId[]).map(cls => (
                    <button
                      key={cls}
                      type="button"
                      onClick={() => handleClassChange(cls)}
                      className={`p-2 rounded border text-xs font-bold text-left flex items-center space-x-2 transition ${
                        newCharClass === cls
                          ? 'border-amber-400 bg-amber-500/20 text-white'
                          : 'border-[#2d2d48] bg-[#121222] text-gray-300 hover:border-[#4b4b75]'
                      }`}
                    >
                      <div
                        className="w-5 h-5 rounded overflow-hidden flex-shrink-0"
                        dangerouslySetInnerHTML={{ __html: CLASS_PIXEL_AVATARS[cls] || '' }}
                      />
                      <span style={{ color: newCharClass === cls ? '#FFFFFF' : CLASS_COLORS[cls] }}>{CLASS_NAMES[cls]}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-300 block mb-1">初始天赋</label>
                <select
                  value={newCharSpec}
                  onChange={(e) => setNewCharSpec(e.target.value)}
                  className="w-full bg-[#10101e] border border-[#3b3b5c] rounded p-2 text-sm text-white focus:border-amber-400 outline-none"
                >
                  {CLASS_SPECS[newCharClass].map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  disabled={createCharBusy}
                  onClick={() => setIsCreating(false)}
                  className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 rounded text-gray-300 disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={createCharBusy}
                  className="px-4 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded shadow disabled:opacity-60"
                >
                  {createCharBusy ? '校验中…' : '确认创建'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete / cancel account confirm */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
          <div className="bg-[#1a1218] border border-red-600/50 rounded-2xl p-5 max-w-sm w-full space-y-3 shadow-2xl">
            <h3 className="text-base font-extrabold text-red-300">删除账号</h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              将从<strong className="text-amber-300">服务器永久删除</strong>账号「{currentAccountName}」及全部角色、键位与通关记录，且不可恢复。
            </p>
            <div>
              <label className="text-[11px] text-slate-300 font-semibold block mb-1.5">输入密码确认</label>
              <input
                type="password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                placeholder="当前账号密码"
                className="w-full bg-[#0c1220] border border-red-900/50 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-red-400"
              />
            </div>
            {deleteError && (
              <div className="text-xs text-red-300 bg-red-950/50 border border-red-700/50 rounded-lg px-3 py-2">
                {deleteError}
              </div>
            )}
            <div className="flex justify-end space-x-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setDeletePassword('');
                  setDeleteError(null);
                }}
                className="px-3 py-2 text-xs bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 border border-slate-600"
              >
                取消
              </button>
              <button
                type="button"
                disabled={deleteBusy}
                onClick={handleDeleteAccount}
                className="px-4 py-2 text-xs font-extrabold bg-red-700 hover:bg-red-600 rounded-lg text-white border border-red-400/40 disabled:opacity-60"
              >
                {deleteBusy ? '删除中…' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Login / Register Modal */}
      {showLoginModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
          <div className="relative bg-gradient-to-b from-[#1a2238] to-[#12182a] border border-sky-500/40 rounded-2xl p-0 max-w-md w-full shadow-2xl overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-sky-500 via-amber-400 to-emerald-500" />
            <div className="px-6 pt-6 pb-2">
              <div className="flex items-center space-x-3 mb-1">
                <span className="text-2xl">{authMode === 'login' ? '🔐' : '✨'}</span>
                <div>
                  <h3 className="text-lg font-extrabold text-amber-200 tracking-wide">
                    {authMode === 'login' ? '账号登录' : '注册新账号'}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    {authMode === 'login'
                      ? '使用用户名与密码登录，跨端同步角色与键位'
                      : '创建账号后可保存角色、键位与通关证书'}
                  </p>
                </div>
              </div>

              {sessionKickNotice && (
                <div
                  role="alert"
                  className="mt-3 rounded-lg border border-rose-500/50 bg-rose-950/50 px-3 py-2.5 text-sm text-rose-100 font-semibold leading-snug"
                >
                  {sessionKickNotice}
                </div>
              )}

              <div className="mt-4 grid grid-cols-2 gap-1 p-1 rounded-xl bg-black/35 border border-white/5">
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('login');
                    setAuthError(null);
                    setAuthPasswordConfirm('');
                  }}
                  className={`py-2 text-xs font-bold rounded-lg transition ${
                    authMode === 'login'
                      ? 'bg-sky-600 text-white shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  登录
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('register');
                    setAuthError(null);
                  }}
                  className={`py-2 text-xs font-bold rounded-lg transition ${
                    authMode === 'register'
                      ? 'bg-emerald-600 text-white shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  注册
                </button>
              </div>
            </div>

            <form onSubmit={handleAuthSubmit} className="px-6 pb-6 pt-3 space-y-3.5">
              <div>
                <label className="text-[11px] text-slate-300 font-semibold block mb-1.5">用户名</label>
                <input
                  type="text"
                  autoComplete="username"
                  autoFocus
                  placeholder="例如：Champion"
                  value={authUsername}
                  onChange={(e) => setAuthUsername(e.target.value)}
                  className="w-full bg-[#0c1220] border border-[#3a4560] rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:border-sky-400 focus:ring-1 focus:ring-sky-400/40 outline-none"
                />
              </div>

              <div>
                <label className="text-[11px] text-slate-300 font-semibold block mb-1.5">密码</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
                    placeholder={authMode === 'register' ? '至少 4 位' : '输入密码'}
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    className="w-full bg-[#0c1220] border border-[#3a4560] rounded-lg px-3 py-2.5 pr-16 text-sm text-white placeholder:text-slate-600 focus:border-sky-400 focus:ring-1 focus:ring-sky-400/40 outline-none"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-slate-400 hover:text-sky-300 px-2 py-1"
                  >
                    {showPassword ? '隐藏' : '显示'}
                  </button>
                </div>
              </div>

              {authMode === 'register' && (
                <div>
                  <label className="text-[11px] text-slate-300 font-semibold block mb-1.5">确认密码</label>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder="再次输入密码"
                    value={authPasswordConfirm}
                    onChange={(e) => setAuthPasswordConfirm(e.target.value)}
                    className="w-full bg-[#0c1220] border border-[#3a4560] rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400/40 outline-none"
                  />
                </div>
              )}

              {authError && (
                <div className="text-xs text-red-300 bg-red-950/50 border border-red-700/50 rounded-lg px-3 py-2">
                  {authError}
                </div>
              )}

              <label className="flex items-center space-x-2 cursor-pointer select-none py-0.5">
                <input
                  type="checkbox"
                  checked={rememberAuth}
                  onChange={(e) => setRememberAuth(e.target.checked)}
                  className="rounded border-slate-500 bg-[#0c1220] text-sky-500 focus:ring-sky-400/40"
                />
                <span className="text-[11px] text-slate-300">记住账号密码（仅保存在本机，方便下次自动填入）</span>
              </label>

              <p className="text-[10px] text-slate-500 leading-relaxed">
                {authMode === 'login'
                  ? '登录将与服务器校验；本机可用多浏览器同时登录不同账号。仅同一角色重复连接时会替换旧连接。'
                  : '注册由服务器校验用户名唯一性，已被占用则无法创建。'}
              </p>

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setShowLoginModal(false);
                    resetAuthForm(true);
                    onDismissSessionKickNotice?.();
                  }}
                  className="px-3 py-2 text-xs bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 border border-slate-600"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={authBusy}
                  className={`px-5 py-2 text-xs font-extrabold rounded-lg shadow border disabled:opacity-60 ${
                    authMode === 'login'
                      ? 'bg-sky-600 hover:bg-sky-500 border-sky-400/40 text-white'
                      : 'bg-emerald-600 hover:bg-emerald-500 border-emerald-400/40 text-white'
                  }`}
                >
                  {authBusy
                    ? '连接中…'
                    : authMode === 'login'
                    ? '登录'
                    : '创建账号'}
                </button>
              </div>

              <p className="text-[10px] text-slate-500 text-center pt-1">
                {authMode === 'login' ? (
                  <>
                    还没有账号？
                    <button
                      type="button"
                      className="text-emerald-400 hover:underline ml-1"
                      onClick={() => {
                        setAuthMode('register');
                        setAuthError(null);
                      }}
                    >
                      去注册
                    </button>
                  </>
                ) : (
                  <>
                    已有账号？
                    <button
                      type="button"
                      className="text-sky-400 hover:underline ml-1"
                      onClick={() => {
                        setAuthMode('login');
                        setAuthError(null);
                        setAuthPasswordConfirm('');
                      }}
                    >
                      去登录
                    </button>
                  </>
                )}
              </p>
            </form>
          </div>
        </div>
      )}
      {/* Skill Book & Keybinding Modal */}
      {isSkillBookOpen && selectedChar && (
        <SkillBookModal
          isOpen={isSkillBookOpen}
          onClose={() => setIsSkillBookOpen(false)}
          classId={selectedChar.classId}
          specId={selectedChar.lastSpec}
          keybindings={selectedChar.specKeybindings?.[selectedChar.lastSpec] || {}}
          slots={activeSlots}
          onSaveKeybinding={(slotIndex, key) => {
            onSaveKeybinding(selectedChar.id, selectedChar.lastSpec, slotIndex, key);
          }}
          onChangeSpec={(specId) => {
            onChangeSpec(selectedChar.id, specId);
          }}
          onSwapSlots={onSwapSlots}
          onAssignSlot={onAssignSlot}
          onClearSlot={(slotIdx) => {
            if (onClearSlot) {
              onClearSlot(slotIdx, selectedChar.id, selectedChar.lastSpec);
            }
          }}
        />
      )}

    </div>
  );
};
