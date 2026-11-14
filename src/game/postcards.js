import * as THREE from 'three/webgpu';
import { color } from 'three/tsl';

const REACH = 42;

// Golden hoops over the landmarks. Fly through one to collect its postcard.
export function buildPostcards(list) {
  const group = new THREE.Group();
  group.name = 'postcards';
  const gold = new THREE.MeshStandardNodeMaterial({ roughness: 0.3, metalness: 0.6 });
  gold.colorNode = color(0xffc23a);
  gold.emissiveNode = color(0xffb020).mul(2.4);
  const beam = new THREE.MeshBasicNodeMaterial();
  beam.colorNode = color(0xffe08a).mul(6);
  const hoop = new THREE.TorusGeometry(26, 1.7, 8, 40);
  const gem = new THREE.OctahedronGeometry(5);
  const shaft = new THREE.CylinderGeometry(0.4, 3.2, 1, 6);

  const items = list.map((card) => {
    const g = new THREE.Group();
    g.position.set(card.at.x, card.y, card.at.y);
    const ring = new THREE.Mesh(hoop, gold);
    const star = new THREE.Mesh(gem, gold);
    const light = new THREE.Mesh(shaft, beam);
    light.scale.y = 380;
    light.position.y = 225;
    g.add(light);
    // Landing cards have no hoop: the beacon marks the airfield and a full stop there collects it.
    if (!card.land) g.add(ring, star);
    group.add(g);
    return { ...card, g, ring, star, collected: false, pop: 0 };
  });

  const update = (dt, t, planePos, parkedAt, onCollect) => {
    for (const it of items) {
      if (it.collected) {
        if (it.pop > 0) {
          it.pop = Math.max(0, it.pop - dt * 1.6);
          it.g.scale.setScalar(it.pop * (2 - it.pop) * 1.4 + 0.001);
          if (it.pop === 0) it.g.visible = false;
        }
        continue;
      }
      it.ring.rotation.y = t * 0.7;
      it.star.rotation.set(t, t * 1.3, 0);
      it.star.position.y = Math.sin(t * 2) * 2;
      if (it.land ? parkedAt === it.land : it.g.position.distanceTo(planePos) < REACH) {
        it.collected = true;
        it.pop = 1;
        onCollect(it, items.filter((i) => i.collected).length, items.length);
      }
    }
  };

  const nearest = (planePos) => {
    let best = null, bestD = Infinity;
    for (const it of items) {
      if (it.collected) continue;
      const d = it.g.position.distanceTo(planePos);
      if (d < bestD) { bestD = d; best = it; }
    }
    return best && { item: best, distance: bestD };
  };
  return { group, items, update, nearest };
}
