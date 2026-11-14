const RADIUS = 64;

// Drag anywhere on the picture and that point becomes the centre of a virtual stick.
// Right is bank right, pulling down is nose up, same as a real stick. Works with a mouse too.
export function createTouch(surface) {
  const stick = { x: 0, y: 0, boost: false };
  const base = document.getElementById('stick');
  const knob = base.firstElementChild;
  const boost = document.getElementById('boost-btn');
  let pointer = null, ox = 0, oy = 0;

  const coarse = matchMedia('(pointer: coarse)').matches;
  document.body.classList.toggle('touch', coarse);

  const release = () => {
    pointer = null;
    stick.x = stick.y = 0;
    base.classList.remove('on');
  };
  surface.addEventListener('pointerdown', (e) => {
    if (pointer !== null) return;
    if (e.pointerType !== 'mouse') document.body.classList.add('touch');
    pointer = e.pointerId;
    ox = e.clientX;
    oy = e.clientY;
    try { surface.setPointerCapture(pointer); } catch { /* pointer already gone; moves still arrive while over the canvas */ }
    base.style.left = `${ox}px`;
    base.style.top = `${oy}px`;
    knob.style.transform = 'translate(-50%, -50%)';
    base.classList.add('on');
  });
  surface.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointer) return;
    let dx = e.clientX - ox, dy = e.clientY - oy;
    const len = Math.hypot(dx, dy);
    if (len > RADIUS) { dx *= RADIUS / len; dy *= RADIUS / len; }
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    // A small dead zone so a resting thumb does not steer.
    const shape = (v) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
    stick.x = shape(dx / RADIUS);
    stick.y = shape(dy / RADIUS);
  });
  for (const type of ['pointerup', 'pointercancel']) surface.addEventListener(type, (e) => { if (e.pointerId === pointer) release(); });

  const hold = (on) => (e) => {
    e.preventDefault();
    stick.boost = on;
    boost.classList.toggle('on', on);
  };
  boost.addEventListener('pointerdown', hold(true));
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) boost.addEventListener(type, hold(false));
  addEventListener('contextmenu', (e) => e.preventDefault());
  return stick;
}
