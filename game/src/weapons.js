// Weapon handling: fire discipline, spread, recoil, reload, ADS zoom and
// switching. Firing produces a shot description; combat.js resolves the hit.
import { WEAPONS } from './config.js';
import { clamp } from './util.js';

export function createWeaponState(weaponId) {
  const def = WEAPONS[weaponId];
  return { weaponId, mag: def.mag, reserve: def.reserve, reloadT: 0, cooldown: 0 };
}

export function switchWeapon(player, weaponId) {
  if (!player._ammo) player._ammo = {};
  // Remember the outgoing weapon's ammo so switching never refills a mag.
  player._ammo[player.weaponId] = { mag: player.mag, reserve: player.reserve };
  const def = WEAPONS[weaponId];
  const saved = player._ammo[weaponId];
  player.weaponId = weaponId;
  player.mag = saved ? saved.mag : def.mag;
  player.reserve = saved ? saved.reserve : def.reserve;
  player.reloadT = 0;
  player.fireCooldown = 0.25;
}

export function buyWeapon(player, weaponId) {
  const def = WEAPONS[weaponId];
  if (player.money < def.price) return false;
  player.money -= def.price;
  switchWeapon(player, weaponId);
  return true;
}

// Returns a shot {dir, spread, pellets, def} when a shot is actually fired,
// 'dry' when the trigger pulled on an empty mag, or null when nothing happens.
export function tryFire(player, input, rng, dt) {
  const def = WEAPONS[player.weaponId];
  player.fireCooldown -= dt;
  if (player.reloadT > 0) return null;
  const trigger = def.auto ? input.mouse.down : input.mouse.down && !player._triggerHeld;
  player._triggerHeld = input.mouse.down;
  if (!trigger) return null;
  if (player.fireCooldown > 0) return null;
  if (player.mag <= 0) {
    player.fireCooldown = 0.25;
    return 'dry';
  }
  player.fireCooldown = def.fireRate;
  player.mag -= 1;
  // Spread: base + bloom + movement penalty; ADS tightens it.
  let spread = def.spread + player.spreadBloom;
  if (player.speed > 1) spread += def.moveSpread * Math.min(1, player.speed / 5.2);
  if (!player.onGround) spread += 0.03;
  if (player.crouched) spread *= 0.7;
  if (player.ads) spread = def.adsSpread + player.spreadBloom * 0.4;
  player.spreadBloom = clamp(player.spreadBloom + def.recoil * 0.55, 0, 0.05);
  // Recoil: pitch kicks up and recovers; yaw wanders slightly.
  player.recoilPitch += def.recoil * (0.7 + rng() * 0.6);
  player.recoilYaw += (rng() - 0.5) * def.recoil * 0.5;
  return { def, spread, pellets: def.pellets };
}

export function startReload(player) {
  const def = WEAPONS[player.weaponId];
  if (player.reloadT > 0 || player.mag === def.mag || player.reserve <= 0) return false;
  player.reloadT = def.reload;
  return true;
}

export function updateReload(player, dt) {
  if (player.reloadT <= 0) return false;
  player.reloadT -= dt;
  if (player.reloadT > 0) return false;
  const def = WEAPONS[player.weaponId];
  const need = def.mag - player.mag;
  const take = Math.min(need, player.reserve);
  player.mag += take;
  player.reserve -= take;
  return true;
}

// Damage at distance: full inside half range, then linear falloff to the floor.
export function damageAt(def, dist, part) {
  const d = dist > def.range ? def.range : dist;
  const fall = dist <= def.range * 0.5 ? 1 : 1 - (1 - def.falloff) * ((dist - def.range * 0.5) / (def.range * 0.5));
  let dmg = def.damage * Math.max(def.falloff, fall);
  if (part === 'head') dmg *= def.headMult;
  return dmg;
}
