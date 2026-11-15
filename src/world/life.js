import * as THREE from 'three/webgpu';
import { Fn, vec3, mix, hash, instanceIndex, positionLocal, normalWorld, time, sin, atan, floor, color, smoothstep, attribute, dot, max } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ll } from '../config.js';
import { paint, add } from './paint.js';
import { day } from './daylight.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function clouds(center) {
  const group = new THREE.Group();
  const rand = rng(42);
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 1 });
  // Shade colour underneath, the sky's lit colour on top and on the side facing the sun, with a little glow
  // so they never go muddy. At dusk that puts pink on the flank of every puff.
  const up = smoothstep(-0.6, 0.9, normalWorld.y);
  const facing = smoothstep(-0.2, 0.9, dot(normalWorld, day.sunDir));
  const tint = mix(day.cloudShade, mix(day.cloudLit, vec3(1.0, 0.97, 0.92), up.mul(0.6)), max(up.mul(0.7), facing));
  m.colorNode = tint;
  m.emissiveNode = tint.mul(0.42).mul(day.ambient);
  const puff = new THREE.IcosahedronGeometry(1, 2);
  const drift = [];
  for (let i = 0; i < 34; i++) {
    const parts = [];
    const n = 5 + Math.floor(rand() * 5);
    const size = 55 + rand() * 80;
    for (let k = 0; k < n; k++) {
      const g = puff.clone();
      const r = size * (0.5 + rand() * 0.6);
      g.scale(r * 1.25, r * 0.62, r);
      g.translate((rand() - 0.5) * size * 3.2, rand() * size * 0.3, (rand() - 0.5) * size * 1.3);
      parts.push(g);
    }
    const mesh = new THREE.Mesh(mergeGeometries(parts), m);
    mesh.position.set(center.x + (rand() - 0.5) * 16000, 480 + rand() * 520, center.y + (rand() - 0.5) * 16000);
    mesh.rotation.y = rand() * Math.PI;
    group.add(mesh);
    drift.push(4 + rand() * 5);
  }
  const update = (dt) => {
    group.children.forEach((c, i) => {
      c.position.x += drift[i] * dt;
      if (c.position.x > center.x + 8500) c.position.x -= 17000;
    });
  };
  return { group, update };
}

function balloonMaterial(a, b) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.7 });
  const gore = floor(atan(positionLocal.z, positionLocal.x).div(Math.PI * 2).add(0.5).mul(12));
  const band = floor(positionLocal.y.mul(0.22));
  const pick = gore.add(band).mod(2);
  m.colorNode = mix(color(a), color(b), pick);
  m.emissiveNode = mix(color(a), color(b), pick).mul(0.12);
  return m;
}

function balloons() {
  const group = new THREE.Group();
  const rand = rng(7);
  const profile = [];
  for (let i = 0; i <= 18; i++) {
    const t = i / 18;
    const r = Math.sin(Math.PI * Math.pow(t, 0.62)) * 11 + (t < 0.05 ? 2 : 0);
    profile.push(new THREE.Vector2(Math.max(r, 0.01), t * 26));
  }
  const envelope = new THREE.LatheGeometry(profile, 24);
  const basket = new THREE.BoxGeometry(2.6, 2.2, 2.6);
  const wicker = paint(0x9a6a3c);
  const schemes = [[0xe2452f, 0xf7e7c1], [0xf2b632, 0x2f6fb0], [0x3f9d7a, 0xf4f1e6], [0xd94f8a, 0xf7c531], [0x2f6fb0, 0xf4f1e6], [0xf07f2e, 0x7a3fa0]];
  const spots = [[-37.812, 144.985], [-37.826, 144.955], [-37.803, 144.96], [-37.835, 144.99], [-37.818, 144.94], [-37.796, 144.98], [-37.842, 144.962], [-37.829, 144.975]];
  const items = spots.map(([lat, lon], i) => {
    const b = new THREE.Group();
    const [a, c] = schemes[i % schemes.length];
    add(b, envelope, balloonMaterial(a, c), 0, 5, 0);
    add(b, basket, wicker, 0, 0, 0);
    const p = ll(lat, lon);
    const alt = 190 + rand() * 260;
    b.position.set(p.x, alt, p.y);
    b.scale.setScalar(1.5);
    group.add(b);
    return { b, x: p.x, z: p.y, alt, phase: rand() * 10, speed: 0.05 + rand() * 0.05 };
  });
  const update = (dt, t) => {
    for (const it of items) {
      it.b.position.set(it.x + Math.sin(t * it.speed + it.phase) * 260, it.alt + Math.sin(t * 0.3 + it.phase) * 14, it.z + Math.cos(t * it.speed * 0.8 + it.phase) * 220);
      it.b.rotation.y += dt * 0.05;
    }
  };
  return { group, update, items };
}

