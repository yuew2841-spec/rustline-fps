// Round state machine: buy -> play -> postplant -> settle, win conditions,
// economy payouts, bomb plant/defuse channels, carrier drop/pickup and match end.
// The player is a Warden; bots fill both teams.
import { ROUND, ECONOMY, WEAPONS } from './config.js';
import { pushEvent } from './state.js';
import { botBuy } from './bots.js';
import { dist2D } from './util.js';

export function startRound(state, world) {
  state.roundWinner = null;
  state.roundReason = '';
  state.bomb = {
    state: 'carried', x: 0, y: 0, z: 0, carrier: null, site: null,
    plantT: 0, plantBy: null, defuseT: 0, defuseBy: null, timer: 0,
  };
  state.grenades.length = 0;
  const p = state.player;
  const wSpawn = world.spawns.warden;
  const jSpawn = world.spawns.jackal;
  // Reset the player.
  p.x = wSpawn[0][0]; p.y = 0; p.z = wSpawn[0][1];
  p.yaw = -Math.PI / 2; p.pitch = 0;
  p.hp = 100; p.alive = true;
  p.armor = p.armorKind === 'none' ? 0 : 100;
  // Keep owned weapons and their ammo across rounds.
  const savedAmmo = p._ammo && p._ammo[p.weaponId];
  p.mag = savedAmmo ? savedAmmo.mag : WEAPONS[p.weaponId].mag;
  p.reserve = savedAmmo ? savedAmmo.reserve : WEAPONS[p.weaponId].reserve;
  p.planting = 0; p.defusing = 0; p.flashT = 0;
  p.isCarrier = true;
  p.vx = 0; p.vy = 0; p.vz = 0;
  // Reset bots.
  const wardens = state.bots.filter((b) => b.team === 'warden');
  const jackals = state.bots.filter((b) => b.team === 'jackal');
  wardens.forEach((b, i) => resetBot(b, wSpawn[i + 1] || wSpawn[0]));
  jackals.forEach((b, i) => resetBot(b, jSpawn[i] || jSpawn[0]));
  // Bots buy for the round.
  for (const b of state.bots) botBuy(b, state.round);
  // Carrier: the first warden bot is the carrier if the player is dead... no:
  // the player always carries at round start; bots carry only after a drop.
  state.bomb.carrier = p;
  state.phase = 'buy';
  state.phaseT = ROUND.buySeconds;
  pushEvent(state, 'round-start', { round: state.round });
}

function resetBot(b, spawn) {
  b.x = spawn[0]; b.y = 0; b.z = spawn[1];
  b.yaw = b.team === 'warden' ? Math.PI / 2 : -Math.PI / 2;
  b.hp = 100; b.alive = true;
  b.armor = b.armorKind === 'none' ? 0 : 100;
  b.path = []; b.pathIdx = 0;
  b.target = null;
  b.holdNode = -1; b.holdT = 0;
  b.plantT = 0; b.defuseT = 0;
  b.waitT = 0; b.flashT = 0;
  b.isCarrier = false;
  b.grenades = { frag: 0, flash: 0, smoke: 0 };
  b._usedSmoke = false;
  b.deaths = b.deaths; // keep career totals
}

function aliveCount(state, team) {
  let n = 0;
  if (team === 'warden' && state.player && state.player.alive) n += 1;
  for (const b of state.bots) if (b.team === team && b.alive) n += 1;
  return n;
}

function endRound(state, winner, reason) {
  if (state.phase === 'settle' || state.phase === 'over') return;
  state.roundWinner = winner;
  state.roundReason = reason;
  state.score[winner] += 1;
  // Economy: winners $1900, losers $1400 + $500 per loss in the streak.
  const loser = winner === 'warden' ? 'jackal' : 'warden';
  state.lossStreak[winner] = 0;
  state.lossStreak[loser] += 1;
  const lossPay = ECONOMY.lossBase + (state.lossStreak[loser] - 1) * ECONOMY.lossStreakBonus;
  const pay = (team) => (team === winner ? ECONOMY.win : lossPay);
  if (state.player) state.player.money = Math.min(ECONOMY.maxMoney, state.player.money + pay('warden'));
  for (const b of state.bots) b.money = Math.min(ECONOMY.maxMoney, b.money + pay(b.team));
  state.phase = 'settle';
  state.phaseT = ROUND.settleSeconds;
  pushEvent(state, 'round-end', { winner, reason, score: { ...state.score } });
  if (state.score[winner] >= ROUND.winRounds || state.round >= ROUND.maxRounds) {
    state.matchWinner = state.score.warden > state.score.jackal ? 'warden'
      : state.score.jackal > state.score.warden ? 'jackal' : 'draw';
    state.phase = 'over';
    state.phaseT = 8;
    pushEvent(state, 'match-end', { winner: state.matchWinner });
  }
}

