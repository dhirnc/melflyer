import * as THREE from 'three/webgpu';
import {
  Fn, vec3, float, mix, smoothstep, dot, max, pow, normalize, normalWorldGeometry, positionLocal, positionWorld, cameraPosition,
  mx_fractal_noise_float, mx_noise_float, atan, fog, uniform, exp, length,
} from 'three/tsl';
import { SUN_DIR, COLORS } from '../config.js';

const sunDir = uniform(SUN_DIR);
const v3 = (c) => vec3(c.r, c.g, c.b);

// Cheap horizon colour, warmer toward the sun. Shared by the fog so distance melts into the sky.
const horizonColor = Fn(([dir]) => {
  const flat = normalize(vec3(dir.x, 0.0, dir.z));
  const toward = max(dot(flat, normalize(vec3(sunDir.x, 0.0, sunDir.z))), 0);
  return mix(v3(COLORS.haze), vec3(1.0, 0.72, 0.42), pow(toward, 3).mul(0.85));
});

const skyColor = Fn(([dir, withSun]) => {
  const h = dir.y;
  const horizon = horizonColor(dir);
  const col = mix(horizon, v3(COLORS.skyMid), smoothstep(0.0, 0.28, h)).toVar();
  col.assign(mix(col, v3(COLORS.skyTop), smoothstep(0.2, 0.95, h)));

  const s = max(dot(dir, sunDir), 0);
  col.addAssign(v3(COLORS.sun).mul(pow(s, 6).mul(0.45).add(pow(s, 60).mul(0.9))));
  col.addAssign(vec3(1.0, 0.9, 0.7).mul(smoothstep(0.9991, 0.9995, s).mul(14)).mul(withSun));

  // Long painted cloud streaks, stretched toward the horizon.
  const p = dir.xz.div(h.abs().add(0.16));
  const streak = mx_fractal_noise_float(vec3(p.x.mul(0.9), p.y.mul(2.6), 3.0), 4, 2.1, 0.55).mul(0.5).add(0.5);
  const cloud = smoothstep(0.5, 0.78, streak).mul(smoothstep(0.02, 0.2, h)).mul(smoothstep(0.95, 0.5, h));
  const lit = mix(vec3(0.86, 0.72, 0.86), vec3(1.0, 0.82, 0.62), pow(s, 2));
  col.assign(mix(col, lit, cloud.mul(0.75)));

  // Far hills on the rim of the world.
  const az = atan(dir.z, dir.x);
  const ridge = mx_noise_float(vec3(az.mul(3.0), 0.5, 0.0)).mul(0.007).add(mx_noise_float(vec3(az.mul(11.0), 2.5, 0.0)).mul(0.002)).add(0.012);
  const hills = smoothstep(ridge, ridge.sub(0.003), h);
  col.assign(mix(col, mix(vec3(0.56, 0.6, 0.78), horizon, 0.62), hills));
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

  const envScene = new THREE.Scene();
  const envMat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
  envMat.colorNode = skyColor(normalize(positionLocal), float(0));
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), envMat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = 0.5;
  pmrem.dispose();

  const sun = new THREE.DirectionalLight(COLORS.sun, 6.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const cam = sun.shadow.camera;
  const half = 900;
  cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
  cam.near = 100; cam.far = 6000;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 1.2;
  sun.shadow.radius = 2.5;
  scene.add(sun, sun.target);

  const hemi = new THREE.HemisphereLight(new THREE.Color(0.62, 0.66, 0.98), new THREE.Color(0.8, 0.55, 0.42), 0.6);
  scene.add(hemi);

  // Keep the shadow box centred ahead of the plane, snapped to texels so it does not crawl.
  const texel = (half * 2) / 4096;
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), SUN_DIR).normalize();
  const up = new THREE.Vector3().crossVectors(SUN_DIR, right).normalize();
  const focus = new THREE.Vector3();
  const follow = (target) => {
    const r = Math.round(target.dot(right) / texel) * texel;
    const u = Math.round(target.dot(up) / texel) * texel;
    const d = target.dot(SUN_DIR);
    focus.set(0, 0, 0).addScaledVector(right, r).addScaledVector(up, u).addScaledVector(SUN_DIR, d);
    sun.target.position.copy(focus);
    sun.position.copy(focus).addScaledVector(SUN_DIR, 3000);
    sun.target.updateMatrixWorld();
  };
  return { sun, follow };
}
