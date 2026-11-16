// Static game data: weapons, grenades, economy, round timings. Pure data + tiny
// helpers; nothing here touches the renderer, so the sim can be reasoned about alone.
export const ROUND = {
  buySeconds: 12,
  playSeconds: 100,
  postPlantSeconds: 45,
  settleSeconds: 5,
  maxRounds: 15,
  winRounds: 8,
  plantSeconds: 3.2,
  defuseSeconds: 10,
};

export const ECONOMY = {
  startMoney: 800,
  kill: 300,
  plant: 300,
  win: 1900,
  lossBase: 1400,
  lossStreakBonus: 500,
  maxMoney: 16000,
};

export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9', kind: 'pistol', price: 0,
    damage: 34, headMult: 4, range: 42, falloff: 0.45,
    fireRate: 0.16, auto: false, mag: 12, reserve: 36, reload: 1.1,
    spread: 0.011, moveSpread: 0.02, recoil: 0.011, kick: 0.5,
    pellets: 1, zoom: 1, adsSpread: 0.006, tracer: '#ffd27a',
  },
  breacher: {
    id: 'breacher', name: 'Breacher 12', kind: 'shotgun', price: 1050,
    damage: 13, headMult: 3, range: 20, falloff: 0.3,
    fireRate: 0.85, auto: false, mag: 5, reserve: 20, reload: 2.4,
    spread: 0.05, moveSpread: 0.05, recoil: 0.05, kick: 1.6,
    pellets: 8, zoom: 1, adsSpread: 0.035, tracer: '#ffb060',
  },
  ripper: {
    id: 'ripper', name: 'Ripper SMG', kind: 'smg', price: 1500,
    damage: 26, headMult: 4, range: 34, falloff: 0.5,
    fireRate: 0.075, auto: true, mag: 32, reserve: 96, reload: 1.9,
    spread: 0.016, moveSpread: 0.03, recoil: 0.013, kick: 0.7,
    pellets: 1, zoom: 1, adsSpread: 0.009, tracer: '#ffe08a',
  },
  vk7: {
    id: 'vk7', name: 'VK-7', kind: 'rifle', price: 2700,
    damage: 33, headMult: 4, range: 70, falloff: 0.6,
    fireRate: 0.1, auto: true, mag: 30, reserve: 90, reload: 2.2,
    spread: 0.012, moveSpread: 0.028, recoil: 0.02, kick: 0.9,
    pellets: 1, zoom: 1.25, adsSpread: 0.005, tracer: '#fff0a0',
  },
  longshot: {
    id: 'longshot', name: 'Longshot DMR', kind: 'dmr', price: 3300,
    damage: 88, headMult: 4, range: 120, falloff: 0.85,
    fireRate: 0.9, auto: false, mag: 10, reserve: 30, reload: 2.8,
    spread: 0.004, moveSpread: 0.04, recoil: 0.045, kick: 1.4,
    pellets: 1, zoom: 2.6, adsSpread: 0.0012, tracer: '#cfe8ff',
  },
};
export const WEAPON_ORDER = ['p9', 'breacher', 'ripper', 'vk7', 'longshot'];

export const ARMOR = {
  none: { id: 'none', name: 'No armor', price: 0, absorb: 0 },
  light: { id: 'light', name: 'Kevlar Vest', price: 650, absorb: 0.4 },
  heavy: { id: 'heavy', name: 'Kevlar + Helm', price: 1000, absorb: 0.55, helmet: true },
};

export const GRENADES = {
  frag: { id: 'frag', name: 'Frag Grenade', price: 300, radius: 7, damage: 110 },
  flash: { id: 'flash', name: 'Flashbang', price: 200, radius: 16, duration: 2.2 },
  smoke: { id: 'smoke', name: 'Smoke Grenade', price: 300, radius: 5, duration: 14 },
};

// Bot buy logic: what a bot buys given round number and money, mirroring the
// pistol-round habit of bringing utility for the push.
export function botBuyPlan(roundNumber, money) {
  const plan = { weapon: 'p9', armor: 'none', grenades: [] };
  if (roundNumber === 1) {
    if (money >= 300) plan.grenades.push('smoke');
    if (money >= 500) plan.grenades.push('flash');
    return plan;
  }
  if (money >= 2700 + 650) { plan.weapon = 'vk7'; plan.armor = 'light'; }
  else if (money >= 1500 + 650) { plan.weapon = 'ripper'; plan.armor = 'light'; }
  else if (money >= 1050) { plan.weapon = 'breacher'; }
  if (money >= 3300 && roundNumber >= 4 && money - 3300 >= 650) {
    plan.weapon = 'longshot'; plan.armor = 'light';
  }
  if (money >= 300 && plan.weapon !== 'p9') plan.grenades.push('frag');
  return plan;
}

export function weaponCost(id) { return WEAPONS[id].price; }
