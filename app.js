// Mole Counter, Cygnus Solutions
// Two photos of one body segment: the last visit and this visit. Each gets
// a scale, landmarks and its marked moles. Compare lines this visit up on
// the last one through the landmarks and pairs the moles.
'use strict';

const C = window.MoleCore;
const WORK_MAX = 3000;          // longest side of the copy the detector reads
const LS_KEY = 'molecounter.settings.v2';
const MAX_LANDMARKS = 12;
const HANDLE_HIT_PX = 24;       // screen pixels around a ruler mark or landmark that grab it
const MOLE_HIT_PX = 16;
const OVER_MM = 6;              // the D in ABCDE
// A spot on one photo only that is less than 18% darker than the skin is
// listed as Faint rather than New or Gone. On two photos taken the same
// day, every unpaired spot under this was a fold, pore or hair edge.
const FAINT_CONTRAST = 0.18;

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
// Person finder for photos without a face: its classes 2 and 3 are body
// skin and face skin.
const SEG_MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite';
// Face map outline and the parts inside it that are never moles, each
// grown about its centre to take in lashes, brow hairs and lip edges.
const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377,
  152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
const FACE_HOLES = [
  [[33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246], 1.45],          // right eye
  [[263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466], 1.45],       // left eye
  [[46, 53, 52, 65, 55, 107, 66, 105, 63, 70], 1.3],                                                // right brow
  [[276, 283, 282, 295, 285, 336, 296, 334, 293, 300], 1.3],                                        // left brow
  [[61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185], 1.05], // lips
  [[48, 64, 98, 97, 2, 326, 327, 294, 278], 1.0],                                                   // nostrils
];
// Visible iris width in adults, the usual stand-in for a ruler on a face.
const IRIS_MM = 11.7;
// Without a face or a ruler the longer side of the photo is taken as this
// many mm, about a forearm at arm's length.
const ROUGH_MM = 300;
const AREA_MAX = 800;   // longest side of the area mask
const BRUSH_PX = 22;    // area brush radius on screen

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
  faint: '#AEB7C4',
  selected: '#FFFFFF',
};

const STATUS_WORD = {
  same: 'Same', grown: 'Grown', shrunk: 'Shrunk', new: 'New', gone: 'Gone', out: 'Not in frame', faint: 'Faint',
};

function newPhoto(key) {
  return {
    key,
    name: '', bitmap: null, W: 0, H: 0,
    ws: 1, ww: 0, wh: 0, v: null,
    scaleMode: 'estimate', ruler: [], rulerMm: 10,
    landmarks: [], lmMm: null, faceLandmarks: false, faceBusy: false,
    faceMesh: null, irisPx: null,
    area: null, areaSource: '', areaEdited: false, areaOverlay: null, areaRgba: null, areaDims: null,
    moles: [], history: [], view: null, viewTouched: false,
  };
}

