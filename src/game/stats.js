const STALL_MS = 50;

// ?stats puts a small readout on screen, for judging smoothness on a device with no dev tools attached.
// It reports real frame intervals, and logs each stall with what the loader was doing at the time, so a
// screenshot of it says where the time went. Without ?stats this returns a no-op.
export function createStats(describe) {
  if (!new URLSearchParams(location.search).has('stats')) return () => {};
  const box = document.createElement('pre');
  box.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:9;margin:0;padding:6px 8px;font:11px/1.35 ui-monospace,monospace;color:#fff;background:rgba(0,0,0,.72);border-radius:6px;pointer-events:none;white-space:pre';
  document.body.appendChild(box);

  const began = performance.now();
  let last = began, shown = began, frames = 0, worst = 0, stalls = 0;
  const recent = [];
  return () => {
    const now = performance.now();
    const gap = now - last;
    last = now;
    frames++;
    worst = Math.max(worst, gap);
    if (gap > STALL_MS) {
      stalls++;
      recent.push(`${((now - began) / 1000).toFixed(1)}s  ${Math.round(gap)}ms  ${describe()}`);
      if (recent.length > 6) recent.shift();
    }
    if (now - shown < 1000) return;
    box.textContent = [
      `${Math.round((frames * 1000) / (now - shown))} fps   worst ${Math.round(worst)}ms   stalls ${stalls}`,
      describe(),
      ...recent,
    ].join('\n');
    shown = now;
    frames = 0;
    worst = 0;
  };
}
