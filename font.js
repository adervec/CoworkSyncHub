// font.js — the house font for every app: Atkinson Hyperlegible by default, and one
// reader-chosen override. Published at https://adervec.github.io/font.js.
// Because every app loads it, it also carries the house standards that need no app code:
// storage the browser will not evict, a visible build stamp (<app-build-info>, under the font
// picker), a notice when a new version is ready, a notice instead of a silent crash, the
// accessibility floor (an "Allow pinch-zoom" option, off by default; reduced motion; focus ring),
// an About panel (<app-about>: version, licence, data, storage, diagnostics), a what's-new card after
// an update (silenceable), an offline pill, and systemTheme() for picking a default theme.
//
// Adopting it in an app is two lines:
//   <script src="https://adervec.github.io/font.js"></script>          (in <head>, not deferred)
//   body { font-family: var(--app-font, <the app's old font stack>); }
// and, somewhere in the app's settings:
//   <app-font-picker></app-font-picker>
// Apps with their own settings UI can skip the element and call appFont.options / get() / set().
//
// The choice lives in localStorage, so on adervec.github.io — one origin for every app —
// picking a font in one app changes it in all of them.
// ponytail: family only, four choices. Add sizes or uploads here if anyone ever asks.
(function () {
  if (window.appFont) return;
  var KEY = 'maker-font';
  // fonts/ sits beside this script wherever it is served from
  var BASE = new URL('fonts/', document.currentScript.src).href;
  var options = [
    { id: 'atkinson', label: 'Atkinson Hyperlegible', stack: '"Atkinson Hyperlegible", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
    { id: 'system', label: 'System', stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
    { id: 'serif', label: 'Serif', stack: 'Georgia, "Times New Roman", serif' },
    { id: 'mono', label: 'Monospace', stack: 'ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace' },
  ];
  var byId = function (id) { return options.filter(function (o) { return o.id === id; })[0] || options[0]; };

  function get() {
    try { return byId(localStorage.getItem(KEY)).id; } catch (e) { return options[0].id; } // private mode
  }
  function apply() {
    document.documentElement.style.setProperty('--app-font', byId(get()).stack);
    document.documentElement.dataset.appFont = get();
  }
  function set(id) {
    try { localStorage.setItem(KEY, byId(id).id); } catch (e) { /* private mode: lasts for this page only */ }
    document.documentElement.style.setProperty('--app-font', byId(id).stack);
    document.documentElement.dataset.appFont = byId(id).id;
    document.dispatchEvent(new CustomEvent('app-font-change', { detail: byId(id).id }));
  }

  var face = function (file, weight, style, range) {
    return '@font-face{font-family:"Atkinson Hyperlegible";font-style:' + style + ';font-weight:' + weight +
      ';font-display:swap;src:url(' + BASE + file + '.woff2) format("woff2");unicode-range:' + range + '}';
  };
  var LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
  var EXT = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';
  var style = document.createElement('style');
  style.textContent =
    face('atkinson-hyperlegible-latin-400-normal', 400, 'normal', LATIN) +
    face('atkinson-hyperlegible-latin-700-normal', 700, 'normal', LATIN) +
    face('atkinson-hyperlegible-latin-400-italic', 400, 'italic', LATIN) +
    face('atkinson-hyperlegible-latin-700-italic', 700, 'italic', LATIN) +
    face('atkinson-hyperlegible-latin-ext-400-normal', 400, 'normal', EXT) +
    face('atkinson-hyperlegible-latin-ext-700-normal', 700, 'normal', EXT);
  (document.head || document.documentElement).appendChild(style);
  apply();
  window.addEventListener('storage', function (e) { if (e.key === KEY) { apply(); document.dispatchEvent(new CustomEvent('app-font-change', { detail: get() })); } });

  // ---- Accessibility floor (house standard). Pinch-zoom is a reader OPTION, off by default by the
  // ---- maker's choice; reduced motion and a visible keyboard focus ring are always on.
  var ZKEY = 'maker-zoom';
  function zoomAllowed() { try { return localStorage.getItem(ZKEY) === '1'; } catch (e) { return false; } }
  function applyZoom() {
    // This runs from <head>, possibly before the page's own viewport tag is parsed: use the page's
    // tag once it exists, and drop the stand-in this script made so there is only ever one.
    var all = document.querySelectorAll('meta[name="viewport"]'), vp = all[all.length - 1];
    for (var i = 0; i < all.length; i++) if (all[i].hasAttribute('data-app-zoom') && all.length > 1) { all[i].remove(); vp = document.querySelector('meta[name="viewport"]'); }
    if (!vp) { vp = document.createElement('meta'); vp.name = 'viewport'; vp.setAttribute('data-app-zoom', ''); (document.head || document.documentElement).appendChild(vp); }
    // keep the app's own viewport settings, and only add or remove the zoom limits
    var parts = (vp.getAttribute('content') || 'width=device-width, initial-scale=1').split(',')
      .map(function (p) { return p.trim(); })
      .filter(function (p) { return p && !/^(maximum-scale|user-scalable)\s*=/i.test(p); });
    if (!zoomAllowed()) parts.push('maximum-scale=1', 'user-scalable=no');
    vp.setAttribute('content', parts.join(', '));
  }
  function setZoomAllowed(on) {
    try { on ? localStorage.setItem(ZKEY, '1') : localStorage.removeItem(ZKEY); } catch (e) { /* private mode */ }
    applyZoom(); document.dispatchEvent(new CustomEvent('app-zoom-change', { detail: !!on }));
  }
  applyZoom();
  document.addEventListener('DOMContentLoaded', applyZoom);
  window.addEventListener('storage', function (e) { if (e.key === ZKEY) { applyZoom(); document.dispatchEvent(new CustomEvent('app-zoom-change')); } });
  var a11y = document.createElement('style');
  // :where() keeps these at zero specificity, so an app's own focus style or motion still wins.
  a11y.textContent =
    ':where(a,button,input,select,textarea,summary,[tabindex]):focus-visible{outline:2px solid #4c9ffe;outline-offset:2px}' +
    '@media (prefers-reduced-motion: reduce){:where(*,*::before,*::after){animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}';
  (document.head || document.documentElement).appendChild(a11y);

  // <app-font-picker label="Font"> — a plain labelled <select> in the light DOM, so it takes
  // on the surrounding app's own form styling.
  if (window.customElements && !customElements.get('app-font-picker')) {
    customElements.define('app-font-picker', class extends HTMLElement {
      connectedCallback() {
        if (this.firstChild) return;
        var label = document.createElement('label');
        var select = document.createElement('select');
        options.forEach(function (o) { var el = document.createElement('option'); el.value = o.id; el.textContent = o.label; select.appendChild(el); });
        select.value = get();
        select.addEventListener('change', function () { set(select.value); });
        document.addEventListener('app-font-change', function () { select.value = get(); });
        label.append((this.getAttribute('label') || 'Font') + ' ', select);
        this.appendChild(label);
        // The house zoom option sits with the font choice: both are "how the page reads".
        if (!this.hasAttribute('no-zoom-option')) {
          var zl = document.createElement('label');
          zl.style.cssText = 'display:block;margin-top:.35em';
          var zc = document.createElement('input');
          zc.type = 'checkbox'; zc.checked = zoomAllowed();
          zc.addEventListener('change', function () { setZoomAllowed(zc.checked); });
          document.addEventListener('app-zoom-change', function () { zc.checked = zoomAllowed(); });
          zl.append(zc, ' Allow pinch-zoom');
          this.appendChild(zl);
        }
        // Every app has this picker in its settings, so the running build is shown under it.
        // Opt out with <app-font-picker no-build>, and place <app-build-info> yourself.
        if (!this.hasAttribute('no-build') && !document.querySelector('app-build-info')) {
          var info = document.createElement('app-build-info');
          info.style.cssText = 'display:block;margin-top:.35em;font-size:.85em;opacity:.7';
          this.appendChild(info);
        }
        // ...and the About panel (version, licence, data, storage, what's new, diagnostics).
        // A page that places its own <app-about>, or sets no-about here, gets none added.
        if (!this.hasAttribute('no-about') && !document.querySelector('app-about')) {
          var about = document.createElement('app-about');
          about.style.cssText = 'display:block;margin-top:.5em';
          this.appendChild(about);
        }
      }
    });
  }

  // ---- House extras. This is the one script every app loads, so three small house
  // ---- standards live here rather than being copied into eighteen codebases.

  // 1. Data safety: ask the browser not to evict this origin's storage under disk pressure.
  try {
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persisted().then(function (kept) { if (!kept) navigator.storage.persist(); }).catch(function () {});
    }
  } catch (e) { /* not available (old browser, file://) */ }

  // 2. Updates are visible: <app-build-info> names the build that is actually running.
  // An app may declare <meta name="app-version" content="1.4.2">; otherwise the page's own
  // Last-Modified time identifies the build (a cached page keeps the header it was served with).
  function buildLabel() {
    var meta = document.querySelector('meta[name="app-version"]');
    var when = new Date(document.lastModified);
    var built = isNaN(when) ? '' : when.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    return (meta && meta.content ? 'Version ' + meta.content + (built ? ' · ' : '') : 'Build ') + built;
  }
  if (window.customElements && !customElements.get('app-build-info')) {
    customElements.define('app-build-info', class extends HTMLElement {
      connectedCallback() { if (!this.textContent) this.textContent = buildLabel(); }
    });
  }

  // 3. ...and the reader is told when a newer build is ready. Set window.appUpdateNotice = false
  // before this script in an app that shows its own.
  function updateNotice() {
    if (window.appUpdateNotice === false || document.getElementById('app-update-notice')) return;
    var bar = document.createElement('div');
    bar.id = 'app-update-notice';
    bar.setAttribute('role', 'status');
    bar.style.cssText = 'position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:2147483000;' +
      'display:flex;gap:12px;align-items:center;max-width:calc(100vw - 24px);padding:10px 14px;border-radius:10px;' +
      'background:#1d2430;color:#f2ece1;font:14px/1.3 var(--app-font,system-ui,sans-serif);box-shadow:0 6px 24px rgba(0,0,0,.45)';
    var text = document.createElement('span');
    text.textContent = 'A new version is ready.';
    var btn = function (label, fn) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = label; b.addEventListener('click', fn);
      b.style.cssText = 'font:inherit;color:inherit;background:transparent;border:1px solid currentColor;border-radius:7px;padding:4px 10px;cursor:pointer';
      return b;
    };
    bar.append(text, btn('Reload', function () { location.reload(); }), btn('Later', function () { bar.remove(); }));
    document.documentElement.appendChild(bar); // on <html>, so an app re-rendering <body> cannot wipe it
  }
  try {
    if ('serviceWorker' in navigator) {
      var sw = navigator.serviceWorker;
      var hadController = !!sw.controller; // a first install is not an update
      sw.addEventListener('controllerchange', function () { if (hadController) updateNotice(); });
      sw.getRegistration().then(function (reg) {
        if (!reg) return;
        if (reg.waiting && sw.controller) updateNotice();
        reg.addEventListener('updatefound', function () {
          var next = reg.installing;
          if (next) next.addEventListener('statechange', function () { if (next.state === 'installed' && sw.controller) updateNotice(); });
        });
      }).catch(function () {});
    }
  } catch (e) { /* file:// or a locked-down browser */ }

  // 4. Crashes are shown, not swallowed: an uncaught error gets a visible notice with a way out,
  // instead of a frozen or blank screen. Shown once per page. Set window.appCrashNotice = false before
  // this script in an app that has its own error screen.
  // ponytail: noise filter is a short deny-list (benign browser warnings, extensions, opaque
  // cross-origin "Script error."); extend it if a real app keeps tripping it.
  var NOISE = /ResizeObserver loop|Script error\.?$|chrome-extension:|moz-extension:|safari-extension:|AbortError|The user aborted|NotAllowedError/;
  var crashShown = false;
  function crashNotice(detail) {
    if (crashShown || window.appCrashNotice === false) return;
    crashShown = true;
    var bar = document.createElement('div');
    bar.id = 'app-crash-notice';
    bar.setAttribute('role', 'alert');
    bar.style.cssText = 'position:fixed;left:50%;top:calc(12px + env(safe-area-inset-top,0px));transform:translateX(-50%);z-index:2147483001;' +
      'display:flex;flex-wrap:wrap;gap:10px;align-items:center;max-width:calc(100vw - 24px);padding:10px 14px;border-radius:10px;' +
      'background:#5c1d24;color:#fff;font:14px/1.3 var(--app-font,system-ui,sans-serif);box-shadow:0 6px 24px rgba(0,0,0,.45)';
    var text = document.createElement('span');
    text.textContent = 'Something went wrong. Your saved data is safe.';
    var btn = function (label, fn) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = label; b.addEventListener('click', fn);
      b.style.cssText = 'font:inherit;color:inherit;background:transparent;border:1px solid currentColor;border-radius:7px;padding:4px 10px;cursor:pointer';
      return b;
    };
    var more = document.createElement('pre');
    more.style.cssText = 'display:none;flex-basis:100%;margin:0;max-height:30vh;overflow:auto;white-space:pre-wrap;font:12px/1.35 ui-monospace,Consolas,monospace;opacity:.9';
    more.textContent = String(detail || '').slice(0, 4000);
    var copy = btn('Copy diagnostics', function () { copyDiagnostics(copy); });
    bar.append(text,
      btn('Reload', function () { location.reload(); }),
      btn('Details', function () { more.style.display = more.style.display === 'none' ? 'block' : 'none'; }),
      copy,
      btn('Dismiss', function () { bar.remove(); }),
      more);
    document.documentElement.appendChild(bar); // on <html>, so an app re-rendering <body> cannot wipe it
  }
  var recentErrors = []; // the last few real errors, for the diagnostics report
  function onCrash(msg, stack) {
    var s = String(msg || '') + (stack ? '\n' + stack : '');
    if (!msg || NOISE.test(s)) return;
    recentErrors.push(new Date().toISOString() + '  ' + s.slice(0, 1500));
    if (recentErrors.length > 10) recentErrors.shift();
    crashNotice(s);
  }
  window.addEventListener('error', function (e) {
    if (e.target && e.target !== window) return; // a failed <img>/<script> load is not a crash
    onCrash(e.message, e.error && e.error.stack);
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    onCrash(r && (r.message || String(r)), r && r.stack);
  });

  // ---- About this app, what's new, diagnostics, offline and storage (house standards) ----------------
  // An app describes itself with optional <meta> tags; every one has a default:
  //   <meta name="app-name" content="Mise">                 (default: the page title)
  //   <meta name="app-whatsnew" content="whatsnew.json">     (no default: no what's-new without it)
  //   <meta name="app-license" content="MIT">                (default: MIT)
  //   <meta name="app-source" content="https://github.com/…"> (default: github.com/adervec/<first path segment>)
  //   <meta name="app-data-note" content="…">                 (default: the house wording below)
  // whatsnew.json is newest first: [{ "date": "2026-11-10", "version": "optional", "items": ["…", "…"] }]
  var meta = function (n) { var m = document.querySelector('meta[name="' + n + '"]'); return m && m.content ? m.content : ''; };
  var appName = function () { return meta('app-name') || (document.title || location.pathname).replace(/\s+[—–|-]\s+.*$/, ''); };
  var appKey = function () { return location.pathname.split('/')[1] || 'root'; };
  var sourceUrl = function () { return meta('app-source') || (location.host === 'adervec.github.io' && appKey() !== 'root' ? 'https://github.com/adervec/' + appKey() : ''); };
  var DATA_NOTE = 'Your data stays in this browser on this device. If you connect Google Drive, a copy is kept in a private app folder that only this app can read, not in your Drive files.';
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };

  // What's new: shown once after an update, never on a first visit. Silenced across every app by
  // the "Show what's new after updates" option (localStorage maker-whatsnew-off).
  var WN_OFF = 'maker-whatsnew-off';
  var whatsNewP = null;
  function whatsNew() {
    var url = meta('app-whatsnew');
    if (!url) return Promise.resolve([]);
    return whatsNewP || (whatsNewP = fetch(new URL(url, location.href), { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (j) { return Array.isArray(j) ? j.filter(function (e) { return e && Array.isArray(e.items) && e.items.length; }) : []; })
      .catch(function () { return []; }));
  }
  var entryId = function (e) { return (e.version || '') + '|' + (e.date || '') + '|' + e.items[0]; };
  var whatsNewSilenced = function () { return store.get(WN_OFF) === '1'; };
  function setWhatsNewSilenced(off) { store.set(WN_OFF, off ? '1' : null); document.dispatchEvent(new CustomEvent('app-whatsnew-change')); }
  function listEl(entries) {
    var box = document.createElement('div');
    entries.forEach(function (e) {
      var h = document.createElement('div');
      h.style.cssText = 'font-weight:700;margin:.5em 0 .2em';
      h.textContent = [e.version && 'Version ' + e.version, e.date].filter(Boolean).join(' · ') || 'Update';
      var ul = document.createElement('ul');
      ul.style.cssText = 'margin:0;padding-left:1.2em';
      e.items.forEach(function (t) { var li = document.createElement('li'); li.textContent = t; ul.appendChild(li); });
      box.append(h, ul);
    });
    return box;
  }
  function showWhatsNew(entries) {
    if (document.getElementById('app-whatsnew')) return;
    var card = document.createElement('div');
    card.id = 'app-whatsnew';
    card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', "What's new");
    card.style.cssText = 'position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:2147482999;' +
      'width:min(440px,calc(100vw - 24px));max-height:60vh;overflow:auto;padding:14px 16px;border-radius:12px;' +
      'background:#1d2430;color:#f2ece1;font:14px/1.4 var(--app-font,system-ui,sans-serif);box-shadow:0 8px 28px rgba(0,0,0,.5)';
    var title = document.createElement('div');
    title.style.cssText = 'font-size:1.1em;font-weight:700';
    title.textContent = "What's new in " + appName();
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;margin-top:12px';
    var btn = function (label, fn) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = label; b.addEventListener('click', fn);
      b.style.cssText = 'font:inherit;color:inherit;background:transparent;border:1px solid currentColor;border-radius:7px;padding:4px 10px;cursor:pointer';
      return b;
    };
    row.append(btn("Don't show these", function () { setWhatsNewSilenced(true); card.remove(); }), btn('OK', function () { card.remove(); }));
    card.append(title, listEl(entries), row);
    document.documentElement.appendChild(card);
  }
  function checkWhatsNew() {
    return whatsNew().then(function (list) {
      if (!list.length) return;
      var k = 'maker-seen:' + appKey(), seen = store.get(k), newest = entryId(list[0]);
      store.set(k, newest);
      if (!seen || seen === newest || whatsNewSilenced()) return; // first visit, nothing new, or silenced
      var fresh = [];
      for (var i = 0; i < list.length && i < 5 && entryId(list[i]) !== seen; i++) fresh.push(list[i]);
      if (fresh.length) showWhatsNew(fresh);
    });
  }
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', checkWhatsNew) : checkWhatsNew();

  // Offline: a small pill while the device has no connection, so a failed sync is not a mystery.
  function offlinePill() {
    var id = 'app-offline', el = document.getElementById(id);
    if (navigator.onLine) { if (el) el.remove(); return; }
    if (el) return;
    el = document.createElement('div');
    el.id = id; el.setAttribute('role', 'status');
    el.textContent = 'Offline — changes are saved on this device';
    el.style.cssText = 'position:fixed;left:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:2147482998;padding:4px 10px;border-radius:999px;' +
      'background:#3a3f4b;color:#fff;font:12px/1.3 var(--app-font,system-ui,sans-serif);opacity:.92;pointer-events:none';
    document.documentElement.appendChild(el); // on <html>, so an app re-rendering <body> cannot wipe it
  }
  window.addEventListener('online', offlinePill);
  window.addEventListener('offline', offlinePill);
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', offlinePill) : offlinePill();

  // Storage: how much this site is using, and whether the browser has promised to keep it.
  function storageInfo() {
    if (!(navigator.storage && navigator.storage.estimate)) return Promise.resolve(null);
    return Promise.all([navigator.storage.estimate(), navigator.storage.persisted ? navigator.storage.persisted() : false])
      .then(function (r) { return { usage: r[0].usage || 0, quota: r[0].quota || 0, persisted: !!r[1] }; })
      .catch(function () { return null; });
  }
  var mb = function (n) { return n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : (n / 1e6).toFixed(n < 1e7 ? 1 : 0) + ' MB'; };
  var storageText = function (s) {
    return s ? mb(s.usage) + ' used of ' + mb(s.quota) + ' available' + (s.persisted ? ' · kept by the browser' : ' · the browser may clear it if space runs low')
      : 'Not reported by this browser';
  };

  // Diagnostics: one paste that tells an agent what it needs. No personal data: no account, no
  // app content, only versions, settings of this script, and the last errors.
  function diagnostics() {
    return Promise.all([storageInfo(), navigator.serviceWorker && navigator.serviceWorker.getRegistration ? navigator.serviceWorker.getRegistration().catch(function () { return null; }) : null])
      .then(function (r) {
        var s = r[0], reg = r[1];
        return [
          appName() + ' diagnostics · ' + new Date().toISOString(),
          'Page: ' + location.origin + location.pathname,
          'Build: ' + buildLabel(),
          'Browser: ' + navigator.userAgent,
          'Screen: ' + innerWidth + '×' + innerHeight + ' @' + (window.devicePixelRatio || 1) + 'x · ' + (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') + ' system theme',
          'Online: ' + navigator.onLine,
          'Storage: ' + storageText(s),
          'Service worker: ' + (reg ? (reg.active ? reg.active.state : 'none active') + (reg.waiting ? ' · update waiting' : '') : 'not registered'),
          'Font: ' + get() + ' · pinch-zoom ' + (zoomAllowed() ? 'on' : 'off') + ' · what\'s new ' + (whatsNewSilenced() ? 'silenced' : 'on'),
          'Recent errors: ' + (recentErrors.length ? '\n  ' + recentErrors.join('\n  ') : 'none'),
        ].join('\n');
      });
  }
  function copyDiagnostics(button) {
    return diagnostics().then(function (text) {
      var done = function (ok) { if (button) { var t = button.textContent; button.textContent = ok ? 'Copied' : 'Copy failed'; setTimeout(function () { button.textContent = t; }, 1500); } return text; };
      return navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(text).then(function () { return done(true); }, function () { return done(false); }) : done(false);
    });
  }

  // <app-about>: a collapsed "About this app" panel. <app-font-picker> adds one by itself unless the
  // page places its own (or the picker has the no-about attribute).
  if (window.customElements && !customElements.get('app-about')) {
    customElements.define('app-about', class extends HTMLElement {
      connectedCallback() {
        if (this.firstChild) return;
        var d = document.createElement('details');
        var sum = document.createElement('summary');
        sum.textContent = 'About ' + appName();
        sum.style.cursor = 'pointer';
        var body = document.createElement('div');
        body.style.cssText = 'margin-top:.5em;display:grid;gap:.45em;font-size:.95em';
        var line = function (label, value) {
          var p = document.createElement('div');
          var b = document.createElement('b'); b.textContent = label + ': ';
          p.append(b, value); return p;
        };
        var src = sourceUrl(), a;
        if (src) { a = document.createElement('a'); a.href = src; a.target = '_blank'; a.rel = 'noopener'; a.textContent = src.replace(/^https:\/\//, ''); }
        var stor = document.createElement('span'); stor.textContent = '…';
        var net = document.createElement('span');
        var setNet = function () { net.textContent = navigator.onLine ? 'online' : 'offline'; };
        setNet(); window.addEventListener('online', setNet); window.addEventListener('offline', setNet);
        body.append(
          line('Version', buildLabel()),
          line('Licence', meta('app-license') || 'MIT'),
          line('Your data', meta('app-data-note') || DATA_NOTE),
          line('Storage', stor),
          line('Connection', net));
        if (a) body.appendChild(line('Source', a));
        var wn = document.createElement('div');
        body.appendChild(wn);
        if (meta('app-whatsnew')) {
          var wl = document.createElement('label');
          var wc = document.createElement('input');
          wc.type = 'checkbox'; wc.checked = !whatsNewSilenced();
          wc.addEventListener('change', function () { setWhatsNewSilenced(!wc.checked); });
          document.addEventListener('app-whatsnew-change', function () { wc.checked = !whatsNewSilenced(); });
          wl.append(wc, " Show what's new after updates");
          body.appendChild(wl);
        }
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px';
        var copy = document.createElement('button');
        copy.type = 'button'; copy.textContent = 'Copy diagnostics';
        copy.addEventListener('click', function () { copyDiagnostics(copy); });
        var dl = document.createElement('button');
        dl.type = 'button'; dl.textContent = 'Download diagnostics';
        dl.addEventListener('click', function () {
          diagnostics().then(function (t) {
            var u = URL.createObjectURL(new Blob([t], { type: 'text/plain' })), x = document.createElement('a');
            x.href = u; x.download = appKey() + '-diagnostics.txt'; document.body.appendChild(x); x.click(); x.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 1000);
          });
        });
        row.append(copy, dl);
        body.appendChild(row);
        d.append(sum, body);
        this.appendChild(d);
        d.addEventListener('toggle', function () {
          if (!d.open) return;
          storageInfo().then(function (s) { stor.textContent = storageText(s); });
          whatsNew().then(function (list) {
            wn.textContent = '';
            if (!list.length) return;
            var h = document.createElement('b'); h.textContent = "What's new";
            wn.append(h, listEl(list.slice(0, 5)));
          });
        });
      }
    });
  }

  // The device's light/dark preference, for an app picking its DEFAULT theme: use it only when the
  // reader has not chosen a theme themselves; never let it override a saved choice.
  var darkQuery = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  function systemTheme() { return darkQuery && darkQuery.matches ? 'dark' : 'light'; }

  window.appFont = { options: options, get: get, set: set, buildLabel: buildLabel, updateNotice: updateNotice,
    zoomAllowed: zoomAllowed, setZoomAllowed: setZoomAllowed, crashNotice: crashNotice,
    diagnostics: diagnostics, copyDiagnostics: copyDiagnostics, storageInfo: storageInfo, systemTheme: systemTheme,
    whatsNew: whatsNew, checkWhatsNew: checkWhatsNew, setWhatsNewSilenced: setWhatsNewSilenced };
})();
