import {
  UserAccount,
  CharacterRecord,
  ClassId,
  KeybindingMap,
  DungeonClearCertificate,
  DungeonDifficulty,
  CustomDifficultySettings,
  DEFAULT_CUSTOM_DIFFICULTY,
  CharacterUiLayout,
} from '../types.js';
import { bumpUpdatedAt, mergeAccountLists, mergeAccounts } from './accountMerge.js';

// Default default keybinding habits for each class and spec
export function getDefaultSpecKeybindings(classId: ClassId, spec: string): KeybindingMap {
  const map: KeybindingMap = {};
  // Universal basic 1~6, Q, E, R, F, Z, X
  const defaultKeys = ['1', '2', '3', '4', '5', '6', 'Q', 'E', 'R', 'F', 'Z', 'X'];
  
  if (classId === 'DK') {
    if (spec === 'BLOOD') {
      // Tank setup: 1=Death Strike, 2=Heart Strike, 3=Death and Decay, 4=Rune Strike, 5=Outbreak, Q=Bone Shield, E=Vamp Blood, R=Icebound, F=Mind Freeze, Z=Dark Command
      defaultKeys.forEach((k, idx) => { map[idx] = k; });
    } else {
      // Frost DPS setup: 1=Obliterate, 2=Frost Strike, 3=Howling Blast, 4=Pillar of Frost, 5=Outbreak, F=Mind Freeze
      defaultKeys.forEach((k, idx) => { map[idx] = k; });
    }
  } else if (classId === 'DRUID') {
    if (spec === 'RESTORATION') {
      // Healer setup: 1=Lifebloom, 2=Rejuvenation, 3=Regrowth, 4=Nourish, 5=Swiftmend, 6=Wild Growth, Q=Tranquility, E=Barkskin, R=Innervate
      defaultKeys.forEach((k, idx) => { map[idx] = k; });
    } else {
      // Balance DPS setup: 1=Wrath, 2=Starfire, 3=Starsurge, 4=Moonfire, Q=Barkskin
      defaultKeys.forEach((k, idx) => { map[idx] = k; });
    }
  } else if (classId === 'SHAMAN') {
    if (spec === 'RESTORATION') {
      // Healer setup: 1=Riptide, 2=Healing Wave, 3=Greater Healing Wave, 4=Healing Surge, 5=Chain Heal, 6=Healing Rain, Q=Spirit Link Totem, E=Mana Tide, R=Bloodlust, F=Wind Shear
      defaultKeys.forEach((k, idx) => { map[idx] = k; });
    } else {
      // Elemental DPS: 1=Lightning Bolt, 2=Flame Shock, 3=Lava Burst, 4=Chain Lightning, R=Bloodlust, F=Wind Shear
      defaultKeys.forEach((k, idx) => { map[idx] = k; });
    }
  } else if (classId === 'MAGE') {
    // 1=Fireball, 2=Living Bomb, 3=Pyroblast, 4=Combustion, Q=Ice Block, E=Evocation, R=Time Warp, F=Counterspell
    defaultKeys.forEach((k, idx) => { map[idx] = k; });
  } else if (classId === 'ROGUE') {
    // 1=Sinister Strike, 2=Slice and Dice, 3=Eviscerate, 4=Adrenaline Rush, 5=Blade Flurry, Q=Feint, E=Cloak of Shadows, F=Kick
    defaultKeys.forEach((k, idx) => { map[idx] = k; });
  } else {
    defaultKeys.forEach((k, idx) => { map[idx] = k; });
  }
  return map;
}

export function getDefaultSpecForClass(classId: ClassId): string {
  switch (classId) {
    case 'DK': return 'BLOOD';
    case 'DRUID': return 'RESTORATION';
    case 'SHAMAN': return 'RESTORATION';
    case 'MAGE': return 'FIRE';
    case 'ROGUE': return 'COMBAT';
    case 'WARRIOR': return 'PROTECTION';
    case 'PALADIN': return 'HOLY';
    case 'HUNTER': return 'MARKSMANSHIP';
    case 'PRIEST': return 'HOLY';
    case 'WARLOCK': return 'AFFLICTION';
    default: return 'DEFAULT';
  }
}

