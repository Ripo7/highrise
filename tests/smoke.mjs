// Browser smoke test: serves the production build, plays the core loop in Chromium and
// (design a run in the editor, tap the snow to edit, sculpt a kicker, ride)
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
  await page.click('#intro-go');
  await page.waitForSelector('#runed:not([hidden])');

  // the run editor: open section 2, change its slope, put a kicker in an empty cell
  await page.click('#re-list [data-i="1"] .sec-head');
  const slope = async () => page.evaluate(() => window.__highrise.editor.run.sections[1].slope);
  const before = await slope();
  await page.click('#re-list [data-i="1"] [data-key="slope"] [data-step="1"]');
  assert.equal(await slope(), before + 1, 'the slope stepper changes the section');
  await page.click('#re-list [data-i="1"] .cell[data-r="5"][data-c="4"]');
  await page.waitForSelector('#re-sheet:not([hidden])');
  await page.click('#re-sheet [data-cat="park"]');
  await page.click('#re-sheet [data-el="box"]');
  const placed = await page.evaluate(() => window.__highrise.editor.run.sections[1].cells.find((c) => c.r === 5 && c.c === 4));
  assert.equal(placed?.k, 'box', 'the box went into the cell');
  await page.screenshot({ path: `${OUT}/1-editor.png` });
  await page.click('#re-build');
  await page.waitForSelector('#runed', { state: 'hidden' });
  assert.ok(await page.evaluate(() => window.__highrise.structs.list.some((s) => s.type === 'rail' && s.box)), 'the box is on the mountain');

  // tap the snow in Orbit mode: the editor opens on that spot
  await page.waitForFunction(() => window.__highrise.cameraSettled, null, { timeout: 120000 });
  const tap = await page.evaluate(() => {
    const { camera, hf } = window.__highrise;
    const z = hf.startZ + 100;
    const v = camera.position.clone().set(0, hf.heightAt(0, z), z).project(camera);
    const r = document.getElementById('scene').getBoundingClientRect();
    return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
  });
  await page.mouse.click(tap[0], tap[1]);
  await page.waitForSelector('#runed:not([hidden])');
  await page.waitForSelector('#re-sheet:not([hidden])'); // straight to that cell's elements
  await page.keyboard.press('Escape');
  await page.click('#re-cancel');
  await page.waitForSelector('#runed', { state: 'hidden' });

  // build a kicker on the run (Build tool, drag down the fall line). Wait for the camera to
  // finish gliding to its new view first: on a slow software renderer that takes many
  // seconds, and aiming mid-glide puts the kicker somewhere else.
  await page.keyboard.press('b'); // turns Advanced on
  const at = (u) =>
    page.evaluate((u) => {
      const { camera, hf } = window.__highrise;
      const z = hf.startZ + u;
      const v = camera.position.clone().set(0, hf.heightAt(0, z), z).project(camera);
      const r = document.getElementById('scene').getBoundingClientRect();
      return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
    }, u);
  // remember the snow before, then look for the highest rise anywhere (a slow software
  // renderer can shift the aim a few metres, so don't insist on one exact spot)
  await page.evaluate(() => (window.__before = window.__highrise.hf.h.slice()));
  const [ax, ay] = await at(150);
  const [bx, by] = await at(175);
  await page.mouse.move(ax, ay);
  await page.mouse.down();
  await page.mouse.move(bx, by, { steps: 8 });
  await page.mouse.up();
  const rise = await page.evaluate(() => {
    const h = window.__highrise.hf.h;
    let m = 0;
    for (let i = 0; i < h.length; i++) m = Math.max(m, h[i] - window.__before[i]);
    return m;
  });
  assert.ok(rise > 0.5, `the kicker raised the snow (${rise.toFixed(2)} m)`);
  await page.screenshot({ path: `${OUT}/2-built.png` });

  // ride it
  await page.click('#send');
  await page.waitForFunction(() => window.__highrise.skier?.time > 1.5, null, { timeout: 120000 });
  const ride = await page.evaluate(() => {
    const s = window.__highrise.skier;
    return { status: s.status, speed: s.speed, down: s.pos[2] - window.__highrise.hf.startZ, tracks: window.__highrise.tracks.count };
  });
  await page.screenshot({ path: `${OUT}/3-ride.png` });
  assert.equal(ride.status, 'running');
  assert.ok(ride.tracks > 5, `the skis left tracks (${ride.tracks} points)`);
  assert.ok(ride.speed > 3, `skier is moving (${ride.speed.toFixed(1)} m/s)`);
  assert.ok(ride.down > 5, `skier went down the run (${ride.down.toFixed(1)} m)`);
  assert.deepEqual(errors, [], 'no page errors');
  console.log(`smoke test passed: run designed, box placed, kicker built, skier ${ride.down.toFixed(0)} m down at ${(ride.speed * 3.6).toFixed(0)} km/h`);
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
