// RUSTLINE — boot and the one loop: a fixed 60 Hz simulation feeding a render
// at the display's rate. The sim (player, bots, combat, rounds) never allocates
// in hot loops and never reads the DOM; the HUD reads state once per frame.
// ?shot=cover|buy|play|plant with &seed=N stages a deterministic frame for a
// capture, renders it, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32, clamp } from './util.js';
import { createState, drainEvents, pushEvent } from './state.js';
import { createWorld } from './world.js';
import { createEffects } from './effects.js';
import { createBotMesh, createViewmodel, createBombMesh, animateBotMesh } from './models.js';
import { createInput } from './input.js';
import { createPlayer, updatePlayer, eyePos, aimDir } from './player.js';
import { tryFire, startReload, updateReload, switchWeapon } from './weapons.js';
import { WEAPONS, WEAPON_ORDER, ARMOR, GRENADES, ROUND } from './config.js';
import { firePellet } from './combat.js';
import { createBots, updateBots } from './bots.js';
import { startRound, updateRounds, handleRoundEvent } from './rounds.js';
import { updateGrenades, throwGrenade } from './grenades.js';
import { createHud } from './hud.js';
import { sfx, unlockAudio, setMuted } from './audio.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const autostart = params.get('autostart') === '1' || !!shot;
const rng = mulberry32(seed * 7919 + 13);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.skyTop);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 300);
camera.rotation.order = 'YXZ';
scene.add(camera);

const state = createState();
state.seed = seed;
state.shot = shot;
window.__rustlineState = state;
const world = createWorld(scene);
const effects = createEffects(scene);
const player = createPlayer(world.spawns.warden[0]);
player.team = 'warden';
state.player = player;
state.bots = createBots(world);
const input = createInput(renderer.domElement, () => {});

// Bot meshes.
for (const bot of state.bots) {
  const mesh = createBotMesh(bot.team);
  mesh.position.set(bot.x, 0, bot.z);
  scene.add(mesh);
  bot.mesh = mesh;
}
// Bomb mesh (hidden until dropped or planted).
const bombMesh = createBombMesh();
bombMesh.visible = false;
scene.add(bombMesh);
// Grenade meshes (one small sphere per live grenade, pooled).
const grenadeMeshes = [];
{
  const geo = new THREE.SphereGeometry(0.09, 10, 8);
  const mat = new THREE.MeshStandardMaterial({ color: 0x2a4a2a, roughness: 0.5, metalness: 0.4 });
  for (let i = 0; i < 8; i++) {
    const m = new THREE.Mesh(geo, mat);
    m.visible = false;
    scene.add(m);
    grenadeMeshes.push(m);
  }
}
// Viewmodel.
let viewmodel = createViewmodel('pistol');
camera.add(viewmodel);
let viewmodelKick = 0;

const hud = createHud({
  buyWeapon: (id) => {
    if (state.phase !== 'buy') return;
    const def = WEAPONS[id];
    if (player.money < def.price) return;
    player.money -= def.price;
    player._owned[id] = true;
    switchWeapon(player, id);
    viewmodel = swapViewmodel(id);
    sfx.buy();
  },
  buyArmor: (kind) => {
    if (state.phase !== 'buy') return;
    const a = ARMOR[kind];
    if (player.money < a.price || player.armorKind === kind) return;
    player.money -= a.price;
    player.armorKind = kind;
    player.helmet = !!a.helmet;
    player.armor = 100;
    sfx.buy();
  },
  buyGrenade: (kind) => {
    if (state.phase !== 'buy') return;
    const g = GRENADES[kind];
    if (player.money < g.price) return;
    player.money -= g.price;
    player.grenades[kind] = (player.grenades[kind] || 0) + 1;
    sfx.buy();
  },
});

function swapViewmodel(weaponId) {
  camera.remove(viewmodel);
  const kind = WEAPONS[weaponId].kind;
  const vm = createViewmodel(kind);
  camera.add(vm);
  return vm;
}

function startMatch() {
  state.score = { warden: 0, jackal: 0 };
  state.round = 1;
  state.matchWinner = null;
  state.killFeed.length = 0;
  state.stats = { shots: 0, hits: 0, kills: 0, deaths: 0, plants: 0, defuses: 0 };
  startRound(state, world);
  hud.hideOverlay();
  input.requestLock();
  unlockAudio();
  sfx.roundStart();
}

