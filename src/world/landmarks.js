import * as THREE from 'three/webgpu';
import { color, hash, floor, positionWorld, positionLocal, mix, sin, vec3, mx_noise_float } from 'three/tsl';
import { ll } from '../config.js';
import { paint, add } from './paint.js';

const GRID = THREE.MathUtils.degToRad(20); // the Hoddle grid sits 20 degrees off east-west

const P = {
  flinders: ll(-37.81805, 144.96735),
  flindersClock: ll(-37.81838, 144.96478),
  spire: ll(-37.82135, 144.96835),
  mcg: ll(-37.81995, 144.98345),
  marvel: ll(-37.81645, 144.94755),
  aami: ll(-37.8251, 144.98395),
  exhibition: ll(-37.80465, 144.97145),
  shrine: ll(-37.83055, 144.97345),
  star: ll(-37.8118, 144.9375),
  bolte: ll(-37.8198, 144.932),
  luna: ll(-37.8677, 144.9767),
  pierStart: ll(-37.8634, 144.9722),
  pierEnd: ll(-37.8644, 144.9655),
  stPauls: ll(-37.817, 144.9677),
  stPats: ll(-37.8101, 144.9764),
  eureka: ll(-37.82135, 144.96455),
  lake: ll(-37.8462, 144.9712),
};

function at(group, p, rotY = 0) {
  group.position.set(p.x, 0, p.y);
  group.rotation.y = rotY;
  return group;
}

function flindersStation() {
  const g = new THREE.Group();
  const mustard = paint(0xe0a43a);
  const maroon = paint(0x8f3a2e);
  const copper = paint(0x6fae98, { rough: 0.5, metal: 0.3 });
  const roof = paint(0x6d7a78);
  const length = P.flinders.distanceTo(P.flindersClock);
  // Local +X runs west along Flinders Street from the dome corner.
  add(g, new THREE.BoxGeometry(length, 17, 24), mustard, length / 2, 8.5, 6);
  add(g, new THREE.BoxGeometry(length + 2, 1.6, 25.5), maroon, length / 2, 5, 6);
  add(g, new THREE.BoxGeometry(length + 2, 1.4, 25.5), maroon, length / 2, 17.4, 6);
  add(g, new THREE.BoxGeometry(length - 20, 5, 16), roof, length / 2, 20, 6);
  for (let i = 0; i < 5; i++) {
    const x = 34 + i * ((length - 70) / 4);
    add(g, new THREE.BoxGeometry(14, 24, 26), mustard, x, 12, 6);
    add(g, new THREE.CylinderGeometry(7, 7, 26.4, 16, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).rotateY(Math.PI / 2), copper, x, 24, 6);
  }
  // Corner entrance and dome.
  add(g, new THREE.BoxGeometry(30, 26, 30), mustard, 2, 13, 4);
  add(g, new THREE.CylinderGeometry(12, 13, 9, 8), maroon, 2, 30.5, 4);
  add(g, new THREE.SphereGeometry(12, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), copper, 2, 35, 4);
  add(g, new THREE.CylinderGeometry(2, 2.6, 5, 8), mustard, 2, 49, 4);
  add(g, new THREE.ConeGeometry(2.4, 5, 8), copper, 2, 54, 4);
  add(g, new THREE.CylinderGeometry(7, 7, 2, 20, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(-Math.PI / 4), paint(0x3a2a28), -9, 9, -7);
  // Clock tower at the Elizabeth Street end.
  add(g, new THREE.BoxGeometry(13, 46, 13), mustard, length, 23, 4);
  add(g, new THREE.BoxGeometry(14.5, 2, 14.5), maroon, length, 34, 4);
  add(g, new THREE.CylinderGeometry(3.2, 3.2, 0.8, 20).rotateX(Math.PI / 2), paint(0xf6f0dc, { emissive: 0xffe0a0, glow: 0.5 }), length, 39, -2.7);
  add(g, new THREE.SphereGeometry(6.5, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), copper, length, 46, 4);
  add(g, new THREE.ConeGeometry(1.6, 7, 8), copper, length, 55, 4);
  const dir = P.flindersClock.clone().sub(P.flinders);
  return at(g, P.flinders, -Math.atan2(dir.y, dir.x));
}

function artsSpire() {
  const g = new THREE.Group();
  const white = paint(0xf8f2e2, { emissive: 0xffd9a0, glow: 0.35, rough: 0.5 });
  const gold = paint(0xf2c14e, { emissive: 0xffb040, glow: 0.5, rough: 0.4, metal: 0.4 });
  const radius = (y) => 1.1 + 34 * Math.exp(-(y - 16) / 13);
  const legs = 14;
  for (const twist of [0.9, -0.9]) {
    for (let i = 0; i < legs; i++) {
      const pts = [];
      for (let y = 16; y <= 104; y += 8) {
        const a = (i / legs) * Math.PI * 2 + twist * ((y - 16) / 88) * 2.2;
        pts.push(new THREE.Vector3(Math.cos(a) * radius(y), y, Math.sin(a) * radius(y)));
      }
      add(g, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 22, 0.42, 5), white);
    }
  }
  for (const y of [22, 30, 42, 58, 78]) add(g, new THREE.TorusGeometry(radius(y), 0.4, 5, 28).rotateX(Math.PI / 2), gold, 0, y, 0);
  add(g, new THREE.CylinderGeometry(0.35, 1.3, 62, 8), white, 0, 131, 0);
  add(g, new THREE.SphereGeometry(1.4, 10, 8), gold, 0, 162, 0);
  return at(g, P.spire);
}

function crowdMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, side: THREE.DoubleSide });
  const cell = floor(positionWorld.mul(0.55));
  const r = hash(cell.x.mul(13.1).add(cell.y.mul(71.7)).add(cell.z.mul(37.3)));
  const seat = mix(vec3(0.16, 0.34, 0.3), vec3(0.75, 0.74, 0.7), r.mul(r));
  const shirt = mix(vec3(0.85, 0.2, 0.18), vec3(0.95, 0.8, 0.25), hash(cell.x.add(cell.z.mul(3.7))));
  m.colorNode = mix(seat, shirt, r.greaterThan(0.72).select(1, 0));
  return m;
}

function pitchMaterial(stripe = 9) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.95 });
  const band = sin(positionLocal.x.mul(Math.PI / stripe)).greaterThan(0).select(1, 0);
  m.colorNode = mix(color(0x3f9a3a), color(0x58b548), band).mul(mix(0.92, 1.06, mx_noise_float(positionWorld.mul(0.2)).mul(0.5).add(0.5)));
  return m;
}

function lathe(profile, rx, rz, material) {
  const geo = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 56);
  geo.scale(rx, 1, rz);
  geo.computeVertexNormals();
  return [geo, material];
}

function stadium({ rx, rz, field, height, roofInner, towers }) {
  const g = new THREE.Group();
  const h = height;
  add(g, ...lathe([[field, 1.5], [0.8, h * 0.6], [0.9, h * 0.95]], rx, rz, crowdMaterial()));
  add(g, ...lathe([[0.9, h * 0.95], [1, h], [1, 0]], rx, rz, paint(0xcfd3d6, { double: true })));
  add(g, ...lathe([[1.01, h + 1], [roofInner, h + 7], [roofInner, h + 5.5], [1.01, h - 0.5]], rx, rz, paint(0xf7f5ef, { double: true, rough: 0.6 })));
  const oval = add(g, new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), pitchMaterial(), 0, 1.2, 0);
  oval.scale.set(rx * field, 1, rz * field);
  oval.castShadow = false;
  if (towers) {
    const steel = paint(0xd9dde0, { rough: 0.5, metal: 0.3 });
    const lamp = paint(0xfff6da, { emissive: 0xffe9b0, glow: 3 });
    for (let i = 0; i < towers; i++) {
      const a = (i / towers) * Math.PI * 2 + 0.4;
      const x = Math.cos(a) * rx * 1.02, z = Math.sin(a) * rz * 1.02;
      const pole = add(g, new THREE.CylinderGeometry(1.1, 2.2, 78, 6), steel, x, 39, z);
      pole.rotation.z = Math.cos(a) * -0.07;
      pole.rotation.x = Math.sin(a) * 0.07;
      const head = add(g, new THREE.BoxGeometry(17, 11, 1.6), lamp, x * 0.985, 80, z * 0.985);
      head.lookAt(0, -40, 0);
      head.position.set(x * 0.985, 80, z * 0.985);
    }
  }
  return g;
}

