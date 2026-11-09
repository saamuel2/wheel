/** Grades.gs — grading engine + sheet functions. Paste into Extensions → Apps Script. */
/**
 * Grading engine (v2) — one engine for the sheet (custom functions) and the apps (API trace).
 * Pure functions, no Apps Script services: runs in Apps Script, the browser and Node.
 *
 * Course rule:
 * {
 *   code, method: 'points' | 'weighted',
 *   progressive: true,          // weighted: a category counts in proportion to how much of it is graded ("grade so far")
 *   cutoffs: { 'A+': 97, ... }, // lowest score per letter (on whatever scale the final value is on)
 *   scale: { 'A+': 4.333, ... },// letter → grade points (letters missing here, e.g. S/U, don't count toward GPA)
 *   entry: 'pct',               // how a bare number in the grade cell is read: 'pct' or points (default)
 *   round: 0,                   // round the final value to N decimals (half up) before the letter
 *   pool: { cats: ['EX','AS'], drop: 1 },  // drop the lowest unit(s) across several categories (after binning)
 *   categories: [{
 *     abbr, name, weight,
 *     kind: 'normal' | 'extra' | 'flat' | 'bonus' | 'catbonus' | 'extraitems' | 'attendance',
 *       flat: added to the final grade · bonus: added to target items · catbonus: added to a category's score
 *       extraitems: counted as more items in the 'to' category without raising its total (can pass 100%)
 *     within: 'average' | 'points',   // weighted: mean of item %s, or Σearned / Σpossible
 *     split: true,                    // weighted: every item is its own unit (own bin, own letter)
 *     drop: 1,                        // keep the best (count − drop); drops only once more than that are graded
 *     replace: { from: 'FI' },        // lowest item replaced by another category's % if higher
 *     bin: { cutoffs, values, curves },  // % → letter → value; curves: { 'exam 1': {A+:95,…} } per-item letter cutoffs
 *     assume: 100,                    // ungraded items count as this
 *     cap,                            // extra/flat: most it adds · bonus: most per target item
 *     to: ['EX','FI'],                // bonus: added to the target item due on/after the bonus (by due date)
 *     free: 3, per: 20                // attendance: free absences, % lost per absence after that
 *   }]
 * }
 * Item: { name, cls, type, due:'yyyy-mm-dd', grade, earned, possible }   grade may be 43, '43/50' or '86%'.
 * ctx (optional): { absences: { code: n } }
 */
