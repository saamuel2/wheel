// Grade functions for this term's sheet. The real code lives in the shared "assignments engine" library,
// so a grading fix reaches every semester without touching this file.
/** @customfunction */ function GRADEBLOCKS(colA, cols, assignments, attendance, config) { return GradesLib.GRADEBLOCKS(colA, cols, assignments, attendance, config); }
/** @customfunction */ function BLOCKTRACE(code, colA, cols, assignments, attendance) { return GradesLib.BLOCKTRACE(code, colA, cols, assignments, attendance); }
/** @customfunction */ function GRADES(courses, categories, assignments, attendance) { return GradesLib.GRADES(courses, categories, assignments, attendance); }
/** @customfunction */ function GRADETRACE(code, courses, categories, assignments, attendance) { return GradesLib.GRADETRACE(code, courses, categories, assignments, attendance); }
/** @customfunction */ function GRADEPOINTS(points, credits) { return GradesLib.GRADEPOINTS(points, credits); }