function aamiPark() {
  const g = new THREE.Group();
  const shell = paint(0xf4f6f4, { flat: true, rough: 0.45 });
  const pitch = add(g, new THREE.PlaneGeometry(126, 80).rotateX(-Math.PI / 2), pitchMaterial(7), 0, 1, 0);
  pitch.castShadow = false;
  add(g, ...lathe([[0.62, 1.5], [0.86, 16], [1, 17], [1, 0]], 104, 78, crowdMaterial()));
  const dome = new THREE.IcosahedronGeometry(25, 1);
  const spots = [];
  for (let i = -2; i <= 2; i++) spots.push([i * 38, -58], [i * 38, 58]);
  for (let i = -1; i <= 1; i++) spots.push([-98, i * 34], [98, i * 34]);
  for (const [x, z] of spots) add(g, dome, shell, x, 8, z).scale.set(1, 0.72, 1);
  return at(g, P.aami, THREE.MathUtils.degToRad(-22));
}

function exhibitionDome() {
  const g = new THREE.Group();
  const cream = paint(0xeddcba);
  const lead = paint(0x8f9f94, { rough: 0.6 });
  add(g, new THREE.BoxGeometry(34, 34, 34), cream, 0, 17, 0);
  add(g, new THREE.CylinderGeometry(14, 15, 12, 8), cream, 0, 40, 0);
  const dome = add(g, new THREE.SphereGeometry(14.5, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), lead, 0, 46, 0);
  dome.scale.y = 1.25;
  add(g, new THREE.CylinderGeometry(2.6, 3, 6, 8), cream, 0, 67, 0);
  add(g, new THREE.ConeGeometry(2.8, 5, 8), lead, 0, 72.5, 0);
  for (const [x, z] of [[-17, -17], [17, -17], [-17, 17], [17, 17]]) {
    add(g, new THREE.BoxGeometry(7, 40, 7), cream, x, 20, z);
    add(g, new THREE.ConeGeometry(4.4, 6, 4).rotateY(Math.PI / 4), lead, x, 43, z);
  }
  return at(g, P.exhibition, GRID * 0.3);
}

function shrine() {
  const g = new THREE.Group();
  const granite = paint(0xb9b4ab);
  const pale = paint(0xd2cdc2);
  add(g, new THREE.BoxGeometry(74, 5, 74), pale, 0, 2.5, 0);
  add(g, new THREE.BoxGeometry(54, 4, 54), granite, 0, 7, 0);
  add(g, new THREE.BoxGeometry(34, 20, 34), granite, 0, 19, 0);
  for (const side of [-1, 1]) {
    for (let i = -3; i <= 3; i++) add(g, new THREE.CylinderGeometry(1.2, 1.3, 15, 10), pale, i * 3.6, 16.5, side * 21);
    add(g, new THREE.BoxGeometry(30, 3, 9), granite, 0, 25.5, side * 19.5);
    add(g, new THREE.CylinderGeometry(15.5, 15.5, 8.6, 3, 1).rotateZ(Math.PI / 2).rotateY(Math.PI / 2).scale(1, 0.38, 1), pale, 0, 28.5, side * 19.5);
  }
  for (let s = 0; s < 7; s++) {
    const w = 34 - s * 4.4;
    add(g, new THREE.BoxGeometry(w, 2.2, w), s % 2 ? pale : granite, 0, 30.1 + s * 2.2, 0);
  }
  add(g, new THREE.BoxGeometry(4, 3, 4), pale, 0, 46.6, 0);
  return at(g, P.shrine, THREE.MathUtils.degToRad(-8));
}

