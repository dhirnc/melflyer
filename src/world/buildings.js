import * as THREE from 'three/webgpu';
import {
  Fn, attribute, uv, vec2, vec3, float, mix, step, fract, floor, hash, smoothstep, positionWorld, cameraPosition, length, mx_noise_float,
} from 'three/tsl';

const TILE = 800;
const CELL = 8;
const WALL = 0, GLASS = 1, ROOF = 2, PITCHED = 3, TRIM = 4;

const hex = (list) => list.map((h) => new THREE.Color(h));
const PALETTE = {
  glass: hex([0x3f86ad, 0x2d5f91, 0x62a9bd, 0x94714a, 0x34476a, 0xa6cbd4, 0x4f8f8a, 0x6d7fa8]),
  house: hex([0xf2e3c2, 0xb9573a, 0xdcc49f, 0xf5efe4, 0xa9c6d2, 0xbccaa2, 0xeab8a4, 0xc9744f, 0xe9d28f]),
  commercial: hex([0xdccbb0, 0xcbb89b, 0xb48a66, 0x9ca6b0, 0xe8d9bc, 0xc46d4e, 0xd9b98c]),
  industrial: hex([0xbdb6aa, 0x9fb3bb, 0xc7aa8b, 0xd6d0c4]),
  civic: hex([0xe4c998, 0xd6b582, 0x767b88, 0xead9b5]),
  roofHouse: hex([0xc4532f, 0xb5442a, 0xd2693a, 0x5f6672, 0xb9bdc1, 0xa84a32, 0x7d5a4a]),
  roofFlat: hex([0x938d88, 0xa69f97, 0x74717a, 0xb5aca0, 0x8a94a0]),
};

const MAST = new THREE.Color(0xd9dde0);

const STYLE_BY_NAME = [
  [/Rialto/i, { wall: 0x27466b, type: GLASS }],
  [/Royal Exhibition Building/i, { wall: 0xecdcbc, roof: 0x8d9c90 }],
  [/Parliament|State Library Victoria|Melbourne Town Hall|Treasury/i, { wall: 0xe2c594, roof: 0x8c8f88 }],
  [/Rod Laver|John Cain|Margaret Court/i, { wall: 0xdfe3e2, roof: 0xf4f4ef }],
  [/Exhibition Centre|Convention/i, { wall: 0xc9d2d6, roof: 0xe9ebe8 }],
  [/Crown/i, { wall: 0x3a4a5e, type: GLASS }],
  [/Hamer Hall|National Gallery/i, { wall: 0x7f8590, roof: 0x6f747c }],
  [/Federation Square|ACMI|Ian Potter/i, { wall: 0xc9a56e, roof: 0x9a9ca0 }],
];

class Grow {
  constructor(Type, size) {
    this.a = new Type(size);
    this.n = 0;
  }
  ensure(extra) {
    if (this.n + extra <= this.a.length) return;
    const next = new this.a.constructor(Math.max(this.a.length * 2, this.n + extra));
    next.set(this.a);
    this.a = next;
  }
  done() {
    return this.a.slice(0, this.n);
  }
}

function rnd(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function inRing(x, z, r) {
  let inside = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    if (r[i + 1] > z !== r[j + 1] > z && x < ((r[j] - r[i]) * (z - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]) inside = !inside;
  }
  return inside;
}

function toRing(dm) {
  const n = dm.length - 2; // drop the closing point
  const r = new Float32Array(n);
  for (let i = 0; i < n; i++) r[i] = dm[i] / 10;
  return r;
}

function signedArea(r) {
  let a = 0;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) a += r[j] * r[i + 1] - r[i] * r[j + 1];
  return a / 2;
}

function pick(list, r) {
  return list[Math.min(list.length - 1, Math.floor(r * list.length))];
}

