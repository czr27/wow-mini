import { isMeleeClassSpec, type Unit } from '@cata-raid-sim/engine';

const ROLE_PRIORITY: Record<string, number> = { TANK: 0, HEALER: 1, DPS: 2 };
const SQUAD_SIZE = 5;
const SQUAD_COUNT_20 = 4;

/** Raid-frame / Alt-target members: exclude pets and enemies. */
export function getRaidFrameUnits(units: Unit[]): Unit[] {
  return units.filter((u) => !u.isPet && u.role !== 'ENEMY');
}

/** Identity key: rebuild squads when ids OR class/role change (e.g. AI takeover). */
export function raidRosterKey(units: Unit[]): string {
  return getRaidFrameUnits(units)
    .map((u) => `${u.id}:${u.role}:${u.classId}:${u.spec || ''}`)
    .sort()
    .join(',');
}

function sortByRole(units: Unit[]): Unit[] {
  return [...units].sort(
    (a, b) => (ROLE_PRIORITY[a.role] ?? 99) - (ROLE_PRIORITY[b.role] ?? 99)
  );
}

/** Melee DPS (not tanks/healers): DK/Rog/War + non-holy Pala + Enh Sham + Feral. */
export function isMeleeDps(u: Unit): boolean {
  if (u.role !== 'DPS') return false;
  return isMeleeClassSpec(u.classId, u.spec);
}

function takeFromFront(pool: Unit[], n: number): Unit[] {
  if (n <= 0 || pool.length === 0) return [];
  return pool.splice(0, Math.min(n, pool.length));
}

function fillSquad(squad: Unit[], pools: Unit[][]): void {
  for (const pool of pools) {
    const need = SQUAD_SIZE - squad.length;
    if (need <= 0) return;
    squad.push(...takeFromFront(pool, need));
  }
}

/**
 * 20-man squad priority:
 * - 小队1: 全部 T，优先近战 DPS 补满
 * - 小队2: 全部奶，优先远程 DPS 补满
 * - 小队3~4: 剩余按近战→远程依次凑满
 */
function assign20ManSquads(members: Unit[]): Unit[][] {
  const tanks = members.filter((u) => u.role === 'TANK');
  const healers = members.filter((u) => u.role === 'HEALER');
  const meleeDps = members.filter(isMeleeDps);
  const rangedDps = members.filter(
    (u) => u.role === 'DPS' && !isMeleeDps(u)
  );
  // Any unexpected roles (should be rare) go with ranged leftover
  const other = members.filter(
    (u) =>
      u.role !== 'TANK' &&
      u.role !== 'HEALER' &&
      u.role !== 'DPS'
  );

  const meleePool = [...meleeDps];
  const rangedPool = [...rangedDps, ...other];

  const squad1: Unit[] = [...tanks];
  fillSquad(squad1, [meleePool]);

  const squad2: Unit[] = [...healers];
  fillSquad(squad2, [rangedPool]);

  const squad3: Unit[] = [];
  fillSquad(squad3, [meleePool, rangedPool]);

  const squad4: Unit[] = [];
  fillSquad(squad4, [meleePool, rangedPool]);

  // Overflow if tanks/healers alone exceed 5, or leftovers remain
  const overflow = [...meleePool, ...rangedPool];
  if (squad1.length > SQUAD_SIZE) {
    overflow.unshift(...squad1.splice(SQUAD_SIZE));
  }
  if (squad2.length > SQUAD_SIZE) {
    overflow.unshift(...squad2.splice(SQUAD_SIZE));
  }
  for (const u of overflow) {
    if (squad3.length < SQUAD_SIZE) squad3.push(u);
    else if (squad4.length < SQUAD_SIZE) squad4.push(u);
    else squad4.push(u); // keep everyone even if >5 (rare)
  }

  return [squad1, squad2, squad3, squad4];
}

/**
 * Build raid squads for frames + Alt+1~5.
 * - 5-man: one squad, role-sorted (T→H→DPS).
 * - 20-man: T+近战 / 奶+远程 / 其余近战远战凑三四队.
 */
export function assignRaidSquads(
  units: Unit[],
  is20Man: boolean,
  _rng?: () => number
): Unit[][] {
  const members = getRaidFrameUnits(units);
  if (!is20Man || members.length <= 5) {
    return [sortByRole(members)];
  }
  const squads = assign20ManSquads(members);
  while (squads.length < SQUAD_COUNT_20) squads.push([]);
  return squads.slice(0, SQUAD_COUNT_20);
}

/** Resolve live Unit[][] from stored id lists (HP/buffs stay current). */
export function resolveRaidSquads(
  squadIds: string[][],
  units: Unit[]
): Unit[][] {
  const byId = new Map(units.map((u) => [u.id, u]));
  return squadIds.map((ids) =>
    ids.map((id) => byId.get(id)).filter((u): u is Unit => !!u)
  );
}

export function getAltSquadTarget(
  squads: Unit[][],
  selectedSquadIndex: number,
  altDigit: number
): Unit | null {
  if (altDigit < 1 || altDigit > 5) return null;
  const squad = squads[selectedSquadIndex] ?? squads[0] ?? [];
  return squad[altDigit - 1] ?? null;
}
