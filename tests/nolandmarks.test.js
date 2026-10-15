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
    await page.evaluate(([k, r]) => { const p = state.photos[k]; p.ruler = r; changed(); }, [k, r]);
    await page.click('#find');
    await page.waitForFunction(() => document.getElementById('find').textContent === 'Find moles');
    console.log(k, await page.textContent('#mole-count'), '|', await page.textContent('#lm-count'));
  }
  await page.click('[data-tab="compare"]');
  console.log(await page.textContent('#align'));
  console.log(await page.$$eval('.stat', (d) => d.map((x) => x.innerText.replace(/\n/g, ' ')).join(', ')));
  await page.click('[data-tab="a"]');
  await page.click('#face-find');
  await page.waitForTimeout(3000);
  console.log('face button toast:', await page.textContent('#toast'));
  console.log('errors', errors);
  await browser.close();
})();