function boats(isSea) {
  const rand = rng(99);
  const hull = new THREE.BoxGeometry(2.4, 1, 8).translate(0, 0.4, 0);
  const sail = new THREE.BufferGeometry();
  sail.setAttribute('position', new THREE.Float32BufferAttribute([0, 1, -3, 0, 12, -0.5, 0, 1, 2.6, 0, 1, 2.6, 0, 12, -0.5, 0, 1, -3], 3));
  sail.setAttribute('normal', new THREE.Float32BufferAttribute([1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0], 3));
  const hullNI = hull.toNonIndexed();
  hullNI.deleteAttribute('uv');
  const geo = mergeGeometries([hullNI, sail]);
  const spots = [];
  let guard = 0;
  while (spots.length < 70 * 2 && guard++ < 6000) {
    const x = -5200 + rand() * 7000, z = 2600 + rand() * 9000;
    if (isSea(x, z) && isSea(x + 60, z) && isSea(x, z - 60)) spots.push(x, z);
  }
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.7, side: THREE.DoubleSide });
  const r = hash(instanceIndex.add(5));
  m.colorNode = mix(vec3(0.98, 0.96, 0.9), mix(vec3(0.86, 0.25, 0.2), vec3(0.2, 0.42, 0.7), hash(instanceIndex.add(31))), r.greaterThan(0.72).select(1, 0).mul(positionLocal.y.greaterThan(1).select(1, 0)));
  m.positionNode = Fn(() => {
    const bob = sin(time.mul(1.1).add(r.mul(20))).mul(0.3);
    const heel = sin(time.mul(0.7).add(r.mul(11))).mul(0.06).mul(positionLocal.y);
    return positionLocal.add(vec3(heel, bob, 0));
  })();
  const mesh = new THREE.InstancedMesh(geo, m, spots.length / 2);
  const d = new THREE.Object3D();
  for (let i = 0; i < spots.length / 2; i++) {
    d.position.set(spots[i * 2], 0, spots[i * 2 + 1]);
    d.rotation.y = rand() * Math.PI * 2;
    d.scale.setScalar(1.6 + rand() * 1.4);
    d.updateMatrix();
    mesh.setMatrixAt(i, d.matrix);
  }
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

function carGeometry(boxes) {
  const parts = boxes.map(([w, h, l, y, hex]) => {
    const g = new THREE.BoxGeometry(w, h, l).translate(0, y, 0).toNonIndexed();
    g.deleteAttribute('uv');
    const c = new THREE.Color(hex);
    const col = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < col.length; i += 3) col.set([c.r, c.g, c.b], i);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  });
  return mergeGeometries(parts);
}

// Green and cream W-class tram, and a silver suburban train car with the blue and yellow band.
const TRAM = { length: 15, scale: 1.9, cars: 1, speed: [9, 14], geometry: () => carGeometry([
  [2.7, 1.3, 15, 1.15, 0x2f7a45], [2.6, 1.2, 14.6, 2.4, 0x26323f], [2.7, 0.35, 15, 1.95, 0xf3e3b5],
  [2.75, 0.3, 15.2, 3.15, 0xf3e3b5], [2.3, 0.35, 12, 3.45, 0x8a6f5a], [0.2, 1.4, 0.2, 4.2, 0x3a3a3a],
]) };
const TRAIN = { length: 23, scale: 1.7, cars: 4, speed: [22, 30], geometry: () => carGeometry([
  [3, 1.5, 22.4, 1.35, 0xe6e9ec], [2.9, 1.1, 22, 2.65, 0x1c2733], [3.05, 0.45, 22.4, 1.95, 0x1f55b0],
  [3.06, 0.2, 22.4, 1.6, 0xf5c518], [3, 0.5, 22.4, 3.45, 0xcfd4d8], [2.2, 0.3, 18, 3.85, 0x8e959b],
]) };

// OSM splits a line into many short ways. Join them end to end so a vehicle can run a decent distance.
function chains(ways, minLength) {
  const key = (x, z) => `${x},${z}`;
  const ends = new Map();
  const lines = ways.map((w) => ({ w, used: false }));
  for (const l of lines) {
    for (const k of [key(l.w[0], l.w[1]), key(l.w[l.w.length - 2], l.w[l.w.length - 1])]) {
      if (!ends.has(k)) ends.set(k, []);
      ends.get(k).push(l);
    }
  }
  const out = [];
  for (const start of lines) {
    if (start.used) continue;
    start.used = true;
    let pts = start.w.slice();
    for (const grow of ['tail', 'head']) {
      for (;;) {
        const n = pts.length;
        const k = grow === 'tail' ? key(pts[n - 2], pts[n - 1]) : key(pts[0], pts[1]);
        const next = (ends.get(k) || []).find((l) => !l.used);
        if (!next) break;
        next.used = true;
        let w = next.w;
        const startsHere = key(w[0], w[1]) === k;
        if ((grow === 'tail') !== startsHere) {
          const rev = [];
          for (let i = w.length - 2; i >= 0; i -= 2) rev.push(w[i], w[i + 1]);
          w = rev;
        }
        pts = grow === 'tail' ? pts.concat(w.slice(2)) : w.slice(0, -2).concat(pts);
      }
    }
    const path = [];
    const at = [0];
    for (let i = 0; i < pts.length; i += 2) {
      const p = new THREE.Vector2(pts[i] / 10, pts[i + 1] / 10);
      if (path.length) at.push(at[at.length - 1] + p.distanceTo(path[path.length - 1]));
      path.push(p);
    }
    if (at[at.length - 1] >= minLength) out.push({ path, at, length: at[at.length - 1] });
  }
  return out.sort((a, b) => b.length - a.length);
}