hud.onPlayClick(() => {
  unlockAudio();
  if (state.phase === 'menu' || state.phase === 'over') startMatch();
  else { hud.hideOverlay(); input.requestLock(); }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- Event handling: sim events -> sound, HUD, banners. ----
const tmpDir = { x: 0, y: 0, z: 0 };
const tmpEye = { x: 0, y: 0, z: 0 };

function handleEvents() {
  for (const ev of drainEvents(state)) {
    switch (ev.type) {
      case 'round-start':
        hud.showBanner('ROUND ' + ev.round, 'Wardens attack — plant the charge at A or B', 2400);
        sfx.roundStart();
        break;
      case 'phase':
        if (ev.phase === 'play') hud.showBanner('GO — ROUND LIVE', 'Buy phase over', 1600);
        break;
      case 'hit':
        if (ev.shooter === player) {
          hud.hitmarker(ev.part === 'head');
          if (ev.part === 'head') sfx.headshot(); else sfx.hit();
          state.stats.hits += 1;
        }
        if (ev.target === player) {
          const dx = ev.shooter.x - player.x, dz = ev.shooter.z - player.z;
          const worldAng = Math.atan2(-dx, -dz);
          player.lastDamageDir = worldAng - player.yaw;
          player.lastDamageT = state.time;
          sfx.hurt();
          if (ev.shooter.isBot) { ev.shooter.lastHurtBy = player; ev.shooter.lastHurtT = state.time; }
        }
        if (ev.target && ev.target.isBot) { ev.target.lastHurtBy = ev.shooter; ev.target.lastHurtT = state.time; }
        break;
      case 'kill':
        handleRoundEvent(state, world, ev);
        if (ev.shooter === player) sfx.kill();
        if (ev.target === player) {
          sfx.roundLose();
          hud.showBanner('YOU ARE DOWN', 'Spectating — your team fights on', 2200);
        }
        break;
      case 'round-end': {
        const won = ev.winner === 'warden';
        hud.showBanner(won ? 'ROUND WON' : 'ROUND LOST', ev.reason, 3000);
        if (won) sfx.roundWin(); else sfx.roundLose();
        break;
      }
      case 'match-end':
        hud.showOverlay(
          state.matchWinner === 'warden' ? 'WARDENS WIN THE MATCH' : state.matchWinner === 'jackal' ? 'JACKALS WIN THE MATCH' : 'MATCH DRAWN',
          'Final score — Wardens ' + state.score.warden + ' : ' + state.score.jackal + ' Jackals. Click to play again.',
          'Play again',
        );
        break;
      case 'plant':
        hud.showBanner('CHARGE PLANTED — SITE ' + ev.site, 'Hold the site until detonation', 3000);
        sfx.plantBeep();
        break;
      case 'plant-complete':
        handleRoundEvent(state, world, ev);
        break;
      case 'defuse-complete':
        handleRoundEvent(state, world, ev);
        break;
      case 'bomb-exploded':
        effects.explosion(world.sites[ev.site].x, 0.5, world.sites[ev.site].z);
        sfx.explosion();
        break;
      case 'explosion':
        sfx.explosion();
        break;
      case 'flash':
        if (ev.thrower !== player) sfx.flash();
        break;
      case 'bot-throw': {
        const from = ev.bot;
        const dx = ev.tx - from.x, dz = ev.tz - from.z;
        const d = Math.hypot(dx, dz) || 1;
        throwGrenade(state, world, from, ev.kind, { x: dx / d, y: 0.25, z: dz / d });
        break;
      }
      case 'grenade-thrown':
        break;
      default:
        break;
    }
  }
}

// ---- Player shooting (fixed step). ----
function playerShoot(dt) {
  if (!player.alive) return;
  if (input.keys['KeyR']) { if (startReload(player)) sfx.reload(); }
  const shotResult = tryFire(player, input, rng, dt);
  if (shotResult === 'dry') { sfx.dryFire(); return; }
  if (!shotResult) return;
  const def = shotResult.def;
  state.stats.shots += 1;
  player.lastShotT = state.time;
  eyePos(player, tmpEye);
  aimDir(player, tmpDir);
  // Muzzle flash at the viewmodel muzzle in world space.
  const muzzleWorld = new THREE.Vector3();
  viewmodel.userData.muzzle.getWorldPosition(muzzleWorld);
  effects.muzzle(muzzleWorld);
  sfx.shoot(player.weaponId);
  viewmodelKick = Math.min(0.12, viewmodelKick + def.kick * 0.05);
  for (let p = 0; p < shotResult.pellets; p++) {
    const sp = shotResult.spread * (p === 0 ? 1 : 2.4);
    const jx = (rng() - 0.5) * sp, jy = (rng() - 0.5) * sp, jz = (rng() - 0.5) * sp;
    let dx = tmpDir.x + jx, dy = tmpDir.y + jy, dz = tmpDir.z + jz;
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    firePellet(state, world, player, tmpEye, { x: dx, y: dy, z: dz }, def, effects);
  }
}

function playerKeys(dt) {
  const k = input.keys;
  // Weapon slots 1-5: switch only to weapons the player owns.
  for (let i = 0; i < WEAPON_ORDER.length; i++) {
    if (k['Digit' + (i + 1)]) {
      const id = WEAPON_ORDER[i];
      if (player.weaponId !== id && player._owned[id]) {
        switchWeapon(player, id);
        viewmodel = swapViewmodel(id);
      }
    }
  }
  if (k['KeyB'] && !player._bPressed && state.phase === 'buy') {
    player._bPressed = true;
    hud.setBuyOpen(!hud.buyOpen, player);
  }
  if (!k['KeyB']) player._bPressed = false;
  // Grenades: Q cycles, G throws the selected one.
  if (k['KeyQ'] && !player._qPressed) {
    player._qPressed = true;
    const order = ['frag', 'flash', 'smoke'];
    const i = order.indexOf(player.selectedGrenade);
    player.selectedGrenade = order[(i + 1) % order.length];
  }
  if (!k['KeyQ']) player._qPressed = false;
  if (k['KeyG'] && !player._gPressed) {
    player._gPressed = true;
    const kind = player.selectedGrenade;
    if ((player.grenades[kind] || 0) > 0 && player.alive) {
      player.grenades[kind] -= 1;
      aimDir(player, tmpDir);
      throwGrenade(state, world, player, kind, tmpDir);
    }
  }
  if (!k['KeyG']) player._gPressed = false;
  // Plant: hold E.
  player._plantKey = !!k['KeyE'];
  // ADS: right mouse.
  player.ads = !!input.mouse.rightDown && player.weaponId !== 'breacher';
  // Scoreboard.
  hud.setScoreboard(!!k['Tab']);
  // Mute.
  if (k['KeyM'] && !player._mPressed) { player._mPressed = true; setMuted(!player._muted); player._muted = !player._muted; }
  if (!k['KeyM']) player._mPressed = false;
  if (k['Escape'] && hud.buyOpen) hud.setBuyOpen(false, player);
}

// Owned weapons: the player keeps what they buy across the round.
player._owned = { p9: true };

// ---- Fixed-step simulation. ----
function simulate(dt) {
  state.time += dt;
  state.tick += 1;
  if (state.phase !== 'menu') {
    updateRounds(state, world, dt);
  }
  if (state.phase === 'buy' || state.phase === 'play' || state.phase === 'postplant' || state.phase === 'settle') {
    playerKeys(dt);
    updatePlayer(player, input, world.colliders, world.bounds, dt);
    if (player._stepped) sfx.step();
    updateReload(player, dt);
    playerShoot(dt);
    updateBots(state, world, effects, rng, dt);
    updateGrenades(state, world, effects, dt);
    // Bomb carrier death handled via kill events; dropped pickup in rounds.
    handleEvents();
  }
  effects.update(dt);
}

// ---- Render: camera, meshes, viewmodel. ----
function render() {
  // Camera follows the player, or a living teammate when spectating.
  let camX = player.x, camY = player.y + player.eyeHeight, camZ = player.z;
  let camYaw = player.yaw, camPitch = player.pitch + player.recoilPitch;
  if (!player.alive && (state.phase === 'play' || state.phase === 'postplant')) {
    const mate = state.bots.find((b) => b.alive && b.team === 'warden');
    if (mate) {
      camX = mate.x; camY = mate.y + 1.55; camZ = mate.z;
      camYaw = mate.yaw + Math.PI; camPitch = 0;
    }
  }
  camera.position.set(camX, camY, camZ);
  camera.rotation.y = camYaw;
  camera.rotation.x = clamp(camPitch, -1.5, 1.5);
  camera.rotation.z = player.recoilYaw * 0.5;
  const targetFov = player.ads ? 74 / WEAPONS[player.weaponId].zoom : 74;
  camera.fov += (targetFov - camera.fov) * 0.25;
  camera.updateProjectionMatrix();

  // Viewmodel sway + recoil.
  viewmodelKick *= 0.86;
  viewmodel.position.z = -0.55 + viewmodelKick;
  viewmodel.position.y = -0.26 + Math.sin(state.time * 1.4) * 0.003 * (player.speed > 0.5 ? 1 : 0);
  viewmodel.visible = player.alive;

  for (const bot of state.bots) {
    const m = bot.mesh;
    m.position.set(bot.x, bot.y, bot.z);
    m.rotation.y = bot.yaw;
    if (!bot.alive) {
      m.rotation.z = Math.PI / 2;
      m.position.y = 0.25;
    } else {
      m.rotation.z = 0;
      animateBotMesh(m, bot.speed, state.time);
    }
  }
  // Bomb mesh.
  if (state.bomb.state === 'dropped') {
    bombMesh.visible = true;
    bombMesh.position.set(state.bomb.x, 0, state.bomb.z);
  } else if (state.bomb.state === 'planted') {
    bombMesh.visible = true;
    const s = world.sites[state.bomb.site];
    bombMesh.position.set(s.x, 0, s.z);
    bombMesh.userData.light.material.color.setHex(Math.sin(state.time * 6) > 0 ? 0xffa020 : 0x882000);
  } else {
    bombMesh.visible = false;
  }
  // Grenade meshes.
  grenadeMeshes.forEach((m, i) => {
    const g = state.grenades[i];
    if (g) { m.visible = true; m.position.set(g.x, g.y, g.z); }
    else m.visible = false;
  });

  hud.update(state, world, FIXED_STEP);
  renderer.render(scene, camera);
}

// ---- Screenshot staging: deterministic frames, then freeze. ----
let shotFrames = 0;
function stageShot() {
  if (shot === 'cover') {
    // Start screen over the yard, camera at the spawn looking down mid lane.
    startMatch();
    state.frozen = true;
    hud.showOverlay('RUSTLINE', 'Depot Nine — five Wardens against five Jackals. Plant the breach charge at Site A or B, or eliminate the defence. Click to play.', 'Click to play');
    camera.position.set(player.x, 1.62, player.z);
    camera.rotation.y = player.yaw;
    camera.rotation.x = 0;
  } else if (shot === 'buy') {
    startMatch();
    state.phase = 'buy';
    state.phaseT = 11;
    hud.setBuyOpen(true, player);
    state.frozen = true;
  } else if (shot === 'play') {
    startMatch();
    // Fast-forward: skip buy, place bots mid-lane in a firefight.
    state.phase = 'play';
    state.phaseT = 88;
    const lanes = [[-2, -2], [6, -2], [14, 0], [0, 10], [20, -10]];
    state.bots.forEach((b, i) => {
      const [x, z] = lanes[i % lanes.length];
      b.x = x + 3; b.z = z + 2;
      b.path = []; b.pathIdx = 0;
    });
    player.x = -20; player.z = 4; player.yaw = -Math.PI / 2;
    player.armorKind = 'heavy'; player.helmet = true; player.armor = 100;
    switchWeapon(player, 'vk7');
    viewmodel = swapViewmodel('vk7');
    // One burst of fire for tracers: simulate a few steps live first.
    state.frozen = false;
  } else if (shot === 'plant') {
    startMatch();
    state.phase = 'play';
    state.phaseT = 64;
    const site = world.sites.A;
    player.x = site.x - 4.5; player.z = site.z;
    player.yaw = -Math.PI / 2;
    player.planting = 1.9;
    state.bomb.carrier = player;
    // A teammate covering, an enemy visible at the lane mouth.
    const mate = state.bots.find((b) => b.team === 'warden');
    if (mate) { mate.x = site.x - 3; mate.z = site.z - 3; }
    const foe = state.bots.find((b) => b.team === 'jackal');
    if (foe) { foe.x = site.x + 5; foe.z = site.z; foe.yaw = Math.atan2(player.x - foe.x, player.z - foe.z); }
    state.frozen = true;
  }
}

if (shot) stageShot();
else if (autostart) startMatch();

// ---- Main loop. ----
let last = performance.now();
let acc = 0;
let frozenFrames = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const frameDt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (state.frozen) {
    frozenFrames += 1;
    render();
    if (frozenFrames === 3) window.__shotReady = true;
    return;
  }
  acc += frameDt;
  let steps = 0;
  while (acc >= FIXED_STEP && steps < 5) {
    simulate(FIXED_STEP);
    acc -= FIXED_STEP;
    steps += 1;
  }
  if (steps === 5) acc = 0;
  if (shot === 'play') {
    // Fire a burst for the capture, then freeze on the firefight frame.
    input._setMouseDown(frozenFrames < 25);
    frozenFrames += 1;
    if (frozenFrames > 30) {
      state.frozen = true;
      window.__shotReady = true;
    }
  }
  render();
}
requestAnimationFrame(loop);
