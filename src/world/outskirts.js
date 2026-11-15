import * as THREE from 'three/webgpu';
import { Fn, vec3, mix, hash, instanceIndex, positionLocal, positionWorld, normalWorld, step, smoothstep, dot, mx_noise_float } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FLIGHT_BOX, LITE } from '../config.js';
import { day } from './daylight.js';
import { treeGeometry, farTreeGeometry, treeMaterial } from './trees.js';
import { tagDetail } from './detail.js';

const LOT = 26;
const TILE = 2000;

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const cellHash = (i, j) => {
  let h = (i * 73856093) ^ (j * 19349663);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

// Metres outside the mapped rectangle, zero inside it.
const outside = (b, x, z) => Math.max(b.minX - x, x - b.maxX, b.minZ - z, z - b.maxZ, 0);

function houseGeometry() {
  const body = new THREE.BoxGeometry(10, 4.4, 12).translate(0, 2.2, 0).toNonIndexed();
  const roof = new THREE.ConeGeometry(9.4, 3.6, 4).rotateY(Math.PI / 4).scale(1, 1, 1.2).translate(0, 6.2, 0).toNonIndexed();
  body.deleteAttribute('uv');
  roof.deleteAttribute('uv');
  return mergeGeometries([body, roof]);
}

function houseMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.9 });
  const r = hash(instanceIndex.add(17));
  const r2 = hash(instanceIndex.add(911));
  m.colorNode = Fn(() => {
    const wall = mix(mix(vec3(0.9, 0.84, 0.7), vec3(0.62, 0.3, 0.22), step(0.55, r)), vec3(0.78, 0.82, 0.8), step(0.85, r));
    const roof = mix(mix(vec3(0.72, 0.3, 0.17), vec3(0.4, 0.42, 0.47), step(0.6, r2)), vec3(0.62, 0.64, 0.62), step(0.88, r2));
    // A dark band of windows round the middle of the walls.
    const windows = step(1.4, positionLocal.y).mul(step(positionLocal.y, 2.9)).mul(step(0.5, positionLocal.x.mul(0.5).fract().add(positionLocal.z.mul(0.5).fract()).mul(0.5).add(0.2)));
    return mix(mix(wall, vec3(0.2, 0.25, 0.33), windows.mul(0.7)), roof, step(4.45, positionLocal.y));
  })();
  return m;
}

function instanced(geometry, material, spots, makeMatrix, kind, farGeometry = null) {
  const group = new THREE.Group();
  const tiles = new Map();
  for (const s of spots) {
    const key = `${Math.floor(s.x / TILE)},${Math.floor(s.z / TILE)}`;
    if (!tiles.has(key)) tiles.set(key, []);
    tiles.get(key).push(s);
  }
  const d = new THREE.Object3D();
  for (const list of tiles.values()) {
    const mesh = new THREE.InstancedMesh(geometry, material, list.length);
    list.forEach((s, i) => {
      makeMatrix(d, s);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
    });
    mesh.computeBoundingSphere();
    mesh.castShadow = false; // tens of thousands of far-off instances; their shadows are never close enough to read
    mesh.receiveShadow = true;
    group.add(mesh);
    const far = tagDetail(mesh, kind, farGeometry);
    if (far) group.add(far);
  }
  return group;
}

// Suburban houses on the same street grid the ground shader paints beyond the map, thickest to the north.
function houses(bounds, blocked) {
  const spots = [];
  const reach = 2800;
  const corners = [[bounds.minX - reach, bounds.minZ - reach], [bounds.maxX + reach, bounds.minZ - reach], [bounds.minX - reach, bounds.maxZ + reach], [bounds.maxX + reach, bounds.maxZ + reach]];
  const qs = corners.map(([x, z]) => [0.94 * x - 0.34 * z, 0.34 * x + 0.94 * z]);
  const i0 = Math.floor(Math.min(...qs.map((q) => q[0])) / LOT), i1 = Math.ceil(Math.max(...qs.map((q) => q[0])) / LOT);
  const j0 = Math.floor(Math.min(...qs.map((q) => q[1])) / LOT), j1 = Math.ceil(Math.max(...qs.map((q) => q[1])) / LOT);
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const qx = (i + 0.5) * LOT, qz = (j + 0.5) * LOT;
      // Same test the ground shader uses for its painted streets.
      const gx = qx / 118, gz = qz / 74;
      if (gx - Math.floor(gx) > 0.82 || gz - Math.floor(gz) > 0.74) continue;
      const x = (0.94 * qx + 0.34 * qz) / 0.9992, z = (-0.34 * qx + 0.94 * qz) / 0.9992;
      const out = outside(bounds, x, z);
      const band = z < bounds.minZ ? 2800 : 1500;
      if (out <= 0 || out > band) continue;
      const chance = (LITE ? 0.3 : 0.62) * (1 - (out / band) * 0.55);
      const h = cellHash(i, j);
      if (h > chance || blocked(x, z, 70)) continue;
      spots.push({ x, z, r: h / chance });
    }
  }
  const yaw = Math.atan2(0.34, 0.94);
  const group = instanced(houseGeometry(), houseMaterial(), spots, (d, s) => {
    d.position.set(s.x, 0, s.z);
    d.rotation.y = -yaw + (s.r > 0.5 ? Math.PI / 2 : 0);
    d.scale.set(0.9 + s.r * 0.3, 0.9 + s.r * 0.35, 0.9 + s.r * 0.3);
  }, 'houses');
  return { group, count: spots.length };
}