const state = {
  tab: 'a',
  tool: null,
  cview: 'b',
  selected: null,       // compare row key, or a mole id on a photo tab
  brush: 'add',         // area brush: add or erase
  version: 0,
  settings: { sensitivity: 7, minMm: 0.7, maxMm: 15, matchMm: 3, growthMm: 1 },
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
  if (!p.bitmap) return null;
  if (p.scaleMode === 'estimate') {
    if (p.irisPx) return p.irisPx / IRIS_MM;
    return Math.max(p.W, p.H) / ROUGH_MM;
  }
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

// Maps this visit's pixels onto the last visit's: through the landmarks
// when both photos have the same number, otherwise through the moles.
function alignVisits() {
  const sA = pxPerMm(A), sB = pxPerMm(B);
  if (!sA || !sB) return { error: 'Set the scale on both photos.' };
  if (A.landmarks.length >= 2 && B.landmarks.length >= 2 && A.landmarks.length === B.landmarks.length) {
    const n = A.landmarks.length;
    const T = C.fitTransform(B.landmarks, A.landmarks);
    if (!T || !C.invertTransform(T)) return { error: 'Landmarks 1 and 2 sit on the same spot. Move one of them.' };
    let residualMm = null;
    if (n >= 3) {
      let ss = 0;
      for (let i = 0; i < n; i++) ss += dist(C.applyTransform(T, B.landmarks[i][0], B.landmarks[i][1]), A.landmarks[i]) ** 2;
      residualMm = Math.sqrt(ss / n) / sA;
    }
    return { T, n, residualMm, byMoles: null };
  }
  const res = C.alignByMoles(A.moles.map((m) => [m.cx, m.cy]), B.moles.map((m) => [m.cx, m.cy]),
    sA / sB, state.settings.matchMm * sA, { scaleSlack: scaleSlack() });
  if (!res) return { error: 'The moles on the two photos could not be lined up. Place at least 2 landmarks on both photos in the same order.' };
  return { T: res.T, n: 0, residualMm: null, byMoles: { inliers: res.inliers, rmsMm: res.rms / sA } };
}

// Point maps between the two photos. With a face map on both, each point
// is carried by an affine fit to the 12 nearest face-map points, which
// follows a turned head or a smile far better than one fit for the whole
// face. Otherwise the alignment from alignVisits is used everywhere.
const MESH_NEAR = 12;
function localMap(fromMesh, toMesh) {
  const n = Math.min(468, fromMesh.length, toMesh.length);
  return (x, y) => {
    const near = [];
    for (let i = 0; i < n; i++) {
      const d = (fromMesh[i][0] - x) ** 2 + (fromMesh[i][1] - y) ** 2;
      if (near.length < MESH_NEAR) { near.push([d, i]); near.sort((a, b) => a[0] - b[0]); }
      else if (d < near[MESH_NEAR - 1][0]) { near[MESH_NEAR - 1] = [d, i]; near.sort((a, b) => a[0] - b[0]); }
    }
    const T = C.fitTransform(near.map(([, i]) => fromMesh[i]), near.map(([, i]) => toMesh[i]));
    return C.applyTransform(T, x, y);
  };
}
function visitMaps(al) {
  if (A.faceMesh && B.faceMesh && A.faceMesh.length >= 468 && B.faceMesh.length >= 468) {
    return { toA: localMap(B.faceMesh, A.faceMesh), toB: localMap(A.faceMesh, B.faceMesh) };
  }
  const Tinv = C.invertTransform(al.T);
  return { toA: (x, y) => C.applyTransform(al.T, x, y), toB: (x, y) => C.applyTransform(Tinv, x, y) };
}

// How far apart the two photo scales may be when lining up on moles. A
// rough estimate can be far off, an iris estimate a little.
function scaleSlack() {
  const kind = (p) => p.scaleMode !== 'estimate' ? 0.12 : p.irisPx ? 0.25 : 0.6;
  return Math.max(kind(A), kind(B));
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

  const sA = pxPerMm(A);
  let sB = pxPerMm(B);
  const al = alignVisits();
  if (al.error) return { missing: [al.error] };
  const { T, residualMm, n, byMoles } = al;
  const Tinv = C.invertTransform(T);
  const maps = visitMaps(al);

  // An estimated scale on this visit is replaced by the last visit's scale
  // carried across the alignment, since that holds both visits to one ruler.
  const bFromLast = B.scaleMode === 'estimate';
  if (bFromLast) sB = sA / Math.sqrt(Math.abs(T[0] * T[4] - T[1] * T[3]));
  const mmA = (m) => ({ d: m.feret / sA, area: m.area / (sA * sA) });
  const mmB = (m) => ({ d: m.feret / sB, area: m.area / (sB * sB) });

  let stretch = null;
  if (useLandmarks && A.scaleMode === 'ruler' && B.scaleMode === 'ruler') {
    const dA = dist(A.landmarks[0], A.landmarks[1]) / sA;
    const dB = dist(B.landmarks[0], B.landmarks[1]) / sB;
    stretch = { dA, dB, pct: (dB / dA - 1) * 100 };
  }

  const numbers = numberLastVisit();
  const mapped = B.moles.map((m) => maps.toA(m.cx, m.cy));
  const pairs = C.matchMoles(A.moles.map((m) => [m.cx, m.cy]), mapped, state.settings.matchMm * sA);
  const byLast = new Map(pairs.map((p) => [p.last, p.now]));
  const usedNow = new Set(pairs.map((p) => p.now));
  const g = state.settings.growthMm;
  const margin = sB;   // 1 mm inside the frame counts as in the frame

  const rows = [];
  A.moles.forEach((m, i) => {
    const label = numbers.get(m.id);
    const last = mmA(m);
    const row = { key: 'a' + m.id, label, a: m, b: null, lastMm: last.d, lastArea: last.area, sort: Number(label) };
    if (byLast.has(i)) {
      const bm = B.moles[byLast.get(i)];
      const now = mmB(bm);
      row.b = bm; row.nowMm = now.d; row.nowArea = now.area;
      row.change = now.d - last.d;
      row.pct = (now.d / last.d - 1) * 100;
      row.status = row.change >= g ? 'grown' : row.change <= -g ? 'shrunk' : 'same';
    } else {
      const [bx, by] = maps.toB(m.cx, m.cy);
      const inside = bx >= margin && by >= margin && bx <= B.W - margin && by <= B.H - margin;
      row.status = !inside ? 'out' : m.contrast < FAINT_CONTRAST ? 'faint' : 'gone';
      row.posB = [bx, by];
    }
    rows.push(row);
  });

  const bandB = 12 * sB;
  const fresh = B.moles.filter((m, j) => !usedNow.has(j)).sort((m, k) =>
    (Math.floor(m.cy / bandB) - Math.floor(k.cy / bandB)) || (m.cx - k.cx));
  let nNew = 0, nFaint = 0;
  fresh.forEach((m, k) => {
    const now = mmB(m);
    const posA = maps.toA(m.cx, m.cy);
    const faint = m.contrast < FAINT_CONTRAST;
    rows.push({ key: 'b' + m.id, label: faint ? 'F' + (++nFaint) : 'N' + (++nNew), a: null, b: m, nowMm: now.d, nowArea: now.area,
      status: faint ? 'faint' : 'new', posA, sort: (faint ? 200000 : 100000) + k });
  });

  for (const r of rows) {
    const size = r.nowMm != null ? r.nowMm : r.lastMm;
    r.over = size > OVER_MM;
  }

  const stats = { last: A.moles.length, now: B.moles.length, new: 0, gone: 0, grown: 0, shrunk: 0, out: 0, same: 0, faint: 0 };
  for (const r of rows) stats[r.status]++;

  const labelOfB = new Map();
  const statusOfA = new Map(), statusOfB = new Map();
  for (const r of rows) {
    if (r.b) { labelOfB.set(r.b.id, r.label); statusOfB.set(r.b.id, r); }
    if (r.a) statusOfA.set(r.a.id, r);
  }
  return { rows, stats, n, residualMm, byMoles, stretch, T, Tinv, labelOfB, statusOfA, statusOfB, numbers, sA, sB, bFromLast };
}

// ---------------------------------------------------------------------
// History
// ---------------------------------------------------------------------
function pushHistory(p) {
  p.history.push({ ruler: p.ruler.map((q) => q.slice()), landmarks: p.landmarks.map((q) => q.slice()), moles: p.moles.slice(),
    face: p.faceLandmarks, area: p.area, areaShell: p.areaShell, areaSource: p.areaSource, areaEdited: p.areaEdited });
  if (p.history.length > 60) p.history.shift();
}
function undo() {
  const p = activePhoto();
  if (!p || !p.history.length) return;
  const h = p.history.pop();
  p.ruler = h.ruler; p.landmarks = h.landmarks; p.moles = h.moles; p.faceLandmarks = h.face;
  p.area = h.area; p.areaShell = h.areaShell; p.areaSource = h.areaSource; p.areaEdited = h.areaEdited; p.areaOverlay = null;
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
    ruler: [], landmarks: [], moles: [], history: [], view: null, viewTouched: false, guidedCount: 0,
    faceLandmarks: false, irisPx: null, faceMesh: null, skinArea: null,
    area: null, areaSource: '', areaEdited: false, areaOverlay: null,
  });
  p.ws = Math.min(1, WORK_MAX / Math.max(p.W, p.H));
  p.ww = Math.round(p.W * p.ws);
  p.wh = Math.round(p.H * p.ws);
  const cv = document.createElement('canvas');
  cv.width = p.ww; cv.height = p.wh;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(bmp, 0, 0, p.ww, p.wh);
  p.v = C.brightness(cx.getImageData(0, 0, p.ww, p.wh).data, p.ww * p.wh);

  // Skin by colour first since it is instant; the face map or the person
  // finder replaces it a moment later.
  const ak = Math.min(1, AREA_MAX / Math.max(p.W, p.H));
  const aw = Math.max(1, Math.round(p.W * ak)), ah = Math.max(1, Math.round(p.H * ak));
  const small = document.createElement('canvas');
  small.width = aw; small.height = ah;
  const sx = small.getContext('2d', { willReadFrequently: true });
  sx.drawImage(bmp, 0, 0, aw, ah);
  p.areaRgba = sx.getImageData(0, 0, aw, ah).data;
  p.areaDims = { w: aw, h: ah, k: ak };
  setColourArea(p);

  fitView(p);
  zoomToArea(p);
  if (state.tool === 'ruler' || state.tool === 'landmark' || state.tool === 'area') state.tool = null;
  changed();
  analysePhoto(p, true);
}

