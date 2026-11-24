// Offline support for both apps (desktop.html and app.html), scope /wheel/.
// Pages and scripts: network first, so a new build shows up as soon as it's online; the saved copy is used when
// the network is down or takes longer than a few seconds. Photos, fonts and icons never change under the same name:
// saved copy first. Only this site's own files are handled; the sheet's data (script.google.com) and everything
// else from other sites pass straight through.
const CACHE = 'wheel-shell-v1';
const SHELL = ['desktop.html', 'app.html', 'engine.js', 'sheetrules.js', 'changelog.js', 'fonts/newsreader.css',
  'desktop.webmanifest', 'favicon-desktop.png', 'favicon-desktop.svg', 'icon.png', 'icon-ipad.png'];
const WAIT_MS = 3500;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const keyOf = req => { const u = new URL(req.url); u.search = ''; u.hash = ''; return u.href; };   // one saved copy per file, whatever the query
const save = (req, res) => { if (res && res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(keyOf(req), copy)); } return res; };
const saved = req => caches.match(keyOf(req));

function networkFirst(req, wait) {
  const net = fetch(req).then(r => save(req, r));
  if (!wait) return net.catch(() => saved(req).then(r => r || Response.error()));
  return new Promise(resolve => {
    let done = false; const finish = r => { if (!done && r) { done = true; resolve(r); } };
    const t = setTimeout(() => saved(req).then(finish), wait);
    net.then(r => { clearTimeout(t); finish(r); }).catch(() => { clearTimeout(t); saved(req).then(r => finish(r || Response.error())); });
  });
}
function savedFirst(req) { return saved(req).then(r => r || fetch(req).then(x => save(req, x))); }

self.addEventListener('fetch', e => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== 'GET' || u.origin !== location.origin) return;
  if (/\.(webp|png|jpe?g|svg|woff2?)$/i.test(u.pathname)) return e.respondWith(savedFirst(req));
  // the apps' update check asks for the page with ?v=…: always the network (it also refreshes the saved page)
  e.respondWith(networkFirst(req, u.searchParams.has('v') ? 0 : WAIT_MS));
});
