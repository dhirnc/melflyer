import * as THREE from 'three/webgpu';
import { color, uv, mix, step, fract, abs, sin, positionWorld, mx_noise_float, vec3, smoothstep } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { paint, add } from './paint.js';

// The real airports are 10 to 20 km out, which is a long dull flight. These sit just past the edge of the
// mapped city, in roughly the right direction. Positions are local metres [east, south] from Flinders Street.
// Runway bearings are true headings in degrees, offsets are metres from the field centre.
// Add a field here and it becomes landable, gets a logbook entry and shows on the guide arrow.
const FIELDS = [
  {
    name: 'Melbourne Airport', code: 'MEL', x: -5600, z: -8000, radius: 1900, big: true,
    runways: [{ bearing: 171, length: 2700, width: 58, off: [-200, 0] }, { bearing: 94, length: 1900, width: 52, off: [250, 700] }],
  },
  {
    name: 'Essendon Fields', code: 'MEB', x: -900, z: -5500, radius: 1150,
    runways: [{ bearing: 180, length: 1500, width: 45, off: [150, 0] }, { bearing: 91, length: 1700, width: 45, off: [0, 100] }],
  },
  {
    name: 'Moorabbin Airport', code: 'MBW', x: 6300, z: 7300, radius: 1100,
    runways: [{ bearing: 180, length: 1300, width: 34, off: [-140, 0] }, { bearing: 180, length: 1150, width: 34, off: [140, 60] }, { bearing: 135, length: 1100, width: 30, off: [0, 0] }],
  },
];

function runwayMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const u = uv().x, v = uv().y; // u across, v along, both in metres from one corner
  const width = uv(1).x, length = uv(1).y;
  const across = u.div(width).sub(0.5);
  const fromEnd = v.min(length.sub(v));
  const dash = step(abs(across), 0.012).mul(step(0.5, fract(v.div(60)))).mul(step(120, fromEnd));
  const edge = step(0.46, abs(across)).mul(step(abs(across), 0.48));
  const keys = step(fromEnd, 70).mul(step(20, fromEnd)).mul(step(0.5, fract(across.mul(11)))).mul(step(abs(across), 0.42));
  const marks = dash.add(edge).add(keys).clamp(0, 1);
  const tar = mix(vec3(0.2, 0.2, 0.23), vec3(0.27, 0.26, 0.28), mx_noise_float(positionWorld.mul(0.03)).mul(0.5).add(0.5));
  // Rubber where the wheels meet the runway.
  const rubber = smoothstep(0.1, 0.0, abs(across)).mul(smoothstep(500, 150, fromEnd)).mul(0.25);
  m.colorNode = mix(tar.mul(rubber.oneMinus()), vec3(0.95, 0.94, 0.9), marks);
  return m;
}

function grassMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const n = mx_noise_float(positionWorld.mul(0.006)).mul(0.5).add(0.5);
  const mow = sin(positionWorld.x.mul(0.05)).mul(0.5).add(0.5);
  m.colorNode = mix(mix(color(0x7fa13d), color(0xb9b45a), n), color(0x93ad4a), mow.mul(0.4));
  return m;
}

function lightPlane() {
  const parts = [
    new THREE.CapsuleGeometry(0.7, 5, 4, 8).rotateX(Math.PI / 2).translate(0, 1.4, 0),
    new THREE.BoxGeometry(10, 0.18, 1.5).translate(0, 2.2, -0.6),
    new THREE.BoxGeometry(3.4, 0.14, 0.9).translate(0, 1.6, 3.2),
    new THREE.BoxGeometry(0.14, 1.5, 1).translate(0, 2.2, 3.2),
  ].map((g) => { const n = g.toNonIndexed(); n.deleteAttribute('uv'); return n; });
  return mergeGeometries(parts);
}