export function updateRounds(state, world, dt) {
  const bomb = state.bomb;
  if (state.phase === 'menu' || state.phase === 'over') return;
  state.phaseT -= dt;

  // Player planting: hold E inside a site while carrying.
  const p = state.player;
  if (state.phase === 'play' && p && p.alive && bomb.state === 'carried' && bomb.carrier === p) {
    const site = inSite(state, world, p.x, p.z);
    if (site && p._plantKey) {
      p.planting += dt;
      if (p.planting >= ROUND.plantSeconds) {
        p.planting = 0;
        plantBomb(state, site, p);
      }
    } else {
      p.planting = 0;
    }
  } else if (p) {
    p.planting = 0;
  }

  // Dropped bomb pickup.
  if (bomb.state === 'dropped') {
    const pickers = [];
    if (p && p.alive) pickers.push(p);
    for (const b of state.bots) if (b.alive && b.team === 'warden') pickers.push(b);
    for (const f of pickers) {
      if (dist2D(f.x, f.z, bomb.x, bomb.z) < 1.4) {
        bomb.state = 'carried';
        bomb.carrier = f;
        f.isCarrier = true;
        pushEvent(state, 'bomb-pickup', { by: f });
        break;
      }
    }
  }

  // A defusing bot that dies abandons the defuse.
  if (bomb.defuseBy && !bomb.defuseBy.alive) {
    bomb.defuseBy = null;
    bomb.defuseT = 0;
  }

  // Bomb timer after planting.
  if (bomb.state === 'planted') {
    bomb.timer -= dt;
    if (bomb.timer <= 0) {
      bomb.state = 'exploded';
      pushEvent(state, 'bomb-exploded', { site: bomb.site });
      endRound(state, 'warden', 'The breach charge detonated at Site ' + bomb.site + '.');
      return;
    }
  }

  // Phase transitions.
  if (state.phase === 'buy' && state.phaseT <= 0) {
    state.phase = 'play';
    state.phaseT = ROUND.playSeconds;
    pushEvent(state, 'phase', { phase: 'play' });
  } else if (state.phase === 'play' && state.phaseT <= 0) {
    endRound(state, 'jackal', 'Time expired — the charge was never planted.');
    return;
  } else if (state.phase === 'postplant' && state.phaseT <= 0) {
    endRound(state, 'jackal', 'Time expired — the charge was never planted.');
    return;
  } else if (state.phase === 'settle' && state.phaseT <= 0) {
    if (state.matchWinner) { state.phase = 'over'; return; }
    state.round += 1;
    startRound(state, world);
    return;
  }

  // Elimination wins (not during buy, and not while a plant is live — the
  // plant itself decides once the timer runs).
  if (state.phase === 'play' || state.phase === 'postplant') {
    const w = aliveCount(state, 'warden');
    const j = aliveCount(state, 'jackal');
    if (bomb.state !== 'planted') {
      if (j === 0 && w > 0) { endRound(state, 'warden', 'Jackals eliminated.'); return; }
      if (w === 0 && j > 0) { endRound(state, 'jackal', 'Wardens eliminated.'); return; }
      if (w === 0 && j === 0) { endRound(state, 'jackal', 'Both teams down — defenders hold.'); return; }
    } else {
      if (w === 0) { endRound(state, 'jackal', 'All Wardens down before the blast.'); return; }
    }
  }
}

function inSite(state, world, x, z) {
  for (const id of ['A', 'B']) {
    const s = world.sites[id];
    if (dist2D(x, z, s.x, s.z) < s.r) return id;
  }
  return null;
}

export function plantBomb(state, site, by) {
  const bomb = state.bomb;
  bomb.state = 'planted';
  bomb.site = site;
  bomb.plantBy = by;
  bomb.timer = ROUND.postPlantSeconds;
  bomb.defuseT = 0;
  bomb.defuseBy = null;
  state.phase = 'postplant';
  state.phaseT = ROUND.postPlantSeconds;
  if (by === state.player) {
    state.player.money = Math.min(ECONOMY.maxMoney, state.player.money + ECONOMY.plant);
    state.stats.plants += 1;
  }
  pushEvent(state, 'plant', { site, by });
}

export function dropBomb(state, carrier) {
  const bomb = state.bomb;
  if (bomb.state !== 'carried' || bomb.carrier !== carrier) return;
  bomb.state = 'dropped';
  bomb.x = carrier.x;
  bomb.y = 0;
  bomb.z = carrier.z;
  bomb.carrier = null;
  carrier.isCarrier = false;
  pushEvent(state, 'bomb-dropped', { x: bomb.x, z: bomb.z });
}

// Called from the event drain when a bot finishes planting / defusing.
export function handleRoundEvent(state, world, ev) {
  if (ev.type === 'plant-complete') {
    plantBomb(state, ev.site, ev.bot);
  } else if (ev.type === 'defuse-complete') {
    state.bomb.state = 'defused';
    state.bomb.defuseBy = null;
    pushEvent(state, 'defused', { by: ev.bot });
    endRound(state, 'jackal', 'The charge was defused at Site ' + state.bomb.site + '.');
  } else if (ev.type === 'kill') {
    // Carrier death drops the charge.
    if (ev.target && ev.target.isCarrier) dropBomb(state, ev.target);
    if (ev.target === state.player) {
      state.player.deaths += 1;
    }
    if (ev.shooter === state.player) {
      state.player.money = Math.min(ECONOMY.maxMoney, state.player.money + ECONOMY.kill);
      state.stats.kills += 1;
    }
    if (ev.shooter && ev.shooter.isBot) ev.shooter.kills += 1;
    if (ev.target && ev.target.isBot) ev.target.deaths += 1;
    state.killFeed.unshift({
      shooter: ev.shooter ? (ev.shooter.name || 'You') : '?',
      target: ev.target ? (ev.target.name || 'You') : '?',
      headshot: ev.part === 'head',
      t: state.time,
    });
    if (state.killFeed.length > 5) state.killFeed.length = 5;
  }
}
