import * as THREE from 'three/webgpu';
import {
  Fn, texture, positionWorld, vec2, vec3, float, mix, smoothstep, time, mx_noise_float, sin, normalize, transformNormalToView,
  cameraPosition, length, max, fract, floor, hash, step,
} from 'three/tsl';

import { LITE } from '../config.js';

const ROAD_WIDTH = [26, 17, 12, 8, 7];
const LINES_PX_PER_M = 4096 / 11000;
const MAX_CANVAS = 8192;

function tracePoly(ctx, poly, map) {
  const rings = poly.length > 1 ? [poly[0], ...poly[1]] : [poly[0]];
  for (const r of rings) {
    ctx.moveTo(map.x(r[0]), map.y(r[1]));
    for (let i = 2; i < r.length; i += 2) ctx.lineTo(map.x(r[i]), map.y(r[i + 1]));
    ctx.closePath();
  }
}

function traceLine(ctx, pts, map) {
  ctx.moveTo(map.x(pts[0]), map.y(pts[1]));
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(map.x(pts[i]), map.y(pts[i + 1]));
}

// One path per way. A single path holding every road makes the rasteriser resolve all their overlaps at once.
function strokeLine(ctx, pts, map) {
  ctx.beginPath();
  traceLine(ctx, pts, map);
  ctx.stroke();
}

// Maps data coordinates (decimetres) onto a canvas that covers the data bounds exactly.
function mapper(bounds, pxPerM) {
  const w = bounds.maxX - bounds.minX, h = bounds.maxZ - bounds.minZ;
  const k = Math.min(pxPerM, MAX_CANVAS / Math.max(w, h));
  return {
    w: Math.round(w * k),
    h: Math.round(h * k),
    k,
    x: (v) => (v / 10 - bounds.minX) * k,
    y: (v) => (v / 10 - bounds.minZ) * k,
  };
}

