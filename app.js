// Mole Counter, Cygnus Solutions
// Two photos of one body segment: the last visit and this visit. Each gets
// a scale, landmarks and its marked moles. Compare lines this visit up on
// the last one through the landmarks and pairs the moles.
'use strict';

const C = window.MoleCore;
const WORK_MAX = 3000;          // longest side of the copy the detector reads
const LS_KEY = 'molecounter.settings.v1';
const MAX_LANDMARKS = 12;
const HANDLE_HIT_PX = 24;       // screen pixels around a ruler mark or landmark that grab it
const MOLE_HIT_PX = 16;
const OVER_MM = 6;              // the D in ABCDE

// Face landmarks come from MediaPipe, the same build Cygnus Measure uses.
const MP_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18';
const MP_WASM = MP_URL + '/wasm';
const MP_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
// Points that hold still through expressions, in landmark order. The
// patient's right is on the left of a front photo.
const FACE_POINTS = [
  [133, 'Right eye, inner corner'],
  [362, 'Left eye, inner corner'],
  [33, 'Right eye, outer corner'],
  [263, 'Left eye, outer corner'],
  [168, 'Between the eyes'],
  [2, 'Under the nose'],
];
// Each photo is read in several framings and each point is the median, as
// in Cygnus Measure, since the mesh shifts with the crop.
const FACE_FRAMINGS = [
  [0, 0, 0, 0], [0.15, 0.15, 0.15, 0.15], [-0.08, -0.08, -0.08, -0.08], [-0.06, 0, 0.06, 0], [0.06, 0, -0.06, 0],
];
const FACE_DETECT_MAX = 1600;   // longest side handed to the detector

const COLORS = {
  mark: '#E0B45A',
  landmark: '#4FD1E8',
  ruler: '#F6EEDC',
  same: '#5BD68A',
  grown: '#FF5D5D',
  shrunk: '#5AA8FF',
  new: '#D17BFF',
  gone: '#FFFFFF',
  out: '#AEB7C4',
  selected: '#FFFFFF',
};

const STATUS_WORD = {
  same: 'Same', grown: 'Grown', shrunk: 'Shrunk', new: 'New', gone: 'Gone', out: 'Not in frame',
};

function newPhoto(key) {
  return {
    key,
    name: '', bitmap: null, W: 0, H: 0,
    ws: 1, ww: 0, wh: 0, v: null,
    scaleMode: 'ruler', ruler: [], rulerMm: 10,
    landmarks: [], lmMm: null, faceLandmarks: false, faceBusy: false,
    moles: [], history: [], view: null,
  };
}

const state = {
  tab: 'a',
  tool: null,
  cview: 'b',
  selected: null,       // compare row key, or a mole id on a photo tab
  version: 0,
  settings: { sensitivity: 7, minMm: 1, maxMm: 15, matchMm: 3, growthMm: 1 },
  photos: { a: newPhoto('a'), b: newPhoto('b') },
};
const A = state.photos.a, B = state.photos.b;
let moleSeq = 0;

const $ = (id) => document.getElementById(id);
const dom = {};

// ---------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------
function loadSettings() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) Object.assign(state.settings, JSON.parse(raw));
  } catch (e) { /* private window or blocked storage */ }
}
function saveSettings() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state.settings)); } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
const fmt = (n, d = 1) => (Math.round(n * 10 ** d) / 10 ** d).toFixed(d);
function signed(n, d = 1) {
  const r = Math.round(n * 10 ** d) / 10 ** d;
  return (r > 0 ? '+' : r < 0 ? '−' : '') + fmt(Math.abs(r), d);
}

// Distance in mm between landmarks 1 and 2 used for this photo's scale.
// This visit takes it from the last visit unless the doctor typed one.
function landmarkMm(p) {
  if (p.lmMm > 0) return p.lmMm;
  if (p === B) return lastVisitLandmarkMm();
  return null;
}
function lastVisitLandmarkMm() {
  if (A.landmarks.length < 2) return null;
  const s = pxPerMm(A);
  return s ? dist(A.landmarks[0], A.landmarks[1]) / s : null;
}

// Original photo pixels per millimetre, or null when the scale is not set.
function pxPerMm(p) {
  if (p.scaleMode === 'ruler') {
    if (p.ruler.length < 2 || !(p.rulerMm > 0)) return null;
    const d = dist(p.ruler[0], p.ruler[1]);
    return d > 0 ? d / p.rulerMm : null;
  }
  if (p.landmarks.length < 2) return null;
  const mm = landmarkMm(p);
  if (!(mm > 0)) return null;
  const d = dist(p.landmarks[0], p.landmarks[1]);
  return d > 0 ? d / mm : null;
}

function moleMm(p, m) {
  const s = pxPerMm(p);
  return s ? { d: m.feret / s, area: m.area / (s * s) } : null;
}

// Numbers the last visit's moles top to bottom, left to right, in bands.
function numberLastVisit() {
  const s = pxPerMm(A) || A.H / 200;
  const band = 12 * s;
  const sorted = A.moles.slice().sort((m, n) =>
    (Math.floor(m.cy / band) - Math.floor(n.cy / band)) || (m.cx - n.cx));
  const map = new Map();
  sorted.forEach((m, i) => map.set(m.id, String(i + 1)));
  return map;
}

// ---------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------
let compareCache = { version: -1, result: null };

function compare() {
  if (compareCache.version === state.version) return compareCache.result;
  const result = buildCompare();
  compareCache = { version: state.version, result };
  return result;
}

