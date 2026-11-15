import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { SUN_DIR } from '../config.js';

const c = (r, g, b) => new THREE.Color(r, g, b);

// Each time of day is one row. Colours are linear RGB. az is the compass bearing of the sun (or moon),
// el its height in degrees. Add a row and it joins the cycle.
export const TIMES = [
  {
    id: 'golden', name: 'Golden hour', icon: '🌇', az: 292, el: 19,
    sun: c(1.0, 0.72, 0.46), sunPower: 6.4, hemiSky: c(0.62, 0.66, 0.98), hemiGround: c(0.8, 0.55, 0.42), hemiPower: 0.6,
    skyTop: c(0.2, 0.42, 0.78), skyMid: c(0.55, 0.72, 0.9), haze: c(0.93, 0.74, 0.66), warm: c(1.0, 0.72, 0.42),
    cloudShade: c(0.86, 0.72, 0.86), cloudLit: c(1.0, 0.82, 0.62), ambient: 1, night: 0, windows: 1, env: 0.5, exposure: 1,
  },
  {
    id: 'noon', name: 'Midday', icon: '☀️', az: 15, el: 58,
    sun: c(1.0, 0.96, 0.88), sunPower: 5.4, hemiSky: c(0.55, 0.7, 1.0), hemiGround: c(0.62, 0.6, 0.5), hemiPower: 0.95,
    skyTop: c(0.1, 0.34, 0.82), skyMid: c(0.4, 0.66, 0.95), haze: c(0.76, 0.86, 0.95), warm: c(0.92, 0.94, 0.92),
    cloudShade: c(0.84, 0.88, 0.96), cloudLit: c(1.0, 1.0, 1.0), ambient: 1.15, night: 0, windows: 0.12, env: 0.7, exposure: 0.95,
  },
  {
    id: 'dusk', name: 'Dusk', icon: '🌆', az: 262, el: 4,
    sun: c(1.0, 0.42, 0.26), sunPower: 3.0, hemiSky: c(0.46, 0.42, 0.8), hemiGround: c(0.6, 0.34, 0.4), hemiPower: 0.6,
    skyTop: c(0.1, 0.12, 0.36), skyMid: c(0.56, 0.38, 0.6), haze: c(0.98, 0.56, 0.46), warm: c(1.0, 0.46, 0.2),
    cloudShade: c(0.42, 0.34, 0.56), cloudLit: c(1.0, 0.5, 0.36), ambient: 0.6, night: 0.5, windows: 1.4, env: 0.45, exposure: 1.05,
  },
  {
    id: 'night', name: 'Night', icon: '🌙', az: 320, el: 42,
    sun: c(0.55, 0.66, 1.0), sunPower: 1.1, hemiSky: c(0.2, 0.27, 0.52), hemiGround: c(0.1, 0.1, 0.2), hemiPower: 0.55,
    skyTop: c(0.01, 0.02, 0.07), skyMid: c(0.04, 0.07, 0.19), haze: c(0.1, 0.13, 0.26), warm: c(0.16, 0.2, 0.38),
    cloudShade: c(0.08, 0.1, 0.2), cloudLit: c(0.24, 0.28, 0.44), ambient: 0.14, night: 1, windows: 1.5, env: 0.3, exposure: 1.2,
  },
];

const COLOURS = ['sun', 'hemiSky', 'hemiGround', 'skyTop', 'skyMid', 'haze', 'warm', 'cloudShade', 'cloudLit'];
const NUMBERS = ['el', 'sunPower', 'hemiPower', 'ambient', 'night', 'windows', 'env', 'exposure'];

// Shader-side view of the current light. Materials read these, so a change of hour needs no recompiles.
export const day = {
  sunDir: uniform(SUN_DIR),
  sun: uniform(TIMES[0].sun.clone()),
  skyTop: uniform(TIMES[0].skyTop.clone()),
  skyMid: uniform(TIMES[0].skyMid.clone()),
  haze: uniform(TIMES[0].haze.clone()),
  warm: uniform(TIMES[0].warm.clone()),
  cloudShade: uniform(TIMES[0].cloudShade.clone()),
  cloudLit: uniform(TIMES[0].cloudLit.clone()),
  ambient: uniform(1),
  night: uniform(0),
  windows: uniform(1),
};

export function createDaylight() {
  let index = Math.max(0, TIMES.findIndex((t) => t.id === localStorage.getItem('time')));
  const now = { az: TIMES[index].az };
  for (const k of COLOURS) now[k] = TIMES[index][k].clone();
  for (const k of NUMBERS) now[k] = TIMES[index][k];
  let moving = 1; // seconds of transition left; starts above zero so the first frame applies everything
  let sinceEnv = 0;

  const push = () => {
    const az = THREE.MathUtils.degToRad(now.az), el = THREE.MathUtils.degToRad(now.el);
    SUN_DIR.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    for (const k of ['sun', 'skyTop', 'skyMid', 'haze', 'warm', 'cloudShade', 'cloudLit']) day[k].value.copy(now[k]);
    for (const k of ['ambient', 'night', 'windows']) day[k].value = now[k];
  };
  push();

  return {
    get current() { return TIMES[index]; },
    next() {
      index = (index + 1) % TIMES.length;
      localStorage.setItem('time', TIMES[index].id);
      moving = 2.4;
      return TIMES[index];
    },
    // Eases toward the chosen hour. refreshEnv asks the caller to rebuild reflections, now and then while
    // the light is changing and once more when it settles.
    update(dt) {
      if (moving <= 0) return { now, changed: false, refreshEnv: false };
      const target = TIMES[index];
      moving -= dt;
      const k = moving <= 0 ? 1 : 1 - Math.exp(-dt * 2.6);
      for (const key of COLOURS) now[key].lerp(target[key], k);
      for (const key of NUMBERS) now[key] += (target[key] - now[key]) * k;
      now.az += (((target.az - now.az + 540) % 360) - 180) * k;
      push();
      sinceEnv += dt;
      const refreshEnv = moving <= 0 || sinceEnv > 0.45;
      if (refreshEnv) sinceEnv = 0;
      return { now, changed: true, refreshEnv };
    },
  };
}
