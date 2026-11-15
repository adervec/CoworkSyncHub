// hub.js: the hub's own preferences (hub roadmap chunk 3), shared by the landing page and Settings.
// They live in this browser (localStorage 'portal-prefs') and work without signing in. When a Google
// account is signed in, one small file in the private Drive folder (hub-prefs.json) carries them to
// the reader's other devices. Needs font.js (appFont.google) loaded first.
// Stored: { schema: 1, h: { <slug>: ±ms }, a: ±ms }. Each choice carries the time it was made
// (positive = hidden / activity shown, negative = the opposite), so two devices merge choice by
// choice, the later one winning, instead of one device's file replacing the other's.
//   hidden   apps the reader marked "Not for me": off the tiles, cards, character sheet and suggestions
//   activity false = the hub does not show what the apps report (shown by default)
window.hubPrefs = (function () {
  var KEY = 'portal-prefs', FILE = 'hub-prefs.json';
  function clean(p) {
    var out = { schema: 1, h: {}, a: 0 }, h = p && typeof p === 'object' && p.h && typeof p.h === 'object' ? p.h : {};
    Object.keys(h).sort().slice(0, 200).forEach(function (s) { if (s.length < 80 && isFinite(h[s]) && +h[s]) out.h[s] = +h[s]; });
    if (p && isFinite(p.a)) out.a = +p.a;
    return out;
  }
  function merge(x, y) {
    var out = { schema: 1, h: {}, a: Math.abs(y.a) > Math.abs(x.a) ? y.a : x.a };
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
  // -> { hidden: [slug, …], activity: bool }
  function get() {
    var p = raw();
    return { hidden: Object.keys(p.h).filter(function (s) { return p.h[s] > 0; }), activity: !(p.a < 0) };
  }
  function hide(slug, on) { var p = raw(); p.h[slug] = on ? Date.now() : -Date.now(); put(clean(p)); }
  function setActivity(on) { var p = raw(); p.a = on ? Date.now() : -Date.now(); put(p); }
  // -> 'off' (nobody signed in), 'pulled', 'pushed', 'both' or 'same'. silent: give up rather than show Google's window.
  function sync(silent) {
    if (!window.appFont || !appFont.getAccount()) return Promise.resolve('off');
    return appFont.google.token({ silent: silent }).then(function () { return appFont.google.read(FILE); }).then(function (text) {
      var remote = null, local = raw();
      try { if (text) remote = clean(appFont.parseJSON(text, 1e5)); } catch (e) { /* unreadable: ours replaces it */ }
      var m = merge(local, remote || clean(null)), ms = JSON.stringify(m);
      var pulled = ms !== JSON.stringify(local), push = !remote || ms !== JSON.stringify(remote);
      if (pulled) put(m);
      return (push ? appFont.google.write(FILE, ms) : Promise.resolve()).then(function () { return pulled && push ? 'both' : pulled ? 'pulled' : push ? 'pushed' : 'same'; });
    });
  }
  // the reader asked to sign in: Google's window may show
  function signIn() { return appFont.google.token().then(function () { return sync(false); }); }
  return { get: get, hide: hide, setActivity: setActivity, sync: sync, signIn: signIn };
})();