function buildCompare() {
  const missing = [];
  for (const [p, name] of [[A, 'last visit'], [B, 'this visit']]) {
    if (!p.bitmap) { missing.push('Choose the ' + name + ' photo.'); continue; }
    if (!pxPerMm(p)) missing.push('Set the scale on the ' + name + ' photo.');
    if (!p.moles.length) missing.push('Find the moles on the ' + name + ' photo.');
  }
  const useLandmarks = A.landmarks.length >= 2 && B.landmarks.length >= 2;
  if (useLandmarks && A.landmarks.length !== B.landmarks.length) {
    missing.push('Place the same number of landmarks on both photos. The last visit has ' +
      A.landmarks.length + ' and this visit has ' + B.landmarks.length + '.');
  }
  if (missing.length) return { missing };

  const sA = pxPerMm(A), sB = pxPerMm(B);
  let T, residualMm = null, n = 0, byMoles = null;
  if (useLandmarks) {
    n = A.landmarks.length;
    T = C.fitTransform(B.landmarks, A.landmarks);   // this visit -> last visit pixels
    if (!T || !C.invertTransform(T)) return { missing: ['Landmarks 1 and 2 sit on the same spot. Move one of them.'] };
    if (n >= 3) {
      let ss = 0;
      for (let i = 0; i < n; i++) {
        const q = C.applyTransform(T, B.landmarks[i][0], B.landmarks[i][1]);
        ss += dist(q, A.landmarks[i]) ** 2;
      }
      residualMm = Math.sqrt(ss / n) / sA;
    }
  } else {
    // No landmarks on one photo: line the photos up on the moles themselves.
    const res = C.alignByMoles(A.moles.map((m) => [m.cx, m.cy]), B.moles.map((m) => [m.cx, m.cy]),
      sA / sB, state.settings.matchMm * sA);
    if (!res) {
      return { missing: ['The moles on the two photos could not be lined up. Place at least 2 landmarks on both photos in the same order.'] };
    }
    T = res.T;
    byMoles = { inliers: res.inliers, rmsMm: res.rms / sA };
  }
  const Tinv = C.invertTransform(T);

  let stretch = null;
  if (useLandmarks && A.scaleMode === 'ruler' && B.scaleMode === 'ruler') {
    const dA = dist(A.landmarks[0], A.landmarks[1]) / sA;
    const dB = dist(B.landmarks[0], B.landmarks[1]) / sB;
    stretch = { dA, dB, pct: (dB / dA - 1) * 100 };
  }

  const numbers = numberLastVisit();
  const mapped = B.moles.map((m) => C.applyTransform(T, m.cx, m.cy));
  const pairs = C.matchMoles(A.moles.map((m) => [m.cx, m.cy]), mapped, state.settings.matchMm * sA);
  const byLast = new Map(pairs.map((p) => [p.last, p.now]));
  const usedNow = new Set(pairs.map((p) => p.now));
  const g = state.settings.growthMm;
  const margin = sB;   // 1 mm inside the frame counts as in the frame

  const rows = [];
  A.moles.forEach((m, i) => {
    const label = numbers.get(m.id);
    const last = moleMm(A, m);
    const row = { key: 'a' + m.id, label, a: m, b: null, lastMm: last.d, lastArea: last.area, sort: Number(label) };
    if (byLast.has(i)) {
      const bm = B.moles[byLast.get(i)];
      const now = moleMm(B, bm);
      row.b = bm; row.nowMm = now.d; row.nowArea = now.area;
      row.change = now.d - last.d;
      row.pct = (now.d / last.d - 1) * 100;
      row.status = row.change >= g ? 'grown' : row.change <= -g ? 'shrunk' : 'same';
    } else {
      const [bx, by] = C.applyTransform(Tinv, m.cx, m.cy);
      const inside = bx >= margin && by >= margin && bx <= B.W - margin && by <= B.H - margin;
      row.status = inside ? 'gone' : 'out';
      row.posB = [bx, by];
    }
    rows.push(row);
  });

  const bandB = 12 * sB;
  const fresh = B.moles.filter((m, j) => !usedNow.has(j)).sort((m, k) =>
    (Math.floor(m.cy / bandB) - Math.floor(k.cy / bandB)) || (m.cx - k.cx));
  fresh.forEach((m, k) => {
    const now = moleMm(B, m);
    const posA = C.applyTransform(T, m.cx, m.cy);
    rows.push({ key: 'b' + m.id, label: 'N' + (k + 1), a: null, b: m, nowMm: now.d, nowArea: now.area,
      status: 'new', posA, sort: 100000 + k });
  });

  for (const r of rows) {
    const size = r.nowMm != null ? r.nowMm : r.lastMm;
    r.over = size > OVER_MM;
  }

  const stats = { last: A.moles.length, now: B.moles.length, new: 0, gone: 0, grown: 0, shrunk: 0, out: 0, same: 0 };
  for (const r of rows) stats[r.status]++;

  const labelOfB = new Map();
  const statusOfA = new Map(), statusOfB = new Map();
  for (const r of rows) {
    if (r.b) { labelOfB.set(r.b.id, r.label); statusOfB.set(r.b.id, r); }
    if (r.a) statusOfA.set(r.a.id, r);
  }
  return { rows, stats, n, residualMm, byMoles, stretch, T, Tinv, labelOfB, statusOfA, statusOfB, numbers };
}

// ---------------------------------------------------------------------
// History
// ---------------------------------------------------------------------
function pushHistory(p) {
  p.history.push({ ruler: p.ruler.map((q) => q.slice()), landmarks: p.landmarks.map((q) => q.slice()), moles: p.moles.slice(), face: p.faceLandmarks });
  if (p.history.length > 60) p.history.shift();
}
function undo() {
  const p = activePhoto();
  if (!p || !p.history.length) return;
  const h = p.history.pop();
  p.ruler = h.ruler; p.landmarks = h.landmarks; p.moles = h.moles; p.faceLandmarks = h.face;
  changed();
}

function changed() {
  state.version++;
  renderPanel();
  requestDraw();
}

// ---------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------
function activePhoto() {
  return state.tab === 'compare' ? null : state.photos[state.tab];
}
function shownPhoto() {
  return state.tab === 'compare' ? state.photos[state.cview] : state.photos[state.tab];
}

