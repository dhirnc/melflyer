import * as THREE from 'three/webgpu';
import { FLIGHT, ll } from '../config.js';

const damp = (k, dt) => 1 - Math.exp(-k * dt);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Arcade flight with two states. In the air the stick sets a target attitude and the plane eases back to
// level when released. On the ground at an airfield it rolls, steers, stops, and takes off again.
export class Flight {
  constructor(heightAt, box, airfields) {
    this.heightAt = heightAt;
    this.box = box;
    this.airfields = airfields;
    const s = ll(FLIGHT.start.lat, FLIGHT.start.lon);
    this.pos = new THREE.Vector3(s.x, FLIGHT.start.alt, s.y);
    this.yaw = FLIGHT.start.heading;
    this.pitch = 0;
    this.roll = 0;
    this.speed = FLIGHT.cruise;
    this.forward = new THREE.Vector3(0, 0, -1);
    this.state = 'air';
    this.field = null; // airfield under the plane, if any
    this.assist = 0;
    this.bump = 0;
    this.turningBack = false;
  }

  fieldAt(x, z) {
    for (const f of this.airfields) if (Math.hypot(x - f.x, z - f.z) < f.radius) return f;
    return null;
  }

  update(dt, input) {
    this.field = this.fieldAt(this.pos.x, this.pos.z);
    if (this.state === 'ground') this.taxi(dt, input);
    else this.fly(dt, input);
    this.bump = Math.max(0, this.bump - dt * 2.5);
  }

  taxi(dt, input) {
    const blocked = this.heightAt(this.pos.x - Math.sin(this.yaw) * 14, this.pos.z - Math.cos(this.yaw) * 14) > 0;
    if (input.boost && !blocked) this.speed += 21 * dt;
    else this.speed = Math.max(0, this.speed - (14 + this.speed * 0.45) * dt);
    if (blocked) this.speed = Math.min(this.speed, 2);

    // Taxi steering: a slow pivot at rest, gentler as speed builds.
    const steer = THREE.MathUtils.lerp(0.75, 0.22, Math.min(1, this.speed / 40));
    this.yaw = wrap(this.yaw - input.roll * steer * dt);
    this.roll += (-input.roll * 0.05 * Math.min(1, this.speed / 20) - this.roll) * damp(6, dt);
    this.pitch += ((this.speed > FLIGHT.liftOff * 0.8 ? 0.05 : 0) - this.pitch) * damp(4, dt);
    this.pos.y += (FLIGHT.wheelsY - this.pos.y) * damp(12, dt);

    this.forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.pos.addScaledVector(this.forward, this.speed * dt);

    // Only leave the ground under power. Touching down fast must not bounce straight back into the air.
    const rotate = input.boost && this.speed > FLIGHT.liftOff && (input.pitch > 0 || this.speed > FLIGHT.liftOff + 16);
    if (rotate) {
      this.state = 'air';
      this.pitch = 0.16;
    }
  }

  fly(dt, input) {
    const f = this.forward;
    let rollIn = input.roll;

    // Past the edge of the world the wind banks the plane back toward the city.
    const b = this.box;
    const outside = this.pos.x < b.minX || this.pos.x > b.maxX || this.pos.z < b.minZ || this.pos.z > b.maxZ;
    if (outside) {
      const err = wrap(Math.atan2(this.pos.x, this.pos.z) - this.yaw);
      if (Math.abs(err) > 0.5) this.turningBack = true;
      if (Math.abs(err) < 0.08) this.turningBack = false;
      if (this.turningBack) rollIn = THREE.MathUtils.clamp(-err * 1.8, -1, 1);
    } else this.turningBack = false;

    const rollTarget = -rollIn * FLIGHT.maxRoll;
    this.roll += (rollTarget - this.roll) * damp(rollIn === 0 ? 2.1 : 2.8, dt);

    // Look ahead for rooftops and ask for enough climb to clear them.
    let need = 0;
    const flatSpeed = Math.max(20, this.speed * Math.cos(this.pitch));
    for (const t of [0.35, 0.8, 1.4, 2.2, 3.1]) {
      const d = flatSpeed * t;
      const top = this.heightAt(this.pos.x - Math.sin(this.yaw) * d, this.pos.z - Math.cos(this.yaw) * d) + 16;
      if (top > 16) need = Math.max(need, Math.atan2(top - this.pos.y, d));
    }
    const roof = this.heightAt(this.pos.x, this.pos.z);

    // Over an airfield the floor drops to the runway, so nose-down carries all the way to touchdown.
    const landing = this.field !== null && roof === 0;
    const floorY = landing ? FLIGHT.wheelsY : Math.max(FLIGHT.minAlt, roof + 6);
    const low = landing ? 0 : 1 - THREE.MathUtils.smoothstep(this.pos.y, FLIGHT.minAlt, FLIGHT.minAlt + 34);
    const high = THREE.MathUtils.smoothstep(this.pos.y, FLIGHT.maxAlt - 80, FLIGHT.maxAlt);

    let pitchTarget = input.pitch * FLIGHT.maxPitch;
    if (pitchTarget < 0) pitchTarget *= 1 - low;
    if (pitchTarget > 0) pitchTarget *= 1 - high;
    pitchTarget += low * 0.12 - high * 0.2;
    // Flare: flatten the last few metres of a landing so touchdown is soft.
    if (landing && pitchTarget < 0) pitchTarget *= THREE.MathUtils.smoothstep(this.pos.y, FLIGHT.wheelsY, FLIGHT.wheelsY + 30) * 0.75 + 0.25;
    // Once she is skimming the field, let her settle on without holding the stick forward.
    if (landing && this.pos.y < FLIGHT.wheelsY + 5 && input.pitch <= 0) pitchTarget = Math.min(pitchTarget, -0.06);
    const assisting = need > Math.max(pitchTarget, 0) + 0.01;
    if (assisting) pitchTarget = Math.min(need * 1.35 + 0.05, 1.05);
    this.assist += ((assisting ? 1 : 0) - this.assist) * damp(5, dt);
    this.pitch += (pitchTarget - this.pitch) * damp(assisting ? 5.5 : 2.3, dt);

    const target = input.boost ? FLIGHT.boost : FLIGHT.cruise;
    this.speed += (target - this.speed) * damp(input.boost ? 1.5 : 0.9, dt);
    this.speed = Math.max(34, this.speed - Math.sin(this.pitch) * 14 * dt);

    this.yaw = wrap(this.yaw + ((9.81 * Math.tan(this.roll)) / Math.max(this.speed, 40)) * 2.1 * dt);

    f.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    this.pos.addScaledVector(f, this.speed * dt);

    if (this.pos.y <= floorY) {
      if (landing) {
        this.state = 'ground';
        this.pos.y = FLIGHT.wheelsY;
        this.speed = Math.min(this.speed, 70);
        this.bump = 0.35;
        return;
      }
      // Never let the plane sit inside a roof or the ground: pop it up and report the bump.
      if (floorY - this.pos.y > 1.5 && roof > 0) this.bump = 1;
      this.pos.y += (floorY - this.pos.y) * damp(9, dt);
      this.pitch = Math.max(this.pitch, 0.04);
    }
    this.pos.y = Math.min(this.pos.y, FLIGHT.maxAlt);
  }

