# grading engine

- `../engine.js`: the engine itself (pure JS, runs in Apps Script, the browser and Node).
- `sheet-adapter.js`: reads the grades tab (one block per course) and the older Rules tab into engine rules; the sheet custom functions (GRADEBLOCKS, BLOCKTRACE, GRADES, GRADETRACE).
- `build.js`: run `node engine/build.js` after editing either file. It writes `../sheetrules.js` (browser) and `../backend/Grades.gs` (deployed to Apps Script by the GitHub workflow on push).
- `test-ec.js`: `node engine/test-ec.js` checks the four extra-credit kinds.

Grades-tab format: see the "grades-tab.md" doc in the claude.ai project.
