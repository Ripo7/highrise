// Browser smoke test: serves the production build, plays the core loop in Chromium (design
// a slope section by section, put the start gate anywhere, select hexagon tiles and act on
// them: raise, undo and redo, a jump, rotate, copy and paste, deselect; edit the slope and
// keep the tiles; ride, pause to build, ride on from where the skier was, start again from
// the gate) and fails on any page error. Run after `npm run build`:
//   npm run smoke      (SMOKE_OUT=dir keeps screenshots; defaults to smoke-shots/)
import { preview } from 'vite';
import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const OUT = process.env.SMOKE_OUT || 'smoke-shots';
fs.mkdirSync(OUT, { recursive: true });

const server = await preview({ preview: { port: 4174, strictPort: true }, logLevel: 'warn' });
const url = 'http://localhost:4174/';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  // a software renderer on a small CI machine can take seconds a frame: clicks wait for the
  // page to settle across frames
  page.setDefaultTimeout(120000);
  page.on('pageerror', (e) => errors.push(e.message));
  // block third-party requests (fonts): the game must not depend on them
  await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__highrise?.hf);

  // welcome card, then design the slope: the Park template, wide, its first section two
  // degrees steeper, and one more section at the bottom
  await page.click('#intro-go');
  await page.waitForSelector('#slope:not([hidden])');
  assert.ok(await page.isHidden('#sl-cancel'), 'a first slope: nothing to cancel back to');
  await page.click('#slope [data-tpl="park"]');
  await page.click('#slope [data-width="wide"]');
  await page.click('#sl-list [data-i="0"] [data-key="slope"] [data-step="1"]');
  await page.click('#sl-list [data-i="0"] [data-key="slope"] [data-step="1"]');
  await page.click('#sl-add');
  assert.equal(await page.locator('#sl-list .sl-row').count(), 4, 'four sections');
  await page.screenshot({ path: `${OUT}/0-slope.png` });
  await page.click('#sl-go');
  await page.waitForSelector('#slope', { state: 'hidden' });
  const design = await page.evaluate(() => window.__highrise.state.design);
  assert.equal(design.width, 'wide');
  assert.deepEqual(design.sections.map((x) => x.slope), [12, 16, 10, 10]);
  assert.equal(await page.evaluate(() => window.__highrise.hf.sizeX), 720, '720 m wide');
  const pitch = await page.evaluate(() => {
    const h = window.__highrise.hf;
    const z = h.startZ + 60 + 180;
    return (Math.atan2(h.heightAt(0, z - 5) - h.heightAt(0, z + 5), 10) * 180) / Math.PI;
  });
  assert.ok(Math.abs(pitch - 16) < 0.6, `the second section is 16° (${pitch.toFixed(1)}°)`);
  assert.equal(await page.evaluate(() => window.__highrise.state.tiles.length), 0, 'a bare slope, nothing built yet');
  await page.waitForFunction(() => window.__highrise.cameraSettled, null, { timeout: 120000 });

  // look down on the top of the mountain (a slow software renderer makes free flying
  // unreliable to aim)
  await page.evaluate(() => {
    const h = window.__highrise;
    const z = h.hf.startZ + 150;
    const y = h.hf.heightAt(0, z);
    h.controls.target.set(0, y, z);
    h.camera.position.set(0, y + 260, z - 150);
    h.controls.update();
  });
  const at = (x, u) =>
    page.evaluate(
      ([x, u]) => {
        const h = window.__highrise;
        h.camera.updateMatrixWorld();
        const z = h.hf.startZ + u;
        const v = h.camera.position.clone().set(x, h.hf.heightAt(x, z), z).project(h.camera);
        const r = document.getElementById('scene').getBoundingClientRect();
        return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
      },
      [x, u]
    );
  const drag = async (a, b) => {
    const [ax, ay] = await at(...a);
    const [bx, by] = await at(...b);
    await page.mouse.move(ax, ay);
    await page.mouse.down();
    await page.mouse.move(bx, by, { steps: 8 });
    await page.mouse.up();
  };
  const get = (fn) => page.evaluate(fn);

  // the start gate goes anywhere: tap the snow with Start
  await page.click('#buildbar [data-tool="start"]');
  {
    const [px, py] = await at(40, 160);
    await page.mouse.click(px, py);
  }
  const start = await get(() => ({ x: window.__highrise.state.start.x, u: window.__highrise.state.start.z - window.__highrise.hf.startZ }));
  assert.ok(Math.abs(start.x - 40) < 4 && Math.abs(start.u - 160) < 4, `the gate moved (${start.x.toFixed(1)}, ${start.u.toFixed(1)})`);

  // select a row of tiles across the slope (drag with Select), then raise them twice
  await page.click('#buildbar [data-tool="select"]');
  await drag([-50, 110], [30, 110]);
  const picked = await get(() => window.__highrise.selection.length);
  assert.ok(picked >= 14, `selected tiles (${picked})`);
  assert.ok(await page.isVisible('#buildbar .bb-chip'), 'the selection chip shows');
  await page.evaluate(() => (window.__before = window.__highrise.hf.h.slice()));
  await page.click('#buildbar [data-tab="shape"]');
  await page.click('#buildbar [data-action="raise"]');
  await page.click('#buildbar [data-action="raise"]');
  const lifts = await get(() => [...new Set(window.__highrise.state.tiles.map((t) => t.lift))]);
  assert.deepEqual(lifts, [3], 'two taps: 3 m');
  assert.equal(await page.textContent('#buildbar [data-action="raise"] .bb-badge'), '+3', 'the button shows it');
  const rise = await get(() => {
    const h = window.__highrise.hf.h;
    let m = 0;
    for (let i = 0; i < h.length; i++) m = Math.max(m, h[i] - window.__before[i]);
    return m;
  });
  assert.ok(rise > 2.5, `the snow rose (${rise.toFixed(2)} m)`);

  // undo takes one tap back, redo brings it again
  await page.keyboard.press('Control+z');
  assert.deepEqual(await get(() => [...new Set(window.__highrise.state.tiles.map((t) => t.lift))]), [1.5], 'undo');
  await page.keyboard.press('Control+Shift+z');
  assert.deepEqual(await get(() => [...new Set(window.__highrise.state.tiles.map((t) => t.lift))]), [3], 'redo');

  // a jump on the same tiles, facing down the fall line, then turned
  await page.click('#buildbar [data-tab="features"]');
  await page.click('#buildbar [data-action="jump"]');
  const dir0 = await get(() => window.__highrise.state.tiles.find((t) => t.feat === 'jump')?.dir);
  assert.ok(Number.isFinite(dir0), 'a jump');
  await page.click('#buildbar [data-tab="tools"]');
  await page.click('#buildbar [data-action="rotate"]');
  assert.equal(await get(() => window.__highrise.state.tiles.find((t) => t.feat === 'jump').dir), (dir0 + 330) % 360, 'turned');
  await page.screenshot({ path: `${OUT}/1-tiles.png` });
  // copy them and paste them further down, well to the side of the run from the gate (the
  // copy spans 80 m to the right of where it's put): the pasted tiles become the selection
  await page.click('#buildbar [data-action="copy"]');
  await page.click('#buildbar [data-action="paste"]');
  assert.equal(await get(() => window.__highrise.state.tool), 'paste', 'pasting');
  {
    const [px, py] = await at(-150, 230);
    const box = await page.locator('#scene').boundingBox();
    assert.ok(px > box.x && px < box.x + box.width && py > box.y && py < box.y + box.height * 0.7, 'the paste spot is on screen');
    await page.mouse.click(px, py);
  }
  const tileCount = await get(() => window.__highrise.state.tiles.length);
  assert.equal(tileCount, picked * 2, `pasted (${tileCount} tiles)`);
  assert.equal(await get(() => window.__highrise.state.tiles.filter((t) => t.feat === 'jump').map((t) => t.g).filter((g, k, a) => a.indexOf(g) === k).length), 2, 'two jumps, each its own');
  assert.equal(await get(() => window.__highrise.state.tool), 'select', 'back to selecting');
  // Esc deselects
  await page.keyboard.press('Escape');
  assert.equal(await get(() => window.__highrise.selection.length), 0, 'deselected');
  assert.ok(await page.isHidden('#buildbar .bb-chip'), 'the chip is gone');

  // edit the slope (••• menu): a steeper top, keeping what's built
  await page.click('#more');
  await page.click('#reset');
  await page.waitForSelector('#slope:not([hidden])');
  assert.ok(await page.isVisible('#sl-keep-row'), 'it offers to keep the tiles');
  await page.click('#sl-list [data-i="0"] [data-key="slope"] [data-step="1"]');
  await page.click('#sl-go');
  await page.waitForSelector('#slope', { state: 'hidden' });
  assert.equal(await get(() => window.__highrise.state.design.sections[0].slope), 13, 'the new slope');
  assert.equal(await get(() => window.__highrise.state.tiles.length), tileCount, 'the tiles are kept');

  // ride from the gate (a few real frames, then a couple of seconds in one go: the software
  // renderer is far too slow to ride in real time)
  await page.click('#send');
  await page.waitForFunction(() => window.__highrise.skier?.time > 0.1, null, { timeout: 240000 });
  await page.evaluate(() => window.__highrise.advance(2.5, {}));
  const ride = await get(() => {
    const h = window.__highrise;
    const s = h.skier;
    return { status: s.status, speed: s.speed, time: s.time, pos: [...s.pos], tracks: h.tracks.count };
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/2-ride.png` });
  assert.equal(ride.status, 'running');
  assert.ok(ride.speed > 3, `skier is moving (${ride.speed.toFixed(1)} m/s)`);
  assert.ok(ride.tracks > 2, `the skis left tracks (${ride.tracks} points)`);

  // Build pauses the run: the skier waits where he is
  await page.click('#ride-exit');
  await page.waitForFunction(() => !window.__highrise.riding, null, { timeout: 60000 });
  const paused = await get(() => ({
    paused: window.__highrise.paused,
    label: document.getElementById('send-label').textContent,
    restart: !document.getElementById('restart').hidden,
    status: document.getElementById('status').textContent,
  }));
  assert.deepEqual(paused, { paused: true, label: 'Ride on', restart: true, status: 'Paused' }, 'paused');
  // where he waits (the run went on for a few frames since the last look: compare with this)
  const waiting = await get(() => {
    const s = window.__highrise.skier;
    return { time: s.time, speed: s.speed, pos: [...s.pos] };
  });
  // build something just ahead of him while he waits: select 7 tiles there, lower them
  await page.evaluate(() => {
    const h = window.__highrise;
    const s = h.skier;
    const v = Math.hypot(s.vel[0], s.vel[2]) || 1;
    h.selectAt(s.pos[0] + (s.vel[0] / v) * 30, s.pos[2] + (s.vel[2] / v) * 30, 2);
  });
  const liftOf = () =>
    get(() => {
      const h = window.__highrise;
      const by = new Map(h.state.tiles.map((t) => [`${t.i},${t.j}`, t.lift]));
      return h.selection.map(([i, j]) => by.get(`${i},${j}`) || 0);
    });
  const liftBefore = await liftOf();
  assert.equal(liftBefore.length, 7, 'seven tiles selected ahead of him');
  await page.click('#buildbar [data-tab="shape"]');
  await page.click('#buildbar [data-action="lower"]');
  const liftAfter = await liftOf();
  assert.ok(liftAfter.every((v, k) => Math.abs(v - (liftBefore[k] - 1.5)) < 1e-6), 'all seven lowered 1.5 m');
  await page.waitForFunction(() => window.__highrise.cameraSettled, null, { timeout: 120000 });
  await page.screenshot({ path: `${OUT}/3-paused.png` });

  // Ride on: the same run, from where he was, as fast as he was going
  await page.click('#send');
  await page.waitForFunction(() => window.__highrise.riding, null, { timeout: 60000 });
  const resumed = await get(() => {
    const s = window.__highrise.skier;
    return { status: s.status, time: s.time, speed: s.speed, pos: [...s.pos] };
  });
  assert.equal(resumed.status, 'running');
  assert.ok(resumed.time >= waiting.time - 1e-6 && waiting.time >= ride.time - 1e-6, `the run carries on (${resumed.time.toFixed(2)} s)`);
  const moved = Math.hypot(resumed.pos[0] - waiting.pos[0], resumed.pos[2] - waiting.pos[2]);
  // a few frames may have run since Ride on: no further than that time at that speed
  const since = resumed.time - waiting.time;
  assert.ok(moved < waiting.speed * since * 1.5 + 2, `from where he waited (${moved.toFixed(1)} m in ${since.toFixed(2)} s)`);
  assert.ok(since > 0.5 || Math.abs(resumed.speed - waiting.speed) < Math.max(1.5, waiting.speed * 0.3), `at the same speed (${resumed.speed.toFixed(1)} vs ${waiting.speed.toFixed(1)} m/s)`);
  await page.evaluate(() => window.__highrise.advance(1, {}));
  assert.equal(await get(() => window.__highrise.skier.status), 'running');

  // From the start: a new run at the gate
  await page.click('#ride-exit');
  await page.waitForFunction(() => !window.__highrise.riding, null, { timeout: 60000 });
  await page.click('#restart');
  await page.waitForFunction(() => window.__highrise.riding, null, { timeout: 60000 });
  const again = await get(() => {
    const h = window.__highrise;
    const s = h.skier;
    return { time: s.time, d: Math.hypot(s.pos[0] - h.state.start.x, s.pos[2] - h.state.start.z), paused: h.paused };
  });
  assert.ok(again.time < 1 && again.d < 6 && !again.paused, `a new run from the gate (${again.time.toFixed(2)} s, ${again.d.toFixed(1)} m)`);

  assert.deepEqual(errors, [], 'no page errors');
  console.log(
    `smoke test passed: a slope of 4 sections designed (and edited, tiles kept), start gate moved, ${picked} tiles selected and raised, undo/redo, a jump turned, copied and pasted (${tileCount} tiles), ride at ${(ride.speed * 3.6).toFixed(0)} km/h, pause and build, ride on at ${resumed.time.toFixed(1)} s, from the start`
  );
} catch (err) {
  // on CI, say what failed where it shows on the run's page too (an annotation), with a
  // screenshot of the moment in the artifacts
  const msg = String(err.message || err).split('\n').slice(0, 12).join(' | ').replace(/[\r\n%]/g, ' ');
  console.log(`::error title=Smoke test::${msg}`);
  for (const p of browser.contexts().flatMap((c) => c.pages())) await p.screenshot({ path: `${OUT}/failed.png` }).catch(() => {});
  throw err;
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
