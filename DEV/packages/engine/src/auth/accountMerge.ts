import type { CharacterRecord, DungeonClearCertificate, UserAccount } from '../types.js';

/** Prefer the record with the later updatedAtMs; missing timestamps lose to any defined value. */
export function pickNewerByTimestamp<T extends { updatedAtMs?: number }>(a: T, b: T): T {
  const ta = a.updatedAtMs ?? 0;
  const tb = b.updatedAtMs ?? 0;
  return tb >= ta ? b : a;
}

/**
 * Union certificates by id. Same id → later clearedAtIso wins.
 * Result sorted by clearedAtIso descending (newest first).
 */
export function mergeClearCertificates(
  local: DungeonClearCertificate[],
  remote: DungeonClearCertificate[]
): DungeonClearCertificate[] {
  const map = new Map<string, DungeonClearCertificate>();
  for (const cert of [...local, ...remote]) {
    if (!cert?.id) continue;
    const existing = map.get(cert.id);
    if (!existing) {
      map.set(cert.id, cert);
      continue;
    }
    const tExisting = Date.parse(existing.clearedAtIso) || 0;
    const tIncoming = Date.parse(cert.clearedAtIso) || 0;
    if (tIncoming >= tExisting) {
      map.set(cert.id, cert);
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => (Date.parse(b.clearedAtIso) || 0) - (Date.parse(a.clearedAtIso) || 0)
  );
}

/**
 * Merge one character: whole-char LWW for keybinds/slots/ui/prefs/marks by updatedAtMs,
 * but certificates are always union-merged (both sides keep unique clears).
 */
export function mergeCharacter(local: CharacterRecord, remote: CharacterRecord): CharacterRecord {
  const newer = pickNewerByTimestamp(local, remote);
  const older = newer === local ? remote : local;
  return {
    ...older,
    ...newer,
    clearCertificates: mergeClearCertificates(
      local.clearCertificates || [],
      remote.clearCertificates || []
    ),
    updatedAtMs: Math.max(local.updatedAtMs ?? 0, remote.updatedAtMs ?? 0),
  };
}

/**
 * Merge two account blobs for the same username (LWW by character updatedAtMs).
 * Characters only on one side are kept. Account shell fields use account updatedAtMs.
 */
export function mergeAccounts(local: UserAccount, remote: UserAccount): UserAccount {
  const charMap = new Map<string, CharacterRecord>();
  for (const c of local.characters || []) {
    charMap.set(c.id, c);
  }
  for (const remoteChar of remote.characters || []) {
    const localChar = charMap.get(remoteChar.id);
    if (!localChar) {
      charMap.set(remoteChar.id, remoteChar);
    } else {
      charMap.set(remoteChar.id, mergeCharacter(localChar, remoteChar));
    }
  }

  const shell = pickNewerByTimestamp(
    { ...local, updatedAtMs: local.updatedAtMs ?? (Date.parse(local.createdAtIso) || 0) },
    { ...remote, updatedAtMs: remote.updatedAtMs ?? (Date.parse(remote.createdAtIso) || 0) }
  );

  const maxCharTs = Math.max(
    0,
    ...Array.from(charMap.values()).map((c) => c.updatedAtMs ?? 0)
  );

  return {
    ...shell,
    username: local.username || remote.username,
    id: local.id || remote.id,
    passwordHash: shell.passwordHash || local.passwordHash || remote.passwordHash,
    characters: Array.from(charMap.values()),
    createdAtIso: local.createdAtIso || remote.createdAtIso,
    updatedAtMs: Math.max(local.updatedAtMs ?? 0, remote.updatedAtMs ?? 0, maxCharTs),
  };
}

/** Merge a list of accounts into an existing map (by username lowercased). */
export function mergeAccountLists(
  existing: UserAccount[],
  incoming: UserAccount[]
): UserAccount[] {
  const map = new Map<string, UserAccount>();
  for (const acc of existing) {
    if (acc?.username) map.set(acc.username.toLowerCase(), acc);
  }
  for (const acc of incoming) {
    if (!acc?.username) continue;
    const key = acc.username.toLowerCase();
    const prev = map.get(key);
    map.set(key, prev ? mergeAccounts(prev, acc) : acc);
  }
  return Array.from(map.values());
}

export function bumpUpdatedAt<T extends { updatedAtMs?: number }>(obj: T, now = Date.now()): T {
  obj.updatedAtMs = now;
  return obj;
}
