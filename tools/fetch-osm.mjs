// Pulls inner-Melbourne OpenStreetMap data from Overpass and bakes it into
// public/data/melbourne.json in local metres (x east, z south, origin Flinders St Station).
// Coordinates are stored as integer decimetres to keep the file small.
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';

// region.json is the single place the mapped area is defined. Widen "detail" and re-run to grow the city.
const REGION = JSON.parse(readFileSync(new URL('../region.json', import.meta.url), 'utf8'));
const BBOX = REGION.detail;
const ORIGIN = REGION.origin;
const ENDPOINT = 'https://overpass-api.de/api/interpreter';
const CACHE = new URL('../.cache/', import.meta.url);
const OUT = new URL('../public/data/melbourne.json', import.meta.url);

const MX = Math.cos((ORIGIN.lat * Math.PI) / 180) * 111320;
const MZ = 110574;
const px = (lon) => Math.round((lon - ORIGIN.lon) * MX * 10);
const pz = (lat) => Math.round(-(lat - ORIGIN.lat) * MZ * 10);

const BAND = 0.035; // degrees of latitude per request; small enough that the public servers do not time out

async function request(name, bbox, body, depth = 0) {
  mkdirSync(CACHE, { recursive: true });
  const file = new URL(`${name}_${bbox.join('_')}.json`, CACHE);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')).elements;
  const q = `[out:json][timeout:300][maxsize:1073741824][bbox:${bbox.join(',')}];${body}`;
  const tries = depth < 4 ? 2 : 8;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        signal: AbortSignal.timeout(240000),
        method: 'POST',
        headers: { 'User-Agent': 'melflyer-demo/0.1', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(q),
      });
      const text = await res.text();
      if (res.ok && text.startsWith('{')) {
        writeFileSync(file, text);
        console.log(`${name} ${bbox.join(',')}: ${(text.length / 1e6).toFixed(1)} MB`);
        return JSON.parse(text).elements;
      }
      console.log(`${name} ${bbox.join(',')}: attempt ${attempt} failed (${res.status})`);
    } catch (err) {
      console.log(`${name} ${bbox.join(',')}: attempt ${attempt} failed (${err.message})`);
    }
    await new Promise((r) => setTimeout(r, 5000 * attempt));
  }
  if (depth >= 4) throw new Error(`overpass query ${name} failed`);
  // The public servers time out on dense areas. Halve the box along its longer side and try each part.
  const [s, w, n, e] = bbox;
  const tall = (n - s) * 1.27 > e - w;
  const mid = +(tall ? (s + n) / 2 : (w + e) / 2).toFixed(5);
  const halves = tall ? [[s, w, mid, e], [mid, w, n, e]] : [[s, w, n, mid], [s, mid, n, e]];
  console.log(`${name} ${bbox.join(',')}: splitting`);
  const out = [];
  for (const half of halves) out.push(...(await request(name, half, body, depth + 1)));
  return out;
}

// When a bake already exists and the new detail box contains it, only the strips around the old box are
// fetched and the old bake is kept as is. Growing the map then costs a few small requests, not a full re-download.
const previous = existsSync(OUT) && !process.argv.includes('--full') ? JSON.parse(readFileSync(OUT, 'utf8')) : null;
const OLD = previous && (previous.detail ?? {
  s: +(ORIGIN.lat - previous.bounds.maxZ / MZ).toFixed(4), n: +(ORIGIN.lat - previous.bounds.minZ / MZ).toFixed(4),
  w: +(ORIGIN.lon + previous.bounds.minX / MX).toFixed(4), e: +(ORIGIN.lon + previous.bounds.maxX / MX).toFixed(4),
});
const grows = OLD && BBOX.s <= OLD.s && BBOX.n >= OLD.n && BBOX.w <= OLD.w && BBOX.e >= OLD.e;
const FETCH_BOXES = !grows ? [BBOX] : [
  { s: BBOX.s, w: BBOX.w, n: OLD.s, e: BBOX.e },
  { s: OLD.n, w: BBOX.w, n: BBOX.n, e: BBOX.e },
  { s: OLD.s, w: BBOX.w, n: OLD.n, e: OLD.w },
  { s: OLD.s, w: OLD.e, n: OLD.n, e: BBOX.e },
].filter((b) => b.n - b.s > 1e-6 && b.e - b.w > 1e-6);
if (grows) console.log(`extending the existing bake with ${FETCH_BOXES.length} strip(s)`);