async function decode(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (e) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return await createImageBitmap(img);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

async function loadPhoto(file) {
  const p = activePhoto();
  if (!p || !file) return;
  let bmp;
  try {
    bmp = await decode(file);
  } catch (e) {
    showToast(file.name + ' could not be opened.');
    return;
  }
  Object.assign(p, {
    name: file.name, bitmap: bmp, W: bmp.width, H: bmp.height,
    ruler: [], landmarks: [], moles: [], history: [], view: null, faceLandmarks: false,
  });
  p.ws = Math.min(1, WORK_MAX / Math.max(p.W, p.H));
  p.ww = Math.round(p.W * p.ws);
  p.wh = Math.round(p.H * p.ws);
  const cv = document.createElement('canvas');
  cv.width = p.ww; cv.height = p.wh;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(bmp, 0, 0, p.ww, p.wh);
  p.v = C.brightness(cx.getImageData(0, 0, p.ww, p.wh).data, p.ww * p.wh);
  fitView(p);
  if (!state.tool) setTool(p.scaleMode === 'ruler' ? 'ruler' : 'landmark');
  changed();
  findFaceLandmarks(p, true);
}

// ---------------------------------------------------------------------
// Face landmarks
// ---------------------------------------------------------------------
let faceDetector = null, faceDetectorFail = null;

async function loadFaceDetector() {
  if (faceDetector) return faceDetector;
  if (faceDetectorFail) throw faceDetectorFail;
  try {
    const vision = await import(MP_URL);
    const files = await vision.FilesetResolver.forVisionTasks(MP_WASM);
    const opts = { baseOptions: { modelAssetPath: MP_MODEL, delegate: 'GPU' }, runningMode: 'IMAGE', numFaces: 1 };
    try {
      faceDetector = await vision.FaceLandmarker.createFromOptions(files, opts);
    } catch (e) {
      opts.baseOptions.delegate = 'CPU';
      faceDetector = await vision.FaceLandmarker.createFromOptions(files, opts);
    }
    return faceDetector;
  } catch (e) {
    faceDetectorFail = e;
    throw e;
  }
}

// Median position of each face point over the framings, in photo pixels,
// or null when fewer than 3 framings find a face.
function readFace(det, p) {
  const k = Math.min(1, FACE_DETECT_MAX / Math.max(p.W, p.H));
  const w = Math.round(p.W * k), h = Math.round(p.H * k);
  const runs = [];
  for (const [l, t, r, b] of FACE_FRAMINGS) {
    const ox = Math.round(l * w), oy = Math.round(t * h);
    const cw = Math.round(w + ox + r * w), ch = Math.round(h + oy + b * h);
    const cv = document.createElement('canvas');
    cv.width = cw; cv.height = ch;
    const g = cv.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, cw, ch);
    g.drawImage(p.bitmap, ox, oy, w, h);
    let lms = null;
    try { lms = det.detect(cv)?.faceLandmarks?.[0]; } catch (e) { lms = null; }
    if (lms && lms.length >= 468) {
      runs.push(FACE_POINTS.map(([i]) => [(lms[i].x * cw - ox) / k, (lms[i].y * ch - oy) / k]));
    }
  }
  if (runs.length < 3) return null;
  const median = (v) => { const q = v.slice().sort((x, y) => x - y); return q[q.length >> 1]; };
  return FACE_POINTS.map((_, j) => [median(runs.map((r) => r[j][0])), median(runs.map((r) => r[j][1]))]);
}

// Places the face landmarks. On loading a photo it runs quietly and only
// when the photo has no landmarks yet; the button replaces them.
async function findFaceLandmarks(p, quiet) {
  if (!p.bitmap || p.faceBusy) return;
  if (quiet && p.landmarks.length) return;
  const bitmap = p.bitmap;
  p.faceBusy = true;
  renderPanel();
  let pts = null;
  try {
    const det = await loadFaceDetector();
    await new Promise((r) => setTimeout(r, 0));
    if (p.bitmap !== bitmap) return;
    pts = readFace(det, p);
  } catch (e) {
    if (!quiet) showToast('Face landmarks need an internet connection the first time.');
    return;
  } finally {
    p.faceBusy = false;
    renderPanel();
  }
  if (p.bitmap !== bitmap) return;
  if (!pts) {
    if (!quiet) showToast('No face found in this photo.');
    return;
  }
  if (quiet && p.landmarks.length) return;
  pushHistory(p);
  p.landmarks = pts;
  p.faceLandmarks = true;
  changed();
  if (activePhoto() === p) showToast('Face found. Landmarks 1 to 6 are on the eye corners, between the eyes and under the nose.');
}

function toMole(p, m, manual) {
  const k = 1 / p.ws;
  return {
    id: ++moleSeq,
    cx: m.cx * k, cy: m.cy * k,
    area: m.area * k * k,
    feret: m.feret * k,
    fa: [m.feretA[0] * k, m.feretA[1] * k],
    fb: [m.feretB[0] * k, m.feretB[1] * k],
    mask: m.mask, ws: p.ws,
    manual: !!manual,
    outlines: {},
  };
}

async function findMoles() {
  const p = activePhoto();
  const s = p && pxPerMm(p);
  if (!s) return;
  dom.find.textContent = 'Finding';
  dom.find.disabled = true;
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
  try {
    const st = state.settings;
    const found = C.detect(p.v, p.ww, p.wh, { pxPerMm: s * p.ws, minMm: st.minMm, maxMm: st.maxMm, sensitivity: st.sensitivity });
    pushHistory(p);
    const manual = p.moles.filter((m) => m.manual);
    // An ink dot under a landmark is skipped as a mole.
    const onLandmark = (m) => p.landmarks.some((q) => dist(q, [m.cx, m.cy]) < Math.max(1.5 * s, m.feret / 2));
    const auto = found.map((m) => toMole(p, m, false))
      .filter((m) => !onLandmark(m))
      .filter((m) => !manual.some((q) => dist([q.cx, q.cy], [m.cx, m.cy]) < Math.max(q.feret, m.feret) / 2));
    p.moles = manual.concat(auto);
  } finally {
    dom.find.textContent = 'Find moles';
    dom.find.disabled = false;
  }
  if (state.tool === 'ruler' || state.tool === 'landmark') setTool(null);
  changed();
}

// ---------------------------------------------------------------------
// Viewer
// ---------------------------------------------------------------------
const viewer = { canvas: null, ctx: null, w: 0, h: 0, dpr: 1, queued: false };

function fitView(p) {
  const w = viewer.w || 800, h = viewer.h || 600;
  const s = Math.min(w / p.W, h / p.H) * 0.94;
  p.view = { s, tx: (w - p.W * s) / 2, ty: (h - p.H * s) / 2 };
}
function toImage(p, x, y) { return [(x - p.view.tx) / p.view.s, (y - p.view.ty) / p.view.s]; }
function toScreen(p, x, y) { return [x * p.view.s + p.view.tx, y * p.view.s + p.view.ty]; }

function zoomAt(p, x, y, factor) {
  const v = p.view;
  const fitS = Math.min(viewer.w / p.W, viewer.h / p.H) * 0.5;
  const ns = Math.min(Math.max(v.s * factor, fitS), 40);
  const f = ns / v.s;
  v.tx = x - (x - v.tx) * f;
  v.ty = y - (y - v.ty) * f;
  v.s = ns;
}

// Shows a spot about 20 mm across in the middle of the view.
function focusOn(p, x, y) {
  const s = pxPerMm(p) || 8;
  const ns = Math.min(viewer.w, viewer.h) / (20 * s);
  p.view = { s: ns, tx: viewer.w / 2 - x * ns, ty: viewer.h / 2 - y * ns };
  requestDraw();
}

function requestDraw() {
  if (viewer.queued) return;
  viewer.queued = true;
  requestAnimationFrame(() => { viewer.queued = false; draw(); });
}

function resizeCanvas() {
  const r = viewer.canvas.getBoundingClientRect();
  viewer.dpr = window.devicePixelRatio || 1;
  const first = !viewer.w;
  viewer.w = r.width; viewer.h = r.height;
  viewer.canvas.width = Math.round(r.width * viewer.dpr);
  viewer.canvas.height = Math.round(r.height * viewer.dpr);
  for (const p of [A, B]) if (p.bitmap && (first || !p.view)) fitView(p);
  requestDraw();
}

