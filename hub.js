// hub.js: the hub's own preferences (hub roadmap chunk 3), shared by the landing page and Settings.
// They live in this browser (localStorage 'portal-prefs') and work without signing in. When a Google
// account is signed in, one small file in the private cloud folder (hub-prefs.json) carries them to
// the reader's other devices. Needs font.js (appFont.cloud) loaded first.
// Stored: { schema: 1, h: { <slug>: ±ms }, a: ±ms, g: { <STAT>: [hours a week, ms] }, o: ms }.
// g = the attributes the reader is working on (0 hours = not chosen); o = when the first-visit question was answered. Each choice carries the time it was made
// (positive = hidden / activity shown, negative = the opposite), so two devices merge choice by
// choice, the later one winning, instead of one device's file replacing the other's.
//   hidden   apps the reader marked "Not for me": off the tiles, cards, character sheet and suggestions
//   activity false = the hub does not show what the apps report (shown by default)
window.hubPrefs = (function () {
  var KEY = 'portal-prefs', FILE = 'hub-prefs.json';
  function clean(p) {
    var out = { schema: 1, h: {}, a: 0, g: {}, o: 0 }, h = p && typeof p === 'object' && p.h && typeof p.h === 'object' ? p.h : {};
    var g = p && typeof p === 'object' && p.g && typeof p.g === 'object' ? p.g : {};
    Object.keys(g).sort().forEach(function (s) { var v = g[s]; if (/^[A-Z]{3}$/.test(s) && Array.isArray(v) && isFinite(v[0]) && isFinite(v[1])) out.g[s] = [Math.max(0, Math.min(40, +v[0])), +v[1]]; });
    if (p && isFinite(p.o)) out.o = +p.o;
    Object.keys(h).sort().slice(0, 200).forEach(function (s) { if (s.length < 80 && isFinite(h[s]) && +h[s]) out.h[s] = +h[s]; });
    if (p && isFinite(p.a)) out.a = +p.a;
    return out;
  }
  function merge(x, y) {
    var out = { schema: 1, h: {}, a: Math.abs(y.a) > Math.abs(x.a) ? y.a : x.a, g: {}, o: Math.max(x.o, y.o) };
    Object.keys(Object.assign({}, x.g, y.g)).sort().forEach(function (s) { out.g[s] = !x.g[s] || (y.g[s] && y.g[s][1] > x.g[s][1]) ? y.g[s] : x.g[s]; });
    Object.keys(Object.assign({}, x.h, y.h)).sort().forEach(function (s) {
      var a = x.h[s] || 0, b = y.h[s] || 0;
      out.h[s] = Math.abs(b) > Math.abs(a) ? b : a;
    });
    return out;
  }
  function raw() { try { return clean(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch (e) { return clean(null); } }
  function put(p) {
    try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { /* private mode: lasts for this page only */ }
    document.dispatchEvent(new CustomEvent('hub-prefs'));
  }
  // -> { hidden: [slug, …], activity: bool, goals: { STAT: hours a week }, onboarded: bool }
  function get() {
    var p = raw(), goals = {};
    Object.keys(p.g).forEach(function (s) { if (p.g[s][0] > 0) goals[s] = p.g[s][0]; });
    return { hidden: Object.keys(p.h).filter(function (s) { return p.h[s] > 0; }), activity: !(p.a < 0), goals: goals, onboarded: p.o > 0 };
  }
  // { STAT: hours } for every attribute shown (0 = not working on it); also marks the first-visit question answered
  function setGoals(map) {
    var p = raw(), now = Date.now();
    Object.keys(map || {}).forEach(function (s) { p.g[s] = [+map[s] || 0, now]; });
    p.o = now; put(clean(p));
  }
  function hide(slug, on) { var p = raw(); p.h[slug] = on ? Date.now() : -Date.now(); put(clean(p)); }
  function setActivity(on) { var p = raw(); p.a = on ? Date.now() : -Date.now(); put(p); }
  // -> 'off' (nobody signed in), 'pulled', 'pushed', 'both' or 'same'. silent: give up rather than show Google's window.
  function sync(silent) {
    if (!window.appFont || !appFont.getAccount()) return Promise.resolve('off');
    return appFont.cloud.signIn({ silent: silent }).then(function () { return appFont.cloud.read(FILE); }).then(function (text) {
      var remote = null, local = raw();
      try { if (text) remote = clean(appFont.parseJSON(text, 1e5)); } catch (e) { /* unreadable: ours replaces it */ }
      var m = merge(local, remote || clean(null)), ms = JSON.stringify(m);
      var pulled = ms !== JSON.stringify(local), push = !remote || ms !== JSON.stringify(remote);
      if (pulled) put(m);
      return (push ? appFont.cloud.write(FILE, ms) : Promise.resolve()).then(function () { return pulled && push ? 'both' : pulled ? 'pulled' : push ? 'pushed' : 'same'; });
    }).then(function (res) { return syncLedger().catch(function () { /* the settings still synced */ }).then(function () { return res; }); });
  }

  // ---- the session ledger across devices (chunk 4) ----------------------------------------------------
  // Apps add rows to localStorage 'portal-activity' (appFont.logSession). Each device writes only its
  // own file, hub-ledger-<device>.json, so two devices never overwrite each other; the other devices'
  // rows are kept in 'portal-activity-remote' for the hub to draw. Skipped while activity is switched off.
  function device() {
    var v = localStorage.getItem('portal-device');
    if (!v) { v = appFont.randomId().replace(/-/g, '').slice(0, 16); localStorage.setItem('portal-device', v); }
    return v;
  }
  function rows(text) {
    var a = [];
    try { a = appFont.parseJSON(text || '[]', 2e6); } catch (e) { /* unreadable: no rows */ }
    return (Array.isArray(a) ? a : []).filter(function (x) { return Array.isArray(x) && x.length >= 3 && isFinite(x[0]) && typeof x[1] === 'string' && x[1].length < 80; }).slice(-2000);
  }
  function syncLedger() {
    if (!get().activity) return Promise.resolve();
    var mine = 'hub-ledger-' + device() + '.json', text = localStorage.getItem('portal-activity') || '[]', local = rows(text);
    var mark = text.length + ':' + text.slice(-60); // changed since the last push?
    var push = local.length && localStorage.getItem('portal-ledger-pushed') !== mark
      ? appFont.cloud.write(mine, JSON.stringify(local)).then(function () { localStorage.setItem('portal-ledger-pushed', mark); }) : Promise.resolve();
    return push.then(function () { return appFont.cloud.list('hub-ledger-'); }).then(function (files) {
      var names = files.map(function (f) { return f.name; });
      var out = [], seen = {};
      local.forEach(function (r) { if (r[4]) seen[r[1] + '|' + r[4]] = 1; });
      return names.filter(function (n) { return n !== mine; }).slice(0, 20).reduce(function (p, n) { // ponytail: 20 devices is plenty
        return p.then(function () { return appFont.cloud.read(n); }).then(function (t) {
          rows(t).forEach(function (r) { var k = r[4] ? r[1] + '|' + r[4] : ''; if (k && seen[k]) return; if (k) seen[k] = 1; out.push(r.slice(0, 5)); });
        });
      }, Promise.resolve()).then(function () {
        out.sort(function (a, b) { return a[0] - b[0]; });
        localStorage.setItem('portal-activity-remote', JSON.stringify(out.slice(-6000)));
        document.dispatchEvent(new CustomEvent('hub-ledger'));
      });
    });
  }
  // the reader asked to sign in: Google's window may show
  function signIn() { return appFont.cloud.signIn().then(function () { return sync(false); }); }
  return { get: get, hide: hide, setActivity: setActivity, setGoals: setGoals, sync: sync, signIn: signIn };
})();
