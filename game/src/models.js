// Character and weapon meshes, built from primitives with team colours.
// Bots are simple articulated figures: torso, head with visor, legs, arms, gun.
// The first-person viewmodel is a separate low-poly gun attached to the camera.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

function limbMat(color) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
}

export function createBotMesh(team) {
  const group = new THREE.Group();
  const main = team === 'warden' ? 0x3f7a4a : 0x8a3a28;
  const dark = team === 'warden' ? 0x2a5232 : 0x5c2418;
  const vest = 0x2e2a24;
  const mats = { main: limbMat(main), dark: limbMat(dark), vest: limbMat(vest) };

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), mats.vest);
  torso.position.y = 1.18;
  torso.castShadow = true;
  group.add(torso);
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.2, 0.34), mats.main);
  chest.position.y = 1.38;
  group.add(chest);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), mats.dark);
  head.position.y = 1.68;
  head.castShadow = true;
  group.add(head);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.07, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.2, metalness: 0.6 }));
  visor.position.set(0, 1.68, 0.14);
  group.add(visor);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    limbMat(team === 'warden' ? 0x35482e : 0x4a2e24));
  helmet.position.y = 1.7;
  group.add(helmet);

  const legGeo = new THREE.BoxGeometry(0.2, 0.85, 0.22);
  const legL = new THREE.Mesh(legGeo, mats.dark);
  legL.position.set(-0.14, 0.43, 0);
  const legR = new THREE.Mesh(legGeo, mats.dark);
  legR.position.set(0.14, 0.43, 0);
  group.add(legL, legR);

  const armGeo = new THREE.BoxGeometry(0.15, 0.55, 0.15);
  const armL = new THREE.Mesh(armGeo, mats.main);
  armL.position.set(-0.33, 1.25, 0.12);
  armL.rotation.x = -0.9;
  const armR = new THREE.Mesh(armGeo, mats.main);
  armR.position.set(0.33, 1.25, 0.12);
  armR.rotation.x = -0.9;
  group.add(armL, armR);

  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.72),
    new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.4, metalness: 0.7 }));
  gun.position.set(0.08, 1.28, 0.42);
  group.add(gun);

  group.userData = { legL, legR, armL, armR, torso, head, height: 1.84 };
  return group;
}

// Walk-cycle swing, called from the render step only (visual, not sim).
export function animateBotMesh(mesh, speed, time) {
  const u = mesh.userData;
  const swing = Math.min(1, speed / 4) * 0.55 * Math.sin(time * 9);
  u.legL.rotation.x = swing;
  u.legR.rotation.x = -swing;
  u.armL.rotation.x = -0.9 + swing * 0.4;
  u.armR.rotation.x = -0.9 - swing * 0.4;
}

// First-person viewmodel: one low-poly gun per weapon kind, rebuilt on swap.
const VIEWMODELS = {
  pistol: { barrel: [0.05, 0.05, 0.34], body: [0.09, 0.12, 0.3], grip: [0.07, 0.16, 0.08], color: 0x2a2a2c },
  shotgun: { barrel: [0.07, 0.07, 0.62], body: [0.1, 0.14, 0.5], grip: [0.08, 0.18, 0.09], color: 0x3a2a20 },
  smg: { barrel: [0.05, 0.05, 0.4], body: [0.1, 0.13, 0.36], grip: [0.07, 0.16, 0.08], color: 0x24262a },
  rifle: { barrel: [0.05, 0.05, 0.55], body: [0.1, 0.14, 0.44], grip: [0.08, 0.17, 0.09], color: 0x2e2e30 },
  dmr: { barrel: [0.045, 0.045, 0.72], body: [0.1, 0.13, 0.5], grip: [0.08, 0.17, 0.09], color: 0x1e2a24 },
};

export function createViewmodel(kind) {
  const spec = VIEWMODELS[kind] || VIEWMODELS.rifle;
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.45, metalness: 0.65 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(...spec.body), mat);
  body.position.set(0, 0, 0);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(...spec.barrel), mat);
  barrel.position.set(0, 0.02, -0.32);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(...spec.grip), mat);
  grip.position.set(0, -0.13, 0.1);
  grip.rotation.x = 0.35;
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3, metalness: 0.8 }));
  sight.position.set(0, 0.09, -0.05);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.1), mat);
  mag.position.set(0, -0.12, -0.02);
  group.add(body, barrel, grip, sight, mag);
  group.position.set(0.28, -0.26, -0.55);
  group.userData.muzzle = new THREE.Object3D();
  group.userData.muzzle.position.set(0, 0.02, -0.62);
  group.add(group.userData.muzzle);
  return group;
}

// The breach charge: a small dark case with a blinking amber light.
export function createBombMesh() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.24, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x1e1e20, roughness: 0.5, metalness: 0.5 }));
  body.position.y = 0.12;
  body.castShadow = true;
  group.add(body);
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xffa020 }));
  light.position.set(0.12, 0.26, 0);
  group.add(light);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.05, 0.32),
    new THREE.MeshStandardMaterial({ color: 0xe0a030, roughness: 0.6 }));
  stripe.position.y = 0.2;
  group.add(stripe);
  group.userData.light = light;
  return group;
}

export function createSiteMarker(color) {
  const geo = new THREE.RingGeometry(1.4, 1.6, 32);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(geo, mat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  return ring;
}
