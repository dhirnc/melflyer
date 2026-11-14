import * as THREE from 'three/webgpu';
import { ll } from '../config.js';
import { paint, add } from './paint.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// Kite surfers tacking back and forth off St Kilda West beach.
function kiteSurfers(isSea) {
  const group = new THREE.Group();
  const rand = rng(11);
  const home = ll(-37.8612, 144.9655);
  const kiteGeo = new THREE.TorusGeometry(5, 0.9, 5, 14, Math.PI).scale(1, 1, 2.6);
  const lineGeo = new THREE.CylinderGeometry(0.07, 0.07, 1, 4);
  const riderGeo = new THREE.CapsuleGeometry(0.42, 1.1, 3, 6).translate(0, 1.2, 0);
  const boardGeo = new THREE.BoxGeometry(0.6, 0.12, 2.2).translate(0, 0.15, 0);
  const wakeGeo = new THREE.ConeGeometry(1.4, 9, 6).rotateX(Math.PI / 2).scale(1, 0.12, 1).translate(0, 0.1, 5);
  const suit = paint(0x1f2a36);
  const line = paint(0xf4f1e6);
  const foam = paint(0xf8fbfa, { emissive: 0xffffff, glow: 0.3 });
  const colours = [0xff3d6e, 0xffc21a, 0x25c4d8, 0x8adf3a, 0xff7a1a, 0xb04be0];

  const riders = [];
  let guard = 0;
  while (riders.length < 9 && guard++ < 400) {
    const cx = home.x - 520 + rand() * 640, cz = home.y - 420 + rand() * 900;
    const heading = THREE.MathUtils.degToRad(140 + (rand() - 0.5) * 50); // roughly along the shore
    const reach = 130 + rand() * 150;
    const dx = Math.sin(heading), dz = -Math.cos(heading);
    if (!isSea(cx, cz) || !isSea(cx + dx * reach * 1.2, cz + dz * reach * 1.2) || !isSea(cx - dx * reach * 1.2, cz - dz * reach * 1.2)) continue;
    const g = new THREE.Group();
    const body = new THREE.Group();
    add(body, riderGeo, suit).rotation.x = -0.35;
    add(body, boardGeo, paint(colours[(riders.length + 2) % colours.length]));
    add(body, wakeGeo, foam).castShadow = false;
    body.scale.setScalar(2.2);
    const kite = add(g, kiteGeo, paint(colours[riders.length % colours.length], { double: true, emissive: colours[riders.length % colours.length], glow: 0.2 }));
    const string = add(g, lineGeo, line);
    string.castShadow = false;
    g.add(body);
    group.add(g);
    riders.push({ body, kite, string, cx, cz, dx, dz, reach, rate: (10 + rand() * 5) / reach, phase: rand() * 6.28, heading });
  }

  const hand = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), span = new THREE.Vector3();
  const update = (t) => {
    for (const r of riders) {
      const s = Math.sin(t * r.rate + r.phase);
      const going = Math.cos(t * r.rate + r.phase) >= 0 ? 1 : -1;
      const x = r.cx + r.dx * r.reach * s, z = r.cz + r.dz * r.reach * s;
      r.body.position.set(x, Math.abs(Math.sin(t * 2.2 + r.phase)) * 0.35, z);
      r.body.rotation.y = -r.heading + (going > 0 ? 0 : Math.PI);
      // The kite flies a lazy figure of eight downwind of the rider.
      const sway = Math.sin(t * 0.9 + r.phase * 2);
      r.kite.position.set(x + 16 + sway * 9, 30 + Math.sin(t * 1.8 + r.phase * 2) * 5, z - 13 + sway * 6);
      r.kite.rotation.set(0.5, r.phase, sway * 0.5);
      hand.set(x, 3.4, z);
      span.copy(r.kite.position).sub(hand);
      r.string.position.copy(hand).addScaledVector(span, 0.5);
      r.string.scale.y = span.length();
      r.string.quaternion.setFromUnitVectors(up, span.normalize());
    }
  };
  return { group, update, count: riders.length };
}

export function buildCoast(isSea) {
  const kites = kiteSurfers(isSea);
  kites.group.name = 'coast';
  return { group: kites.group, update: kites.update, kiteCount: kites.count };
}
