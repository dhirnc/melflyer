import * as THREE from 'three/webgpu';
import region from '../region.json';

export const ORIGIN = region.origin;

// Phones get a lighter build: no screen-space GI or reflections, a cheaper brush filter, a thinner world.
// ?quality=full or ?quality=lite overrides the guess.
const asked = new URLSearchParams(globalThis.location?.search ?? '').get('quality');
const phone = globalThis.matchMedia?.('(pointer: coarse)').matches || /Android|iPhone|iPad|Mobile/i.test(globalThis.navigator?.userAgent ?? '');
export const LITE = asked ? asked === 'lite' : !!phone;
const MX = Math.cos((ORIGIN.lat * Math.PI) / 180) * 111320;
const MZ = 110574;

// lat/lon -> local metres. x east, z south, so north is -z.
export const ll = (lat, lon) => new THREE.Vector2((lon - ORIGIN.lon) * MX, -(lat - ORIGIN.lat) * MZ);

// The box the plane may roam. Wider than the detailed map so the outlying airfields are reachable.
const sw = ll(region.flight.s, region.flight.w), ne = ll(region.flight.n, region.flight.e);
export const FLIGHT_BOX = { minX: sw.x, maxX: ne.x, minZ: ne.y, maxZ: sw.y };

export const FLIGHT = {
  cruise: 58,
  boost: 135,
  minAlt: 9,
  maxAlt: 950,
  wheelsY: 3.4, // height of the plane's origin when its floats sit on the ground
  liftOff: 44,
  maxRoll: THREE.MathUtils.degToRad(62),
  maxPitch: THREE.MathUtils.degToRad(32),
  start: { lat: -37.8455, lon: 144.9735, alt: 150, heading: 0 },
};
