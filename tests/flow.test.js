// Full flow in headless Chromium against the synthetic photos.
const { chromium } = require('playwright');
const truth = require('./sample/truth.json');
const vw = Number(process.env.VW || 1400), vh = Number(process.env.VH || 900);
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1, hasTouch: false });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://localhost:8765/index.html');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tests/out/0-empty.png' });

  async function tapImage(key, x, y) {
    const pt = await page.evaluate(([k, x, y]) => {
      const p = state.photos[k];
      const r = document.getElementById('view').getBoundingClientRect();
      return [r.left + x * p.view.s + p.view.tx, r.top + y * p.view.s + p.view.ty];
    }, [key, x, y]);
    await page.mouse.click(pt[0], pt[1]);
  }
  async function focus(key, x, y) {
    await page.evaluate(([k, x, y]) => focusOn(state.photos[k], x, y), [key, x, y]);
    await page.waitForTimeout(50);
  }

  async function doPhoto(key, file, ruler, lms) {
    await page.click('[data-tab="' + key + '"]');
    await page.setInputFiles('#file', file);
    await page.waitForFunction((k) => state.photos[k].bitmap && !state.photos[k].faceBusy, key, { timeout: 60000 });
    await page.waitForTimeout(100);
    await page.evaluate(([k, r]) => { const p = state.photos[k]; p.scaleMode = 'ruler'; p.ruler = r; changed(); }, [key, ruler]);
    await page.click('[data-tool="landmark"]');
    for (const q of lms) { await focus(key, q[0], q[1]); await tapImage(key, q[0], q[1]); }
    await page.click('#fit');
    await page.click('#find');
    await page.waitForFunction(() => document.getElementById('find').textContent === 'Find moles' && !document.getElementById('find').disabled);
    await page.waitForTimeout(100);
    const info = await page.evaluate((k) => {
      const p = state.photos[k];
      const s = pxPerMm(p);
      return { scale: s, moles: p.moles.map((m) => [Math.round(m.cx / s), Math.round(m.cy / s), +(m.feret / s).toFixed(2)]),
        panel: document.getElementById('scale-result').textContent + ' | ' + document.getElementById('mole-count').textContent };
    }, key);
    await page.screenshot({ path: 'tests/out/1-' + key + '.png' });
    return info;
  }

  const a = await doPhoto('a', 'tests/sample/visit-a.jpg', truth.rulerA, truth.landmarksA);
  console.log('A', a.panel); console.log(JSON.stringify(a.moles));
  const b = await doPhoto('b', 'tests/sample/visit-b.jpg', truth.rulerB, truth.landmarksB);
  console.log('B', b.panel); console.log(JSON.stringify(b.moles));

  // remove the ink-dot landmarks if they were picked up as moles: tap each with Remove
  for (const [key, lms] of [['a', truth.landmarksA], ['b', truth.landmarksB]]) {
    await page.click('[data-tab="' + key + '"]');
    await page.evaluate(() => { state.tool = null; }); await page.click('[data-tool="remove"]');
    for (const q of lms) {
      const near = await page.evaluate(([k, x, y]) => state.photos[k].moles.some((m) => Math.hypot(m.cx - x, m.cy - y) < 15), [key, q[0], q[1]]);
      if (near) { await focus(key, q[0], q[1]); await tapImage(key, q[0], q[1]); }
    }
    await page.click('#fit');
  }

  await page.click('[data-tab="compare"]');
  await page.waitForTimeout(150);
  const report = await page.evaluate(() => ({
    stats: [...document.querySelectorAll('.stat')].map((d) => d.textContent),
    align: document.getElementById('align').textContent,
    stretch: document.getElementById('stretch').textContent,
    missing: document.getElementById('missing').textContent,
    rows: [...document.querySelectorAll('#table tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent).join(' | ')),
  }));
  console.log(JSON.stringify(report, null, 1));
  await page.screenshot({ path: 'tests/out/2-compare.png' });
  // tap a row
  const row = await page.$('#table tbody tr[data-status="grown"]');
  if (row) { await row.click(); await page.waitForTimeout(100); await page.screenshot({ path: 'tests/out/3-grown.png' }); }
  console.log('status:', await page.textContent('#status'));
  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
})();
