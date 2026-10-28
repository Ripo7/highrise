# Highrise

Design a slope section by section, select its hexagon tiles and shape them, start anywhere, ride it, build some more, ride on. A browser 3D game where making the mountain is the gameplay.

This is **Phase 0**: a grey-box prototype to prove the core loop is fun before any art investment.

**Design → select → act → ride → pause → act again → ride on → repeat.**

## Play

**Design** a slope, **shape** it, **ride** it from wherever you like, and score on **style**. No pistes: the whole mountain is yours, terrain and nature.

### Design the slope

The first thing you do, **right on the mountain in 3D**: stack **sections** down the slope, top to bottom, each with its **slope** (−15° climbing to 50°, 1° at a time) and its **length** (20 to 400 m, 10 m at a time), up to 24 sections and 3 km. The snow is rebuilt as you change it. Each section is tinted on the snow like a piste marker (green under 12°, blue to 22°, red to 32°, black beyond, purple for a climb), with a line at each joint and a label (`2 · 22° · 160 m`) over it.

- **Drag the dot** at the bottom of a section: along the slope it sets the length, up and down the pitch (the sections below keep theirs). **Side** (the view buttons over the mountain) shows the slope's whole profile, the best way to shape it.
- **Tap a section** (or its label) to pick it; the bar at the bottom edits it: − / + for its pitch and its length (press and hold to run through the values), add a section after it, remove it. ← → pick a section, ↑ ↓ its pitch, Shift+↑ ↓ its length; Ctrl+Z undoes.
- Pick the **width** (Narrow 360 m, Medium 540 m, Wide 720 m), start from a template (**Classic**, **Cruiser**, **Park**, **Big mountain**) or from one of **My projects**. The bar shows the length, the drop, the average and the steepest pitch.
- **Build it** (`Enter`) keeps it; **Cancel** (`Esc`) puts the slope back as it was, with what you built and your records.

The joints between sections are eased over a few metres, so a change of pitch rolls over or scoops instead of kinking. The top of the slope stays where it is while you edit, so the camera does too.

The slope is bare snow, the same all the way across: no rolls, forest or rock but what you add with the tiles. **Edit the slope** (`N`, ••• menu) opens the editor again; **Keep what I built** leaves your tiles where they were (counted from the top, centred if the width changes) and the start gate too.

### Projects: save as, open

