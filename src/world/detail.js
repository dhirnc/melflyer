import * as THREE from 'three/webgpu';
import { LITE } from '../config.js';

// How far each kind of scenery is drawn, in metres from the camera to the nearest edge of its tile.
// Inside swapAt the full mesh is drawn, beyond it the cheap stand-in, and beyond hideAt nothing.
// The fog and the brush filter cover both changes: at these ranges a tree is a few pixels across.
const RANGES = LITE
  ? { trees: { swapAt: 1300, hideAt: 5500 }, woodland: { swapAt: 1300, hideAt: 6500 }, houses: { hideAt: 6500 } }
  : { trees: { swapAt: 2600 }, woodland: { swapAt: 2600 }, houses: {} };

// Priming a mesh means uploading its buffers, which stalls the GPU for far longer than the JavaScript takes:
// four a frame held a desktop at 37 fps for eight seconds and a phone well below that. So it is one mesh, and
// only on the frame after a quick one. A device that cannot hold this frame time is never primed at all and
// loads each district the first time it is seen, which costs it less than a steady trickle of uploads would.
const PRIME_AFTER_FRAME_UNDER = 0.02;

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
//  2. Priming: draws one not-yet-seen mesh with culling off on frames with time to spare, nearest first, so its
//     buffers reach the GPU before the district it belongs to flies into view.
export function createDetail(scene) {
  const tiles = [];
  const unprimed = [];
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (!o.isMesh) return;
    if (o.frustumCulled) unprimed.push({ mesh: o, centre: null });
    const tag = o.userData.detail;
    if (!tag) return;
    const range = RANGES[tag.kind];
    const sphere = o.boundingSphere ?? o.geometry.boundingSphere;
    tiles.push({ near: o, far: tag.far, centre: sphere.center.clone().applyMatrix4(o.matrixWorld), radius: sphere.radius, swapAt: range.swapAt ?? Infinity, hideAt: range.hideAt ?? Infinity });
  });
  const managed = new Set(tiles.flatMap((t) => (t.far ? [t.near, t.far] : [t.near])));
  for (const u of unprimed) {
    const sphere = u.mesh.boundingSphere ?? u.mesh.geometry.boundingSphere ?? (u.mesh.geometry.computeBoundingSphere(), u.mesh.geometry.boundingSphere);
    u.centre = sphere.center.clone().applyMatrix4(u.mesh.matrixWorld);
  }
  let priming = null;
  let sorted = false;

  return {
    get pending() { return unprimed.length; },
    update(cameraPosition, dt) {
      for (const t of tiles) {
        const d = cameraPosition.distanceTo(t.centre) - t.radius;
        const shown = d < t.hideAt;
        const close = d < t.swapAt || !t.far;
        t.near.visible = shown && close;
        if (t.far) t.far.visible = shown && !close;
      }
      if (priming) priming.frustumCulled = true;
      priming = null;
      if (!unprimed.length || dt > PRIME_AFTER_FRAME_UNDER) return;
      if (!sorted) {
        // Furthest first, so pop() hands back the nearest: the districts round the start are ready soonest.
        unprimed.sort((a, b) => b.centre.distanceToSquared(cameraPosition) - a.centre.distanceToSquared(cameraPosition));
        sorted = true;
      }
      priming = unprimed.pop().mesh;
      priming.frustumCulled = false;
      if (managed.has(priming)) priming.visible = true; // this frame only; the loop above decides again on the next one
    },
  };
}
