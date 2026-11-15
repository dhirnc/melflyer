# Melbourne Flyer: notes for agents

A static three.js r187 WebGPU game. No backend, no tests, no linter. `README.md` has the player-facing docs and
the map of the source tree. This file holds what the code does not tell you.

## Commands

```bash
npm ci              # a fresh worktree has no node_modules
npm run dev         # http://localhost:5173, strict port. Agents: start it through .claude/launch.json
npm run build       # writes dist/. Run it before calling a change done; it is the only automated check
npm run fetch-osm   # rebakes public/data/melbourne.json from region.json. Slow, hits public Overpass servers
```

## Two render paths

`LITE` in `src/config.js` picks the path once at load. Touch devices get lite, everything else full.
Every visual change has to be checked on both.

| | full | lite |
| --- | --- | --- |
| Force with | `?quality=full` | `?quality=lite` |
| Post | SSGI, SSR, TRAA, bloom, 49-tap brush filter | brush filter only, 13 taps |
| Shadows | 4096 map, every frame | 2048 map, every second frame |
| Scenery | everything | thinner trees and houses, shorter draw distance (`src/world/detail.js`) |

Other URL switches: `?time=golden|dusk|night|noon`, `?splash=a|b|c`.

## Checking your work

- In dev, `window.__mel` exposes the renderer, scene, flight model, daylight and detail manager.
  Pose a screenshot with `__mel.flight.pos.set(x, y, z); __mel.flight.yaw = radians`. `__mel.dev.hold = true` freezes the plane.
- `__mel.renderer.info.render` gives draw calls and triangles for the last frame. **Use these counts to judge
  phone cost.** Frame times on a desktop GPU are 1 to 3 ms and vary 3x run to run, so they say nothing about a phone.
  Reference at the start position on lite: about 1.1M triangles and 330 draws (was 2.0M and 430 before tree LOD).
- Screenshots need the Browser pane visible and the app window uncovered, or they time out.
- A real phone is the only real test of smoothness. Cloudflare builds a preview URL for every pushed branch.

## Rules the owner has set

- **Never push to `main` without showing screenshots and getting a yes.** `main` deploys to the public site.
  Work on a branch or worktree and open a pull request.
- The plane never crashes. No fail states, no timers.
- Dusk is the default time of day. Midday must not look blown out.
- "Lower sun" means more orange, not less. Read direction words carefully and confirm with a screenshot.
- Resolution matters more than frame rate on phones. Do not lower the pixel ratio floor to buy frames.
- A hidden tab does no work: the loop stops and audio sleeps.

## Things that went wrong before

- **Resolution that climbs back up.** Adaptive resolution once stepped up again when frames recovered. It found a
  level the GPU could not hold, dropped, and climbed again, which read as constant stutter and was first blamed
  on the time-of-day feature. Resolution now only steps down, after three slow seconds.
- **A blocking warm-up.** Drawing the whole city unculled in one frame before take-off hung on "warming up the
  engine" on some machines. `detail.js` now primes four meshes per frame behind the title screen instead.
- **Swapping the environment texture.** Assigning a different texture to `scene.environment` makes every lit
  material rebuild, a 200 ms stall on a desktop. Baking it (`PMREMGenerator.fromScene`) is only 2 ms. `daylight.js`
  asks for one rebuild, when a change of hour has settled. Rendering into the same target in place was tried and
  throws WebGPU validation errors.
- **A fully opaque title screen.** Behind one the browser never composites the canvas, and the first time it does
  costs about 700 ms, which landed on take-off. `#title` sits at opacity 0.996 so that happens during loading.
- **A flat sun.** Below about 11 degrees the shadow map smears along the ground and pulls far more buildings into
  the shadow pass. `daylight.js` keeps `lightDir` above that while `sunDir` (the painted disc) goes as low as it likes.

## Conventions

- World units are metres. x is east, z is south, so north is -z. `ll(lat, lon)` in `config.js` converts.
- Content lives in tables: `TIMES` in `daylight.js`, `FIELDS` in `airports.js`, `RANGES` in `detail.js`, the
  landmark and postcard lists in `landmarks.js`, the extent in `region.json`. Add a row before adding a branch.
- Anything that changes with the hour reads a uniform from `day` in `daylight.js`. Do not bake a light colour
  into a material.
- New instanced scenery calls `tagDetail(mesh, kind)` so it gets a draw distance and is primed.
- Comments say why, not what. No build step beyond Vite, no TypeScript, no framework.
- `public/data/melbourne.json` is generated. Change `tools/fetch-osm.mjs` or `region.json`, never the file.
