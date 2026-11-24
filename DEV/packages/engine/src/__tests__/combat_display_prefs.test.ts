import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_COMBAT_DISPLAY_PREFS,
  resolveCombatDisplayPrefs,
  type CombatDisplayPrefs,
} from '../types.js';
import { AccountManager } from '../auth/AccountManager.js';

describe('CombatDisplayPrefs', () => {
  it('defaults keep prior self/boss/target plates on and all-names/SCT-ally off', () => {
    const d = DEFAULT_COMBAT_DISPLAY_PREFS;
    assert.equal(d.canvasViewMode, 'TOPDOWN');
    assert.equal(d.isoOrbitSensitivity, 1);
    assert.equal(d.isoPitchSensitivity, 1);
    assert.equal(d.moveSensitivity, 1);
    assert.equal(d.showSelfHp, true);
    assert.equal(d.showSelfName, true);
    assert.equal(d.showAllHp, false);
    assert.equal(d.showAllNames, false);
    assert.equal(d.showBossHp, true);
    assert.equal(d.showBossName, true);
    assert.equal(d.showSctMyDamage, true);
    assert.equal(d.showSctMyHeal, true);
    assert.equal(d.showSctHealOnMe, true);
    assert.equal(d.showSctDamageOnMe, true);
    assert.equal(d.showSctAllyDamage, false);
    assert.equal(d.showSctAllyHeal, false);
  });

  it('resolve merges partial saves without dropping new keys', () => {
    const resolved = resolveCombatDisplayPrefs({
      showBossName: false,
      showAllNames: true,
      showSctAllyDamage: true,
      canvasViewMode: 'ISO',
    });
    assert.equal(resolved.showBossName, false);
    assert.equal(resolved.showAllNames, true);
    assert.equal(resolved.showSctAllyDamage, true);
    assert.equal(resolved.showSelfHp, true);
    assert.equal(resolved.showSctMyDamage, true);
    assert.equal(resolved.showSctAllyHeal, false);
    assert.equal(resolved.canvasViewMode, 'ISO');
    assert.equal(resolveCombatDisplayPrefs({ canvasViewMode: 'nope' as any }).canvasViewMode, 'TOPDOWN');
    assert.equal(resolveCombatDisplayPrefs({}).isoOrbitSensitivity, 1);
    assert.equal(
      resolveCombatDisplayPrefs({ isoOrbitSensitivity: 0.2 }).isoOrbitSensitivity,
      0.5
    );
    assert.equal(
      resolveCombatDisplayPrefs({ isoPitchSensitivity: 9 }).isoPitchSensitivity,
      1.5
    );
    assert.equal(
      resolveCombatDisplayPrefs({ isoOrbitSensitivity: 1.25 }).isoOrbitSensitivity,
      1.25
    );
    assert.equal(resolveCombatDisplayPrefs({}).moveSensitivity, 1);
    assert.equal(resolveCombatDisplayPrefs({ moveSensitivity: 0.1 }).moveSensitivity, 0.5);
    assert.equal(resolveCombatDisplayPrefs({ moveSensitivity: 2 }).moveSensitivity, 1.5);
    assert.equal(resolveCombatDisplayPrefs({}).isoBodyPitchFx, true);
    assert.equal(resolveCombatDisplayPrefs({}).isoBodyPitchSquash, 0.78);
    assert.equal(resolveCombatDisplayPrefs({ isoBodyPitchSquash: 0.2 }).isoBodyPitchSquash, 0.6);
    assert.equal(resolveCombatDisplayPrefs({ isoShadowAlpha: 9 }).isoShadowAlpha, 0.8);
    assert.equal(resolveCombatDisplayPrefs({ isoSideLightStrength: 0 }).isoSideLightStrength, 0.1);
    assert.equal(resolveCombatDisplayPrefs({ isoDepthFogStrength: 2 }).isoDepthFogStrength, 0.8);
    assert.equal(resolveCombatDisplayPrefs({ isoBodyPitchFx: false }).isoBodyPitchFx, false);
    assert.equal(resolveCombatDisplayPrefs({ isoFxHeightShadow: false }).isoFxHeightShadow, false);
  });

  it('AccountManager persists combatDisplay on character uiLayout', () => {
    const mgr = new AccountManager();
    mgr.register('disp_prefs_user', 'pass1234');
    mgr.login('disp_prefs_user', 'pass1234');
    const char = mgr.createCharacter('测显偏好', 'WARRIOR', 'ARMS');
    assert.ok(char);

    const prefs: CombatDisplayPrefs = {
      ...DEFAULT_COMBAT_DISPLAY_PREFS,
      showAllNames: true,
      showAllHp: true,
      showSctAllyDamage: true,
      showSctMyDamage: false,
    };
    const ok = mgr.saveCharacterUiLayout(char!.id, { combatDisplay: prefs });
    assert.equal(ok, true);

    const layout = mgr.getCharacterUiLayout(char!.id);
    assert.ok(layout?.combatDisplay);
    assert.equal(layout!.combatDisplay!.showAllNames, true);
    assert.equal(layout!.combatDisplay!.showAllHp, true);
    assert.equal(layout!.combatDisplay!.showSctAllyDamage, true);
    assert.equal(layout!.combatDisplay!.showSctMyDamage, false);

    const again = resolveCombatDisplayPrefs(layout!.combatDisplay);
    assert.equal(again.showAllNames, true);
    assert.equal(again.showSctHealOnMe, true);
  });
});