// ---------------------------------------------------------------------
// Area
// ---------------------------------------------------------------------
function blankArea(p) {
  const { w, h, k } = p.areaDims;
  return { w, h, k, data: new Uint8Array(w * h) };
}

function setColourArea(p) {
  p.areaShell = null;
  const { w, h, k } = p.areaDims;
  const m = C.skinByColour(p.areaRgba, w, h, 0.05);
  if (m) { p.area = { w, h, k, data: m }; p.areaSource = 'colour'; }
  else { p.area = null; p.areaSource = 'whole'; }
  p.areaOverlay = null;
}

// The face without the eyes, brows, lips and nostrils, from the face map.
function setFaceArea(p, mesh) {
  const a = blankArea(p);
  const at = (i) => [mesh[i][0] * a.k, mesh[i][1] * a.k];
  // The face map's outline stops partway up the forehead. Points above the
  // eyes are pushed up to 1.8 times their height over the eye line, and
  // the skin finder then cuts the area back to the hairline.
  const eyeY = (mesh[33][1] + mesh[263][1]) / 2 * a.k;
  const oval = FACE_OVAL.map((i) => {
    const [x, y] = at(i);
    return y < eyeY ? [x, eyeY - (eyeY - y) * 1.8] : [x, y];
  });
  C.fillPolygon(a.data, a.w, a.h, oval, 1);
  // Hair falling over the face is not skin to the person finder.
  if (p.skinArea && p.skinArea.w === a.w) {
    for (let i = 0; i < a.data.length; i++) a.data[i] &= p.skinArea.data[i];
  }
  // The shell is the area with the eyes, brows, lips and nostrils kept in.
  // Only what lies outside it is dimmed on screen.
  const shell = a.data.slice();
  for (const [idx, grow] of FACE_HOLES) {
    const poly = C.scalePolygon(idx.map(at), grow);
    C.fillPolygon(a.data, a.w, a.h, poly, 0);
    C.fillPolygon(shell, a.w, a.h, poly, 1);
  }
  p.areaShell = C.fillHoles(shell, a.w, a.h);
  p.area = a;
  p.areaSource = 'face';
  p.areaOverlay = null;
}

