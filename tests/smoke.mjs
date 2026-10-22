// Browser smoke test: serves the production build, plays the core loop in Chromium and
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
  await page.waitForSelector('#profile:not([hidden])');

  // draw a run from the flag: down and to the right
  const box = await page.locator('#profile-canvas').boundingBox();
  const flag = await page.evaluate(() => {
    const c = document.getElementById('profile-canvas').getBoundingClientRect();
    const head = document.querySelector('.profile-head').getBoundingClientRect();
    const foot = document.querySelector('.profile-foot').getBoundingClientRect();
    const narrow = c.width < 600;
    const padL = narrow ? 44 : 72;
    const padR = narrow ? 26 : 56;
    const padT = Math.max(head.bottom - c.top + (narrow ? 50 : 64), 80);
    const padB = Math.max(c.bottom - foot.top + 34, 60);
    const s = Math.min((c.width - padL - padR) / 450, (c.height - padT - padB) / 220, 3);
    return { x: c.left + padL, y: c.top + padT + 12 * s, s };
  });
  await page.mouse.move(flag.x, flag.y);
  await page.mouse.down();
  for (const [u, e] of [[80, -25], [160, -60], [260, -100], [380, -150], [430, -165]]) {
    await page.mouse.move(flag.x + u * flag.s, flag.y - e * flag.s, { steps: 10 });
  }
  await page.mouse.up();
  assert.equal(await page.locator('#pr-build').isDisabled(), false, 'the drawn run is long and steep enough');
  await page.screenshot({ path: `${OUT}/1-designer.png` });
  await page.click('#pr-build');
  await page.waitForSelector('#profile', { state: 'hidden' });

  // build a kicker on the run (Build tool, drag down the fall line)
  await page.keyboard.press('b');
  const at = (u) =>
    page.evaluate((u) => {
      const { camera, hf } = window.__highrise;
      const z = hf.startZ + u;
      const v = camera.position.clone().set(0, hf.heightAt(0, z), z).project(camera);
      const r = document.getElementById('scene').getBoundingClientRect();
      return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
    }, u);
  const before = await page.evaluate(() => window.__highrise.hf.heightAt(0, window.__highrise.hf.startZ + 170));
  const [ax, ay] = await at(150);
  const [bx, by] = await at(175);
  await page.mouse.move(ax, ay);
  await page.mouse.down();
  await page.mouse.move(bx, by, { steps: 8 });
  await page.mouse.up();
  const after = await page.evaluate(() => window.__highrise.hf.heightAt(0, window.__highrise.hf.startZ + 170));
  assert.ok(after > before + 0.5, `the kicker raised the snow (${(after - before).toFixed(2)} m)`);
  await page.screenshot({ path: `${OUT}/2-built.png` });

  // ride it
  await page.click('#send');
  await page.waitForFunction(() => window.__highrise.skier?.time > 1.5, null, { timeout: 120000 });
  const ride = await page.evaluate(() => {
    const s = window.__highrise.skier;
    return { status: s.status, speed: s.speed, down: s.pos[2] - window.__highrise.hf.startZ };
  });
  await page.screenshot({ path: `${OUT}/3-ride.png` });
  assert.equal(ride.status, 'running');
  assert.ok(ride.speed > 3, `skier is moving (${ride.speed.toFixed(1)} m/s)`);
  assert.ok(ride.down > 5, `skier went down the run (${ride.down.toFixed(1)} m)`);
  assert.deepEqual(errors, [], 'no page errors');
  console.log(`smoke test passed: run drawn, kicker built, skier ${ride.down.toFixed(0)} m down at ${(ride.speed * 3.6).toFixed(0)} km/h`);
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
