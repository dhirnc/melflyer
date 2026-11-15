import * as THREE from 'three/webgpu';
import { LITE } from '../config.js';

// How far each kind of scenery is drawn, in metres from the camera to the nearest edge of its tile.
// Inside swapAt the full mesh is drawn, beyond it the cheap stand-in, and beyond hideAt nothing.
// The fog and the brush filter cover both changes: at these ranges a tree is a few pixels across.
const RANGES = LITE
  ? { trees: { swapAt: 1300, hideAt: 5500 }, woodland: { swapAt: 1300, hideAt: 6500 }, houses: { hideAt: 6500 } }
  : { trees: { swapAt: 2600 }, woodland: { swapAt: 2600 }, houses: {} };

const PRIME_PER_FRAME = 4;

// Tags an instanced tile so createDetail manages it. With a far geometry it also returns the stand-in mesh,
// which shares the tile's instance matrices and must be added to the scene beside it.
export function tagDetail(mesh, kind, farGeometry = null) {
  let far = null;
  if (farGeometry) {
    far = new THREE.InstancedMesh(farGeometry, mesh.material, mesh.count);
    far.instanceMatrix = mesh.instanceMatrix;
    far.boundingSphere = mesh.boundingSphere;
    far.receiveShadow = mesh.receiveShadow;
    far.visible = false;
  }
  mesh.userData.detail = { kind, far };
  return far;
}

// Per-frame scenery housekeeping. Two jobs:
//  1. Level of detail: swaps or hides tagged tiles by distance, using RANGES.
//  2. Priming: draws a few not-yet-seen meshes each frame with culling off, so their buffers reach the GPU
//     behind the title screen instead of hitching the first time a district flies into view.
export function createDetail(scene) {
  const tiles = [];
  const unprimed = [];
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (!o.isMesh) return;
    if (o.frustumCulled) unprimed.push(o);
    const tag = o.userData.detail;
    if (!tag) return;
    const range = RANGES[tag.kind];
    const sphere = o.boundingSphere ?? o.geometry.boundingSphere;
    tiles.push({ near: o, far: tag.far, centre: sphere.center.clone().applyMatrix4(o.matrixWorld), radius: sphere.radius, swapAt: range.swapAt ?? Infinity, hideAt: range.hideAt ?? Infinity });
  });
  const managed = new Set(tiles.flatMap((t) => (t.far ? [t.near, t.far] : [t.near])));
  let priming = [];

  return {
    get pending() { return unprimed.length; },
    update(cameraPosition) {
      for (const t of tiles) {
        const d = cameraPosition.distanceTo(t.centre) - t.radius;
        const shown = d < t.hideAt;
        const close = d < t.swapAt || !t.far;
        t.near.visible = shown && close;
        if (t.far) t.far.visible = shown && !close;
      }
      for (const o of priming) o.frustumCulled = true;
      priming = unprimed.splice(-PRIME_PER_FRAME);
      for (const o of priming) {
        o.frustumCulled = false;
        if (managed.has(o)) o.visible = true; // this frame only; the loop above decides again on the next one
      }
    },
  };
}
