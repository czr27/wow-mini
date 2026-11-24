import type {
  ClassId,
  RoleId,
  DungeonDifficulty,
  CustomDifficultySettings,
  Buff,
  FloatingCombatText,
} from '../types.js';
import type { LobbyRoom, PlayerInfo } from '../room/RoomTypes.js';

/** Compact unit state for host→guest combat sync (server does not tick). */
export interface NetworkUnitSnapshot {
  id: string;
  name: string;
  classId: string;
  spec?: string;
  role: string;
  isPlayer: boolean;
  /** Host marks remote/local humans so guests don't treat them as AI stubs incorrectly */
  isHumanControlled?: boolean;
  isAi?: boolean;
  /** Pet / hunter companion / water elemental */
  isPet?: boolean;
  ownerId?: string;
  /** PLAYER | AI | PET | ADD | NPC | BOSS — room-shared spawn identity */
  unitKind?: 'PLAYER' | 'AI' | 'PET' | 'ADD' | 'NPC' | 'BOSS';
  isAlive: boolean;
  hp: number;
  maxHp: number;
  mp?: number;
  maxMp?: number;
  energy?: number;
  rage?: number;
  runicPower?: number;
  focus?: number;
  absorb: number;
  position: { x: number; y: number };
  buffs: Buff[];
  combatStats?: {
    damageDealt: number;
    healingDone: number;
    overhealDone: number;
    damageTaken: number;
    interruptCount: number;
    skillDamage?: Record<string, number>;
    skillHealing?: Record<string, number>;
    skillDamageTaken?: Record<string, number>;
  };
}

/** Cast / channel timeline: guest computes progress from startedAtMs + totalMs. */
export interface NetworkCastTimeline {
  unitId: string;
  spellId: string;
  spellName: string;
  /** Host wall-clock when cast/channel started */
  startedAtMs: number;
  totalMs: number;
  isChannel?: boolean;
  targetId?: string;
  /** When true, guest must clear this cast immediately */
  interrupted?: boolean;
  interruptible?: boolean;
}

/** Compact ground FX for host→guest (puddles / cones / totems). */
export interface NetworkGroundEffectSnapshot {
  id: string;
  kind: 'TOTEM' | 'HEAL_ZONE' | 'DAMAGE_ZONE' | 'CONE_WARNING';
  spellId: string;
  ownerId: string;
  x: number;
  y: number;
  radius: number;
  colorHex: string;
  remainingMs: number;
  facingRad?: number;
  coneAngleRad?: number;
}

/** Spell CD timeline for guest ActionBar overlay. */
export interface NetworkCooldownTimeline {
  unitId: string;
  spellId: string;
  startedAtMs: number;
  totalMs: number;
}

export interface NetworkGcdTimeline {
  unitId: string;
  startedAtMs: number;
  totalMs: number;
}

/** Host→guest action echo so clients can play cast/ground/summon VFX on the right target. */
export interface NetworkCombatAction {
  id: string;
  atMs: number;
  actorId: string;
  spellId: string;
  spellName?: string;
  targetId?: string | null;
  kind: 'CAST_START' | 'CAST_LAND' | 'INSTANT' | 'GROUND_PLACE' | 'SUMMON' | 'INTERRUPT' | 'DISPEL';
  x?: number;
  y?: number;
  spawnedUnitId?: string;
  groundEffectId?: string;
  /** AoE ring radius (canvas px) for shared FX */
  radius?: number;
  aoePulse?: boolean;
  visualTone?: 'HEAL' | 'FRIENDLY' | 'ENEMY';
}

