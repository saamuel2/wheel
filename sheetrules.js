/* sheetrules.js — turns Rules-tab rows into engine rules in the browser (same code as Grades.gs, built from sheet-adapter.js). Needs engine.js first. */
var SheetRules = (function () {

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
  'from attendance': { kind: 'attendance' }
};

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
  var cutoffs = {}, values = {}, n = 0;
  s.split(/[,;]/).forEach(function (part) {
    var m = part.match(/(-?[\d.]+)\s*(?:→|->|=>|=|:|>)\s*(-?[\d.]+)/); if (!m) return;
    var key = 't' + (n++); cutoffs[key] = +m[1]; values[key] = +m[2];
  });
  if (!n) return null;
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

  return { fromSheet: rulesFromSheet_, COUNTED_AS: COUNTED_AS, LETTERS: LETTERS };
})();