// Edge pixels of a mole's mask, drawn once per colour and cached.
function outlineFor(m, color) {
  if (m.outlines[color]) return m.outlines[color];
  const { w, h, data } = m.mask;
  const cv = document.createElement('canvas');
  cv.width = w + 2; cv.height = h + 2;
  const cx = cv.getContext('2d');
  const img = cx.createImageData(w + 2, h + 2);
  const r = parseInt(color.slice(1, 3), 16), g = parseInt(color.slice(3, 5), 16), b = parseInt(color.slice(5, 7), 16);
  const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h) ? data[y * w + x] : 0;
  for (let y = -1; y <= h; y++) {
    for (let x = -1; x <= w; x++) {
      if (at(x, y)) continue;
      if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) {
        const k = ((y + 1) * (w + 2) + (x + 1)) * 4;
        img.data[k] = r; img.data[k + 1] = g; img.data[k + 2] = b; img.data[k + 3] = 255;
      }
    }
  }
  cx.putImageData(img, 0, 0);
  m.outlines[color] = cv;
  return cv;
}

// Draws marks onto ctx. `k` maps image pixels to ctx pixels, `o` is the offset.
function drawMarks(ctx, p, k, ox, oy, opts) {
  const res = compare();
  const ready = !res.missing;
  const showCompare = ready && (state.tab === 'compare' || opts.forExport);
  const numbers = p === A ? numberLastVisit() : null;
  const font = opts.font || 12;
  const lw = opts.lineWidth || 1.5;
  const S = (x, y) => [x * k + ox, y * k + oy];

  const label = (text, x, y, color) => {
    ctx.font = '600 ' + font + 'px "IBM Plex Sans", system-ui, sans-serif';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(3, font / 3.5);
    ctx.strokeStyle = 'rgba(16,28,43,.9)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  };
  const ring = (x, y, r, color, dashed, width) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.setLineDash(dashed ? [4 * lw, 3 * lw] : []);
    ctx.lineWidth = (width || lw) + 2 * lw;
    ctx.strokeStyle = 'rgba(16,28,43,.75)';
    ctx.stroke();
    ctx.lineWidth = width || lw;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.setLineDash([]);
  };

  // Moles
  for (const m of p.moles) {
    let color = COLORS.mark, text = '';
    if (p === A) text = numbers.get(m.id) || '';
    if (ready) {
      const row = p === A ? res.statusOfA.get(m.id) : res.statusOfB.get(m.id);
      if (row) {
        text = row.label;
        if (showCompare) color = COLORS[row.status];
      }
    }
    const [x, y] = S(m.cx, m.cy);
    const rad = m.feret / 2 * k;
    const selected = state.selected && (state.selected === m.id ||
      (ready && ((p === A ? res.statusOfA.get(m.id) : res.statusOfB.get(m.id)) || {}).key === state.selected));
    const f = k / m.ws;   // screen pixels per working pixel
    if (rad >= 7 && f >= 2) {
      const ol = outlineFor(m, color);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(ol, (m.mask.x0 - 1) * f + ox, (m.mask.y0 - 1) * f + oy, ol.width * f, ol.height * f);
      ctx.imageSmoothingEnabled = true;
      if (selected) ring(x, y, rad + 5 * lw, COLORS.selected, false, 2 * lw);
    } else {
      ring(x, y, Math.max(rad + 3 * lw, 5 * lw), color, false, selected ? 2.5 * lw : lw);
    }
    if (text) label(text, x + Math.max(rad, 4 * lw) + 3 * lw, y - Math.max(rad, 4 * lw), color);
  }

  // Gone and new moles drawn where they would be on the other photo
  if (showCompare) {
    for (const r of res.rows) {
      let pos = null;
      if (p === B && (r.status === 'gone')) pos = r.posB;
      if (p === A && r.status === 'new') pos = r.posA;
      if (!pos) continue;
      const [x, y] = S(pos[0], pos[1]);
      const other = p === B ? r.a : r.b;
      const sOther = pxPerMm(p === B ? A : B), sHere = pxPerMm(p);
      const rad = Math.max(other.feret / 2 / sOther * sHere * k + 3 * lw, 6 * lw);
      ring(x, y, rad, COLORS[r.status], true, state.selected === r.key ? 2.5 * lw : lw);
      label(r.label, x + rad + 3 * lw, y - rad, COLORS[r.status]);
    }
  }

  // Ruler
  if (p.ruler.length && !opts.forExport && state.tab !== 'compare') {
    const pts = p.ruler.map((q) => S(q[0], q[1]));
    if (pts.length === 2) {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]); ctx.lineTo(pts[1][0], pts[1][1]);
      ctx.lineWidth = 3 * lw; ctx.strokeStyle = 'rgba(16,28,43,.75)'; ctx.stroke();
      ctx.lineWidth = lw; ctx.strokeStyle = COLORS.ruler; ctx.stroke();
      const mx = (pts[0][0] + pts[1][0]) / 2, my = (pts[0][1] + pts[1][1]) / 2;
      label(fmt(p.rulerMm, p.rulerMm % 1 ? 1 : 0) + ' mm', mx + 8, my - 8, COLORS.ruler);
    }
    for (const q of pts) {
      ring(q[0], q[1], 7 * lw, COLORS.ruler);
      ctx.beginPath(); ctx.arc(q[0], q[1], 1.5 * lw, 0, Math.PI * 2); ctx.fillStyle = COLORS.ruler; ctx.fill();
    }
  }

  // Landmarks
  p.landmarks.forEach((q, i) => {
    const [x, y] = S(q[0], q[1]);
    ring(x, y, 9 * lw, COLORS.landmark, false, 1.5 * lw);
    ctx.beginPath();
    ctx.moveTo(x - 14 * lw, y); ctx.lineTo(x - 4 * lw, y);
    ctx.moveTo(x + 4 * lw, y); ctx.lineTo(x + 14 * lw, y);
    ctx.moveTo(x, y - 14 * lw); ctx.lineTo(x, y - 4 * lw);
    ctx.moveTo(x, y + 4 * lw); ctx.lineTo(x, y + 14 * lw);
    ctx.lineWidth = 1.5 * lw; ctx.strokeStyle = COLORS.landmark; ctx.stroke();
    label('L' + (i + 1), x + 12 * lw, y + 22 * lw, COLORS.landmark);
  });
}

