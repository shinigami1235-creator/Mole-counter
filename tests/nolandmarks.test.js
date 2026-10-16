// Compare with no landmarks: photos are lined up on the moles.
const { chromium } = require('playwright');
const truth = require('./sample/truth.json');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://localhost:8765/index.html');
  for (const [k, f, r] of [['a', 'visit-a', truth.rulerA], ['b', 'visit-b', truth.rulerB]]) {
    await page.click('[data-tab="' + k + '"]');
    await page.setInputFiles('#file', 'tests/sample/' + f + '.jpg');
    await page.waitForFunction((k) => state.photos[k].bitmap && !state.photos[k].faceBusy, k, { timeout: 60000 });
    // Last visit has a ruler. This visit keeps the estimate and takes its scale from the last visit.
    if (k === 'a') await page.evaluate(([k, r]) => { const p = state.photos[k]; p.scaleMode = 'ruler'; p.ruler = r; changed(); }, [k, r]);
    console.log(k, 'area:', await page.textContent('#area-result'), '|', await page.textContent('#scale-result'));
    await page.click('#find');
    await page.waitForFunction(() => document.getElementById('find').textContent === 'Find moles');
    console.log(k, await page.textContent('#mole-count'), '|', await page.textContent('#lm-count'));
  }
  await page.click('[data-tab="compare"]');
  console.log(await page.textContent('#align'));
  console.log((await page.$$eval('#table tbody tr', (t) => t.map((r) => r.innerText.replace(/\s+/g, ' ')))).join('\n'));
  console.log('B scale from last visit:', await page.evaluate(() => { const r = compare(); return r.bFromLast + ' ' + r.sB.toFixed(2); }));
  console.log(await page.$$eval('.stat', (d) => d.map((x) => x.innerText.replace(/\n/g, ' ')).join(', ')));
  // Take one matched mole off this visit and check it is found again at the last visit's spot.
  console.log('found again:', await page.evaluate(() => {
    const r = compare();
    const row = r.rows.find((x) => x.status === 'same' && x.lastMm > 2.5);
    B.moles = B.moles.filter((m) => m !== row.b);
    const n = findAtLastSpots(B);
    state.version++;
    const back = compare().rows.find((x) => x.label === row.label);
    return n + ' added, mole ' + row.label + ' is ' + back.status + ' at ' + back.nowMm.toFixed(1) + ' mm';
  }));
  await page.click('[data-tab="a"]');
  await page.click('#face-find');
  await page.waitForTimeout(3000);
  console.log('face button toast:', await page.textContent('#toast'));
  console.log('errors', errors);
  await browser.close();
})();
