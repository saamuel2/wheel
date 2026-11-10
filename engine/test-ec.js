// The four extra-credit kinds.
const E = require('../engine.js');
const it = (type, name, grade, due = '2026-10-01') => ({ cls: 'x', type, name, grade, due });
const base = [it('HW', 'h1', 80), it('HW', 'h2', 90), it('EX', 'e1', 70)];
const R = cats => ({ code: 'x', method: 'weighted', entry: 'pct', cutoffs: E.STD_CUTOFFS, categories: [{ abbr: 'HW', name: 'hw', weight: 50 }, { abbr: 'EX', name: 'ex', weight: 50 }].concat(cats) });
const v = (cats, extra) => +E.grade(R(cats), base.concat(extra)).value.toFixed(3);
const plain = v([], []);
const check = (n, got, want) => { const ok = Math.abs(got - want) < 1e-6; console.log(ok ? '✓' : '✗', n, got, want); if (!ok) process.exitCode = 1; };
check('plain', plain, 77.5);
check('final grade as entered', v([{ abbr: 'EC', name: 'ec', kind: 'flat' }], [it('EC', 'ec1', 2), it('EC', 'ec2', 1.5)]), 81);
check('category +5', v([{ abbr: 'EC', name: 'ec', kind: 'catbonus', to: ['HW'], cap: 5 }], [it('EC', 'ec1', 8)]), 80);
check('items next exam', v([{ abbr: 'EC', name: 'ec', kind: 'bonus', to: ['EX'] }], [it('EC', 'ec1', 10, '2026-09-01')]), 82.5);
check('extra items', v([{ abbr: 'EC', name: 'ec', kind: 'extraitems', to: ['HW'] }], [it('EC', 'q', 100)]), 0.5 * (270 / 2) + 35);