export class AccountManager {
  private accounts: Map<string, UserAccount> = new Map();
  private currentUsername: string | null = null;
  private currentCharacterId: string | null = null;
  private storageKey = 'cata_raid_sim_accounts_v1';
  private activeUserKey = 'cata_raid_sim_last_active_user';
  private activeCharKey = 'cata_raid_sim_last_active_char';

  constructor() {
    this.loadFromStorage();
    if (this.accounts.size === 0) {
      // Create a default initial guest account for immediate instant play
      this.initDefaultAccount();
    }
  }

  private initDefaultAccount() {
    const defaultUser = this.register('Champion', 'wow123');
    if (defaultUser) {
      // Seed all 10 Cataclysm playable classes for instant tryout
      const dk = this.createCharacter('莫格莱尼', 'DK', 'BLOOD');
      this.createCharacter('玛法里奥', 'DRUID', 'RESTORATION');
      this.createCharacter('萨尔', 'SHAMAN', 'RESTORATION');
      this.createCharacter('吉安娜', 'MAGE', 'FIRE');
      this.createCharacter('瓦莉拉', 'ROGUE', 'COMBAT');
      this.createCharacter('瓦里安', 'WARRIOR', 'ARMS');
      this.createCharacter('提里奥', 'PALADIN', 'HOLY');
      this.createCharacter('希尔瓦娜斯', 'HUNTER', 'MARKSMANSHIP');
      this.createCharacter('安度因', 'PRIEST', 'HOLY');
      this.createCharacter('古尔丹', 'WARLOCK', 'AFFLICTION');
      if (dk) {
        this.currentCharacterId = dk.id;
        if (typeof localStorage !== 'undefined') {
          try {
            localStorage.setItem(this.activeCharKey, dk.id);
          } catch {}
        }
      }
    }
  }

