# Highrise

Sculpt a mountain, send a skier, chase the perfect line. A browser 3D game where shaping the terrain is the gameplay.

This is **Phase 0**: a grey-box prototype to prove the core loop is fun before any art investment.

**Sculpt → send → watch → tweak → repeat.**

## Play

| Action | Mouse / keyboard | Touch |
| --- | --- | --- |
| Sculpt | Left-drag (hold to keep building) | One finger |
| Orbit / zoom | Right-drag / scroll | Two fingers |
| Tools | `1` Raise · `2` Lower · `3` Smooth · `4` Flatten · `5` Start gate · `V` Orbit | Tool bar |
| Brush size | `[` `]` | Slider |
| Send skier | `Space` | Send skier |
| Undo / redo | `Ctrl+Z` / `Ctrl+Shift+Z` | Buttons |
| Follow cam, contours, reset view | `F`, `C`, `R` | — |

Your mountain, start gate and best time autosave in the browser.

## What's in the prototype

- **Heightfield terrain** (257 × 257, 240 m square) with raise, lower, smooth and flatten brushes, soft cosine falloff and a live cursor ring.
- **Skier physics**: a point mass with gravity, snow friction and air drag. It leaves the ground on its own when the slope falls away faster than gravity can follow, so kickers and crests create real jumps. Landings are judged by impact speed into the slope: soft, rough (speed loss) or crash.
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