function draw() {
  const ctx = viewer.ctx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, viewer.canvas.width, viewer.canvas.height);
  const p = shownPhoto();
  updateEmpty(p);
  if (!p || !p.bitmap) return;
  if (!p.view) fitView(p);
  const d = viewer.dpr;
  ctx.setTransform(d, 0, 0, d, 0, 0);
  const v = p.view;
  ctx.imageSmoothingEnabled = v.s < 2;
  ctx.drawImage(p.bitmap, v.tx, v.ty, p.W * v.s, p.H * v.s);
  ctx.imageSmoothingEnabled = true;
  drawMarks(ctx, p, v.s, v.tx, v.ty, {});
}

function updateEmpty(p) {
  const show = !p || !p.bitmap;
  dom.empty.hidden = !show;
  if (!show) return;
  const inCompare = state.tab === 'compare';
  dom.emptyPick.hidden = inCompare;
  dom.emptyNote.textContent = inCompare
    ? 'No photo for ' + (state.cview === 'a' ? 'the last visit' : 'this visit') + ' yet.'
    : 'Choose a photo or take one with the camera.';
}

// ---------------------------------------------------------------------
// Pointer input: drag pans, pinch and wheel zoom, a tap uses the tool.
// Dragging a ruler mark or landmark moves it.
// ---------------------------------------------------------------------
const pointers = new Map();
let gesture = null;