function place(chain, s, d) {
  const { path, at } = chain;
  s = Math.min(Math.max(s, 0), chain.length);
  let lo = 0, hi = at.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (at[mid] <= s) lo = mid; else hi = mid;
  }
  const f = (s - at[lo]) / Math.max(at[hi] - at[lo], 0.001);
  d.position.set(path[lo].x + (path[hi].x - path[lo].x) * f, 0.2, path[lo].y + (path[hi].y - path[lo].y) * f);
  d.rotation.y = Math.atan2(path[hi].x - path[lo].x, path[hi].y - path[lo].y);
}

// Vehicles shuttle along their chain and turn back at each end.
function railTraffic(ways, kind, count, minLength, seed) {
  const routes = chains(ways, minLength).slice(0, count);
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.55 });
  m.colorNode = attribute('color', 'vec3');
  const mesh = new THREE.InstancedMesh(kind.geometry(), m, Math.max(1, routes.length * kind.cars));
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  const d = new THREE.Object3D();
  d.scale.setScalar(kind.scale);
  const rand = rng(seed);
  const gap = kind.length * kind.scale + 1.5;
  const state = routes.map((chain) => ({
    chain, s: rand() * chain.length, dir: rand() > 0.5 ? 1 : -1, speed: kind.speed[0] + rand() * (kind.speed[1] - kind.speed[0]),
  }));
  const update = (dt) => {
    state.forEach((v, i) => {
      const span = (kind.cars - 1) * gap;
      v.s += v.dir * v.speed * dt;
      if (v.s > v.chain.length) { v.s = v.chain.length; v.dir = -1; }
      if (v.s < span) { v.s = span; v.dir = 1; }
      for (let c = 0; c < kind.cars; c++) {
        place(v.chain, v.s - c * gap, d);
        d.updateMatrix();
        mesh.setMatrixAt(i * kind.cars + c, d.matrix);
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  update(0);
  return { mesh, update, count: routes.length };
}

function birds(group) {
  const flocks = [
    { c: ll(-37.8455, 144.9705), r: 190, y: 95, n: 7 },
    { c: ll(-37.8195, 144.972), r: 240, y: 140, n: 6 },
    { c: ll(-37.862, 144.968), r: 170, y: 60, n: 6 },
  ];
  const mixers = [];
  const flyers = [];
  new GLTFLoader().load('models/Stork.glb', (gltf) => {
    const size = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3());
    const scale = 7 / Math.max(size.x, size.z);
    let k = 0;
    for (const f of flocks) {
      for (let i = 0; i < f.n; i++) {
        const bird = gltf.scene.clone();
        bird.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        bird.scale.setScalar(scale * (0.8 + (k % 3) * 0.15));
        const mixer = new THREE.AnimationMixer(bird);
        const action = mixer.clipAction(gltf.animations[0]);
        action.timeScale = 1.1 + (k % 4) * 0.1;
        action.time = k * 0.13;
        action.play();
        mixers.push(mixer);
        flyers.push({ bird, f, phase: (i / f.n) * 0.9 + k, lag: i * 0.11, off: (i % 3) * 9 });
        group.add(bird);
        k++;
      }
    }
  });
  return (dt, t) => {
    for (const m of mixers) m.update(dt);
    for (const b of flyers) {
      const a = t * 0.085 + b.phase - b.lag;
      const r = b.f.r + b.off * 2;
      b.bird.position.set(b.f.c.x + Math.cos(a) * r, b.f.y + Math.sin(a * 2.3) * 9 + b.off, b.f.c.y + Math.sin(a) * r);
      b.bird.rotation.y = -a;
    }
  };
}

export function buildLife(data, center, isSea) {
  const group = new THREE.Group();
  group.name = 'life';
  const sky = clouds(center);
  const air = balloons();
  const tramCars = railTraffic(data.tram, TRAM, 90, 500, 3);
  const trainSets = railTraffic(data.rail, TRAIN, 46, 900, 5);
  const updateBirds = birds(group);
  group.add(sky.group, air.group, tramCars.mesh, trainSets.mesh, boats(isSea));
  return {
    group,
    stats: { trams: tramCars.count, trains: trainSets.count },
    update(dt, t) {
      sky.update(dt);
      air.update(dt, t);
      tramCars.update(dt);
      trainSets.update(dt);
      updateBirds(dt, t);
    },
  };
}
