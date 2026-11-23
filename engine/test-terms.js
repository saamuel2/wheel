// terms: home sheet routing
const fs = require('fs'), vm = require('vm');
const W = '/home/claude/wheel/backend/';
const opened = [];
const range = vals => ({ getValues: () => vals });
const SEM = [['f25', 'fall 2025', '', '', '', '', 'finished', 'F25'], ['f26', 'fall 2026', 'SHEETF26', new Date(Date.UTC(2026, 7, 19)), '2026-12-08', '', 'current', 'F26'], ['s27', 'spring 2027', 'SHEETS27', '', '', '', '', 'S27']];
const GPA = [['CH 221', 'Orgo', 'F25', 3, 94, 'A', 4, 12]];
const home = { getSheetByName: n => n === 'Semesters' ? { getLastRow: () => SEM.length + 1, getRange: (r, c, nr, nc) => range(SEM) } : n === 'GPA' ? { getLastRow: () => 2, getRange: () => range(GPA) } : null };
const ctx = vm.createContext({ console, JSON, Date, Math, String, Number, Object, Array, isNaN,
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'tok' }) },
  CacheService: { getScriptCache: () => ({ get: () => null, put: () => {}, remove: () => {} }) },
  Utilities: { formatDate: d => d.toISOString().slice(0, 10) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ContentService: { createTextOutput: t => ({ setMimeType: () => t }), MimeType: { JSON: 1 } },
  SpreadsheetApp: { openById: id => { opened.push(id); if (id === '19dC2hjuPzw-USwoIIA39WP76OMFTIDdsoyB9ACfRLpA') return home; throw new Error('stop:' + id); } } });
vm.runInContext(fs.readFileSync(W + 'Grades.gs', 'utf8'), ctx); vm.runInContext(fs.readFileSync(W + 'Code.gs', 'utf8'), ctx);
const ok = (c, m) => console.log((c ? '✓ ' : '✗ ') + m);
let t = vm.runInContext('pickTerm_("")', ctx); ok(t.term.id === 'f26' && t.term.start === '2026-08-19' && t.term.ldoc === '2026-12-08', 'no term → current (fall 2026), dates read');
t = vm.runInContext('pickTerm_("s27")', ctx); ok(t.term.sheet === 'SHEETS27', 'term=s27 → its sheet');
t = vm.runInContext('pickTerm_("zzz")', ctx); ok(t.term.id === 'f26', 'unknown term → current');
const r = JSON.parse(vm.runInContext('doGet({ parameter: { token: "tok", term: "f25" } })', ctx));
ok(r.historyOnly && r.term === 'f25' && r.history.length === 1 && r.terms.length === 3, 'history-only term returns gpa history + term list');
opened.length = 0; try { vm.runInContext('doGet({ parameter: { token: "tok", term: "s27" } })', ctx); } catch (e) { } ok(opened.includes('SHEETS27'), 'term=s27 opens spring sheet');
const w = JSON.parse(vm.runInContext('doPost({ postData: { contents: JSON.stringify({ token: "tok", term: "f25", action: "done" }) } })', ctx)); ok(w.ok === false, 'writes to a history-only term are refused');
// new semester
ok(vm.runInContext('termIdFor_("spring 2027", ["f26"])', ctx) === 's27' && vm.runInContext('termIdFor_("summer 1 2027", [])', ctx) === 's127' && vm.runInContext('termIdFor_("spring 2027", ["s27"])', ctx) === 's27-2', 'term ids: s27, s127, s27-2');
let written = null, appended = null;
ctx.SpreadsheetApp.openById = id => id === '19dC2hjuPzw-USwoIIA39WP76OMFTIDdsoyB9ACfRLpA' ? { getSheetByName: n => n === 'Semesters' ? { getLastRow: () => SEM.length + 1, getRange: () => range(SEM), appendRow: r => { appended = r; } } : null }
  : { copy: n => ({ getId: () => 'NEWSHEET', getSheetByName: () => ({ getRange: (r, c, nr, nc) => ({ setValues: v => { written = v; } }) }) }) };
ctx.DriveApp = { getFileById: () => ({ moveTo() {} }), getFolderById: () => ({}) };
const nt = vm.runInContext('termNew_({ name: "Spring 2028", start: "2028-01-06", ldoc: "2028-04-21", exams: "2028-05-02" })', ctx);
ok(nt.ok && nt.term === "s28" && appended[2] === "NEWSHEET" && appended[7] === "S28", 'new semester copies the template, lists it as s28 / S28');
ok(written.length === 18 && /end of week 1 /.test(written[0][2]) && /end of spring 2028/.test(written[17][2]) && written[0][1].getDay() === 0, 'week dividers: 17 weeks + end of spring 2028, dated Sundays (' + written.length + ')');
ok(vm.runInContext('termNew_({ name: "fall 2026", start: "2026-08-19", ldoc: "2026-12-08" })', ctx).ok === false, 'refuses a duplicate name');
// finish a semester
const GPAROWS = [['Code', 'Course', 'Term', 'Hours', 'Grade', 'Letter', 'GPA', 'Points'], ['BCH 351', 'General Biochemistry', 'F26', 3, '', '', '', '']], SEMR = SEM.map(r => r.slice());
const sheetOf = rows => ({ getLastRow: () => rows.length, getRange: (r, c, nr, nc) => ({ getValues: () => rows.slice(r - 1, r - 1 + nr).map(x => x.slice(c - 1, c - 1 + nc)), setValues: v => v.forEach((row, i) => row.forEach((x, j) => { (rows[r - 1 + i] = rows[r - 1 + i] || [])[c - 1 + j] = x; })), setValue: x => { rows[r - 1][c - 1] = x; } }), appendRow: r => rows.push(r) });
const SEMSH = [['id']].concat(SEMR);
ctx.SpreadsheetApp.openById = id => ({ getSheetByName: n => n === 'GPA' ? sheetOf(GPAROWS) : n === 'Semesters' ? sheetOf(SEMSH) : null });
const fin = vm.runInContext(`termFinish_({ term: 'f26', rows: [{ code: 'bch351', name: 'General Biochemistry', hours: 3, grade: 91.19, letter: 'A-' }, { code: 'bsc494', name: 'Teaching Experience', hours: 2, grade: 100, letter: 'S' }] })`, ctx);
ok(fin.ok && GPAROWS.length === 3 && GPAROWS[1][5] === 'A-' && GPAROWS[1][6] === 3.667 && GPAROWS[1][7] === 11.001 && GPAROWS[2][0] === 'BSC 494' && GPAROWS[2][6] === '' && SEMSH[2][6] === 'finished', 'finish: updates BCH 351 in place, adds BSC 494 as S, marks fall 2026 finished');
ok(!vm.runInContext(`termFinish_({ term: 'f26', rows: [{ code: 'x1', letter: 'Q' }] })`, ctx).ok, 'refuses an unknown letter');
