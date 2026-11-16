// Depot Nine: a dusk container yard, 64 x 44 metres, bounded by a concrete wall.
// Three lanes run from the Warden spawn (west) to the Jackal spawn (east):
// north lane past the crane, mid lane through the container stacks, south lane
// along the rail siding. Site A sits north-east, Site B south-east.
// Builds the scene, the AABB colliders the sim tests against, the bomb sites,
// spawn points and the ~38-node waypoint graph bots navigate with BFS.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import {
  makeContainerTexture, makeGroundTexture, makeConcreteTexture,
  makeHazardTexture, makeSkyTexture,
} from './textures.js';

export const MAP = { w: 64, h: 44, wallH: 5 };

const CONTAINER_COLORS = [
  ['#a34a24', '#7c3418', '#c05a2e'],
  ['#2e6b6b', '#1f4a4a', '#3f8a8a'],
  ['#6b6b2e', '#4a4a1f', '#8a8a3f'],
  ['#2e4a6b', '#1f334a', '#3f628a'],
  ['#5c6066', '#41454a', '#767c84'],
];

function addBox(scene, colliders, x, y, z, w, h, d, material, opts = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = opts.shadow !== false;
  mesh.receiveShadow = true;
  scene.add(mesh);
  if (opts.collide !== false) {
    colliders.push({
      minX: x - w / 2, maxX: x + w / 2,
      minY: y - h / 2, maxY: y + h / 2,
      minZ: z - d / 2, maxZ: z + d / 2,
    });
  }
  return mesh;
}

