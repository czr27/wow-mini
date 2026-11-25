import React, { useEffect, useState } from 'react';
import type {
  CharacterRecord,
  GroundEffect,
  GroundTargetState,
  FloatingCombatText,
  NetworkVoteState,
  Unit,
  UserAccount,
  DbmAlert,
} from '@cata-raid-sim/engine';
import { resolveCombatDisplayPrefs } from '@cata-raid-sim/engine';
import { CombatCanvas } from '../canvas/CombatCanvas.js';
import { ActionBar, ActionSlot, PlayerCastState, PlayerCastBar } from '../components/ActionBar.js';
import { BuffFrame } from '../components/BuffFrame.js';
import { DbmAlertBanner } from '../components/DbmAlertBanner.js';
import { FocusUnitFrame } from '../components/FocusUnitFrame.js';
import { PlayerUnitFrame } from '../components/PlayerUnitFrame.js';
import { RaidFrames, IncomingHealCast } from '../components/RaidFrames.js';
import { StatsPanel } from '../components/StatsPanel.js';
import { TargetUnitFrame } from '../components/TargetUnitFrame.js';
import { TravelRecovery } from '../components/TravelRecovery.js';
import { dkRunesForHud } from '../combat/dkResources.js';

export type CombatHudRunPhase =
  | 'LOBBY'
  | 'TRAVEL_RECOVERY'
  | 'BOSS_COMBAT'
  | 'WIPE_VOTE'
  | 'SUMMARY';

export type BossCastingInfo = {
  spellName: string;
  spellId?: string;
  description?: string;
  school?: string;
  elapsedMs: number;
  castTimeMs: number;
  interruptible: boolean;
};

export type CombatHudScreenProps = {
  friendlyUnits: Unit[];
  bossUnit?: Unit;
  /** Extra hostiles (adds) for target/focus frame resolution beyond bossUnit */
  enemyUnits?: Unit[];
  bossTargetId: string | null;
  groundEffects: GroundEffect[];
  floatingTexts: FloatingCombatText[];
  runPhase: CombatHudRunPhase;
  isApproaching: boolean;
  screenShake: boolean;
  selectedTargetId: string | null;
  focusTargetId: string | null;
  dungeonTier: '5man' | '20man';
  dungeonId?: string;
  targetBossName: string;
  currentBossIndex: number;
  travelRemainingMs: number;
  totalTravelMs: number;
  isCorpseRunning: boolean;
  corpseRunTimerMs: number;
  revivingUnitId: string | null;
  reviveProgress: number;
  autoApproachTarget: {
    targetX: number;
    targetY: number;
    desiredDist: number;
    pendingSlotIdx: number;
  } | null;
  groundTargetState: GroundTargetState | null;
  playerCast: PlayerCastState | null;
  companionCasts: Record<
    string,
    {
      spellName: string;
      progress: number;
      spellId?: string;
      totalMs?: number;
      interruptible?: boolean;
      endFlash?: 'success' | 'interrupt';
      flashUntilMs?: number;
    }
  >;
  bossCasting: BossCastingInfo | null;
  deadUnits: Unit[];
  totalDurationSec: number;
  playerGcdRemainingMs: number;
  playerGcdTotalMs: number;
  outOfRangeSpells: Record<string, boolean>;
  insufficientResourceSpells: Record<string, boolean>;
  spellResourceErrors: Record<string, string>;
  incomingHeals: Record<string, number>;
  incomingCasts: Record<string, IncomingHealCast[]>;
  savedRaidMarks: Record<string, string>;
  skipTravelVote: NetworkVoteState | null;
  mySkipVote: 'YES' | 'NO' | null;
  currentChar: CharacterRecord | null;
  account: UserAccount | null;
  playerSlots: ActionSlot[];
  onSelectUnit: (id: string) => void;
  onHoverUnit: (id: string | null) => void;
  onSetFocus: (id: string) => void;
  onClearTarget: () => void;
  onClearFocus: () => void;
  onPlayerMove: () => void;
  onCancelCast: () => void;
  onApproachComplete: () => void;
  onFastForwardTravel: () => void;
  onApproachTargetReached: () => void;
  onConfirmGroundTarget: (slotIdx: number, spellId: string, x: number, y: number) => void;
  onCancelGroundTarget: () => void;
  onPlayerRevive: () => void;
  onSkipTravelVote: (choice: 'YES' | 'NO') => void;
  onDispelUnit: (targetUnitId?: string | null) => void;
  onSetRaidMark: (targetUnitName: string, mark: string | null) => void;
  onCastSlot: (slotIdx: number) => void;
  onSwapSlots: (src: number, dest: number) => void;
  onAssignSlot: (slotIdx: number, spellId: string) => void;
  onClearSlot: (slotIdx: number) => void;
  onSaveUiLayout: (
    patch: Partial<NonNullable<CharacterRecord['uiLayout']>>
  ) => void;
  onAccountRefresh: () => void;
  /** Pre-assigned squads for raid frames + Alt+1~5 */
  raidSquads?: Unit[][];
  selectedSquadIndex?: number;
  onSelectSquad?: (squadIndex: number) => void;
  isPlayerHealer: boolean;
  /** Networked combat: lerp remote units/boss to host positions */
  syncRemotePositions?: boolean;
  /** 联机客人：迷宫小怪跟房主快照 */
  isNetworkGuest?: boolean;
  /** Guest reports local player position to host */
  onNetworkMoveReport?: (x: number, y: number) => void;
  dbmAlerts?: DbmAlert[];
};

