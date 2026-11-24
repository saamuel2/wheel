// Grade fall 2026 with the syllabus rules (several use drops); print one line per course so before/after can be compared.
const E = require('./engine.js'), R = require('./rules-fall26.js'), D = require('./fall26.json');
const items = D.assignments.map(a => ({ name: a.name, cls: a.cls, type: a.type, grade: a.grade }));
R.forEach(r => { const g = E.grade(r, items); console.log(r.code, g.value, g.letter, g.gp, JSON.stringify(g.cats.map(c => [c.abbr, c.count, c.graded, c.pct]))); });
