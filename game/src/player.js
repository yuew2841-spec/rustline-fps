// The human player: first-person movement with acceleration, crouch, jump and
// AABB collision against the world. Position is feet-based; eye height 1.62 m
// standing, 1.15 m crouched. The sim owns position/yaw/pitch; rendering reads them.
import { clamp } from './util.js';

export function createPlayer(spawn) {
  return {
    x: spawn[0], y: 0, z: spawn[1],
    vx: 0, vy: 0, vz: 0,
    yaw: -Math.PI / 2, // facing +x (east, toward the sites)
    pitch: 0,
    hp: 100, armor: 0, armorKind: 'none', helmet: false,
    alive: true,
    crouched: false,
    onGround: true,
    money: 800,
    weaponId: 'p9',
    mag: 12, reserve: 36,
    grenades: { frag: 0, flash: 0, smoke: 0 },
    selectedGrenade: 'frag',
    height: 1.8, radius: 0.38,
    eyeHeight: 1.62,
    speed: 0,
    recoilPitch: 0,
    recoilYaw: 0,
    spreadBloom: 0,
    reloadT: 0,
    fireCooldown: 0,
    ads: false,
    planting: 0,
    defusing: 0,
    lastDamageFrom: null,
    lastDamageDir: 0,
    flashT: 0,
    kills: 0, deaths: 0,
    isCarrier: true,
    stepT: 0,
  };
}

const WALK_SPEED = 5.2;
const CROUCH_SPEED = 2.6;
const ACCEL = 42;
const FRICTION = 10;
const JUMP_VEL = 5.4;
const GRAVITY = -14.5;

function collideAxis(p, colliders, axis, delta) {
  if (delta === 0) return;
  if (axis === 0) p.x += delta;
  else if (axis === 1) p.y += delta;
  else p.z += delta;
  const r = p.radius;
  const h = p.crouched ? 1.3 : p.height;
  for (const b of colliders) {
    const overlapX = p.x + r > b.minX && p.x - r < b.maxX;
    const overlapY = p.y < b.maxY && p.y + h > b.minY;
    const overlapZ = p.z + r > b.minZ && p.z - r < b.maxZ;
    if (overlapX && overlapY && overlapZ) {
      if (axis === 0) p.x = delta > 0 ? b.minX - r : b.maxX + r;
      else if (axis === 2) p.z = delta > 0 ? b.minZ - r : b.maxZ + r;
      else if (axis === 1) {
        if (delta < 0) { p.y = b.maxY; p.onGround = true; p.vy = 0; }
        else { p.y = b.minY - h; p.vy = 0; }
      }
    }
  }
}

export function updatePlayer(p, input, colliders, bounds, dt) {
  if (!p.alive) return;
  const m = input.consumeMouse();
  const sens = p.ads ? 0.0011 : 0.0022;
  p.yaw -= m.dx * sens;
  p.pitch = clamp(p.pitch - m.dy * sens, -1.5, 1.5);
  // Recoil recovery: pitch drifts back toward aim over ~0.25 s.
  p.recoilPitch = dampTo(p.recoilPitch, 0, 8, dt);
  p.recoilYaw = dampTo(p.recoilYaw, 0, 8, dt);
  p.spreadBloom = dampTo(p.spreadBloom, 0, 6, dt);

  const k = input.keys;
  p.crouched = !!k['ControlLeft'] || !!k['ControlRight'] || !!k['KeyC'];
  const wantX = (k['KeyD'] ? 1 : 0) - (k['KeyA'] ? 1 : 0);
  const wantZ = (k['KeyW'] ? 1 : 0) - (k['KeyS'] ? 1 : 0);
  const len = Math.hypot(wantX, wantZ) || 1;
  const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
  // Forward is -z rotated by yaw in three.js convention; yaw PI/2 faces +x.
  const fwdX = -sin, fwdZ = -cos;
  const rightX = cos, rightZ = -sin;
  const maxSpeed = p.crouched ? CROUCH_SPEED : WALK_SPEED;
  const tx = (fwdX * wantZ / len + rightX * wantX / len) * maxSpeed;
  const tz = (fwdZ * wantZ / len + rightZ * wantX / len) * maxSpeed;
  const accel = p.onGround ? ACCEL : ACCEL * 0.35;
  p.vx += clamp(tx - p.vx, -accel * dt, accel * dt);
  p.vz += clamp(tz - p.vz, -accel * dt, accel * dt);
  if (wantX === 0 && wantZ === 0 && p.onGround) {
    const f = Math.exp(-FRICTION * dt);
    p.vx *= f; p.vz *= f;
  }
  if (k['Space'] && p.onGround && !p.crouched) {
    p.vy = JUMP_VEL;
    p.onGround = false;
  }
  p.vy += GRAVITY * dt;
  if (p.vy < -22) p.vy = -22;

  collideAxis(p, colliders, 0, p.vx * dt);
  collideAxis(p, colliders, 2, p.vz * dt);
  p.onGround = false;
  collideAxis(p, colliders, 1, p.vy * dt);
  if (p.y < 0) { p.y = 0; p.vy = 0; p.onGround = true; }
  p.x = clamp(p.x, bounds.minX + 0.5, bounds.maxX - 0.5);
  p.z = clamp(p.z, bounds.minZ + 0.5, bounds.maxZ - 0.5);

  p.speed = Math.hypot(p.vx, p.vz);
  p.eyeHeight = p.crouched ? 1.15 : 1.62;
  p.stepT -= p.speed * dt;
  if (p.onGround && p.speed > 1.5 && p.stepT <= 0) {
    p.stepT = 2.2;
    p._stepped = true;
  } else {
    p._stepped = false;
  }
  if (p.flashT > 0) p.flashT -= dt;
}

function dampTo(v, target, lambda, dt) {
  return target + (v - target) * Math.exp(-lambda * dt);
}

export function eyePos(p, out) {
  out.x = p.x;
  out.y = p.y + p.eyeHeight;
  out.z = p.z;
  return out;
}

// Forward direction from yaw/pitch (with recoil applied).
export function aimDir(p, out) {
  const pitch = p.pitch + p.recoilPitch;
  const yaw = p.yaw + p.recoilYaw;
  out.x = -Math.sin(yaw) * Math.cos(pitch);
  out.y = Math.sin(pitch);
  out.z = -Math.cos(yaw) * Math.cos(pitch);
  return out;
}
