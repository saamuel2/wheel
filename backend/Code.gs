/**
 * Assignment Tracker — app backend (v3)
 * Serves both apps (app.html on the phone, desktop.html on the computer).
 * Needs Grades.gs (the grading engine) in the same Apps Script project.
 *
 * The connection key is kept in Script Properties (Project Settings → Script properties → TOKEN),
 * so this file can live in the public GitHub repo without exposing it.
 */

// ====== SETTINGS ======
var SHEET_ID   = '1qtYm2XQwOKEK4u-cE_PcxbEWTcJYpa8EZ-6ceO_hwJ0';
var CAL_ID     = 'sjstrimp@ncsu.edu';      // calendar shown in "next up"
var TZ         = 'America/New_York';
var EVENT_DAYS = 14;                       // how far ahead "next up" looks
// ======================

function token_() { return PropertiesService.getScriptProperties().getProperty('TOKEN') || ''; }

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (!token_() || p.token !== token_()) return out_({ error: 'bad token' });
  var ss = SpreadsheetApp.openById(SHEET_ID), res = { v: 3 }, errors = {};
  try { res.assignments = readAssignments_(ss); } catch (err) { return out_({ error: 'assignments: ' + err }); }
  try { res.courses = readCourseList_(ss); } catch (err) { res.courses = []; errors.courses = String(err); }
  try { res.grades = readGrades_(ss); } catch (err) { errors.grades = String(err); }
  try { res.attendance = readAttendance_(ss); } catch (err) { errors.attendance = String(err); }
  try { res.weeks = readWeeks_(ss); } catch (err) { errors.weeks = String(err); }
  try { res.ra = readRA_(ss); } catch (err) { errors.ra = String(err); }
  try { res.events = readEvents_(); } catch (err) { errors.events = String(err); }
  res.errors = errors;
  return out_(res);
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var b = JSON.parse(e.postData.contents);
    if (!token_() || b.token !== token_()) return out_({ ok: false, error: 'bad token' });
    var ss = SpreadsheetApp.openById(SHEET_ID);
    switch (b.action) {
      case 'done':   return out_(setDone_(ss, b, true));
      case 'undone': return out_(setDone_(ss, b, false));
      case 'edit':   return out_(editRow_(ss, b));
      case 'add':    return out_(addRow_(ss, b));
      case 'add_many': return out_(addMany_(ss, b));
      case 'absence_add':    return out_(absenceAdd_(ss, b));
      case 'absence_remove': return out_(absenceRemove_(ss, b));
      case 'ra_done': return out_(raDone_(ss, b));
      case 'note_add': return out_(noteAdd_(ss, b));
      default: return out_({ ok: false, error: 'unknown action' });
    }
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function str_(v) { return String(v == null ? '' : v).replace(/[\u200e\u200f]/g, '').trim(); }
function numv_(v) { return (typeof v === 'number' && isFinite(v)) ? v : null; }

