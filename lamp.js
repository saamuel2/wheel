// lava lamp for the sidebar: this week's graded assignments as wax.
// one round cell per assignment, grey until it's submitted, then its course's colour; a slow bulb keeps the wax rising, pinching off and sinking.
// Lamp.create(canvas) → { setWeek([{ c, n, d, color }]), setTheme('light'|'default'|'elegant'|'moody'), setStill(bool), setCalm(bool), kick(amount) }
(function () {
const LOOK = { light: { L: .68, C: .12, gL: .93 }, dark: { L: .74, C: .12, gL: .40 }, elegant: { L: .60, C: .085, gL: .91 }, moody: { L: .60, C: .085, gL: .34 } };
const toLin = c => (c /= 255) <= .04045 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4);
const toSrgb = c => Math.round(255 * Math.max(0, Math.min(1, c <= .0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - .055)));
function oklch(hex) {
  const [r, g, b] = [1, 3, 5].map(i => toLin(parseInt(hex.slice(i, i + 2), 16)));
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b), m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b), s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
  const L = .2104542553 * l + .793617785 * m - .0040720468 * s, A = 1.9779984951 * l - 2.428592205 * m + .4505937099 * s, B = .0259040371 * l + .7827717662 * m - .808675766 * s;
  return [L, Math.hypot(A, B), (Math.atan2(B, A) * 180 / Math.PI + 360) % 360];
}
function rgbOf(L, C, h) {
  const a = C * Math.cos(h * Math.PI / 180), b = C * Math.sin(h * Math.PI / 180);
  const l = (L + .3963377774 * a + .2158037573 * b) ** 3, m = (L - .1055613458 * a - .0638541728 * b) ** 3, s = (L - .0894841775 * a - 1.291485548 * b) ** 3;
  return [toSrgb(4.0767416621 * l - 3.3077115913 * m + .2309699292 * s), toSrgb(-1.2684380046 * l + 2.6097574011 * m - .3413193965 * s), toSrgb(-.0041960863 * l - .7034186147 * m + 1.707614701 * s)];
}
const rnd = (a, b) => a + Math.random() * (b - a);

