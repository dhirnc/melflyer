// Tiny synthesised soundscape: a prop drone, wind that rises with speed, and a chime for postcards.
export function createAudio() {
  let ctx = null, engine, engineGain, wind, windGain, master;
  let muted = false;

  const start = () => {
    if (ctx) return;
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);

    engineGain = ctx.createGain();
    engineGain.gain.value = 0.05;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 420;
    engine = [ctx.createOscillator(), ctx.createOscillator()];
    engine[0].type = 'sawtooth';
    engine[1].type = 'square';
    engine.forEach((o) => { o.connect(tone); o.start(); });
    tone.connect(engineGain).connect(master);

    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    wind = ctx.createBiquadFilter();
    wind.type = 'bandpass';
    wind.Q.value = 0.6;
    windGain = ctx.createGain();
    windGain.gain.value = 0.02;
    noise.connect(wind).connect(windGain).connect(master);
    noise.start();
  };

  // Phones suspend audio when the tab is backgrounded, the screen locks or a call comes in, and do not
  // bring it back on their own. Any touch or key resumes it.
  const wake = () => { if (ctx && ctx.state !== 'running') ctx.resume(); };
  for (const type of ['pointerdown', 'touchend', 'keydown']) addEventListener(type, wake, { passive: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });

  return {
    start() {
      start();
      wake();
    },
    sleep() {
      if (ctx && ctx.state === 'running') ctx.suspend();
    },
    toggle() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.5;
      return muted;
    },
    update(speedK) {
      if (!ctx) return;
      const now = ctx.currentTime;
      engine[0].frequency.setTargetAtTime(62 + speedK * 46, now, 0.15);
      engine[1].frequency.setTargetAtTime(93 + speedK * 69, now, 0.15);
      engineGain.gain.setTargetAtTime(0.045 + speedK * 0.03, now, 0.2);
      wind.frequency.setTargetAtTime(500 + speedK * 1400, now, 0.2);
      windGain.gain.setTargetAtTime(0.025 + speedK * 0.11, now, 0.2);
    },
    chime() {
      if (!ctx || muted) return;
      [659.25, 783.99, 987.77, 1318.5].forEach((f, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'triangle';
        o.frequency.value = f;
        const t = ctx.currentTime + i * 0.09;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.16, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
        o.connect(g).connect(master);
        o.start(t);
        o.stop(t + 1);
      });
    },
  };
}