function localXY(e) {
  const r = viewer.canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

function handleAt(p, x, y) {
  const lists = [];
  if (state.tool === 'ruler') lists.push(['ruler', p.ruler]);
  if (state.tool === 'landmark') lists.push(['landmarks', p.landmarks]);
  let best = null, bd = HANDLE_HIT_PX;
  for (const [name, list] of lists) {
    list.forEach((q, i) => {
      const [sx, sy] = toScreen(p, q[0], q[1]);
      const d = Math.hypot(sx - x, sy - y);
      if (d < bd) { bd = d; best = { list: name, index: i }; }
    });
  }
  return best;
}

function onPointerDown(e) {
  const p = shownPhoto();
  if (!p || !p.bitmap) return;
  viewer.canvas.setPointerCapture(e.pointerId);
  const [x, y] = localXY(e);
  pointers.set(e.pointerId, [x, y]);
  if (pointers.size === 1) {
    gesture = { type: 'pending', sx: x, sy: y, lx: x, ly: y, handle: state.tab !== 'compare' ? handleAt(p, x, y) : null };
  } else if (pointers.size === 2) {
    const [p1, p2] = [...pointers.values()];
    gesture = { type: 'pinch', d0: dist(p1, p2), c0: [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2], v0: Object.assign({}, p.view) };
  } else {
    gesture = { type: 'none' };
  }
}

function onPointerMove(e) {
  if (!pointers.has(e.pointerId)) return;
  const p = shownPhoto();
  const [x, y] = localXY(e);
  pointers.set(e.pointerId, [x, y]);
  if (!gesture) return;
  if (gesture.type === 'pinch' && pointers.size === 2) {
    const [p1, p2] = [...pointers.values()];
    const d = dist(p1, p2), c = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
    const v0 = gesture.v0;
    const fitS = Math.min(viewer.w / p.W, viewer.h / p.H) * 0.5;
    const ns = Math.min(Math.max(v0.s * d / gesture.d0, fitS), 40);
    const ix = (gesture.c0[0] - v0.tx) / v0.s, iy = (gesture.c0[1] - v0.ty) / v0.s;
    p.view = { s: ns, tx: c[0] - ix * ns, ty: c[1] - iy * ns };
    requestDraw();
    return;
  }
  if (gesture.type === 'pending' && Math.hypot(x - gesture.sx, y - gesture.sy) > 6) {
    if (gesture.handle) { pushHistory(p); gesture.type = 'handle'; }
    else gesture.type = 'pan';
  }
  if (gesture.type === 'pan') {
    p.view.tx += x - gesture.lx;
    p.view.ty += y - gesture.ly;
    requestDraw();
  } else if (gesture.type === 'handle') {
    const q = toImage(p, x, y);
    q[0] = Math.min(Math.max(q[0], 0), p.W);
    q[1] = Math.min(Math.max(q[1], 0), p.H);
    p[gesture.handle.list][gesture.handle.index] = q;
    state.version++;
    renderPanel();
    requestDraw();
  }
  gesture.lx = x; gesture.ly = y;
}

function onPointerUp(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (gesture && gesture.type === 'pending' && pointers.size === 0 && e.type === 'pointerup') {
    onTap(gesture.sx, gesture.sy);
  }
  if (gesture && gesture.type === 'handle') changed();
  if (pointers.size === 0) gesture = null;
  else if (gesture && gesture.type === 'pinch') gesture = { type: 'none' };
}

function onWheel(e) {
  const p = shownPhoto();
  if (!p || !p.bitmap) return;
  e.preventDefault();
  const [x, y] = localXY(e);
  zoomAt(p, x, y, Math.exp(-e.deltaY * 0.0015));
  requestDraw();
}

function moleAt(p, x, y) {
  let best = null, bd = Infinity;
  for (const m of p.moles) {
    const [sx, sy] = toScreen(p, m.cx, m.cy);
    const r = Math.max(m.feret / 2 * p.view.s, MOLE_HIT_PX);
    const d = Math.hypot(sx - x, sy - y);
    if (d <= r && d < bd) { bd = d; best = m; }
  }
  return best;
}

function onTap(x, y) {
  const p = shownPhoto();
  const [ix, iy] = toImage(p, x, y);
  const inside = ix >= 0 && iy >= 0 && ix < p.W && iy < p.H;

  if (state.tab === 'compare') {
    const res = compare();
    if (!res || res.missing) return;
    const m = moleAt(p, x, y);
    let row = m ? (p === A ? res.statusOfA.get(m.id) : res.statusOfB.get(m.id)) : null;
    if (!row) {
      row = res.rows.find((r) => {
        const pos = p === B ? (r.status === 'gone' ? r.posB : null) : (r.status === 'new' ? r.posA : null);
        if (!pos) return false;
        const [sx, sy] = toScreen(p, pos[0], pos[1]);
        return Math.hypot(sx - x, sy - y) < MOLE_HIT_PX * 1.5;
      });
    }
    state.selected = row ? row.key : null;
    renderPanel();
    requestDraw();
    if (row) {
      const tr = dom.tbody.querySelector('[data-key="' + row.key + '"]');
      if (tr) tr.scrollIntoView({ block: 'nearest' });
    }
    return;
  }

  if (state.tool === 'ruler') {
    if (!inside) return;
    pushHistory(p);
    if (p.ruler.length < 2) p.ruler.push([ix, iy]);
    else {
      const i = dist(p.ruler[0], [ix, iy]) <= dist(p.ruler[1], [ix, iy]) ? 0 : 1;
      p.ruler[i] = [ix, iy];
    }
    changed();
    return;
  }

  if (state.tool === 'landmark') {
    if (!inside) return;
    if (p.landmarks.length >= MAX_LANDMARKS) { showToast(MAX_LANDMARKS + ' landmarks is the limit.'); return; }
    pushHistory(p);
    p.landmarks.push([ix, iy]);
    p.faceLandmarks = false;
    changed();
    return;
  }

  if (state.tool === 'add') {
    if (!inside) return;
    const s = pxPerMm(p);
    if (!s) { showToast('Set the scale first.'); return; }
    const hit = moleAt(p, x, y);
    if (hit) { showToast('That mole is already marked.'); return; }
    const m = C.segmentAt(p.v, p.ww, p.wh, ix * p.ws, iy * p.ws, { pxPerMm: s * p.ws, maxMm: state.settings.maxMm });
    if (!m) { showToast('No mole edge found there. Zoom in and tap its centre.'); return; }
    pushHistory(p);
    const mole = toMole(p, m, true);
    p.moles.push(mole);
    state.selected = mole.id;
    changed();
    return;
  }

  if (state.tool === 'remove') {
    const hit = moleAt(p, x, y);
    if (!hit) return;
    pushHistory(p);
    p.moles = p.moles.filter((m) => m !== hit);
    changed();
    return;
  }

  const hit = moleAt(p, x, y);
  state.selected = hit ? hit.id : null;
  renderPanel();
  requestDraw();
}

// ---------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------
function setTool(t) {
  state.tool = state.tool === t ? null : t;
  renderPanel();
  requestDraw();
}

function setTab(t) {
  if (state.tab !== t) dom.panel.scrollTop = 0;
  state.tab = t;
  state.selected = null;
  if (t === 'compare') state.tool = null;
  renderPanel();
  requestDraw();
}

function statusText() {
  const p = shownPhoto();
  if (state.tab === 'compare') {
    const res = compare();
    if (!res || res.missing) return '';
    if (state.selected) {
      const r = res.rows.find((q) => q.key === state.selected);
      if (r) return rowSentence(r);
    }
    return 'Green same, red grown, blue shrunk, purple new, dashed gone. Tap a mole for its numbers.';
  }
  if (!p.bitmap) return '';
  if (state.selected) {
    const m = p.moles.find((q) => q.id === state.selected);
    const mm = m && moleMm(p, m);
    if (mm) {
      const no = p === A ? numberLastVisit().get(m.id) : (compare().labelOfB || new Map()).get(m.id);
      return (no ? 'Mole ' + no : 'This mole') + ' is ' + fmt(mm.d) + ' mm across with an area of ' + fmt(mm.area) + ' mm².';
    }
  }
  switch (state.tool) {
    case 'ruler':
      return p.ruler.length < 2 ? 'Tap ruler mark ' + (p.ruler.length + 1) + '.' : 'Drag a mark to move it.';
    case 'landmark': {
      if (p.faceLandmarks) return 'Drag a landmark to move it.';
      const n = p.landmarks.length + 1;
      if (p === B && A.landmarks.length >= n) return 'Tap landmark ' + n + ' on the same spot as on the last visit photo.';
      return 'Tap landmark ' + n + '. Drag a landmark to move it.';
    }
    case 'add': return 'Tap the centre of a missed mole.';
    case 'remove': return 'Tap a mark to remove it.';
    default: return 'Drag to move. Pinch or scroll to zoom.';
  }
}

function rowSentence(r) {
  const head = r.label.startsWith('N') ? 'New mole ' + r.label : 'Mole ' + r.label;
  switch (r.status) {
    case 'new': return head + ' is ' + fmt(r.nowMm) + ' mm across.';
    case 'gone': return head + ' was ' + fmt(r.lastMm) + ' mm across and is gone from this visit.';
    case 'out': return head + ' was ' + fmt(r.lastMm) + ' mm across and sits outside this visit\'s photo.';
    default: return head + ' went from ' + fmt(r.lastMm) + ' mm to ' + fmt(r.nowMm) + ' mm (' + signed(r.change) + ' mm).';
  }
}

function renderPanel() {
  for (const b of document.querySelectorAll('[data-tab]')) b.classList.toggle('is-active', b.dataset.tab === state.tab);
  const inCompare = state.tab === 'compare';
  dom.panelPhoto.hidden = inCompare;
  dom.panelCompare.hidden = !inCompare;
  dom.toolsRow.hidden = inCompare;
  dom.undo.hidden = inCompare;
  if (inCompare) renderCompare(); else renderPhotoPanel();
  for (const b of document.querySelectorAll('[data-tool]')) b.classList.toggle('is-active', b.dataset.tool === state.tool);
  const sp = shownPhoto();
  dom.toolbar.hidden = !sp || !sp.bitmap;
  dom.status.textContent = statusText();
  dom.status.hidden = !dom.status.textContent;
}

function renderPhotoPanel() {
  const p = activePhoto();
  const st = state.settings;
  dom.photoTitle.textContent = p === A ? 'Last visit' : 'This visit';
  dom.pick.textContent = p.bitmap ? 'Choose another photo' : 'Choose photo';
  dom.photoMeta.textContent = p.bitmap ? p.name + ', ' + p.W + ' × ' + p.H : '';

  for (const b of dom.scaleSeg.querySelectorAll('button')) b.classList.toggle('is-active', b.dataset.scale === p.scaleMode);
  dom.scaleRuler.hidden = p.scaleMode !== 'ruler';
  dom.scaleLandmarks.hidden = p.scaleMode !== 'landmarks';
  setInput(dom.rulerMm, p.rulerMm);
  setInput(dom.lmMm, p.lmMm > 0 ? p.lmMm : '');
  const fromLast = p === B ? lastVisitLandmarkMm() : null;
  dom.lmMm.placeholder = fromLast ? fmt(fromLast) : '';
  dom.lmMmFrom.hidden = !(p === B && fromLast);
  dom.lmMmFrom.textContent = fromLast ? 'From the last visit: ' + fmt(fromLast) + ' mm. Type a value to use your own.' : '';

  const s = pxPerMm(p);
  if (!p.bitmap) dom.scaleResult.textContent = '';
  else if (s) dom.scaleResult.textContent = 'Scale: ' + fmt(s) + ' pixels per mm.';
  else if (p.scaleMode === 'ruler') dom.scaleResult.textContent = p.ruler.length < 2 ? 'Tap ' + (2 - p.ruler.length) + ' more ruler mark' + (p.ruler.length === 1 ? '' : 's') + '.' : 'Type the distance between the marks.';
  else dom.scaleResult.textContent = p.landmarks.length < 2 ? 'Place landmarks 1 and 2.' : 'Type the distance between landmarks 1 and 2.';

  const n = p.landmarks.length;
  dom.lmCount.textContent = !p.bitmap ? '' : p.faceBusy ? 'Looking for a face.' :
    n === 0 ? 'No landmarks yet.' : n === 1 ? '1 landmark.' :
    n + (p.faceLandmarks && n === FACE_POINTS.length ? ' landmarks from the face.' : ' landmarks.');
  dom.faceFind.disabled = !p.bitmap || p.faceBusy;
  dom.faceFind.textContent = p.faceBusy ? 'Finding' : 'Find face landmarks';
  if (p === B && A.landmarks.length && n !== A.landmarks.length && p.bitmap) {
    dom.lmCount.textContent += ' The last visit photo has ' + A.landmarks.length + '.';
  }
  dom.lmUndo.disabled = n === 0;

  setInput(dom.sens, st.sensitivity);
  dom.sensOut.textContent = String(st.sensitivity);
  setInput(dom.minMm, st.minMm);
  setInput(dom.maxMm, st.maxMm);
  dom.find.disabled = !s;
  dom.findHint.hidden = !!s || !p.bitmap;
  const auto = p.moles.filter((m) => !m.manual).length, manual = p.moles.length - auto;
  dom.moleCount.textContent = !p.moles.length ? '' :
    p.moles.length + (p.moles.length === 1 ? ' mole' : ' moles') + (manual ? ', ' + manual + ' added by hand.' : '.');
  dom.undo.disabled = !p.history.length;
}

function setInput(el, val) {
  if (document.activeElement === el) return;
  el.value = val === null || val === undefined ? '' : String(val);
}

function renderCompare() {
  const res = compare();
  const st = state.settings;
  setInput(dom.matchMm, st.matchMm);
  setInput(dom.growthMm, st.growthMm);
  for (const b of dom.cviewSeg.querySelectorAll('button')) b.classList.toggle('is-active', b.dataset.cview === state.cview);

  dom.missing.innerHTML = '';
  if (res.missing) {
    dom.compareBody.hidden = true;
    for (const m of res.missing) {
      const li = document.createElement('li');
      li.textContent = m;
      dom.missing.appendChild(li);
    }
    return;
  }
  dom.compareBody.hidden = false;
  const s = res.stats;
  const tiles = [
    ['Last visit', s.last], ['This visit', s.now], ['New', s.new], ['Gone', s.gone],
    ['Grown', s.grown], ['Shrunk', s.shrunk], ['Not in frame', s.out],
  ];
  dom.stats.innerHTML = '';
  for (const [name, val] of tiles) {
    const d = document.createElement('div');
    d.className = 'stat';
    const key = { New: 'new', Gone: 'gone', Grown: 'grown', Shrunk: 'shrunk' }[name];
    if (key && val) d.dataset.status = key;
    d.innerHTML = '<b></b><span></span>';
    d.querySelector('b').textContent = String(val);
    d.querySelector('span').textContent = name;
    dom.stats.appendChild(d);
  }

  if (res.byMoles) dom.align.textContent = 'Lined up on ' + res.byMoles.inliers + ' matching moles, within ' + fmt(res.byMoles.rmsMm) + ' mm.';
  else if (res.residualMm == null) dom.align.textContent = 'Add a third landmark on both photos to check the alignment.';
  else if (res.residualMm > st.matchMm / 2) dom.align.textContent = 'Landmarks are off by ' + fmt(res.residualMm) + ' mm. Check they were tapped in the same order on both photos.';
  else dom.align.textContent = 'Landmarks agree within ' + fmt(res.residualMm) + ' mm.';
  dom.align.classList.toggle('warn', res.residualMm != null && res.residualMm > st.matchMm / 2);

  dom.stretch.hidden = !res.stretch;
  if (res.stretch) {
    const t = res.stretch;
    dom.stretch.textContent = 'Landmarks 1 and 2 are ' + fmt(t.dB) + ' mm apart now and were ' + fmt(t.dA) + ' mm apart last visit (' + signed(t.pct) + '%).';
  }

  const rows = res.rows.slice().sort((a, b) => a.sort - b.sort);
  dom.tbody.innerHTML = '';
  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.dataset.key = r.key;
    tr.dataset.status = r.status;
    if (state.selected === r.key) tr.classList.add('is-selected');
    const cells = [
      r.label,
      STATUS_WORD[r.status],
      r.lastMm != null ? fmt(r.lastMm) : '',
      r.nowMm != null ? fmt(r.nowMm) : '',
      r.change != null ? signed(r.change) + ' (' + signed(r.pct, 0) + '%)' : '',
    ];
    cells.forEach((c, i) => {
      const td = document.createElement('td');
      td.textContent = c;
      if (i === 1) {
        td.className = 'st';
        if (r.over) {
          const tag = document.createElement('small');
          tag.textContent = 'Over 6 mm';
          td.appendChild(tag);
        }
      }
      tr.appendChild(td);
    });
    tr.addEventListener('click', () => selectRow(r));
    dom.tbody.appendChild(tr);
  }
}