function styleFor(b, cx, cz, top, area, r) {
  const [, kind, name, , , base, colour] = b;
  const style = { wall: null, roof: null, type: WALL, pitched: false };
  const tall = top > 38;
  if (tall && (r() < 0.78 || kind === 6)) style.type = GLASS;
  const wallSet = style.type === GLASS ? PALETTE.glass
    : kind === 0 ? PALETTE.house
    : kind === 3 ? PALETTE.industrial
    : kind === 4 ? PALETTE.civic
    : top < 9 && area < 420 ? PALETTE.house
    : PALETTE.commercial;
  style.wall = pick(wallSet, r()).clone();
  const lowRise = top < 11 && area < 460 && kind !== 3 && kind !== 6 && base === 0;
  style.pitched = lowRise && r() < 0.86;
  style.roof = pick(style.pitched ? PALETTE.roofHouse : PALETTE.roofFlat, r()).clone();
  if (colour) style.wall.setHex(colour);
  if (name) {
    for (const [re, s] of STYLE_BY_NAME) {
      if (!re.test(name)) continue;
      if (s.wall) style.wall.setHex(s.wall);
      if (s.roof) style.roof.setHex(s.roof);
      if (s.type !== undefined) style.type = s.type;
      style.pitched = false;
      break;
    }
  }
  // Eureka's gold crown.
  if (base > 2400 && Math.hypot(cx + 226, cz - 374) < 70) {
    style.wall.setHex(0xf0b030);
    style.type = GLASS;
  }
  const jitter = 0.9 + r() * 0.2;
  style.wall.multiplyScalar(jitter);
  return style;
}

