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
 *     pick: 'lowest',                 // bonus: added to the lowest graded target item instead
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
      var bump = function (t, add) { t.p = { earned: t.p.earned != null ? t.p.earned + add : null, possible: t.p.possible, pct: t.p.pct + (t.p.possible ? 100 * add / t.p.possible : add), graded: true }; b.notes.push('+' + fmt(add) + ' on ' + t.name); };
      if (b.rule.pick === 'lowest') {   // everything earned goes onto the lowest graded target item
        var all = b.graded.reduce(function (s, x) { return s + x.p.pct; }, 0), done = targets.filter(function (t) { return t.p.graded && !t.p.assumed; });
        if (isNum(b.rule.cap)) all = Math.min(all, b.rule.cap);
        if (!all) return;
        if (!done.length) { b.notes.push(fmt(all) + ' waiting for a graded ' + (b.rule.to || []).join('/')); return; }
        bump(done.reduce(function (a, c) { return c.p.pct < a.p.pct ? c : a; }), all); return;
      }
      targets.sort(function (x, y) { return x.due < y.due ? -1 : x.due > y.due ? 1 : 0; });
      var prev = '';
      targets.forEach(function (t) {
        var add = 0;
        b.graded.forEach(function (x) { if (x.due > prev && x.due <= t.due) add += x.p.pct; });
        prev = t.due;
        if (isNum(b.rule.cap)) add = Math.min(add, b.rule.cap);
        if (!add) return;
        if (t.p.graded) bump(t, add);
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

if (typeof module !== 'undefined') module.exports = Engine;
