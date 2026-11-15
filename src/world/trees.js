import * as THREE from 'three/webgpu';
import { Fn, vec3, mix, hash, instanceIndex, positionLocal, normalLocal, time, sin, step, smoothstep, float } from 'three/tsl';
import { LITE } from '../config.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const TILE = 1100;
const MAX_SCATTER = LITE ? 5000 : 12000;

export function treeGeometry() {
  const blob = (r, x, y, z) => {
    const g = new THREE.IcosahedronGeometry(r, 0);
    g.scale(1, 0.86, 1);
    const pos = g.attributes.position, nor = g.attributes.normal;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).normalize();
      nor.setXYZ(i, v.x, v.y, v.z);
    }
    g.translate(x, y, z);
    return g;
  };
  const trunk = new THREE.CylinderGeometry(0.1, 0.17, 1.1, 5).translate(0, 0.55, 0).toNonIndexed();
  const merged = mergeGeometries([trunk, blob(1, 0, 1.75, 0), blob(0.68, 0.55, 1.35, 0.3)]);
  merged.deleteAttribute('uv');
  return merged;
}

export function treeMaterial(seed) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.95 });
  const r = hash(instanceIndex.add(seed));
  const r2 = hash(instanceIndex.add(seed + 977));
  const isLeaf = step(1.0, positionLocal.y);
  m.positionNode = Fn(() => {
    const sway = sin(time.mul(1.4).add(r.mul(6.28))).mul(0.045).mul(smoothstep(0.6, 2.6, positionLocal.y));
    return positionLocal.add(vec3(sway, 0, sway.mul(0.6)));
  })();
  m.colorNode = Fn(() => {
    const deep = mix(vec3(0.16, 0.36, 0.17), vec3(0.3, 0.46, 0.14), r);
    const sunny = mix(vec3(0.5, 0.7, 0.22), vec3(0.74, 0.78, 0.26), r2);
    const autumn = mix(vec3(0.86, 0.55, 0.14), vec3(0.8, 0.32, 0.14), r);
    const leaf = mix(deep, sunny, smoothstep(-0.4, 0.9, normalLocal.y)).toVar();
    leaf.assign(mix(leaf, autumn.mul(mix(float(0.75), float(1.1), smoothstep(-0.4, 0.9, normalLocal.y))), step(0.9, r2)));
    return mix(vec3(0.36, 0.25, 0.18), leaf, isLeaf);
  })();
  return m;
}

function inRing(x, z, r) {
  let inside = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    if (r[i + 1] > z !== r[j + 1] > z && x < ((r[j] - r[i]) * (z - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]) inside = !inside;
  }
  return inside;
}

export function buildTrees(data, heightAt) {
  const spots = [];
  const stride = LITE ? 4 : 2; // every second mapped tree on phones
  for (let i = 0; i < data.trees.length; i += stride) {
    const x = data.trees[i] / 10, z = data.trees[i + 1] / 10;
    if (heightAt(x, z) === 0) spots.push(x, z);
  }
  const mapped = spots.length / 2;

  // Street trees are only mapped inside the City of Melbourne, so parks elsewhere get a scatter.
  let seed = 1234567;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  let scattered = 0;
  for (const poly of data.green) {
    const ring = poly[0];
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < ring.length; i += 2) {
      x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]);
      z0 = Math.min(z0, ring[i + 1]); z1 = Math.max(z1, ring[i + 1]);
    }
    const tries = Math.min(260, Math.ceil(((x1 - x0) * (z1 - z0)) / 100 / 520));
    for (let k = 0; k < tries && scattered < MAX_SCATTER; k++) {
      const x = x0 + rand() * (x1 - x0), z = z0 + rand() * (z1 - z0);
      if (!inRing(x, z, ring) || heightAt(x / 10, z / 10) > 0) continue;
      spots.push(x / 10, z / 10);
      scattered++;
    }
  }

  const b = data.bounds;
  const cols = Math.ceil((b.maxX - b.minX) / TILE);
  const tiles = new Map();
  for (let i = 0; i < spots.length; i += 2) {
    const key = Math.floor((spots[i + 1] - b.minZ) / TILE) * cols + Math.floor((spots[i] - b.minX) / TILE);
    if (!tiles.has(key)) tiles.set(key, []);
    tiles.get(key).push(spots[i], spots[i + 1]);
  }

  const group = new THREE.Group();
  group.name = 'trees';
  const geometry = treeGeometry();
  const material = treeMaterial(7);
  const dummy = new THREE.Object3D();
  let n = 0;
  for (const list of tiles.values()) {
    const count = list.length / 2;
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    for (let i = 0; i < count; i++) {
      const s = 2.6 + rand() * 2.8;
      dummy.position.set(list[i * 2], 0, list[i * 2 + 1]);
      dummy.rotation.y = rand() * Math.PI * 2;
      dummy.scale.set(s * (0.85 + rand() * 0.4), s, s * (0.85 + rand() * 0.4));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.computeBoundingSphere();
    mesh.castShadow = !LITE;
    mesh.receiveShadow = true;
    group.add(mesh);
    n++;
  }
  return { group, stats: { mapped, scattered } };
}
