import * as THREE from 'three/webgpu';
import {
  Fn, vec3, float, mix, smoothstep, dot, max, pow, normalize, normalWorldGeometry, positionLocal, positionWorld, cameraPosition,
  mx_fractal_noise_float, mx_noise_float, atan, fog, uniform, exp, length, floor, hash, step,
} from 'three/tsl';
import { SUN_DIR, LITE } from '../config.js';
import { day } from './daylight.js';

// Cheap horizon colour, warmer toward the sun. Shared by the fog so distance melts into the sky.
const horizonColor = Fn(([dir]) => {
  const flat = normalize(vec3(dir.x, 0.0, dir.z));
  const toward = max(dot(flat, normalize(vec3(day.sunDir.x, 0.0, day.sunDir.z))), 0);
  return mix(day.haze, day.warm, pow(toward, 3).mul(0.85));
});

const skyColor = Fn(([dir, withSun]) => {
  const h = dir.y;
  const horizon = horizonColor(dir);
  const col = mix(horizon, day.skyMid, smoothstep(0.0, 0.28, h)).toVar();
  col.assign(mix(col, day.skyTop, smoothstep(0.2, 0.95, h)));

  const s = max(dot(dir, day.sunDir), 0);
  col.addAssign(day.sun.mul(pow(s, 6).mul(0.45).add(pow(s, 60).mul(0.9))).mul(mix(1.0, 0.35, day.night)));
  // The same disc is the sun by day and a larger, cooler moon at night.
  const disc = smoothstep(mix(0.9991, 0.9974, day.night), mix(0.9995, 0.9978, day.night), s);
  col.addAssign(mix(vec3(1.0, 0.9, 0.7).mul(14), vec3(0.9, 0.94, 1.0).mul(2.2), day.night).mul(disc).mul(withSun));

  // Stars: one per cell of a fine grid on the sky dome, fading in with the dark.
  const cell = floor(dir.mul(170));
  const star = step(0.9965, hash(cell.x.mul(13.7).add(cell.y.mul(71.3)).add(cell.z.mul(37.9))));
  col.addAssign(vec3(0.9, 0.93, 1.0).mul(star).mul(smoothstep(0.55, 1.0, day.night)).mul(smoothstep(0.04, 0.3, h)).mul(1.6).mul(withSun));

  // Long painted cloud streaks, stretched toward the horizon.
  const p = dir.xz.div(h.abs().add(0.16));
  const streak = mx_fractal_noise_float(vec3(p.x.mul(0.9), p.y.mul(2.6), 3.0), 4, 2.1, 0.55).mul(0.5).add(0.5);
  const cloud = smoothstep(0.5, 0.78, streak).mul(smoothstep(0.02, 0.2, h)).mul(smoothstep(0.95, 0.5, h));
  const lit = mix(day.cloudShade, day.cloudLit, pow(s, 2));
  col.assign(mix(col, lit, cloud.mul(0.75)));

  // Far hills on the rim of the world.
  const az = atan(dir.z, dir.x);
  const ridge = mx_noise_float(vec3(az.mul(3.0), 0.5, 0.0)).mul(0.007).add(mx_noise_float(vec3(az.mul(11.0), 2.5, 0.0)).mul(0.002)).add(0.012);
  const hills = smoothstep(ridge, ridge.sub(0.003), h);
  col.assign(mix(col, mix(day.skyMid.mul(0.9), horizon, 0.62), hills));
  col.assign(mix(col, horizon, smoothstep(0.0, -0.05, h)));
  return col;
});

export function buildSky(scene, renderer) {
  scene.backgroundNode = skyColor(normalize(normalWorldGeometry), float(1));

  const viewDir = normalize(positionWorld.sub(cameraPosition));
  const dist = length(positionWorld.sub(cameraPosition));
  const density = uniform(0.000105);
  const amount = float(1).sub(exp(dist.mul(density).pow(2).negate())).mul(0.94);
  scene.fogNode = fog(horizonColor(viewDir), amount);

  // Reflections come from a small copy of the sky, rebuilt whenever the hour changes.
  const envScene = new THREE.Scene();
  const envMat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
  envMat.colorNode = skyColor(normalize(positionLocal), float(0));
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), envMat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envTarget = null;
  const refreshEnv = () => {
    const next = pmrem.fromScene(envScene, 0.02);
    scene.environment = next.texture;
    envTarget?.dispose();
    envTarget = next;
  };
  refreshEnv();

  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.castShadow = true;
  const mapSize = LITE ? 2048 : 4096;
  sun.shadow.mapSize.set(mapSize, mapSize);
  const cam = sun.shadow.camera;
  const half = LITE ? 620 : 900;
  cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
  cam.near = 100; cam.far = 6000;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 1.2;
  sun.shadow.radius = 2.5;
  scene.add(sun, sun.target);

  const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
  scene.add(hemi);

  const apply = ({ now, refreshEnv: wantsEnv }) => {
    sun.color.copy(now.sun);
    sun.intensity = now.sunPower;
    hemi.color.copy(now.hemiSky);
    hemi.groundColor.copy(now.hemiGround);
    hemi.intensity = now.hemiPower;
    scene.environmentIntensity = now.env;
    renderer.toneMappingExposure = now.exposure;
    if (wantsEnv) refreshEnv();
  };

  // Keep the shadow box centred ahead of the plane, snapped to texels so it does not crawl.
  const texel = (half * 2) / mapSize;
  const right = new THREE.Vector3(), up = new THREE.Vector3(), focus = new THREE.Vector3();
  const follow = (target) => {
    right.crossVectors(THREE.Object3D.DEFAULT_UP, SUN_DIR).normalize();
    up.crossVectors(SUN_DIR, right).normalize();
    const r = Math.round(target.dot(right) / texel) * texel;
    const u = Math.round(target.dot(up) / texel) * texel;
    focus.set(0, 0, 0).addScaledVector(right, r).addScaledVector(up, u).addScaledVector(SUN_DIR, target.dot(SUN_DIR));
    sun.target.position.copy(focus);
    sun.position.copy(focus).addScaledVector(SUN_DIR, 3000);
    sun.target.updateMatrixWorld();
  };
  return { sun, follow, apply };
}
