// new term: add courses (with and without rules) to an empty template sheet
const fs = require('fs'), vm = require('vm'), W = '/home/claude/wheel/backend/';
function sheet(rows) {
  const get = (r, c) => (rows[r - 1] || [])[c - 1] ?? '';
  const range = (r, c, nr, nc) => ({ getValue: () => get(r, c),
    getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => get(r + i, c + j))),
    setValue: v => { (rows[r - 1] = rows[r - 1] || [])[c - 1] = v; },
    setValues: vs => vs.forEach((row, i) => row.forEach((v, j) => { (rows[r - 1 + i] = rows[r - 1 + i] || [])[c - 1 + j] = v; })),
    clearContent: () => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (rows[r - 1 + i]) rows[r - 1 + i][c - 1 + j] = ''; } });
  return { rows, getMaxRows: () => Math.max(rows.length, 120), getLastRow: () => rows.length, insertRowsAfter: (r, n) => rows.splice(r, 0, ...Array.from({ length: n }, () => [])),
    deleteRows: (r, n) => rows.splice(r - 1, n), getRange: (r, c, nr, nc) => range(r, c, nr || 1, nc || 1), getDataRange: () => range(1, 1, rows.length, 12), getName: () => '' };
}
const SH = { Config: sheet([['Course Code', 'Course Name', 'Combines Name', 'Credit Hours', 'Points-Based?'], ['‎ ', 'div', '‎  div', '', false], ['wv', 'wolf village', 'wv wolf village', '', false]]),
  Grades: sheet([['course/category']]), Assignments: sheet([[], ['.', 'due', 'name', 'class', '..', 'grade', 'out of']]), Attendance: sheet([['class', 'rule']]) };
Object.keys(SH).forEach(k => SH[k].getName = () => k);
const ss = { getSheetByName: n => SH[n] || null, getSheets: () => Object.values(SH) };
const ctx = vm.createContext({ console, JSON, Date, Math, String, Number, Object, Array, isNaN, ss });
vm.runInContext(fs.readFileSync(W + 'Grades.gs', 'utf8'), ctx); vm.runInContext(fs.readFileSync(W + 'Code.gs', 'utf8'), ctx);
const ok = (c, m) => console.log((c ? '✓ ' : '✗ ') + m);
const run = s => vm.runInContext(s, ctx);
let setup = run('readCourseSetup_(ss)'); ok(Array.isArray(setup) && setup.length === 0, 'empty term: no courses, no error');
let r = run('courseAdd_(ss, { code: "CH 315", name: "organic chem ii", credits: "3", color: "#9ed2f6" })');
ok(r.ok && r.code === 'ch315' && SH.Config.rows[3][0] === 'ch315' && SH.Config.rows[1][1] === 'div' && SH.Config.rows[3][15] === '#9ed2f6', 'course without rules → Config row 4 (div + wv kept) + color in P');
setup = run('readCourseSetup_(ss)'); ok(setup.length === 1 && setup[0].bare && setup[0].cats.length === 0, 'listed as set-up-later (no grading block)');
ok(JSON.stringify(run('readColors_(ss)')) === '{"ch315":"#9ed2f6"}', 'colors read back');
r = run('courseAdd_(ss, { code: "bio300", name: "genetics", credits: 4, head: { "grade by": "weights" }, cats: [{ name: "exams", type: "EX", weight: 70, items: 3, combine: "average", drop: 1 }, { name: "homework", type: "HW", weight: 30, combine: "average" }] })');
ok(r.ok && SH.Grades.rows[1][0] === 'bio300' && /grade by: weights/.test(SH.Grades.rows[1][3]) && SH.Grades.rows[3][0] === 'exams', 'course with rules → block starts on row 2: ' + JSON.stringify(r));
r = run('courseSave_(ss, { code: "ch315", head: { "grade by": "points", "entered as": "points" }, cats: [{ name: "total", type: "PT", combine: "points" }] })');
const g = SH.Grades.rows.map(x => x[0]); ok(r.ok && g[1] === 'bio300' && !g[5] && g[6] === 'ch315' && g[8] === 'total', 'setting up later adds a block after a blank row: ' + JSON.stringify(g.slice(0, 9)));
ok(run('gradesTab_(ss)') !== null && run('readCourseSetup_(ss)').filter(c => !c.bare).length === 2, 'both courses now have blocks');
ok(!run('courseAdd_(ss, { code: "bio300", name: "x", credits: 1 })').ok && !run('courseAdd_(ss, { code: "biology", name: "x" })').ok, 'refuses duplicates and bad codes');
r = run('courseAdd_(ss, { code: "zz101", name: "bad", credits: 3, cats: [{ name: "a", type: "A", combine: "nope" }] })');
ok(!r.ok && !SH.Config.rows.some(x => x[0] === 'zz101'), 'bad rules → nothing left behind');
