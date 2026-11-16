// Synthesised WebAudio sounds: every effect is built from oscillators and noise
// buffers at runtime. No audio files are shipped. The context is created lazily
// on the first user gesture so autoplay policy never blocks the game.
let ctx = null;
let master = null;
let muted = false;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  return ctx;
}

export function unlockAudio() { ensure(); if (ctx && ctx.state === 'suspended') ctx.resume(); }
export function setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.5; }

function noiseBuffer(duration) {
  const c = ensure();
  if (!c) return null;
  const buf = c.createBuffer(1, Math.max(1, (c.sampleRate * duration) | 0), c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function burst({ type = 'sine', freq = 440, freqEnd = null, dur = 0.1, gain = 0.3, when = 0 }) {
  const c = ensure();
  if (!c || muted) return;
  const t0 = c.currentTime + when;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (freqEnd !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noiseHit({ dur = 0.15, gain = 0.4, filterFreq = 1200, type = 'lowpass', when = 0 }) {
  const c = ensure();
  if (!c || muted) return;
  const buf = noiseBuffer(dur + 0.05);
  if (!buf) return;
  const t0 = c.currentTime + when;
  const src = c.createBufferSource();
  src.buffer = buf;
  const filt = c.createBiquadFilter();
  filt.type = type;
  filt.frequency.value = filterFreq;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(filt).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

const GUN_VOICES = {
  p9: { freq: 190, dur: 0.09, gain: 0.5, filter: 2600 },
  breacher: { freq: 120, dur: 0.22, gain: 0.65, filter: 1400 },
  ripper: { freq: 230, dur: 0.06, gain: 0.42, filter: 3200 },
  vk7: { freq: 165, dur: 0.12, gain: 0.55, filter: 2200 },
  longshot: { freq: 140, dur: 0.28, gain: 0.6, filter: 1600 },
};

export const sfx = {
  shoot(weaponId, distant = false) {
    const v = GUN_VOICES[weaponId] || GUN_VOICES.vk7;
    const g = distant ? v.gain * 0.35 : v.gain;
    burst({ type: 'square', freq: v.freq, freqEnd: 55, dur: v.dur, gain: g * 0.7 });
    noiseHit({ dur: v.dur, gain: g, filterFreq: v.filter, type: 'bandpass' });
  },
  dryFire() { burst({ type: 'square', freq: 900, dur: 0.03, gain: 0.15 }); },
  reload() {
    burst({ type: 'square', freq: 500, dur: 0.04, gain: 0.18 });
    burst({ type: 'square', freq: 700, dur: 0.04, gain: 0.18, when: 0.35 });
    burst({ type: 'square', freq: 420, dur: 0.05, gain: 0.2, when: 0.7 });
  },
  hit() { burst({ type: 'sine', freq: 1200, freqEnd: 900, dur: 0.05, gain: 0.25 }); },
  headshot() {
    burst({ type: 'sine', freq: 1600, freqEnd: 1200, dur: 0.06, gain: 0.3 });
    burst({ type: 'sine', freq: 2000, dur: 0.05, gain: 0.2, when: 0.05 });
  },
  kill() {
    burst({ type: 'sine', freq: 660, dur: 0.09, gain: 0.3 });
    burst({ type: 'sine', freq: 990, dur: 0.12, gain: 0.3, when: 0.09 });
  },
  hurt() { noiseHit({ dur: 0.12, gain: 0.35, filterFreq: 500 }); },
  step() { noiseHit({ dur: 0.05, gain: 0.08, filterFreq: 400 }); },
  explosion() {
    noiseHit({ dur: 0.9, gain: 0.8, filterFreq: 300 });
    burst({ type: 'sine', freq: 90, freqEnd: 30, dur: 0.8, gain: 0.7 });
  },
  flash() { burst({ type: 'sine', freq: 2400, freqEnd: 1800, dur: 0.4, gain: 0.25 }); },
  plantBeep() { burst({ type: 'sine', freq: 880, dur: 0.08, gain: 0.3 }); },
  bombBeep() { burst({ type: 'sine', freq: 1200, dur: 0.07, gain: 0.35 }); },
  defuseTick() { burst({ type: 'square', freq: 1000, dur: 0.03, gain: 0.15 }); },
  roundWin() {
    [523, 659, 784].forEach((f, i) => burst({ type: 'sine', freq: f, dur: 0.18, gain: 0.28, when: i * 0.13 }));
  },
  roundLose() {
    [392, 330, 262].forEach((f, i) => burst({ type: 'sine', freq: f, dur: 0.2, gain: 0.25, when: i * 0.15 }));
  },
  buy() { burst({ type: 'sine', freq: 1320, dur: 0.06, gain: 0.22 }); burst({ type: 'sine', freq: 1760, dur: 0.08, gain: 0.2, when: 0.06 }); },
  click() { burst({ type: 'square', freq: 1400, dur: 0.02, gain: 0.12 }); },
  roundStart() { burst({ type: 'sine', freq: 440, dur: 0.12, gain: 0.25 }); burst({ type: 'sine', freq: 660, dur: 0.14, gain: 0.25, when: 0.12 }); },
};
