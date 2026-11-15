# Melbourne Flyer

A dusk joyride over inner Melbourne in a little floatplane, rendered as a moving gouache painting.
three.js r187 `WebGPURenderer` with SSGI, SSR and TRAA, then a painterly pass.

```bash
npm install
npm run dev
```

Open http://localhost:5173 in a WebGPU browser (Chrome, Edge, Safari 26+).

## Controls

| Key | Action |
| --- | --- |
| `A` / `D` | bank left / right (steer on the ground) |
| `W` / `S` | nose down / nose up (`I` inverts) |
| `Space` | boost in the air, throttle on the ground |
| `C` | chase / orbit camera |
| `T` | time of day: dusk, night, midday, golden hour (also the button top left) |
| `1` `2` `3` `4` | toggle paint, ink, SSGI, SSR |
| `M` `H` | sound, hide HUD |

Let go of the stick and the plane levels itself and holds altitude. It climbs over rooftops on its own and
cannot crash. Fly through the gold hoops to collect postcards.

**Landing.** Over Melbourne Airport, Essendon Fields or Moorabbin, hold `W` and she settles onto the field.
Release everything and she brakes to a stop, which stamps the logbook. Hold `Space` to roll and `S` to lift off.

**Touch.** Drag anywhere on the picture and that point becomes a joystick: right banks right, pulling down
lifts the nose. A BOOST button appears bottom right. A mouse drag works the same way.

**Phones.** Touch devices get a lite build automatically: no SSGI, SSR or TRAA, a cheaper brush filter, fewer
trees and houses, smaller shadows redrawn every second frame, and a shorter draw distance for trees and outlying
houses. `?quality=full` or `?quality=lite` overrides the guess.

**Time of day.** Starts at dusk and remembers the last pick. `?time=golden|dusk|night|noon` sets it for one visit.

**Splash screens.** Three designs ship, brush script (A) by default. Pick with the A / B / C dots on the title screen or `?splash=a|b|c`.

## Growing the map

`region.json` is the only place the world's extent is set.

- `detail` is the box of real OpenStreetMap data. Widen it and run `npm run fetch-osm`. The ground mask,
  buildings, trees, trams and trains all size themselves from the baked data. When the new box contains the
  old one, only the new strips are downloaded and merged into the existing bake (`--full` forces a clean one).
  The public Overpass servers time out on dense areas, so the tool splits a failing box and retries.
- `flight` is the box the plane may roam before the wind turns it back.
- New airfields go in the `FIELDS` table in `src/world/airports.js`. Each entry becomes landable and gets a
  logbook card.
- New hand-built landmarks and hoops go in `src/world/landmarks.js`.

Outside `detail`, `src/world/outskirts.js` lays houses on a painted street grid, then woodland, then two
mountain rings on the horizon. The airfields sit just past the map edge rather than at their real distance.

## How it is put together

- `tools/fetch-osm.mjs` pulls buildings, building parts, water, coastline, parks, roads, rail, tram lines and
  street trees from Overpass and bakes them to `public/data/melbourne.json` in local metres. Raw responses are
  cached in `.cache/`. Re-run with `npm run fetch-osm`.
- `src/world/ground.js` paints that vector data into two mask canvases at load. One ground shader reads them
  for land, water, parks, sand and roads.
- `src/world/buildings.js` extrudes about 55,000 footprints into tiled meshes and builds the height field the
  plane uses to avoid rooftops.
- `src/world/landmarks.js` holds the hand-modelled landmarks and the postcard list. `airports.js` and `coast.js`
  hold the airfields and the St Kilda kite surfers. `life.js` runs trams, trains,
  balloons, boats, clouds and birds.
- `src/world/daylight.js` is the table of times of day. Add a row and it joins the cycle. `sky.js` turns the
  current row into sky, fog, lights and reflections.
- `src/world/detail.js` swaps distant tree tiles for a cheap stand-in, hides the furthest ones on phones, and
  feeds unseen meshes to the GPU a few per frame behind the title screen.
- `src/fx/pipeline.js` is the render graph. `src/fx/painterly.js` is the Kuwahara, ink and paper pass.
- `src/plane/` holds the plane model, the flight model and the chase camera.

## Deploying

The site is static: `npm run build` writes everything to `dist/`.

- **Cloudflare.** The repo is connected in the Cloudflare dashboard as the Worker `dc-melflyer`, serving static
  assets. Its Git build runs `npm run build` then `npx wrangler deploy`, and `wrangler.toml` points that at `dist/`.
  `public/_headers` sets caching. Every push to `main` deploys, and other branches get a preview URL.
  For a one-off deploy from a laptop: `npm run build && npx wrangler deploy`.
- **GitHub Pages.** `.github/workflows/pages.yml` still deploys `main` to `<user>.github.io/melflyer`. Delete it
  once Cloudflare is live.

## Credits

- Map data © OpenStreetMap contributors, ODbL.
- `public/models/Stork.glb` comes from the three.js examples.
- The plane and landmarks are modelled in code.
