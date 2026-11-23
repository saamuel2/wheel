// "assignments profile": copies your Google name + profile photo into the home sheet once a day,
// so the apps can show them without the main backend needing any new permission.
// First time: open this project, choose syncProfile, press Run, and allow. It schedules itself after that.
var HOME_ID = '19dC2hjuPzw-USwoIIA39WP76OMFTIDdsoyB9ACfRLpA';
function syncProfile() {
  var r = UrlFetchApp.fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  var u = JSON.parse(r.getContentText() || '{}');
  var ss = SpreadsheetApp.openById(HOME_ID), sh = ss.getSheetByName('Profile') || ss.insertSheet('Profile');
  sh.getRange(1, 1, 2, 3).setValues([['name', 'photo', 'updated'], [u.name || '', (u.picture || '').replace(/=s\d+-c$/, '=s192-c'), new Date()]]);
  if (!ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'syncProfile'; }))
    ScriptApp.newTrigger('syncProfile').timeBased().everyDays(1).atHour(4).create();
}