// Runs one query per latitude band and merges the results, dropping features that straddle two boxes.
async function overpass(name, body) {
  const seen = new Set();
  const elements = [];
  for (const box of FETCH_BOXES) {
    for (let s = box.s; s < box.n - 1e-9; s += BAND) {
      const n = Math.min(box.n, s + BAND);
      for (const el of await request(name, [+s.toFixed(4), box.w, +n.toFixed(4), box.e], body)) {
        const id = el.type + el.id;
        if (seen.has(id)) continue;
        seen.add(id);
        elements.push(el);
      }
    }
  }
  return { elements };
}

const line = (geom) => {
  const out = [];
  for (const p of geom) if (p) out.push(px(p.lon), pz(p.lat));
  return out;
};

const closed = (pts) => pts.length >= 8 && pts[0] === pts[pts.length - 2] && pts[1] === pts[pts.length - 1];

function area(pts) {
  let a = 0;
  for (let i = 0; i < pts.length - 2; i += 2) a += pts[i] * pts[i + 3] - pts[i + 2] * pts[i + 1];
  return Math.abs(a) / 200; // dm² -> m²
}

// Joins the member ways of a multipolygon role into closed rings.
function stitch(lines) {
  const rings = [];
  const pool = lines.filter((l) => l.length >= 4).map((l) => l.slice());
  while (pool.length) {
    let cur = pool.pop();
    let grew = true;
    while (!closed(cur) && grew) {
      grew = false;
      const ex = cur[cur.length - 2], ez = cur[cur.length - 1];
      for (let i = 0; i < pool.length; i++) {
        const l = pool[i];
        if (l[0] === ex && l[1] === ez) {
          cur = cur.concat(l.slice(2));
        } else if (l[l.length - 2] === ex && l[l.length - 1] === ez) {
          const rev = [];
          for (let k = l.length - 2; k >= 0; k -= 2) rev.push(l[k], l[k + 1]);
          cur = cur.concat(rev.slice(2));
        } else continue;
        pool.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (closed(cur)) rings.push(cur);
  }
  return rings;
}

// Returns [{o: ring, h: [rings]}] for a way or multipolygon relation.
function polygons(el) {
  if (el.type === 'way') {
    const ring = line(el.geometry || []);
    return closed(ring) ? [{ o: ring, h: [] }] : [];
  }
  const members = (el.members || []).filter((m) => m.type === 'way' && m.geometry);
  const outers = stitch(members.filter((m) => m.role !== 'inner').map((m) => line(m.geometry)));
  const inners = stitch(members.filter((m) => m.role === 'inner').map((m) => line(m.geometry)));
  const polys = outers.map((o) => ({ o, h: [] }));
  if (polys.length === 1) polys[0].h = inners;
  return polys;
}

const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

const KIND = {
  house: 0, detached: 0, semidetached_house: 0, terrace: 0, residential: 0, bungalow: 0, garage: 0, shed: 0, garages: 0,
  apartments: 1, dormitory: 1, hotel: 1,
  commercial: 2, retail: 2, office: 2, supermarket: 2,
  industrial: 3, warehouse: 3, hangar: 3, service: 3,
  church: 4, cathedral: 4, school: 4, university: 4, public: 4, civic: 4, hospital: 4, college: 4, government: 4,
  train_station: 4, stadium: 4, grandstand: 4, museum: 4, chapel: 4, synagogue: 4, mosque: 4,
};

function hash(a, b) {
  let h = (a * 73856093) ^ (b * 19349663);
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function buildingHeight(tags, kind, a, rnd) {
  const h = num(tags.height) ?? num(tags['building:height']);
  if (h) return h;
  const levels = num(tags['building:levels']);
  if (levels) return levels * 3.3 + 1.5;
  if (kind === 0) return 4.5 + rnd * 3.5;
  if (kind === 1) return 10 + rnd * 8;
  if (kind === 3) return 7 + rnd * 4;
  if (kind === 4) return 10 + rnd * 6;
  if (a > 2500) return 12 + rnd * 14;
  if (a > 600) return 8 + rnd * 8;
  return 5 + rnd * 4;
}

const data = {
  origin: ORIGIN,
  detail: BBOX,
  bounds: { minX: px(BBOX.w) / 10, maxX: px(BBOX.e) / 10, minZ: pz(BBOX.n) / 10, maxZ: pz(BBOX.s) / 10 },
  buildings: [], water: [], coast: [], green: [], sand: [], pitch: [],
  roads: [], rail: [], tram: [], trees: [], places: [],
};

function hexColour(v) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(v ?? '').trim());
  return m ? parseInt(m[1], 16) : 0;
}

function inRing(x, z, r) {
  let inside = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    if (r[i + 1] > z !== r[j + 1] > z && x < ((r[j] - r[i]) * (z - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]) inside = !inside;
  }
  return inside;
}

function centroid(r) {
  let x = 0, z = 0;
  const n = r.length / 2 - 1;
  for (let i = 0; i < n * 2; i += 2) { x += r[i]; z += r[i + 1]; }
  return [x / n, z / n];
}

{
  // building = [height dm, kind, name|0, ring, holes|0, base dm, colour|0]
  const parts = [];
  const pres = await overpass('parts', '(way["building:part"];relation["building:part"];);out geom qt;');
  for (const el of pres.elements) {
    const tags = el.tags || {};
    if (tags['building:part'] === 'no') continue;
    for (const poly of polygons(el)) {
      if (area(poly.o) < 12) continue;
      const h = num(tags.height) ?? (num(tags['building:levels']) ? num(tags['building:levels']) * 3.3 + 1.5 : null);
      if (!h) continue;
      const base = num(tags.min_height) ?? (num(tags['building:min_level']) ?? 0) * 3.3;
      if (h - base < 1) continue;
      parts.push([Math.round(h * 10), 6, tags.name || 0, poly.o, poly.h.length ? poly.h : 0, Math.round(base * 10), hexColour(tags['building:colour'])]);
    }
  }
  const CELL = 2000;
  const grid = new Map();
  for (const p of parts) {
    const [cx, cz] = centroid(p[3]);
    const key = Math.floor(cx / CELL) + ':' + Math.floor(cz / CELL);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push([cx, cz]);
  }
  const hasPart = (ring) => {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < ring.length; i += 2) {
      x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]);
      z0 = Math.min(z0, ring[i + 1]); z1 = Math.max(z1, ring[i + 1]);
    }
    for (let gx = Math.floor(x0 / CELL); gx <= Math.floor(x1 / CELL); gx++)
      for (let gz = Math.floor(z0 / CELL); gz <= Math.floor(z1 / CELL); gz++)
        for (const [cx, cz] of grid.get(gx + ':' + gz) || []) if (inRing(cx, cz, ring)) return true;
    return false;
  };

  const res = await overpass('buildings', '(way[building];relation[building];);out geom qt;');
  let replaced = 0;
  for (const el of res.elements) {
    const tags = el.tags || {};
    for (const poly of polygons(el)) {
      const a = area(poly.o);
      if (a < 28) continue;
      if (hasPart(poly.o)) { replaced++; continue; }
      const kind = KIND[tags.building] ?? 5;
      const rnd = hash(poly.o[0], poly.o[1]);
      const h = buildingHeight(tags, kind, a, rnd);
      data.buildings.push([Math.round(h * 10), kind, tags.name || 0, poly.o, poly.h.length ? poly.h : 0, 0, hexColour(tags['building:colour'])]);
    }
  }
  for (const p of parts) data.buildings.push(p);
  console.log(`${parts.length} building parts replace ${replaced} outlines`);
}