  get grounded() {
    return this.state === 'ground';
  }

  get stopped() {
    return this.state === 'ground' && this.speed < 0.6;
  }

  apply(object, t) {
    const air = this.state === 'air' ? 1 : 0;
    object.position.copy(this.pos);
    object.position.y += Math.sin(t * 1.7) * 0.25 * air;
    object.rotation.order = 'YXZ';
    object.rotation.set(this.pitch + Math.sin(t * 1.1) * 0.008 * air, this.yaw, this.roll + Math.sin(t * 0.9) * 0.012 * air);
  }

  get heading() {
    return (THREE.MathUtils.radToDeg(-this.yaw) + 360) % 360;
  }
}

export class ChaseCamera {
  constructor(camera, heightAt) {
    this.camera = camera;
    this.heightAt = heightAt;
    this.mode = 0;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.ready = false;
    this.fov = 56;
    this.orbit = 0;
    this.back = 42;
  }

  update(dt, flight, boostK, t) {
    const yawF = new THREE.Vector3(-Math.sin(flight.yaw), 0, -Math.cos(flight.yaw));
    const want = new THREE.Vector3();
    const lookWant = new THREE.Vector3();
    if (this.mode === 0) {
      // Sit well back at cruise so the plane is small against the city, then close in for the boost.
      const backWant = flight.grounded ? 26 : THREE.MathUtils.lerp(42, 29, boostK);
      this.back += (backWant - this.back) * damp(1.8, dt);
      const lift = flight.grounded ? 7 : this.back * 0.3;
      want.copy(flight.pos).addScaledVector(yawF, -this.back).add(new THREE.Vector3(0, lift - flight.pitch * 16, 0));
      lookWant.copy(flight.pos).addScaledVector(flight.forward, 24).add(new THREE.Vector3(0, 3, 0));
    } else {
      this.orbit += dt * 0.22;
      const a = flight.yaw + this.orbit;
      want.copy(flight.pos).add(new THREE.Vector3(Math.sin(a) * 46, 12 + Math.sin(this.orbit * 0.7) * 8, Math.cos(a) * 46));
      lookWant.copy(flight.pos);
    }
    want.y = Math.max(want.y, this.heightAt(want.x, want.z) + 5, 4);
    if (!this.ready) { this.pos.copy(want); this.look.copy(lookWant); this.ready = true; }
    this.pos.lerp(want, damp(this.mode === 0 ? 5 : 2.5, dt));
    this.look.lerp(lookWant, damp(9, dt));

    const cam = this.camera;
    cam.position.copy(this.pos);
    if (flight.bump > 0) cam.position.add(new THREE.Vector3(Math.sin(t * 61), Math.cos(t * 53), 0).multiplyScalar(flight.bump * 0.9));
    const bank = this.mode === 0 ? flight.roll * 0.42 : 0;
    cam.up.set(0, 1, 0).applyAxisAngle(yawF, -bank);
    cam.lookAt(this.look);
    this.fov += (56 + boostK * 19 - this.fov) * damp(3, dt);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }
}