var Engine = (function () {
  var DEFAULT_SCALE = { 'A+': 4.333, 'A': 4, 'A-': 3.667, 'B+': 3.333, 'B': 3, 'B-': 2.667, 'C+': 2.333, 'C': 2, 'C-': 1.667, 'D+': 1.333, 'D': 1, 'D-': 0.667, 'F': 0 };
  var STD_CUTOFFS = { 'A+': 97, 'A': 93, 'A-': 90, 'B+': 87, 'B': 83, 'B-': 80, 'C+': 77, 'C': 73, 'C-': 70, 'D+': 67, 'D': 63, 'D-': 60, 'F': 0 };

  var ADDON = { flat: 1, bonus: 1, catbonus: 1, extraitems: 1 };
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function r2(n) { return Math.round(n * 100) / 100; }
  function fmt(n) { return isNum(n) ? String(r2(n)) : '—'; }
  function roundHalfUp(n, d) { var f = Math.pow(10, d); return Math.floor(n * f + 0.5 + 1e-9) / f; }
  function norm(s) { return String(s == null ? '' : s).replace(/[‎‏]/g, '').trim().toLowerCase(); }

  function parseGrade(item, entry) {               // entry 'pct': a bare number is a percent; otherwise it's points earned
    var g = item.grade, earned = isNum(item.earned) ? item.earned : null, possible = isNum(item.possible) && item.possible > 0 ? item.possible : null;
    if (typeof g === 'string') {
      var s = g.trim(), m;
      if ((m = s.match(/^(-?[\d.]+)\s*\/\s*([\d.]+)$/))) { earned = +m[1]; possible = +m[2]; }
      else if ((m = s.match(/^(-?[\d.]+)\s*%$/))) return { earned: null, possible: null, pct: +m[1], graded: true };
      else if (s !== '' && isFinite(+s)) g = +s;
    }
    if (earned == null && isNum(g)) { if (entry === 'pct' && !possible) return { earned: null, possible: null, pct: g, graded: true }; earned = g; }
    if (earned == null) return { graded: false };
    return { earned: earned, possible: possible, pct: possible ? 100 * earned / possible : earned, graded: true };
  }

  function letterFor(value, cutoffs) {
    var best = null, bestCut = -Infinity;
    for (var k in cutoffs) if (isNum(cutoffs[k]) && value >= cutoffs[k] - 1e-9 && cutoffs[k] > bestCut) { best = k; bestCut = cutoffs[k]; }
    return best;
  }
  /** Cutoffs halfway between grade points — "nearest letter" for courses that average GPA points. */
  function midpointCutoffs(scale) {
    var L = Object.keys(scale).sort(function (a, b) { return scale[b] - scale[a]; }), out = {};
    for (var i = 0; i < L.length; i++) out[L[i]] = i === L.length - 1 ? -Infinity : (scale[L[i]] + scale[L[i + 1]]) / 2;
    return out;
  }

  function grade(rule, items, ctx) {
    ctx = ctx || {};
    var trace = [], cats = [], byAbbr = {};
    var mine = items.filter(function (it) { return norm(it.cls) === norm(rule.code); });

    rule.categories.forEach(function (c) {
      var kind = c.kind || (Number(c.weight) || c.to ? 'normal' : 'extra');
      var list = mine.filter(function (it) { return norm(it.type) === norm(c.abbr); }).map(function (it) {
        var p = parseGrade(it, c.entry || rule.entry);
        if (!p.graded && isNum(c.assume)) p = { earned: null, possible: null, pct: c.assume, graded: true, assumed: true };
        return { name: it.name, due: it.due || '', p: p };
      });
      if (kind === 'attendance') {
        var n = (ctx.absences && ctx.absences[norm(rule.code)]) || 0, lost = Math.max(0, n - (c.free || 0)) * (c.per || 0);
        list = [{ name: n + ' absence' + (n === 1 ? '' : 's'), due: '', p: { earned: null, possible: null, pct: Math.max(0, 100 - lost), graded: true } }];
      }
      var cat = { abbr: c.abbr, name: c.name || c.abbr, rule: c, kind: kind === 'attendance' ? 'normal' : kind, weight: Number(c.weight) || 0,
        count: list.length, items: list, graded: list.filter(function (x) { return x.p.graded; }), dropped: [], replaced: null, notes: [] };
      if (kind === 'attendance') cat.notes.push(list[0].name + ', ' + (c.free || 0) + ' free');
      if (isNum(c.expect) && c.expect > 0) cat.count = c.expect;   // "# items" fixes the denominator: items not entered yet still count, extras (alternates) don't dilute it
      cats.push(cat); byAbbr[norm(c.abbr)] = cat;
    });

    // bonus points ride on the next target item by due date (e.g. Mastering → the exam it prepares for)
    cats.filter(function (c) { return c.kind === 'bonus'; }).forEach(function (b) {
      var targets = [];
      (b.rule.to || []).forEach(function (a) { var t = byAbbr[norm(a)]; if (t) targets = targets.concat(t.items); });
      targets.sort(function (x, y) { return x.due < y.due ? -1 : x.due > y.due ? 1 : 0; });
      var prev = '';
      targets.forEach(function (t) {
        var add = 0;
        b.graded.forEach(function (x) { if (x.due > prev && x.due <= t.due) add += x.p.pct; });
        prev = t.due;
        if (isNum(b.rule.cap)) add = Math.min(add, b.rule.cap);
        if (!add) return;
        if (t.p.graded) { t.p = { earned: t.p.earned != null ? t.p.earned + add : null, possible: t.p.possible, pct: t.p.pct + (t.p.possible ? 100 * add / t.p.possible : add), graded: true }; b.notes.push('+' + fmt(add) + ' on ' + t.name); }
        else b.notes.push(fmt(add) + ' waiting for ' + t.name);
      });
    });

    cats.forEach(function (cat) {
      var rp = cat.rule.replace; if (!rp || !cat.graded.length) return;
      var src = byAbbr[norm(rp.from)], srcPct = src ? catPct(src) : null;
      if (!isNum(srcPct)) { cat.notes.push('replacement waits for ' + rp.from); return; }
      var low = lowest(cat.graded, 'p');
      if (srcPct > low.p.pct) {
        cat.replaced = { name: low.name, from: low.p.pct, to: srcPct };
        low.p = { earned: low.p.possible ? srcPct / 100 * low.p.possible : srcPct, possible: low.p.possible, pct: srcPct, graded: true };
        cat.notes.push('replaced ' + low.name + ' (' + fmt(cat.replaced.from) + '%) with ' + rp.from + ' (' + fmt(srcPct) + '%)');
      } else cat.notes.push('no replacement — ' + rp.from + ' isn’t higher than ' + low.name);
    });

    // keep the best (count − drop): only drop once more than that many are graded
    cats.forEach(function (cat) {
      var n = cat.rule.drop || 0; if (!n) return;
      var k = Math.max(0, Math.min(n, cat.graded.length - (cat.count - n)));
      for (var i = 0; i < k; i++) { var low = lowest(cat.graded, 'p'); cat.graded.splice(cat.graded.indexOf(low), 1); cat.dropped.push(low); cat.notes.push('dropped ' + low.name + ' (' + fmt(low.p.pct) + '%)'); }
      if (k < n) cat.notes.push('best ' + (cat.count - n) + ' of ' + cat.count + ' — lowest drops once ' + (cat.count - n + 1) + ' are graded');
      cat.count -= n;
    });

    // extra credit into a category: points on its score (catbonus) or extra items on top of its total (extraitems)
    cats.filter(function (c) { return c.kind === 'catbonus' || c.kind === 'extraitems'; }).forEach(function (b) {
      (b.rule.to || []).slice(0, 1).forEach(function (a) {
        var t = byAbbr[norm(a)]; if (!t || !b.graded.length) return;
        if (b.kind === 'extraitems') { t.extras = (t.extras || []).concat(b.graded); b.notes.push(b.graded.length + ' extra item(s) in ' + t.name); return; }
        var add = b.graded.reduce(function (s, x) { return s + x.p.pct; }, 0);
        if (isNum(b.rule.cap)) add = Math.min(add, b.rule.cap);
        t.bonus = (t.bonus || 0) + add; t.notes.push('+' + fmt(add) + ' from ' + b.name); b.notes.push('+' + fmt(add) + ' on ' + t.name);
      });
    });

    var value = rule.method === 'points' ? byPoints(rule, cats, trace) : byWeight(rule, cats, trace);

    cats.filter(function (c) { return c.kind === 'flat'; }).forEach(function (c) {
      var add = c.graded.reduce(function (s, x) { return s + x.p.pct; }, 0);
      if (isNum(c.rule.cap)) add = Math.min(add, c.rule.cap);
      if (add && isNum(value)) { value += add; trace.push(c.name + ': ' + (add > 0 ? '+' : '') + fmt(add) + ' → ' + fmt(value)); }
    });

    if (isNum(value) && isNum(rule.round)) { var rv = roundHalfUp(value, rule.round); if (rv !== value) trace.push('rounded ' + fmt(value) + ' → ' + rv); value = rv; }
    var cut = rule.cutoffs || STD_CUTOFFS, scale = rule.scale || DEFAULT_SCALE, letter = isNum(value) ? letterFor(value, cut) : null;
    var gp = letter && isNum(scale[letter]) ? scale[letter] : null;
    if (isNum(value)) trace.push('final ' + (rule.round != null ? value : fmt(value)) + ' → ' + (letter || 'below the lowest cutoff') + (gp != null ? ' (' + gp + ')' : letter ? ' (no GPA)' : ''));
    return { code: rule.code, value: value, letter: letter, gp: gp, cats: cats.map(summary), trace: trace };
  }

  function lowest(list, key) { return list.reduce(function (a, b) { return (key ? b[key].pct : b.v) < (key ? a[key].pct : a.v) ? b : a; }); }
  function catPct(cat) {
    var base = catBase(cat);
    return isNum(base) && cat.bonus ? base + cat.bonus : base;
  }
  function catBase(cat) {
    if (!cat.graded.length) return null;
    var ex = cat.extras || [];
    if (cat.rule.within === 'points') {
      var e = 0, p = 0, miss = 0;
      cat.graded.forEach(function (x) { if (x.p.possible) { e += x.p.earned; p += x.p.possible; } else miss++; });
      if (miss && cat.notes.indexOf(miss + ' graded item(s) have no possible points — left out') < 0) cat.notes.push(miss + ' graded item(s) have no possible points — left out');
      ex.forEach(function (x) { e += x.p.earned != null ? x.p.earned : (x.p.pct / 100) * (p / cat.graded.length); });
      return p ? 100 * e / p : null;
    }
    return cat.graded.concat(ex).reduce(function (s, x) { return s + x.p.pct; }, 0) / cat.graded.length;
  }
  function bin(cat, label, pct, trace) {
    var b = cat.rule.bin; if (!b || !isNum(pct)) return pct;
    var curve = b.curves && b.curves[norm(label)];                      // this item has its own curve (e.g. one per exam)
    var L = letterFor(pct, curve || b.cutoffs || STD_CUTOFFS), vals = b.values || DEFAULT_SCALE, v = L ? vals[L] : null;
    trace.push(label + ': ' + fmt(pct) + '%' + (curve ? ' (curved)' : '') + (L && /^t\d+$/.test(L) ? '' : ' → ' + (L || '?')) + ' → ' + fmt(v));
    return isNum(v) ? v : pct;
  }

  function byPoints(rule, cats, trace) {
    var earned = 0, possible = 0;
    cats.forEach(function (c) {
      if (ADDON[c.kind]) return;
      var each = c.count ? c.weight / c.count : 0, e = 0, p = 0;
      c.graded.forEach(function (x) {
        e += x.p.earned != null ? x.p.earned : x.p.pct / 100 * (x.p.possible || each);
        if (c.kind !== 'extra') p += x.p.possible || each;
      });
      (c.extras || []).forEach(function (x) { e += x.p.earned != null ? x.p.earned : x.p.pct / 100 * (x.p.possible || each); });
      if (c.bonus && p) e += c.bonus / 100 * p;
      c.pct = p ? 100 * e / p : null;
      if (c.rule.bin && p) e = bin(c, c.name, c.pct, trace) / 100 * p;
      if (c.kind === 'extra' && isNum(c.rule.cap)) e = Math.min(e, c.rule.cap);
      c.earned = e; c.possible = p; earned += e; possible += p;
      if (c.graded.length) trace.push(c.name + ': ' + fmt(e) + (c.kind === 'extra' ? ' extra points' : ' / ' + fmt(p) + ' pts') + (c.notes.length ? ' (' + c.notes.join('; ') + ')' : ''));
    });
    if (!possible) return null;
    trace.push('total ' + fmt(earned) + ' / ' + fmt(possible) + ' = ' + fmt(100 * earned / possible) + '%');
    return 100 * earned / possible;
  }

  function byWeight(rule, cats, trace) {
    var prog = rule.progressive !== false, units = [];
    cats.forEach(function (c) {
      if (ADDON[c.kind]) return;
      c.pct = catPct(c);
      if (c.kind === 'extra') return;
      if (c.rule.split) {
        c.graded.forEach(function (x) { units.push({ cat: c, name: x.name, w: c.count ? c.weight / c.count : 0, v: bin(c, x.name, x.p.pct, trace) }); });
      } else if (isNum(c.pct)) {
        units.push({ cat: c, name: c.name, w: prog ? (c.count ? c.weight * Math.min(c.graded.length / c.count, 1) : 0) : c.weight, v: bin(c, c.name, c.pct, trace) });
      }
    });
    var pool = rule.pool;
    if (pool) {
      var inPool = units.filter(function (u) { return pool.cats.map(norm).indexOf(norm(u.cat.abbr)) > -1; });
      var expected = 0; pool.cats.forEach(function (a) { var c = cats.filter(function (x) { return norm(x.abbr) === norm(a); })[0]; if (c) expected += c.rule.split ? c.count : 1; });
      // a whole category only counts as finished once all of its items are graded, so nothing drops early
      var done = inPool.filter(function (u) { return u.cat.rule.split || u.cat.graded.length >= u.cat.count; }).length;
      var k = Math.max(0, Math.min(pool.drop, done - (expected - pool.drop)));
      for (var i = 0; i < k; i++) { var low = lowest(inPool); inPool.splice(inPool.indexOf(low), 1); units.splice(units.indexOf(low), 1); trace.push('dropped lowest: ' + low.name + ' (' + fmt(low.v) + ')'); }
      if (k < pool.drop) trace.push('lowest of ' + pool.cats.join('/') + ' drops once all ' + expected + ' are graded (' + done + ' so far)');
    }
    var sum = 0, wsum = 0;
    units.forEach(function (u) { sum += u.w * u.v; wsum += u.w; u.cat.used = (u.cat.used || 0) + u.w;
      trace.push(u.name + ': ' + fmt(u.v) + (u.cat.rule.bin ? '' : '%') + ' × ' + fmt(u.w) + (u.cat.notes.length && u.name === u.cat.name ? ' (' + u.cat.notes.join('; ') + ')' : '')); });
    cats.forEach(function (c) { if (c.kind === 'bonus' && c.notes.length) trace.push(c.name + ': ' + c.notes.join('; ')); if (c.rule.split && c.notes.length) trace.push(c.name + ': ' + c.notes.join('; ')); });
    if (!wsum) return null;
    trace.push('weighted average = ' + fmt(sum / wsum));
    return sum / wsum;
  }

  function summary(c) {
    return { abbr: c.abbr, name: c.name, kind: c.kind, weight: c.weight, count: c.count, graded: c.graded.length,
      pct: isNum(c.pct) ? r2(c.pct) : null, used: c.used, dropped: c.dropped.map(function (x) { return x.name; }), replaced: c.replaced, notes: c.notes };
  }

  function gpa(list) {
    var pts = 0, cr = 0;
    list.forEach(function (c) { if (isNum(c.gp) && c.credits > 0) { pts += c.gp * c.credits; cr += c.credits; } });
    return cr ? pts / cr : null;
  }

  return { grade: grade, gpa: gpa, parseGrade: parseGrade, letterFor: letterFor, midpointCutoffs: midpointCutoffs, DEFAULT_SCALE: DEFAULT_SCALE, STD_CUTOFFS: STD_CUTOFFS };
})();