function buildField(field, shared) {
  const g = new THREE.Group();
  const at = new THREE.Vector2(field.x, field.z);
  g.position.set(at.x, 0, at.y);
  const grass = add(g, new THREE.CircleGeometry(field.radius, 64).rotateX(-Math.PI / 2), shared.grass, 0, 0.1, 0);
  grass.castShadow = false;

  const lamps = [];
  for (const r of field.runways) {
    const geo = new THREE.PlaneGeometry(r.width, r.length).rotateX(-Math.PI / 2);
    // uv in metres plus the strip size in uv1, so one material draws markings for every runway.
    const uvs = geo.attributes.uv;
    const size = new Float32Array(uvs.count * 2);
    for (let i = 0; i < uvs.count; i++) {
      uvs.setXY(i, uvs.getX(i) * r.width, uvs.getY(i) * r.length);
      size.set([r.width, r.length], i * 2);
    }
    geo.setAttribute('uv1', new THREE.BufferAttribute(size, 2));
    const strip = add(g, geo, shared.runway, r.off[0], 0.2, r.off[1]);
    strip.rotation.y = -THREE.MathUtils.degToRad(r.bearing);
    strip.castShadow = false;
    const dir = new THREE.Vector3(Math.sin(THREE.MathUtils.degToRad(r.bearing)), 0, -Math.cos(THREE.MathUtils.degToRad(r.bearing)));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    for (let s = -r.length / 2; s <= r.length / 2; s += 60) {
      for (const k of [-1, 1]) lamps.push(new THREE.Vector3(r.off[0], 0.6, r.off[1]).addScaledVector(dir, s).addScaledVector(side, k * (r.width / 2 + 3)));
    }
  }
  const lampMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1.1, 6, 4), shared.lamp, lamps.length);
  const d = new THREE.Object3D();
  lamps.forEach((p, i) => { d.position.copy(p); d.updateMatrix(); lampMesh.setMatrixAt(i, d.matrix); });
  lampMesh.frustumCulled = false;
  g.add(lampMesh);

  // Apron, terminal, tower and hangars sit to the east of the runways, clear of every strip.
  const k = field.big ? 1 : 0.5;
  const ax = field.radius * 0.5, az = -field.radius * 0.28;
  const apron = add(g, new THREE.PlaneGeometry(900 * k, 620 * k).rotateX(-Math.PI / 2), shared.apron, ax, 0.16, az);
  apron.castShadow = false;
  add(g, new THREE.BoxGeometry(520 * k, 22 * k + 6, 70 * k), shared.glass, ax + 60 * k, (22 * k + 6) / 2, az - 250 * k);
  add(g, new THREE.BoxGeometry(540 * k, 3, 84 * k), shared.white, ax + 60 * k, 22 * k + 7.5, az - 250 * k);
  for (let i = -1; i <= 1; i++) add(g, new THREE.BoxGeometry(30 * k, 12 * k + 4, 190 * k), shared.white, ax + 60 * k + i * 190 * k, (12 * k + 4) / 2, az - 120 * k);
  const towerH = field.big ? 78 : 34;
  add(g, new THREE.CylinderGeometry(4, 5.5, towerH, 10), shared.white, ax - 330 * k, towerH / 2, az - 250 * k);
  add(g, new THREE.CylinderGeometry(9, 6.5, 7, 10), shared.glass, ax - 330 * k, towerH + 3.5, az - 250 * k);
  add(g, new THREE.CylinderGeometry(9.6, 9.6, 1.2, 10), shared.red, ax - 330 * k, towerH + 7.6, az - 250 * k);
  const hangar = new THREE.CylinderGeometry(26, 26, 70, 14, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2);
  for (let i = 0; i < (field.big ? 5 : 4); i++) add(g, hangar, i % 2 ? shared.tin : shared.white, ax - 260 * k + i * 68, 0, az + 240 * k).scale.set(1, 0.7, 1);

  const parked = new THREE.InstancedMesh(shared.plane, shared.white, field.big ? 12 : 9);
  const scale = field.big ? 4.2 : 1.5;
  for (let i = 0; i < parked.count; i++) {
    d.position.set(ax - 300 * k + (i % 6) * 110 * k, 0.2, az + (i < 6 ? 0 : 110 * k));
    d.rotation.y = i < 6 ? 0 : Math.PI;
    d.scale.setScalar(scale);
    d.updateMatrix();
    parked.setMatrixAt(i, d.matrix);
  }
  parked.castShadow = true;
  parked.frustumCulled = false;
  g.add(parked);

  // Windsock by the main strip.
  const sockAt = new THREE.Vector3(field.runways[0].off[0] + field.runways[0].width + 40, 0, field.runways[0].off[1]);
  add(g, new THREE.CylinderGeometry(0.3, 0.3, 12, 5), shared.white, sockAt.x, 6, sockAt.z);
  const sock = add(g, new THREE.ConeGeometry(1.6, 8, 8, 1, true).rotateZ(Math.PI / 2), shared.sock, sockAt.x + 4, 11.5, sockAt.z);
  sock.rotation.y = 0.5;

  const solids = [
    { x: at.x + ax + 60 * k, z: at.y + az - 250 * k, r: 280 * k, h: 22 * k + 12 },
    { x: at.x + ax - 330 * k, z: at.y + az - 250 * k, r: 16, h: towerH + 12 },
    { x: at.x + ax - 120 * k, z: at.y + az + 240 * k, r: 190, h: 24 },
  ];
  return { group: g, x: at.x, z: at.y, solids };
}

export function buildAirports() {
  const group = new THREE.Group();
  group.name = 'airports';
  const sockMat = paint(0xf2702e, { double: true });
  const shared = {
    grass: grassMaterial(),
    runway: runwayMaterial(),
    apron: paint(0x8d8a8c, { rough: 0.95 }),
    glass: paint(0x6f9fb5, { rough: 0.2, metal: 0.5 }),
    white: paint(0xf1efe8),
    tin: paint(0xb9c2c6, { rough: 0.5, metal: 0.3 }),
    red: paint(0xd6402e),
    sock: sockMat,
    lamp: paint(0xfff2c8, { emissive: 0xffe2a0, glow: 5 }),
    plane: lightPlane(),
  };
  shared.apron.polygonOffset = true;
  shared.apron.polygonOffsetFactor = -3;
  shared.apron.polygonOffsetUnits = -3;

  const fields = FIELDS.map((f) => {
    const built = buildField(f, shared);
    group.add(built.group);
    return { name: f.name, code: f.code, radius: f.radius, x: built.x, z: built.z, solids: built.solids };
  });
  const solids = fields.flatMap((f) => f.solids);
  const heightAt = (x, z) => {
    for (const s of solids) if (Math.hypot(x - s.x, z - s.z) < s.r) return s.h;
    return 0;
  };
  return { group, fields, heightAt };
}
