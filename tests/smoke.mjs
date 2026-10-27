// Browser smoke test: serves the production build, plays the core loop in Chromium (pick a
// wild mountain, trace a piste point by point, drag a point, branch off and join back,
// paint bumps, undo, ride) and fails on any page error. Run after `npm run build`:
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
  page.on('pageerror', (e) => errors.push(e.message));
  // block third-party requests (fonts): the game must not depend on them
  await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__highrise?.hf);

  // welcome card, then the mountain chooser: another small, gentle one
  await page.click('#intro-go');
  await page.waitForSelector('#mountain:not([hidden])');
  await page.click('[data-slope="gentle"]');
  await page.click('[data-len="small"]');
  await page.click('#mt-another');
  await page.click('#mt-go');
  await page.waitForSelector('#mountain', { state: 'hidden' });
  const mt = await page.evaluate(() => window.__highrise.state.mountain);
  assert.equal(mt.steep, 'gentle');
  assert.equal(mt.size, 'small');
  assert.equal(await page.evaluate(() => window.__highrise.state.pistes.length), 0, 'a wild mountain, no piste yet');
  await page.waitForFunction(() => window.__highrise.cameraSettled, null, { timeout: 120000 });

  // look down on the top half of the mountain (a slow software renderer makes free flying
  // unreliable to aim)
  await page.evaluate(() => {
    const h = window.__highrise;
    const z = h.hf.startZ + 220;
    const y = h.hf.heightAt(0, z);
    h.controls.target.set(0, y, z);
    h.camera.position.set(0, y + 470, z + 260);
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
  const tap = async (x, u) => {
    const [px, py] = await at(x, u);
    await page.mouse.click(px, py);
  };
  const drag = async (a, b) => {
    const [ax, ay] = await at(...a);
    const [bx, by] = await at(...b);
    await page.mouse.move(ax, ay);
    await page.mouse.down();
    await page.mouse.move(bx, by, { steps: 8 });
    await page.mouse.up();
  };
  const pistes = () => page.evaluate(() => window.__highrise.state.pistes.map((p) => ({ id: p.id, n: p.pts.length, from: p.from?.id ?? null, to: p.to?.id ?? null })));
  const onMain = (f) =>
    page.evaluate((f) => {
      const h = window.__highrise;
      const c = h.world.curves.get(1);
      const k = Math.round((c.n - 1) * f);
      return [c.xs[k], c.zs[k] - h.hf.startZ];
    }, f);

  // trace: tap the start, then three points down the mountain
  for (const p of [[0, 60], [-30, 150], [20, 250], [0, 340]]) await tap(...p);
  assert.deepEqual(await pistes(), [{ id: 1, n: 4, from: null, to: null }], 'four waypoints');
  const groomed = await page.evaluate(() => {
    const h = window.__highrise;
    const c = h.world.curves.get(1);
    const k = Math.floor(c.n / 2);
    return h.surf.at(c.xs[k], c.zs[k]).g;
  });
  assert.ok(groomed > 0.9, 'the piste is groomed into the snow');
  assert.ok(await page.evaluate(() => !!window.__highrise.world.ends.start), 'it has a start');

  // drag the second point 40 m to the left
  await drag([-30, 150], [-70, 150]);
  const moved = await page.evaluate(() => window.__highrise.state.pistes[0].pts[1].x);
  assert.ok(moved < -50, `the point moved (${moved.toFixed(1)})`);

  // a branch: New piste, tap on the piste, two points beside it, then back onto it
  await page.click('[data-action="newPiste"]');
  await tap(...(await onMain(0.3)));
  await tap(90, 190);
  await tap(100, 260);
  await tap(...(await onMain(0.9)));
  const ps = await pistes();
  assert.equal(ps.length, 2, 'two pistes');
  assert.deepEqual([ps[1].from, ps[1].to], [1, 1], 'the branch leaves the piste and joins it again');
  await page.screenshot({ path: `${OUT}/1-traced.png` });

  // terrain: a row of bumps across the piste
  await page.evaluate(() => (window.__before = window.__highrise.hf.h.slice()));
  await page.click('[data-tab="terrain"]');
  await page.click('[data-piece="bump"]');
  await drag([-50, 110], [40, 110]);
  const bumps = await page.evaluate(() => window.__highrise.state.pieces.filter((p) => p.k === 'bump').length);
  assert.ok(bumps >= 8, `bump tiles (${bumps})`);
  const rise = await page.evaluate(() => {
    const h = window.__highrise.hf.h;
    let m = 0;
    for (let i = 0; i < h.length; i++) m = Math.max(m, h[i] - window.__before[i]);
    return m;
  });
  assert.ok(rise > 2, `the bumps raised the snow (${rise.toFixed(2)} m)`);
  await page.screenshot({ path: `${OUT}/2-bumps.png` });

  // undo takes the bumps away, redo brings them back
  await page.keyboard.press('Control+z');
  assert.equal(await page.evaluate(() => window.__highrise.state.pieces.length), 0, 'undo');
  await page.keyboard.press('Control+Shift+z');
  assert.ok((await page.evaluate(() => window.__highrise.state.pieces.length)) >= 8, 'redo');

  // ride it
  await page.click('#send');
  await page.waitForFunction(() => window.__highrise.skier?.time > 0.5, null, { timeout: 240000 });
  const ride = await page.evaluate(() => {
    const s = window.__highrise.skier;
    return { status: s.status, speed: s.speed, tracks: window.__highrise.tracks.count };
  });
  await page.screenshot({ path: `${OUT}/3-ride.png` });
  assert.equal(ride.status, 'running');
  assert.ok(ride.speed > 3, `skier is moving (${ride.speed.toFixed(1)} m/s)`);
  assert.ok(ride.tracks > 2, `the skis left tracks (${ride.tracks} points)`);
  assert.deepEqual(errors, [], 'no page errors');
  console.log(`smoke test passed: wild mountain, piste of 4 points traced and edited, a branch that joins back, ${bumps} bump tiles, undo/redo, skier riding at ${(ride.speed * 3.6).toFixed(0)} km/h`);
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