// Street trees among the houses, thickening into woodland further out.
function woodland(bounds, blocked) {
  const rand = rng(2024);
  const spots = [];
  const b = FLIGHT_BOX, pad = 2500;
  let guard = 0;
  while (spots.length < (LITE ? 11000 : 30000) && guard++ < 400000) {
    const x = b.minX - pad + rand() * (b.maxX - b.minX + pad * 2), z = b.minZ - pad + rand() * (b.maxZ - b.minZ + pad * 2);
    const out = outside(bounds, x, z);
    if (out <= 0) continue;
    const clump = Math.sin(x * 0.0041) + Math.sin(z * 0.0053 + 1.3) + Math.sin((x + z) * 0.0029 + 0.7);
    const chance = out < 2600 ? 0.3 : clump > -0.2 ? 1 : 0.12;
    if (rand() > chance || blocked(x, z, 30)) continue;
    spots.push({ x, z, r: rand(), far: out > 2600 });
  }
  const group = instanced(treeGeometry(), treeMaterial(41), spots, (d, s) => {
    const k = (s.far ? 4.2 : 2.6) + s.r * 3.2;
    d.position.set(s.x, 0, s.z);
    d.rotation.y = s.r * 6.28;
    d.scale.set(k, k * (0.9 + s.r * 0.4), k);
  }, 'woodland', farTreeGeometry());
  return { group, count: spots.length };
}

// Two faceted ranges ringing the world. They ignore scene fog and carry their own haze, so they stay readable
// as blue silhouettes at any distance.
function mountains() {
  const group = new THREE.Group();
  const sun = day.sunDir;
  const haze = day.haze;
  const ring = (radius, height, seed, tint, hazeAmount) => {
    const N = 220;
    const ridge = (a) => 0.42 + 0.3 * Math.sin(a * 3 + seed) + 0.18 * Math.sin(a * 7.3 + seed * 2.1) + 0.1 * Math.sin(a * 17.1 + seed * 0.7);
    const rand = rng(seed * 1000);
    const rows = [];
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      const h = height * Math.max(0.18, ridge(a)) * (0.8 + rand() * 0.4);
      const at = (r, y) => new THREE.Vector3(c * r, y, s * r);
      rows.push([at(radius - 2600, -20), at(radius - 1300 + rand() * 500, h * (0.4 + rand() * 0.2)), at(radius + rand() * 700, h), at(radius + 2600, -20)]);
    }
    rows[N] = rows[0];
    const pos = [];
    for (let i = 0; i < N; i++) {
      for (let k = 0; k < 3; k++) {
        const a = rows[i][k], b2 = rows[i + 1][k], c2 = rows[i + 1][k + 1], d = rows[i][k + 1];
        pos.push(a.x, a.y, a.z, c2.x, c2.y, c2.z, b2.x, b2.y, b2.z, a.x, a.y, a.z, d.x, d.y, d.z, c2.x, c2.y, c2.z);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    const m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, fog: false });
    const light = dot(normalWorld, sun).abs();
    const rock = mix(tint.mul(0.62), tint.mul(1.25).add(vec3(0.1, 0.06, 0.0)), smoothstep(0.1, 0.8, light));
    const brush = mix(0.92, 1.08, mx_noise_float(positionWorld.mul(0.0012)).mul(0.5).add(0.5));
    const low = smoothstep(height * 0.45, 0, positionWorld.y);
    m.colorNode = mix(rock.mul(brush).mul(day.ambient.min(1)), haze, low.mul(0.5).add(hazeAmount).clamp(0, 1));
    const mesh = new THREE.Mesh(geo, m);
    mesh.frustumCulled = false;
    group.add(mesh);
  };
  ring(15500, 900, 1.7, vec3(0.3, 0.42, 0.5), 0.38);
  ring(19500, 1700, 4.2, vec3(0.42, 0.48, 0.66), 0.55);
  return group;
}

export function buildOutskirts(bounds, isSea, airfields) {
  const blocked = (x, z, margin) => isSea(x, z) || airfields.some((f) => Math.hypot(x - f.x, z - f.z) < f.radius + margin);
  const group = new THREE.Group();
  group.name = 'outskirts';
  const homes = houses(bounds, blocked);
  const trees = woodland(bounds, blocked);
  group.add(homes.group, trees.group, mountains());
  return { group, stats: { houses: homes.count, trees: trees.count } };
}