// ===================================================================================
// Sheet functions. Rules live on the Rules tab; nothing here needs editing per semester.
//
//   =GRADES(Rules!A4:T13, Rules!A17:N, Assignments!B3:G, Attendance!A2:Z)
//       → one row per course: course | grade | letter | grade points
//   =GRADETRACE("bch351", Rules!A4:T13, Rules!A17:N, Assignments!B3:G, Attendance!A2:Z)
//       → the step-by-step calculation, one line per row
//
// Passing the ranges in (instead of reading them inside) is what makes Sheets recalculate
// whenever an assignment, rule or absence changes.
// ===================================================================================

var LETTERS = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-'];
var COUNTED_AS = {
  'category average': {}, '': {},
  'points total': { within: 'points' },
  'each item separately': { split: true },
  'extra credit': { kind: 'extra' },
  'bonus on another item': { kind: 'bonus' },
  'added to final': { kind: 'flat' },
  'from attendance': { kind: 'attendance' },
  // grades tab names
  'average': {}, 'points': { within: 'points' }, 'each own share': { split: true }, 'attendance': { kind: 'attendance' },
  'extra → final grade': { kind: 'flat' }, 'extra → category': { kind: 'catbonus' },
  'extra → items': { kind: 'bonus' }, 'extra → extra items': { kind: 'extraitems' }
};
var COMBINE = ['average', 'points', 'each own share', 'attendance', 'extra → final grade', 'extra → category', 'extra → items', 'extra → extra items'];

