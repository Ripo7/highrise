// Browser smoke test: serves the production build, plays the core loop in Chromium
// (choose a mountain, build pieces by dragging on the snow, erase, undo, ride) and
// fails on any page error. Run after `npm run build`:  npm run smoke
// (SMOKE_OUT=dir keeps screenshots; defaults to smoke-shots/)
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errors.push(e.message));
  // block third-party requests (fonts): the game must not depend on them
  await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__highrise?.hf);

  // welcome card, then the mountain chooser: a medium, short mountain without starter pieces
  await page.click('#intro-go');
  await page.waitForSelector('#mountain:not([hidden])');
  await page.click('[data-slope="medium"]');
  await page.click('[data-len="short"]');
  await page.uncheck('#mt-starter');
  await page.click('#mt-go');
  await page.waitForSelector('#mountain', { state: 'hidden' });
  const mt = await page.evaluate(() => ({ ...window.__highrise.state.mountain, pieces: window.__highrise.state.pieces.length }));
  assert.equal(mt.slope, 'medium');
  assert.equal(mt.length, 'short');
  assert.equal(mt.pieces, 0, 'a bare mountain');
  await page.waitForFunction(() => window.__highrise.cameraSettled, null, { timeout: 120000 });

  // look at the piste close up (a slow software renderer makes free flying unreliable to aim)
  await page.evaluate(() => {
    const h = window.__highrise;
    const z = h.hf.startZ + 150;
    const x = h.base.start.x;
    const y = h.hf.heightAt(x, z);
    h.controls.target.set(x, y, z + 10);
    h.camera.position.set(x - 17, y + 52, z - 38);
    h.controls.update();
  });
  await page.waitForTimeout(500);
  const at = (u, off = 0) =>
    page.evaluate(
      ([u, off]) => {
        // aim at the middle of a 10 m tile (the grid starts at x = -240), never on a seam
        const h = window.__highrise;
        const z = h.hf.startZ + (Math.floor(u / 10) + 0.5) * 10;
        const x = -240 + (Math.floor((h.base.start.x + off + 240) / 10) + 0.5) * 10;
        const v = h.camera.position.clone().set(x, h.hf.heightAt(x, z), z).project(h.camera);
        const r = document.getElementById('scene').getBoundingClientRect();
        return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
      },
      [u, off]
    );
  const drag = async (a, b) => {
    await page.mouse.move(a[0], a[1]);
    await page.mouse.down();
    await page.mouse.move(b[0], b[1], { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
  };
  const count = (k) => page.evaluate((k) => window.__highrise.state.pieces.filter((p) => p.k === k).length, k);

  // Jumps: drag a kicker across the slope, it lays a row of tiles that merge into one wide kicker
  await page.evaluate(() => (window.__before = window.__highrise.hf.h.slice()));
  await page.click('#buildbar [data-piece="kicker"]');
  await drag(await at(160, -12), await at(160, 14));
  const kickers = await count('kicker');
  assert.ok(kickers >= 2, `a row of kicker tiles (${kickers})`);
  const rise = await page.evaluate(() => {
    const h = window.__highrise.hf.h;
    let m = 0;
    for (let i = 0; i < h.length; i++) m = Math.max(m, h[i] - window.__before[i]);
    return m;
  });
  assert.ok(rise > 0.8, `the kicker raised the snow (${rise.toFixed(2)} m)`);

  // Park: a box line down the slope becomes one long box
  await page.click('#buildbar [data-cat="park"]');
  await page.click('#buildbar [data-piece="box"]');
  await drag(await at(200, 0), await at(232, 0));
  assert.ok((await count('box')) >= 2, 'box tiles placed');
  const boxes = await page.evaluate(() => window.__highrise.structs.list.filter((s) => s.type === 'rail' && s.box).length);
  assert.equal(boxes, 1, 'neighbouring box tiles merge into one box');

  // Nature: a patch of trees
  await page.click('#buildbar [data-cat="nature"]');
  await page.click('#buildbar [data-piece="trees"]');
  await drag(await at(180, -40), await at(205, -28));
  assert.ok((await count('trees')) >= 2, 'trees placed');
  await page.screenshot({ path: `${OUT}/1-built.png` });

  // Erase the box line, then undo brings it back
  await page.click('#buildbar [data-tool="erase"]');
  await drag(await at(200, 0), await at(232, 0));
  assert.equal(await count('box'), 0, 'erased the box');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  assert.ok((await count('box')) >= 2, 'undo brought the box back');

  // ride it
  await page.click('#buildbar [data-tool="view"]');
  await page.click('#send');
  await page.waitForFunction(() => window.__highrise.skier?.time > 1.5, null, { timeout: 120000 });
  const ride = await page.evaluate(() => {
    const s = window.__highrise.skier;
    return { status: s.status, speed: s.speed, down: s.pos[2] - window.__highrise.hf.startZ, tracks: window.__highrise.tracks.count };
  });
  await page.screenshot({ path: `${OUT}/2-ride.png` });
  assert.equal(ride.status, 'running');
  assert.ok(ride.tracks > 5, `the skis left tracks (${ride.tracks} points)`);
  assert.ok(ride.speed > 3, `skier is moving (${ride.speed.toFixed(1)} m/s)`);
  assert.ok(ride.down > 5, `skier went down the run (${ride.down.toFixed(1)} m)`);
  assert.deepEqual(errors, [], 'no page errors');
  console.log(`smoke test passed: mountain chosen, ${kickers} kicker tiles, one merged box, erase + undo, skier ${ride.down.toFixed(0)} m down at ${(ride.speed * 3.6).toFixed(0)} km/h`);
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
