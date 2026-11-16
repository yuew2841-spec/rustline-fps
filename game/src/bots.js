// Bot AI: waypoint navigation with BFS, perception (vision cone + hearing +
// damage), burst fire control, lane pushes, site holds, plant/defuse behaviour
// and bomb recovery. Wardens attack, Jackals defend. All decisions run in the
// fixed 60 Hz step; rendering only reads positions and yaw.
import { WEAPONS, botBuyPlan } from './config.js';
import { clamp, angleDiff, dist2D, segmentBlocked } from './util.js';
import { firePellet, hasLineOfSight } from './combat.js';
import { pushEvent } from './state.js';

const WARDEN_NAMES = ['Ash', 'Rook', 'Vale', 'Pike'];
const JACKAL_NAMES = ['Fang', 'Dusk', 'Heron', 'Moth', 'Quill'];
const BOT_SPEED = 4.3;
const EYE = 1.55;

export function createBot(team, name, spawn, index) {
  return {
    isBot: true,
    name,
    team,
    index,
    x: spawn[0], y: 0, z: spawn[1],
    vx: 0, vz: 0,
    yaw: team === 'warden' ? Math.PI / 2 : -Math.PI / 2,
    pitch: 0,
    hp: 100, armor: 0, armorKind: 'none', helmet: false,
    alive: true,
    money: 800,
    weaponId: 'p9', mag: 12, reserve: 36,
    grenades: { frag: 0, flash: 0, smoke: 0 },
    height: 1.8, radius: 0.36,
    state: 'advance',
    route: index % 3, // 0 north, 1 mid, 2 south
    site: index % 2 === 0 ? 'A' : 'B',
    path: [], pathIdx: 0,
    target: null, targetT: 0, seenT: 0,
    reactionT: 0, burstLeft: 0, burstCooldown: 0, fireCooldown: 0,
    aimErr: 0.02,
    flashT: 0,
    scanT: Math.random() * 0.15,
    holdT: 0, holdNode: -1,
    plantT: 0, defuseT: 0,
    waitT: 0,
    isCarrier: false,
    speed: 0,
    deathT: 0,
    strafeDir: 1, strafeT: 0,
    lastShotHeard: 0,
    kills: 0, deaths: 0,
    mesh: null,
  };
}

export function createBots(world) {
  const bots = [];
  world.spawns.warden.slice(1).forEach((s, i) => bots.push(createBot('warden', WARDEN_NAMES[i], s, i)));
  world.spawns.jackal.forEach((s, i) => bots.push(createBot('jackal', JACKAL_NAMES[i], s, i)));
  return bots;
}

export function botBuy(bot, roundNumber) {
  const plan = botBuyPlan(roundNumber, bot.money);
  const def = WEAPONS[plan.weapon];
  bot.money -= def.price;
  bot.weaponId = plan.weapon;
  bot.mag = def.mag;
  bot.reserve = def.reserve;
  if (plan.armor !== 'none') {
    bot.money -= plan.armor === 'heavy' ? 1000 : 650;
    bot.armorKind = plan.armor;
    bot.helmet = plan.armor === 'heavy';
    bot.armor = 100;
  }
  for (const g of plan.grenades) {
    const cost = g === 'frag' ? 300 : g === 'flash' ? 200 : 300;
    if (bot.money >= cost) { bot.money -= cost; bot.grenades[g] = (bot.grenades[g] || 0) + 1; }
  }
}

function moveToward(bot, world, tx, tz, dt, speedMul = 1) {
  const dx = tx - bot.x, dz = tz - bot.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.05) { bot.vx = 0; bot.vz = 0; bot.speed = 0; return true; }
  const sp = BOT_SPEED * speedMul;
  const nx = dx / d, nz = dz / d;
  // Bot meshes face +z, so yaw = atan2(dx, dz) turns the figure toward travel.
  bot.yaw = Math.atan2(nx, nz);
  // Axis-separated movement with AABB slide.
  const r = bot.radius;
  let nx2 = bot.x + nx * sp * dt;
  let blocked = false;
  for (const b of world.colliders) {
    if (nx2 + r > b.minX && nx2 - r < b.maxX && 0 < b.maxY && 1.8 > b.minY && bot.z + r > b.minZ && bot.z - r < b.maxZ) { blocked = true; break; }
  }
  if (!blocked) bot.x = nx2;
  let nz2 = bot.z + nz * sp * dt;
  blocked = false;
  for (const b of world.colliders) {
    if (bot.x + r > b.minX && bot.x - r < b.maxX && 0 < b.maxY && 1.8 > b.minY && nz2 + r > b.minZ && nz2 - r < b.maxZ) { blocked = true; break; }
  }
  if (!blocked) bot.z = nz2;
  bot.x = clamp(bot.x, -31, 31);
  bot.z = clamp(bot.z, -21, 21);
  bot.vx = nx * sp; bot.vz = nz * sp;
  bot.speed = sp;
  return d < 0.6;
}

