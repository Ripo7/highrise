# Highrise

Sculpt a mountain, send a skier, chase the perfect line. A browser 3D game where shaping the terrain is the gameplay.

This is **Phase 0**: a grey-box prototype to prove the core loop is fun before any art investment.

**Sculpt → send → watch → tweak → repeat.**

## Play

| Action | Mouse / keyboard | Touch |
| --- | --- | --- |
| Sculpt | Left-drag (hold to keep building) | One finger |
| Orbit | Right-drag or Alt-drag | Orbit tool, one finger |
| Pan / zoom | Shift+right-drag or middle-drag / scroll | Two fingers / pinch |
| Tools | `1` Raise · `2` Lower · `3` Smooth · `4` Flatten · `5` Start gate · `V` Orbit | Tool bar |
| Brush size | `[` `]` | Slider |
| Send skier | `Space` | Send skier |
| Ride: steer | `←` `→` or `A` `D` | Hold ◀ ▶ |
| Ride: tuck / brake | `↑` `W` / `↓` `S` | Hold Tuck / Brake |
| Ride: camera | `C` (chase ↔ helmet) | Camera button |
| Ride: back to sculpting | `Esc` | ‹ button |
| Undo / redo | `Ctrl+Z` / `Ctrl+Shift+Z` | Buttons |
| Contours, reset view | `C`, `R` | ••• menu |

Your mountain, start gate and best time autosave in the browser. **New mountain** opens the picker.

## Mountains

Every run is 1.2 km long (240 m wide). Start from:

| Mountain | Level | Hands-off run |
| --- | --- | --- |
| Blank slope | Build it yourself | An even 18° face, ~50 s |
| Meander Valley | Easy | Banked bends down a rolling valley, ~77 s |
| Kicker Line | Jumps | Five kickers with long landing hills, five clean jumps, ~50 s |
| Couloir | Expert | Steep bowl, narrow couloir, mogul field, fast finish, ~50 s at up to 130 km/h |

Templates live in `src/core/templates.js`: each is a slope profile along the run plus a cross-section function, so new ones are quick to add. The tests check that every template is skiable hands-off and takes over 40 s.

## What's in the prototype

- **Heightfield terrain** (193 × 961 samples, 1.25 m apart: a 240 m × 1200 m piste) with raise, lower, smooth and flatten brushes, soft cosine falloff and a live cursor ring.
- **Skier physics**: a point mass with gravity, snow friction and air drag. It leaves the ground on its own when the slope falls away faster than gravity can follow, so kickers and crests create real jumps. Landings are judged by impact speed into the slope: soft, rough (speed loss) or crash.
- **Ride mode**: sending the skier drops the camera behind him (chase cam or helmet cam) and you can steer, tuck and brake. The skis have a heading and edge grip carves the velocity towards it; hands off, the skier simply follows the terrain. Land with the skis sideways and you crash.
- **Run outcomes**: finish, crash, stopped (not enough slope), off the edge, too slow.
- **Feedback**: live trail, the previous run as a dashed blue ghost line, topographic contours (2 m / 10 m), run stats and personal best.
- **Diorama look**: the mountain is a block with stratified sides on a base slab.

## Exit test for Phase 0

Hand it to a few people. Do they say "one more tweak" and keep going? If not, fix the feel before moving to Phase 1.

## Develop

```bash
npm install
npm run dev      # local dev server
npm test         # physics + brush tests (Node, no browser needed)
npm run build    # production build into dist/
```

Stack: [Vite](https://vite.dev) + [Three.js](https://threejs.org). The simulation core in `src/core/` has no Three.js dependency, so it runs in tests and can later move to a worker.

```
src/
  core/        heightfield, brushes, undo history, skier physics (pure JS)
  render/      terrain mesh + shader, skier mesh, trails
  ui.js        overlay controls
  main.js      scene, input, game loop
tests/         node:test suites
```

## Deploy

Vercel detects Vite automatically: import the repo, keep the defaults (build `npm run build`, output `dist`), deploy.