// One material draws every building. Vertex colour carries the paint, its alpha the surface type, and the
// shader lays windows, frames, sills, shopfronts, mullions and rooftop plant over it from wall coordinates.
function cityMaterial() {
  const material = new THREE.MeshStandardNodeMaterial();
  const c = attribute('color', 'vec4');
  const type = c.a.mul(5).round();
  const is = (n) => step(n - 0.5, type).mul(step(type, n + 0.5));
  const isMasonry = is(WALL), isGlass = is(GLASS), isFlat = is(ROOF), isPitched = is(PITCHED), isTrim = is(TRIM);
  const u = uv().x; // metres along the wall
  const v = uv().y; // metres above the ground
  const top = attribute('top', 'float');
  const below = top.sub(v);
  const rect = (f, x0, x1, y0, y1) => step(x0, f.x).mul(step(f.x, x1)).mul(step(y0, f.y)).mul(step(f.y, y1));

  const dist = length(cameraPosition.sub(positionWorld));
  const detail = smoothstep(2100, 320, dist);
  const near = smoothstep(750, 160, dist);
  const brush = mx_noise_float(positionWorld.mul(vec3(0.05, 0.16, 0.05))).mul(0.5).add(0.5);

  // Masonry: a window rhythm with frames and sills, string courses, a cornice, shopfronts under awnings.
  const tall = step(8.5, top);
  const cm = vec2(u.div(mix(float(2.6), float(3.1), tall)), v.div(3.3));
  const fm = fract(cm);
  const idm = floor(cm);
  const randM = hash(idm.x.mul(57.31).add(idm.y.mul(131.7)));
  const storeys = mix(step(0.5, v), step(4.0, v), tall).mul(step(1.3, below));
  const win = rect(fm, 0.26, 0.74, 0.24, 0.78).mul(storeys);
  const frame = rect(fm, 0.2, 0.8, 0.18, 0.84).mul(storeys).sub(win);
  const sill = rect(fm, 0.16, 0.84, 0.11, 0.18).mul(storeys);
  const course = step(fm.y, 0.045).mul(tall);
  const cornice = step(below, 0.9).mul(tall);
  const corniceShade = step(0.9, below).mul(step(below, 1.3)).mul(tall);
  const shopU = u.div(6.2);
  const shopId = floor(shopU);
  const shopR = hash(shopId.mul(3.17));
  const shop = tall.mul(step(0.35, v)).mul(step(v, 3.0)).mul(step(0.07, fract(shopU))).mul(step(fract(shopU), 0.93));
  const awning = tall.mul(step(3.0, v)).mul(step(v, 3.9));
  const litM = step(0.9, randM).mul(win).add(step(0.4, shopR).mul(shop).mul(0.7));

  // Curtain wall: mullions, a spandrel band at every floor, the odd fin, a stone podium and a bright crown.
  const cg = vec2(u.div(1.7), v.div(3.9));
  const fg = fract(cg);
  const idg = floor(cg);
  const randG = hash(idg.x.mul(57.31).add(idg.y.mul(131.7)));
  const mullion = step(fg.x, 0.08);
  const spandrel = step(fg.y, 0.2);
  const fin = step(idg.x.mod(6), 0.5).mul(step(fg.x, 0.24));
  const podium = step(v, 7.5);
  const crown = step(below, 4.5);
  const litG = step(0.955, randG).mul(spandrel.oneMinus()).mul(podium.oneMinus()).mul(0.5);

  // Flat roofs: air handlers and the occasional skylight.
  const fr = fract(positionWorld.xz.div(7.5));
  const idr = floor(positionWorld.xz.div(7.5));
  const randR = hash(idr.x.mul(12.9898).add(idr.y.mul(78.233)));
  const bigRoof = step(11, top);
  const plant = rect(fr, 0.18, 0.72, 0.2, 0.7).mul(step(0.8, randR)).mul(bigRoof);
  const plantTop = rect(fr, 0.26, 0.64, 0.28, 0.62).mul(step(0.8, randR)).mul(bigRoof);
  const skylight = rect(fr, 0.3, 0.7, 0.3, 0.7).mul(step(randR, 0.05)).mul(bigRoof);

  material.colorNode = Fn(() => {
    const paint = mix(0.9, 1.08, brush);
    const grime = mix(0.8, 1.0, smoothstep(0, 14, v));

    const pane = mix(vec3(0.13, 0.19, 0.29), vec3(0.42, 0.56, 0.7), smoothstep(0.24, 0.78, fm.y));
    const drawn = mix(pane, vec3(0.86, 0.8, 0.7), step(0.78, hash(idm.x.mul(7.7).add(idm.y.mul(3.3)))).mul(0.55));
    const awningCol = mix(vec3(0.75, 0.2, 0.16), mix(vec3(0.16, 0.42, 0.3), vec3(0.93, 0.86, 0.7), step(0.66, shopR)), step(0.33, shopR))
      .mul(mix(0.82, 1.0, step(0.5, fract(u.mul(1.1)))));
    const m = c.rgb.toVar();
    m.assign(mix(m, c.rgb.mul(1.22), frame.mul(detail)));
    m.assign(mix(m, c.rgb.mul(0.7), sill.max(course).mul(detail)));
    m.assign(mix(m, drawn, win.mul(mix(0.35, 1.0, detail))));
    m.assign(mix(m, vec3(0.14, 0.18, 0.24), shop.mul(detail)));
    m.assign(mix(m, awningCol, awning.mul(detail)));
    m.assign(mix(m, c.rgb.mul(1.16), cornice));
    m.assign(mix(m, c.rgb.mul(0.64), corniceShade.mul(detail)));

    const g = c.rgb.mul(mix(0.86, 1.14, smoothstep(0, 200, v))).mul(mix(1.0, mix(0.93, 1.07, randG), detail)).toVar();
    g.assign(mix(g, c.rgb.mul(0.58), spandrel.mul(detail)));
    g.assign(mix(g, c.rgb.mul(0.45), mullion.mul(near)));
    g.assign(mix(g, c.rgb.mul(1.35).add(0.05), fin.mul(detail)));
    g.assign(mix(g, vec3(0.34, 0.33, 0.37), podium.mul(0.8)));
    g.assign(mix(g, c.rgb.mul(1.3), crown));

    const roofNoise = mix(0.88, 1.1, mx_noise_float(positionWorld.xz.mul(0.09)).mul(0.5).add(0.5));
    const flat = c.rgb.mul(roofNoise).toVar();
    flat.assign(mix(flat, vec3(0.42, 0.43, 0.46), plant.mul(detail)));
    flat.assign(mix(flat, vec3(0.72, 0.73, 0.74), plantTop.mul(detail)));
    flat.assign(mix(flat, vec3(0.35, 0.5, 0.62), skylight.mul(detail)));
    const tiles = step(fract(positionWorld.y.mul(2.4)), 0.2);
    const pitched = c.rgb.mul(roofNoise).mul(mix(1.0, 0.8, tiles.mul(near)));

    const wall = m.mul(isMasonry).add(g.mul(isGlass)).mul(grime);
    return wall.add(flat.mul(isFlat)).add(pitched.mul(isPitched)).add(c.rgb.mul(isTrim)).mul(paint);
  })();
  const glassy = win.add(shop).clamp(0, 1).mul(detail);
  material.roughnessNode = mix(float(0.92), float(0.22), glassy).mul(isMasonry)
    .add(mix(float(0.14), float(0.5), spandrel).mul(isGlass))
    .add(isFlat.add(isPitched).mul(0.88))
    .add(isTrim.mul(0.7));
  material.metalnessNode = isGlass.mul(mix(float(0.62), float(0.25), spandrel.max(podium)));
  material.emissiveNode = vec3(1.0, 0.7, 0.36).mul(litM.mul(isMasonry).add(litG.mul(isGlass))).mul(mix(0.5, 1.3, detail));
  return material;
}

