/**
 * Boss link / tether / conduit beam VFX:
 * 1. Venoxis `toxic_link` (毒性链接): 2 players linked by toxic green tether (danger when <80px).
 * 2. Morchok `resonating_crystal` (共鸣水晶连线): linked players tethered to active crystal (blue close / amber-red far).
 * 3. Hagara `conductive_crystal` (传导水晶): lightning arcs between Hagara and alive conductive crystals.
 */
import type { GroundEffect, Unit } from '@cata-raid-sim/engine';

export type BossLinkKind = 'toxic_link' | 'resonating_crystal' | 'conductive_crystal';

export interface BossLinkBeam {
  id: string;
  kind: BossLinkKind;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  /** Distance in world px (used for color/tension cues) */
  dist: number;
  /** True when tether is in danger state (e.g. toxic_link too close, crystal too far) */
  danger: boolean;
}

export function resolveBossLinkBeams(opts: {
  units: Unit[];
  enemyUnits?: Unit[];
  bossUnit?: Unit;
  groundEffects: GroundEffect[];
  resolveUnitPos: (unitId: string) => { x: number; y: number } | null;
}): BossLinkBeam[] {
  const beams: BossLinkBeam[] = [];
  const livingFriendly = opts.units.filter(
    (u) => u.role !== 'ENEMY' && (u.isAlive ?? u.alive) && u.hp > 0
  );

  // 1. Venoxis: toxic_link between pairs of living players carrying 'toxic_link'
  const toxicLinked = livingFriendly.filter((u) =>
    u.buffs?.some((b) => b.spellId === 'toxic_link')
  );
  for (let i = 0; i + 1 < toxicLinked.length; i += 2) {
    const a = toxicLinked[i];
    const b = toxicLinked[i + 1];
    const pA = opts.resolveUnitPos(a.id);
    const pB = opts.resolveUnitPos(b.id);
    if (!pA || !pB) continue;
    const dist = Math.hypot(pB.x - pA.x, pB.y - pA.y);
    beams.push({
      id: `toxic_${a.id}_${b.id}`,
      kind: 'toxic_link',
      fromX: pA.x,
      fromY: pA.y,
      toX: pB.x,
      toY: pB.y,
      dist,
      danger: dist < 80,
    });
  }

  // 2. Morchok: resonating_crystal_link -> active resonating_crystal groundEffects
  const crystals = opts.groundEffects.filter((g) => g.spellId === 'resonating_crystal');
  if (crystals.length > 0) {
    const crystalLinked = livingFriendly.filter((u) =>
      u.buffs?.some((b) => b.spellId === 'resonating_crystal_link')
    );
    for (const u of crystalLinked) {
      const p = opts.resolveUnitPos(u.id);
      if (!p) continue;
      // Attach to nearest active resonating crystal
      let best = crystals[0];
      let bestD = Math.hypot(best.x - p.x, best.y - p.y);
      for (let k = 1; k < crystals.length; k++) {
        const d = Math.hypot(crystals[k].x - p.x, crystals[k].y - p.y);
        if (d < bestD) {
          best = crystals[k];
          bestD = d;
        }
      }
      beams.push({
        id: `crystal_${u.id}_${best.id}`,
        kind: 'resonating_crystal',
        fromX: p.x,
        fromY: p.y,
        toX: best.x,
        toY: best.y,
        dist: bestD,
        danger: bestD > 45,
      });
    }
  }

  // 3. Hagara: conductive_crystal lightning arcs (Boss <-> alive Conductive Crystals)
  const boss = opts.bossUnit;
  const bossAlive = boss && (boss.isAlive ?? boss.alive) && boss.hp > 0;
  const bossPos = bossAlive ? opts.resolveUnitPos(boss!.id) : null;
  const conductiveCrystals = (opts.enemyUnits || []).filter(
    (e) =>
      (e.isAlive ?? e.alive) &&
      e.hp > 0 &&
      (e.summonSpellId === 'conductive_crystal' || (e.name || '').startsWith('传导水晶'))
  );
  if (bossPos && conductiveCrystals.length > 0) {
    const crystalPts = conductiveCrystals
      .map((c) => ({ id: c.id, pos: opts.resolveUnitPos(c.id) || c.position || null }))
      .filter((x): x is { id: string; pos: { x: number; y: number } } => !!x.pos);

    for (const c of crystalPts) {
      beams.push({
        id: `conduit_boss_${c.id}`,
        kind: 'conductive_crystal',
        fromX: bossPos.x,
        fromY: bossPos.y,
        toX: c.pos.x,
        toY: c.pos.y,
        dist: Math.hypot(c.pos.x - bossPos.x, c.pos.y - bossPos.y),
        danger: true,
      });
    }
    // Also chain adjacent crystals in a loop if >= 2 alive
    if (crystalPts.length >= 2) {
      for (let i = 0; i < crystalPts.length; i++) {
        const a = crystalPts[i];
        const b = crystalPts[(i + 1) % crystalPts.length];
        if (crystalPts.length === 2 && i === 1) break;
        beams.push({
          id: `conduit_chain_${a.id}_${b.id}`,
          kind: 'conductive_crystal',
          fromX: a.pos.x,
          fromY: a.pos.y,
          toX: b.pos.x,
          toY: b.pos.y,
          dist: Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y),
          danger: true,
        });
      }
    }
  }

  return beams;
}