/**
 * Course grades from the Rules tab.
 * @param {A4:T13} courses Rules tab course table
 * @param {A17:N} categories Rules tab category table
 * @param {B3:G} assignments Assignments tab, due through the "out of" column G
 * @param {A2:Z} attendance Attendance tab rows
 * @return course | grade | letter | grade points
 * @customfunction
 */
function GRADES(courses, categories, assignments, attendance) {
  var rules = rulesFromSheet_(courses, categories), items = itemsFromSheet_(assignments), ctx = { absences: absencesFromSheet_(attendance) };
  var out = [['course', 'grade', 'letter', 'grade points']];
  rules.forEach(function (r) {
    var g = Engine.grade(r, items, ctx);
    out.push([r.code, g.value == null ? '' : g.value, g.letter || '', g.gp == null ? '' : g.gp]);
  });
  return out;
}

/**
 * How one course grade was calculated, step by step.
 * @param {"bch351"} code course code
 * @return one step per row
 * @customfunction
 */
function GRADETRACE(code, courses, categories, assignments, attendance) {
  var rules = rulesFromSheet_(courses, categories), items = itemsFromSheet_(assignments);
  var r = rules.filter(function (x) { return x.code === clean_(code).toLowerCase(); })[0];
  if (!r) return [['no rules for ' + code]];
  var g = Engine.grade(r, items, { absences: absencesFromSheet_(attendance) });
  return g.trace.length ? g.trace.map(function (t) { return [t]; }) : [['nothing graded yet']];
}