function setWholeArea(p) {
  p.areaShell = null;
  p.area = null;
  p.areaSource = 'whole';
  p.areaOverlay = null;
}

function inArea(p, x, y) {
  if (!p.area) return true;
  const a = p.area;
  const ax = Math.floor(x * a.k), ay = Math.floor(y * a.k);
  if (ax < 0 || ay < 0 || ax >= a.w || ay >= a.h) return false;
  return a.data[ay * a.w + ax] === 1;
}

// True when a found spot sits inside the area with 1 mm of area all round
// it. A shadow along the jaw or the hairline straddles the edge and fails.
function clearOfAreaEdge(p, m, s) {
  if (!inArea(p, m.cx, m.cy)) return false;
  if (!p.area) return true;
  const r = m.feret / 2 + s;
  let inside = 0;
  for (let i = 0; i < 16; i++) {
    const t = i * Math.PI / 8;
    if (inArea(p, m.cx + r * Math.cos(t), m.cy + r * Math.sin(t))) inside++;
  }
  return inside >= 15;
}

// Drops moles that sit outside the area.
function trimToArea(p) {
  p.moles = p.moles.filter((m) => inArea(p, m.cx, m.cy));
}

function zoomToArea(p) {
  if (!viewer.w) return;
  const a = p.area;
  const b = a ? C.maskBounds(a.data, a.w, a.h) : null;
  if (!b) { fitView(p); return; }
  const x0 = b[0] / a.k, y0 = b[1] / a.k, x1 = b[2] / a.k, y1 = b[3] / a.k;
  const pad = 0.06;
  const bw = (x1 - x0) * (1 + 2 * pad), bh = (y1 - y0) * (1 + 2 * pad);
  const s = Math.min(viewer.w / bw, viewer.h / bh);
  p.view = { s, tx: viewer.w / 2 - (x0 + x1) / 2 * s, ty: viewer.h / 2 - (y0 + y1) / 2 * s };
}

// Dims what lies outside the area's outer edge. The eyes, brows, lips and
// nostrils inside it stay clear on screen while still being skipped.
function areaOverlay(p) {
  if (!p.area) return null;
  if (p.areaOverlay) return p.areaOverlay;
  const { w, h } = p.area;
  const data = p.areaShell && p.areaShell.length === w * h ? p.areaShell : C.fillHoles(p.area.data, w, h);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  const img = g.createImageData(w, h);
  for (let k = 0; k < w * h; k++) {
    if (data[k]) continue;
    const j = k * 4;
    img.data[j] = 8; img.data[j + 1] = 14; img.data[j + 2] = 22; img.data[j + 3] = 120;
  }
  g.putImageData(img, 0, 0);
  p.areaOverlay = cv;
  return cv;
}

// Paints the area in or out under the brush. x, y in screen pixels.
function paintArea(p, x, y) {
  if (!p.area) {
    const a = blankArea(p);
    a.data.fill(1);
    p.area = a;
  }
  const a = p.area;
  const [ix, iy] = toImage(p, x, y);
  const cx = ix * a.k, cy = iy * a.k;
  const r = Math.max(1, BRUSH_PX / p.view.s * a.k);
  const val = state.brush === 'erase' ? 0 : 1;
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(a.w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(a.h - 1, Math.ceil(cy + r));
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      if ((xx + 0.5 - cx) ** 2 + (yy + 0.5 - cy) ** 2 <= r * r) a.data[yy * a.w + xx] = val;
    }
  }
  p.areaOverlay = null;
}

// ---------------------------------------------------------------------
// Face map and person finder (MediaPipe)
// ---------------------------------------------------------------------
let mpVision = null, mpFiles = null;
let faceDetector = null, faceDetectorFail = null;
let segmenter = null, segmenterFail = null;

async function loadVision() {
  if (!mpVision) {
    mpVision = await import(MP_URL);
    mpFiles = await mpVision.FilesetResolver.forVisionTasks(MP_WASM);
  }
  return mpVision;
}

async function createTask(Task, opts) {
  try {
    opts.baseOptions.delegate = 'GPU';
    return await Task.createFromOptions(mpFiles, opts);
  } catch (e) {
    opts.baseOptions.delegate = 'CPU';
    return await Task.createFromOptions(mpFiles, opts);
  }
}

async function loadFaceDetector() {
  if (faceDetector) return faceDetector;
  if (faceDetectorFail) throw faceDetectorFail;
  try {
    const vision = await loadVision();
    faceDetector = await createTask(vision.FaceLandmarker,
      { baseOptions: { modelAssetPath: MP_MODEL }, runningMode: 'IMAGE', numFaces: 1 });
    return faceDetector;
  } catch (e) {
    faceDetectorFail = e;
    throw e;
  }
}

async function loadSegmenter() {
  if (segmenter) return segmenter;
  if (segmenterFail) throw segmenterFail;
  try {
    const vision = await loadVision();
    segmenter = await createTask(vision.ImageSegmenter,
      { baseOptions: { modelAssetPath: SEG_MODEL }, runningMode: 'IMAGE', outputCategoryMask: true, outputConfidenceMasks: false });
    return segmenter;
  } catch (e) {
    segmenterFail = e;
    throw e;
  }
}

