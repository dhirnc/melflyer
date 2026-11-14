import * as THREE from 'three/webgpu';
import { FLIGHT, FLIGHT_BOX } from './config.js';
import { buildGround } from './world/ground.js';
import { buildCity } from './world/buildings.js';
import { buildLandmarks } from './world/landmarks.js';
import { buildTrees } from './world/trees.js';
import { buildSky } from './world/sky.js';
import { buildLife } from './world/life.js';
import { buildAirports } from './world/airports.js';
import { buildCoast } from './world/coast.js';
import { buildOutskirts } from './world/outskirts.js';
import { buildPlane } from './plane/model.js';
import { Flight, ChaseCamera } from './plane/flight.js';
import { buildPipeline } from './fx/pipeline.js';
import { buildPostcards } from './game/postcards.js';
import { createHud, initSplash } from './game/hud.js';
import { createAudio } from './game/audio.js';
import { createTouch } from './game/touch.js';

// Yields so the status line can paint. The timeout covers a hidden tab, where animation frames never fire.
const nextFrame = () => new Promise((r) => { requestAnimationFrame(r); setTimeout(r, 80); });

async function boot() {
  const status = (t) => {
    document.getElementById('status').textContent = t;
    if (import.meta.env.DEV) console.info(`[boot ${Math.round(performance.now())}ms] ${t}`);
  };
  const renderer = new THREE.WebGPURenderer({ antialias: false, requiredLimits: { maxColorAttachmentBytesPerSample: 64 } });
  let ratio = Math.min(devicePixelRatio, innerWidth > 1500 ? 1.25 : 1.5);
  renderer.setPixelRatio(ratio);
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  document.body.prepend(renderer.domElement);
  await renderer.init();

  status('unrolling the map…');
  const data = await (await fetch('data/melbourne.json')).json();
  await nextFrame();

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 2, 26000);

  const sky = buildSky(scene, renderer);
  status('painting the Yarra…');
  await nextFrame();
  const ground = buildGround(data);
  scene.add(ground.mesh);

  status(`stacking ${data.buildings.length.toLocaleString()} buildings…`);
  await nextFrame();
  const landmarks = buildLandmarks();
  const city = buildCity(data, landmarks.exclusions);
  for (const [p, r, h] of landmarks.solids) city.stamp(p.x, p.y, r, h);
  const airports = buildAirports();
  const heightAt = (x, z) => Math.max(city.heightAt(x, z), airports.heightAt(x, z));
  scene.add(city.group, landmarks.group, airports.group);

  status('planting plane trees…');
  await nextFrame();
  const trees = buildTrees(data, city.heightAt);
  const life = buildLife(data, ground.center, ground.isSea);
  const coast = buildCoast(ground.isSea);
  const outskirts = buildOutskirts(data.bounds, ground.isSea, airports.fields);
  scene.add(trees.group, life.group, coast.group, outskirts.group);

  const cards = [
    ...landmarks.postcards,
    ...airports.fields.map((f) => ({ name: `Land at ${f.name}`, land: f.name, at: new THREE.Vector2(f.x, f.z), y: 0, hint: `${f.code} in the logbook` })),
  ];
  const postcards = buildPostcards(cards);
  scene.add(postcards.group);

  const plane = buildPlane();
  scene.add(plane.root);

  const flight = new Flight(heightAt, FLIGHT_BOX, airports.fields);
  const chase = new ChaseCamera(camera, heightAt);
  const fx = buildPipeline(renderer, scene, camera);
  const hud = createHud(cards);
  const audio = createAudio();

  const stick = createTouch(renderer.domElement);
  const keys = new Set();
  let invert = false;
  let started = false;
  const fxKeys = { Digit1: 'paint', Digit2: 'ink', Digit3: 'gi', Digit4: 'ssr' };
  addEventListener('keydown', (e) => {
    if (e.repeat) return;
    keys.add(e.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (!started) return;
    if (e.code === 'KeyC') chase.mode = (chase.mode + 1) % 2;
    if (e.code === 'KeyM') audio.toggle();
    if (e.code === 'KeyH') hud.toggle();
    if (e.code === 'KeyI') invert = !invert;
    const name = fxKeys[e.code];
    if (name) {
      const u = fx.toggles[name];
      u.value = u.value ? 0 : 1;
      hud.fx(name, !!u.value);
    }
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());
  const fit = () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    document.getElementById('hud').style.zoom = THREE.MathUtils.clamp(Math.min(innerWidth / 1300, innerHeight / 780), 0.35, 1);
  };
  addEventListener('resize', fit);
  fit();

  const input = { pitch: 0, roll: 0, boost: false };
  const readInput = () => {
    const down = (...codes) => codes.some((c) => keys.has(c));
    const clamp = (v) => Math.max(-1, Math.min(1, v));
    const nose = clamp((down('KeyS', 'ArrowDown') ? 1 : 0) - (down('KeyW', 'ArrowUp') ? 1 : 0) + stick.y);
    input.pitch = started ? (invert ? -nose : nose) : 0;
    input.roll = started ? clamp((down('KeyD', 'ArrowRight') ? 1 : 0) - (down('KeyA', 'ArrowLeft') ? 1 : 0) + stick.x) : 0;
    input.boost = started && (down('Space') || stick.boost);
  };

  const dev = { hold: false };
  const whereAmI = () => {
    if (flight.field) return flight.field.name;
    const { x, z } = flight.pos;
    if (ground.isSea(x, z)) return 'Port Phillip Bay';
    let best = 'Greater Melbourne', bestD = 2200 * 2200;
    for (const [name, px, pz] of data.places) {
      const d = (px - x) ** 2 + (pz - z) ** 2;
      if (d < bestD) { bestD = d; best = name; }
    }
    return best;
  };
  const notice = () => {
    const touch = document.body.classList.contains('touch');
    const go = touch ? 'BOOST' : 'Space', back = touch ? 'pull back' : 'S', push = touch ? 'Push forward' : 'Nose down with W';
    if (flight.turningBack) return 'The winds are turning you around. Back toward the city.';
    if (flight.stopped) return `Parked at ${flight.field ? flight.field.name : 'the field'}. Hold ${go} to roll, then ${back} to lift off.`;
    if (flight.grounded) return flight.speed > FLIGHT.liftOff ? `Flying speed. Ease back: ${back}.` : input.boost ? 'Rolling…' : `Brakes on. Hold ${go} to go again.`;
    if (flight.field && flight.pos.y < 260) return `${flight.field.name} below. ${push} and set her down anywhere on the field.`;
    if (flight.assist > 0.5) return 'Rooftops ahead, climbing';
    return '';
  };

  const clock = new THREE.Clock();
  let t = 0, hudTimer = 0, frames = 0, fpsTimer = 0, fps = 60, slow = 0, fast = 0;
  const shadowFocus = new THREE.Vector3();

  const frame = () => {
    const dt = Math.min(clock.getDelta(), 0.05);
    t += dt;
    readInput();
    if (!dev.hold) flight.update(dt, input);
    flight.apply(plane.root, t);
    plane.root.updateMatrixWorld(true);
    const boostK = THREE.MathUtils.clamp((flight.speed - FLIGHT.cruise) / (FLIGHT.boost - FLIGHT.cruise), 0, 1);
    plane.animate(dt, input, boostK);
    chase.update(dt, flight, boostK, t);

    landmarks.update(dt);
    life.update(dt, t);
    coast.update(t);
    postcards.update(dt, t, flight.pos, flight.stopped && flight.field ? flight.field.name : null, (card, got, total) => {
      hud.collect(postcards.items.indexOf(card), card, got, total);
      audio.chime();
    });
    audio.update(boostK);

    shadowFocus.copy(flight.pos).addScaledVector(flight.forward, 380);
    shadowFocus.y = 0;
    sky.follow(shadowFocus);

    fx.pipeline.render();

    frames++;
    fpsTimer += dt;
    if (fpsTimer >= 1) {
      fps = Math.round(frames / fpsTimer);
      frames = 0;
      fpsTimer = 0;
      // Trade resolution for frame rate rather than stutter. The paint filter hides the difference.
      slow = fps < 40 ? slow + 1 : 0;
      fast = fps > 57 ? fast + 1 : 0;
      const cap = Math.min(devicePixelRatio, 2);
      if (slow >= 2 && ratio > 0.6) { ratio = Math.max(0.6, ratio - 0.15); renderer.setPixelRatio(ratio); slow = 0; }
      if (fast >= 6 && ratio < cap) { ratio = Math.min(cap, ratio + 0.1); renderer.setPixelRatio(ratio); fast = 0; }
    }
    hudTimer += dt;
    if (hudTimer > 0.1) {
      hudTimer = 0;
      hud.update(flight, boostK, postcards.nearest(flight.pos), fps, whereAmI());
      hud.notice(notice());
    }
  };

  if (import.meta.env.DEV) window.__mel = { dev, flight, airports, coast, life, ground, chase, fx, renderer, scene, camera, city, postcards, stats: { city: city.stats, trees: trees.stats, outskirts: outskirts.stats } };

  status('warming up the engine…');
  await nextFrame();
  renderer.setAnimationLoop(frame);
  hud.ready(() => {
    started = true;
    document.body.classList.add('playing');
    hud.show();
    audio.start();
  });
}

initSplash();
boot().catch((err) => {
  console.error(err);
  document.getElementById('status').textContent = `Could not start: ${err.message}`;
});
