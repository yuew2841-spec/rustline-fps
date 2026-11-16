// Pooled visual effects: tracers, muzzle flashes, impact sparks, blood puffs,
// explosion rings and smoke billboards. Pools are preallocated; the hot loop
// never allocates. Effects are visual only — damage is computed in combat.js.
import * as THREE from 'three';

const TRACER_POOL = 24;
const PARTICLE_POOL = 240;
const SMOKE_POOL = 12;

export function createEffects(scene) {
  // Tracers: thin stretched boxes, one reusable geometry/material each.
  const tracers = [];
  const tracerGeo = new THREE.BoxGeometry(0.02, 0.02, 1);
  for (let i = 0; i < TRACER_POOL; i++) {
    const m = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({
      color: 0xffe08a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    m.visible = false;
    scene.add(m);
    tracers.push({ mesh: m, life: 0, maxLife: 0.08 });
  }
  let tracerCursor = 0;

  // Particles: one InstancedMesh? Simpler and cheaper here: a pool of small
  // sprites sharing one material, toggled by visibility.
  const particles = [];
  const partGeo = new THREE.BoxGeometry(0.09, 0.09, 0.09);
  const partMats = {
    spark: new THREE.MeshBasicMaterial({ color: 0xffc860 }),
    blood: new THREE.MeshBasicMaterial({ color: 0x8a1a12 }),
    smoke: new THREE.MeshBasicMaterial({ color: 0x9a938a, transparent: true, opacity: 0.5 }),
    dust: new THREE.MeshBasicMaterial({ color: 0x8a7a62, transparent: true, opacity: 0.6 }),
  };
  for (let i = 0; i < PARTICLE_POOL; i++) {
    const m = new THREE.Mesh(partGeo, partMats.spark);
    m.visible = false;
    scene.add(m);
    particles.push({ mesh: m, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 0.4, gravity: 0, kind: 'spark' });
  }
  let particleCursor = 0;

  // Smoke clouds: big soft spheres that grow and fade.
  const smokes = [];
  const smokeGeo = new THREE.SphereGeometry(1, 12, 10);
  for (let i = 0; i < SMOKE_POOL; i++) {
    const m = new THREE.Mesh(smokeGeo, new THREE.MeshBasicMaterial({
      color: 0xb8b0a4, transparent: true, opacity: 0, depthWrite: false,
    }));
    m.visible = false;
    scene.add(m);
    smokes.push({ mesh: m, life: 0, maxLife: 14, radius: 5 });
  }

  // Muzzle flash: a single additive plane at the viewmodel muzzle.
  const flashMat = new THREE.MeshBasicMaterial({
    color: 0xffd27a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), flashMat);
  flash.visible = false;
  scene.add(flash);
  let flashLife = 0;

  function spawnParticle(kind, x, y, z, vx, vy, vz, life, gravity) {
    const p = particles[particleCursor];
    particleCursor = (particleCursor + 1) % PARTICLE_POOL;
    p.mesh.material = partMats[kind] || partMats.spark;
    p.mesh.position.set(x, y, z);
    p.mesh.visible = true;
    p.mesh.scale.setScalar(kind === 'smoke' ? 2.5 : 1);
    p.vx = vx; p.vy = vy; p.vz = vz;
    p.life = life; p.maxLife = life; p.gravity = gravity; p.kind = kind;
  }

  return {
    tracer(from, to, color = 0xffe08a) {
      const t = tracers[tracerCursor];
      tracerCursor = (tracerCursor + 1) % TRACER_POOL;
      const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      t.mesh.position.set((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
      t.mesh.scale.set(1, 1, Math.max(0.1, len));
      t.mesh.lookAt(to.x, to.y, to.z);
      t.mesh.material.color.setHex(color);
      t.mesh.material.opacity = 0.9;
      t.mesh.visible = true;
      t.life = t.maxLife;
    },
    muzzle(worldPos) {
      flash.position.copy(worldPos);
      flash.material.opacity = 0.95;
      flash.visible = true;
      flashLife = 0.05;
    },
    impact(x, y, z) {
      for (let i = 0; i < 6; i++) {
        spawnParticle('spark', x, y, z,
          (Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4,
          0.25 + Math.random() * 0.2, -9);
      }
      spawnParticle('dust', x, y + 0.05, z, 0, 0.4, 0, 0.5, 0);
    },
    blood(x, y, z) {
      for (let i = 0; i < 8; i++) {
        spawnParticle('blood', x, y, z,
          (Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3,
          0.3 + Math.random() * 0.25, -7);
      }
    },
    explosion(x, y, z) {
      for (let i = 0; i < 26; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 3 + Math.random() * 8;
        spawnParticle('spark', x, y + 0.3, z,
          Math.cos(a) * sp, 2 + Math.random() * 6, Math.sin(a) * sp,
          0.5 + Math.random() * 0.5, -9);
      }
      for (let i = 0; i < 10; i++) {
        spawnParticle('smoke', x + (Math.random() - 0.5) * 2, y + Math.random() * 2, z + (Math.random() - 0.5) * 2,
          (Math.random() - 0.5) * 1.5, 0.8 + Math.random(), (Math.random() - 0.5) * 1.5,
          1.2 + Math.random(), 0.5);
      }
    },
    smokeCloud(x, y, z, duration = 14) {
      const s = smokes.find((s2) => !s2.mesh.visible) || smokes[0];
      s.mesh.position.set(x, y + 1, z);
      s.mesh.visible = true;
      s.life = duration;
      s.maxLife = duration;
      s.radius = 5;
    },
    update(dt) {
      for (const t of tracers) {
        if (!t.mesh.visible) continue;
        t.life -= dt;
        if (t.life <= 0) { t.mesh.visible = false; t.mesh.material.opacity = 0; }
        else t.mesh.material.opacity = 0.9 * (t.life / t.maxLife);
      }
      for (const p of particles) {
        if (!p.mesh.visible) continue;
        p.life -= dt;
        if (p.life <= 0) { p.mesh.visible = false; continue; }
        p.vy += p.gravity * dt;
        p.mesh.position.x += p.vx * dt;
        p.mesh.position.y += p.vy * dt;
        p.mesh.position.z += p.vz * dt;
        const s = p.kind === 'smoke' ? 2.5 + (1 - p.life / p.maxLife) * 2 : 1;
        p.mesh.scale.setScalar(s);
      }
      for (const s of smokes) {
        if (!s.mesh.visible) continue;
        s.life -= dt;
        if (s.life <= 0) { s.mesh.visible = false; s.mesh.material.opacity = 0; continue; }
        const grow = 1 - s.life / s.maxLife;
        s.mesh.scale.setScalar(s.radius * (0.6 + grow * 0.7));
        s.mesh.material.opacity = 0.55 * Math.min(1, s.life / 2) * (0.5 + grow * 0.5);
      }
      if (flash.visible) {
        flashLife -= dt;
        flash.material.opacity = Math.max(0, flashLife / 0.05) * 0.95;
        if (flashLife <= 0) flash.visible = false;
        else flash.rotation.z += dt * 20;
      }
    },
    // Smoke blocks sight: true when the segment crosses an active cloud.
    smokeBlocks(ax, ay, az, bx, by, bz) {
      for (const s of smokes) {
        if (!s.mesh.visible) continue;
        const p = s.mesh.position;
        const r = s.radius * 0.8;
        // Distance from segment midpoint sample points to cloud centre.
        for (let k = 0; k <= 4; k++) {
          const t = k / 4;
          const x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
          const d2 = (x - p.x) ** 2 + (y - p.y) ** 2 + (z - p.z) ** 2;
          if (d2 < r * r) return true;
        }
      }
      return false;
    },
  };
}