// The whole face map, each point the median over the framings, in photo
// pixels. Null when fewer than 3 framings find a face.
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
    if (lms && lms.length >= 468) runs.push(lms.map((q) => [(q.x * cw - ox) / k, (q.y * ch - oy) / k]));
  }
  if (runs.length < 3) return null;
  const n = Math.min(...runs.map((r) => r.length));
  const median = (v) => { const q = v.slice().sort((x, y) => x - y); return q[q.length >> 1]; };
  const mesh = [];
  for (let i = 0; i < n; i++) mesh.push([median(runs.map((r) => r[i][0])), median(runs.map((r) => r[i][1]))]);
  return mesh;
}

// Horizontal iris width in photo pixels, both eyes averaged. Needs the
// 478-point map with the irises.
function irisWidth(mesh) {
  if (mesh.length < 478) return null;
  const right = dist(mesh[469], mesh[471]), left = dist(mesh[474], mesh[476]);
  if (!(right > 0) || !(left > 0)) return null;
  if (Math.max(right, left) / Math.min(right, left) > 1.35) return Math.max(right, left);   // one eye turned away
  return (right + left) / 2;
}

// Skin from the person finder: body skin and face skin, with the holes
// moles leave filled. Null when under 3% of the photo is skin.
function readSkin(seg, p) {
  const { w, h, k } = p.areaDims;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  cv.getContext('2d').drawImage(p.bitmap, 0, 0, w, h);
  let cat = null;
  try {
    const res = seg.segment(cv);
    const mask = res.categoryMask;
    cat = mask.getAsUint8Array().slice();
    mask.close && mask.close();
    res.close && res.close();
  } catch (e) { return null; }
  if (!cat || cat.length !== w * h) return null;
  const m = new Uint8Array(w * h);
  let n = 0;
  for (let i = 0; i < w * h; i++) if (cat[i] === 2 || cat[i] === 3) { m[i] = 1; n++; }
  if (n < w * h * 0.03) return null;
  // Holes up to about 15 mm across are filled (a mole the finder read as
  // not-skin); bigger ones, such as hair over the forehead, stay out.
  const s = pxPerMm(p) || Math.max(p.W, p.H) / ROUGH_MM;
  const holeMax = Math.PI / 4 * (15 * s * k) ** 2;
  const out = C.dilate(C.fillHoles(C.keepLarge(m, w, h, 0.05), w, h, holeMax), w, h, 1);
  return { w, h, k, data: out };
}

// Runs on every new photo: finds the face or the skin, sets the area, the
// landmarks and the estimated scale, then zooms in. The button runs it
// again and replaces the landmarks.
async function analysePhoto(p, onLoad) {
  if (!p.bitmap || p.faceBusy) return;
  const bitmap = p.bitmap;
  p.faceBusy = true;
  renderPanel();
  let mesh = null, skin = null, offline = false;
  try {
    try {
      const det = await loadFaceDetector();
      await new Promise((r) => setTimeout(r, 0));
      if (p.bitmap !== bitmap) return;
      mesh = readFace(det, p);
    } catch (e) { offline = true; }
    if (!offline) {
      try {
        const seg = await loadSegmenter();
        if (p.bitmap !== bitmap) return;
        skin = readSkin(seg, p);
      } catch (e) { /* keep the colour area */ }
    }
  } finally {
    p.faceBusy = false;
  }
  if (p.bitmap !== bitmap) return;

  if (mesh) {
    if (!onLoad || !p.landmarks.length) {
      pushHistory(p);
      p.landmarks = FACE_POINTS.map(([i]) => mesh[i].slice());
      p.faceLandmarks = true;
    }
    p.faceMesh = mesh;
    p.irisPx = irisWidth(mesh);
    if (skin) p.skinArea = skin;
    else {
      // Without the person finder, skin is found by colour, with anything
      // much darker than the cheeks (hair) left out.
      const { w, h, k } = p.areaDims;
      const ys = [];
      for (const i of [50, 280, 101, 330, 205, 425]) {
        const x = Math.round(mesh[i][0] * k), y = Math.round(mesh[i][1] * k);
        const j = (y * w + x) * 4;
        ys.push(0.299 * p.areaRgba[j] + 0.587 * p.areaRgba[j + 1] + 0.114 * p.areaRgba[j + 2]);
      }
      ys.sort((a, b) => a - b);
      const m = C.skinByColour(p.areaRgba, w, h, 0.05, ys[ys.length >> 1] * 0.65);
      p.skinArea = m ? { w, h, k, data: m } : null;
    }
    if (!p.areaEdited) setFaceArea(p, mesh);
  } else if (skin) p.skinArea = skin;
  if (!mesh && skin && !p.areaEdited) {
    p.areaShell = null;
    p.area = skin;
    p.areaSource = 'skin';
    p.areaOverlay = null;
  }
  if (!p.areaEdited) trimToArea(p);
  if (onLoad && !p.viewTouched) zoomToArea(p);
  changed();
  if (onLoad && !p.moles.length && pxPerMm(p)) await findMoles(p);
  if (activePhoto() !== p) return;
  if (mesh) showToast('Face found. The area, landmarks and scale are set from it.');
  else if (offline && !onLoad) showToast('The face finder needs an internet connection the first time.');
  else if (!onLoad) showToast('No face found in this photo.');
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
    contrast: m.contrast || 0,
    manual: !!manual,
    outlines: {},
  };
}