/**
 * Term GPA from letter-graded courses only (pass/fail and ungraded courses are left out).
 * @param {N2:N11} points grade points per course
 * @param {D2:D11} credits credit hours per course
 * @customfunction
 */
function GRADEPOINTS(points, credits) {
  var p = 0, c = 0;
  for (var i = 0; i < points.length; i++) {
    var gp = points[i][0], cr = Number(credits[i][0]);
    if (typeof gp === 'number' && cr > 0) { p += gp * cr; c += cr; }
  }
  return c ? p / c : '';
}

function clean_(v) { return String(v == null ? '' : v).replace(/[‎‏]/g, '').trim(); }
function num_(v) { return v === '' || v == null || isNaN(Number(v)) ? null : Number(v); }

function rulesFromSheet_(courses, categories) {
  var list = [];
  courses.forEach(function (row) {
    var code = clean_(row[0]).toLowerCase(); if (!code) return;
    var method = clean_(row[1]).toLowerCase() || 'weighted', bare = clean_(row[2]).toLowerCase(), from = clean_(row[3]).toLowerCase();
    var cut = {}; LETTERS.forEach(function (L, i) { var v = num_(row[8 + i]); if (v != null) cut[L] = v; });
    if (!Object.keys(cut).length) cut = JSON.parse(JSON.stringify(Engine.STD_CUTOFFS));
    cut.F = -Infinity;
    var gradePoints = from.indexOf('grade point') > -1, pass = num_(row[5]);
    var r = { code: code, method: method.indexOf('point') > -1 ? 'points' : 'weighted', entry: bare.indexOf('percent') > -1 ? 'pct' : 'points',
      progressive: !gradePoints, categories: [] };
    if (num_(row[4]) != null) r.round = num_(row[4]);
    if (pass != null) { r.cutoffs = { S: pass, U: -Infinity }; r.scale = {}; }
    else if (gradePoints) { r.cutoffs = Engine.midpointCutoffs(Engine.DEFAULT_SCALE); if (r.round == null) r.round = 4; r.binCutoffs = cut; }
    else r.cutoffs = cut;
    var across = clean_(row[6]);
    if (across) r.pool = { cats: across.split(/[,\s]+/).filter(String), drop: num_(row[7]) || 1 };
    list.push(r);
  });
  categories.forEach(function (row) {
    var code = clean_(row[0]).toLowerCase(), abbr = clean_(row[2]);
    var r = list.filter(function (x) { return x.code === code; })[0];
    if (!r || !abbr) return;
    var c = { abbr: abbr, name: clean_(row[1]) || abbr, weight: num_(row[3]) || 0 }, how = COUNTED_AS[clean_(row[6]).toLowerCase()] || {};
    for (var k in how) c[k] = how[k];
    if (num_(row[4]) != null) c.expect = num_(row[4]);
    if (num_(row[5]) != null) c.drop = num_(row[5]);
    var curves = parseCurves_(row[7]), bins = curves ? null : parseBins_(row[7]);
    if (bins) c.bin = bins;
    else if (r.binCutoffs && !c.kind) c.bin = { cutoffs: r.binCutoffs };
    if (curves) { if (!c.bin) c.bin = { cutoffs: r.binCutoffs || JSON.parse(JSON.stringify(Engine.STD_CUTOFFS)) }; c.bin.curves = curves; }
    var to = clean_(row[8]); if (to) c.to = to.split(/[,\s]+/).filter(String);
    if (num_(row[9]) != null) c.cap = num_(row[9]);
    if (num_(row[10]) != null) c.assume = num_(row[10]);
    if (num_(row[11]) != null) c.free = num_(row[11]);
    if (num_(row[12]) != null) c.per = num_(row[12]);
    var rep = clean_(row[13]); if (rep) c.replace = { from: rep };
    if (c.kind === 'bonus' && !c.to) c.kind = 'extra';
    r.categories.push(c);
  });
  return list.filter(function (r) { return r.categories.length; });
}