{
  const res = await overpass(
    'land',
    `(way[natural~"^(water|wood|beach|sand|scrub)$"];relation[natural~"^(water|wood)$"];
      way[waterway~"^(riverbank|dock)$"];relation[waterway=riverbank];
      way[natural=coastline];
      way[leisure~"^(park|garden|pitch|golf_course|nature_reserve|playground)$"];relation[leisure~"^(park|garden|golf_course)$"];
      way[landuse~"^(grass|recreation_ground|cemetery|forest|meadow|village_green)$"];relation[landuse~"^(grass|recreation_ground)$"];
    );out geom qt;`
  );
  for (const el of res.elements) {
    const t = el.tags || {};
    if (t.natural === 'coastline') {
      data.coast.push(line(el.geometry));
      continue;
    }
    const target =
      t.natural === 'water' || t.waterway ? data.water
      : t.natural === 'beach' || t.natural === 'sand' ? data.sand
      : t.leisure === 'pitch' ? data.pitch
      : data.green;
    for (const poly of polygons(el)) {
      if (area(poly.o) < 60) continue;
      target.push(poly.h.length ? [poly.o, poly.h] : [poly.o]);
    }
  }
}

{
  const ROAD = { motorway: 0, trunk: 0, motorway_link: 1, trunk_link: 1, primary: 1, primary_link: 1, secondary: 2, tertiary: 2, residential: 3, unclassified: 3, living_street: 3, pedestrian: 4 };
  const res = await overpass(
    'ways',
    `(way[highway~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|motorway_link|trunk_link|primary_link|pedestrian|living_street)$"];
      way[railway~"^(rail|tram)$"];);out geom qt;`
  );
  for (const el of res.elements) {
    const t = el.tags || {};
    const pts = line(el.geometry || []);
    if (pts.length < 4 || t.tunnel === 'yes' || t.tunnel === 'building_passage') continue;
    if (t.railway === 'tram') data.tram.push(pts);
    else if (t.railway === 'rail') data.rail.push(pts);
    else data.roads.push([ROAD[t.highway], t.bridge && t.bridge !== 'no' ? 1 : 0, t.name || 0, pts]);
  }
}