// The coastline is an open polyline, so the sea is found by flood fill from a point in the bay.
// The canvas stops at the data bounds, which every coastline way crosses, so the fill cannot leak round the ends.
function seaCanvas(data) {
  const map = mapper(data.bounds, 1024 / Math.max(data.bounds.maxX - data.bounds.minX, data.bounds.maxZ - data.bounds.minZ));
  const { w, h } = map;
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (const line of data.coast) traceLine(ctx, line, map);
  ctx.stroke();
  const img = ctx.getImageData(0, 0, w, h);
  const px = img.data;
  const seen = new Uint8Array(w * h);
  const stack = [Math.round(map.y(62000)) * w + Math.round(map.x(-25000))];
  let filled = 0;
  while (stack.length) {
    const i = stack.pop();
    if (seen[i] || px[i * 4] > 90) continue;
    seen[i] = 1;
    filled++;
    const x = i % w;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (i >= w) stack.push(i - w);
    if (i < w * (h - 1)) stack.push(i + w);
  }
  const leaked = filled > w * h * 0.6;
  if (leaked) console.warn('sea flood fill leaked past the coastline, skipping the bay');
  for (let i = 0; i < w * h; i++) {
    const sea = !leaked && (seen[i] || (px[i * 4] > 90 && seen[Math.min(w * h - 1, i + w)]));
    px[i * 4] = sea ? 255 : 0;
    px[i * 4 + 1] = px[i * 4 + 2] = 0;
    px[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  const isSea = (x, z) => {
    const cx = Math.round(map.x(x * 10)), cy = Math.round(map.y(z * 10));
    return !leaked && cx >= 0 && cy >= 0 && cx < w && cy < h && seen[cy * w + cx] === 1;
  };
  // Where the coast leaves the bottom of the map, so the bay can be continued past it.
  let southCoastX = data.bounds.minX;
  for (let x = w - 1; x >= 0; x--) {
    if (seen[(h - 2) * w + x]) { southCoastX = data.bounds.minX + x / map.k; break; }
  }
  return { canvas: c, isSea, southCoastX };
}

function blurred(src, radius) {
  const c = new OffscreenCanvas(src.width, src.height);
  const ctx = c.getContext('2d');
  ctx.filter = `blur(${radius}px)`;
  ctx.drawImage(src, 0, 0);
  return c;
}

function canvasTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.NoColorSpace;
  t.flipY = false; // canvas row 0 is north, matching world -z
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  return t;
}

// Land cover: R water, G green space, B sand.
function landCanvas(data, sea) {
  const map = mapper(data.bounds, LINES_PX_PER_M / 2);
  const c = new OffscreenCanvas(map.w, map.h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, map.w, map.h);
  ctx.globalCompositeOperation = 'lighter';
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(sea.canvas, 0, 0, map.w, map.h);
  const fillEach = (polys, colour) => {
    ctx.fillStyle = colour;
    for (const p of polys) {
      ctx.beginPath();
      tracePoly(ctx, p, map);
      ctx.fill('evenodd');
    }
  };
  fillEach(data.water, '#f00');
  // Docklands buildings stand on piers that OSM maps as open water. Give each footprint a dry apron.
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = ctx.strokeStyle = '#0ff';
  ctx.lineWidth = 16 * map.k;
  ctx.lineJoin = 'round';
  for (const b of data.buildings) {
    if (b[5] !== 0) continue;
    ctx.beginPath();
    tracePoly(ctx, [b[3]], map);
    ctx.fill();
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'lighter';
  fillEach(data.green, '#0f0');
  fillEach(data.pitch, '#0f0');
  fillEach(data.sand, '#00f');
  return blurred(c, 2.2);
}

// Line work: R roads, G rail and tram, B sports pitches.
function linesCanvas(data) {
  const map = mapper(data.bounds, LINES_PX_PER_M);
  const c = new OffscreenCanvas(map.w, map.h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, map.w, map.h);
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#f00';
  for (let cls = 4; cls >= 0; cls--) {
    ctx.lineWidth = Math.max(2.2, ROAD_WIDTH[cls] * map.k);
    for (const r of data.roads) if (r[0] === cls) strokeLine(ctx, r[3], map);
  }
  ctx.strokeStyle = '#0f0';
  ctx.lineWidth = Math.max(2, 9 * map.k);
  for (const r of data.rail) strokeLine(ctx, r, map);
  ctx.lineWidth = 1.6;
  for (const r of data.tram) strokeLine(ctx, r, map);
  ctx.fillStyle = '#00f';
  for (const p of data.pitch) {
    ctx.beginPath();
    tracePoly(ctx, p, map);
    ctx.fill('evenodd');
  }
  return blurred(c, 1.1);
}

export function buildGround(data) {
  const b = data.bounds;
  const center = new THREE.Vector2((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2);
  const size = new THREE.Vector2(b.maxX - b.minX, b.maxZ - b.minZ);
  const sea = seaCanvas(data);
  const landTex = canvasTexture(landCanvas(data, sea));
  const linesTex = canvasTexture(linesCanvas(data));

  const wp = positionWorld.xz;
  const maskUV = wp.sub(vec2(center.x, center.y)).div(vec2(size.x, size.y)).add(0.5);
  // Distance to the edge of the mapped area in metres, so the fade is the same width on every side.
  const edgeM = vec2(size.x, size.y).mul(float(0.5).sub(maskUV.sub(0.5).abs()));
  const inside = smoothstep(0, 420, edgeM.x.min(edgeM.y));

  const land = texture(landTex, maskUV);
  const lines = texture(linesTex, maskUV);

  // Beyond the map the bay is continued by rule: open water to the west, and a coast running south-east past Brighton.
  const farCoastX = mix(float(b.minX + 200), float(sea.southCoastX).add(wp.y.sub(b.maxZ).max(0).mul(0.88)), step(b.maxZ - 300, wp.y));
  const farSea = smoothstep(5500, 5800, wp.y).mul(smoothstep(farCoastX.add(120), farCoastX.sub(120), wp.x));
  const waterMask = mix(farSea, land.r, inside);

  const blotch = mx_noise_float(vec3(wp.mul(0.004), 1.7)).mul(0.5).add(0.5);
  const fine = mx_noise_float(vec3(wp.mul(0.035), 4.2)).mul(0.5).add(0.5);
  const stroke = mx_noise_float(vec3(wp.x.mul(0.012), wp.y.mul(0.05), 9.1)).mul(0.5).add(0.5);

  const water = smoothstep(0.42, 0.52, waterMask);
  const shore = smoothstep(0.2, 0.5, waterMask).mul(smoothstep(0.82, 0.5, waterMask));
  const green = smoothstep(0.4, 0.5, land.g).mul(inside);
  const sand = smoothstep(0.35, 0.5, land.b).mul(inside);
  const road = smoothstep(0.3, 0.48, lines.r).mul(inside);
  const rail = smoothstep(0.3, 0.5, lines.g).mul(inside);
  const pitch = smoothstep(0.4, 0.5, lines.b).mul(inside);

  const colorNode = Fn(() => {
    const block = mix(vec3(0.86, 0.66, 0.46), vec3(0.95, 0.8, 0.56), blotch).mul(mix(0.9, 1.06, fine));
    const grassA = vec3(0.38, 0.6, 0.22);
    const grassB = vec3(0.62, 0.74, 0.28);
    const grass = mix(grassA, grassB, stroke).mul(mix(0.86, 1.08, fine));
    const mown = mix(vec3(0.3, 0.62, 0.24), vec3(0.42, 0.72, 0.28), sin(wp.x.add(wp.y).mul(0.35)).mul(0.5).add(0.5));
    const asphalt = mix(vec3(0.36, 0.33, 0.38), vec3(0.46, 0.42, 0.44), fine);
    const sandCol = mix(vec3(0.96, 0.84, 0.6), vec3(0.9, 0.76, 0.52), fine);
    const deep = mix(vec3(0.05, 0.3, 0.42), vec3(0.08, 0.42, 0.5), stroke);
    const shallow = vec3(0.3, 0.68, 0.66);
    // Slow drifting bands of lighter paint so open water never reads as one flat fill.
    const swell = mx_noise_float(vec3(wp.x.mul(0.006), wp.y.mul(0.022), time.mul(0.08))).mul(0.5).add(0.5);
    const waterCol = mix(mix(deep, vec3(0.16, 0.5, 0.6), smoothstep(0.5, 0.85, swell).mul(0.55)), shallow, smoothstep(0.95, 0.5, waterMask));

    // Past the edge of the mapped area, a procedural carpet of streets, roofs and gardens.
    const q = vec2(wp.x.mul(0.94).sub(wp.y.mul(0.34)), wp.x.mul(0.34).add(wp.y.mul(0.94)));
    const grid = q.div(vec2(118, 74));
    const street = max(smoothstep(0.9, 0.93, fract(grid.x)), smoothstep(0.84, 0.88, fract(grid.y)));
    const lot = floor(q.div(13));
    const lotR = hash(lot.x.mul(12.9898).add(lot.y.mul(78.233)));
    const lotR2 = hash(lot.x.mul(39.3468).add(lot.y.mul(11.135)));
    const roofCol = mix(mix(vec3(0.74, 0.3, 0.17), vec3(0.42, 0.42, 0.47), step(0.62, lotR2)), vec3(0.86, 0.8, 0.68), step(0.86, lotR2));
    const lotCol = mix(grassA.mul(1.15), roofCol, step(0.42, lotR));
    const parkland = smoothstep(0.25, 0.5, mx_noise_float(vec3(wp.mul(0.0009), 2.0)));
    const blend = smoothstep(2200, 6500, length(cameraPosition.sub(positionWorld)));
    const suburb = mix(mix(mix(lotCol, asphalt, street), vec3(0.6, 0.47, 0.36), blend), grass, parkland);
    // Further out the streets give way to bush and paddocks, all the way to the ranges.
    const bush = mix(vec3(0.2, 0.4, 0.2), vec3(0.42, 0.56, 0.24), mx_noise_float(vec3(wp.mul(0.0016), 8.0)).mul(0.5).add(0.5));
    const paddock = mix(vec3(0.72, 0.68, 0.36), vec3(0.56, 0.66, 0.3), stroke);
    const country = mix(bush, paddock, smoothstep(0.2, 0.45, mx_noise_float(vec3(wp.mul(0.0007), 12.0)))).mul(mix(0.9, 1.06, fine));
    const carpet = mix(suburb, country, smoothstep(2400, 5200, edgeM.x.min(edgeM.y).negate()));

    const c = mix(carpet, block, inside).toVar();
    c.assign(mix(c, grass, green));
    c.assign(mix(c, mown, pitch));
    c.assign(mix(c, sandCol, sand));
    c.assign(mix(c, waterCol, water));
    c.assign(mix(c, vec3(0.5, 0.4, 0.36), rail.mul(0.85)));
    c.assign(mix(c, asphalt, road));
    const foam = shore.mul(smoothstep(0.35, 0.7, mx_noise_float(vec3(wp.mul(0.05), time.mul(0.25))).mul(0.5).add(0.5).add(shore.mul(0.3))));
    c.assign(mix(c, vec3(0.97, 0.98, 0.95), foam.mul(road.oneMinus()).mul(0.85)));
    return c;
  })();

  const wet = water.mul(road.oneMinus());
  const material = new THREE.MeshStandardNodeMaterial();
  material.colorNode = colorNode;
  material.roughnessNode = mix(float(0.95), float(LITE ? 0.3 : 0.16), wet);
  material.metalnessNode = mix(float(0), float(0.92), wet);

  // Small moving ripples so the reflections wobble like wet paint.
  const rippleFade = smoothstep(2600, 250, length(cameraPosition.sub(positionWorld)));
  const t = time.mul(0.6);
  const ripple = vec2(
    mx_noise_float(vec3(wp.mul(0.11), t)).add(mx_noise_float(vec3(wp.mul(0.031).add(40), t.mul(0.7))).mul(1.6)),
    mx_noise_float(vec3(wp.mul(0.11).add(17), t)).add(mx_noise_float(vec3(wp.mul(0.031).add(90), t.mul(0.7))).mul(1.6))
  ).mul(0.05).mul(rippleFade).mul(wet);
  // The ripples only show through reflections, which the phone build does not render.
  if (!LITE) material.normalNode = transformNormalToView(normalize(vec3(ripple.x, 1, ripple.y)));

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(90000, 90000, 1, 1).rotateX(-Math.PI / 2), material);
  mesh.receiveShadow = true;
  mesh.name = 'ground';

  // True for the mapped bay and for the rule-based bay beyond the map.
  const isSea = (x, z) => {
    if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) return sea.isSea(x, z);
    const coast = z > b.maxZ - 300 ? sea.southCoastX + Math.max(0, z - b.maxZ) * 0.88 : b.minX + 200;
    return z > 5650 && x < coast;
  };
  return { mesh, center, isSea };
}