function setPath(bot, world, tx, tz) {
  const from = world.nearestNode(bot.x, bot.z);
  const to = world.nearestNode(tx, tz);
  bot.path = world.findPath(from, to);
  bot.pathIdx = 0;
}

function followPath(bot, world, dt) {
  if (bot.pathIdx >= bot.path.length) return true;
  const node = world.waypoints[bot.path[bot.pathIdx]];
  const arrived = moveToward(bot, world, node.x, node.z, dt);
  if (arrived) bot.pathIdx += 1;
  return bot.pathIdx >= bot.path.length;
}

function fightersOf(state, team) {
  const out = [];
  if (state.player && state.player.alive && state.player.team !== team) out.push(state.player);
  for (const b of state.bots) if (b.alive && b.team !== team) out.push(b);
  return out;
}

// Vision cone + hearing + damage memory. Returns the best visible enemy or null.
function perceive(bot, state, world, effects, dt) {
  bot.scanT -= dt;
  if (bot.scanT > 0) return bot.target;
  bot.scanT = 0.15;
  const enemies = fightersOf(state, bot.team);
  let best = null, bestScore = Infinity;
  for (const e of enemies) {
    const d = dist2D(bot.x, bot.z, e.x, e.z);
    if (d > 58) continue;
    const toE = Math.atan2(e.x - bot.x, e.z - bot.z);
    const facing = Math.abs(angleDiff(toE, bot.yaw));
    const recentlyHurt = bot.lastHurtBy === e && state.time - (bot.lastHurtT || 0) < 3;
    const heard = state.time - (e.lastShotT || -99) < 1.2 && d < 26;
    if (facing > 1.15 && !recentlyHurt && !heard) continue;
    if (bot.flashT > 0.4) continue;
    const eyeY = bot.y + EYE;
    const targetY = (e.y || 0) + 1.2;
    if (!hasLineOfSight(world, effects, bot.x, eyeY, bot.z, e.x, targetY, e.z)) continue;
    const score = d + (facing > 0.6 ? 12 : 0);
    if (score < bestScore) { bestScore = score; best = e; }
  }
  if (best) {
    if (bot.target !== best) bot.reactionT = 0.35 + Math.random() * 0.35;
    bot.target = best;
    bot.seenT = state.time;
  } else if (bot.target && state.time - bot.seenT > 1.1) {
    bot.target = null;
  }
  return bot.target;
}

function botShoot(bot, state, world, effects, rng, dt) {
  const target = bot.target;
  if (!target || !target.alive) return;
  if (bot.reactionT > 0) { bot.reactionT -= dt; return; }
  bot.fireCooldown -= dt;
  bot.burstCooldown -= dt;
  if (bot.fireCooldown > 0) return;
  if (bot.burstLeft <= 0) {
    if (bot.burstCooldown > 0) return;
    bot.burstLeft = 2 + ((rng() * 2) | 0);
    bot.burstCooldown = 0.55 + rng() * 0.5;
  }
  const def = WEAPONS[bot.weaponId];
  if (bot.mag <= 0) {
    bot.mag = def.mag;
    bot.reserve = Math.max(0, bot.reserve - def.mag);
    return;
  }
  bot.burstLeft -= 1;
  bot.fireCooldown = def.fireRate * (def.auto ? 1 : 1.4);
  bot.mag -= 1;
  bot.lastShotT = state.time;
  const d = dist2D(bot.x, bot.z, target.x, target.z);
  // Aim at the chest with error growing with distance and target speed.
  const aimErr = 0.012 + d * 0.0011 + (target.speed || 0) * 0.0012 + (bot.flashT > 0 ? 0.12 : 0);
  const tx = target.x + (rng() - 0.5) * 2 * aimErr * d;
  const ty = (target.y || 0) + 1.15 + (rng() - 0.5) * 2 * aimErr * d * 0.8;
  const tz = target.z + (rng() - 0.5) * 2 * aimErr * d;
  const ox = bot.x, oy = bot.y + EYE, oz = bot.z;
  let dx = tx - ox, dy = ty - oy, dz = tz - oz;
  const len = Math.hypot(dx, dy, dz) || 1;
  dx /= len; dy /= len; dz /= len;
  // Spread per pellet.
  for (let p = 0; p < def.pellets; p++) {
    const sp = def.spread * (p === 0 ? 1 : 2.2);
    const jx = (rng() - 0.5) * sp, jy = (rng() - 0.5) * sp;
    const px = -dz, pz = dx;
    const ndx = dx + px * jx, ndy = dy + jy, ndz = dz + pz * jx;
    const nl = Math.hypot(ndx, ndy, ndz) || 1;
    firePellet(state, world, bot, { x: ox, y: oy, z: oz }, { x: ndx / nl, y: ndy / nl, z: ndz / nl }, def, effects);
  }
  if (bot.mag === 0) { /* reload handled next burst */ }
}

