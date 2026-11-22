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
  CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) },
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