async function findMoles(target) {
  const p = target && target.key ? target : activePhoto();
  const s = p && pxPerMm(p);
  if (!s) return;
  dom.find.textContent = 'Finding';
  dom.find.disabled = true;
  await new Promise((r) => setTimeout(r, 50));
  try {
    const st = state.settings;
    const found = C.detect(p.v, p.ww, p.wh, { pxPerMm: s * p.ws, minMm: st.minMm, maxMm: st.maxMm, sensitivity: st.sensitivity });
    pushHistory(p);
    const manual = p.moles.filter((m) => m.manual);
    // An ink dot under a landmark is skipped as a mole.
    const onLandmark = (m) => p.landmarks.some((q) => dist(q, [m.cx, m.cy]) < Math.max(1.5 * s, m.feret / 2));
    const auto = found.map((m) => toMole(p, m, false))
      .filter((m) => clearOfAreaEdge(p, m, s))
      .filter((m) => !onLandmark(m))
      .filter((m) => !manual.some((q) => dist([q.cx, q.cy], [m.cx, m.cy]) < Math.max(q.feret, m.feret) / 2));
    p.moles = manual.concat(auto);
    p.guidedCount = p === B ? findAtLastSpots(p) : 0;
  } finally {
    dom.find.textContent = 'Find moles';
    dom.find.disabled = false;
  }
  if (state.tool === 'ruler' || state.tool === 'landmark' || state.tool === 'area') state.tool = null;
  changed();
}

// Looks again at every spot where one photo has a mole and the other has
// none, both ways round, since a faint mole can sit just under the
// detector's threshold in one photo and just over it in the other. A spot
// found this way is measured like any other. Returns how many were added
// to this visit; the ones added to the last visit are counted on it.
function findAtLastSpots(p) {
  if (p !== B || !A.moles.length) return 0;
  const al = alignVisits();
  if (al.error) return 0;
  const maps = visitMaps(al);
  const sA = pxPerMm(A);
  const sB = sA / Math.sqrt(Math.abs(al.T[0] * al.T[4] - al.T[1] * al.T[3]));
  const added = lookAgain(A, sA, B, sB, maps.toB);
  A.guidedCount = (A.guidedCount || 0) + lookAgain(B, sB, A, sA, maps.toA);
  return added;
}

function lookAgain(from, sFrom, to, sTo, map) {
  const tol = state.settings.matchMm * sTo;
  const spots = from.moles.map((m) => map(m.cx, m.cy));
  const paired = new Set(C.matchMoles(spots, to.moles.map((m) => [m.cx, m.cy]), tol).map((p) => p.last));
  let added = 0;
  for (let i = 0; i < from.moles.length; i++) {
    if (paired.has(i)) continue;
    const a = from.moles[i];
    const [x, y] = spots[i];
    if (x < 0 || y < 0 || x >= to.W || y >= to.H || !inArea(to, x, y)) continue;
    const mm = a.feret / sFrom;
    // At least 6% darker than the skin and close to the other photo's
    // contrast, so plain mottled skin where a mole has gone is left alone.
    const m = C.segmentAt(to.v, to.ww, to.wh, x * to.ws, y * to.ws, {
      pxPerMm: sTo * to.ws, maxMm: Math.max(4, mm * 2 + 2), searchMm: Math.min(state.settings.matchMm, 3),
      minContrast: Math.max(0.08, a.contrast * 0.4),
    });
    if (!m) continue;
    const mole = toMole(to, m, false);
    const got = mole.feret / sTo;
    if (Math.hypot(mole.cx - x, mole.cy - y) > tol || got < mm * 0.4 || got > mm * 2.5 + 1) continue;
    if (to.moles.some((m) => Math.hypot(m.cx - mole.cx, m.cy - mole.cy) < 0.7 * sTo)) continue;   // the same spot again
    mole.guided = true;
    to.moles.push(mole);
    added++;
  }
  return added;
}

// Steps through the moles in number order, zoomed in on each one.
function stepMole(dir) {
  const p = activePhoto();
  if (!p || !p.moles.length) return;
  const order = orderedMoles(p);
  let i = order.findIndex((m) => m.id === state.selected);
  i = i < 0 ? (dir > 0 ? 0 : order.length - 1) : (i + dir + order.length) % order.length;
  const m = order[i];
  state.selected = m.id;
  focusOn(p, m.cx, m.cy, 14);
  renderPanel();
}

function removeSelectedMole() {
  const p = activePhoto();
  if (!p) return;
  const order = orderedMoles(p);
  const i = order.findIndex((m) => m.id === state.selected);
  if (i < 0) return;
  pushHistory(p);
  p.moles = p.moles.filter((m) => m.id !== state.selected);
  const next = order[i + 1] || order[i - 1];
  state.selected = next ? next.id : null;
  if (next) focusOn(p, next.cx, next.cy, 14);
  changed();
}

