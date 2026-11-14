import * as THREE from 'three/webgpu';
import { color, mix, mx_noise_float, positionWorld } from 'three/tsl';

// Standard material with a little brush mottle so flat fills still look painted.
export function paint(hex, o = {}) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: o.rough ?? 0.85, metalness: o.metal ?? 0 });
  const n = mx_noise_float(positionWorld.mul(o.grain ?? 0.12)).mul(0.5).add(0.5);
  m.colorNode = color(hex).mul(mix(0.88, 1.08, n));
  if (o.emissive !== undefined) m.emissiveNode = color(o.emissive).mul(o.glow ?? 1);
  if (o.flat) m.flatShading = true;
  if (o.double) m.side = THREE.DoubleSide;
  return m;
}

export function add(parent, geometry, material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
