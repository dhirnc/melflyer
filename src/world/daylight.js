import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';

const c = (r, g, b) => new THREE.Color(r, g, b);

// Each time of day is one row, in the order the T key cycles them. Colours are linear RGB. az is the compass
// bearing of the sun (or moon) and el its height in degrees. Add a row and it joins the cycle.
//   haze / warm      horizon colour away from and toward the sun
//   cloudShade / Lit cloud colour away from and toward the sun
//   water / sheen    colour the bay picks up from the sky, and how strongly
//   ambient          brightness of things that glow on their own (cloud puffs, far ranges)
//   night            0 by day, 1 at night: fades in stars, the moon and extra lit windows
export const TIMES = [
  {
    id: 'golden', name: 'Golden hour', icon: '🌇', az: 286, el: 12,
    sun: c(1.0, 0.63, 0.36), sunPower: 7.2, hemiSky: c(0.6, 0.62, 0.96), hemiGround: c(0.84, 0.54, 0.4), hemiPower: 0.62,
    skyTop: c(0.2, 0.42, 0.78), skyMid: c(0.55, 0.72, 0.9), haze: c(0.95, 0.7, 0.58), warm: c(1.0, 0.64, 0.34),
    cloudShade: c(0.86, 0.72, 0.86), cloudLit: c(1.0, 0.82, 0.62), water: c(1.0, 0.72, 0.46), sheen: 0.2,
    ambient: 1, night: 0, windows: 1, env: 0.5, exposure: 1,
  },
  {
    id: 'dusk', name: 'Dusk', icon: '🌆', az: 262, el: 4,
    sun: c(1.0, 0.5, 0.4), sunPower: 4.4, hemiSky: c(0.66, 0.5, 0.92), hemiGround: c(0.86, 0.5, 0.52), hemiPower: 0.85,
    skyTop: c(0.22, 0.26, 0.62), skyMid: c(0.74, 0.5, 0.8), haze: c(1.0, 0.62, 0.66), warm: c(1.0, 0.56, 0.32),
    cloudShade: c(0.66, 0.5, 0.84), cloudLit: c(1.0, 0.58, 0.62), water: c(1.0, 0.62, 0.64), sheen: 0.5,
    ambient: 0.85, night: 0.3, windows: 1.4, env: 0.6, exposure: 1.05,
  },
  {
    id: 'night', name: 'Night', icon: '🌙', az: 320, el: 42,
    sun: c(0.55, 0.66, 1.0), sunPower: 1.1, hemiSky: c(0.2, 0.27, 0.52), hemiGround: c(0.1, 0.1, 0.2), hemiPower: 0.55,
    skyTop: c(0.01, 0.02, 0.07), skyMid: c(0.04, 0.07, 0.19), haze: c(0.1, 0.13, 0.26), warm: c(0.16, 0.2, 0.38),
    cloudShade: c(0.08, 0.1, 0.2), cloudLit: c(0.24, 0.28, 0.44), water: c(0.3, 0.36, 0.6), sheen: 0.25,
    ambient: 0.14, night: 1, windows: 1.5, env: 0.3, exposure: 1.2,
  },
  {
    id: 'noon', name: 'Midday', icon: '☀️', az: 15, el: 58,
    sun: c(1.0, 0.95, 0.86), sunPower: 4.6, hemiSky: c(0.55, 0.7, 1.0), hemiGround: c(0.62, 0.6, 0.5), hemiPower: 0.8,
    skyTop: c(0.1, 0.34, 0.82), skyMid: c(0.4, 0.66, 0.95), haze: c(0.76, 0.86, 0.95), warm: c(0.92, 0.94, 0.92),
    cloudShade: c(0.84, 0.88, 0.96), cloudLit: c(1.0, 1.0, 1.0), water: c(0.7, 0.86, 1.0), sheen: 0.12,
    ambient: 1.1, night: 0, windows: 0.12, env: 0.6, exposure: 0.86,
  },
];

const DEFAULT = 'dusk';
const STORE = 'melflyer.time';
const COLOURS = ['sun', 'hemiSky', 'hemiGround', 'skyTop', 'skyMid', 'haze', 'warm', 'cloudShade', 'cloudLit', 'water'];
const NUMBERS = ['el', 'sunPower', 'hemiPower', 'sheen', 'ambient', 'night', 'windows', 'env', 'exposure'];
const SHADER_COLOURS = ['sun', 'skyTop', 'skyMid', 'haze', 'warm', 'cloudShade', 'cloudLit', 'water'];
const SHADER_NUMBERS = ['sheen', 'ambient', 'night', 'windows'];
// The light never drops below this height, however low the sun sits in the sky. A flatter light smears the
// shadow map along the ground and pulls half the city into the shadow pass.
const MIN_LIGHT_EL = 11;

const indexOf = (id) => TIMES.findIndex((t) => t.id === id);
const direction = (out, az, el) => {
  const a = THREE.MathUtils.degToRad(az), e = THREE.MathUtils.degToRad(el);
  return out.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)).normalize();
};

const first = TIMES[indexOf(DEFAULT)];

// Shader-side view of the current light. Materials read these uniforms, so a change of hour recompiles nothing
// and costs nothing once the transition has settled.
export const day = {
  sunDir: uniform(direction(new THREE.Vector3(), first.az, first.el)), // where the sun is painted in the sky
  lightDir: direction(new THREE.Vector3(), first.az, Math.max(first.el, MIN_LIGHT_EL)), // where light and shadows come from
  ...Object.fromEntries(SHADER_COLOURS.map((k) => [k, uniform(first[k].clone())])),
  ...Object.fromEntries(SHADER_NUMBERS.map((k) => [k, uniform(first[k])])),
};

// ?time=<id> picks an hour for this visit only. Otherwise the last choice is remembered, and dusk is the default.
export function createDaylight() {
  const asked = indexOf(new URLSearchParams(location.search).get('time'));
  const saved = indexOf(localStorage.getItem(STORE));
  let index = asked >= 0 ? asked : saved >= 0 ? saved : indexOf(DEFAULT);

  const now = { az: TIMES[index].az };
  for (const k of COLOURS) now[k] = TIMES[index][k].clone();
  for (const k of NUMBERS) now[k] = TIMES[index][k];
  let moving = 0.01; // seconds of transition left; starts above zero so the first frame applies everything

  const push = () => {
    direction(day.sunDir.value, now.az, now.el);
    direction(day.lightDir, now.az, Math.max(now.el, MIN_LIGHT_EL));
    for (const k of SHADER_COLOURS) day[k].value.copy(now[k]);
    for (const k of SHADER_NUMBERS) day[k].value = now[k];
  };
  push();

  return {
    get current() { return TIMES[index]; },
    next() {
      index = (index + 1) % TIMES.length;
      localStorage.setItem(STORE, TIMES[index].id);
      moving = 2.4;
      return TIMES[index];
    },
    // Eases toward the chosen hour. refreshEnv asks the caller to rebuild reflections, once, when the light
    // has settled: each rebuild stalls a frame, so the old reflections ride out the transition.
    update(dt) {
      if (moving <= 0) return { now, changed: false, refreshEnv: false };
      const target = TIMES[index];
      moving -= dt;
      const k = moving <= 0 ? 1 : 1 - Math.exp(-dt * 2.6);
      for (const key of COLOURS) now[key].lerp(target[key], k);
      for (const key of NUMBERS) now[key] += (target[key] - now[key]) * k;
      now.az += (((target.az - now.az + 540) % 360) - 180) * k;
      push();
      return { now, changed: true, refreshEnv: moving <= 0 };
    },
  };
}