// Per-item curves: "Exam 1: 95, 90, 85, …; Exam 2: 96, 92, 88, …" — the A+ … D- cutoffs for that item (by name).
// Items not listed use the course's cutoffs. Fewer than 12 numbers is fine (the rest are left out).
function parseCurves_(text) {
  var s = clean_(text); if (!/[A-Za-z][^:;]*:\s*\d/.test(s)) return null;
  var out = {}, n = 0;
  s.split(';').forEach(function (part) {
    var lm = part.match(/^\s*([^:]*[A-Za-z][^:]*):\s*(.*\d.*=\s*[A-DFS][+-]?.*)$/i);
    if (lm) {                                                    // "Exam 1: 95+ = A+, 90+ = A, …"
      var lc = {}, pr = /(-?[\d.]+)\s*\+?\s*=\s*([A-DFS][+-]?)/gi, q;
      while ((q = pr.exec(lm[2]))) lc[q[2].toUpperCase()] = +q[1];
      lc.F = -Infinity; out[clean_(lm[1]).toLowerCase()] = lc; n++; return;
    }
    var m = part.match(/^\s*([^:]*[A-Za-z][^:]*):\s*([\d.,\s]+)$/); if (!m) return;
    var nums = m[2].split(/[,\s]+/).filter(String).map(Number), cut = {};
    LETTERS.forEach(function (L, i) { if (isFinite(nums[i])) cut[L] = nums[i]; });
    cut.F = -Infinity; out[clean_(m[1]).toLowerCase()] = cut; n++;
  });
  return n ? out : null;
}

// "90→100, 80→66.7, 70→33.3, 0→0" (→, =, : or > all work): score at or above the left number counts as the right number
function parseBins_(text) {
  var s = clean_(text); if (!s) return null;
  var cutoffs = {}, values = {}, n = 0, plus = /\d\s*\+/.test(s);
  s.split(/[,;]/).forEach(function (part) {
    var m = part.match(/(-?[\d.]+)\s*\+?\s*(?:→|->|=>|=|:|>)\s*(-?[\d.]+)/); if (!m) return;
    var key = 't' + (n++); cutoffs[key] = +m[1]; values[key] = +m[2];
  });
  if (!n) return null;
  if (plus) {                                     // "60+ = 100": below the lowest step counts 0
    var lo = Math.min.apply(null, Object.keys(cutoffs).map(function (k) { return cutoffs[k]; }));
    if (lo > 0) { cutoffs['t' + n] = -Infinity; values['t' + n] = 0; }
    return { cutoffs: cutoffs, values: values };
  }
  var low = Object.keys(cutoffs).reduce(function (a, b) { return cutoffs[b] < cutoffs[a] ? b : a; });
  cutoffs[low] = -Infinity;                       // the lowest tier catches everything below it
  return { cutoffs: cutoffs, values: values };
}

function itemsFromSheet_(rows) {
  var tz = 'America/New_York';
  try { tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(); } catch (e) {}
  var out = [];
  rows.forEach(function (r) {
    var name = clean_(r[1]); if (!name || name.indexOf('────') > -1) return;
    var d = r[0], due = '';
    if (Object.prototype.toString.call(d) === '[object Date]' && !isNaN(d)) due = typeof Utilities !== 'undefined' ? Utilities.formatDate(d, tz, 'yyyy-MM-dd') : d.toISOString().slice(0, 10);
    else if (/^\d{4}-\d\d-\d\d$/.test(clean_(d))) due = clean_(d);
    var g = r[4];
    out.push({ name: name, cls: clean_(r[2]), type: clean_(r[3]), due: due, grade: g === '' ? null : g, possible: num_(r.length > 10 ? r[10] : r[5]) });   // "out of" is column G (B3:G); an older B3:L range still works
  });
  return out;
}