function melbourneStar() {
  const g = new THREE.Group();
  const white = paint(0xf3f4f2, { rough: 0.5 });
  const cabin = paint(0x9fd0e6, { rough: 0.25, metal: 0.4 });
  const R = 56, hubY = 64;
  const wheel = new THREE.Group();
  wheel.position.y = hubY;
  add(wheel, new THREE.TorusGeometry(R, 1.1, 6, 72), white);
  add(wheel, new THREE.TorusGeometry(R - 5, 0.6, 5, 72), white);
  add(wheel, new THREE.CylinderGeometry(4, 4, 7, 14).rotateX(Math.PI / 2), white);
  const pt = (i) => new THREE.Vector3(Math.cos((i / 7) * Math.PI * 2) * R, Math.sin((i / 7) * Math.PI * 2) * R, 0);
  const beam = (a, b, r) => {
    const len = a.distanceTo(b);
    const m = add(wheel, new THREE.CylinderGeometry(r, r, len, 5), white);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  };
  for (let i = 0; i < 7; i++) {
    beam(pt(i), pt(i + 3), 0.55);
    beam(new THREE.Vector3(), pt(i), 0.45);
  }
  const pod = new THREE.CapsuleGeometry(2.3, 4.5, 4, 10).rotateZ(Math.PI / 2);
  for (let i = 0; i < 21; i++) {
    const a = (i / 21) * Math.PI * 2;
    add(wheel, pod, cabin, Math.cos(a) * (R + 3.4), Math.sin(a) * (R + 3.4), 0).rotation.z = a + Math.PI / 2;
  }
  g.add(wheel);
  for (const side of [-1, 1]) {
    for (const lean of [-1, 1]) {
      const a = new THREE.Vector3(0, hubY, side * 5), b = new THREE.Vector3(lean * 26, 0, side * 16);
      const leg = add(g, new THREE.CylinderGeometry(1.3, 1.6, a.distanceTo(b), 6), white);
      leg.position.copy(a).add(b).multiplyScalar(0.5);
      leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), a.clone().sub(b).normalize());
    }
  }
  at(g, P.star, THREE.MathUtils.degToRad(70));
  g.userData.update = (dt) => { wheel.rotation.z += dt * 0.12; };
  return g;
}

function bolteBridge() {
  const g = new THREE.Group();
  const concrete = paint(0xc9c6c0);
  const silver = paint(0xdfe6ea, { rough: 0.35, metal: 0.5 });
  const deckY = 30, span = 520;
  add(g, new THREE.BoxGeometry(34, 3.4, span), concrete, 0, deckY, 0);
  add(g, new THREE.BoxGeometry(30, 0.5, span), paint(0x4a464c), 0, deckY + 1.8, 0);
  for (const z of [-span / 2, -span / 6, span / 6, span / 2]) add(g, new THREE.BoxGeometry(22, deckY, 7), concrete, 0, deckY / 2, z);
  for (const end of [-1, 1]) {
    const ramp = add(g, new THREE.BoxGeometry(34, 3.4, 330), concrete, 0, deckY / 2, end * (span / 2 + 162));
    ramp.rotation.x = end * Math.atan2(deckY, 325);
  }
  for (const side of [-1, 1]) {
    const tower = add(g, new THREE.BoxGeometry(5, 142, 7), silver, side * 21, 71, 0);
    tower.castShadow = true;
  }
  return at(g, P.bolte, THREE.MathUtils.degToRad(-7));
}