export function drawBossLinkBeams(
  ctx: CanvasRenderingContext2D,
  beams: BossLinkBeam[],
  tickCount: number
): void {
  if (!beams.length) return;
  const t = tickCount * 0.16;

  for (const beam of beams) {
    const dx = beam.toX - beam.fromX;
    const dy = beam.toY - beam.fromY;
    const len = Math.max(1, Math.hypot(dx, dy));
    const nx = -dy / len;
    const ny = dx / len;

    ctx.save();
    if (beam.kind === 'toxic_link') {
      // Toxic green tether; pulses bright lime-red when dangerously close (< 80px)
      const pulse = 0.65 + 0.35 * Math.sin(t * 2.2);
      const outerColor = beam.danger
        ? `rgba(163, 230, 53, ${0.75 * pulse})`
        : 'rgba(34, 197, 94, 0.55)';
      const coreColor = beam.danger ? '#BEF264' : '#86EFAC';

      // Wavy poison energy strand
      ctx.strokeStyle = outerColor;
      ctx.lineWidth = beam.danger ? 5.5 : 3.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      const segs = 12;
      for (let i = 0; i <= segs; i++) {
        const u = i / segs;
        const env = Math.sin(u * Math.PI);
        const wave = Math.sin(u * Math.PI * 3 - t * 2.4) * (beam.danger ? 4.5 : 2.5) * env;
        const px = beam.fromX + dx * u + nx * wave;
        const py = beam.fromY + dy * u + ny * wave;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();

      // Bright inner toxic core
      ctx.strokeStyle = coreColor;
      ctx.lineWidth = 1.6;
      ctx.stroke();

      // Flowing poison droplets along tether
      for (let d = 0; d < 2; d++) {
        const u = ((t * 0.25 + d * 0.5) % 1 + 1) % 1;
        const bx = beam.fromX + dx * u;
        const by = beam.fromY + dy * u;
        ctx.fillStyle = beam.danger ? '#EF4444' : '#4ADE80';
        ctx.beginPath();
        ctx.arc(bx, by, 2.8, 0, Math.PI * 2);
        ctx.fill();
      }

      // Midpoint warning tag
      const mx = (beam.fromX + beam.toX) / 2;
      const my = (beam.fromY + beam.toY) / 2 - 8;
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillText(beam.danger ? '🟢 拉开扯断!' : '🟢 即将扯断', mx + 1, my + 1);
      ctx.fillStyle = beam.danger ? '#BEF264' : '#86EFAC';
      ctx.fillText(beam.danger ? '🟢 拉开扯断!' : '🟢 即将扯断', mx, my);
    } else if (beam.kind === 'resonating_crystal') {
      // Blue when close (safe), amber-red pulsing when far
      const pulse = 0.65 + 0.35 * Math.sin(t * 1.8);
      ctx.strokeStyle = beam.danger
        ? `rgba(248, 113, 113, ${0.78 * pulse})`
        : `rgba(96, 165, 250, ${0.72 * pulse})`;
      ctx.lineWidth = beam.danger ? 3.5 : 2.5;
      ctx.setLineDash([6, 4]);
      ctx.lineDashOffset = -tickCount * 1.4;
      ctx.beginPath();
      ctx.moveTo(beam.fromX, beam.fromY);
      ctx.lineTo(beam.toX, beam.toY);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.strokeStyle = beam.danger ? 'rgba(254, 202, 202, 0.85)' : 'rgba(219, 234, 254, 0.85)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(beam.fromX, beam.fromY);
      ctx.lineTo(beam.toX, beam.toY);
      ctx.stroke();
    } else if (beam.kind === 'conductive_crystal') {
      // Jagged electric-cyan lightning arc
      const segs = 8;
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.65)';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i <= segs; i++) {
        const u = i / segs;
        const env = Math.sin(u * Math.PI);
        const jitter =
          i === 0 || i === segs
            ? 0
            : Math.sin(i * 12.7 + tickCount * 0.9) * 5.5 * env;
        const px = beam.fromX + dx * u + nx * jitter;
        const py = beam.fromY + dy * u + ny * jitter;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();

      ctx.strokeStyle = '#E0F2FE';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
  }
}