  private loadFromStorage() {
    if (typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem(this.storageKey);
        if (raw) {
          const list: UserAccount[] = JSON.parse(raw);
          for (const acc of list) {
            for (const char of acc.characters) {
              if (!char.lastDungeonTier) char.lastDungeonTier = '5man';
              if (!char.lastDungeonDifficulty) char.lastDungeonDifficulty = 'HEROIC';
              if (!char.lastCustomDifficulty) char.lastCustomDifficulty = { ...DEFAULT_CUSTOM_DIFFICULTY };
              if (!char.uiLayout) char.uiLayout = {};
            }
            this.accounts.set(acc.username.toLowerCase(), acc);
          }
        }
        const lastUser = localStorage.getItem(this.activeUserKey);
        if (lastUser && this.accounts.has(lastUser.toLowerCase())) {
          this.currentUsername = lastUser.toLowerCase();
          const lastChar = localStorage.getItem(this.activeCharKey);
          const acc = this.accounts.get(this.currentUsername);
          if (acc && lastChar && acc.characters.some(c => c.id === lastChar)) {
            this.currentCharacterId = lastChar;
          } else if (acc && acc.characters.length > 0) {
            this.currentCharacterId = acc.characters[0].id;
          }
        } else if (this.accounts.size > 0) {
          const firstKey = this.accounts.keys().next().value;
          if (firstKey) {
            this.currentUsername = firstKey;
            const acc = this.accounts.get(firstKey);
            if (acc && acc.characters.length > 0) {
              this.currentCharacterId = acc.characters[0].id;
            }
          }
        }
      } catch (err) {
        console.warn('Failed to load accounts from localStorage', err);
      }
    }
  }

  public saveToStorage() {
    if (typeof localStorage !== 'undefined') {
      try {
        const list = Array.from(this.accounts.values());
        localStorage.setItem(this.storageKey, JSON.stringify(list));
      } catch (err) {
        console.warn('Failed to save accounts to localStorage', err);
      }
    }
    this.triggerServerSync();
  }

  public register(username: string, passwordHash: string): UserAccount | null {
    const key = username.trim().toLowerCase();
    if (!key) return null;
    if (this.accounts.has(key)) {
      return null; // Username already exists
    }

    const now = Date.now();
    const account: UserAccount = {
      id: `acc_${now}_${Math.random().toString(36).substring(2, 7)}`,
      username: username.trim(),
      passwordHash: passwordHash || 'default',
      characters: [],
      createdAtIso: new Date().toISOString(),
      updatedAtMs: now,
    };

    this.accounts.set(key, account);
    this.currentUsername = key;
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(this.activeUserKey, key);
      } catch {}
    }
    this.saveToStorage();
    return account;
  }

  public login(username: string, passwordHash: string): UserAccount | null {
    const key = username.trim().toLowerCase();
    const account = this.accounts.get(key);
    if (!account) return null;
    // In prototype, simple password check
    if (passwordHash && account.passwordHash !== passwordHash && account.passwordHash !== 'wow123') {
      return null;
    }
    this.currentUsername = key;
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(this.activeUserKey, key);
      } catch {}
    }
    if (account.characters.length > 0 && !this.currentCharacterId) {
      this.currentCharacterId = account.characters[0].id;
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(this.activeCharKey, this.currentCharacterId);
        } catch {}
      }
    }
    return account;
  }

  public logout() {
    this.currentUsername = null;
    this.currentCharacterId = null;
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(this.activeUserKey);
        localStorage.removeItem(this.activeCharKey);
      } catch {}
    }
  }

  public getCurrentAccount(): UserAccount | null {
    if (!this.currentUsername) return null;
    return this.accounts.get(this.currentUsername) || null;
  }

  public getCharacters(): CharacterRecord[] {
    const acc = this.getCurrentAccount();
    return acc ? acc.characters : [];
  }

  public getCurrentCharacter(): CharacterRecord | null {
    const acc = this.getCurrentAccount();
    if (!acc) return null;
    return acc.characters.find(c => c.id === this.currentCharacterId) || acc.characters[0] || null;
  }

  public selectCharacter(charId: string): boolean {
    const acc = this.getCurrentAccount();
    if (!acc) return false;
    const char = acc.characters.find(c => c.id === charId);
    if (char) {
      this.currentCharacterId = char.id;
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(this.activeCharKey, char.id);
        } catch {}
      }
      return true;
    }
    return false;
  }

  public createCharacter(name: string, classId: ClassId, spec?: string): CharacterRecord | null {
    const acc = this.getCurrentAccount();
    if (!acc) return null;

    const chosenSpec = spec || getDefaultSpecForClass(classId);
    const now = Date.now();
    const newChar: CharacterRecord = {
      id: `char_${now}_${Math.random().toString(36).substring(2, 7)}`,
      name: name.trim(),
      classId,
      lastSpec: chosenSpec,
      specKeybindings: {
        [chosenSpec]: getDefaultSpecKeybindings(classId, chosenSpec),
      },
      clearCertificates: [],
      createdAtIso: new Date().toISOString(),
      updatedAtMs: now,
      lastDungeonTier: '5man',
      lastDungeonDifficulty: 'HEROIC',
      lastCustomDifficulty: { ...DEFAULT_CUSTOM_DIFFICULTY },
      uiLayout: {},
    };

    acc.characters.push(newChar);
    bumpUpdatedAt(acc, now);
    this.currentCharacterId = newChar.id;
    this.saveToStorage();
    return newChar;
  }

  public deleteCharacter(charId: string): boolean {
    const acc = this.getCurrentAccount();
    if (!acc) return false;

    const initialLen = acc.characters.length;
    acc.characters = acc.characters.filter(c => c.id !== charId);
    if (acc.characters.length < initialLen) {
      if (this.currentCharacterId === charId) {
        this.currentCharacterId = acc.characters.length > 0 ? acc.characters[0].id : null;
      }
      bumpUpdatedAt(acc);
      this.saveToStorage();
      return true;
    }
    return false;
  }

  private touchCharacter(char: CharacterRecord, acc: UserAccount) {
    const now = Date.now();
    bumpUpdatedAt(char, now);
    bumpUpdatedAt(acc, now);
  }

  public setCharacterSpec(charId: string, spec: string): boolean {
    const acc = this.getCurrentAccount();
    if (!acc) return false;
    const char = acc.characters.find(c => c.id === charId);
    if (!char) return false;

    char.lastSpec = spec;
    if (!char.specKeybindings[spec]) {
      char.specKeybindings[spec] = getDefaultSpecKeybindings(char.classId, spec);
    }
    this.touchCharacter(char, acc);
    this.saveToStorage();
    return true;
  }

  public saveSpecKeybinding(charId: string, spec: string, slotIndex: number, hotkey: string): boolean {
    const acc = this.getCurrentAccount();
    if (!acc) return false;
    const char = acc.characters.find(c => c.id === charId);
    if (!char) return false;

    if (!char.specKeybindings) {
      char.specKeybindings = {};
    }
    if (!char.specKeybindings[spec]) {
      char.specKeybindings[spec] = getDefaultSpecKeybindings(char.classId, spec);
    }
    char.specKeybindings[spec][slotIndex] = hotkey;
    this.touchCharacter(char, acc);
    this.saveToStorage();
    return true;
  }

  public saveFullSpecKeybindings(charId: string, spec: string, bindings: Record<number, string>): boolean {
    const acc = this.getCurrentAccount();
    if (!acc) return false;
    const char = acc.characters.find(c => c.id === charId);
    if (!char) return false;

    if (!char.specKeybindings) {
      char.specKeybindings = {};
    }
    char.specKeybindings[spec] = { ...bindings };
    this.touchCharacter(char, acc);
    this.saveToStorage();
    return true;
  }

  public saveSpecSlotLayout(charId: string, spec: string, layout: Record<number, string>): boolean {
    const acc = this.getCurrentAccount();
    if (!acc) return false;
    const char = acc.characters.find(c => c.id === charId);
    if (!char) return false;

    if (!char.specSlotLayouts) {
      char.specSlotLayouts = {};
    }
    char.specSlotLayouts[spec] = { ...layout };
    this.touchCharacter(char, acc);
    this.saveToStorage();
    return true;
  }

  public addClearCertificate(charId: string, cert: DungeonClearCertificate): boolean {
    const acc = this.getCurrentAccount();
    if (!acc) return false;
    const char = acc.characters.find(c => c.id === charId);
    if (!char) return false;

    char.clearCertificates.unshift(cert);
    this.touchCharacter(char, acc);
    this.saveToStorage();
    return true;
  }

  public saveRaidTargetMark(charId: string, playerName: string, mark: string | null): boolean {
    const acc = this.getCurrentAccount();
    if (!acc) return false;
    const char = acc.characters.find(c => c.id === charId);
    if (!char) return false;

    if (!char.savedRaidMarks) {
      char.savedRaidMarks = {};
    }
    if (mark) {
      char.savedRaidMarks[playerName] = mark;
    } else {
      delete char.savedRaidMarks[playerName];
    }
    this.touchCharacter(char, acc);
    this.saveToStorage();
    return true;
  }

  public getSavedRaidMarks(charId: string): Record<string, string> {
    const acc = this.getCurrentAccount();
    if (!acc) return {};
    const char = acc.characters.find(c => c.id === charId);
    return char?.savedRaidMarks ? { ...char.savedRaidMarks } : {};
  }

  public saveDungeonPreferences(
    charId: string,
    tier: '5man' | '20man',
    difficulty: DungeonDifficulty,
    customDifficulty?: CustomDifficultySettings
  ): boolean {
    const acc = this.getCurrentAccount();
    if (!acc) return false;
    const char = acc.characters.find(c => c.id === charId);
    if (!char) return false;

    char.lastDungeonTier = tier;
    char.lastDungeonDifficulty = difficulty;
    if (customDifficulty) {
      char.lastCustomDifficulty = { ...customDifficulty };
    }
    this.touchCharacter(char, acc);
    this.saveToStorage();
    return true;
  }

  public getDungeonPreferences(charId: string): {
    tier?: '5man' | '20man';
    difficulty?: DungeonDifficulty;
    customDifficulty?: CustomDifficultySettings;
  } | null {
    const acc = this.getCurrentAccount();
    if (!acc) return null;
    const char = acc.characters.find(c => c.id === charId);
    if (!char) return null;
    return {
      tier: char.lastDungeonTier,
      difficulty: char.lastDungeonDifficulty,
      customDifficulty: char.lastCustomDifficulty ? { ...char.lastCustomDifficulty } : undefined,
    };
  }

  /**
   * 保存战斗中角色的界面布局配置 (团队框架、动作条、统计面板等)
   * 记录在当前账号角色中，并同步至服务器端落地
   */
  public saveCharacterUiLayout(charId: string, layout: Partial<CharacterUiLayout>): boolean {
    const acc = this.getCurrentAccount();
    if (!acc) return false;
    const char = acc.characters.find(c => c.id === charId);
    if (!char) return false;

    if (!char.uiLayout) {
      char.uiLayout = {};
    }
    const nextLayout: CharacterUiLayout = { ...char.uiLayout };
    for (const [key, val] of Object.entries(layout) as Array<[keyof CharacterUiLayout, any]>) {
      if (val === null || val === undefined) {
        delete nextLayout[key];
      } else {
        (nextLayout as any)[key] = val;
      }
    }
    char.uiLayout = nextLayout;
    this.touchCharacter(char, acc);
    this.saveToStorage();
    return true;
  }

  /**
   * 获取角色的战斗界面布局配置
   */
  public getCharacterUiLayout(charId: string): CharacterUiLayout | null {
    const acc = this.getCurrentAccount();
    if (!acc) return null;
    const char = acc.characters.find(c => c.id === charId);
    return char?.uiLayout ? { ...char.uiLayout } : null;
  }

  private serverSyncTimer: any = null;

  /**
   * 触发向服务器端同步所有账号与角色数据 (防抖落地)
   */
  public triggerServerSync(serverUrl = typeof window !== 'undefined' ? '' : 'http://localhost:3001') {
    if (typeof fetch === 'undefined') return;
    if (this.serverSyncTimer) clearTimeout(this.serverSyncTimer);
    this.serverSyncTimer = setTimeout(async () => {
      try {
        const list = Array.from(this.accounts.values());
        await fetch(`${serverUrl}/api/accounts/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(list),
        });
      } catch {
        // Silently fallback if server is offline or unreachable
      }
    }, 150);
  }

  /**
   * 从服务器端加载账号与角色数据，与本地按时间戳 LWW 合并后再写回服务器。
   */
  public async loadFromServer(serverUrl = typeof window !== 'undefined' ? '' : 'http://localhost:3001'): Promise<boolean> {
    if (typeof fetch === 'undefined') return false;
    try {
      const res = await fetch(`${serverUrl}/api/accounts`);
      if (!res.ok) return false;
      const list: UserAccount[] = await res.json();
      if (!Array.isArray(list) || list.length === 0) return false;

      const localList = Array.from(this.accounts.values());
      const merged = mergeAccountLists(localList, list);
      this.accounts.clear();
      for (const acc of merged) {
        for (const char of acc.characters) {
          if (!char.uiLayout) char.uiLayout = {};
        }
        this.accounts.set(acc.username.toLowerCase(), acc);
      }
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(this.storageKey, JSON.stringify(merged));
        } catch {}
      }
      // Push merged authority blob back so all clients converge on server
      this.triggerServerSync(serverUrl);
      return true;
    } catch {
      // Server not reachable, gracefully fallback to local
    }
    return false;
  }

  /** Merge a single remote account into local (e.g. after login fetch). */
  public mergeRemoteAccount(remote: UserAccount): UserAccount {
    const key = remote.username.toLowerCase();
    const local = this.accounts.get(key);
    const merged = local ? mergeAccounts(local, remote) : remote;
    this.accounts.set(key, merged);
    this.saveToStorage();
    return merged;
  }
}