function selectRow(r) {
  state.selected = r.key;
  let p = state.photos[state.cview];
  let pos = null;
  if (p === B) pos = r.b ? [r.b.cx, r.b.cy] : r.status === 'gone' ? r.posB : null;
  else pos = r.a ? [r.a.cx, r.a.cy] : r.posA;
  if (!pos) { state.cview = 'a'; p = A; pos = [r.a.cx, r.a.cy]; }
  focusOn(p, pos[0], pos[1]);
  renderPanel();
}

// ---------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------
function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes());
}

function isIOSDevice() {
  if (/iPhone|iPad|iPod/.test(navigator.userAgent)) return true;
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function saveFiles(files) {
  if (isIOSDevice() && navigator.canShare && navigator.canShare({ files })) {
    try {
      await navigator.share({ files });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
  }
  files.forEach(downloadFile);
  showToast(files.length > 1 ? 'Saved to your downloads.' : 'Saved ' + files[0].name + ' to your downloads.');
}

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function exportCsv() {
  const res = compare();
  if (!res || res.missing) return;
  const head = ['Mole', 'Status', 'Last visit diameter (mm)', 'This visit diameter (mm)', 'Change (mm)', 'Change (%)',
    'Last visit area (mm2)', 'This visit area (mm2)', 'Over 6 mm'];
  const lines = [head.join(',')];
  for (const r of res.rows.slice().sort((a, b) => a.sort - b.sort)) {
    lines.push([
      r.label, STATUS_WORD[r.status],
      r.lastMm != null ? fmt(r.lastMm, 2) : '', r.nowMm != null ? fmt(r.nowMm, 2) : '',
      r.change != null ? fmt(r.change, 2) : '', r.pct != null ? fmt(r.pct, 1) : '',
      r.lastArea != null ? fmt(r.lastArea, 2) : '', r.nowArea != null ? fmt(r.nowArea, 2) : '',
      r.over ? 'Yes' : '',
    ].map(csvCell).join(','));
  }
  const file = new File([lines.join('\r\n') + '\r\n'], 'mole-counter-' + stamp() + '.csv', { type: 'text/csv' });
  saveFiles([file]);
}

async function renderMarked(p) {
  const k = Math.min(1, 4000 / Math.max(p.W, p.H));
  const cv = document.createElement('canvas');
  cv.width = Math.round(p.W * k); cv.height = Math.round(p.H * k);
  const ctx = cv.getContext('2d');
  ctx.drawImage(p.bitmap, 0, 0, cv.width, cv.height);
  const unit = Math.max(1, cv.width / 1400);
  drawMarks(ctx, p, k, 0, 0, { forExport: true, font: Math.round(14 * unit), lineWidth: 1.5 * unit });
  const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.92));
  return blob;
}