function resolveUnitCastState(
  unit: Unit,
  bossUnit: Unit | undefined,
  bossCasting: BossCastingInfo | null,
  companionCasts: Record<
    string,
    {
      spellName: string;
      progress: number;
      spellId?: string;
      totalMs?: number;
      interruptible?: boolean;
      endFlash?: 'success' | 'interrupt';
      flashUntilMs?: number;
    }
  >
): {
  spellName: string;
  spellId?: string;
  spellIcon?: string;
  progress: number;
  interruptible: boolean;
  description?: string;
  school?: string;
  endFlash?: 'success' | 'interrupt';
} | null {
  const companion = companionCasts[unit.id];
  // End-flash (land/interrupt) wins briefly even for boss
  if (companion?.endFlash) {
    return {
      spellName: companion.spellName,
      spellId: companion.spellId,
      spellIcon: companion.spellId,
      progress: 1,
      interruptible: companion.interruptible !== false,
      endFlash: companion.endFlash,
    };
  }
  if (unit.id === bossUnit?.id && bossCasting) {
    return {
      spellName: bossCasting.spellName,
      spellId: bossCasting.spellId,
      spellIcon: bossCasting.spellId,
      progress:
        bossCasting.castTimeMs > 0
          ? Math.min(1, bossCasting.elapsedMs / bossCasting.castTimeMs)
          : 1,
      interruptible: bossCasting.interruptible,
      description: bossCasting.description,
      school: bossCasting.school,
    };
  }
  if (companion) {
    return {
      spellName: companion.spellName,
      spellId: companion.spellId,
      spellIcon: companion.spellId,
      progress: companion.progress,
      interruptible: companion.interruptible !== false,
    };
  }
  return null;
}

