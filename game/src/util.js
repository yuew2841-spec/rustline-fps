// Small shared helpers: deterministic RNG, clamping, angles, segment-vs-AABB tests.
// No allocations in the hot paths: callers reuse the scratch objects exported here.
export function mulberry32(initial) {
  let a = initial | 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function damp(current, target, lambda, dt) {
  return lerp(target, current, Math.exp(-lambda * dt));
}
export function angleDiff(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
export function dist2D(ax, az, bx, bz) {
  const dx = ax - bx, dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

// Ray (origin + t*dir) against an AABB {minX,minY,minZ,maxX,maxY,maxZ}.
// Returns the smallest non-negative t, or -1. Pure math, no allocation.
export function rayAABB(ox, oy, oz, dx, dy, dz, box, maxT) {
  let tmin = 0, tmax = maxT;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  const mn = [box.minX, box.minY, box.minZ], mx = [box.maxX, box.maxY, box.maxZ];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < mn[i] || o[i] > mx[i]) return -1;
    } else {
      let t1 = (mn[i] - o[i]) / d[i];
      let t2 = (mx[i] - o[i]) / d[i];
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}

// Segment from (ax,ay,az) to (bx,by,bz) blocked by any box in list? Returns true/false.
export function segmentBlocked(ax, ay, az, bx, by, bz, boxes) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-6) return false;
  const inv = 1 / len;
  for (let i = 0; i < boxes.length; i++) {
    const t = rayAABB(ax, ay, az, dx * inv, dy * inv, dz * inv, boxes[i], len);
    if (t >= 0 && t < len) return true;
  }
  return false;
}

// Ray against a vertical capsule approximated as a sphere (head) + AABB (body).
// bot: {x, z, y(feet), height, radius}. Returns {t, part} or null.
export function rayBot(ox, oy, oz, dx, dy, dz, bot, maxT) {
  const cx = bot.x, cz = bot.z;
  // Head sphere: centre at feet + height - 0.18, radius 0.16.
  const hx = cx, hy = bot.y + bot.height - 0.16, hz = cz;
  const lx = ox - hx, ly = oy - hy, lz = oz - hz;
  const b = lx * dx + ly * dy + lz * dz;
  const c = lx * lx + ly * ly + lz * lz - 0.16 * 0.16;
  const disc = b * b - c;
  if (disc >= 0) {
    const t = -b - Math.sqrt(disc);
    if (t >= 0 && t <= maxT) return { t, part: 'head' };
  }
  // Body AABB.
  const r = bot.radius;
  const box = {
    minX: cx - r, maxX: cx + r,
    minY: bot.y, maxY: bot.y + bot.height - 0.3,
    minZ: cz - r, maxZ: cz + r,
  };
  const t = rayAABB(ox, oy, oz, dx, dy, dz, box, maxT);
  if (t >= 0) return { t, part: 'body' };
  return null;
}