export function createWorld(scene) {
  const colliders = [];
  const rng = Math.random;

  // Sky dome + dusk fog + low sun.
  const skyTex = makeSkyTexture();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(220, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false }),
  );
  scene.add(sky);
  scene.fog = new THREE.Fog(new THREE.Color(PALETTE.fog), 30, 130);
  const sun = new THREE.DirectionalLight(0xff9a4d, 2.4);
  sun.position.set(-40, 26, -30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -45; sun.shadow.camera.right = 45;
  sun.shadow.camera.top = 45; sun.shadow.camera.bottom = -45;
  sun.shadow.camera.far = 140;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x8a7a9a, 0x3a2c22, 0.85));
  const fill = new THREE.DirectionalLight(0x5a6a9a, 0.5);
  fill.position.set(30, 20, 30);
  scene.add(fill);

  // Ground.
  const groundMat = new THREE.MeshStandardMaterial({ map: makeGroundTexture(), roughness: 0.95 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(MAP.w + 30, MAP.h + 30), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const concreteMat = new THREE.MeshStandardMaterial({ map: makeConcreteTexture(), roughness: 0.9 });
  const hazardMat = new THREE.MeshStandardMaterial({ map: makeHazardTexture(), roughness: 0.8 });

  // Perimeter walls.
  const W = MAP.w / 2, H = MAP.h / 2;
  addBox(scene, colliders, 0, 2.5, -H - 1, MAP.w + 4, 5, 2, concreteMat);
  addBox(scene, colliders, 0, 2.5, H + 1, MAP.w + 4, 5, 2, concreteMat);
  addBox(scene, colliders, -W - 1, 2.5, 0, 2, 5, MAP.h + 4, concreteMat);
  addBox(scene, colliders, W + 1, 2.5, 0, 2, 5, MAP.h + 4, concreteMat);

  // Container stacks: [x, z, length, width, height, colourIndex, rotated?]
  const stacks = [
    [-20, -14, 12, 2.6, 2.6, 0, false], [-20, -14, 12, 2.6, 2.6, 1, false],
    [-12, -16, 6, 2.6, 2.6, 2, true], [-6, -10, 12, 2.6, 2.6, 3, false],
    [2, -15, 6, 2.6, 2.6, 4, false], [8, -12, 12, 2.6, 2.6, 0, false],
    [16, -16, 6, 2.6, 5.2, 1, true], [22, -10, 12, 2.6, 2.6, 2, false],
    [-24, 4, 6, 2.6, 2.6, 3, true], [-16, 8, 12, 2.6, 2.6, 4, false],
    [-8, 2, 6, 2.6, 5.2, 0, false], [0, 6, 12, 2.6, 2.6, 1, false],
    [6, 0, 6, 2.6, 2.6, 2, true], [14, 8, 12, 2.6, 2.6, 3, false],
    [20, 2, 6, 2.6, 5.2, 4, false], [-20, 15, 12, 2.6, 2.6, 1, false],
    [-10, 17, 6, 2.6, 2.6, 0, true], [0, 15, 12, 2.6, 2.6, 2, false],
    [10, 17, 6, 2.6, 5.2, 3, false], [18, 14, 12, 2.6, 2.6, 4, false],
    [-26, -6, 6, 2.6, 2.6, 2, true], [26, -2, 6, 2.6, 2.6, 0, true],
  ];
  const containerMats = CONTAINER_COLORS.map(([b, d, l]) =>
    new THREE.MeshStandardMaterial({ map: makeContainerTexture(b, d, l), roughness: 0.75, metalness: 0.25 }));
  for (const [x, z, len, wid, h, ci, rot] of stacks) {
    const w = rot ? wid : len;
    const d = rot ? len : wid;
    const mat = containerMats[ci];
    // Stacked height: place one box per 2.6 m tier.
    const tiers = Math.round(h / 2.6);
    for (let t = 0; t < tiers; t++) {
      addBox(scene, colliders, x, 1.3 + t * 2.6, z, w, 2.6, d, mat);
    }
  }

  // Low crates (jumpable cover) and barrels.
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x7a6a4a, roughness: 0.9 });
  const crates = [[-4, -4, 1.2], [4, -6, 1.2], [-2, 12, 1.2], [12, -4, 1.2], [-14, -2, 1.2], [24, 8, 1.2], [-28, 10, 1.2], [10, 12, 1.2]];
  for (const [x, z, s] of crates) addBox(scene, colliders, x, s / 2, z, s, s, s, crateMat);
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x8a2a1a, roughness: 0.6, metalness: 0.4 });
  const barrelGeo = new THREE.CylinderGeometry(0.45, 0.45, 1.1, 12);
  const barrels = [[-18, -8], [2, -2], [16, 12], [-6, 14], [26, -18], [-26, 16]];
  for (const [x, z] of barrels) {
    const b = new THREE.Mesh(barrelGeo, barrelMat);
    b.position.set(x, 0.55, z);
    b.castShadow = true;
    scene.add(b);
    colliders.push({ minX: x - 0.45, maxX: x + 0.45, minY: 0, maxY: 1.1, minZ: z - 0.45, maxZ: z + 0.45 });
  }

  // Gantry crane silhouette on the north side (visual anchor + cover).
  const craneMat = new THREE.MeshStandardMaterial({ color: 0x8a7a3a, roughness: 0.7, metalness: 0.5 });
  addBox(scene, colliders, -8, 6, -20.5, 1.2, 12, 1.2, craneMat);
  addBox(scene, colliders, 8, 6, -20.5, 1.2, 12, 1.2, craneMat);
  addBox(scene, colliders, 0, 11.4, -20.5, 18, 1.2, 1.6, craneMat);

  // Rail siding along the south edge.
  const railMat = new THREE.MeshStandardMaterial({ color: 0x2e2e32, roughness: 0.5, metalness: 0.7 });
  for (const dz of [-0.8, 0.8]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(56, 0.12, 0.14), railMat);
    rail.position.set(0, 0.08, 20 + dz);
    scene.add(rail);
  }

  // Bomb sites: flat hazard pads + a low site marker frame.
  function sitePad(cx, cz, label) {
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), hazardMat);
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(cx, 0.02, cz);
    pad.receiveShadow = true;
    scene.add(pad);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3, 0.3), craneMat);
    post.position.set(cx + 4, 1.5, cz + 4);
    scene.add(post);
    const board = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.1, 0.15),
      new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 }));
    board.position.set(cx + 4, 3.2, cz + 4);
    scene.add(board);
    // Site letter painted on the pad via a small canvas sprite is overkill;
    // the hazard pad + post marks the zone, and the HUD labels it.
    return { x: cx, z: cz, r: 4.5, label };
  }
  const siteA = sitePad(24, -14, 'A');
  const siteB = sitePad(24, 14, 'B');

  // Waypoint graph: nodes on the three lanes plus site and spawn aprons.
  const wp = [
    // Warden spawn apron (west)
    [-29, 0], [-26, -8], [-26, 8],
    // North lane
    [-22, -14], [-16, -18], [-8, -18], [0, -18], [8, -18], [14, -18], [20, -17],
    // Mid lane
    [-22, 0], [-14, 0], [-6, -2], [2, -2], [10, 0], [16, -2], [20, -6],
    // South lane
    [-22, 14], [-14, 18], [-6, 18], [2, 18], [10, 16], [16, 17], [20, 15],
    // Sites + Jackal spawn
    [24, -14], [24, -8], [24, 8], [24, 14], [28, 0], [28, -8], [28, 8],
    // Connectors / mid connectors
    [-10, -8], [4, -10], [-4, 10], [10, 10], [16, -10], [18, 6],
  ];
  const nodes = wp.map(([x, z], i) => ({ id: i, x, z, links: [] }));
  const link = (a, b) => { nodes[a].links.push(b); nodes[b].links.push(a); };
  // Lane chains.
  link(0, 1); link(0, 2); link(1, 3); link(3, 4); link(4, 5); link(5, 6); link(6, 7);
  link(7, 8); link(8, 9); link(9, 27); link(27, 24);
  link(0, 12); link(12, 13); link(13, 14); link(14, 15); link(15, 16); link(16, 17); link(17, 25);
  link(25, 26); link(26, 24); link(17, 28);
  link(2, 18); link(18, 19); link(19, 20); link(20, 21); link(21, 22); link(22, 23);
  link(23, 29); link(29, 28); link(28, 30);
  // Cross connectors.
  link(4, 31); link(31, 5); link(6, 32); link(32, 14); link(13, 33); link(33, 19);
  link(15, 34); link(34, 21); link(8, 35); link(35, 16); link(22, 36); link(36, 29);
  link(9, 25); link(10, 27); link(24, 28); link(26, 30); link(27, 25);

  // Breadth-first search over the graph; returns an array of node ids.
  function findPath(fromId, toId) {
    if (fromId === toId) return [fromId];
    const prev = new Array(nodes.length).fill(-1);
    const queue = [fromId];
    prev[fromId] = fromId;
    while (queue.length) {
      const cur = queue.shift();
      for (const nb of nodes[cur].links) {
        if (prev[nb] === -1) {
          prev[nb] = cur;
          if (nb === toId) {
            const path = [toId];
            let n = toId;
            while (n !== fromId) { n = prev[n]; path.unshift(n); }
            return path;
          }
          queue.push(nb);
        }
      }
    }
    return [fromId];
  }
  function nearestNode(x, z) {
    let best = 0, bd = Infinity;
    for (const n of nodes) {
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bd) { bd = d; best = n.id; }
    }
    return best;
  }

  return {
    colliders,
    sites: { A: siteA, B: siteB },
    waypoints: nodes,
    findPath,
    nearestNode,
    spawns: {
      warden: [[-29, -3], [-29, 0], [-29, 3], [-27, -5], [-27, 5]],
      jackal: [[28, -4], [28, 0], [28, 4], [26, -6], [26, 6]],
    },
    bounds: { minX: -W, maxX: W, minZ: -H, maxZ: H },
  };
}
