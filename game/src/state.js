// Central game state: one object owns every mutable fact the sim reads or writes.
// Modules take `state` and mutate it; rendering only reads it. Events are a small
// queue drained once per fixed step so HUD and audio react in order.
export function createState() {
  return {
    time: 0,
    tick: 0,
    phase: 'menu', // menu | buy | play | postplant | settle | over
    phaseT: 0,
    round: 1,
    score: { warden: 0, jackal: 0 },
    lossStreak: { warden: 0, jackal: 0 },
    bomb: {
      state: 'carried', // carried | dropped | planted | defused | exploded
      x: 0, y: 0, z: 0, carrier: null, site: null,
      plantT: 0, plantBy: null, defuseT: 0, defuseBy: null, timer: 0,
    },
    plantSite: null,
    roundWinner: null,
    roundReason: '',
    matchWinner: null,
    events: [],
    killFeed: [],
    // Player-side facts the HUD reads directly.
    player: null,
    bots: [],
    grenades: [],
    tracers: [],
    flashes: [],
    smokes: [],
    shot: null, // active screenshot mode, or null
    seed: 1,
    frozen: false,
    stats: { shots: 0, hits: 0, kills: 0, deaths: 0, plants: 0, defuses: 0 },
  };
}

export function pushEvent(state, type, data = {}) {
  state.events.push({ type, ...data, t: state.time });
}

export function drainEvents(state) {
  const out = state.events;
  state.events = [];
  return out;
}
