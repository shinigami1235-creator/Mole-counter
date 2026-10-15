const { chromium } = require('playwright');
const truth = require('./sample/truth.json');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://localhost:8765/index.html');
  for (const [k, f, r, l] of [['a', 'visit-a', truth.rulerA, truth.landmarksA], ['b', 'visit-b', truth.rulerB, truth.landmarksB]]) {
    await page.click('[data-tab="' + k + '"]');
    await page.setInputFiles('#file', 'tests/out/' + f + '.jpg');
    await page.waitForFunction((k) => state.photos[k].bitmap, k);
    await page.evaluate(([k, r, l]) => { const p = state.photos[k]; p.ruler = r; p.landmarks = l; changed(); }, [k, r, l]);
    await page.click('#find');
    await page.waitForFunction(() => document.getElementById('find').textContent === 'Find moles');
  }
  // B on landmark scale, distance taken from the last visit
  await page.click('[data-tab="b"]');
  await page.click('[data-scale="landmarks"]');
  console.log('B landmark scale:', await page.textContent('#scale-result'), '|', await page.textContent('#lm-mm-from'));
  await page.click('[data-tab="compare"]');
  const rows = await page.$$eval('#table tbody tr', (trs) => trs.map((t) => t.innerText.replace(/\s+/g, ' ')));
  console.log(rows.join('\n'));
  // crop B so mole 1 falls outside: move landmarks? instead check a gone mole outside frame by shifting B landmarks
  const dl = page.waitForEvent('download');
  await page.click('#csv');
  const d = await dl; const path = await d.path();
  console.log(require('fs').readFileSync(path, 'utf8').split('\r\n').slice(0, 4).join('\n'));
  const dl2 = page.waitForEvent('download');
  await page.click('#save-photos');
  const d2 = await dl2; await d2.saveAs('tests/out/marked-a.jpg');
  console.log('saved', d2.suggestedFilename());
  // undo on photo tab
  await page.click('[data-tab="a"]');
  const before = await page.evaluate(() => A.moles.length);
  await page.click('[data-tool="remove"]');
  const m = await page.evaluate(() => [A.moles[0].cx, A.moles[0].cy]);
  await page.evaluate(([x, y]) => focusOn(A, x, y), m);
  const pt = await page.evaluate(([x, y]) => { const r = document.getElementById('view').getBoundingClientRect(); return [r.left + x * A.view.s + A.view.tx, r.top + y * A.view.s + A.view.ty]; }, m);
  await page.mouse.click(pt[0], pt[1]);
  const after = await page.evaluate(() => A.moles.length);
  await page.click('#undo');
  console.log('remove', before, '->', after, 'undo ->', await page.evaluate(() => A.moles.length));
  console.log('errors', errors);
  await browser.close();
})();
