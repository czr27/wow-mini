import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computePathGeometry,
  projectPointToMazePath,
  selectExitClosestHumanLeader,
  stepManualMazeCompanion,
} from '../mazeFollowAi.js';

describe('mazeFollowAi', () => {
  const lShapedWaypoints = [
    { x: 60, y: 100 },
    { x: 260, y: 100 }, // 200px east
    { x: 260, y: 300 }, // 200px south toward exit
  ];
  const geometry = computePathGeometry(lShapedWaypoints);

  it('projectPointToMazePath projects onto nearest corridor segment', () => {
    const p1 = projectPointToMazePath(lShapedWaypoints, geometry.segLens, { x: 160, y: 105 });
    assert.ok(Math.abs(p1.distAlongPath - 100) < 1);
    assert.ok(Math.abs(p1.distToPath - 5) < 0.01);

    const p2 = projectPointToMazePath(lShapedWaypoints, geometry.segLens, { x: 264, y: 220 });
    assert.ok(Math.abs(p2.distAlongPath - 320) < 1);
  });

  it('selectExitClosestHumanLeader prioritizes living human closer to exit', () => {
    const leader = selectExitClosestHumanLeader(
      [
        { id: 'local', position: { x: 120, y: 100 }, isAlive: true, isLocalPlayer: true },
        { id: 'ally_front', position: { x: 260, y: 240 }, isAlive: true, isLocalPlayer: false },
      ],
      lShapedWaypoints,
      geometry.segLens
    );
    assert.equal(leader?.leaderId, 'ally_front');
    assert.ok((leader?.distAlongPath ?? 0) > 300);
  });

  it('selectExitClosestHumanLeader ignores dead front-runner and picks living human', () => {
    const leader = selectExitClosestHumanLeader(
      [
        { id: 'local', position: { x: 120, y: 100 }, isAlive: true, isLocalPlayer: true },
        { id: 'dead_front', position: { x: 260, y: 290 }, isAlive: false, isLocalPlayer: false },
      ],
      lShapedWaypoints,
      geometry.segLens
    );
    assert.equal(leader?.leaderId, 'local');
  });

  it('stepManualMazeCompanion follows corridor turns instead of rigid -x line', () => {
    // Leader is moving south along the vertical corridor (x=260, y=240)
    const leaderPos = { x: 260, y: 240 };
    const leaderProj = projectPointToMazePath(lShapedWaypoints, geometry.segLens, leaderPos);

    let pos = { x: 260, y: 140 };
    for (let i = 0; i < 60; i++) {
      pos = stepManualMazeCompanion({
        unitId: 'tank_1',
        role: 'TANK',
        classId: 'WARRIOR',
        rank: 0,
        is20Man: false,
        leaderPos,
        leaderDistAlongPath: leaderProj.distAlongPath,
        currentPos: pos,
        waypoints: lShapedWaypoints,
        geometry,
        cellSize: 28,
      });
    }

    // Companion should stay inside the vertical corridor around x=260, NOT at leaderPos.x - 18 (242)
    assert.ok(Math.abs(pos.x - 260) <= 12, `expected x near 260, got ${pos.x}`);
    assert.ok(pos.y < leaderPos.y, `expected companion behind leader (y < 240), got ${pos.y}`);
  });

  it('stepManualMazeCompanion places tank closer to leader than healer', () => {
    const leaderPos = { x: 260, y: 250 };
    const leaderProj = projectPointToMazePath(lShapedWaypoints, geometry.segLens, leaderPos);

    let tankPos = { x: 260, y: 140 };
    let healerPos = { x: 260, y: 140 };
    for (let i = 0; i < 80; i++) {
      tankPos = stepManualMazeCompanion({
        unitId: 'tank_1',
        role: 'TANK',
        classId: 'PALADIN',
        rank: 0,
        is20Man: false,
        leaderPos,
        leaderDistAlongPath: leaderProj.distAlongPath,
        currentPos: tankPos,
        waypoints: lShapedWaypoints,
        geometry,
      });
      healerPos = stepManualMazeCompanion({
        unitId: 'healer_1',
        role: 'HEALER',
        classId: 'PRIEST',
        rank: 4,
        is20Man: false,
        leaderPos,
        leaderDistAlongPath: leaderProj.distAlongPath,
        currentPos: healerPos,
        waypoints: lShapedWaypoints,
        geometry,
      });
    }

    const tankDistToLeader = Math.hypot(leaderPos.x - tankPos.x, leaderPos.y - tankPos.y);
    const healerDistToLeader = Math.hypot(leaderPos.x - healerPos.x, leaderPos.y - healerPos.y);
    assert.ok(tankDistToLeader < healerDistToLeader);
  });

  it('stepManualMazeCompanion holds ground when slightly ahead of paused leader', () => {
    const leaderPos = { x: 200, y: 100 };
    const leaderProj = projectPointToMazePath(lShapedWaypoints, geometry.segLens, leaderPos);
    const slightlyAhead = { x: 212, y: 102 };

    const next = stepManualMazeCompanion({
      unitId: 'dps_1',
      role: 'DPS',
      classId: 'MAGE',
      rank: 2,
      is20Man: false,
      leaderPos,
      leaderDistAlongPath: leaderProj.distAlongPath,
      currentPos: slightlyAhead,
      waypoints: lShapedWaypoints,
      geometry,
    });

    assert.deepEqual(next, slightlyAhead);
  });
});
