// Hitscan combat: one ray per pellet, resolved against world colliders and every
// living fighter's hit volumes. Armor absorbs a share, helmets blunt headshots,
// distance falls off. Every result is returned as a plain event for the sim.
import { rayAABB, rayBot, segmentBlocked } from './util.js';
import { damageAt } from './weapons.js';
import { pushEvent } from './state.js';

function applyDamage(target, raw, part, attacker, state) {
  let dmg = raw;
  if (target.armorKind && target.armorKind !== 'none') {
    const absorb = target.armorKind === 'heavy' ? 0.55 : 0.4;
    const headHelm = part === 'head' && target.helmet;
    const eff = headHelm ? absorb : absorb * (part === 'head' ? 0.5 : 1);
    dmg = raw * (1 - eff);
    target.armor = Math.max(0, target.armor - raw * eff * 0.5);
  }
  target.hp -= dmg;
  const died = target.hp <= 0;
  if (died) {
    target.hp = 0;
    target.alive = false;
    if (target.isBot) target.deathT = 0;
  }
  return { dmg, died };
}

// Fire one pellet from `from` along `dir`. `shooter` is the fighter object;
// `targets` are the opposing fighters. Returns the hit record or null.
export function firePellet(state, world, shooter, from, dir, def, effects) {
  const maxDist = def.range * 1.6;
  let bestT = maxDist;
  let bestWall = null;
  for (const b of world.colliders) {
    const t = rayAABB(from.x, from.y, from.z, dir.x, dir.y, dir.z, b, maxDist);
    if (t >= 0 && t < bestT) { bestT = t; bestWall = b; }
  }
  let hitFighter = null;
  let hitPart = null;
  let hitT = bestT;
  for (const f of state.bots) {
    if (!f.alive || f === shooter) continue;
    const hit = rayBot(from.x, from.y, from.z, dir.x, dir.y, dir.z, f, bestT);
    if (hit && hit.t < hitT) { hitT = hit.t; hitFighter = f; hitPart = hit.part; }
  }
  const player = state.player;
  if (player && player.alive && player !== shooter) {
    const hit = rayBot(from.x, from.y, from.z, dir.x, dir.y, dir.z, player, bestT);
    if (hit && hit.t < hitT) { hitT = hit.t; hitFighter = player; hitPart = hit.part; }
  }
  const end = {
    x: from.x + dir.x * hitT,
    y: from.y + dir.y * hitT,
    z: from.z + dir.z * hitT,
  };
  if (effects) {
    effects.tracer(from, end, def.tracer ? parseInt(def.tracer.slice(1), 16) : 0xffe08a);
  }
  if (hitFighter) {
    const dmg = damageAt(def, hitT, hitPart);
    const res = applyDamage(hitFighter, dmg, hitPart, shooter, state);
    if (effects) effects.blood(end.x, end.y, end.z);
    pushEvent(state, 'hit', {
      shooter, target: hitFighter, part: hitPart, dmg: res.dmg, died: res.died, dist: hitT,
    });
    if (res.died) {
      pushEvent(state, 'kill', { shooter, target: hitFighter, part: hitPart });
      if (shooter === player) player.kills += 1;
      if (hitFighter === player) player.deaths += 1;
    }
    return { hit: hitFighter, part: hitPart, dmg: res.dmg, died: res.died, t: hitT, end };
  }
  if (effects && bestWall) effects.impact(end.x, end.y, end.z);
  return { hit: null, t: hitT, end };
}

// Can `a` see `b` (eye to chest), ignoring smoke unless `smokeBlocks` says so?
export function hasLineOfSight(world, effects, ax, ay, az, bx, by, bz) {
  if (segmentBlocked(ax, ay, az, bx, by, bz, world.colliders)) return false;
  if (effects && effects.smokeBlocks(ax, ay, az, bx, by, bz)) return false;
  return true;
}