function lunaPark() {
  const g = new THREE.Group();
  const white = paint(0xf6f1e6);
  const red = paint(0xd6402e);
  const blue = paint(0x2f6fb0);
  const sunny = paint(0xf7c531, { emissive: 0xffb020, glow: 0.25 });
  // Mr Moon gate, facing the foreshore.
  add(g, new THREE.CylinderGeometry(11, 11, 3, 28).rotateX(Math.PI / 2), sunny, 0, 13, 0);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const ray = add(g, new THREE.ConeGeometry(1.7, 6, 4), sunny, Math.cos(a) * 13.4, 13 + Math.sin(a) * 13.4, 0);
    ray.rotation.z = a - Math.PI / 2;
  }
  add(g, new THREE.CylinderGeometry(5, 5, 3.6, 18, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(Math.PI / 2).rotateZ(-Math.PI / 2), paint(0x40201c), 0, 4, 0.2);
  for (const ex of [-4, 4]) add(g, new THREE.SphereGeometry(1.5, 10, 8), blue, ex, 17, 1.6);
  for (const side of [-1, 1]) {
    add(g, new THREE.BoxGeometry(7, 26, 7), white, side * 17, 13, 0);
    add(g, new THREE.BoxGeometry(7.6, 1.4, 7.6), red, side * 17, 20, 0);
    add(g, new THREE.ConeGeometry(5.6, 10, 8), side > 0 ? red : blue, side * 17, 31, 0);
  }
  // Scenic railway looping the park.
  const pts = [];
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * 105 + 70, 11 + Math.sin(a * 5) * 4.5 + Math.sin(a * 2 + 1) * 3, Math.sin(a) * 62 - 55));
  }
  const curve = new THREE.CatmullRomCurve3(pts, true);
  add(g, new THREE.TubeGeometry(curve, 220, 1.1, 5, true), white);
  const post = new THREE.CylinderGeometry(0.45, 0.45, 1, 4);
  for (let i = 0; i < 90; i++) {
    const p = curve.getPointAt(i / 90);
    add(g, post, white, p.x, p.y / 2, p.z).scale.y = p.y;
  }
  const tent = add(g, new THREE.ConeGeometry(18, 12, 12), red, 70, 14, -55);
  tent.castShadow = true;
  add(g, new THREE.CylinderGeometry(18, 18, 8, 12), white, 70, 4, -55);
  return at(g, P.luna, THREE.MathUtils.degToRad(120));
}

function stKildaPier() {
  const g = new THREE.Group();
  const timber = paint(0xb08a62);
  const dir = P.pierEnd.clone().sub(P.pierStart);
  const len = dir.length();
  add(g, new THREE.BoxGeometry(len, 0.8, 7), timber, len / 2, 3.2, 0);
  const pile = new THREE.CylinderGeometry(0.45, 0.45, 4, 5);
  for (let x = 6; x < len; x += 14) for (const z of [-3, 3]) add(g, pile, timber, x, 1.2, z);
  add(g, new THREE.BoxGeometry(22, 0.8, 18), timber, len + 6, 3.2, 0);
  add(g, new THREE.BoxGeometry(13, 6, 10), paint(0xf5efe0), len + 7, 6.6, 0);
  add(g, new THREE.ConeGeometry(10.5, 5, 4).rotateY(Math.PI / 4), paint(0xc8452f), len + 7, 12.1, 0).scale.set(1, 1, 0.8);
  add(g, new THREE.CylinderGeometry(1.6, 1.6, 4, 8), paint(0xf5efe0), len + 7, 16, 0);
  add(g, new THREE.ConeGeometry(2.2, 3, 8), paint(0xc8452f), len + 7, 19.5, 0);
  return at(g, P.pierStart, -Math.atan2(dir.y, dir.x));
}

function cathedral(p, stone, spires, rotY) {
  const g = new THREE.Group();
  const mat = paint(stone);
  const roof = paint(0x6b7078);
  for (const [x, z, h, w] of spires) {
    add(g, new THREE.BoxGeometry(w, h * 0.55, w), mat, x, h * 0.275, z);
    add(g, new THREE.ConeGeometry(w * 0.72, h * 0.45, 8), stone === 0x6f7480 ? roof : mat, x, h * 0.775, z);
  }
  add(g, new THREE.BoxGeometry(70, 24, 20), mat, 0, 12, 0);
  add(g, new THREE.CylinderGeometry(10, 10, 70, 3, 1).rotateZ(Math.PI / 2).scale(1, 0.75, 1.16), roof, 0, 28, 0);
  return at(g, p, rotY);
}

