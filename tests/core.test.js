// Node test: synthetic skin with moles of known size.
const M = require('../moles.js');
let fails = 0;
function check(name, ok, info) { console.log((ok ? 'ok   ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fails++; }

function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }

function makeSkin(w, h, ppm, moles, opts = {}) {
  const r = rng(opts.seed || 7);
  const v = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let base = (opts.base || 190) + 15 * (x / w) - 10 * (y / h) + (r() - 0.5) * 8;
    for (const m of moles) {
      const rad = m.d * ppm / 2;
      const dist = Math.hypot((x + 0.5 - m.x) / (m.sx || 1), (y + 0.5 - m.y));
      const t = Math.min(1, Math.max(0, (rad - dist) / 1.5 + 0.5)); // soft edge 1.5 px
      base = base * (1 - t) + (m.v || 95) * t;
    }
    v[y * w + x] = base;
  }
  return v;
}

const ppm = 8, w = 1200, h = 900;
const truth = [
  { x: 150, y: 150, d: 2 }, { x: 400, y: 200, d: 3 }, { x: 700, y: 180, d: 5 },
  { x: 1000, y: 300, d: 8, v: 120 }, { x: 300, y: 600, d: 4 }, { x: 650, y: 650, d: 6.5 },
  { x: 950, y: 700, d: 1.5, v: 110 },
];
const v = makeSkin(w, h, ppm, truth);
// a hair: long thin dark line
for (let x = 500; x < 800; x++) for (let t = -1; t <= 1; t++) v[(420 + t) * w + x] = 90;

let t0 = Date.now();
const found = M.detect(v, w, h, { pxPerMm: ppm, minMm: 1, maxMm: 15, sensitivity: 7 });
console.log('detect ms', Date.now() - t0, 'found', found.length);
check('finds all 7 moles and skips the hair', found.length === 7, 'found ' + found.length);
for (const m of truth) {
  const f = found.find((o) => Math.hypot(o.cx - m.x, o.cy - m.y) < 3);
  const dmm = f ? f.feret / ppm : NaN;
  check('mole ' + m.d + ' mm at ' + m.x + ',' + m.y, f && Math.abs(dmm - m.d) < 0.35, f ? 'diameter ' + dmm.toFixed(2) + ' mm, area ' + (f.area / ppm / ppm).toFixed(1) + ' mm2 (true ' + (Math.PI * m.d * m.d / 4).toFixed(1) + ')' : 'missing');
}

// Tap to add
const tap = M.segmentAt(v, w, h, 403, 197, { pxPerMm: ppm, maxMm: 15 });
check('tap finds the 3 mm mole', tap && Math.abs(tap.feret / ppm - 3) < 0.35, tap && (tap.feret / ppm).toFixed(2));
const blank = M.segmentAt(v, w, h, 560, 300, { pxPerMm: ppm, maxMm: 15 });
check('tap on plain skin finds nothing', blank === null);

// Second visit: shifted, rotated 4 degrees, 10% further away, one mole grown, one gone, one new
const ang = 4 * Math.PI / 180, sc = 0.9, ox = 40, oy = -25;
const fwd = (x, y) => [sc * (Math.cos(ang) * (x - 600) - Math.sin(ang) * (y - 450)) + 600 + ox, sc * (Math.sin(ang) * (x - 600) + Math.cos(ang) * (y - 450)) + 450 + oy];
const truth2 = truth.filter((m, i) => i !== 1).map((m) => {
  const [x, y] = fwd(m.x, m.y);
  return Object.assign({}, m, { x, y, d: (m.x === 650 ? m.d + 1.5 : m.d) * sc });
});
const [nx, ny] = fwd(850, 450); truth2.push({ x: nx, y: ny, d: 3 * sc });
const v2 = makeSkin(w, h, ppm, truth2, { seed: 99, base: 175 });
const found2 = M.detect(v2, w, h, { pxPerMm: ppm * sc, minMm: 1, maxMm: 15, sensitivity: 7 });
check('second visit finds 7', found2.length === 7, 'found ' + found2.length);
const lmA = [[100, 800], [1100, 820], [600, 100]];
const lmB = lmA.map((p) => fwd(p[0], p[1]));
const T = M.fitTransform(lmB, lmA);
const mapped = found2.map((m) => M.applyTransform(T, m.cx, m.cy));
const pairs = M.matchMoles(found.map((m) => [m.cx, m.cy]), mapped, 3 * ppm);
check('6 moles matched', pairs.length === 6, String(pairs.length));
const grown = pairs.find((p) => Math.abs(found[p.last].cx - 650) < 3);
const growth = found2[grown.now].feret / (ppm * sc) - found[grown.last].feret / ppm;
check('grown mole reads +1.5 mm', Math.abs(growth - 1.5) < 0.4, growth.toFixed(2));
const T2 = M.fitTransform(lmB.slice(0, 2), lmA.slice(0, 2));
const back = M.applyTransform(T2, lmB[2][0], lmB[2][1]);
check('two-landmark fit places the third', Math.hypot(back[0] - lmA[2][0], back[1] - lmA[2][1]) < 0.5);
const T4 = M.fitTransform(lmB.concat([fwd(300, 300)]), lmA.concat([[300, 300]]));
const inv = M.invertTransform(T4);
const rt = M.applyTransform(inv, ...M.applyTransform(T4, 123, 456));
check('affine round trip', Math.hypot(rt[0] - 123, rt[1] - 456) < 1e-6);


// Lining up on the moles alone
{
  const r2 = rng(5);
  const ptsA = []; for (let i = 0; i < 25; i++) ptsA.push([100 + r2() * 2800, 100 + r2() * 2000]);
  const ang2 = 12 * Math.PI / 180, sc2 = 1.15;
  const toB = (p) => [ (Math.cos(ang2) * (p[0] - 1500) - Math.sin(ang2) * (p[1] - 1100)) / sc2 + 1400 + (r2() - 0.5) * 3,
                       (Math.sin(ang2) * (p[0] - 1500) + Math.cos(ang2) * (p[1] - 1100)) / sc2 + 1000 + (r2() - 0.5) * 3 ];
  let ptsB = ptsA.map(toB);
  ptsB = ptsB.slice(3);                       // 3 gone
  for (let i = 0; i < 4; i++) ptsB.push([200 + r2() * 2400, 200 + r2() * 1800]);  // 4 new
  const t0 = Date.now();
  const res = M.alignByMoles(ptsA, ptsB, sc2, 30);
  const ms = Date.now() - t0;
  check('moles line up without landmarks', res && res.inliers >= 20, res ? res.inliers + ' inliers, rms ' + res.rms.toFixed(1) + ' px, ' + ms + ' ms' : 'none');
  const back = res && M.applyTransform(res.T, ...toB(ptsA[10]));
  check('mapped point lands on its mole', back && Math.hypot(back[0] - ptsA[10][0], back[1] - ptsA[10][1]) < 6);
  const many = []; for (let i = 0; i < 60; i++) many.push([r2() * 3000, r2() * 2200]);
  const t1 = Date.now(); M.alignByMoles(many, many.map(toB), sc2, 30);
  check('60 moles align in under 2 s', Date.now() - t1 < 2000, (Date.now() - t1) + ' ms');
  check('too few moles returns nothing', M.alignByMoles(ptsA.slice(0, 2), ptsB, 1, 30) === null);
}


// Area masks
{
  const w = 200, h = 150;
  const m = new Uint8Array(w * h);
  M.fillPolygon(m, w, h, [[50, 30], [150, 30], [150, 120], [50, 120]], 1);
  let n = 0; for (const v of m) n += v;
  check('polygon fill covers its area', Math.abs(n - 100 * 90) < 200, String(n));
  M.fillPolygon(m, w, h, M.scalePolygon([[90, 60], [110, 60], [110, 80], [90, 80]], 1.5), 0);
  let n2 = 0; for (const v of m) n2 += v;
  check('cut-out removes the eye area', Math.abs((n - n2) - 30 * 30) < 120, String(n - n2));
  const holed = new Uint8Array(w * h);
  M.fillPolygon(holed, w, h, [[20, 20], [180, 20], [180, 130], [20, 130]], 1);
  M.fillPolygon(holed, w, h, [[60, 60], [70, 60], [70, 70], [60, 70]], 0);
  const filled = M.fillHoles(holed, w, h);
  check('a mole-sized hole is filled', filled[65 * w + 65] === 1 && filled[5 * w + 5] === 0);
  const two = new Uint8Array(w * h);
  M.fillPolygon(two, w, h, [[10, 10], [100, 10], [100, 140], [10, 140]], 1);
  M.fillPolygon(two, w, h, [[150, 10], [155, 10], [155, 15], [150, 15]], 1);
  const kept = M.keepLarge(two, w, h, 0.25);
  check('a speck far from the subject is dropped', kept[12 * w + 152] === 0 && kept[50 * w + 50] === 1);
  // skin by colour: skin-toned square on a grey-blue room
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const j = (y * w + x) * 4;
    const skin = x > 60 && x < 140 && y > 20 && y < 140;
    const mole = Math.hypot(x - 100, y - 80) < 4;
    const c = mole ? [90, 60, 45] : skin ? [214, 168, 140] : [120, 130, 150];
    rgba[j] = c[0]; rgba[j + 1] = c[1]; rgba[j + 2] = c[2]; rgba[j + 3] = 255;
  }
  const sk = M.skinByColour(rgba, w, h, 0.05);
  check('skin found by colour, background left out', sk && sk[80 * w + 100] === 1 && sk[80 * w + 20] === 0, sk ? 'ok' : 'none');
  check('mask bounds', JSON.stringify(M.maskBounds(sk, w, h)) === JSON.stringify([61, 21, 140, 140]), JSON.stringify(M.maskBounds(sk, w, h)));
}

// Speed at full working size
const big = makeSkin(3000, 2250, 8, truth.map((m) => Object.assign({}, m, { x: m.x * 2.5, y: m.y * 2.5 })));
t0 = Date.now();
const fb = M.detect(big, 3000, 2250, { pxPerMm: 8, minMm: 1, maxMm: 15, sensitivity: 7 });
console.log('3000x2250 detect ms', Date.now() - t0, 'found', fb.length);
process.exit(fails ? 1 : 0);