function create(cv) {
const ctx = cv.getContext('2d');
let THEME = 'dark', PAL = [], GREY = [128, 128, 128], WEEK = [], BUILT = 0, STILL = false, WANT = false;
let W = 0, H = 0, RES = 1, img = null, BW = 0, BH = 0, F, TMP, B1, B2, C1, C2, TOUCH;
const fit = () => { const r = cv.getBoundingClientRect(); if (!r.width || !r.height) { W = H = 0; return; } RES = Math.min(1.5, devicePixelRatio || 1);
  const nw = Math.round(r.width * RES), nh = Math.round(r.height * RES); if (nw === BW && nh === BH) return; const ow = W, oh = H;
  W = r.width; H = r.height; BW = cv.width = nw; BH = cv.height = nh;
  img = ctx.createImageData(BW, BH); const n = BW * BH; F = new Float32Array(n); TMP = new Float32Array(n); B1 = new Float32Array(n); B2 = new Float32Array(n); C1 = new Int16Array(n); C2 = new Int16Array(n); TOUCH = new Uint8Array(n);
  if (ow && oh) P.forEach(p => { p.x *= W / ow; p.y *= H / oh; }); if (WANT || !BUILT) build(); else if (STILL) still(); };
let S = 11.5, PER = 8, KR = S * 2.4;   // particle spacing; particles per cell; drawing radius (all set per week in fit to the week)
// any week should look right: total wax grows gently with the number of assignments (4 is about 60% of 17, 40 about 140%), and each cell's size is its share of that
function scaleFor(N) { N = Math.max(1, N); PER = 8; const area = Math.min(.4 * W * H, 15600 * Math.pow(N / 17, .4) * (W * H) / (216 * 460));   /* sized to the window, never more than 40% of it */ S = Math.min(24, Math.sqrt(area / (N * PER * .87))); KR = S * 2.4; }
let P = [], CELLS = [], STAMP = 0, EMPTY = false;
const rnd = (a, b) => a + Math.random() * (b - a);
function addCell(k, cx, cy) { const ci = CELLS.length; CELLS.push({ k, on: false, col: 0, st: 0, pulse: 0 }); const rc = S * .6 * Math.sqrt(PER);
  for (let i = 0; i < PER; i++) { const a = rnd(0, 6.283), d = rc * Math.sqrt(Math.random()); P.push({ k, c: ci, x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, vx: 0, vy: 0, T: .15 }); } }
// a submission turns one of that course's grey cells into a coloured one
function colorize(k, d) { const mine = CELLS.filter(c => c.k === k), lit = mine.filter(c => c.on).sort((a, b) => b.st - a.st), off = mine.filter(c => !c.on);
  let have = lit.length; while (have > d) { lit[lit.length - have].on = false; have--; }
  while (have < d && off.length) { const c = off.splice(Math.floor(Math.random() * off.length), 1)[0]; c.on = true; c.st = ++STAMP; c.fresh = true; have++; } }
const REP = 420, COH = 70;
// the invisible container: a rounded rectangle inset from the sidebar, with a soft cushion so wax curves away from it instead of lying flat
const BOX = () => { const m = 5 + S * .8; return { hx: W / 2 - m, hy: H / 2 - m, r: Math.max(10, 24 - m * .3) }; };   // inset by the wax's own soft edge, so nothing touches the window's sides
function sdf(x, y) { const b = BOX(), qx = Math.abs(x - W / 2) - (b.hx - b.r), qy = Math.abs(y - H / 2) - (b.hy - b.r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - b.r; }
function wall(p, dt) { const s = sdf(p.x, p.y), CU = 10; if (s < -CU) return;
  let gx = sdf(p.x + 1, p.y) - sdf(p.x - 1, p.y), gy = sdf(p.x, p.y + 1) - sdf(p.x, p.y - 1); const gl = Math.hypot(gx, gy) || 1; gx /= gl; gy /= gl;
  const f = (s + CU) / CU, push = f * f * 900 * dt; p.vx -= gx * push; p.vy -= gy * push;
  const out = p.vx * gx + p.vy * gy; if (out > 0) { p.vx -= gx * out * Math.min(1, f); p.vy -= gy * out * Math.min(1, f); }
  if (s > 0) { p.x -= gx * s; p.y -= gy * s; } }

function startPlume(cx, cy, live) {
  const top = P.filter(p => p.y > H * .45 && !P.some(o => o.c !== p.c && Math.abs(o.x - p.x) < S && o.y < p.y && o.y > p.y - S * 1.7)).filter(p => !PLS.some(pl => pl.cells.has(p.c)));
  if (!top.length) return; const s = top[Math.floor(Math.random() * top.length)], r = Math.random();
  const kind = r < .22 * live ? 'column' : r < .22 * live + .25 ? 'stall' : 'rise', cells = new Set([s.c]), tgt = new Map([[s.c, kind === 'stall' ? .6 : 1]]);
  if (kind === 'column') {   // the seed and the cells beneath it, warmed less the lower they sit, so the wax stretches up into a column
    CELLS.map((c, i) => i).filter(i => i !== s.c && cy[i] > cy[s.c] && Math.abs(cx[i] - cx[s.c]) < S * 3.5).sort((a, b) => cy[a] - cy[b]).slice(0, 2 + Math.floor(Math.random() * 3))
      .forEach((i, j) => { cells.add(i); tgt.set(i, .86 - j * .08); });
    cells.forEach(i => CELLS[i].glue = 12);
  } else if (kind === 'rise' && Math.random() < .5) { let best = -1, bd = 1e9; CELLS.forEach((c, i) => { if (i !== s.c && c.k === s.k) { const d = Math.hypot(cx[i] - cx[s.c], cy[i] - cy[s.c]); if (d < bd) { bd = d; best = i; } } }); if (best >= 0 && bd < S * 5) { cells.add(best); tgt.set(best, 1); } }
  PLS.push({ kind, cells, tgt, t: kind === 'stall' ? 2.5 : kind === 'column' ? 9 : 6, rate: kind === 'column' ? .45 : .9 });
  if (kind !== 'column' && Math.random() < .7) P.filter(p => cells.has(p.c)).sort(() => Math.random() - .5).slice(0, Math.random() < .5 ? 1 : 2).forEach(p => { p.loose = rnd(5, 9); p.T = 1; p.vy -= 30; p.vx += rnd(-20, 20); });
}
function step(dt, quiet) {
  const n = P.length, h = S * 1.95, warm = 1 + ENERGY * 1.5, NC = CELLS.length;
  // cell centres, used to keep each cell round
  const cx = new Float32Array(NC), cy = new Float32Array(NC), cn = new Float32Array(NC);
  P.forEach(p => { cx[p.c] += p.x; cy[p.c] += p.y; cn[p.c]++; }); for (let i = 0; i < NC; i++) if (cn[i]) { cx[i] /= cn[i]; cy[i] /= cn[i]; }
  const K = WEEK.length, kx = new Float32Array(K), ky = new Float32Array(K), kn = new Float32Array(K); P.forEach(p => { kx[p.k] += p.x; ky[p.k] += p.y; kn[p.k]++; }); for (let i = 0; i < K; i++) if (kn[i]) { kx[i] /= kn[i]; ky[i] /= kn[i]; }
  // cells reaching the top: about half hang under the cap and spread before they drip, the rest turn straight round
  CELLS.forEach((c, i) => { if (!cn[i]) return; if (cy[i] < 80) { if (!c.atTop) { c.atTop = true; if (Math.random() < .5) c.hang = rnd(3, 7); } } else if (cy[i] > H * .4) c.atTop = false; });
  // the bulb: it warms wax on the pool's surface. a plain rise, a stall that only gets halfway, or (once the lamp is warm) a tall column
  if (!quiet) { const live = CALM ? .3 : Math.min(1, .4 + TIME / 45);   // already moving when it appears, fully warm after about 30 seconds; calmer with reduced motion
    PLS = PLS.filter(pl => { pl.t -= dt; P.forEach(p => { if (pl.cells.has(p.c) && p.y > H * .3) p.T += (pl.tgt.get(p.c) - p.T) * dt * pl.rate; });
      if (pl.t > 0) return true; pl.cells.forEach(c => { if (pl.kind === 'stall') CELLS[c].chill = 6; }); return false; });
    if (PLS.length < (live > .6 ? 2 : 1) && (NEXT -= dt * warm * (.35 + .65 * live)) <= 0) { NEXT = rnd(5, 10); startPlume(cx, cy, live); } }
  for (let i = 0; i < n; i++) { const a = P[i];
    for (let j = i + 1; j < n; j++) { const b = P[j], dx = b.x - a.x; if (dx > h || dx < -h) continue; const dy = b.y - a.y; if (dy > h || dy < -h) continue;
      const d2 = dx * dx + dy * dy; if (d2 > h * h) continue; const d = Math.sqrt(d2) || .01, ux = dx / d, uy = dy / d, cell = a.c === b.c, same = a.k === b.k;
      // a cell holds itself together hardest, then its course, then everything else
      const loose = a.loose > 0 || b.loose > 0, f = d < (cell ? S : S * 1.12) ? -((cell ? S : S * 1.12) - d) * REP : COH * (loose ? .12 : cell ? 1.7 : (CELLS[a.c].glue > 0 && CELLS[b.c].glue > 0) ? 1.5 : same ? .8 : .35) * (d - S) * (h - d) / ((h - S) * (h - S) * .25) / S;
      a.vx += ux * f * dt; a.vy += uy * f * dt; b.vx -= ux * f * dt; b.vy -= uy * f * dt;
      const c = (cell ? .16 : .05) * (1 - d / h), rvx = (b.vx - a.vx) * c, rvy = (b.vy - a.vy) * c; a.vx += rvx; a.vy += rvy; b.vx -= rvx; b.vy -= rvy;   // thick, like wax
      if (cell) { const t = (b.T - a.T) * (1 - d / h) * dt * 1.5; a.T += t; b.T -= t; } }
    if (a.loose > 0) a.loose -= dt; else { const hx = cx[a.c] - a.x, hy = cy[a.c] - a.y, hd = Math.hypot(hx, hy) || 1, hf = Math.min(14 * hd, 70) / hd * (CELLS[a.c].hang > 0 ? .3 : 1); a.vx += hx * hf * dt; a.vy += hy * hf * dt; }   // keeps the cell round, and brings any stray bubble home
    { const hx = kx[a.k] - a.x, hy = ky[a.k] - a.y, hd = Math.hypot(hx, hy); if (hd > S * 5) { a.vx += hx / hd * 10 * dt; a.vy += hy / hd * 10 * dt; } }   // a course that has drifted apart slowly finds itself again
    // warm wax is lighter than the liquid, cool wax heavier
    a.vy += (a.T < .42 ? (.42 - a.T) * 150 : (.42 - a.T) * 230) * dt;
    const C = CELLS[a.c]; a.T += (.15 - a.T) * dt * (C.hang > 0 ? 0 : a.y < 90 ? .45 : C.chill > 0 ? .35 : .03); if (C.hang > 0) a.T = Math.max(a.T, .5);   // hanging wax stays pressed up under the top
    if (M.in && !M.grab) { const dx = a.x - M.x, dy = a.y - M.y, d = Math.hypot(dx, dy) || 1; if (d < 24) { const f = (24 - d) * 6; a.vx += dx / d * f * dt + M.vx * dt * 20; a.vy += dy / d * f * dt + M.vy * dt * 20; } }
  }
  if (M.grab) M.grab.forEach(g => { g.p.vx += ((M.x + g.ox) - g.p.x) * 300 * dt; g.p.vy += ((M.y + g.oy) - g.p.y) * 300 * dt; g.p.vx *= .7; g.p.vy *= .7; });
  const damp = Math.exp(-2.2 * dt);
  P.forEach(p => { p.vx *= damp; p.vy *= damp; const v = Math.hypot(p.vx, p.vy); if (v > 220) { p.vx *= 220 / v; p.vy *= 220 / v; } p.x += p.vx * dt; p.y += p.vy * dt; wall(p, dt); });
  CELLS.forEach(c => { c.col += ((c.on ? 1 : 0) - c.col) * Math.min(1, dt * 2.5); c.pulse *= Math.pow(.3, dt); c.glue = Math.max(0, (c.glue || 0) - dt); c.chill = Math.max(0, (c.chill || 0) - dt); c.hang = Math.max(0, (c.hang || 0) - dt); });
}
function draw() {
  const w = BW, h = BH, d = img.data; F.fill(0); B1.fill(0); B2.fill(0); C1.fill(-1); C2.fill(-1); TOUCH.fill(0); d.fill(0);
  const byCell = CELLS.map(() => []); P.forEach(p => byCell[p.c].push(p));
  const ccol = CELLS.map(c => { const g = GREY, k = c.k < 0 ? GREY : PAL[c.k] || GREY, t = c.col; return [g[0] + (k[0] - g[0]) * t, g[1] + (k[1] - g[1]) * t, g[2] + (k[2] - g[2]) * t]; });
  byCell.forEach((ps, ci) => { if (!ps.length) return; const R = KR * (1 + CELLS[ci].pulse * .12), R2 = R * R;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; ps.forEach(p => { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); });
    x0 = Math.max(0, Math.floor((x0 - R) * RES)); x1 = Math.min(w - 1, Math.ceil((x1 + R) * RES)); y0 = Math.max(0, Math.floor((y0 - R) * RES)); y1 = Math.min(h - 1, Math.ceil((y1 + R) * RES));
    for (let py = y0; py <= y1; py++) TMP.fill(0, py * w + x0, py * w + x1 + 1);
    ps.forEach(p => { const a0 = Math.max(x0, Math.floor((p.x - R) * RES)), a1 = Math.min(x1, Math.ceil((p.x + R) * RES)), b0 = Math.max(y0, Math.floor((p.y - R) * RES)), b1 = Math.min(y1, Math.ceil((p.y + R) * RES));
      for (let py = b0; py <= b1; py++) { const yy = py / RES - p.y, yy2 = yy * yy; if (yy2 >= R2) continue; let i = py * w + a0;
        for (let px = a0; px <= a1; px++, i++) { const xx = px / RES - p.x, r2 = xx * xx + yy2; if (r2 >= R2) continue; const q = 1 - r2 / R2; TMP[i] += q * q * q; } } });
    for (let py = y0; py <= y1; py++) { let i = py * w + x0; for (let px = x0; px <= x1; px++, i++) { const v = TMP[i]; if (v <= 0) continue; F[i] += v; TOUCH[i] = 1;
      if (v > B1[i]) { B2[i] = B1[i]; C2[i] = C1[i]; B1[i] = v; C1[i] = ci; } else if (v > B2[i]) { B2[i] = v; C2[i] = ci; } } } });
  const TH = .62, lit = THEME === 'light' || THEME === 'elegant';
  for (let py = 1; py < h - 1; py++) { const y = py / RES; for (let px = 1; px < w - 1; px++) { const i = py * w + px; if (!TOUCH[i]) continue; const f = F[i]; if (f < TH * .5) continue;
    const g = Math.hypot(F[i + 1] - F[i - 1], F[i + w] - F[i - w]) * .5 + 1e-4, a = Math.max(0, Math.min(1, (f - TH) / (g * 1.8) + .5)); if (a <= 0) continue;
    const c1 = C1[i], c2 = C2[i], k1 = ccol[c1]; let r = k1[0], gg = k1[1], b = k1[2];
    if (c2 >= 0) { const gb = Math.hypot(B1[i + 1] - B1[i - 1], B1[i + w] - B1[i - w]) * .5 + 1e-4, e = (B1[i] - B2[i]) / gb;   // e: pixels from the edge between two cells
      if (e < 5) { const k2 = ccol[c2], t = Math.max(0, .5 - e * .1); r += (k2[0] - r) * t; gg += (k2[1] - gg) * t; b += (k2[2] - b) * t;
        const sh = 0; r *= 1 - sh; gg *= 1 - sh; b *= 1 - sh; } }   // a faint line where coloured cells press together
    // backlit: thin wax and the wax nearest the bulb glow; thick wax and the middle of each cell read denser
    const thick = Math.min(1, (f - TH) / 1.4), rim = Math.max(0, 1 - (f - TH) / .35), cd = Math.min(1, B1[i] / 3.5), j4 = i * 4;
    const glow = (lit ? .07 : .22) * rim * rim + (lit ? .05 : .08) * (1 - thick) + (lit ? .05 : .10) * (y / H) * (y / H) + CELLS[c1].pulse * .14;
    const dense = (lit ? .09 : .13) * thick * (.65 + .35 * cd);
    const rgb = [r, gg, b]; for (let j = 0; j < 3; j++) { const v = rgb[j] * (1 - dense); d[j4 + j] = v + (255 - v) * glow; }
    d[j4 + 3] = a * 255; } }
  ctx.putImageData(img, 0, 0);
}
let ENERGY = 0, TIME = 0, PLS = [], NEXT = 1.5, CALM = false;

function build() {
  WANT = false; if (!W) { WANT = true; return; }
  P = []; CELLS = []; PLS = []; NEXT = 1.5; const N = WEEK.reduce((s, w) => s + w.n, 0); BUILT = Math.max(1, N); scaleFor(N || 3); const order = WEEK.map((w, k) => k).sort(() => Math.random() - .5);
  EMPTY = !N; if (EMPTY) for (let i = 0; i < 3; i++) addCell(-1, W / 2 + rnd(-20, 20), H - 60 - rnd(0, 40));   // a week with nothing due still has a little grey wax, so the lamp never looks blank
  order.forEach(k => { const cx = rnd(50, W - 50); for (let i = 0; i < WEEK[k].n; i++) addCell(k, cx + rnd(-20, 20), H - 60 - rnd(0, 120)); });
  for (let i = 0; i < 400; i++) step(1 / 60, true);   // settle into a pool before it's shown
  WEEK.forEach((w, k) => colorize(k, w.d)); CELLS.forEach(c => c.col = c.on ? 1 : 0); if (STILL) draw();
}
function still() { for (let i = 0; i < 90; i++) step(1 / 60, true); CELLS.forEach(c => { c.col = c.on ? 1 : 0; c.pulse = 0; }); draw(); }
function removeCells(drop) { if (!drop.size) return; const map = []; let j = 0; CELLS = CELLS.filter((c, i) => { if (drop.has(i)) return false; map[i] = j++; return true; });
  P = P.filter(p => !drop.has(p.c)); P.forEach(p => p.c = map[p.c]); PLS = []; M.grab = null; }
const centre = k => { const mine = P.filter(p => p.k === k); return mine.length ? [mine.reduce((s, p) => s + p.x, 0) / mine.length, mine.reduce((s, p) => s + p.y, 0) / mine.length] : [rnd(50, W - 50), H - 60]; };

// hues closer than 32° get nudged apart, so similar course colours stay distinguishable; then each is set to the theme's lightness and chroma
function paint() { const k = LOOK[THEME], H0 = WEEK.map(w => oklch(w.color || '#888888')[2]);
  for (let it = 0; it < 40; it++) H0.forEach((a, i) => H0.forEach((b, j) => { if (i === j) return; const d = ((b - a + 540) % 360) - 180; if (Math.abs(d) < 32) { const p = (32 - Math.abs(d)) * .25 * Math.sign(d || 1); H0[i] = (H0[i] - p + 360) % 360; H0[j] = (H0[j] + p + 360) % 360; } }));
  PAL = H0.map(h => rgbOf(k.L, k.C, h)); GREY = rgbOf(k.gL, 0, 0); }

function setWeek(list) {
  list = (list || []).filter(x => x && x.c).map(x => ({ c: x.c, n: Math.max(0, x.n | 0), d: Math.max(0, Math.min(x.n | 0, x.d | 0)), color: x.color }));
  const N = list.reduce((s, x) => s + x.n, 0);
  if (!CELLS.length && !EMPTY || !BUILT || (N > 0) === EMPTY || N / BUILT < .6 || N / BUILT > 1.6) { WEEK = list; paint(); return build(); }
  // the same week, changed a little: add or take away cells, colour or un-colour them, and keep everything else where it is
  list.forEach(x => { if (!WEEK.some(w => w.c === x.c)) WEEK.push({ c: x.c, n: 0, d: 0 }); });
  const drop = new Set();
  WEEK.forEach((w, k) => { const x = list.find(y => y.c === w.c) || { n: 0, d: 0, color: w.color }; w.color = x.color;
    const mine = CELLS.map((c, i) => [c, i]).filter(([c]) => c.k === k);
    if (x.n > mine.length) { const [cx, cy] = centre(k); for (let i = mine.length; i < x.n; i++) addCell(k, cx + rnd(-8, 8), cy - 10); }
    if (x.n < mine.length) mine.sort((a, b) => (a[0].on - b[0].on) || (b[0].st - a[0].st)).slice(0, mine.length - x.n).forEach(([, i]) => drop.add(i));
    w.n = x.n; w.nd = x.d; });
  removeCells(drop); paint();
  WEEK.forEach((w, k) => { const was = CELLS.filter(c => c.k === k && c.on).length; colorize(k, w.nd); w.d = w.nd;
    if (w.nd > was && !STILL) { const c = CELLS.filter(c => c.k === k && c.on).sort((a, b) => b.st - a.st)[0]; if (c) { c.pulse = 1; P.forEach(p => { if (CELLS[p.c] === c) p.T = Math.min(1, p.T + .2); }); } } });
  if (STILL) still();
}

// pointer: hover nudges the wax; press grabs the cells under it and pulls them like taffy
const M = { x: -999, y: -999, vx: 0, vy: 0, in: false, grab: null };
const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
const near = (x, y, r) => P.filter(p => Math.hypot(p.x - x, p.y - y) < r);
cv.addEventListener('pointermove', e => { const [x, y] = pos(e); if (M.in) { M.vx = M.vx * .5 + (x - M.x) * .5; M.vy = M.vy * .5 + (y - M.y) * .5; } M.x = x; M.y = y; M.in = true; if (!M.grab) cv.style.cursor = !STILL && near(x, y, S).length ? 'grab' : ''; });
cv.addEventListener('pointerleave', () => { if (!M.grab) { M.in = false; M.x = M.y = -999; } });
cv.addEventListener('pointerdown', e => { if (STILL) return; const [x, y] = pos(e), hitc = new Set(near(x, y, S * 1.6).map(p => p.c)); if (!hitc.size) return;
  M.grab = P.filter(p => hitc.has(p.c)).map(p => ({ p, ox: p.x - x, oy: p.y - y })); cv.setPointerCapture(e.pointerId); cv.style.cursor = 'grabbing'; });
const drop = () => { if (M.grab) { M.grab.forEach(g => { g.p.vx = M.vx * 40; g.p.vy = M.vy * 40; }); M.grab = null; cv.style.cursor = 'grab'; } };
cv.addEventListener('pointerup', drop); cv.addEventListener('pointercancel', drop);

new ResizeObserver(fit).observe(cv); fit();
let last = performance.now();
function frame(now) { const dt = Math.min(.033, (now - last) / 1000); last = now;
  if (!STILL && W && !document.hidden && P.length) { TIME += dt; ENERGY *= Math.pow(.3, dt); step(dt / 2); step(dt / 2); draw(); M.vx *= .8; M.vy *= .8; }   // paused while hidden or still
  requestAnimationFrame(frame); }
requestAnimationFrame(frame);
return {
  setWeek,
  setTheme(t) { THEME = t === 'default' ? 'dark' : LOOK[t] ? t : 'dark'; paint(); if (STILL && W) draw(); },
  setStill(v) { v = !!v; if (v === STILL) return; STILL = v; M.grab = null; if (STILL && W) still(); },
  setCalm(v) { CALM = !!v; },
  kick(a) { if (!CALM) ENERGY = Math.min(1.5, ENERGY + Math.abs(a || 0)); },
};
}
window.Lamp = { create };
})();