{
  const res = await overpass('points', '(node[natural=tree];node[place~"^(suburb|quarter|neighbourhood)$"];);out qt;');
  for (const el of res.elements) {
    if (el.tags?.natural === 'tree') data.trees.push(px(el.lon), pz(el.lat));
    else if (el.tags?.name) data.places.push([el.tags.name, px(el.lon) / 10, pz(el.lat) / 10]);
  }
}

if (grows) {
  // Anything touching the old box is already in the old bake, so only wholly new features are added.
  const o = { x0: px(OLD.w), x1: px(OLD.e), z0: pz(OLD.n), z1: pz(OLD.s) };
  const touchesOld = (pts) => {
    for (let i = 0; i < pts.length; i += 2) if (pts[i] >= o.x0 && pts[i] <= o.x1 && pts[i + 1] >= o.z0 && pts[i + 1] <= o.z1) return true;
    return false;
  };
  const points = { buildings: (b) => b[3], roads: (r) => r[3], places: (p) => [p[1] * 10, p[2] * 10] };
  for (const key of ['buildings', 'water', 'coast', 'green', 'sand', 'pitch', 'roads', 'rail', 'tram', 'places']) {
    const get = points[key] ?? (['water', 'green', 'sand', 'pitch'].includes(key) ? (p) => p[0] : (l) => l);
    data[key] = previous[key].concat(data[key].filter((f) => !touchesOld(get(f))));
  }
  const trees = previous.trees.slice();
  for (let i = 0; i < data.trees.length; i += 2) if (!touchesOld([data.trees[i], data.trees[i + 1]])) trees.push(data.trees[i], data.trees[i + 1]);
  data.trees = trees;
}

mkdirSync(new URL('./', OUT), { recursive: true });
const json = JSON.stringify(data);
writeFileSync(OUT, json);
console.log(
  `wrote ${(json.length / 1e6).toFixed(1)} MB: ${data.buildings.length} buildings, ${data.water.length} water, ` +
    `${data.green.length} green, ${data.roads.length} roads, ${data.tram.length} tram, ${data.trees.length / 2} trees, ` +
    `${data.coast.length} coast, ${data.places.length} places`
);