function orderedMoles(p) {
  if (p === A) {
    const numbers = numberLastVisit();
    return p.moles.slice().sort((m, n) => Number(numbers.get(m.id)) - Number(numbers.get(n.id)));
  }
  const s = pxPerMm(p) || p.H / 200, band = 12 * s;
  return p.moles.slice().sort((m, n) => (Math.floor(m.cy / band) - Math.floor(n.cy / band)) || (m.cx - n.cx));
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

// Shows a spot `fieldMm` across (20 mm unless given) in the middle of the view.
function focusOn(p, x, y, fieldMm) {
  const s = pxPerMm(p) || 8;
  const ns = Math.min(viewer.w, viewer.h) / ((fieldMm || 20) * s);
  p.viewTouched = true;
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
      const sOther = p === B ? res.sA : res.sB, sHere = p === B ? res.sB : res.sA;
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
  const ov = areaOverlay(p);
  if (ov) ctx.drawImage(ov, v.tx, v.ty, p.W * v.s, p.H * v.s);
  drawMarks(ctx, p, v.s, v.tx, v.ty, {});
  if (state.tool === 'area' && viewer.brushAt) {
    ctx.beginPath();
    ctx.arc(viewer.brushAt[0], viewer.brushAt[1], BRUSH_PX, 0, Math.PI * 2);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = state.brush === 'erase' ? '#FF8A8A' : '#FFFFFF';
    ctx.stroke();
  }
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
  if (pointers.size === 1 && state.tool === 'area' && state.tab !== 'compare') {
    pushHistory(p);
    if (p.area) p.area = Object.assign({}, p.area, { data: p.area.data.slice() });
    paintArea(p, x, y);
    viewer.brushAt = [x, y];
    gesture = { type: 'paint', lx: x, ly: y };
    requestDraw();
  } else if (pointers.size === 1) {
    gesture = { type: 'pending', sx: x, sy: y, lx: x, ly: y, handle: state.tab !== 'compare' ? handleAt(p, x, y) : null };
  } else if (pointers.size === 2) {
    if (gesture && gesture.type === 'paint') finishPaint(p);
    p.viewTouched = true;
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
  if (state.tool === 'area') { viewer.brushAt = [x, y]; requestDraw(); }
  if (!gesture) return;
  if (gesture.type === 'paint') {
    // Paint along the stroke in steps of half a brush so a fast swipe leaves no gaps.
    const steps = Math.max(1, Math.ceil(Math.hypot(x - gesture.lx, y - gesture.ly) / (BRUSH_PX / 2)));
    for (let i = 1; i <= steps; i++) {
      paintArea(p, gesture.lx + (x - gesture.lx) * i / steps, gesture.ly + (y - gesture.ly) * i / steps);
    }
    gesture.lx = x; gesture.ly = y;
    requestDraw();
    return;
  }
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
    p.viewTouched = true;
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
  if (e.pointerType !== 'mouse') { viewer.brushAt = null; requestDraw(); }
  if (gesture && gesture.type === 'pending' && pointers.size === 0 && e.type === 'pointerup') {
    onTap(gesture.sx, gesture.sy);
  }
  if (gesture && gesture.type === 'handle') changed();
  if (gesture && gesture.type === 'paint') finishPaint(shownPhoto());
  if (pointers.size === 0) gesture = null;
  else if (gesture && gesture.type === 'pinch') gesture = { type: 'none' };
}

// Two marks 10 mm apart by the current scale, side by side in the middle
// of the view, for the doctor to drag onto the ruler.
function placeRulerMarks(p, sNow) {
  const s = sNow || Math.max(p.W, p.H) / ROUGH_MM;
  const [cx, cy] = toImage(p, viewer.w / 2, viewer.h / 2);
  const half = 5 * s;
  p.ruler = [[cx - half, cy], [cx + half, cy]];
  p.rulerMm = 10;
}

// Ends a brush stroke: the area now counts as painted by hand and moles
// outside it are dropped.
function finishPaint(p) {
  gesture = { type: 'none' };
  p.areaShell = null;
  p.areaSource = 'painted';
  p.areaEdited = true;
  trimToArea(p);
  changed();
}

function onWheel(e) {
  const p = shownPhoto();
  if (!p || !p.bitmap) return;
  e.preventDefault();
  const [x, y] = localXY(e);
  p.viewTouched = true;
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
    return 'Green same, red grown, blue shrunk, purple new, dashed gone, grey faint. Tap a mole for its numbers.';
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
    case 'area': return (state.brush === 'erase' ? 'Drag to take skin out of the area.' : 'Drag to paint skin into the area.') +
      ' Move the photo with two fingers, or turn the tool off.';
    case 'remove': return 'Tap a mark to remove it.';
    default: return 'Drag to move. Pinch or scroll to zoom.';
  }
}

function rowSentence(r) {
  const head = r.label.startsWith('N') ? 'New mole ' + r.label : r.label.startsWith('F') ? 'Spot ' + r.label : 'Mole ' + r.label;
  switch (r.status) {
    case 'faint': return head + ' is ' + fmt(r.nowMm != null ? r.nowMm : r.lastMm) + ' mm across and too faint to call, since it shows on one photo only.';
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

  const areaWords = {
    face: 'Area: the face, without the eyes, brows, lips and nostrils.',
    skin: 'Area: the skin.',
    colour: 'Area: the skin, found by its colour.',
    whole: 'Area: the whole photo.',
    painted: 'Area: painted by hand.',
  };
  dom.areaResult.textContent = !p.bitmap ? '' : p.faceBusy ? 'Looking for a face or skin.' : areaWords[p.areaSource] || '';
  for (const b of dom.brushSeg.querySelectorAll('button')) b.classList.toggle('is-active', b.dataset.brush === state.brush);
  dom.areaAgain.disabled = !p.bitmap || p.faceBusy;
  dom.areaWhole.disabled = !p.bitmap || p.areaSource === 'whole';

  for (const b of dom.scaleSeg.querySelectorAll('button')) b.classList.toggle('is-active', b.dataset.scale === p.scaleMode);
  dom.scaleEstimate.hidden = p.scaleMode !== 'estimate';
  dom.scaleRuler.hidden = p.scaleMode !== 'ruler';
  dom.scaleLandmarks.hidden = p.scaleMode !== 'landmarks';
  setInput(dom.rulerMm, p.rulerMm);
  setInput(dom.lmMm, p.lmMm > 0 ? p.lmMm : '');
  const fromLast = p === B ? lastVisitLandmarkMm() : null;
  dom.lmMm.placeholder = fromLast ? fmt(fromLast) : '';
  dom.lmMmFrom.hidden = !(p === B && fromLast);
  dom.lmMmFrom.textContent = fromLast ? 'From the last visit: ' + fmt(fromLast) + ' mm. Type a value to use your own.' : '';

  const s = pxPerMm(p);
  dom.estimateNote.textContent = p === B
    ? 'Compare replaces this estimate with the last visit\'s scale, carried across by the landmarks or the moles.'
    : 'A face is measured against the iris, which is ' + IRIS_MM + ' mm wide in adults. Without a face the photo is taken as ' + ROUGH_MM + ' mm across. A ruler gives true sizes.';
  if (!p.bitmap) dom.scaleResult.textContent = '';
  else if (s && p.scaleMode === 'estimate') {
    dom.scaleResult.textContent = 'Scale: ' + fmt(s) + ' pixels per mm, ' +
      (p.irisPx ? 'estimated from the iris.' : 'a rough estimate from the photo size.');
  } else if (s) dom.scaleResult.textContent = 'Scale: ' + fmt(s) + ' pixels per mm.';
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
  const auto = p.moles.filter((m) => !m.manual).length, manual = p.moles.length - auto;
  dom.moleCount.textContent = !p.moles.length ? '' :
    p.moles.length + (p.moles.length === 1 ? ' mole' : ' moles') + (manual ? ', ' + manual + ' added by hand' : '') +
    (p.guidedCount ? ', ' + p.guidedCount + ' found again where the last visit had one' : '') + '.';
  const order = orderedMoles(p);
  const at = order.findIndex((m) => m.id === state.selected);
  dom.review.hidden = !p.moles.length;
  dom.moleDrop.disabled = at < 0;
  if (at >= 0) dom.moleCount.textContent += ' Showing ' + (at + 1) + ' of ' + order.length + '.';
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
    ['Grown', s.grown], ['Shrunk', s.shrunk], ['Faint', s.faint], ['Not in frame', s.out],
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
    'scale-landmarks', 'scale-estimate', 'estimate-note', 'area-result', 'brush-seg', 'area-again', 'area-whole',
    'review', 'mole-prev', 'mole-drop', 'mole-next', 'ruler-mm', 'lm-mm', 'lm-mm-from', 'scale-result', 'lm-count', 'lm-undo', 'face-find', 'sens',
    'sens-out', 'min-mm', 'max-mm', 'find', 'mole-count', 'missing', 'compare-body', 'stats',
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
      const was = pxPerMm(p);
      p.scaleMode = b.dataset.scale;
      if (p.bitmap && p.scaleMode === 'ruler') {
        if (p.ruler.length < 2) placeRulerMarks(p, was);
        state.tool = 'ruler';
      } else if (state.tool === 'ruler') state.tool = null;
      changed();
    });
  }
  for (const b of dom.brushSeg.querySelectorAll('button')) {
    b.addEventListener('click', () => { state.brush = b.dataset.brush; state.tool = 'area'; renderPanel(); requestDraw(); });
  }
  dom.areaAgain.addEventListener('click', () => {
    const p = activePhoto();
    pushHistory(p);
    p.areaEdited = false;
    if (p.faceMesh) setFaceArea(p, p.faceMesh);
    else if (p.skinArea) { p.area = p.skinArea; p.areaShell = null; p.areaSource = 'skin'; p.areaOverlay = null; }
    else setColourArea(p);
    zoomToArea(p);
    changed();
  });
  dom.areaWhole.addEventListener('click', () => {
    const p = activePhoto();
    pushHistory(p);
    setWholeArea(p);
    p.areaEdited = true;
    changed();
  });
  dom.molePrev.addEventListener('click', () => stepMole(-1));
  dom.moleNext.addEventListener('click', () => stepMole(1));
  dom.moleDrop.addEventListener('click', removeSelectedMole);
  numberInput(dom.rulerMm, (v) => { activePhoto().rulerMm = v; state.version++; renderPanel(); requestDraw(); });
  numberInput(dom.lmMm, (v) => { activePhoto().lmMm = v > 0 ? v : null; state.version++; renderPanel(); requestDraw(); });
  dom.faceFind.addEventListener('click', () => analysePhoto(activePhoto(), false));
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
  dom.find.addEventListener('click', () => findMoles());

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
