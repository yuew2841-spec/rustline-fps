// HUD: DOM overlay for health, armor, ammo, money, timer, score, kill feed,
// hit direction, plant/defuse progress, buy menu, scoreboard, radar minimap,
// round banners and the start screen. All updates are plain DOM writes from
// the sim state; the radar is a small 2D canvas drawn once per frame.
import { WEAPONS, WEAPON_ORDER, ARMOR, GRENADES } from './config.js';
import { ROUND } from './config.js';

export function createHud(callbacks) {
  const $ = (id) => document.getElementById(id);
  const el = {
    hp: $('hp'), hpBar: $('hp-bar'), armor: $('armor'), ammoMag: $('ammo-mag'),
    ammoRes: $('ammo-res'), money: $('money'), timer: $('timer'), score: $('score'),
    round: $('round-label'), crosshair: $('crosshair'), hitmarker: $('hitmarker'),
    killfeed: $('killfeed'), banner: $('banner'), bannerTitle: $('banner-title'),
    bannerSub: $('banner-sub'), progress: $('progress'), progressBar: $('progress-bar'),
    progressLabel: $('progress-label'), radar: $('radar'), buyMenu: $('buy-menu'),
    buyItems: $('buy-items'), scoreboard: $('scoreboard'), scoreRows: $('score-rows'),
    overlay: $('overlay'), playBtn: $('play'), overlayTitle: $('overlay-title'),
    overlayCopy: $('overlay-copy'), hitDir: $('hitdir'), flash: $('flash'),
    weaponName: $('weapon-name'), grenades: $('grenades'), spectate: $('spectate'),
    siteHint: $('site-hint'),
  };
  const radarCtx = el.radar.getContext('2d');

  let buyOpen = false;
  let lastHitT = 0;

  function fmtMoney(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function fmtTime(s) {
    const t = Math.max(0, Math.ceil(s));
    return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
  }

  function showBanner(title, sub, ms = 2600) {
    el.bannerTitle.textContent = title;
    el.bannerSub.textContent = sub || '';
    el.banner.classList.remove('hidden');
    clearTimeout(showBanner._t);
    showBanner._t = setTimeout(() => el.banner.classList.add('hidden'), ms);
  }

  function buildBuyMenu(player) {
    const items = [];
    for (const id of WEAPON_ORDER) {
      const w = WEAPONS[id];
      items.push({ key: String(WEAPON_ORDER.indexOf(id) + 1), label: w.name + ' — ' + w.kind, price: w.price, buy: () => callbacks.buyWeapon(id) });
    }
    items.push({ key: '6', label: ARMOR.light.name, price: ARMOR.light.price, buy: () => callbacks.buyArmor('light') });
    items.push({ key: '7', label: ARMOR.heavy.name, price: ARMOR.heavy.price, buy: () => callbacks.buyArmor('heavy') });
    for (const g of ['frag', 'flash', 'smoke']) {
      const d = GRENADES[g];
      items.push({ key: g === 'frag' ? '8' : g === 'flash' ? '9' : '0', label: d.name, price: d.price, buy: () => callbacks.buyGrenade(g) });
    }
    el.buyItems.innerHTML = '';
    for (const it of items) {
      const row = document.createElement('div');
      row.className = 'buy-row';
      row.innerHTML = '<span class="buy-key">' + it.key + '</span><span class="buy-label">' + it.label + '</span><span class="buy-price">' + fmtMoney(it.price) + '</span>';
      row.addEventListener('click', () => { it.buy(); });
      el.buyItems.appendChild(row);
    }
  }

  function setBuyOpen(open, player) {
    buyOpen = open;
    if (open) {
      buildBuyMenu(player);
      el.buyMenu.classList.remove('hidden');
    } else {
      el.buyMenu.classList.add('hidden');
    }
  }

  function drawRadar(state, world) {
    const c = radarCtx;
    const S = 150;
    c.clearRect(0, 0, S, S);
    c.fillStyle = 'rgba(12,12,10,0.72)';
    c.fillRect(0, 0, S, S);
    const sx = (x) => (x + 32) / 64 * S;
    const sz = (z) => (z + 22) / 44 * S;
    // Sites.
    c.fillStyle = '#e0a030';
    for (const id of ['A', 'B']) {
      const s = world.sites[id];
      c.beginPath();
      c.arc(sx(s.x), sz(s.z), 7, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#111';
      c.font = 'bold 9px sans-serif';
      c.textAlign = 'center';
      c.fillText(id, sx(s.x), sz(s.z) + 3);
      c.fillStyle = '#e0a030';
    }
    // Bomb.
    if (state.bomb.state === 'dropped') {
      c.fillStyle = '#ff5040';
      c.beginPath();
      c.arc(sx(state.bomb.x), sz(state.bomb.z), 4, 0, Math.PI * 2);
      c.fill();
    }
    if (state.bomb.state === 'planted') {
      c.fillStyle = '#ff3020';
      c.beginPath();
      c.arc(sx(world.sites[state.bomb.site].x), sz(world.sites[state.bomb.site].z), 9, 0, Math.PI * 2);
      c.fill();
    }
    const dot = (x, z, color, r = 3) => {
      c.fillStyle = color;
      c.beginPath();
      c.arc(sx(x), sz(z), r, 0, Math.PI * 2);
      c.fill();
    };
    for (const b of state.bots) {
      if (!b.alive) continue;
      dot(b.x, b.z, b.team === 'warden' ? '#7ac74f' : '#e05a40', b.team === 'warden' ? 3 : 3);
    }
    const p = state.player;
    if (p && p.alive) {
      // Player arrow with facing.
      c.save();
      c.translate(sx(p.x), sz(p.z));
      c.rotate(Math.atan2(Math.sin(p.yaw), Math.cos(p.yaw)) + Math.PI);
      c.fillStyle = '#ffffff';
      c.beginPath();
      c.moveTo(0, -6); c.lineTo(4, 5); c.lineTo(-4, 5); c.closePath();
      c.fill();
      c.restore();
    }
  }

  function renderScoreboard(state) {
    const rows = [];
    const p = state.player;
    const all = [p, ...state.bots].filter(Boolean);
    all.sort((a, b) => (b.kills || 0) - (a.kills || 0));
    for (const f of all) {
      rows.push('<tr><td>' + (f === p ? 'You' : f.name) + '</td><td>' +
        (f.team === 'warden' ? 'Wardens' : 'Jackals') + '</td><td>' + (f.kills || 0) +
        '</td><td>' + (f.deaths || 0) + '</td><td>' + fmtMoney(f.money || 0) + '</td></tr>');
    }
    el.scoreRows.innerHTML = rows.join('');
  }

  return {
    el,
    get buyOpen() { return buyOpen; },
    setBuyOpen,
    showBanner,
    showOverlay(title, copy, btn) {
      el.overlayTitle.textContent = title;
      el.overlayCopy.textContent = copy;
      el.playBtn.textContent = btn;
      el.overlay.classList.remove('hidden');
    },
    hideOverlay() { el.overlay.classList.add('hidden'); },
    onPlayClick(fn) { el.playBtn.addEventListener('click', fn); },

    update(state, world, dt) {
      const p = state.player;
      if (!p) return;
      el.hp.textContent = Math.ceil(p.hp);
      el.hpBar.style.width = Math.max(0, p.hp) + '%';
      el.hpBar.style.background = p.hp > 50 ? '#7ac74f' : p.hp > 25 ? '#e0a030' : '#d8402a';
      el.armor.textContent = p.armorKind === 'none' ? '—' : Math.ceil(p.armor) + '';
      const def = WEAPONS[p.weaponId];
      el.ammoMag.textContent = p.mag;
      el.ammoRes.textContent = '/ ' + p.reserve;
      el.ammoMag.parentElement.classList.toggle('empty', p.mag === 0);
      el.weaponName.textContent = def.name;
      el.money.textContent = fmtMoney(p.money);
      el.timer.textContent = fmtTime(state.phaseT);
      el.timer.classList.toggle('urgent', state.phaseT <= 10 && (state.phase === 'play' || state.phase === 'postplant'));
      el.score.textContent = 'Wardens ' + state.score.warden + ' — ' + state.score.jackal + ' Jackals';
      el.round.textContent = 'ROUND ' + state.round + ' / ' + ROUND.maxRounds +
        (state.phase === 'buy' ? ' · BUY' : state.phase === 'play' ? ' · LIVE'
          : state.phase === 'postplant' ? ' · CHARGE LIVE' : state.phase === 'settle' ? ' · ROUND OVER' : '');
      // Crosshair spread grows with bloom + movement.
      const spread = 4 + p.spreadBloom * 260 + (p.speed > 1 ? 4 : 0);
      el.crosshair.style.setProperty('--gap', spread + 'px');
      el.crosshair.classList.toggle('ads', p.ads);
      // Kill feed.
      el.killfeed.innerHTML = state.killFeed.map((k) =>
        '<div>' + k.shooter + (k.headshot ? ' ⌖ ' : ' → ') + k.target + '</div>').join('');
      // Hit direction indicator.
      if (p.lastDamageDir !== null && state.time - (p.lastDamageT || 0) < 0.8) {
        el.hitDir.style.opacity = '1';
        el.hitDir.style.transform = 'translate(-50%,-50%) rotate(' + p.lastDamageDir + 'rad)';
      } else {
        el.hitDir.style.opacity = '0';
      }
      // Flash overlay.
      el.flash.style.opacity = p.flashT > 0 ? Math.min(1, p.flashT) : 0;
      // Plant / defuse progress.
      const planting = p.planting > 0;
      const defusing = state.bomb.defuseBy && state.bomb.defuseBy !== p;
      if (planting) {
        el.progress.classList.remove('hidden');
        el.progressLabel.textContent = 'PLANTING CHARGE…';
        el.progressBar.style.width = (p.planting / ROUND.plantSeconds * 100) + '%';
      } else if (state.bomb.state === 'planted') {
        el.progress.classList.remove('hidden');
        el.progressLabel.textContent = 'CHARGE LIVE — ' + Math.ceil(state.bomb.timer) + 's';
        el.progressBar.style.width = (state.bomb.timer / ROUND.postPlantSeconds * 100) + '%';
      } else {
        el.progress.classList.add('hidden');
      }
      // Grenade counts.
      el.grenades.textContent = 'Frag ' + (p.grenades.frag || 0) + ' · Flash ' + (p.grenades.flash || 0) + ' · Smoke ' + (p.grenades.smoke || 0) + '  [G throw · Q cycle]';
      // Spectate when dead.
      if (!p.alive && (state.phase === 'play' || state.phase === 'postplant')) {
        el.spectate.classList.remove('hidden');
      } else {
        el.spectate.classList.add('hidden');
      }
      // Site hint.
      const inA = world && state.phase === 'play';
      el.siteHint.textContent = state.bomb.state === 'carried' && state.bomb.carrier === p
        ? 'You carry the charge — hold E inside Site A or B to plant'
        : state.bomb.state === 'dropped' ? 'Charge dropped — walk over it to pick it up'
          : state.bomb.state === 'planted' ? 'Charge planted at Site ' + state.bomb.site + ' — hold the site'
            : '';
      drawRadar(state, world);
      if (!el.scoreboard.classList.contains('hidden')) renderScoreboard(state);
    },
    hitmarker(headshot) {
      el.hitmarker.classList.add('on');
      el.hitmarker.classList.toggle('head', headshot);
      clearTimeout(lastHitT);
      lastHitT = setTimeout(() => el.hitmarker.classList.remove('on'), 110);
    },
    setScoreboard(open) {
      el.scoreboard.classList.toggle('hidden', !open);
      if (open) renderScoreboard(window.__rustlineState);
    },
  };
}