export function buildCity(data, exclusions) {
  const b = data.bounds;
  const cols = Math.ceil((b.maxX - b.minX) / TILE), rows = Math.ceil((b.maxZ - b.minZ) / TILE);
  const tiles = new Map();
  const hfW = Math.ceil((b.maxX - b.minX) / CELL), hfH = Math.ceil((b.maxZ - b.minZ) / CELL);
  const heights = new Float32Array(hfW * hfH);

  const tileFor = (cx, cz) => {
    const tx = THREE.MathUtils.clamp(Math.floor((cx - b.minX) / TILE), 0, cols - 1);
    const tz = THREE.MathUtils.clamp(Math.floor((cz - b.minZ) / TILE), 0, rows - 1);
    const key = tz * cols + tx;
    let t = tiles.get(key);
    if (!t) {
      t = { pos: new Grow(Float32Array, 60000), nor: new Grow(Float32Array, 60000), uv: new Grow(Float32Array, 40000), top: new Grow(Float32Array, 20000), col: new Grow(Uint8Array, 80000), idx: new Grow(Uint32Array, 90000), count: 0 };
      tiles.set(key, t);
    }
    return t;
  };

  const vert = (t, x, y, z, nx, ny, nz, u, v, col, type, top) => {
    t.pos.ensure(3); t.nor.ensure(3); t.uv.ensure(2); t.col.ensure(4); t.top.ensure(1);
    t.top.a[t.top.n++] = top;
    t.pos.a[t.pos.n++] = x; t.pos.a[t.pos.n++] = y; t.pos.a[t.pos.n++] = z;
    t.nor.a[t.nor.n++] = nx; t.nor.a[t.nor.n++] = ny; t.nor.a[t.nor.n++] = nz;
    t.uv.a[t.uv.n++] = u; t.uv.a[t.uv.n++] = v;
    t.col.a[t.col.n++] = Math.min(255, col.r * 255); t.col.a[t.col.n++] = Math.min(255, col.g * 255); t.col.a[t.col.n++] = Math.min(255, col.b * 255);
    t.col.a[t.col.n++] = type * 51;
    return t.count++;
  };
  const tri = (t, a, b2, c) => {
    t.idx.ensure(3);
    t.idx.a[t.idx.n++] = a; t.idx.a[t.idx.n++] = b2; t.idx.a[t.idx.n++] = c;
  };

  const walls = (t, ring, y0, y1, col, type, outwardSign, uOffset, top = y1) => {
    let u = uOffset;
    for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
      const px = ring[j], pz = ring[j + 1], qx = ring[i], qz = ring[i + 1];
      const dx = qx - px, dz = qz - pz;
      const len = Math.hypot(dx, dz);
      if (len < 0.05) continue;
      const nx = (dz / len) * outwardSign, nz = (-dx / len) * outwardSign;
      const a0 = vert(t, px, y0, pz, nx, 0, nz, u, y0, col, type, top);
      const a1 = vert(t, qx, y0, qz, nx, 0, nz, u + len, y0, col, type, top);
      const b1 = vert(t, qx, y1, qz, nx, 0, nz, u + len, y1, col, type, top);
      const b0 = vert(t, px, y1, pz, nx, 0, nz, u, y1, col, type, top);
      if (outwardSign > 0) { tri(t, a0, b1, a1); tri(t, a0, b0, b1); } else { tri(t, a0, a1, b1); tri(t, a0, b1, b0); }
      u += len;
    }
  };

  const cap = (t, ring, holes, faces, y, col, type) => {
    const base = t.count;
    for (let i = 0; i < ring.length; i += 2) vert(t, ring[i], y, ring[i + 1], 0, 1, 0, ring[i], ring[i + 1], col, type, y);
    for (const h of holes) for (let i = 0; i < h.length; i += 2) vert(t, h[i], y, h[i + 1], 0, 1, 0, h[i], h[i + 1], col, type, y);
    for (const f of faces) tri(t, base + f[0], base + f[1], base + f[2]);
  };

  const scaled = (ring, cx, cz, k) => {
    const out = new Float32Array(ring.length);
    for (let i = 0; i < ring.length; i += 2) {
      out[i] = cx + (ring[i] - cx) * k;
      out[i + 1] = cz + (ring[i + 1] - cz) * k;
    }
    return out;
  };

  // Sloped faces between an eave ring and a smaller raised ring, with real face normals.
  const hip = (t, outer, inner, y0, y1, col) => {
    for (let i = 0, j = outer.length - 2; i < outer.length; j = i, i += 2) {
      const ax = outer[j], az = outer[j + 1], bx = outer[i], bz = outer[i + 1];
      const cx = inner[i], cz = inner[i + 1], dx = inner[j], dz = inner[j + 1];
      const e1x = bx - ax, e1z = bz - az, e2x = dx - ax, e2y = y1 - y0, e2z = dz - az;
      let nx = -e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y;
      const flip = ny < 0;
      if (flip) { nx = -nx; ny = -ny; nz = -nz; }
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      const v0 = vert(t, ax, y0, az, nx, ny, nz, ax, az, col, PITCHED, y1);
      const v1 = vert(t, bx, y0, bz, nx, ny, nz, bx, bz, col, PITCHED, y1);
      const v2 = vert(t, cx, y1, cz, nx, ny, nz, cx, cz, col, PITCHED, y1);
      const v3 = vert(t, dx, y1, dz, nx, ny, nz, dx, dz, col, PITCHED, y1);
      if (flip) { tri(t, v0, v2, v1); tri(t, v0, v3, v2); } else { tri(t, v0, v1, v2); tri(t, v0, v2, v3); }
    }
  };

  // Flat strip between two rings at one height: the top of a parapet.
  const rim = (t, outer, inner, y, col) => {
    for (let i = 0, j = outer.length - 2; i < outer.length; j = i, i += 2) {
      const v0 = vert(t, outer[j], y, outer[j + 1], 0, 1, 0, 0, y, col, TRIM, y);
      const v1 = vert(t, outer[i], y, outer[i + 1], 0, 1, 0, 0, y, col, TRIM, y);
      const v2 = vert(t, inner[i], y, inner[i + 1], 0, 1, 0, 0, y, col, TRIM, y);
      const v3 = vert(t, inner[j], y, inner[j + 1], 0, 1, 0, 0, y, col, TRIM, y);
      const up = (outer[i + 1] - outer[j + 1]) * (inner[i] - outer[j]) - (outer[i] - outer[j]) * (inner[i + 1] - outer[j + 1]) > 0;
      if (up) { tri(t, v0, v1, v2); tri(t, v0, v2, v3); } else { tri(t, v0, v2, v1); tri(t, v0, v3, v2); }
    }
  };
  const square = (cx, cz, half) => new Float32Array([cx - half, cz - half, cx + half, cz - half, cx + half, cz + half, cx - half, cz + half]);

  const pts = [];
  let built = 0;
  for (const bd of data.buildings) {
    const ring = toRing(bd[3]);
    if (ring.length < 6) continue;
    let cx = 0, cz = 0, x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < ring.length; i += 2) {
      cx += ring[i]; cz += ring[i + 1];
      x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]);
      z0 = Math.min(z0, ring[i + 1]); z1 = Math.max(z1, ring[i + 1]);
    }
    cx /= ring.length / 2; cz /= ring.length / 2;
    if (exclusions.some((e) => Math.hypot(cx - e.x, cz - e.y) < e.r)) continue;

    const sa = signedArea(ring);
    const area = Math.abs(sa);
    const sign = sa > 0 ? 1 : -1;
    const top = bd[0] / 10, base = bd[5] / 10;
    const r = rnd(Math.round(cx * 31 + cz * 17 + top * 7));
    const style = styleFor(bd, cx, cz, top, area, r);
    const holes = bd[4] ? bd[4].map(toRing) : [];
    const t = tileFor(cx, cz);
    const uOffset = Math.floor(r() * 400) * 3.4;

    pts.length = 0;
    for (let i = 0; i < ring.length; i += 2) pts.push(new THREE.Vector2(ring[i], ring[i + 1]));
    const holePts = holes.map((h) => {
      const hp = [];
      for (let i = 0; i < h.length; i += 2) hp.push(new THREE.Vector2(h[i], h[i + 1]));
      return hp;
    });
    const faces = THREE.ShapeUtils.triangulateShape(pts, holePts);
    const all = holePts.length ? pts.concat(...holePts) : pts;
    for (const f of faces) {
      const a = all[f[0]], b2 = all[f[1]], c = all[f[2]];
      if ((b2.y - a.y) * (c.x - a.x) - (b2.x - a.x) * (c.y - a.y) < 0) { const s = f[1]; f[1] = f[2]; f[2] = s; }
    }

    if (style.pitched && holes.length === 0 && ring.length <= 24) {
      const rise = Math.min(3.4, Math.sqrt(area) * 0.2);
      const eave = Math.max(2.6, top - rise);
      walls(t, ring, base, eave, style.wall, WALL, sign, uOffset);
      const inner = scaled(ring, cx, cz, 0.28);
      hip(t, ring, inner, eave, eave + rise, style.roof);
      cap(t, inner, [], faces, eave + rise, style.roof, PITCHED);
    } else {
      const simple = holes.length === 0 && bd[1] !== 6;
      const crown = style.type === GLASS && top > 70 && simple && area > 500;
      const parapet = !crown && simple && top > 13 && area > 220 && style.type === WALL;
      const bodyTop = crown ? top * 0.9 : top;
      const lip = parapet ? 1.1 : 0;
      walls(t, ring, base, bodyTop + lip, style.wall, style.type, sign, uOffset);
      for (const h of holes) walls(t, h, base, bodyTop, style.wall, style.type, signedArea(h) > 0 ? -1 : 1, uOffset);
      cap(t, ring, holes, faces, bodyTop, style.roof, ROOF);
      if (parapet) {
        const inner = scaled(ring, cx, cz, Math.min(0.985, Math.max(0.88, 1 - 1.6 / Math.sqrt(area))));
        const shade = style.wall.clone().multiplyScalar(0.78);
        rim(t, ring, inner, top + lip, style.wall);
        walls(t, inner, top, top + lip, shade, TRIM, -sign, 0);
      }
      if (crown) {
        const inner = scaled(ring, cx, cz, 0.74);
        walls(t, inner, bodyTop, top, style.wall, style.type, sign, uOffset);
        cap(t, inner, [], faces, top, style.roof, ROOF);
        if (top > 150 && r() < 0.55) {
          const mast = square(cx, cz, 1.1);
          walls(t, mast, top, top + 16 + r() * 30, MAST, TRIM, signedArea(mast) > 0 ? 1 : -1, 0);
        }
      } else if (top > 22 && area > 300 && simple && r() < 0.7) {
        const plant = scaled(ring, cx + (r() - 0.5) * 4, cz + (r() - 0.5) * 4, 0.36);
        walls(t, plant, top, top + 3.4, style.roof, TRIM, sign, 0);
        cap(t, plant, [], faces, top + 3.4, style.roof, ROOF);
      }
    }

    const gx0 = Math.max(0, Math.floor((x0 - b.minX) / CELL)), gx1 = Math.min(hfW - 1, Math.floor((x1 - b.minX) / CELL));
    const gz0 = Math.max(0, Math.floor((z0 - b.minZ) / CELL)), gz1 = Math.min(hfH - 1, Math.floor((z1 - b.minZ) / CELL));
    for (let gz = gz0; gz <= gz1; gz++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const wx = b.minX + (gx + 0.5) * CELL, wz = b.minZ + (gz + 0.5) * CELL;
        const single = gx0 === gx1 && gz0 === gz1;
        if (single || inRing(wx, wz, ring)) {
          const i = gz * hfW + gx;
          if (top > heights[i]) heights[i] = top;
        }
      }
    }
    built++;
  }

  const group = new THREE.Group();
  group.name = 'city';
  const material = cityMaterial();
  let triangles = 0;
  for (const t of tiles.values()) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(t.pos.done(), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(t.nor.done(), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(t.uv.done(), 2));
    g.setAttribute('top', new THREE.BufferAttribute(t.top.done(), 1));
    g.setAttribute('color', new THREE.BufferAttribute(t.col.done(), 4, true));
    g.setIndex(new THREE.BufferAttribute(t.idx.done(), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    triangles += t.idx.n / 3;
    const mesh = new THREE.Mesh(g, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  const heightAt = (x, z) => {
    const gx = Math.floor((x - b.minX) / CELL), gz = Math.floor((z - b.minZ) / CELL);
    if (gx < 0 || gz < 0 || gx >= hfW || gz >= hfH) return 0;
    return heights[gz * hfW + gx];
  };
  const stamp = (x, z, radius, h) => {
    for (let dz = -radius; dz <= radius; dz += CELL) {
      for (let dx = -radius; dx <= radius; dx += CELL) {
        if (dx * dx + dz * dz > radius * radius) continue;
        const gx = Math.floor((x + dx - b.minX) / CELL), gz = Math.floor((z + dz - b.minZ) / CELL);
        if (gx < 0 || gz < 0 || gx >= hfW || gz >= hfH) continue;
        heights[gz * hfW + gx] = Math.max(heights[gz * hfW + gx], h);
      }
    }
  };
  return { group, heightAt, stamp, stats: { built, triangles } };
}