function absencesFromSheet_(rows) {
  var out = {};
  (rows || []).forEach(function (r) {
    var code = clean_(r[0]).toLowerCase(); if (!code) return;
    var n = 0; for (var c = 2; c < r.length; c++) if (r[c] !== '' && r[c] != null) n++;
    out[code] = n;
  });
  return out;
}

// ===================================================================================
// The grades tab: one block per course, rules and results together.
//
//   B1:  =GRADEBLOCKS(A1:A, D1:K, Assignments!B3:G, Attendance!A2:Z, Config!A2:D12)
//        fills B:C — term GPA on row 1, % and letter on each course line, score and graded count on each category
//   N2:  =BLOCKTRACE(N1, A1:A, D1:K, Assignments!B3:G, Attendance!A2:Z)
//
// A block: a course line (A = code; D… = "grade by: weights", "entered as: percent", "cutoffs: A+ 97, A 93, …", …),
// a label line (A = "category"), then one line per category. A blank A ends the block.
// Category columns D…K: type | weight | items | combine by | drop | score map | until graded | other
// "other" holds "to: EX, FI; up to: 10; replaced by: FI; free absences: 3; per absence: 20" as needed.
// ===================================================================================
var BLOCK_LABELS = ['category', 'score', 'graded', 'type', 'weight', 'items', 'combine by', 'drop', 'score map', 'until graded', 'other'];

function kv_(text) {                                  // "to: EX, FI; up to: 10" → { 'to': 'EX, FI', 'up to': '10' }
  var o = {};
  clean_(text).split(';').forEach(function (p) { var m = p.match(/^\s*([^:]+):\s*(.*)$/); if (m) o[m[1].trim().toLowerCase()] = m[2].trim(); });
  return o;
}
function parseCutoffs_(text) {                        // "A+ 97, A 93, A- 90" (or 12 bare numbers A+ … D-)
  var s = clean_(text), out = {}, re = /([A-DFS][+-]?)\s*(?:=|:)?\s*(-?[\d.]+)/gi, m, n = 0;
  while ((m = re.exec(s))) { out[m[1].toUpperCase()] = +m[2]; n++; }
  if (!n) { s.split(/[,\s]+/).filter(String).forEach(function (v, i) { if (i < 12 && isFinite(+v)) { out[LETTERS[i]] = +v; n++; } }); }
  return n ? out : null;
}

/** Read the grades tab into blocks: [{ code, row, head:{…}, cats:[{ row, name, type, weight, items, combine, drop, map, until, other }] }] (rows are 1-based) */
function blocksFromSheet_(colA, cols) {
  var out = [], cur = null;
  for (var i = 0; i < colA.length; i++) {
    var a = clean_(colA[i][0]), r = cols[i] || [];
    var head = {}; r.forEach(function (v) { var m = clean_(v).match(/^([a-z ]+):\s*(.*)$/i); if (m) head[m[1].trim().toLowerCase()] = m[2].trim(); });
    if (a && head['grade by'] != null) { cur = { code: a.toLowerCase(), row: i + 1, head: head, cats: [] }; out.push(cur); continue; }
    if (!a) { cur = null; continue; }
    if (!cur || a.toLowerCase() === 'category') continue;
    cur.cats.push({ row: i + 1, name: a.replace(/^\+\s*/, ''), type: clean_(r[0]), weight: r[1], items: r[2], combine: clean_(r[3]).toLowerCase(),
      drop: r[4], map: clean_(r[5]), until: r[6], other: clean_(r[7]) });
  }
  return out;
}

/** Blocks → the two Rules-tab tables, so one parser (rulesFromSheet_) serves both layouts. */
function tablesFromBlocks_(blocks) {
  var courses = [], cats = [];
  blocks.forEach(function (b) {
    var h = b.head, cut = parseCutoffs_(h['cutoffs']) || {};
    var across = clean_(h['drop lowest across']), am = across.match(/^(\d+)\s*of\s*(.+)$/i);
    var row = [b.code, /point/i.test(h['grade by'] || '') ? 'points' : 'weighted', /point/i.test(h['entered as'] || '') ? 'points' : 'percent',
      /grade point/i.test(h['final from'] || '') ? 'grade points' : 'percent', h['round to'] != null ? h['round to'] : '', h['pass at'] != null ? h['pass at'] : '',
      am ? am[2] : across, am ? +am[1] : (across ? 1 : '')];
    LETTERS.forEach(function (L) { row.push(cut[L] != null ? cut[L] : ''); });
    courses.push(row);
    b.cats.forEach(function (c) {
      var o = kv_(c.other);
      cats.push([b.code, c.name, c.type, c.weight, c.items, c.drop, c.combine || 'average', c.map, o['to'] || '', o['up to'] || '', c.until,
        o['free absences'] || '', o['per absence'] || '', o['replaced by'] || '']);
    });
  });
  return { courses: courses, cats: cats };
}
function rulesFromBlocks_(colA, cols) { var t = tablesFromBlocks_(blocksFromSheet_(colA, cols)); return rulesFromSheet_(t.courses, t.cats); }