**Save as…** (••• menu, `Ctrl+S`) saves the slope under a name: the slope, the tiles, the start gate and the records. Its name shows by the title; `Ctrl+S` saves it again. **Projects** (••• menu, or **My projects** in the slope editor) lists them, latest first, with their length, gates, tiles and best time: open one to carry on with it or to start a new slope from it (it asks first if what you have isn't saved), or delete one. They're kept in the browser.

### The view buttons

There's no Look or Select tool: a tap or a drag on the snow always selects tiles. The view has its own buttons, **floating over the mountain** (top right; on a phone, above the bar):

- **Rotate** and **Move**: drag the button itself to turn or slide the view; or tap it, and drags on the snow turn (or slide) the view until you tap it again (or `Esc`). `V` toggles Rotate.
- **Top**: straight down on what you're looking at, the slope going up the screen. **Side**: from the side of the slope (in the slope editor, the whole profile).

The mouse still turns with the right button, slides with the middle one and zooms with the wheel; on a phone, pinch to zoom, two fingers to slide and twist to turn.

### Learn: the tutorial

**Thirteen short levels**, one action (or two) at a time: Select (the brush sizes, and a double tap to pick a piece again), Raise and lower, Flatten, Smooth, Steepen and ease, Jump (with the start gate, and a second in the air), Drop, Rocks, Gates (and a run through them), Trees and clearings, Powder and ice, Copy / paste / rotate, Erase. Each level is a small slope of its own; its card (top left, or under the scoreboard on a phone) lists the steps, the tiles to work on are **marked on the snow** (a pink outline), and the tab and the button to press pulse in the bar. A step is ticked as soon as it's done, including the ones you ride. Restart, skip or pick any level from the list; progress is kept.

Start it from the welcome card or the ••• menu (**Tutorial**). Your own slope is put aside meanwhile (nothing is saved during the tutorial) and comes back as it was when you leave (✕).

### English and French

The whole game is in **English and French** (`src/i18n.js`, `src/tutorialText.js`): it follows the browser's language, and the ••• menu switches (**Français** / **English**), remembered in the browser. Numbers are written the French way too (1,5 m).

### Set a course: gates, best time, best score

Put **gates** on the tiles (Features ▸ **Gate**): the tiles of one tap make one gate, two poles across the fall line as far apart as the tiles are wide (one tile: about 9 m; select a row for a wider one). They're numbered down the mountain, red and blue in turn like a slalom, with their number floating over them while you build; gates above the start gate don't count. Tap Gate again on a gate to take it away; Erase, Copy / Paste and Undo know them too, and trees keep out of them.

**A run counts only through every gate**: between the poles, going down (flying over the line counts). Ride past one outside its poles and the feed says *Missed gate 3*: the run goes on, but it won't count. The scoreboard shows the gates done (`2/4`, red once one is missed), each gate gives points and its **split time**, against your fastest run's (`12.4 s · −0.38 s`).

Valid runs set two records: the **best score** and the **best time** (to the hundredth), both in the scoreboard and on the results card (*New best time*, the time against the best, the gates and the ones missed). With gates, the ghost is your fastest run, to race. A different course (a gate added, moved or taken away) starts its records again; building the snow around the gates doesn't.

### Start anywhere, pause, ride on

1. **Start** (`G`): tap or drag on the snow to put the start gate anywhere (tap Start again to go back to selecting). It faces down the fall line, and the trees around it make room.
2. **Ride** (`Space`): the skier sets off from the gate. The run ends at the bottom of the mountain (a finish line runs right across it), or when he stops or wipes out for good.
3. **Build** (`Esc`, `B` or `Tab` while riding) **pauses the run**: the skier waits where he is, marked by a ring, and the camera looks down on him and the snow ahead. Build anything, anywhere (right in front of him if you like).
4. **Ride on** (`Space`) carries on with the same run, from the same place, at the same speed, on the snow as it is now. **From the start** (`Shift`+`Space`, or `R` while riding) begins a new run at the gate.

### Select tiles, then act on them

The mountain is covered in **hexagon tiles** (about 10 m across, in rows across the slope). Tap or drag on the snow to pick tiles (always: there is no Select tool to pick first), a brush of 1, 7 or 19 at a time (S M L at the end of the bar) (`[` `]`: the tile, its six neighbours, two rings round it). Strokes add to the selection; one that starts on a selected tile takes tiles away. The chip at the top of the bar shows how many are selected: tap it (or `Esc`) to deselect. A second finger turns a stroke into a pinch, and the selection goes back to how it was.

**Double-tap (or double-click) something you built to select all of it again**: the gate, the jump, the terrace, the hill you raised, the wood... (a piece made in one tap is its group; the rest are the connected tiles changed the same way). Double-tap again for the next piece there, ending with everything built that touches it; with `Shift` it adds to the selection. `A` selects everything built.

**Faster with a keyboard**: `1`–`9` do the actions of the tab on show (the number is on each button), `Shift`+`1`–`4` change tab, `.` does the last action again; `+` `-` raise and lower, `F` flatten, `Q` rotate, `X` erase. **On a phone**: pinch to zoom, two fingers to pan and **twist to turn the view**, without leaving Select.

Then act on the selection. Actions stay on the tiles, so they stack (tap again for more), mix (trees on a raised, smoothed tile) and undo one tap at a time. The buttons show what the selection holds (`+3` m, `2/3`):

| Tab | Action | What it does |
| --- | --- | --- |
| Shape | **Raise** / **Lower** (`+` `-`) | Lifts or digs the snow 1.5 m a tap (up to 15 m). Side by side, raised tiles make a ridge or a hill, lowered ones a bowl or a gully. |
| | **Flatten** (`F`) | Levels the selection to one height (its average): a shelf or a terrace cut into the slope, with banks round it. Raise it afterwards and it stays level. |
| | **Smooth** | Smooths the rolls and lumps away and keeps the slope (three taps for the most). |
| | **Steepen** / **Ease** | A steeper or gentler pitch, a third at a time; an eased one leaves a lip at its lower edge. |
| Features | **Jump** | A kicker facing down the fall line: a curved ramp up to a lip at about 24°, and the snow falling away behind it. Its size comes from the selection: one tile is a 1.6 m kicker, three in a line one of 4.5 m. A chevron on the tiles shows the way it faces. |
| | **Drop** | A sharp step to drop off (2 to 5 m), a shelf above it and a landing below. |
| | **Rocks** | A band of bare rock across the slope: a cliff face and a run-out. |
| | **Gate** | A gate of the course (see above): one per tap, as wide as the tiles, on top of anything else (a gate on a jump: jump through it). |
| Nature | **Trees** | Plants pines, sparse, a wood, then dense (three taps). |
| | **Clear** | No trees at all here, the natural forest included. |
| | **Powder** / **Ice** | Deep, slow, soft snow, or hard, fast ice where the edges barely hold. Tap again for packed snow. |
| Tools | **Copy** / **Paste** (`Ctrl+C` / `Ctrl+V`) | Copies the selected tiles and everything on them; Paste puts them down where you tap (drag to place them), and selects them. Pasted jumps are jumps of their own. |
| | **Rotate** (`Q`) | Turns the selected jumps and drops a twelfth of a turn; while pasting, turns the copy a sixth of a turn. |
| | **Erase** (`X`, `Delete`) | Back to the bare slope on these tiles. |

**Everything merges.** Nothing is stamped tile by tile: the tiles of one action make one mask, blurred into a smooth field that shapes the snow, so neighbours are one shape with no seam, step or hexagon corner, and raised beside lowered rolls into one shape. Jumps made one after the other side by side become one wide kicker (one lip, the same height all along); a terrace is cut and filled with banks the snow can hold (30° to 40°, never a cliff) whatever the pitch, its edge round rather than hexagonal; a big raise or dig spreads its flanks (a hill and a bowl, not a tower and a pit). On the snow, changed tiles are tinted by what changed (blue shape, green nature, orange features) and the selection is outlined in amber.

**The light follows the snow**: the shading uses a normal per pixel (a half-float normal map from the heightfield), so banks, rolls and kickers shade smoothly with no facets or stair steps; ice is glassy blue with streaks and a sheen, powder soft and pillowy.

### Snow

- **Packed snow** everywhere by default: firm and quick, the edges bite.
- **Powder** where you put it: slower (the skis plough), they sink, turns are softer and skid more, landings are more forgiving and the spray turns into clouds.
- **Ice** where you put it: less than half the friction and well under half the grip, so you go faster and every turn is wider.
- **Bare rock** on cliffs, rock bands and any face too steep to hold snow (about 45°; a kicker's back stays snow) rides like hard snow.
- **Ski tracks stay in the snow** run after run: two thin grooves when you carve, a trench in powder, a wide smear where you skid. They start right at the skis. **Fresh snow** (••• menu) covers them. They're saved in the browser.

### The camera (drone view)

| Action | Mouse / keyboard | Touch |
| --- | --- | --- |
| Orbit | Right-drag, or drag Rotate (`V`: Rotate on, then left-drag) | Drag Rotate, or tap it then one finger; twist two fingers |
| Pan / zoom | Middle-drag (or drag Move) / scroll | Two fingers (or drag Move) / pinch |
| From above / the side | Top / Side | Top / Side |
| Reset the view | `R` | ••• menu |
| Relief view | `T` | Relief button |

### Riding

| Action | Keyboard | Touch |
| --- | --- | --- |
| Carve (a little), skid (all the way) | `←` `→` or `A` `D` | Left thumb: slide left/right |
| Hockey stop (fast), snowplough (slow) | `↓` / `S` | Left thumb: drag down |
| Tuck (slow: push with the poles) | `↑` / `W` | Left thumb: drag up |
| Spin / flip in the air | `←` `→` / `↑` front flip, `↓` backflip | Left thumb in the air |
| Crouch, then jump | Hold `Space`, release | Hold Jump, release |
| Absorb a big landing | Hold `Space` before touchdown | Hold Jump before touchdown |
| From the start / camera / pause and build | `R` / `C` / `Esc` | Buttons top left |
| Sound | `M` | ••• menu |

**How the skis feel.** The skier is a point mass with real numbers: air drag for a skier standing (CdA ≈ 0.55 m²) or tucked (≈ 0.23 m²), snow friction that grows with the load in a turn, and skis that grip up to about 2.3 g on packed snow. A light touch on the stick **carves**: the skis bend into an arc and hold it, with almost no slip and no speed lost (about 7 m radius at 30 km/h, 20 m at 55, 60 m at 110, tighter is not possible at speed). All the way over, the tails break loose and the skis **skid**: a sharper turn that scrubs speed. Pull back and they swing across into a **hockey stop** (50 → 0 km/h in about 2.5 s on a medium slope); slow, it's a snowplough. Hands off, the skis follow where you're going and drift towards the fall line. The skier **leans into the turn** by the actual forces (up to 62°), angulating at the hips. Top speeds: about 85 / 130 km/h (standing / tucked) on a gentle mountain, 105 / 160 on a medium one, 120 / 185 on a steep one.

Hold to load a jump (the ring fills) and release at a lip (a kicker, a raised crest, an eased shelf, a drop) to fly higher. Land with the skis straight and upright: clean landings score full points, sketchy ones half and cost speed, and only a really bad one is a wipeout (you lose the combo, tumble, get up and carry on). Let go of the stick in the air and the skier straightens up and finishes a nearly-complete flip by himself. Hitting the edge of the mountain just bumps you back.

**Speed bonus:** above 100 km/h a speed streak builds (40 points a second at 100 km/h, +3 per extra km/h: about 170/s at 145 km/h). It's banked once you've been back under 100 for 0.8 s, or at the finish, and lost on a wipeout. Tricks landed within 2.6 s of each other chain into a combo (×1.5, ×2, … up to ×5). A see-through ghost replays your best run.

Your slope, tiles (gates included), start gate, best score and best time, ghost, ski tracks and the project it's saved as autosave in the browser (save v12; v9 to v11 saves load with their tiles, their ghosts moved to the new height of the slope). Saves from the wild mountains become sections of about the same length, width and steepness, with their tiles kept (and painted pieces from before the tile actions become the matching actions: a bump raised 3 m, a flat eased all the way, a wall steepened, forest planted, powder kept). Saves from before the wild mountains are kept aside, untouched, and you start on a new slope.

## How the mountain is built

- `src/core/slopes.js` is the slope you design: sections, width, templates, limits and stats, the side profile (pitches eased at the joints, integrated metre by metre), a section's joint dragged to a point (its length and pitch), and the bare heightfield built from it with its top at a fixed height, kept as the base. `src/slopeMode.js` is the editor's bar, `src/render/slopeGuides.js` its labels, dots and profile in 3D (the tint of the sections is the terrain shader's).
- `src/core/pieces.js` finds the pieces of what you built a tile is part of (for the double tap); `src/projects.js` keeps the projects, `src/projectsDialog.js` is their dialog; `src/viewButtons.js` the view buttons.
- `src/core/hex.js` is the grid: pointy-top hexagons in rows across the slope (odd rows shifted half a tile), which tile a point is in, a tile's centre and corners, brushes (1, 7, 19 tiles) and lines of tiles (a fast drag leaves no gaps).
- `src/core/tiles.js` is what's on the tiles: a record per changed tile (how far raised, how steepened, its flatten group, how smoothed, a jump or drop with its facing and group, trees, a clearing, powder or ice) and the actions as pure functions on them, with copy and paste in axial coordinates (so a shape keeps its form on any row) and rotation.
- `src/core/terrain.js` turns the tiles into snow, in order on the bare slope: steepen / ease and rock bands change the slope along the fall line, column by column, then ease back to the mountain below; each flatten group is levelled to its own average; raise / lower adds a blurred field of the lifts; smooth blends towards a blurred copy of the snow; each jump or drop group is shaped along its facing (its length sets its size, its width comes from the tiles); powder adds pillows. Every field is a mask of tiles and three box blurs (a near-gaussian).
- `src/core/course.js` is the course: the gates from the tiles (where, how wide, facing down the fall line, numbered down the mountain), and a run through them (between the poles or a miss, the splits).
- `src/core/world.js` puts it together on every action: base, tiles, then the snow (packed / powder / ice / rock in `src/core/surface.js`, kickers kept snowy) and the trees and boulders, kept off the rock, the jumps and the drops, and clear of the start gate and the gates. A rebuild takes a few milliseconds.
- The hexagon grid, the tinted tiles, the selection outline, the brush or paste preview, the jump chevrons, the start ring and the finish line are drawn by the terrain shader (`src/render/terrainMesh.js`); `src/buildBar.js` is the bar at the bottom.

## Trees and rocks

They're obstacles: brushing one is a bump that costs a little speed, hitting one head-on (over ~40 km/h straight into it) is a wipeout. Rocks can be jumped. They're drawn as instanced meshes, so thousands cost a few draw calls.

## What's in the prototype

- **Heightfield terrain**: as big as the mountain (1.5 m cells, 1.8 m on the large one), kept under about 430,000 vertices for phones.
- **Skier physics** (`src/core/skier.js`): a point mass with gravity, load-dependent snow friction and air drag; carving limited by ski grip and the shortest arc a ski can bend, skidding, hockey stops, snowplough and poling. Legs soak up small rolls; it leaves the ground when the slope falls away faster than gravity can follow, so bumps, lips and cliffs create real jumps. Landings are judged by impact speed into the slope: soft, rough (speed loss) or crash.
- **Tricks and style**: crouch-and-pop jumps with a short grace window after the lip, spins and front/back flips in the air, landings judged on impact, ski angle and balance, named tricks ("Switch Double Backflip 540"), combos, a results card and a ghost of your best run (`src/core/score.js`, tested).
- **Ride mode**: the camera drops low behind the life-size skier (chase cam, which ducks under the trees rather than through them, or helmet cam) and you carve, skid, stop and tuck. Speed shows: the lens widens, the camera rumbles, snow sprays off the ski tails (more the harder you skid, bursts on landing) and the screen edges streak. Land with the skis sideways and you crash.
- **Run outcomes**: finish (the bottom of the mountain), stopped (not enough slope), too slow. A run can be paused to build and picked up again.
- **Relief view** (Relief button or `T`): colours every point by how far it sits above or below its surroundings (a ~50 m blur) — crests warm orange, hollows cool blue — with low two-sun shading and 2 m / 10 m contours, so bumps, hollows and cliffs read at any distance.
- **Feedback**: live trail, the previous run as a dashed blue ghost line, topographic contours (2 m / 10 m), run stats and personal best.
- **Diorama look**: the mountain is a block with stratified sides on a base slab.

## Exit test for Phase 0

Hand it to a few people. Do they say "one more tweak" and keep going? If not, fix the feel before moving to Phase 1.

## Develop

```bash
npm install
npm run dev      # local dev server
npm test         # physics, scoring, slope design, the hexagon grid, tile actions and jumps, gates and courses, pieces, joints, projects, the translation, the tutorial levels (Node, no browser needed)
npm run build    # production build into dist/
npm run smoke    # browser smoke test on the build: design a slope, move the start, select tiles, raise, undo, a jump, rotate, copy and paste, edit the slope keeping the tiles, ride, pause and act, ride on, start again, switch to French, play a tutorial level and leave it, set a course of gates, race it, miss a gate, the slope editor in 3D (side view, drag a dot, undo), the view buttons (rotate, move, top), double click a piece, save as a project, open it again, reload (needs Chromium: npx playwright install chromium)
```

Add `?debug` to the URL for a frame-cost readout (fps, worst frame, draw calls, triangles). CI (`.github/workflows/ci.yml`) runs the tests, the build and the smoke test on every pull request.

The physics runs in fixed 1/240 s steps whatever the screen's refresh rate, so a run (and the ghost of your best one) plays out identically at 60 Hz and 165 Hz.

Stack: [Vite](https://vite.dev) + [Three.js](https://threejs.org). The simulation core in `src/core/` has no Three.js dependency, so it runs in tests and can later move to a worker.

```
src/
  core/        heightfield, slope design, hexagon grid, tiles and actions, terrain, skier physics, scoring, tutorial levels (pure JS)
  render/      terrain mesh + shader, trees and rocks, start gate, skier, spray, ski tracks
  buildBar.js  the build bar
  slopeMode.js the slope editor's bar (in the 3D view)
  viewButtons.js the view buttons (rotate, move, top, side)
  projects.js  projects (projectsDialog.js: their dialog)
  i18n.js      English and French, the language switch
  tutorial.js  the tutorial card (tutorialText.js: its words)
  ui.js        overlay controls
  main.js      scene, input, game loop
tests/         node:test suites
```

## Deploy

Vercel detects Vite automatically: import the repo, keep the defaults (build `npm run build`, output `dist`), deploy.
