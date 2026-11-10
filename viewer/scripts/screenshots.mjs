// Headless verification: loads the viewer with software WebGL, checks console errors,
// exercises walking/collision/stairs, and saves screenshots to ./screenshots.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:5173/';
const OUT = new URL('../screenshots/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const exe = process.env.CHROME || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.addInitScript(() => localStorage.setItem('house3d-help-seen', '1'));
const results = {};
async function open(plan) {
  await page.goto(BASE + (plan ? `?plan=${encodeURIComponent(plan)}` : ''), { waitUntil: 'load' });
  await page.waitForFunction(() => window.__app && window.__app.ready && window.__app.frames() > 3, null, { timeout: 120000 });
}
async function settle(n = 6) { const f0 = await page.evaluate(() => __app.frames()); await page.waitForFunction((f) => __app.frames() >= f, f0 + n, { timeout: 120000 }); }
async function shot(name) { await settle(); await page.screenshot({ path: OUT + name }); console.log('saved', name); }

// ---- default plan (Architect's cozy 3-bed)
await open(null);
results.default = await page.evaluate(() => ({ name: __app.state.plan.meta.name, ...__app.info() }));
await page.evaluate(() => __app.orbitView([10.5, 36, 18], [11, 15, 0], 50));
await shot('01-exterior-aerial-north.png');
await page.evaluate(() => __app.orbitView([2, -9, 9], [10, 11, 1], 50));
await shot('02-exterior-street-south.png');
await page.evaluate(() => __app.topDown(0));
await shot('03-topdown-cutaway-ground.png');
await page.evaluate(() => __app.walk(11.8, 12.4, 0, -4));
results.lounge = await page.evaluate(() => __app.whereAmI());
await shot('04-firstperson-lounge-to-pool.png');
await page.evaluate(() => __app.walk(5.2, 16.45, 250, -14));
results.main = await page.evaluate(() => __app.whereAmI());
await shot('05-firstperson-main-bedroom.png');
await page.evaluate(() => __app.walk(15.42, 12.9, 160, -14));
results.garage = await page.evaluate(() => __app.whereAmI());
await shot('06-firstperson-garage.png');
await page.evaluate(() => __app.walk(12, 19.0, 10, -12));
results.patio = await page.evaluate(() => __app.whereAmI());
await shot('07-firstperson-patio-deck-pool.png');
await page.evaluate(() => __app.orbitView([3, 24, 3], [10, 18, 1.5], 50));
await shot('07b-exterior-north-facade-brick-feature-wall.png');

// ---- walking tests
results.walkFrontDoor = await page.evaluate(() => { __app.walk(9.6, 5.4, 0, 0); return __app.simulate(['KeyW'], 2.0); });
results.walkIntoLounge = await page.evaluate(() => __app.simulate(['KeyW'], 2.0));
results.wallBlock = await page.evaluate(() => { __app.walk(4.0, 8.9, 90, 0); return __app.simulate(['KeyW'], 3); });
results.windowBlock = await page.evaluate(() => { __app.walk(3.0, 9.3, 270, 0); return __app.simulate(['KeyW'], 3); });
results.slideOutToPatio = await page.evaluate(() => { __app.walk(10.0, 16.25, 0, 0); return __app.simulate(['KeyW'], 2.0); });
results.fixedGlassBlocks = await page.evaluate(() => { __app.walk(11.5, 15.5, 0, 0); return __app.simulate(['KeyW'], 2.5); });
results.kitchenToGarageD2 = await page.evaluate(() => { __app.walk(14.0, 11.4, 90, 0); return __app.simulate(['KeyW'], 2.0); });
results.garageToKitchenD2 = await page.evaluate(() => { __app.walk(15.6, 11.4, 270, 0); return __app.simulate(['KeyW'], 2.0); });
results.mainBedSliderOut = await page.evaluate(() => { __app.walk(3.5, 16.2, 0, 0); return __app.simulate(['KeyW'], 2.0); });
results.mainBedSliderIn = await page.evaluate(() => { __app.walk(3.5, 18.5, 180, 0); return __app.simulate(['KeyW'], 1.6); });
results.pedestrianGateIn = await page.evaluate(() => { __app.walk(9.6, -2.0, 0, 0); return __app.simulate(['KeyW'], 3.0); });
results.drivewayGateIn = await page.evaluate(() => { __app.walk(16.8, -2.0, 0, 0); return __app.simulate(['KeyW'], 3.0); });
results.streetWallBlocks = await page.evaluate(() => { __app.walk(5.0, -2.0, 0, 0); return __app.simulate(['KeyW'], 3.0); });
results.patioPostBlocks = await page.evaluate(() => { __app.walk(8.675, 18.8, 0, 0); return __app.simulate(['KeyW'], 1.5); });
results.poolEdge = await page.evaluate(() => { __app.walk(12.0, 19.5, 0, 0); return __app.simulate(['KeyW'], 2.0); });
await page.evaluate(() => { __app.walk(9.6, 5.4, 0, 0); __app.setMode('walk'); });
await shot('08-walk-hud-minimap.png');

// ---- two-storey test plan (stairs)
await open('./plans/test-two-storey.json');
await page.evaluate(() => __app.orbitView([18, -10, 12], [4, 3.5, 2.5], 50));
await shot('09-test-two-storey-exterior.png');
await page.evaluate(() => __app.walk(7.3, -0.2 + 0.5, 0, -14));
await shot('10-stairs-bottom.png');
results.stairsUp = await page.evaluate(() => { __app.walk(7.3, 0.2, 0, 0); return __app.simulate(['KeyW'], 3.4); });
results.stairsDown = await page.evaluate(() => { __app.player.yaw = Math.PI; return __app.simulate(['KeyW'], 3.4); });
results.walkOnFirstToBedroom = await page.evaluate(() => { __app.walk(6.2, 4.6, 180, 0, 3.0); const a = __app.simulate(['KeyW'], 1.6); __app.player.yaw = -Math.PI / 2; const b = __app.simulate(['KeyW'], 1.5); return [a, b]; });
await page.evaluate(() => { __app.player.pitch = -0.5; });
await page.evaluate(() => __app.walk(6.3, 5.6, 180, -30, 3.0));
results.landing = await page.evaluate(() => ({ at: __app.whereAmI(), feet: __app.player.feet.toFixed(2) }));
await shot('11-stairs-from-landing.png');
await page.evaluate(() => __app.topDown(1));
await shot('12-test-topdown-first-floor.png');

// ---- sample plan
await open('./plans/sample.json');
await page.evaluate(() => __app.orbitView([9, 40, 16], [9, 13, 0.5], 50));
await shot('13-sample-exterior-north.png');

results.consoleErrors = errors;
console.log(JSON.stringify(results, null, 1));
await browser.close();