/**
 * Fills B:C of the grades tab.
 * @param {A1:A} colA column A of the grades tab
 * @param {D1:K} cols columns D:K of the grades tab
 * @param {B3:G} assignments Assignments tab
 * @param {A2:Z} attendance Attendance tab
 * @param {A2:D12} config Config tab (code … credits in D)
 * @customfunction
 */
function GRADEBLOCKS(colA, cols, assignments, attendance, config) {
  var blocks = blocksFromSheet_(colA, cols), t = tablesFromBlocks_(blocks), rules = rulesFromSheet_(t.courses, t.cats);
  var items = itemsFromSheet_(assignments), ctx = { absences: absencesFromSheet_(attendance) };
  var out = colA.map(function () { return ['', '']; }), credits = {};
  (config || []).forEach(function (r) { var c = clean_(r[0]).toLowerCase(); if (c) credits[c] = Number(r[3]) || 0; });
  var gpaList = [];
  blocks.forEach(function (b) {
    var rule = rules.filter(function (r) { return r.code === b.code; })[0]; if (!rule) return;
    var g = Engine.grade(rule, items, ctx);
    out[b.row - 1] = [g.value == null ? '–' : Math.round(g.value * 100) / 100, g.letter || '–'];
    if (out[b.row]) { var lab = clean_(colA[b.row] && colA[b.row][0]).toLowerCase(); if (lab === 'category') out[b.row] = ['score', 'graded']; }
    gpaList.push({ gp: g.gp, credits: credits[b.code] || 0 });
    b.cats.forEach(function (c) {
      var s = g.cats.filter(function (x) { return clean_(x.abbr).toLowerCase() === c.type.toLowerCase(); })[0]; if (!s) return;
      var addon = ADDON_KINDS_[s.kind], n = s.graded + s.dropped.length, of = num_(c.items);
      var sc = addon ? (s.kind === 'extraitems' ? (s.notes.join('; ') || '–') : sumPct_(rule, s, items)) : (s.pct == null ? '–' : s.pct);
      out[c.row - 1] = [sc, of ? n + ' of ' + of : n];
    });
  });
  var gpa = Engine.gpa(gpaList);
  out[0] = [gpa == null ? '' : gpa, out[0][1] || ''];
  return out;
}
var ADDON_KINDS_ = { flat: 1, bonus: 1, catbonus: 1, extraitems: 1 };
function sumPct_(rule, s, items) {                    // what an add-on row is adding, as "+2"
  var add = 0, hit = false; s.notes.join('; ').replace(/\+(-?[\d.]+)/g, function (_, v) { add += +v; hit = true; });
  if (hit) return '+' + Math.round(add * 100) / 100;
  var tot = 0; items.forEach(function (it) { if (clean_(it.cls).toLowerCase() === rule.code && clean_(it.type).toLowerCase() === s.abbr.toLowerCase()) { var p = Engine.parseGrade(it, rule.entry); if (p.graded) tot += p.pct; } });
  return tot ? '+' + Math.round(tot * 100) / 100 : '–';
}

/**
 * How one course grade was calculated, from the grades tab.
 * @customfunction
 */
function BLOCKTRACE(code, colA, cols, assignments, attendance) {
  var rules = rulesFromBlocks_(colA, cols), items = itemsFromSheet_(assignments);
  var r = rules.filter(function (x) { return x.code === clean_(code).toLowerCase(); })[0];
  if (!r) return [['no block for ' + code]];
  var g = Engine.grade(r, items, { absences: absencesFromSheet_(attendance) });
  return g.trace.length ? g.trace.map(function (t) { return [t]; }) : [['nothing graded yet']];
}

/** One course's block as sheet rows (A + D:K; B:C left to the formula). Inverse of blocksFromSheet_. */
function blockRows_(b) {
  var h = b.head, headCells = [];
  ['grade by', 'entered as', 'final from', 'round to', 'pass at', 'drop lowest across', 'cutoffs'].forEach(function (k) {
    if (h[k] != null && clean_(h[k]) !== '') headCells.push(k + ': ' + clean_(h[k]));
  });
  while (headCells.length < 8) headCells.push('');
  var rows = [[b.code].concat(headCells.slice(0, 8))], lab = BLOCK_LABELS.slice(3);
  rows.push(['category'].concat(lab));
  b.cats.forEach(function (c) {
    var extra = /^extra/.test(c.combine || '');
    rows.push([c.name, c.type, c.weight, c.items, c.combine || 'average', c.drop, c.map, c.until, c.other]);
  });
  return rows;
}
