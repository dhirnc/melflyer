import {
  Fn, uv, vec2, vec3, vec4, float, mix, smoothstep, dot, max, abs, sin, cos, floor, time, screenSize, uniform, length, luminance,
  mx_noise_float, perspectiveDepthToViewZ, clamp, pow,
} from 'three/tsl';

const SECTORS = 8;
const LITE_SECTORS = 4;
const LITE_WEDGE = [[0.5, 0], [1, -0.3], [1, 0.3]];
// Offsets inside one 45 degree wedge, as [radius, angle]. Unrolled per sector at build time.
const WEDGE = [[0.34, 0], [0.68, -0.2], [0.68, 0.2], [1, -0.27], [1, 0], [1, 0.27]];

// Turns the lit frame into gouache: a generalised Kuwahara filter flattens detail into strokes that
// still respect edges, ink lines come from depth and normal discontinuities, then paper and grading.
// The lite variant takes a quarter of the texture taps and skips the per-pixel noise that only adds wobble.
export function painterly(source, depthTex, sceneNormal, camera, toggles, lite = false) {
  const sectors = lite ? LITE_SECTORS : SECTORS;
  const wedge = lite ? LITE_WEDGE : WEDGE;
  const near = uniform(camera.near);
  const far = uniform(camera.far);
  const strokeSize = uniform(3.4);

  return Fn(() => {
    const st = uv();
    const texel = vec2(1).div(screenSize);
    const px = st.mul(screenSize);
    const scale = screenSize.y.div(1080);

    const viewZ = (coord) => perspectiveDepthToViewZ(depthTex.sample(coord).r, near, far).negate();
    const z0 = viewZ(st).toVar();

    const centre = source.sample(st).rgb.toVar();

    // Keep the plane and other close things crisper than the far city.
    const radius = strokeSize.mul(scale).mul(mix(0.4, 1.0, smoothstep(30, 190, z0)));
    const turn = lite ? float(0.4) : mx_noise_float(vec3(px.mul(0.012), 0.0)).mul(0.9);
    const c = cos(turn), s = sin(turn);

    const total = vec3(0).toVar();
    const weight = float(0).toVar();
    for (let k = 0; k < sectors; k++) {
      const base = (k / sectors) * Math.PI * 2;
      const m = centre.toVar();
      const m2 = centre.mul(centre).toVar();
      for (const [r, a] of wedge) {
        const ox = Math.cos(base + a) * r, oy = Math.sin(base + a) * r;
        const off = vec2(c.mul(ox).sub(s.mul(oy)), s.mul(ox).add(c.mul(oy))).mul(radius).mul(texel);
        const tap = source.sample(st.add(off)).rgb;
        m.addAssign(tap);
        m2.addAssign(tap.mul(tap));
      }
      const n = wedge.length + 1;
      m.divAssign(n);
      const variance = dot(abs(m2.div(n).sub(m.mul(m))), vec3(0.299, 0.587, 0.114));
      // Squared falloff keeps every weight well above zero, so busy pixels average instead of going black.
      const w = float(1).div(float(1).add(pow(variance.mul(700), 2)));
      total.addAssign(m.mul(w));
      weight.addAssign(w);
    }
    const stroked = total.div(weight);
    const col = mix(centre, stroked, toggles.paint).toVar();

    // Ink. 1/z is linear across a flat surface in screen space, so its Laplacian only fires on real edges.
    const boil = floor(time.mul(7));
    const wobble = lite ? vec2(0) : vec2(mx_noise_float(vec3(px.mul(0.02), boil)), mx_noise_float(vec3(px.mul(0.02).add(31), boil))).mul(1.1);
    // Taps are snapped to whole texels and kept symmetric about the centre. Depth is point sampled,
    // so any sub-texel offset would read as an edge on distant ground seen at a grazing angle.
    const reach = max(float(1), scale.mul(1.25).round());
    const mid = st.add(wobble.round().mul(texel));
    const zc = viewZ(mid).toVar();
    const n0 = sceneNormal.sample(mid);
    const inv0 = float(1).div(zc);
    const invSum = float(0).toVar();
    const bend = float(0).toVar();
    for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const coord = mid.add(vec2(dx, dy).mul(reach).mul(texel));
      invSum.addAssign(float(1).div(viewZ(coord)));
      bend.addAssign(float(1).sub(dot(n0, sceneNormal.sample(coord))));
    }
    const depthEdge = smoothstep(0.012, 0.045, abs(inv0.mul(4).sub(invSum)).div(inv0));
    const normalEdge = smoothstep(0.35, 1.0, bend).mul(smoothstep(2600, 500, zc));
    const reachFade = smoothstep(7500, 2500, zc);
    const line = clamp(max(depthEdge, normalEdge), 0, 1).mul(reachFade).mul(toggles.ink).mul(toggles.paint);
    const pressure = lite ? float(0.8) : mx_noise_float(vec3(px.mul(0.006), 3.0)).mul(0.3).add(0.75);
    col.assign(mix(col, col.mul(vec3(0.2, 0.15, 0.3)), line.mul(pressure).mul(0.82)));

    // Grade: richer colour, violet in the shadows, warm paper in the lights.
    const g = col.toVar();
    const l = luminance(g);
    g.assign(mix(vec3(l), g, 1.2));
    g.addAssign(vec3(0.03, 0.0, 0.07).mul(smoothstep(0.5, 0.0, l)));
    g.mulAssign(mix(vec3(1), vec3(1.05, 1.0, 0.93), smoothstep(0.4, 1.0, l)));

    const grain = mx_noise_float(vec3(px.mul(0.55), 1.0)).mul(0.035);
    const blot = lite ? float(0) : mx_noise_float(vec3(px.mul(0.012), 7.0)).mul(0.04);
    const weave = sin(px.x.mul(1.3)).mul(sin(px.y.mul(1.3))).mul(0.012);
    g.mulAssign(float(1).add(grain).add(blot).add(weave));

    const d = length(st.sub(0.5).mul(vec2(1.0, 0.82)));
    g.mulAssign(mix(1.0, 0.8, smoothstep(0.4, 0.85, d)));

    // Ragged unpainted paper at the very edge of the sheet.
    const edge = max(abs(st.x.sub(0.5)), abs(st.y.sub(0.5)));
    const rag = lite ? mx_noise_float(vec3(px.mul(0.01), 11.0)).mul(0.014) : mx_noise_float(vec3(px.mul(0.01), 11.0)).mul(0.012).add(mx_noise_float(vec3(px.mul(0.05), 5.0)).mul(0.004));
    const paper = smoothstep(0.482, 0.492, edge.add(rag));
    const graded = mix(g, vec3(0.97, 0.94, 0.86).mul(float(1).add(grain)), paper);

    return vec4(mix(col, graded, toggles.paint), 1);
  })();
}
