// Mole Counter: finding, measuring and matching moles.
// Pure functions on a brightness array, so they run the same in the page
// and in the Node tests. Every coordinate in here is in working pixels;
// app.js converts to and from the original photo.

(function (root) {
  'use strict';

  // Brightness from green and blue, where melanin shows most. Red is
  // mostly left out since a flat brown spot barely changes it.
  function brightness(rgba, n) {
    const v = new Uint8ClampedArray(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      v[i] = 0.10 * rgba[j] + 0.45 * rgba[j + 1] + 0.45 * rgba[j + 2];
    }
    return v;
  }

  // Mean filter over a (2r+1) square, skipping pixels flagged in `skip`.
  // Falls back to the plain mean where every pixel in the square is skipped.
  function boxMean(src, w, h, r, skip) {
    const W = w + 1;
    const sum = new Float64Array(W * (h + 1));
    const cnt = new Float64Array(W * (h + 1));
    const all = new Float64Array(W * (h + 1));
    for (let y = 0; y < h; y++) {
      let rs = 0, rc = 0, ra = 0;
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const val = src[i];
        ra += val;
        if (!skip || !skip[i]) { rs += val; rc += 1; }
        const k = (y + 1) * W + (x + 1);
        sum[k] = sum[k - W] + rs;
        cnt[k] = cnt[k - W] + rc;
        all[k] = all[k - W] + ra;
      }
    }
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
        const a = y0 * W + x0, b = y0 * W + x1, c = y1 * W + x0, d = y1 * W + x1;
        const n = cnt[d] - cnt[b] - cnt[c] + cnt[a];
        if (n > 0) {
          out[y * w + x] = (sum[d] - sum[b] - sum[c] + sum[a]) / n;
        } else {
          const area = (x1 - x0) * (y1 - y0);
          out[y * w + x] = (all[d] - all[b] - all[c] + all[a]) / area;
        }
      }
    }
    return out;
  }

  // Skin brightness around every pixel, worked out on a smaller copy since
  // it changes slowly. Dark spots are left out of the second pass so a big
  // mole does not darken its own background.
  function skinBackground(v, w, h, radiusPx, drop) {
    const f = Math.max(1, Math.round(radiusPx / 12));
    const sw = Math.ceil(w / f), sh = Math.ceil(h / f);
    const s = new Float32Array(sw * sh);
    const c = new Float32Array(sw * sh);
    for (let y = 0; y < h; y++) {
      const sy = (y / f) | 0;
      for (let x = 0; x < w; x++) {
        const k = sy * sw + ((x / f) | 0);
        s[k] += v[y * w + x];
        c[k] += 1;
      }
    }
    for (let k = 0; k < s.length; k++) s[k] /= c[k];
    const r = Math.max(1, Math.round(radiusPx / f));
    const first = boxMean(s, sw, sh, r, null);
    const skip = new Uint8Array(sw * sh);
    for (let k = 0; k < s.length; k++) skip[k] = s[k] < first[k] * (1 - drop) ? 1 : 0;
    const bg = boxMean(s, sw, sh, r, skip);
    return { bg, f, sw, sh };
  }

  function sampleBackground(B, x, y) {
    const fx = Math.min(B.sw - 1, Math.max(0, (x + 0.5) / B.f - 0.5));
    const fy = Math.min(B.sh - 1, Math.max(0, (y + 0.5) / B.f - 0.5));
    const x0 = fx | 0, y0 = fy | 0;
    const x1 = Math.min(B.sw - 1, x0 + 1), y1 = Math.min(B.sh - 1, y0 + 1);
    const ax = fx - x0, ay = fy - y0;
    const g = B.bg, W = B.sw;
    const top = g[y0 * W + x0] * (1 - ax) + g[y0 * W + x1] * ax;
    const bot = g[y1 * W + x0] * (1 - ax) + g[y1 * W + x1] * ax;
    return top * (1 - ay) + bot * ay;
  }

  // Sensitivity 1 to 10 maps to how much darker than the skin a spot must be.
  function dropForSensitivity(s) {
    return Math.max(0.03, (24 - 2 * s) / 100);
  }

  // Region of pixels darker than halfway between the spot's core and the
  // skin around it, grown from the seed inside a square window. Returns
  // null when the edge cannot be found inside the window.
  function segmentFromSeed(v, w, h, sx, sy, half, opts) {
    opts = opts || {};
    const x0 = Math.max(0, sx - half), y0 = Math.max(0, sy - half);
    const x1 = Math.min(w - 1, sx + half), y1 = Math.min(h - 1, sy + half);
    const ww = x1 - x0 + 1, wh = y1 - y0 + 1;
    if (ww < 5 || wh < 5) return null;

    // Skin level: median of the outer band of the window.
    const band = Math.max(1, Math.round(Math.min(ww, wh) * 0.15));
    const hist = new Uint32Array(256);
    let bandN = 0;
    for (let y = y0; y <= y1; y++) {
      const inY = y - y0 < band || y1 - y >= 0 && y1 - y < band;
      for (let x = x0; x <= x1; x++) {
        if (inY || x - x0 < band || x1 - x < band) { hist[v[y * w + x]]++; bandN++; }
      }
    }
    let acc = 0, ring = 0;
    for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= bandN / 2) { ring = i; break; } }

    // Core level: darkest pixels near the seed.
    const cr = Math.max(1, opts.coreRadius || 2);
    const core = [];
    for (let y = Math.max(y0, sy - cr); y <= Math.min(y1, sy + cr); y++) {
      for (let x = Math.max(x0, sx - cr); x <= Math.min(x1, sx + cr); x++) core.push(v[y * w + x]);
    }
    core.sort((a, b) => a - b);
    const coreV = core[Math.floor(core.length * 0.25)];
    if (ring - coreV < Math.max(4, ring * (opts.minContrast || 0.04))) return null;
    const thr = (ring + coreV) / 2;

    // Seed on the darkest pixel near the tap.
    let seed = -1, best = 256;
    for (let y = Math.max(y0, sy - cr); y <= Math.min(y1, sy + cr); y++) {
      for (let x = Math.max(x0, sx - cr); x <= Math.min(x1, sx + cr); x++) {
        const val = v[y * w + x];
        if (val < best) { best = val; seed = (y - y0) * ww + (x - x0); }
      }
    }
    if (best >= thr) return null;

    const reg = new Uint8Array(ww * wh);
    const stack = new Int32Array(ww * wh);
    let sp = 0, count = 0, touches = false;
    stack[sp++] = seed; reg[seed] = 1;
    while (sp > 0) {
      const k = stack[--sp];
      count++;
      const lx = k % ww, ly = (k / ww) | 0;
      if (lx === 0 || ly === 0 || lx === ww - 1 || ly === wh - 1) touches = true;
      const nb = [k - 1, k + 1, k - ww, k + ww];
      const ok = [lx > 0, lx < ww - 1, ly > 0, ly < wh - 1];
      for (let q = 0; q < 4; q++) {
        if (!ok[q]) continue;
        const n = nb[q];
        if (reg[n]) continue;
        const gx = x0 + (n % ww), gy = y0 + ((n / ww) | 0);
        if (v[gy * w + gx] < thr) { reg[n] = 1; stack[sp++] = n; }
      }
    }
    if (touches || count < 3) return null;

    // Fill holes: anything outside the region that the window edge cannot reach.
    const outside = new Uint8Array(ww * wh);
    sp = 0;
    for (let x = 0; x < ww; x++) {
      for (const k of [x, (wh - 1) * ww + x]) if (!reg[k] && !outside[k]) { outside[k] = 1; stack[sp++] = k; }
    }
    for (let y = 0; y < wh; y++) {
      for (const k of [y * ww, y * ww + ww - 1]) if (!reg[k] && !outside[k]) { outside[k] = 1; stack[sp++] = k; }
    }
    while (sp > 0) {
      const k = stack[--sp];
      const lx = k % ww, ly = (k / ww) | 0;
      if (lx > 0 && !reg[k - 1] && !outside[k - 1]) { outside[k - 1] = 1; stack[sp++] = k - 1; }
      if (lx < ww - 1 && !reg[k + 1] && !outside[k + 1]) { outside[k + 1] = 1; stack[sp++] = k + 1; }
      if (ly > 0 && !reg[k - ww] && !outside[k - ww]) { outside[k - ww] = 1; stack[sp++] = k - ww; }
      if (ly < wh - 1 && !reg[k + ww] && !outside[k + ww]) { outside[k + ww] = 1; stack[sp++] = k + ww; }
    }
    let minX = ww, minY = wh, maxX = -1, maxY = -1;
    for (let k = 0; k < reg.length; k++) {
      if (!outside[k]) {
        reg[k] = 1;
        const lx = k % ww, ly = (k / ww) | 0;
        if (lx < minX) minX = lx; if (lx > maxX) maxX = lx;
        if (ly < minY) minY = ly; if (ly > maxY) maxY = ly;
      }
    }
    const mw = maxX - minX + 1, mh = maxY - minY + 1;
    const data = new Uint8Array(mw * mh);
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) data[y * mw + x] = reg[(y + minY) * ww + (x + minX)];
    }
    return measureMask({ x0: x0 + minX, y0: y0 + minY, w: mw, h: mh, data }, { contrast: (ring - coreV) / ring });
  }

  function convexHull(pts) {
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    upper.pop(); lower.pop();
    return lower.concat(upper);
  }

  // Area, centre, longest diameter (end points too) and the elongation of a mask.
  function measureMask(mask, extra) {
    const { x0, y0, w, h, data } = mask;
    let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    const edge = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!data[y * w + x]) continue;
        n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
        const isEdge = x === 0 || y === 0 || x === w - 1 || y === h - 1 ||
          !data[y * w + x - 1] || !data[y * w + x + 1] || !data[(y - 1) * w + x] || !data[(y + 1) * w + x];
        if (isEdge) {
          // pixel corners, so a one-pixel mole is one pixel wide
          edge.push([x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]);
        }
      }
    }
    if (!n) return null;
    const mx = sx / n, my = sy / n;
    const cxx = sxx / n - mx * mx, cyy = syy / n - my * my, cxy = sxy / n - mx * my;
    const tr = cxx + cyy, det = cxx * cyy - cxy * cxy;
    const disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
    const l1 = tr / 2 + disc, l2 = Math.max(1e-6, tr / 2 - disc);
    const hull = convexHull(edge);
    let feret = 0, fa = hull[0], fb = hull[0];
    for (let i = 0; i < hull.length; i++) {
      for (let j = i + 1; j < hull.length; j++) {
        const dx = hull[i][0] - hull[j][0], dy = hull[i][1] - hull[j][1];
        const d = dx * dx + dy * dy;
        if (d > feret) { feret = d; fa = hull[i]; fb = hull[j]; }
      }
    }
    return Object.assign({
      cx: x0 + mx + 0.5,
      cy: y0 + my + 0.5,
      area: n,
      feret: Math.sqrt(feret),
      feretA: [x0 + fa[0], y0 + fa[1]],
      feretB: [x0 + fb[0], y0 + fb[1]],
      elong: Math.sqrt(l1 / l2),
      mask,
    }, extra || {});
  }

  function eqDiameter(area) { return Math.sqrt(4 * area / Math.PI); }

  // Finds every spot darker than the skin around it within the size range.
  // opts: pxPerMm (working pixels), minMm, maxMm, sensitivity 1 to 10.
  // Two passes: one against the skin over about 15 mm for larger moles, and
  // one against the skin within 3 mm, which picks out small faint spots
  // that a shadow or a blush across the cheek would hide from the first.
  function detect(v, w, h, opts) {
    const big = detectPass(v, w, h, opts);
    if (opts.smallPass === false) return big;
    const small = detectPass(v, w, h, Object.assign({}, opts, { maxMm: Math.min(opts.maxMm, 4), bgMm: 3 }));
    const near = Math.max(2, opts.pxPerMm * 0.5);
    const inside = (m, o) => {
      const { x0, y0, w: mw, h: mh, data } = o.mask;
      const x = Math.floor(m.cx) - x0, y = Math.floor(m.cy) - y0;
      return x >= 0 && y >= 0 && x < mw && y < mh && data[y * mw + x] === 1;
    };
    const out = big.slice();
    for (const m of small) {
      if (out.some((o) => Math.hypot(o.cx - m.cx, o.cy - m.cy) < near || inside(m, o))) continue;
      out.push(m);
    }
    return out;
  }

  function detectPass(v, w, h, opts) {
    const ppm = opts.pxPerMm;
    const minPx = opts.minMm * ppm, maxPx = opts.maxMm * ppm;
    const drop = dropForSensitivity(opts.sensitivity);
    const B = skinBackground(v, w, h, Math.max(6, opts.bgMm ? opts.bgMm * ppm : maxPx), drop);

    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (v[i] < sampleBackground(B, x, y) * (1 - drop)) mask[i] = 1;
      }
    }

    const minArea = Math.PI / 4 * minPx * minPx;
    const maxArea = Math.PI / 4 * maxPx * maxPx;
    const seen = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    const candidates = [];
    for (let start = 0; start < w * h; start++) {
      if (!mask[start] || seen[start]) continue;
      let sp = 0, n = 0, minX = w, minY = h, maxX = 0, maxY = 0, darkest = 256, seed = start;
      stack[sp++] = start; seen[start] = 1;
      while (sp > 0) {
        const k = stack[--sp];
        n++;
        const x = k % w, y = (k / w) | 0;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (v[k] < darkest) { darkest = v[k]; seed = k; }
        if (x > 0 && mask[k - 1] && !seen[k - 1]) { seen[k - 1] = 1; stack[sp++] = k - 1; }
        if (x < w - 1 && mask[k + 1] && !seen[k + 1]) { seen[k + 1] = 1; stack[sp++] = k + 1; }
        if (y > 0 && mask[k - w] && !seen[k - w]) { seen[k - w] = 1; stack[sp++] = k - w; }
        if (y < h - 1 && mask[k + w] && !seen[k + w]) { seen[k + w] = 1; stack[sp++] = k + w; }
      }
      if (n < minArea * 0.5 || n > maxArea * 1.5) continue;
      if (minX === 0 || minY === 0 || maxX === w - 1 || maxY === h - 1) continue;
      const bw = maxX - minX + 1, bh = maxY - minY + 1;
      if (n / (bw * bh) < 0.25) continue;
      candidates.push({ seed, bw, bh });
    }

    const out = [];
    for (const c of candidates) {
      const sx = c.seed % w, sy = (c.seed / w) | 0;
      const half = Math.round(Math.max(c.bw, c.bh) * 1.2 + ppm * 1.5);
      const m = segmentFromSeed(v, w, h, sx, sy, Math.min(half, Math.round(maxPx * 1.6)), { coreRadius: Math.max(1, Math.round(ppm * 0.3)), minContrast: opts.minContrast || 0.08 });
      if (!m) continue;
      const d = eqDiameter(m.area);
      if (d < minPx || d > maxPx) continue;
      if (m.elong > 3) continue; // hair and creases
      if (out.some((o) => Math.hypot(o.cx - m.cx, o.cy - m.cy) < Math.max(2, ppm * 0.5))) continue;
      out.push(m);
    }
    return out;
  }

  // A mole the doctor tapped. Looks for the darkest pixel within 1 mm of
  // the tap and grows the region from there.
  function segmentAt(v, w, h, x, y, opts) {
    const ppm = opts.pxPerMm || 8;
    const r = Math.max(2, Math.round(ppm * (opts.searchMm || 1)));
    let bx = Math.round(x), by = Math.round(y), best = 256;
    for (let yy = Math.max(0, by - r); yy <= Math.min(h - 1, by + r); yy++) {
      for (let xx = Math.max(0, bx - r); xx <= Math.min(w - 1, bx + r); xx++) {
        if ((xx - x) ** 2 + (yy - y) ** 2 > r * r) continue;
        if (v[yy * w + xx] < best) { best = v[yy * w + xx]; bx = xx; by = yy; }
      }
    }
    const maxPx = (opts.maxMm || 15) * ppm;
    for (const f of [0.35, 0.7, 1.1]) {
      const m = segmentFromSeed(v, w, h, bx, by, Math.max(6, Math.round(maxPx * f)), { coreRadius: Math.max(1, Math.round(ppm * 0.3)), minContrast: opts.minContrast || 0.03 });
      if (m) return m;
    }
    return null;
  }

  // Landmarks: maps points in `from` onto `to`. Two or three landmarks fit
  // size, rotation and position. Four or more also fit skew.
  function fitTransform(from, to, similarityOnly) {
    const n = Math.min(from.length, to.length);
    if (n < 2) return null;
    if (n < 4 || similarityOnly) {
      let mfx = 0, mfy = 0, mtx = 0, mty = 0;
      for (let i = 0; i < n; i++) { mfx += from[i][0]; mfy += from[i][1]; mtx += to[i][0]; mty += to[i][1]; }
      mfx /= n; mfy /= n; mtx /= n; mty /= n;
      let sxx = 0, sxy = 0, ss = 0;
      for (let i = 0; i < n; i++) {
        const fx = from[i][0] - mfx, fy = from[i][1] - mfy;
        const tx = to[i][0] - mtx, ty = to[i][1] - mty;
        sxx += fx * tx + fy * ty;
        sxy += fx * ty - fy * tx;
        ss += fx * fx + fy * fy;
      }
      if (ss === 0) return null;
      const a = sxx / ss, b = sxy / ss;
      return [a, -b, mtx - (a * mfx - b * mfy), b, a, mty - (b * mfx + a * mfy)];
    }
    // Least squares affine through the normal equations.
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const rx = [0, 0, 0], ry = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const row = [from[i][0], from[i][1], 1];
      for (let p = 0; p < 3; p++) {
        for (let q = 0; q < 3; q++) M[p][q] += row[p] * row[q];
        rx[p] += row[p] * to[i][0];
        ry[p] += row[p] * to[i][1];
      }
    }
    const px = solve3(M, rx), py = solve3(M, ry);
    if (!px || !py) return null;
    return [px[0], px[1], px[2], py[0], py[1], py[2]];
  }

  function solve3(A, b) {
    const m = A.map((r, i) => r.concat([b[i]]));
    for (let c = 0; c < 3; c++) {
      let piv = c;
      for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r;
      if (Math.abs(m[piv][c]) < 1e-12) return null;
      [m[c], m[piv]] = [m[piv], m[c]];
      for (let r = 0; r < 3; r++) {
        if (r === c) continue;
        const f = m[r][c] / m[c][c];
        for (let k = c; k < 4; k++) m[r][k] -= f * m[c][k];
      }
    }
    return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
  }

  function applyTransform(T, x, y) {
    return [T[0] * x + T[1] * y + T[2], T[3] * x + T[4] * y + T[5]];
  }

  function invertTransform(T) {
    const det = T[0] * T[4] - T[1] * T[3];
    if (Math.abs(det) < 1e-12) return null;
    const a = T[4] / det, b = -T[1] / det, d = -T[3] / det, e = T[0] / det;
    return [a, b, -(a * T[2] + b * T[5]), d, e, -(d * T[2] + e * T[5])];
  }

  // Pairs each mole in `now` (already mapped into last visit's pixels) with
  // the nearest mole from `last` inside `maxDist`, closest pairs first.
  function matchMoles(last, now, maxDist) {
    const pairs = [];
    for (let i = 0; i < last.length; i++) {
      for (let j = 0; j < now.length; j++) {
        const d = Math.hypot(last[i][0] - now[j][0], last[i][1] - now[j][1]);
        if (d <= maxDist) pairs.push([d, i, j]);
      }
    }
    pairs.sort((a, b) => a[0] - b[0]);
    const usedL = new Set(), usedN = new Set(), out = [];
    for (const [d, i, j] of pairs) {
      if (usedL.has(i) || usedN.has(j)) continue;
      usedL.add(i); usedN.add(j);
      out.push({ last: i, now: j, dist: d });
    }
    return out;
  }

  // Lines this visit up on the last one from the moles themselves, for
  // photos without landmarks. Every pair of moles on this visit is tried
  // against every pair on the last visit with a matching distance, and the
  // fit that lands the most moles within `tol` of a mole wins.
  // a, b: [x, y] centres in each photo's pixels. scale: expected last-visit
  // pixels per this-visit pixel, from the two photo scales.
  function alignByMoles(a, b, scale, tol, opts) {
    opts = opts || {};
    const maxTurn = (opts.maxTurnDeg || 60) * Math.PI / 180;
    const scaleSlack = opts.scaleSlack || 0.12;
    if (a.length < 3 || b.length < 3) return null;

    // Grid over the last visit's moles for quick nearest lookups.
    const cell = tol;
    const grid = new Map();
    a.forEach((p, i) => {
      const k = Math.floor(p[0] / cell) + ',' + Math.floor(p[1] / cell);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    });
    const nearest = (x, y) => {
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
      let best = -1, bd = tol;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const list = grid.get((cx + dx) + ',' + (cy + dy));
          if (!list) continue;
          for (const i of list) {
            const d = Math.hypot(a[i][0] - x, a[i][1] - y);
            if (d < bd) { bd = d; best = i; }
          }
        }
      }
      return best < 0 ? null : [best, bd];
    };

    const minSpan = tol * 4;
    const pairs = (pts) => {
      const out = [];
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const d = Math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]);
          if (d >= minSpan) out.push([i, j, d]);
        }
      }
      return out;
    };
    const pa = pairs(a).sort((p, q) => p[2] - q[2]);
    // Long pairs pin rotation best. Try at most 150 of them, spread over the list.
    const allB = pairs(b).sort((p, q) => q[2] - p[2]);
    const cap = opts.maxPairs || 150;
    const pb = allB.length <= cap ? allB : Array.from({ length: cap }, (_, k) => allB[Math.floor(k * allB.length / cap)]);
    const enough = Math.ceil(Math.min(a.length, b.length) * 0.9);
    const dists = pa.map((p) => p[2]);
    const lowerBound = (v) => {
      let lo = 0, hi = dists.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (dists[m] < v) lo = m + 1; else hi = m; }
      return lo;
    };

    let best = null;
    search:
    for (const [i, j, db] of pb) {
      const want = db * scale;
      const start = lowerBound(want * (1 - scaleSlack));
      for (let q = start; q < pa.length && pa[q][2] <= want * (1 + scaleSlack); q++) {
        for (const [k, l] of [[pa[q][0], pa[q][1]], [pa[q][1], pa[q][0]]]) {
          const T = fitTransform([b[i], b[j]], [a[k], a[l]]);
          if (!T) continue;
          if (Math.abs(Math.atan2(T[3], T[0])) > maxTurn) continue;
          let n = 0, err = 0;
          for (const p of b) {
            const [x, y] = applyTransform(T, p[0], p[1]);
            const hit = nearest(x, y);
            if (hit) { n++; err += hit[1]; }
          }
          if (!best || n > best.n || (n === best.n && err < best.err)) best = { n, err, T };
          if (best.n >= enough) break search;
        }
      }
    }
    // Two moles always fit, so a fit counts only when enough others agree.
    const need = Math.max(4, Math.ceil(Math.min(a.length, b.length) * 0.4));
    if (!best || best.n < need) return null;

    // Refit on every mole the winner lined up.
    const from = [], to = [];
    const used = new Set();
    for (const p of b) {
      const [x, y] = applyTransform(best.T, p[0], p[1]);
      const hit = nearest(x, y);
      if (hit && !used.has(hit[0])) { used.add(hit[0]); from.push(p); to.push(a[hit[0]]); }
    }
    const T = fitTransform(from, to, from.length < 6) || best.T;
    let ss = 0;
    for (let i = 0; i < from.length; i++) {
      const q = applyTransform(T, from[i][0], from[i][1]);
      ss += (q[0] - to[i][0]) ** 2 + (q[1] - to[i][1]) ** 2;
    }
    return { T, inliers: from.length, rms: Math.sqrt(ss / from.length) };
  }

  // ------------------------------------------------------------------
  // Area masks: 1 where moles are looked for, 0 outside.
  // ------------------------------------------------------------------

  // Sets every pixel inside the polygon to `value` (even-odd scanline fill).
  function fillPolygon(mask, w, h, pts, value) {
    if (pts.length < 3) return;
    let minY = h, maxY = 0;
    for (const p of pts) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
    minY = Math.max(0, Math.floor(minY)); maxY = Math.min(h - 1, Math.ceil(maxY));
    const xs = [];
    for (let y = minY; y <= maxY; y++) {
      const yc = y + 0.5;
      xs.length = 0;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [x1, y1] = pts[j], [x2, y2] = pts[i];
        if ((y1 <= yc && y2 > yc) || (y2 <= yc && y1 > yc)) xs.push(x1 + (yc - y1) / (y2 - y1) * (x2 - x1));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const x0 = Math.max(0, Math.ceil(xs[k] - 0.5)), x1 = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5));
        for (let x = x0; x <= x1; x++) mask[y * w + x] = value;
      }
    }
  }

  // Grows or shrinks a polygon about its centre.
  function scalePolygon(pts, f) {
    let cx = 0, cy = 0;
    for (const p of pts) { cx += p[0]; cy += p[1]; }
    cx /= pts.length; cy /= pts.length;
    return pts.map((p) => [cx + (p[0] - cx) * f, cy + (p[1] - cy) * f]);
  }

  // Labels 4-connected regions of 1s. Returns { labels, sizes } with labels
  // starting at 1.
  function components(mask, w, h) {
    const labels = new Int32Array(w * h);
    const sizes = [0];
    const stack = new Int32Array(w * h);
    let next = 1;
    for (let s = 0; s < w * h; s++) {
      if (!mask[s] || labels[s]) continue;
      let sp = 0, n = 0;
      stack[sp++] = s; labels[s] = next;
      while (sp > 0) {
        const k = stack[--sp]; n++;
        const x = k % w, y = (k / w) | 0;
        if (x > 0 && mask[k - 1] && !labels[k - 1]) { labels[k - 1] = next; stack[sp++] = k - 1; }
        if (x < w - 1 && mask[k + 1] && !labels[k + 1]) { labels[k + 1] = next; stack[sp++] = k + 1; }
        if (y > 0 && mask[k - w] && !labels[k - w]) { labels[k - w] = next; stack[sp++] = k - w; }
        if (y < h - 1 && mask[k + w] && !labels[k + w]) { labels[k + w] = next; stack[sp++] = k + w; }
      }
      sizes.push(n);
      next++;
    }
    return { labels, sizes };
  }

  // Keeps regions at least `minShare` of the biggest one.
  function keepLarge(mask, w, h, minShare) {
    const { labels, sizes } = components(mask, w, h);
    const biggest = Math.max(0, ...sizes);
    const out = new Uint8Array(w * h);
    if (!biggest) return out;
    for (let k = 0; k < w * h; k++) if (labels[k] && sizes[labels[k]] >= biggest * minShare) out[k] = 1;
    return out;
  }

  // Fills holes: 0s the edge of the image cannot reach become 1. A dark mole
  // the skin finder skipped sits in such a hole. With `maxSize`, only holes
  // up to that many pixels are filled, so a lock of hair stays out.
  function fillHoles(mask, w, h, maxSize) {
    const inv = new Uint8Array(w * h);
    for (let k = 0; k < w * h; k++) inv[k] = mask[k] ? 0 : 1;
    const { labels, sizes } = components(inv, w, h);
    const outside = new Set();
    for (let x = 0; x < w; x++) { outside.add(labels[x]); outside.add(labels[(h - 1) * w + x]); }
    for (let y = 0; y < h; y++) { outside.add(labels[y * w]); outside.add(labels[y * w + w - 1]); }
    const out = new Uint8Array(w * h);
    for (let k = 0; k < w * h; k++) {
      const l = labels[k];
      out[k] = mask[k] || (!outside.has(l) && (!maxSize || sizes[l] <= maxSize)) ? 1 : 0;
    }
    return out;
  }

  function dilate(mask, w, h, r) {
    if (r <= 0) return mask;
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!mask[y * w + x]) continue;
        for (let dy = -r; dy <= r; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -r; dx <= r; dx++) {
            const xx = x + dx;
            if (xx >= 0 && xx < w && dx * dx + dy * dy <= r * r) out[yy * w + xx] = 1;
          }
        }
      }
    }
    return out;
  }

  // Skin by colour, for photos the person finder cannot read. Keeps the
  // big skin regions and fills the holes moles leave in them. Returns null
  // when under `minShare` of the photo looks like skin.
  function skinByColour(rgba, w, h, minShare) {
    const m = new Uint8Array(w * h);
    let n = 0;
    for (let k = 0, j = 0; k < w * h; k++, j += 4) {
      const r = rgba[j], g = rgba[j + 1], b = rgba[j + 2];
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      const cb = 128 - 0.1687 * r - 0.3313 * g + 0.5 * b;
      const cr = 128 + 0.5 * r - 0.4187 * g - 0.0813 * b;
      if (y > 45 && cr >= 133 && cr <= 180 && cb >= 77 && cb <= 135 && r > b) { m[k] = 1; n++; }
    }
    if (n < w * h * (minShare || 0.05)) return null;
    const kept = fillHoles(keepLarge(m, w, h, 0.25), w, h);
    let left = 0;
    for (let k = 0; k < w * h; k++) left += kept[k];
    return left >= w * h * (minShare || 0.05) ? kept : null;
  }

  function maskBounds(mask, w, h) {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!mask[y * w + x]) continue;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
  }

  const api = {
    brightness, boxMean, skinBackground, sampleBackground, dropForSensitivity,
    segmentFromSeed, segmentAt, measureMask, convexHull, eqDiameter, detect,
    fitTransform, applyTransform, invertTransform, matchMoles, alignByMoles,
    fillPolygon, scalePolygon, components, keepLarge, fillHoles, dilate, skinByColour, maskBounds,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MoleCore = api;
})(this);