export function buildLandmarks() {
  const group = new THREE.Group();
  group.name = 'landmarks';
  const mcg = at(stadium({ rx: 150, rz: 134, field: 0.57, height: 40, roofInner: 0.86, towers: 6 }), P.mcg, THREE.MathUtils.degToRad(80));
  const marvel = at(stadium({ rx: 128, rz: 108, field: 0.6, height: 34, roofInner: 0.46, towers: 0 }), P.marvel, THREE.MathUtils.degToRad(75));
  const star = melbourneStar();
  group.add(
    flindersStation(), artsSpire(), mcg, marvel, aamiPark(), exhibitionDome(), shrine(), star, bolteBridge(), lunaPark(), stKildaPier(),
    cathedral(P.stPauls, 0xcda66c, [[0, 0, 96, 13], [-30, -6, 74, 9], [-30, 6, 74, 9]], GRID + Math.PI / 2),
    cathedral(P.stPats, 0x6f7480, [[10, 0, 103, 13], [-32, -7, 62, 9], [-32, 7, 62, 9]], GRID)
  );

  const flindersMid = P.flinders.clone().lerp(P.flindersClock, 0.5);
  const exclusions = [
    ...[0, 0.25, 0.5, 0.75, 1].map((k) => ({ ...P.flinders.clone().lerp(P.flindersClock, k), r: 34 })),
    { ...P.mcg, r: 165 }, { ...P.marvel, r: 140 }, { ...P.aami, r: 110 }, { ...P.shrine, r: 45 },
    { ...P.star, r: 40 }, { ...P.luna, r: 20 }, { ...P.exhibition, r: 14 }, { ...P.bolte, r: 90 },
  ];
  // Solid volumes the plane should be nudged over: [point, radius, height].
  const solids = [
    [P.flinders, 22, 58], [flindersMid, 60, 28], [P.flindersClock, 12, 60], [P.spire, 14, 165], [P.mcg, 160, 52], [P.marvel, 135, 46],
    [P.aami, 105, 30], [P.exhibition, 24, 76], [P.shrine, 36, 50], [P.star, 60, 124], [P.stPauls, 30, 98], [P.stPats, 34, 104],
  ];
  const postcards = [
    { name: 'Flinders Street Station', at: P.flinders, y: 92, hint: 'Meet me under the clocks' },
    { name: 'Arts Centre Spire', at: P.spire.clone().add(new THREE.Vector2(70, 0)), y: 130, hint: 'The ballerina’s tutu' },
    { name: 'Eureka Tower', at: P.eureka.clone().add(new THREE.Vector2(0, -90)), y: 250, hint: 'Gold crown of Southbank' },
    { name: 'The MCG', at: P.mcg, y: 95, hint: 'The ’G on a quiet evening' },
    { name: 'Docklands Stadium', at: P.marvel, y: 85, hint: 'Roof closed, as usual' },
    { name: 'Royal Exhibition Building', at: P.exhibition.clone().add(new THREE.Vector2(0, 70)), y: 90, hint: 'Carlton Gardens, 1880' },
    { name: 'Shrine of Remembrance', at: P.shrine.clone().add(new THREE.Vector2(0, -80)), y: 62, hint: 'Lest we forget' },
    { name: 'Melbourne Star', at: P.star.clone().add(new THREE.Vector2(0, 110)), y: 110, hint: 'Docklands’ big wheel' },
    { name: 'Bolte Bridge', at: P.bolte, y: 80, hint: 'Thread the twin towers' },
    { name: 'Luna Park', at: P.luna.clone().add(new THREE.Vector2(-40, -40)), y: 55, hint: 'Just for fun since 1912' },
    { name: 'St Kilda Pier', at: P.pierEnd, y: 34, hint: 'Penguins live at the end' },
    { name: 'Albert Park Lake', at: P.lake, y: 26, hint: 'Skim the black swans' },
  ];
  return { group, exclusions, solids, postcards, update: (dt) => star.userData.update(dt) };
}
