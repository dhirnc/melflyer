import * as THREE from 'three/webgpu';
import { color, mix, positionLocal, step, abs, smoothstep } from 'three/tsl';

const RED = 0xd9412e, CREAM = 0xf6ecd2, NAVY = 0x1f3550;

function flat(hex, o = {}) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: o.rough ?? 0.42, metalness: o.metal ?? 0.05 });
  m.colorNode = color(hex);
  if (o.emissive) m.emissiveNode = color(o.emissive).mul(o.glow ?? 1);
  return m;
}

function part(parent, geometry, material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function strut(parent, material, a, b, r = 0.055) {
  const m = part(parent, new THREE.CylinderGeometry(r, r, a.distanceTo(b), 6), material);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

// A chunky little floatplane. Nose points down -Z, one unit is a metre before the group scale.
export function buildPlane() {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  body.scale.setScalar(1.75);

  const red = flat(RED);
  const cream = flat(CREAM);
  const dark = flat(0x2b2623, { rough: 0.7 });
  const glass = flat(NAVY, { rough: 0.08, metal: 0.75 });

  const hullMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.4, metalness: 0.05 });
  const stripe = smoothstep(0.02, 0.06, positionLocal.y).mul(smoothstep(0.34, 0.3, positionLocal.y));
  hullMat.colorNode = mix(color(RED), color(CREAM), stripe);
  const profile = [[0.04, -3.7], [0.24, -3.1], [0.46, -2.0], [0.7, -0.6], [0.8, 0.5], [0.78, 1.5], [0.68, 2.2], [0.6, 2.6]];
  const hull = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 20).rotateX(-Math.PI / 2);
  part(body, hull, hullMat).scale.set(0.92, 1.08, 1);

  part(body, new THREE.CylinderGeometry(0.64, 0.6, 0.75, 20).rotateX(Math.PI / 2), cream, 0, 0, -2.9);
  part(body, new THREE.CylinderGeometry(0.5, 0.5, 0.1, 20).rotateX(Math.PI / 2), dark, 0, 0, -3.29);
  const cabin = part(body, new THREE.SphereGeometry(1, 18, 12), glass, 0, 0.56, -0.7);
  cabin.scale.set(0.6, 0.52, 1.25);

  const wingMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.45 });
  wingMat.colorNode = mix(color(CREAM), color(RED), step(4.2, abs(positionLocal.x)));
  const wingGeo = new THREE.CapsuleGeometry(0.85, 9.2, 6, 14).rotateZ(Math.PI / 2).scale(1, 0.13, 1);
  part(body, wingGeo, wingMat, 0, 1.22, -0.5);
  part(body, new THREE.BoxGeometry(1.0, 0.5, 1.3), red, 0, 0.98, -0.5);

  const tailGeo = new THREE.CapsuleGeometry(0.5, 2.5, 5, 10).rotateZ(Math.PI / 2).scale(1, 0.12, 1);
  part(body, tailGeo, cream, 0, 0.22, 3.25);
  const fin = part(body, new THREE.CapsuleGeometry(0.5, 0.75, 5, 10).scale(0.1, 1, 1), red, 0, 0.92, 3.3);
  fin.rotation.x = -0.32;

  for (const s of [-1, 1]) {
    strut(body, cream, new THREE.Vector3(s * 0.62, -0.25, -0.9), new THREE.Vector3(s * 2.7, 1.15, -0.6));
    strut(body, cream, new THREE.Vector3(s * 0.62, -0.25, 0.1), new THREE.Vector3(s * 2.7, 1.15, -0.3));
    const floatGeo = new THREE.CapsuleGeometry(0.33, 4.3, 5, 10).rotateX(Math.PI / 2);
    part(body, floatGeo, cream, s * 1.25, -1.5, -0.4).scale.set(1, 0.9, 1);
    part(body, new THREE.BoxGeometry(0.5, 0.12, 3.6), red, s * 1.25, -1.24, -0.4);
    strut(body, dark, new THREE.Vector3(s * 0.55, -0.55, -1.2), new THREE.Vector3(s * 1.25, -1.3, -1.4), 0.05);
    strut(body, dark, new THREE.Vector3(s * 0.55, -0.55, 0.6), new THREE.Vector3(s * 1.25, -1.3, 0.8), 0.05);
    part(body, new THREE.SphereGeometry(0.11, 8, 6), flat(s < 0 ? 0xff3020 : 0x30ff60, { emissive: s < 0 ? 0xff3020 : 0x30ff60, glow: 4 }), s * 5.45, 1.22, -0.5);
  }

  const prop = new THREE.Group();
  prop.position.set(0, 0, -3.42);
  body.add(prop);
  part(prop, new THREE.ConeGeometry(0.3, 0.6, 14).rotateX(-Math.PI / 2), red, 0, 0, -0.12);
  for (let i = 0; i < 3; i++) {
    const blade = part(prop, new THREE.BoxGeometry(0.2, 1.55, 0.05).translate(0, 0.78, 0), dark);
    blade.rotation.z = (i / 3) * Math.PI * 2;
    blade.rotation.y = 0.25;
  }

  const hinge = (geometry, x, y, z) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    part(g, geometry, red);
    body.add(g);
    return g;
  };
  const aileronGeo = new THREE.BoxGeometry(2.3, 0.07, 0.42).translate(0, 0, 0.21);
  const aileronL = hinge(aileronGeo, -3.5, 1.22, 0.32);
  const aileronR = hinge(aileronGeo, 3.5, 1.22, 0.32);
  const elevator = hinge(new THREE.BoxGeometry(3.2, 0.06, 0.4).translate(0, 0, 0.2), 0, 0.22, 3.72);
  const rudder = hinge(new THREE.BoxGeometry(0.07, 1.0, 0.42).translate(0, 0, 0.21), 0, 1.02, 3.92);

  let spin = 0;
  const animate = (dt, input, speedK) => {
    spin += dt * (16 + speedK * 22);
    prop.rotation.z = spin;
    const k = 1 - Math.exp(-dt * 10);
    aileronL.rotation.x += (input.roll * 0.45 - aileronL.rotation.x) * k;
    aileronR.rotation.x += (-input.roll * 0.45 - aileronR.rotation.x) * k;
    elevator.rotation.x += (-input.pitch * 0.5 - elevator.rotation.x) * k;
    rudder.rotation.y += (-input.roll * 0.4 - rudder.rotation.y) * k;
  };
  return { root, animate };
}