async function savePhotos() {
  const res = compare();
  if (!res || res.missing) return;
  dom.savePhotos.textContent = 'Saving';
  dom.savePhotos.disabled = true;
  try {
    const t = stamp();
    const files = [];
    files.push(new File([await renderMarked(A)], 'mole-counter-last-visit-' + t + '.jpg', { type: 'image/jpeg' }));
    files.push(new File([await renderMarked(B)], 'mole-counter-this-visit-' + t + '.jpg', { type: 'image/jpeg' }));
    await saveFiles(files);
  } finally {
    dom.savePhotos.textContent = 'Save marked photos';
    dom.savePhotos.disabled = false;
  }
}

// ---------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------
let toastTimer = null;
function showToast(msg) {
  dom.toast.textContent = msg;
  dom.toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dom.toast.classList.remove('is-visible'), 3200);
}

// ---------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------
function numberInput(el, fn) {
  el.addEventListener('input', () => {
    const v = parseFloat(el.value);
    fn(Number.isFinite(v) ? v : null);
  });
  el.addEventListener('change', () => renderPanel());
}

function wire() {
  const ids = ['view', 'empty', 'empty-pick', 'empty-note', 'toolbar', 'tools', 'undo', 'fit', 'status',
    'panel-photo', 'panel-compare', 'photo-title', 'pick', 'photo-meta', 'scale-seg', 'scale-ruler',
    'scale-landmarks', 'ruler-mm', 'lm-mm', 'lm-mm-from', 'scale-result', 'lm-count', 'lm-undo', 'face-find', 'sens',
    'sens-out', 'min-mm', 'max-mm', 'find', 'find-hint', 'mole-count', 'missing', 'compare-body', 'stats',
    'align', 'stretch', 'panel', 'match-mm', 'growth-mm', 'cview-seg', 'table', 'csv', 'save-photos', 'file', 'toast'];
  for (const id of ids) dom[id.replace(/-(\w)/g, (m, c) => c.toUpperCase())] = $(id);
  dom.toolsRow = dom.tools;
  dom.tbody = dom.table.querySelector('tbody');

  viewer.canvas = dom.view;
  viewer.ctx = dom.view.getContext('2d');
  dom.view.addEventListener('pointerdown', onPointerDown);
  dom.view.addEventListener('pointermove', onPointerMove);
  dom.view.addEventListener('pointerup', onPointerUp);
  dom.view.addEventListener('pointercancel', onPointerUp);
  dom.view.addEventListener('wheel', onWheel, { passive: false });
  new ResizeObserver(resizeCanvas).observe(dom.view);

  for (const b of document.querySelectorAll('[data-tab]')) b.addEventListener('click', () => setTab(b.dataset.tab));
  for (const b of document.querySelectorAll('[data-tool]')) b.addEventListener('click', () => setTool(b.dataset.tool));
  dom.undo.addEventListener('click', undo);
  dom.fit.addEventListener('click', () => { const p = shownPhoto(); if (p && p.bitmap) { fitView(p); requestDraw(); } });

  const pick = () => { dom.file.value = ''; dom.file.click(); };
  dom.pick.addEventListener('click', pick);
  dom.emptyPick.addEventListener('click', pick);
  dom.file.addEventListener('change', () => loadPhoto(dom.file.files[0]));

  for (const b of dom.scaleSeg.querySelectorAll('button')) {
    b.addEventListener('click', () => {
      const p = activePhoto();
      p.scaleMode = b.dataset.scale;
      if (p.bitmap && (state.tool === 'ruler' || state.tool === 'landmark' || !state.tool)) {
        state.tool = p.scaleMode === 'ruler' ? 'ruler' : 'landmark';
      }
      changed();
    });
  }
  numberInput(dom.rulerMm, (v) => { activePhoto().rulerMm = v; state.version++; renderPanel(); requestDraw(); });
  numberInput(dom.lmMm, (v) => { activePhoto().lmMm = v > 0 ? v : null; state.version++; renderPanel(); requestDraw(); });
  dom.faceFind.addEventListener('click', () => findFaceLandmarks(activePhoto(), false));
  dom.lmUndo.addEventListener('click', () => {
    const p = activePhoto();
    if (!p.landmarks.length) return;
    pushHistory(p);
    p.landmarks.pop();
    changed();
  });

  dom.sens.addEventListener('input', () => { state.settings.sensitivity = Number(dom.sens.value); saveSettings(); renderPanel(); });
  numberInput(dom.minMm, (v) => { if (v > 0) { state.settings.minMm = v; saveSettings(); } });
  numberInput(dom.maxMm, (v) => { if (v > 0) { state.settings.maxMm = v; saveSettings(); } });
  dom.find.addEventListener('click', findMoles);

  numberInput(dom.matchMm, (v) => { if (v > 0) { state.settings.matchMm = v; saveSettings(); state.version++; renderPanel(); requestDraw(); } });
  numberInput(dom.growthMm, (v) => { if (v > 0) { state.settings.growthMm = v; saveSettings(); state.version++; renderPanel(); requestDraw(); } });
  for (const b of dom.cviewSeg.querySelectorAll('button')) {
    b.addEventListener('click', () => { state.cview = b.dataset.cview; renderPanel(); requestDraw(); });
  }
  dom.csv.addEventListener('click', exportCsv);
  dom.savePhotos.addEventListener('click', savePhotos);

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !/INPUT/.test(document.activeElement.tagName)) {
      e.preventDefault();
      undo();
    }
  });
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline install is optional */ });
  }
}

function init() {
  loadSettings();
  wire();
  renderPanel();
  registerServiceWorker();
}

init();