function pickSiteTarget(bot, state) {
  // Warden route -> site: north lane leads to A, south lane to B, mid splits.
  if (bot.route === 0) return 'A';
  if (bot.route === 2) return 'B';
  return bot.site;
}

export function updateBots(state, world, effects, rng, dt) {
  const player = state.player;
  for (const bot of state.bots) {
    if (!bot.alive) { bot.speed = 0; continue; }
    if (bot.flashT > 0) bot.flashT -= dt;
    const target = perceive(bot, state, world, effects, dt);
    const bomb = state.bomb;

    if (state.phase === 'buy') { bot.speed = 0; bot.vx = 0; bot.vz = 0; continue; }

    // --- Engaging: strafe and shoot, pathing paused.
    if (target && target.alive) {
      const d = dist2D(bot.x, bot.z, target.x, target.z);
      const toT = Math.atan2(target.x - bot.x, target.z - bot.z);
      bot.yaw = toT;
      bot.strafeT -= dt;
      if (bot.strafeT <= 0) { bot.strafeDir *= -1; bot.strafeT = 0.7 + rng() * 0.8; }
      // Strafe perpendicular to the target, drift toward/away to hold range.
      const fx = Math.sin(toT), fz = Math.cos(toT);
      const rx = -fz, rz = fx; // right-hand side for a +z-facing figure
      const keep = d > 14 ? 1 : d < 6 ? -1 : 0;
      const mx = bot.x + (rx * bot.strafeDir * 0.7 + fx * keep * 0.4) * dt * BOT_SPEED * 0.6;
      const mz = bot.z + (rz * bot.strafeDir * 0.7 + fz * keep * 0.4) * dt * BOT_SPEED * 0.6;
      // Strafe with the same slide rules as walking.
      const r = bot.radius;
      let blocked = false;
      for (const b of world.colliders) {
        if (mx + r > b.minX && mx - r < b.maxX && bot.z + r > b.minZ && bot.z - r < b.maxZ && 0 < b.maxY) { blocked = true; break; }
      }
      if (!blocked) bot.x = mx;
      blocked = false;
      for (const b of world.colliders) {
        if (bot.x + r > b.minX && bot.x - r < b.maxX && mz + r > b.minZ && mz - r < b.maxZ && 0 < b.maxY) { blocked = true; break; }
      }
      if (!blocked) bot.z = mz;
      bot.speed = BOT_SPEED * 0.5;
      botShoot(bot, state, world, effects, rng, dt);
      continue;
    }

    // --- Objective behaviour.
    if (bot.team === 'warden') {
      // Carrier waits for teammates to close in before pushing the site.
      if (bot.isCarrier && bomb.state === 'carried') {
        let alliesNear = 0;
        for (const b of state.bots) if (b.alive && b.team === 'warden' && b !== bot && dist2D(b.x, b.z, bot.x, bot.z) < 9) alliesNear += 1;
        if (player && player.alive && dist2D(player.x, player.z, bot.x, bot.z) < 9) alliesNear += 1;
        if (alliesNear < 1 && bot.waitT < 6) {
          bot.waitT += dt;
          bot.speed = 0;
          continue;
        }
      }
      // Bomb dropped: nearest warden recovers it.
      if (bomb.state === 'dropped') {
        let nearest = null, nd = Infinity;
        for (const b of state.bots) if (b.alive && b.team === 'warden') {
          const d = dist2D(b.x, b.z, bomb.x, bomb.z);
          if (d < nd) { nd = d; nearest = b; }
        }
        if (player && player.alive && player.team === 'warden') {
          const d = dist2D(player.x, player.z, bomb.x, bomb.z);
          if (d < nd) { nd = d; nearest = player; }
        }
        if (nearest === bot) {
          if (nd < 1.4) continue; // pickup handled by rounds.js
          if (bot.pathIdx >= bot.path.length) setPath(bot, world, bomb.x, bomb.z);
          followPath(bot, world, dt);
          continue;
        }
      }
      if (bomb.state === 'planted') {
        // Hold the site: take a defensive node near the planted site.
        const site = world.sites[bomb.site];
        if (bot.holdNode < 0) {
          bot.holdNode = world.nearestNode(site.x + (rng() - 0.5) * 8, site.z + (rng() - 0.5) * 8);
          setPath(bot, world, world.waypoints[bot.holdNode].x, world.waypoints[bot.holdNode].z);
        }
        if (!followPath(bot, world, dt)) continue;
        bot.holdT += dt;
        if (bot.holdT > 2) {
          bot.holdT = 0;
          bot.holdNode = world.nearestNode(site.x + (rng() - 0.5) * 10, site.z + (rng() - 0.5) * 10);
          setPath(bot, world, world.waypoints[bot.holdNode].x, world.waypoints[bot.holdNode].z);
        }
        bot.speed = 0;
        continue;
      }
      // Push to the assigned site.
      const siteId = pickSiteTarget(bot, state);
      const site = world.sites[siteId];
      const dSite = dist2D(bot.x, bot.z, site.x, site.z);
      if (bot.isCarrier && dSite < site.r + 1.5 && bomb.state === 'carried') {
        // Plant: stand still and channel 3.2 s.
        bot.speed = 0;
        bot.plantT += dt;
        if (bot.plantT >= 3.2) {
          bot.plantT = 0;
          pushEvent(state, 'plant-complete', { bot, site: siteId });
        }
        continue;
      }
      if (bot.pathIdx >= bot.path.length) setPath(bot, world, site.x, site.z);
      followPath(bot, world, dt);
      // Pistol round: throw smoke/flash at the site entry when close.
      if (state.round === 1 && dSite < 12 && bot.grenades.smoke > 0 && !bot._usedSmoke) {
        bot._usedSmoke = true;
        bot.grenades.smoke -= 1;
        pushEvent(state, 'bot-throw', { bot, kind: 'smoke', tx: site.x, tz: site.z });
      }
    } else {
      // Jackals.
      if (bomb.state === 'planted') {
        // Retake: converge on the planted site; the first arrival defuses.
        const site = world.sites[bomb.site];
        const dSite = dist2D(bot.x, bot.z, site.x, site.z);
        if (dSite < 2.2 && bomb.defuseBy === null) {
          bot.speed = 0;
          bot.defuseT += dt;
          bomb.defuseBy = bot;
          if (bot.defuseT >= 10) {
            bot.defuseT = 0;
            pushEvent(state, 'defuse-complete', { bot });
          }
          continue;
        }
        if (bomb.defuseBy === bot) { bot.defuseT = 0; bomb.defuseBy = null; }
        if (bot.pathIdx >= bot.path.length) setPath(bot, world, site.x, site.z);
        followPath(bot, world, dt);
        continue;
      }
      // Hold: each jackal holds near a site or mid.
      if (bot.holdNode < 0) {
        const site = world.sites[bot.site];
        bot.holdNode = world.nearestNode(site.x + (bot.index % 2 ? 6 : -6), site.z + (bot.index % 3 - 1) * 6);
        setPath(bot, world, world.waypoints[bot.holdNode].x, world.waypoints[bot.holdNode].z);
      }
      if (!followPath(bot, world, dt)) continue;
      bot.speed = 0;
      bot.holdT += dt;
      // Occasionally rotate to another hold spot.
      if (bot.holdT > 9 + bot.index * 2) {
        bot.holdT = 0;
        const site = world.sites[bot.site];
        bot.holdNode = world.nearestNode(site.x + (rng() - 0.5) * 14, site.z + (rng() - 0.5) * 14);
        setPath(bot, world, world.waypoints[bot.holdNode].x, world.waypoints[bot.holdNode].z);
      }
    }
  }
}