/** Combat viewport shell: canvas + floating HUD (no App business logic). */
export function CombatHudScreen(props: CombatHudScreenProps) {
  const {
    friendlyUnits,
    bossUnit,
    enemyUnits = [],
    bossTargetId,
    groundEffects,
    floatingTexts,
    runPhase,
    isApproaching,
    screenShake,
    selectedTargetId,
    focusTargetId,
    dungeonTier,
    dungeonId,
    targetBossName,
    currentBossIndex,
    travelRemainingMs,
    totalTravelMs,
    isCorpseRunning,
    corpseRunTimerMs,
    revivingUnitId,
    reviveProgress,
    autoApproachTarget,
    groundTargetState,
    playerCast,
    companionCasts,
    bossCasting,
    deadUnits,
    totalDurationSec,
    playerGcdRemainingMs,
    playerGcdTotalMs,
    outOfRangeSpells,
    insufficientResourceSpells,
    spellResourceErrors,
    incomingHeals,
    incomingCasts,
    savedRaidMarks,
    skipTravelVote,
    mySkipVote,
    currentChar,
    account,
    playerSlots,
    onSelectUnit,
    onHoverUnit,
    onSetFocus,
    onClearTarget,
    onClearFocus,
    onPlayerMove,
    onCancelCast,
    onApproachComplete,
    onFastForwardTravel,
    onApproachTargetReached,
    onConfirmGroundTarget,
    onCancelGroundTarget,
    onPlayerRevive,
    onSkipTravelVote,
    onDispelUnit,
    onSetRaidMark,
    onCastSlot,
    onSwapSlots,
    onAssignSlot,
    onClearSlot,
    onSaveUiLayout,
    onAccountRefresh,
    raidSquads,
    selectedSquadIndex = 0,
    onSelectSquad,
    isPlayerHealer,
    syncRemotePositions,
    isNetworkGuest,
    onNetworkMoveReport,
    dbmAlerts = [],
  } = props;
  const dbmEnabled = resolveCombatDisplayPrefs(currentChar?.uiLayout?.combatDisplay).enableDbm;

  const allUnits = [
    ...friendlyUnits,
    ...(bossUnit ? [bossUnit] : []),
    ...enemyUnits.filter((e) => e.id !== bossUnit?.id),
  ];
  const playerUnit = friendlyUnits.find(u => u.isPlayer);

  const resolveUnit = (id: string | null | undefined): Unit | undefined => {
    if (!id) return undefined;
    if (bossUnit && (id === bossUnit.id || id === 'boss')) return bossUnit;
    return (
      friendlyUnits.find((u) => u.id === id) ||
      enemyUnits.find((u) => u.id === id) ||
      undefined
    );
  };

  const targetUnit = resolveUnit(selectedTargetId);

  const focusUnit = resolveUnit(focusTargetId) || null;

  return (
    <div className="w-full flex-1 relative min-h-[640px] h-[calc(100vh-3.5rem)] overflow-hidden select-none bg-[#0a0a14]">
      <div className="absolute inset-0 z-0">
        <CombatCanvas
          units={friendlyUnits}
          enemyUnits={enemyUnits}
          bossUnit={bossUnit}
          bossTargetId={bossTargetId}
          groundEffects={groundEffects}
          floatingTexts={floatingTexts}
          runPhase={isApproaching ? 'PULL_APPROACH' : runPhase}
          screenShake={screenShake}
          selectedUnitId={selectedTargetId}
          focusTargetId={focusTargetId}
          dungeonTier={dungeonTier}
          dungeonId={dungeonId}
          targetBossName={targetBossName}
          currentBossIndex={currentBossIndex}
          travelRemainingMs={travelRemainingMs}
          totalTravelMs={totalTravelMs}
          isCorpseRunning={isCorpseRunning}
          corpseRunRemainingMs={corpseRunTimerMs}
          onSelectUnit={onSelectUnit}
          onSetFocus={onSetFocus}
          onPlayerMove={onPlayerMove}
          onCancelCast={onCancelCast}
          onApproachComplete={onApproachComplete}
          onFastForwardTravel={onFastForwardTravel}
          revivingUnitId={revivingUnitId}
          reviveProgress={reviveProgress}
          autoApproachTarget={autoApproachTarget}
          onApproachTargetReached={onApproachTargetReached}
          groundTargetState={groundTargetState}
          onConfirmGroundTarget={onConfirmGroundTarget}
          onCancelGroundTarget={onCancelGroundTarget}
          syncRemotePositions={syncRemotePositions}
          isNetworkGuest={isNetworkGuest}
          onNetworkMoveReport={onNetworkMoveReport}
          combatDisplayPrefs={currentChar?.uiLayout?.combatDisplay ?? null}
        />
      </div>

      <div className="absolute inset-0 pointer-events-none z-10">
        <DbmAlertBanner alerts={dbmAlerts} enabled={dbmEnabled} />
        {playerUnit ? (
          <BuffFrame player={playerUnit} allUnits={allUnits} />
        ) : null}

        <div className="absolute top-3 left-4 flex flex-col space-y-2 pointer-events-auto">
          {playerUnit ? (
            <PlayerUnitFrame
              player={playerUnit}
              isInCombat={runPhase === 'BOSS_COMBAT'}
              dkRunes={dkRunesForHud(playerUnit)}
              onSelect={() => onSelectUnit(playerUnit.id)}
              onSetFocus={() => onSetFocus(playerUnit.id)}
            />
          ) : null}

          {targetUnit ? (
            <TargetUnitFrame
              unit={targetUnit}
              allUnits={allUnits}
              castState={resolveUnitCastState(targetUnit, bossUnit, bossCasting, companionCasts)}
              onClearTarget={onClearTarget}
              onSelectTarget={onSelectUnit}
              onSetFocus={onSetFocus}
            />
          ) : null}

          {focusUnit ? (
            <FocusUnitFrame
              unit={focusUnit}
              allUnits={allUnits}
              castState={resolveUnitCastState(focusUnit, bossUnit, bossCasting, companionCasts)}
              onClearFocus={onClearFocus}
              onSelectTarget={onSelectUnit}
              onSetFocus={onSetFocus}
            />
          ) : null}
        </div>

        {runPhase === 'TRAVEL_RECOVERY' ? (
          <div className="absolute top-3 left-1/2 transform -translate-x-1/2 pointer-events-auto">
            <TravelRecovery
              targetBossName={targetBossName}
              remainingMs={travelRemainingMs}
              totalMs={totalTravelMs}
              deadUnits={deadUnits}
              isReviving={!!revivingUnitId}
              reviveProgress={reviveProgress}
              revivingTargetName={friendlyUnits.find(u => u.id === revivingUnitId)?.name || ''}
              isPlayerHealer={isPlayerHealer}
              onPlayerRevive={onPlayerRevive}
              onFastForward={onFastForwardTravel}
              isCorpseRunning={isCorpseRunning}
              corpseRunRemainingMs={corpseRunTimerMs}
              skipTravelVote={skipTravelVote}
              mySkipVote={mySkipVote}
              onSkipTravelVote={onSkipTravelVote}
              dungeonTier={dungeonTier}
            />
          </div>
        ) : null}

        <div className="pointer-events-auto">
          <PlayerCastBar playerCast={playerCast} onCancelCast={onCancelCast} />
        </div>

        <div className="pointer-events-auto">
          <RaidFrames
            units={friendlyUnits}
            selectedUnitId={selectedTargetId}
            onSelectUnit={onSelectUnit}
            onHoverUnit={onHoverUnit}
            onQuickDispel={onDispelUnit}
            onSetFocus={onSetFocus}
            bossTargetId={bossTargetId}
            revivingUnitId={revivingUnitId}
            reviveProgress={reviveProgress}
            is20Man={dungeonTier === '20man'}
            squads={raidSquads}
            selectedSquadIndex={selectedSquadIndex}
            onSelectSquad={onSelectSquad}
            unitCasts={companionCasts}
            playerClassId={currentChar?.classId}
            playerSpecId={currentChar?.lastSpec}
            playerPos={friendlyUnits.find(u => u.isPlayer)?.position}
            incomingHeals={incomingHeals}
            incomingCasts={incomingCasts}
            accountId={account?.id || account?.username || 'default'}
            raidMarks={savedRaidMarks}
            onSetRaidMark={onSetRaidMark}
            initialPos={
              dungeonTier === '20man'
                ? currentChar?.uiLayout?.raidFrames20man ?? currentChar?.uiLayout?.raidFrames
                : currentChar?.uiLayout?.raidFrames5man ?? currentChar?.uiLayout?.raidFrames
            }
            onSavePos={(pos) =>
              onSaveUiLayout(
                dungeonTier === '20man' ? { raidFrames20man: pos } : { raidFrames5man: pos }
              )
            }
            combatDisplayPrefs={currentChar?.uiLayout?.combatDisplay ?? null}
          />
        </div>

        <div className="pointer-events-auto">
          <StatsPanel
            units={friendlyUnits}
            durationSec={totalDurationSec}
            initialPos={currentChar?.uiLayout?.statsPanel}
            onSavePos={(pos) => onSaveUiLayout({ statsPanel: pos })}
            resetPerBossRoom={!!currentChar?.uiLayout?.combatDisplay?.detailsResetPerBossRoom}
            bossRoomKey={`${dungeonId || 'dungeon'}:${currentBossIndex}`}
          />
        </div>

        <div className="pointer-events-auto flex justify-center w-full absolute bottom-4 left-0">
          <ActionBar
            classId={currentChar ? currentChar.classId : 'DK'}
            specId={currentChar ? currentChar.lastSpec : 'BLOOD'}
            keybindings={currentChar?.specKeybindings?.[currentChar.lastSpec] || {}}
            slots={playerSlots}
            gcdRemainingMs={playerGcdRemainingMs}
            gcdTotalMs={playerGcdTotalMs}
            activeGroundSpellId={groundTargetState?.spellId}
            onCastSlot={onCastSlot}
            onSwapSlots={onSwapSlots}
            onAssignSlot={onAssignSlot}
            onClearSlot={onClearSlot}
            playerCast={playerCast}
            onCancelCast={onCancelCast}
            isInCombat={runPhase === 'BOSS_COMBAT'}
            outOfRangeSpells={outOfRangeSpells}
            insufficientResourceSpells={insufficientResourceSpells}
            spellResourceErrors={spellResourceErrors}
            dkRunes={dkRunesForHud(playerUnit)}
            comboPoints={currentChar?.classId === 'ROGUE' ? 4 : 0}
            holyPower={
              currentChar?.classId === 'PALADIN'
                ? (friendlyUnits.find(u => u.isPlayer)?.holyPower ?? 0)
                : undefined
            }
            isPlayerDead={(() => {
              const p = friendlyUnits.find(u => u.isPlayer);
              return !p || (!p.isAlive && !p.alive) || (p.hp !== undefined && p.hp <= 0);
            })()}
            initialPos={currentChar?.uiLayout?.actionBar ?? null}
            onSavePos={(pos) => {
              onSaveUiLayout({ actionBar: pos });
              onAccountRefresh();
            }}
          />
        </div>
      </div>
    </div>
  );
}