export interface NetworkCombatSnapshot {
  roomId: string;
  seq: number;
  /** Host wall-clock at snapshot send */
  timeMs: number;
  runPhase: string;
  /** Host dungeon progress — guests must follow (maze / boss index) */
  travelRemainingMs?: number;
  totalTravelMs?: number;
  currentBossIndex?: number;
  isCleared?: boolean;
  bossTargetId?: string | null;
  units: NetworkUnitSnapshot[];
  casts?: NetworkCastTimeline[];
  cooldowns?: NetworkCooldownTimeline[];
  gcds?: NetworkGcdTimeline[];
  groundEffects?: NetworkGroundEffectSnapshot[];
  /** Host-authoritative floating combat text — guests mirror for atmosphere numbers */
  floatingTexts?: FloatingCombatText[];
  /**
   * Recent player/AI actions (cast on target, place totem, summon pet/add).
   * Guests use these to trigger local FX tied to actor→target.
   */
  recentActions?: NetworkCombatAction[];
  /** Explicit interrupt events since last snapshot (also mirrored on casts[].interrupted) */
  interrupts?: Array<{ unitId: string; spellId?: string; atMs: number }>;
  /** Prim 迷宫：副本+关卡种子，客人本地同构重建 */
  mazeSeed?: number;
  mazeDungeonId?: string;
  mazeStageIndex?: number;
  /** 房主权威：小怪血量 / 墓碑 */
  mazeTrash?: Array<{
    id: string;
    hp: number;
    maxHp: number;
    isDead: boolean;
    isTombstone: boolean;
    dissipateAlpha?: number;
  }>;
  /** 房主赶路前锋距离（可选，客人可用于校正） */
  mazeLeadDist?: number;
  /** 房主迷宫遭遇跳字（客人按 id 合并本地绘制） */
  mazeSctEvents?: Array<{
    id: string;
    text: string;
    x: number;
    y: number;
    color: string;
    createdAt: number;
    isCrit: boolean;
  }>;
  wipeVote?: NetworkVoteState;
  skipTravelVote?: NetworkVoteState;
  /**
   * Host→guest：最近已处理的客人 clientInputId（滚动窗口）。
   * 客人据此停止重传；丢包后下一帧快照仍会带上，保证可补 ack。
   */
  ackedInputIds?: string[];
}

export type NetworkVoteKind = 'WIPE' | 'SKIP_TRAVEL';
export type WipeVoteChoice = 'RETRY' | 'FINISH';
export type SkipTravelVoteChoice = 'YES' | 'NO';

export interface NetworkVoteState {
  kind: NetworkVoteKind;
  roomId: string;
  startedAtMs: number;
  timeoutMs: number;
  /** playerId → choice string */
  votes: Record<string, string>;
  eligiblePlayerIds: string[];
  resolved?: boolean;
  result?: string | null;
}

export interface PlayerInputPayload {
  playerId: string;
  spellId?: string;
  spellName?: string;
  targetId?: string | null;
  slotIndex?: number;
  kind:
    | 'CAST'
    | 'GROUND_CAST'
    | 'SUMMON'
    | 'TARGET'
    | 'INTERRUPT'
    | 'MOVE'
    | 'DISPEL'
    | 'READY'
    | 'WIPE_VOTE'
    | 'SKIP_TRAVEL_VOTE'
    | 'REQUEST_SKIP_TRAVEL';
  /** Ground placement / move coordinates (canvas px) */
  x?: number;
  y?: number;
  /** Optional spawn hint for SUMMON (pet / add template id) */
  spawnKind?: 'PET' | 'ADD' | 'NPC';
  wipeVote?: WipeVoteChoice;
  skipTravelVote?: SkipTravelVoteChoice;
  /**
   * 客人可靠意图 id：房主按 id 幂等去重；INPUT_ACK 回传 id+attempt 供 RTT。
   * MOVE 等高频意图不带 id（fire-and-forget）。
   */
  clientInputId?: string;
  /**
   * 本包是该 id 的第几次发送（1=首发，重传递增）。
   * INPUT_ACK 原样回传，客人用对应发出时刻算回路延迟。
   */
  clientInputAttempt?: number;
}

/** 单次发送的确认：必须带 attempt，不能只按 id 合并 */
export interface InputAckEntry {
  clientInputId: string;
  /** Echo of the acked transmission's clientInputAttempt */
  attempt: number;
}

/** Host→guest：轻量确认（按「哪次发送」区分，用于正确 RTT） */
export interface InputAckPayload {
  acks: InputAckEntry[];
  /** @deprecated 仅兼容旧客户端；新路径用 acks */
  ackedInputIds?: string[];
}

