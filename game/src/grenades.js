// Thrown grenades: frag (timed explosion with falloff), flash (line-of-sight
// blind within radius, scaled by facing), smoke (a lingering vision-blocking
// cloud). Grenades are simulated as small ballistic bodies in the fixed step.
import { GRENADES } from './config.js';
import { pushEvent } from './state.js';
import { segmentBlocked } from './util.js';

export function throwGrenade(state, world, thrower, kind, dir) {
  const def = GRENADES[kind];
  const g = {
    kind,
    x: thrower.x, y: thrower.y + 1.5, z: thrower.z,
    vx: dir.x * 14 + (thrower.vx || 0) * 0.5,
    vy: dir.y * 14 + 4.5,
    vz: dir.z * 14 + (thrower.vz || 0) * 0.5,
    fuse: kind === 'frag' ? 1.6 : 1.1,
    thrower,
    bounced: 0,
  };
  state.grenades.push(g);
  pushEvent(state, 'grenade-thrown', { kind, thrower });
  return g;
}

function collideGrenade(g, world, dt) {
  g.vy -= 12 * dt;
  g.x += g.vx * dt;
  g.y += g.vy * dt;
  g.z += g.vz * dt;
  if (g.y < 0.12) { g.y = 0.12; g.vy = Math.abs(g.vy) * 0.35; g.vx *= 0.6; g.vz *= 0.6; g.bounced += 1; }
  for (const b of world.colliders) {
    if (g.x > b.minX - 0.1 && g.x < b.maxX + 0.1 && g.y > b.minY && g.y < b.maxY + 0.1 && g.z > b.minZ - 0.1 && g.z < b.maxZ + 0.1) {
      // Cheap bounce: push out along the smallest penetration axis.
      const px = Math.min(g.x - (b.minX - 0.1), (b.maxX + 0.1) - g.x);
      const pz = Math.min(g.z - (b.minZ - 0.1), (b.maxZ + 0.1) - g.z);
      if (px < pz) { g.vx *= -0.4; g.x += g.vx > 0 ? 0.15 : -0.15; }
      else { g.vz *= -0.4; g.z += g.vz > 0 ? 0.15 : -0.15; }
      g.bounced += 1;
    }
  }
}

function explodeFrag(state, g, effects) {
  const def = GRENADES.frag;
  if (effects) effects.explosion(g.x, g.y, g.z);
  pushEvent(state, 'explosion', { x: g.x, y: g.y, z: g.z, thrower: g.thrower });
  const fighters = [...state.bots];
  if (state.player) fighters.push(state.player);
  for (const f of fighters) {
    if (!f.alive || f === g.thrower) continue;
    const dx = f.x - g.x, dy = (f.y + 1) - g.y, dz = f.z - g.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > def.radius) continue;
    if (segmentBlocked(g.x, g.y, g.z, f.x, f.y + 1, f.z, state.world.colliders)) continue;
    const dmg = def.damage * (1 - d / (def.radius * 1.3));
    f.hp -= dmg;
    if (f.hp <= 0) {
      f.hp = 0; f.alive = false;
      pushEvent(state, 'kill', { shooter: g.thrower, target: f, part: 'body', grenade: true });
      if (g.thrower === state.player) state.player.kills += 1;
    } else {
      pushEvent(state, 'hit', { shooter: g.thrower, target: f, part: 'body', dmg, died: false, dist: d });
    }
  }
}

function detonateFlash(state, g) {
  const def = GRENADES.flash;
  pushEvent(state, 'flash', { x: g.x, y: g.y, z: g.z, thrower: g.thrower });
  const fighters = [...state.bots];
  if (state.player) fighters.push(state.player);
  for (const f of fighters) {
    if (!f.alive) continue;
    const dx = f.x - g.x, dy = (f.y + 1.4) - g.y, dz = f.z - g.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > def.radius) continue;
    if (segmentBlocked(g.x, g.y, g.z, f.x, f.y + 1.4, f.z, state.world.colliders)) continue;
    // Facing the flash blinds longer; looking away halves it.
    let facing = 1;
    if (f.yaw !== undefined && d > 0.5) {
      // Bots face +z (yaw = atan2(dx, dz)); the player camera faces -z.
      const toFlash = f.isBot
        ? Math.atan2(g.x - f.x, g.z - f.z)
        : Math.atan2(-(g.x - f.x), -(g.z - f.z));
      const diff = Math.abs(((toFlash - f.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      facing = diff < 1.2 ? 1 : 0.45;
    }
    const dur = def.duration * facing * (1 - d / (def.radius * 1.4));
    if (f === state.player) f.flashT = Math.max(f.flashT, dur);
    else f.flashT = Math.max(f.flashT || 0, dur);
  }
}

export function updateGrenades(state, world, effects, dt) {
  state.world = world;
  for (let i = state.grenades.length - 1; i >= 0; i--) {
    const g = state.grenades[i];
    collideGrenade(g, world, dt);
    g.fuse -= dt;
    if (g.fuse <= 0) {
      if (g.kind === 'frag') explodeFrag(state, g, effects);
      else if (g.kind === 'flash') detonateFlash(state, g);
      else if (g.kind === 'smoke') {
        if (effects) effects.smokeCloud(g.x, 0, g.z, GRENADES.smoke.duration);
        pushEvent(state, 'smoke', { x: g.x, y: g.y, z: g.z });
      }
      state.grenades.splice(i, 1);
    }
  }
}