// ---------- dates ----------
function ymd_(d, ss) { return Utilities.formatDate(d, ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd'); }
function ymdToMs_(s) { return Utilities.parseDate(s, TZ, 'yyyy-MM-dd').getTime(); }
function ymdToCell_(s, ss) { return Utilities.parseDate(s, ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd'); }
function cellYmd_(v, ss) {
  if (v instanceof Date) return ymd_(v, ss);
  var m = String(v == null ? '' : v).match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (!m) return '';
  var y = m[3] ? +m[3] : +Utilities.formatDate(new Date(), TZ, 'yyyy'); if (y < 100) y += 2000;
  return y + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
}

// ---------- assignments (Assignments rows from 3; A done, B due, C name, D class, E type, F grade, G out of) ----------
function readAssignments_(ss) {
  var sh = ss.getSheetByName('Assignments'), last = sh.getLastRow(), list = [];
  if (last < 3) return list;
  var v = sh.getRange(3, 1, last - 2, 7).getValues();
  for (var i = 0; i < v.length; i++) {
    var name = str_(v[i][2]);
    if (!name || name.indexOf('────') > -1) continue;
    var dy = cellYmd_(v[i][1], ss); if (!dy) continue;
    var g = v[i][5];
    list.push({ r: i + 3, n: name, c: str_(v[i][3]), y: str_(v[i][4]), t: ymdToMs_(dy), d: v[i][0] === true,
      g: numv_(g) != null ? g : (str_(g) === '' ? '' : str_(g)), o: numv_(v[i][6]) });
  }
  return list;
}

// week divider rows: "──── end of week N ────" with the food-budget target in the type column
function readWeeks_(ss) {
  var sh = ss.getSheetByName('Assignments'), last = sh.getLastRow(), out = [];
  if (last < 3) return out;
  var v = sh.getRange(3, 1, last - 2, 5).getValues();
  for (var i = 0; i < v.length; i++) {
    var name = str_(v[i][2]); if (name.indexOf('────') < 0) continue;
    var dy = cellYmd_(v[i][1], ss); if (!dy) continue;
    out.push({ t: ymdToMs_(dy), label: name.replace(/─/g, '').trim(), budget: numv_(v[i][4]) });
  }
  return out.sort(function (a, b) { return a.t - b.t; });
}

function readCourseList_(ss) {
  var v = ss.getSheetByName('Config').getRange(2, 1, 10, 4).getValues(), out = [];
  for (var i = 0; i < v.length; i++) if (str_(v[i][0]) && Number(v[i][3]) > 0) out.push(str_(v[i][0]) + ' ' + str_(v[i][1]));
  return out;
}

function lastContentRow_(sh) {
  var last = sh.getLastRow(); if (last < 3) return 2;
  var v = sh.getRange(3, 1, last - 2, 6).getValues();
  for (var i = v.length - 1; i >= 0; i--) for (var c = 0; c < 6; c++) if (v[i][c] !== '' && v[i][c] != null) return i + 3;
  return 2;
}

function locate_(sh, row, match) {
  var last = sh.getLastRow();
  if (row >= 3 && row <= last) {
    var v = sh.getRange(row, 3, 1, 2).getValues()[0];
    if (!match || (str_(v[0]) === str_(match.n) && str_(v[1]) === str_(match.c))) return row;
  }
  if (match && last >= 3) {
    var all = sh.getRange(3, 3, last - 2, 2).getValues();
    for (var i = 0; i < all.length; i++) if (str_(all[i][0]) === str_(match.n) && str_(all[i][1]) === str_(match.c)) return i + 3;
  }
  return -1;
}

function setDone_(ss, b, val) {
  var sh = ss.getSheetByName('Assignments'), r = locate_(sh, Number(b.row), { n: b.n, c: b.c });
  if (r < 0) return { ok: false, error: 'assignment not found' };
  sh.getRange(r, 1).setValue(val);
  return { ok: true, row: r };
}

function cellVal_(g) {   // keep "43/50" and "86%" as typed; plain numbers as numbers
  if (g === '' || g == null) return '';
  var s = String(g).trim();
  return (s !== '' && !isNaN(Number(s))) ? Number(s) : s;
}

function writeFields_(sh, r, f, ss) {
  if (f.done !== undefined) sh.getRange(r, 1).setValue(!!f.done);
  if (f.due) sh.getRange(r, 2).setValue(ymdToCell_(f.due, ss));
  if (f.name !== undefined) sh.getRange(r, 3).setValue(f.name);
  if (f.className !== undefined) sh.getRange(r, 4).setValue(f.className);
  if (f.type !== undefined) sh.getRange(r, 5).setValue(f.type);
  if (f.grade !== undefined) { var g = cellVal_(f.grade), cell = sh.getRange(r, 6); if (g === '') cell.clearContent(); else cell.setValue(g); }
  if (f.outOf !== undefined) { var o = cellVal_(f.outOf), oc = sh.getRange(r, 7); if (o === '') oc.clearContent(); else oc.setValue(o); }
}

function editRow_(ss, b) {
  var sh = ss.getSheetByName('Assignments'), r = locate_(sh, Number(b.row), b.match);
  if (r < 0) return { ok: false, error: 'assignment not found' };
  writeFields_(sh, r, b.fields || {}, ss);
  return { ok: true, row: r };
}

function addRow_(ss, b) {
  var sh = ss.getSheetByName('Assignments'), r = lastContentRow_(sh) + 1, f = b.fields || {};
  if (!f.name || !f.className || !f.due) return { ok: false, error: 'missing fields' };
  sh.getRange(r, 2).setNumberFormat('ddd" "m"/"d');
  writeFields_(sh, r, { done: !!f.done, due: f.due, name: f.name, className: f.className, type: f.type || '', grade: f.grade, outOf: f.outOf }, ss);
  return { ok: true, row: r };
}

// several assignments at once (pasted from Moodle); each { name, className, type, due, outOf }
function addMany_(ss, b) {
  var rows = (b.rows || []).filter(function (f) { return f && f.name && f.className && f.due; });
  if (!rows.length) return { ok: false, error: 'nothing to add' };
  var sh = ss.getSheetByName('Assignments'), r0 = lastContentRow_(sh) + 1;
  var vals = rows.map(function (f) {
    return [false, ymdToCell_(f.due, ss), f.name, f.className, f.type || '', cellVal_(f.grade), cellVal_(f.outOf)];
  });
  sh.getRange(r0, 1, vals.length, 7).setValues(vals);
  sh.getRange(r0, 2, vals.length, 1).setNumberFormat('ddd" "m"/"d');
  return { ok: true, row: r0, added: vals.length };
}

// ---------- RA tab (A done, B task, C due, D notes) ----------
function readRA_(ss) {
  var sh = ss.getSheetByName('RA'); if (!sh) return null;
  var last = sh.getLastRow(); if (last < 2) return [];
  var v = sh.getRange(2, 1, last - 1, 4).getValues(), out = [];
  for (var i = 0; i < v.length; i++) {
    var task = str_(v[i][1]); if (!task) continue;
    var due = v[i][2] instanceof Date ? ymd_(v[i][2], ss) : str_(v[i][2]);
    out.push({ r: i + 2, n: task, due: due, t: /^\d{4}-\d\d-\d\d$/.test(due) ? ymdToMs_(due) : (cellYmd_(due, ss) ? ymdToMs_(cellYmd_(due, ss)) : null), d: v[i][0] === true, note: str_(v[i][3]) });
  }
  return out;
}
function raDone_(ss, b) {
  var sh = ss.getSheetByName('RA'); if (!sh) return { ok: false, error: 'no RA tab' };
  var r = Number(b.row); if (!(r >= 2) || str_(sh.getRange(r, 2).getValue()) !== str_(b.n)) {
    var v = sh.getRange(2, 2, Math.max(sh.getLastRow() - 1, 1), 1).getValues(); r = -1;
    for (var i = 0; i < v.length; i++) if (str_(v[i][0]) === str_(b.n)) { r = i + 2; break; }
  }
  if (r < 0) return { ok: false, error: 'task not found' };
  sh.getRange(r, 1).setValue(!!b.done);
  return { ok: true, row: r };
}

// ---------- notes (issues noted on the phone, grade flags from the desktop) → Notes tab ----------
function noteAdd_(ss, b) {
  var text = String(b.text || '').trim(); if (!text) return { ok: false, error: 'empty note' };
  var sh = ss.getSheetByName('Notes');
  if (!sh) { sh = ss.insertSheet('Notes'); sh.appendRow(['when', 'note', 'from', 'resolved']); sh.setFrozenRows(1); }
  sh.appendRow([new Date(Number(b.ts) || Date.now()), text, String(b.from || 'phone'), false]);
  return { ok: true };
}

// ---------- attendance (Attendance: A class, B rule, C… one date per absence) ----------
function readAttendance_(ss) {
  var sh = ss.getSheetByName('Attendance'), v = sh.getDataRange().getValues(), out = [];
  for (var i = 1; i < v.length; i++) {
    var code = str_(v[i][0]); if (!code) continue;
    var dates = [];
    for (var c = 2; c < v[i].length; c++) { var y = cellYmd_(v[i][c], ss); if (y) dates.push(ymdToMs_(y)); }
    out.push({ code: code, rule: str_(v[i][1]), dates: dates });
  }
  return out;
}
function attRow_(sh, code) {
  var v = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 1).getValues();
  for (var i = 1; i < v.length; i++) if (str_(v[i][0]).toLowerCase() === str_(code).toLowerCase()) return i + 1;
  return -1;
}
function absenceAdd_(ss, b) {
  var sh = ss.getSheetByName('Attendance'), r = attRow_(sh, b.className);
  if (r < 0) return { ok: false, error: 'class not found' };
  var cols = Math.max(sh.getLastColumn(), 3), vals = sh.getRange(r, 3, 1, cols - 2).getValues()[0], free = -1;
  for (var i = 0; i < vals.length; i++) {
    if (cellYmd_(vals[i], ss) === b.date) return { ok: true, dup: true };
    if (free < 0 && (vals[i] === '' || vals[i] == null)) free = i;
  }
  var cell = sh.getRange(r, 3 + (free < 0 ? vals.length : free));
  cell.setValue(ymdToCell_(b.date, ss)); cell.setNumberFormat('ddd" "m"/"d');
  return { ok: true };
}
function absenceRemove_(ss, b) {
  var sh = ss.getSheetByName('Attendance'), r = attRow_(sh, b.className);
  if (r < 0) return { ok: false, error: 'class not found' };
  var cols = Math.max(sh.getLastColumn(), 3), range = sh.getRange(r, 3, 1, cols - 2), vals = range.getValues()[0], keep = [], found = false;
  for (var i = 0; i < vals.length; i++) {
    if (!found && cellYmd_(vals[i], ss) === b.date) { found = true; continue; }
    if (vals[i] !== '' && vals[i] != null) keep.push(vals[i]);
  }
  if (!found) return { ok: true };
  while (keep.length < vals.length) keep.push('');
  range.setValues([keep]);
  return { ok: true };
}

// ---------- grades ----------
// With a Rules tab: the grading engine (Grades.gs) does the math and explains each step.
// Without one (older semester sheets): the v1 Config + Report formulas, unchanged.
function readGrades_(ss) {
  var rulesSh = ss.getSheetByName('Rules');
  return rulesSh && typeof Engine !== 'undefined' ? gradesFromEngine_(ss, rulesSh) : readGradesV1_(ss);
}

function gradesFromEngine_(ss, rulesSh) {
  var lastR = Math.max(rulesSh.getLastRow(), 17);
  var rules = rulesFromSheet_(rulesSh.getRange('A4:T13').getValues(), rulesSh.getRange(17, 1, lastR - 16, 14).getValues());
  var ash = ss.getSheetByName('Assignments'), lastA = Math.max(ash.getLastRow(), 3);
  var items = itemsFromSheet_(ash.getRange(3, 2, lastA - 2, 6).getValues());
  var att = ss.getSheetByName('Attendance'), absences = att ? absencesFromSheet_(att.getDataRange().getValues().slice(1)) : {};
  var cfg = ss.getSheetByName('Config').getRange(2, 1, 10, 4).getValues(), info = {};
  cfg.forEach(function (r) { var c = str_(r[0]).toLowerCase(); if (c) info[c] = { name: str_(r[1]), credits: Number(r[3]) || 0 }; });

  var courses = [];
  rules.forEach(function (rule) {
    var g = Engine.grade(rule, items, { absences: absences }), meta = info[rule.code] || { name: rule.code, credits: 0 };
    var counted = g.cats.filter(function (k) { return k.kind === 'normal'; }), total = counted.reduce(function (s, k) { return s + (k.weight || 0); }, 0);
    var cuts = {}; for (var L in rule.cutoffs) if (isFinite(rule.cutoffs[L])) cuts[L] = rule.cutoffs[L];
    courses.push({
      code: rule.code, name: meta.name, credits: meta.credits, points: rule.method === 'points',
      passFail: !!(rule.cutoffs && rule.cutoffs.S != null), scaleGP: !!rule.binCutoffs,
      raw: g.value == null ? null : Math.round(g.value * 10000) / 10000, letter: g.letter || '', gp: g.gp, cuts: cuts,
      cats: g.cats.map(function (k) {
        return { name: k.name, abbr: k.abbr, kind: k.kind, w: k.weight, poss: k.count, graded: k.graded, pct: k.pct,
          extra: null, share: k.kind === 'normal' && total ? (k.weight || 0) / total : 0, dropped: k.dropped, notes: k.notes };
      }),
      trace: g.trace,
      rule: jsonSafe_(rule)
    });
  });
  var gpa = Engine.gpa(courses), credits = courses.reduce(function (s, c) { return s + (c.gp != null ? c.credits : 0); }, 0);
  return { engine: true, gpa: gpa == null ? null : Math.round(gpa * 1000) / 1000, credits: credits, courses: courses };
}
// JSON has no Infinity: the app turns "-inf" back into -Infinity before it runs what-if grades
function jsonSafe_(o) { return JSON.parse(JSON.stringify(o, function (k, v) { return v === -Infinity ? '-inf' : v === Infinity ? 'inf' : v; })); }

function readGradesV1_(ss) {
  var cfg = ss.getSheetByName('Config').getRange(1, 1, 11, 15).getValues();
  var rep = ss.getSheetByName('Report').getRange(2, 1, 100, 17).getValues();
  var cutNames = [], ci;
  for (ci = 5; ci <= 10; ci++) cutNames.push(str_(cfg[0][ci]));
  var courses = [], credits = 0;
  for (var i = 1; i < cfg.length; i++) {
    var row = cfg[i], code = str_(row[0]), cr = Number(row[3]);
    if (!code || !(cr > 0)) continue;
    credits += cr;
    var cuts = {}; for (ci = 0; ci < cutNames.length; ci++) if (typeof row[5 + ci] === 'number') cuts[cutNames[ci]] = row[5 + ci];
    var letter = /^[A-F][+-]?$/.test(str_(row[12])) ? str_(row[12]) : null;
    var cats = [], total = 0;
    for (var j = 0; j < rep.length; j++) {
      if (str_(rep[j][4]) !== code || !str_(rep[j][1])) continue;
      var w = Number(rep[j][2]) || 0; total += w;
      cats.push({ name: str_(rep[j][1]).replace(/\(.*?\)/g, '').replace(/\*/g, '').trim(), abbr: str_(rep[j][3]), w: w,
        poss: Number(rep[j][6]) || 0, graded: Number(rep[j][8]) || 0, pct: pctOf_(row[4] === true, rep[j]),
        extra: (w === 0 && numv_(rep[j][14]) != null && (Number(rep[j][8]) || 0) > 0) ? round2_(rep[j][14]) : null, share: 0 });
    }
    cats.forEach(function (k) { k.share = total > 0 ? k.w / total : 0; });
    courses.push({ code: code, name: str_(row[1]), credits: cr, points: row[4] === true, raw: numv_(row[11]) != null ? round2_(row[11]) : null,
      letter: letter, gp: numv_(row[13]), cuts: cuts, cats: cats });
  }
  return { gpa: numv_(cfg[1][14]) != null ? round2_(cfg[1][14]) : null, credits: credits, courses: courses };
}
function pctOf_(points, r) {
  if (points) return (numv_(r[13]) > 0 && numv_(r[14]) != null) ? round2_(100 * r[14] / r[13]) : null;
  return numv_(r[10]) != null ? round2_(r[10]) : null;
}
function round2_(n) { return Math.round(n * 100) / 100; }

// ---------- calendar ("next up") ----------
function readEvents_() {
  var cal = CalendarApp.getCalendarById(CAL_ID);
  if (!cal) throw new Error('calendar ' + CAL_ID + ' not found for the account running this script');
  var now = new Date(), evs = cal.getEvents(new Date(now.getTime() - 3600000), new Date(now.getTime() + EVENT_DAYS * 864e5)), out = [];
  for (var i = 0; i < evs.length; i++) {
    var ev = evs[i];
    try { if (ev.getMyStatus() === CalendarApp.GuestStatus.NO) continue; } catch (x) {}
    var t = ev.getStartTime().getTime(), e = ev.getEndTime().getTime();
    out.push({ n: ev.getTitle(), t: t, e: e, a: ev.isAllDayEvent() || (e - t) >= 20 * 3600000 });
  }
  out.sort(function (a, b) { return a.t - b.t; });
  return out.slice(0, 60);
}

// ---------- run once from the editor (play button) to grant permissions and check everything ----------
function checkSetup() {
  var ss = SpreadsheetApp.openById(SHEET_ID), msg = [];
  msg.push('connection key: ' + (token_() ? 'set' : 'MISSING — add TOKEN under Project Settings → Script properties'));
  msg.push('grading engine: ' + (typeof Engine !== 'undefined' ? 'found' : 'MISSING — add Grades.gs to this project'));
  msg.push('assignments: ' + readAssignments_(ss).length + ' rows');
  var g = readGrades_(ss);
  msg.push('grades: ' + g.courses.length + ' courses' + (g.engine ? ' (rules tab)' : ' (v1 formulas)') + ', GPA ' + g.gpa);
  msg.push('attendance: ' + readAttendance_(ss).length + ' classes');
  msg.push('weeks: ' + readWeeks_(ss).length + ' dividers');
  var ra = readRA_(ss); msg.push('RA tasks: ' + (ra ? ra.length : 'no RA tab'));
  try { var ev = readEvents_().filter(function (x) { return !x.a; }); msg.push('calendar: ' + ev.length + ' upcoming timed events'); }
  catch (err) { msg.push('calendar: PROBLEM — ' + err); }
  Logger.log(msg.join('\n'));
}