export type NetMessageType =
  | 'PING'
  | 'PONG'
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'AUTH'
  | 'AUTH_OK'
  | 'AUTH_FAIL'
  | 'SESSION_KICKED'
  | 'PRESENCE'
  | 'ROOM_LIST'
  | 'ROOM_LIST_SYNC'
  | 'ROOM_CREATE'
  | 'ROOM_JOIN'
  | 'ROOM_LEAVE'
  | 'ROOM_UPDATE'
  | 'ROOM_CLOSED'
  | 'ROOM_START'
  | 'ROOM_ACTION'
  | 'PLAYER_INPUT'
  | 'INPUT_ACK'
  | 'COMBAT_STATE'
  | 'MEMBER_LEFT'
  | 'MEMBER_REPLACE_AI'
  | 'MEMBER_HOT_SWAP'
  | 'HOST_TRANSFER'
  | 'VOTE_START'
  | 'VOTE_CAST'
  | 'VOTE_STATE'
  | 'VOTE_RESULT'
  | 'CAST_INTERRUPT'
  | 'ERROR';

export interface NetEnvelope<T = unknown> {
  type: NetMessageType;
  seq?: number;
  roomId?: string;
  timeMs?: number;
  payload?: T;
  error?: string;
}

export interface AuthPayload {
  username: string;
  playerId: string;
  playerName: string;
  classId: ClassId;
  spec: string;
  role?: RoleId;
}

export interface RoomCreatePayload {
  name: string;
  dungeonId?: string;
  difficulty?: DungeonDifficulty;
  customDifficulty?: CustomDifficultySettings;
  host: PlayerInfo;
  /** Create → fill AI → start in one shot (快速游戏). */
  quickStart?: boolean;
}

export interface RoomActionPayload {
  action:
    | 'AUTO_FILL_AI'
    | 'ADD_AI'
    | 'KICK'
    | 'SET_READY'
    | 'SET_DIFFICULTY'
    | 'CHANGE_SPEC'
    | 'SWITCH_MAP'
    | 'HOT_SWAP_QUEUE';
  memberId?: string;
  role?: RoleId;
  ready?: boolean;
  difficulty?: DungeonDifficulty;
  customDifficulty?: CustomDifficultySettings;
  classId?: ClassId;
  spec?: string;
  dungeonId?: string;
  /** AUTO_FILL_AI：先踢光现有 AI 再按配额重分配（一键 AI 按钮） */
  replaceExistingAi?: boolean;
}

export interface PresencePayload {
  onlinePlayerIds: string[];
  roomId?: string;
}

export interface MemberReplaceAiPayload {
  roomId: string;
  playerId: string;
  aiMemberId: string;
  room: LobbyRoom;
}

/** Hot-swap: player takes AI slot, inheriting combat unit state. */
export interface MemberHotSwapPayload {
  roomId: string;
  room: LobbyRoom;
  playerId: string;
  replacedAiId: string;
  /** Explicit joiner identity (avoid relying solely on room.members lookup). */
  playerName?: string;
  classId?: string;
  spec?: string;
  role?: string;
  /** Inherited combat unit after id remap (host-authoritative). */
  unitSnapshot?: NetworkUnitSnapshot;
}

export interface VoteStartPayload {
  vote: NetworkVoteState;
}

export interface VoteCastPayload {
  kind: NetworkVoteKind;
  playerId: string;
  choice: string;
}

export interface VoteResultPayload {
  kind: NetworkVoteKind;
  result: string;
  vote: NetworkVoteState;
}

export function encodeNetMessage(msg: NetEnvelope): string {
  return JSON.stringify(msg);
}

export function decodeNetMessage(raw: string): NetEnvelope | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.type !== 'string') return null;
    return parsed as NetEnvelope;
  } catch {
    return null;
  }
}

/** Majority of eligible humans; ties fail. Empty eligible → false. */
export function hasMajorityYes(
  eligiblePlayerIds: string[],
  votes: Record<string, string>,
  yesValue = 'YES'
): boolean {
  const n = eligiblePlayerIds.length;
  if (n <= 0) return false;
  const yes = eligiblePlayerIds.filter((id) => votes[id] === yesValue).length;
  return yes > n / 2;
}

/** Wipe: majority of RETRY vs FINISH among votes cast; if none cast, null. */
export function resolveWipeMajority(
  eligiblePlayerIds: string[],
  votes: Record<string, string>
): WipeVoteChoice | null {
  let retry = 0;
  let finish = 0;
  for (const id of eligiblePlayerIds) {
    const v = votes[id];
    if (v === 'RETRY') retry++;
    else if (v === 'FINISH') finish++;
  }
  if (retry === 0 && finish === 0) return null;
  if (retry === finish) return null;
  return retry > finish ? 'RETRY' : 'FINISH';
}
