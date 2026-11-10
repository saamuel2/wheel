// Build the copies of the grading engine that ship:
//   ../engine.js (the engine itself, edit it there) + sheet-adapter.js (here)
//   → ../sheetrules.js (browser) and ../backend/Grades.gs (sheet custom functions + backend)
// Run: node engine/build.js && node engine/test-ec.js
const fs = require('fs'), path = require('path'), R = path.join(__dirname, '..');
const eng = fs.readFileSync(path.join(R, 'engine.js'), 'utf8'), ad = fs.readFileSync(path.join(__dirname, 'sheet-adapter.js'), 'utf8');
fs.writeFileSync(path.join(R, 'backend/Grades.gs'), '/** Grades.gs — grading engine + sheet functions. Built by engine/build.js; edit engine.js and engine/sheet-adapter.js instead. */\n' + eng.replace(/\nif \(typeof module[^\n]*\n?$/, '\n') + ad);
fs.writeFileSync(path.join(R, 'sheetrules.js'), '/* sheetrules.js — turns grades-tab blocks (or Rules-tab rows) into engine rules in the browser (same code as Grades.gs, built from engine/sheet-adapter.js). Needs engine.js first. */\nvar SheetRules = (function () {\n' + ad +
  '\n  return { fromSheet: rulesFromSheet_, tables: tablesFromBlocks_, blockRows: blockRows_, parseCutoffs: parseCutoffs_, COMBINE: COMBINE, COUNTED_AS: COUNTED_AS, LETTERS: LETTERS };\n})();\n');
// sanity: the built Grades.gs must parse and grade
const vm = require('vm'), box = {}; vm.createContext(box); vm.runInContext(fs.readFileSync(path.join(R, 'backend/Grades.gs'), 'utf8') + '\nthis.ok = typeof GRADEBLOCKS === "function" && typeof Engine.grade === "function";', box);
if (!box.ok) { console.error('build check failed'); process.exit(1); }
console.log('built sheetrules.js + backend/Grades.gs');
