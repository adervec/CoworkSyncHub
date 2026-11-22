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
//   a script tag with src https://adervec.github.io/font.js, in <head>, not deferred
//   body { font-family: var(--app-font, <the app's old font stack>); }
// and, somewhere in the app's settings:
//   <app-font-picker></app-font-picker>
// Apps with their own settings UI can skip the element and call appFont.options / get() / set().
//
// The choice lives in localStorage, so on adervec.github.io — one origin for every app —
// picking a font in one app changes it in all of them.
// ponytail: family only, four choices. Add sizes or uploads here if anyone ever asks.
// This file must never contain the characters that close an HTML script element, so that a
// single-file app can inline it verbatim (see standards.mjs: <script data-house="font.js">).
(function () {
  if (window.appFont) return;
  var KEY = 'maker-font';
  // fonts/ sits beside this script wherever it is served from. An app that INLINES this script (a
  // single-file app) has no script src, so it sets window.appFontBase to its own fonts/ folder.
  var BASE = window.appFontBase || new URL('fonts/', (document.currentScript && document.currentScript.src) || location.href).href;
  var options = [
    { id: 'atkinson', label: 'Atkinson Hyperlegible', stack: '"Atkinson Hyperlegible", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
    { id: 'system', label: 'System', i18n: true, stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
    { id: 'serif', label: 'Serif', i18n: true, stack: 'Georgia, "Times New Roman", serif' },
    { id: 'mono', label: 'Monospace', i18n: true, stack: 'ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace' },
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
        if (!houseReady && lang() !== 'en') { var me = this; ready.then(function () { if (!me.firstChild) me.connectedCallback(); }); return; }
        var label = document.createElement('label');
        var select = document.createElement('select');
        options.forEach(function (o) { var el = document.createElement('option'); el.value = o.id; el.textContent = o.i18n ? tr(o.label) : o.label; select.appendChild(el); });
        select.value = get();
        select.addEventListener('change', function () { set(select.value); });
        document.addEventListener('app-font-change', function () { select.value = get(); });
        label.append((this.getAttribute('label') || tr('Font')) + ' ', select);
        this.appendChild(label);
        // The house zoom option sits with the font choice: both are "how the page reads".
        if (!this.hasAttribute('no-zoom-option')) {
          var zl = document.createElement('label');
          zl.style.cssText = 'display:block;margin-top:.35em';
          var zc = document.createElement('input');
          zc.type = 'checkbox'; zc.checked = zoomAllowed();
          zc.addEventListener('change', function () { setZoomAllowed(zc.checked); });
          document.addEventListener('app-zoom-change', function () { zc.checked = zoomAllowed(); });
          zl.append(zc, ' ' + tr('Allow pinch-zoom'));
          this.appendChild(zl);
        }
        // Language and regional settings, shared by every app (house standard). A change reloads the page.
        if (!this.hasAttribute('no-region')) {
          var row = function (labelText, opts, current, onPick) {
            var l = document.createElement('label'), s = document.createElement('select');
            l.style.cssText = 'display:block;margin-top:.35em';
            opts.forEach(function (o) { var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; s.appendChild(op); });
            s.value = current;
            s.addEventListener('change', function () { onPick(s.value); });
            l.append(labelText + ' ', s);
            return l;
          };
          var auto = tr('Automatic');
          this.appendChild(row(tr('Language'), LANGS.map(function (L) { return [L.id, L.name + (L.id === 'en' ? '' : ' · ' + tr('machine translated'))]; }), lang(), function (v) { setRegional(LKEY, v); }));
          this.appendChild(row(tr('Units'), [['auto', auto + ' (' + (units() === 'imperial' ? tr('imperial') : tr('metric')) + ')'], ['metric', tr('Metric (km, kg)')], ['imperial', tr('Imperial (mi, lb)')]], store.get(UKEY) || 'auto', function (v) { setRegional(UKEY, v); }));
          var dayName = function (d) { return new Intl.DateTimeFormat(locale(), { weekday: 'long' }).format(new Date(2026, 0, 4 + d)); };
          this.appendChild(row(tr('First day of the week'), [['auto', auto + ' (' + dayName(weekStart()) + ')'], ['mon', dayName(1)], ['sun', dayName(0)], ['sat', dayName(6)]], store.get(WKEY) || 'auto', function (v) { setRegional(WKEY, v); }));
          this.appendChild(row(tr('Dates'), [['iso', 'ISO 8601 (' + isoDate(new Date()) + ' ' + isoTime(new Date()) + ')'], ['regional', tr('Regional') + ' (' + new Intl.DateTimeFormat(locale(), { dateStyle: 'medium' }).format(new Date()) + ')']], dates(), function (v) { setRegional(DKEY, v === 'iso' ? null : v); }));
          this.appendChild(row(tr('Clock'), [['auto', auto + ' (' + (clock() === '12' ? tr('12-hour') : tr('24-hour')) + ')'], ['24', tr('24-hour')], ['12', tr('12-hour')]], store.get(CKEY) || 'auto', function (v) { setRegional(CKEY, v); }));
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
    var built = isNaN(when) ? '' : fmt.dateTime(when);
    return meta && meta.content ? tr('Version {version}', { version: meta.content }) + (built ? ' · ' + built : '') : tr('Build {date}', { date: built });
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
    text.textContent = tr('A new version is ready.');
    var btn = function (label, fn) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = label; b.addEventListener('click', fn);
      b.style.cssText = 'font:inherit;color:inherit;background:transparent;border:1px solid currentColor;border-radius:7px;padding:4px 10px;cursor:pointer';
      return b;
    };
    bar.append(text, btn(tr('Reload'), function () { location.reload(); }), btn(tr('Later'), function () { bar.remove(); }));
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
    text.textContent = tr('Something went wrong. Your saved data is safe.');
    var btn = function (label, fn) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = label; b.addEventListener('click', fn);
      b.style.cssText = 'font:inherit;color:inherit;background:transparent;border:1px solid currentColor;border-radius:7px;padding:4px 10px;cursor:pointer';
      return b;
    };
    var more = document.createElement('pre');
    more.style.cssText = 'display:none;flex-basis:100%;margin:0;max-height:30vh;overflow:auto;white-space:pre-wrap;font:12px/1.35 ui-monospace,Consolas,monospace;opacity:.9';
    more.textContent = String(detail || '').slice(0, 4000);
    var copy = btn(tr('Copy diagnostics'), function () { copyDiagnostics(copy); });
    bar.append(text,
      btn(tr('Reload'), function () { location.reload(); }),
      btn(tr('Details'), function () { more.style.display = more.style.display === 'none' ? 'block' : 'none'; }),
      copy,
      btn(tr('Dismiss'), function () { bar.remove(); }),
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
  // i18n-keys: System | Serif | Monospace | Your data stays in this browser on this device. If you connect Google Drive, a copy is kept in a private app folder that only this app can read, not in your Drive files.
  var DATA_NOTE ='Your data stays in this browser on this device. If you connect Google Drive, a copy is kept in a private app folder that only this app can read, not in your Drive files.';
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
      h.textContent = [e.version && tr('Version {version}', { version: e.version }), e.date && fmt.date(e.date + 'T00:00:00')].filter(Boolean).join(' · ') || tr('Update');
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
    card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', tr("What's new"));
    card.style.cssText = 'position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:2147482999;' +
      'width:min(440px,calc(100vw - 24px));max-height:60vh;overflow:auto;padding:14px 16px;border-radius:12px;' +
      'background:#1d2430;color:#f2ece1;font:14px/1.4 var(--app-font,system-ui,sans-serif);box-shadow:0 8px 28px rgba(0,0,0,.5)';
    var title = document.createElement('div');
    title.style.cssText = 'font-size:1.1em;font-weight:700';
    title.textContent = tr("What's new in {app}", { app: appName() });
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;margin-top:12px';
    var btn = function (label, fn) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = label; b.addEventListener('click', fn);
      b.style.cssText = 'font:inherit;color:inherit;background:transparent;border:1px solid currentColor;border-radius:7px;padding:4px 10px;cursor:pointer';
      return b;
    };
    row.append(btn(tr("Don't show these"), function () { setWhatsNewSilenced(true); card.remove(); }), btn(tr('OK'), function () { card.remove(); }));
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
    el.textContent = tr('Offline — changes are saved on this device');
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
  var mb = function (n) { return n >= 1e9 ? fmt.unit(n / 1e9, 'gigabyte', 1) : fmt.unit(n / 1e6, 'megabyte', n < 1e7 ? 1 : 0); };
  var storageText = function (s) {
    return s ? tr('{used} used of {quota} available', { used: mb(s.usage), quota: mb(s.quota) }) + ' · ' + (s.persisted ? tr('kept by the browser') : tr('the browser may clear it if space runs low'))
      : tr('Not reported by this browser');
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
      }).then(redact);
  }
  function copyDiagnostics(button) {
    return diagnostics().then(function (text) {
      var done = function (ok) { if (button) { var t = button.textContent; button.textContent = ok ? tr('Copied') : tr('Copy failed'); setTimeout(function () { button.textContent = t; }, 1500); } return text; };
      return navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(text).then(function () { return done(true); }, function () { return done(false); }) : done(false);
    });
  }

  // <app-about>: a collapsed "About this app" panel. <app-font-picker> adds one by itself unless the
  // page places its own (or the picker has the no-about attribute).
  if (window.customElements && !customElements.get('app-about')) {
    customElements.define('app-about', class extends HTMLElement {
      connectedCallback() {
        if (this.firstChild) return;
        if (!houseReady && lang() !== 'en') { var me = this; ready.then(function () { if (!me.firstChild) me.connectedCallback(); }); return; }
        var d = document.createElement('details');
        var sum = document.createElement('summary');
        sum.textContent = tr('About {app}', { app: appName() });
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
        var setNet = function () { net.textContent = navigator.onLine ? tr('online') : tr('offline'); };
        setNet(); window.addEventListener('online', setNet); window.addEventListener('offline', setNet);
        body.append(
          line(tr('Version'), buildLabel()),
          line(tr('Language'), langInfo(lang()).name + (lang() === 'en' ? '' : ' · ' + tr('machine translated from English, unchecked'))),
          line(tr('Licence'), meta('app-license') || 'MIT'),
          line(tr('Your data'), meta('app-data-note') ? t(meta('app-data-note')) : tr(DATA_NOTE)),
          line(tr('Storage'), stor),
          line(tr('Connection'), net));
        if (a) body.appendChild(line(tr('Source'), a));
        var wn = document.createElement('div');
        body.appendChild(wn);
        if (meta('app-whatsnew')) {
          var wl = document.createElement('label');
          var wc = document.createElement('input');
          wc.type = 'checkbox'; wc.checked = !whatsNewSilenced();
          wc.addEventListener('change', function () { setWhatsNewSilenced(!wc.checked); });
          document.addEventListener('app-whatsnew-change', function () { wc.checked = !whatsNewSilenced(); });
          wl.append(wc, ' ' + tr("Show what's new after updates"));
          body.appendChild(wl);
        }
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px';
        var copy = document.createElement('button');
        copy.type = 'button'; copy.textContent = tr('Copy diagnostics');
        copy.addEventListener('click', function () { copyDiagnostics(copy); });
        var dl = document.createElement('button');
        dl.type = 'button'; dl.textContent = tr('Download diagnostics');
        dl.addEventListener('click', function () {
          diagnostics().then(function (t) {
            var u = URL.createObjectURL(new Blob([t], { type: 'text/plain' })), x = document.createElement('a');
            x.href = u; x.download = appKey() + '-diagnostics.txt'; document.body.appendChild(x); x.click(); x.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 1000);
          });
        });
        row.append(copy, dl);
        // Cold backup: everything this browser holds for the apps, as one file (the hub's Backup page does
        // the same with more choice; this button is the only way in for an iPhone home-screen app).
        var bk = document.createElement('button');
        bk.type = 'button'; bk.textContent = tr('Back up my data');
        bk.addEventListener('click', function () {
          bk.disabled = true;
          backupDownload().then(function () { bk.textContent = tr('Back up my data'); }, function () { bk.textContent = tr('Backup failed'); })
            .then(function () { bk.disabled = false; });
        });
        row.appendChild(bk);
        // Send feedback: a new issue on the app's GitHub page, with the (redacted) diagnostics filled in.
        // ponytail: needs a GitHub account; add a no-account route (a form) when users ask for one.
        if (/^https:\/\/github\.com\//.test(sourceUrl())) {
          var fb = document.createElement('button');
          fb.type = 'button'; fb.textContent = tr('Send feedback');
          fb.addEventListener('click', function () {
            diagnostics().then(function (t) {
              window.open(sourceUrl().replace(/\/$/, '') + '/issues/new?body=' + encodeURIComponent('What happened, or what would you like?\n\n\n---\n' + t.slice(0, 3000)), '_blank', 'noopener');
            });
          });
          row.appendChild(fb);
        }
        body.appendChild(row);
        d.append(sum, body);
        this.appendChild(d);
        d.addEventListener('toggle', function () {
          if (!d.open) return;
          storageInfo().then(function (s) { stor.textContent = storageText(s); });
          whatsNew().then(function (list) {
            wn.textContent = '';
            if (!list.length) return;
            var h = document.createElement('b'); h.textContent = tr("What's new");
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

  // ---- The signed-in account, always visible (house standard) -----------------------------------
  // Like YouTube's corner avatar: while this app syncs to Google Drive, the account's picture sits in
  // the app's top bar on every screen, not only in settings. The app reports the account once it knows
  // it, and clears it on sign-out:
  //   appFont.setAccount({ name, email, picture })   // after the Drive sign-in / userinfo
  //   appFont.setAccount(null)                        // on disconnect
  // and places <app-account></app-account> in its header. The account is remembered per app, so the
  // picture is there immediately on the next visit, before the silent reconnect finishes. Clicking it
  // fires `app-account-click` on document, so the app can open its sync settings.
  var ACCT = function () { return 'maker-account:' + appKey(); };
  function getAccount() { try { return JSON.parse(store.get(ACCT()) || 'null'); } catch (e) { return null; } }
  function setAccount(a) {
    var clean = a && (a.picture || a.name || a.email) ? { name: a.name || '', email: a.email || '', picture: /^https:\/\//.test(a.picture || '') ? a.picture : '' } : null;
    store.set(ACCT(), clean ? JSON.stringify(clean) : null);
    document.dispatchEvent(new CustomEvent('app-account-change', { detail: clean }));
  }
  if (window.customElements && !customElements.get('app-account')) {
    customElements.define('app-account', class extends HTMLElement {
      connectedCallback() {
        var self = this;
        this._draw = function () {
          var a = getAccount();
          self.textContent = '';
          self.style.display = a ? 'inline-flex' : 'none';
          // <app-account corner>: for an app with no shared top bar, pin it top-right on every page
          if (self.hasAttribute('corner')) {
            self.style.position = 'fixed'; self.style.top = 'calc(10px + env(safe-area-inset-top, 0px))';
            self.style.right = 'calc(12px + env(safe-area-inset-right, 0px))'; self.style.zIndex = '2147482990';
          }
          if (!a) return;
          var who = a.name || a.email || tr('Google account');
          var b = document.createElement('button');
          b.type = 'button';
          b.title = tr('Signed in as {who}', { who: who + (a.email && a.name ? ' (' + a.email + ')' : '') }) + ' · ' + tr('syncing to Google Drive');
          b.setAttribute('aria-label', b.title);
          b.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:0;border:0;background:none;color:inherit;font:inherit;cursor:pointer;line-height:1';
          var size = self.getAttribute('size') || '28';
          if (a.picture) {
            var img = document.createElement('img');
            img.src = a.picture; img.alt = ''; img.referrerPolicy = 'no-referrer';
            img.width = img.height = +size;
            img.style.cssText = 'width:' + size + 'px;height:' + size + 'px;border-radius:50%;object-fit:cover;display:block;box-shadow:0 0 0 2px rgba(127,127,127,.35)';
            // a picture that will not load falls back to the initial, never a broken image
            img.onerror = function () { img.replaceWith(initial(who, size)); };
            b.appendChild(img);
          } else b.appendChild(initial(who, size));
          if (self.hasAttribute('show-name')) { var n = document.createElement('span'); n.textContent = who; b.appendChild(n); }
          b.addEventListener('click', function () { document.dispatchEvent(new CustomEvent('app-account-click', { detail: a })); });
          self.appendChild(b);
        };
        document.addEventListener('app-account-change', this._draw);
        this._draw();
      }
      disconnectedCallback() { document.removeEventListener('app-account-change', this._draw); }
    });
  }
  function initial(who, size) {
    var s = document.createElement('span');
    s.textContent = (who || '?').trim().charAt(0).toUpperCase();
    s.style.cssText = 'width:' + size + 'px;height:' + size + 'px;border-radius:50%;display:inline-grid;place-items:center;background:#4c6fff;color:#fff;font-weight:700;font-size:' + Math.round(size * 0.5) + 'px';
    return s;
  }

  // ---- Languages, regional settings and translation (house standard) ----------------------------
  // Every app is written in English; the other languages are MACHINE translated (by agent sessions,
  // with CoworkSyncHub/i18n.mjs) and say so. An app writes English straight into its code:
  //   t('Saved {n} minis', { n })            the English text IS the key; untranslated text stays English
  //   t.n('{n} mini', '{n} minis', count)    plurals follow each language's own rules
  //   <span data-t>Settings</span>            static HTML (data-t-attr="title,placeholder" for attributes)
  // and declares where its translations live: <meta name="app-locales" content="locales/">.
  // Dates, numbers, distances and weights go through appFont.fmt (Intl), never toFixed or
  // hand-written month names. Language, units, first day of the week and the clock are shared
  // across every app on this origin, like the font, and picked under the font picker.
  var LANGS = [
    { id: 'en', name: 'English' }, { id: 'fr', name: 'Français' }, { id: 'es', name: 'Español' },
    { id: 'pt', name: 'Português' }, { id: 'it', name: 'Italiano' }, { id: 'hr', name: 'Hrvatski' },
    { id: 'de', name: 'Deutsch' }, { id: 'zh', name: '中文（简体）', bcp: 'zh-CN' }, { id: 'uk', name: 'Українська' },
    { id: 'eo', name: 'Esperanto' }, { id: 'sw', name: 'Kiswahili' }, { id: 'hi', name: 'हिन्दी' },
    { id: 'bn', name: 'বাংলা' }, { id: 'id', name: 'Bahasa Indonesia' }, { id: 'ur', name: 'اردو', rtl: true },
    { id: 'fa', name: 'فارسی', rtl: true }, { id: 'ar', name: 'العربية', rtl: true },
  ];
  var LKEY = 'maker-lang', UKEY = 'maker-units', WKEY = 'maker-week', CKEY = 'maker-clock', DKEY = 'maker-dates', MTKEY = 'maker-mt-ack:';
  // House standard 28: dates and times are ISO 8601 (2026-11-21, 14:05, weeks from Monday) unless the
  // reader picks "Regional" under the font picker. One choice for every app, like the language.
  function dates() { return store.get(DKEY) === 'regional' ? 'regional' : 'iso'; }
  var langInfo = function (id) { return LANGS.filter(function (l) { return l.id === id; })[0] || LANGS[0]; };
  function deviceLang() {
    var ls = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en'];
    for (var i = 0; i < ls.length; i++) { var b = String(ls[i]).toLowerCase().split('-')[0]; if (LANGS.some(function (l) { return l.id === b; })) return b; }
    return 'en';
  }
  function lang() { var v = store.get(LKEY); return LANGS.some(function (l) { return l.id === v; }) ? v : deviceLang(); }
  // Formatting locale: the device's own region when it speaks the chosen language (en-GB vs en-US),
  // otherwise the language's default.
  function locale() {
    var info = langInfo(lang()), dev = navigator.language || 'en';
    return dev.toLowerCase().split('-')[0] === info.id ? dev : (info.bcp || info.id);
  }
  function region() { try { return new Intl.Locale(navigator.language || 'en').maximize().region || ''; } catch (e) { return ''; } }
  function units() { var v = store.get(UKEY); return v === 'metric' || v === 'imperial' ? v : (/^(US|LR|MM)$/.test(region()) ? 'imperial' : 'metric'); }
  function weekStart() { // 0 = Sunday, 1 = Monday, 6 = Saturday
    var v = store.get(WKEY);
    if (v === 'sun') return 0; if (v === 'mon') return 1; if (v === 'sat') return 6;
    if (dates() === 'iso') return 1; // ISO 8601: the week starts on Monday
    try { var L = new Intl.Locale(navigator.language || 'en'), w = L.getWeekInfo ? L.getWeekInfo() : L.weekInfo; if (w && w.firstDay) return w.firstDay % 7; } catch (e) { /* older browser */ }
    return 1;
  }
  function clock() { var v = store.get(CKEY); if (v === '12' || v === '24') return v; if (dates() === 'iso') return '24'; try { return /h1[12]/.test(new Intl.DateTimeFormat(navigator.language || 'en', { hour: 'numeric' }).resolvedOptions().hourCycle) ? '12' : '24'; } catch (e) { return '24'; } }
  // a regional change reloads the page, so every screen of every app redraws in it
  function setRegional(key, value) { store.set(key, value == null || value === 'auto' ? null : value); location.reload(); }

  var dict = {}, houseDict = {}, houseReady = false;
  var LOC_BASE = window.appLocaleBase || BASE.replace(/fonts\/$/, 'locales/'); // the house's own translations
  function loadDict(url) { return fetch(url, { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }); }
  function interp(s, p) { return p ? String(s).replace(/\{(\w+)\}/g, function (m, k) { return Object.prototype.hasOwnProperty.call(p, k) ? String(p[k]) : m; }) : String(s); }
  function lookup(d, key, params) { var v = d[key]; return interp(typeof v === 'string' && v ? v : key, params); }
  function plural(d, one, other, n, params) {
    var p = Object.assign({ n: fmtNumber(n) }, params || {}), v = d[one + '|' + other];
    if (v && typeof v === 'object') { var cat; try { cat = new Intl.PluralRules(locale()).select(n); } catch (e) { cat = 'other'; } var s = v[cat] || v.other; if (s) return interp(s, p); }
    return interp(n === 1 ? one : other, p);
  }
  function t(key, params) { return lookup(dict, key, params); }
  t.n = function (one, other, n, params) { return plural(dict, one, other, n, params); };
  function tr(key, params) { return lookup(houseDict, key, params); } // this script's own words
  tr.n = function (one, other, n, params) { return plural(houseDict, one, other, n, params); };

  // static HTML: [data-t] (text) and [data-t-attr="title,placeholder"] (attributes); the English is kept as the key
  function applyDom(root) {
    if (!root || !root.querySelectorAll) return;
    var els = [].slice.call(root.querySelectorAll('[data-t],[data-t-attr]'));
    if (root.matches && root.matches('[data-t],[data-t-attr]')) els.push(root);
    els.forEach(function (el) {
      if (el.hasAttribute('data-t')) { if (el.__tKey == null) el.__tKey = el.getAttribute('data-t') || el.textContent.trim(); el.textContent = t(el.__tKey); }
      var attrs = el.getAttribute('data-t-attr');
      if (attrs) { el.__tAttr = el.__tAttr || {}; attrs.split(',').forEach(function (a) { a = a.trim(); if (!a) return; if (el.__tAttr[a] == null) el.__tAttr[a] = el.getAttribute(a) || ''; el.setAttribute(a, t(el.__tAttr[a])); }); }
    });
  }

  // formatting: always the shared locale, units, week start and clock
  function fmtNumber(n, o) { o = o || {}; try { return new Intl.NumberFormat(locale(), { maximumFractionDigits: o.max != null ? o.max : 2, minimumFractionDigits: o.min || 0 }).format(n); } catch (e) { return String(n); } }
  var asDate = function (d) { return d instanceof Date ? d : new Date(d); };
  var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
  // ISO 8601 pieces, always in the reader's LOCAL day and time (house standards 10 and 28)
  var isoDate = function (d) { d = asDate(d); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); };
  var isoTime = function (d) { d = asDate(d); return p2(d.getHours()) + ':' + p2(d.getMinutes()); };
  var clockTime = function (d) { return clock() === '12' ? new Intl.DateTimeFormat(locale(), { timeStyle: 'short', hour12: true }).format(asDate(d)) : isoTime(d); };
  var fmt = {
    number: fmtNumber,
    percent: function (x, max) { return new Intl.NumberFormat(locale(), { style: 'percent', maximumFractionDigits: max == null ? 0 : max }).format(x); },
    // What the reader sees. ISO by default: 2026-11-21, 14:05, 2026-11-21 14:05; style 'full' adds the weekday
    // (Sat 2026-11-21). With "Regional" chosen these follow the language and region instead.
    date: function (d, style) {
      if (dates() === 'iso') return (style === 'full' ? new Intl.DateTimeFormat(locale(), { weekday: 'short' }).format(asDate(d)) + ' ' : '') + isoDate(d);
      return new Intl.DateTimeFormat(locale(), { dateStyle: style || 'medium' }).format(asDate(d));
    },
    time: function (d) { return dates() === 'iso' ? clockTime(d) : new Intl.DateTimeFormat(locale(), { timeStyle: 'short', hour12: clock() === '12' }).format(asDate(d)); },
    dateTime: function (d, style) {
      if (dates() === 'iso') return fmt.date(d, style) + ' ' + clockTime(d);
      return new Intl.DateTimeFormat(locale(), { dateStyle: style || 'medium', timeStyle: 'short', hour12: clock() === '12' }).format(asDate(d));
    },
    // What is stored, exported or put in a file name: never changes with the reader's choice.
    isoDate: isoDate,                                   // 2026-11-21 (the local day)
    iso: function (d) {                                 // 2026-11-21T14:05:09+01:00 (local time with its offset)
      d = asDate(d); var o = -d.getTimezoneOffset(), a = Math.abs(o);
      return isoDate(d) + 'T' + isoTime(d) + ':' + p2(d.getSeconds()) + (o === 0 ? 'Z' : (o < 0 ? '-' : '+') + p2(Math.floor(a / 60)) + ':' + p2(a % 60));
    },
    isoWeek: function (d) {                             // 2026-W47 (weeks from Monday; week 1 holds the year's first Thursday)
      d = asDate(d); var t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 3 - ((d.getDay() + 6) % 7)), y = t.getFullYear();
      return y + '-W' + p2(1 + Math.round((t - new Date(y, 0, 4)) / 6048e5 + (((new Date(y, 0, 4).getDay() + 6) % 7) - 3) / 7));
    },
    // names only (a month, a weekday): a whole date or time goes through date / time / dateTime above
    custom: function (d, opts) { return new Intl.DateTimeFormat(locale(), Object.assign({ hour12: clock() === '12' }, opts)).format(asDate(d)); },
    relative: function (d) {
      var s = (asDate(d).getTime() - Date.now()) / 1000, a = Math.abs(s), rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
      if (a < 60) return rtf.format(Math.round(s), 'second'); if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
      if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour'); if (a < 7 * 86400) return rtf.format(Math.round(s / 86400), 'day');
      if (a < 30 * 86400) return rtf.format(Math.round(s / (7 * 86400)), 'week'); if (a < 365 * 86400) return rtf.format(Math.round(s / (30 * 86400)), 'month');
      return rtf.format(Math.round(s / (365 * 86400)), 'year');
    },
    unit: function (value, unit, max) { return new Intl.NumberFormat(locale(), { style: 'unit', unit: unit, unitDisplay: 'short', maximumFractionDigits: max == null ? 1 : max }).format(value); },
    // distance in metres -> km / m, or mi / ft
    distance: function (m, max) {
      if (units() === 'imperial') { var mi = m / 1609.344; return mi >= 0.1 ? fmt.unit(mi, 'mile', max == null ? 2 : max) : fmt.unit(m * 3.28084, 'foot', 0); }
      return m >= 1000 ? fmt.unit(m / 1000, 'kilometer', max == null ? 2 : max) : fmt.unit(m, 'meter', 0);
    },
    // weight in kilograms -> kg, or lb
    weight: function (kg, max) { return units() === 'imperial' ? fmt.unit(kg * 2.2046226, 'pound', max == null ? 1 : max) : fmt.unit(kg, 'kilogram', max == null ? 1 : max); },
    list: function (arr) { try { return new Intl.ListFormat(locale(), { type: 'conjunction' }).format(arr); } catch (e) { return arr.join(', '); } },
    // weekday names starting from the shared first day of the week
    weekdays: function (width) { var f = new Intl.DateTimeFormat(locale(), { weekday: width || 'short' }), out = []; for (var i = 0; i < 7; i++) out.push(f.format(new Date(2026, 0, 4 + ((weekStart() + i) % 7)))); return out; },
    months: function (width) { var f = new Intl.DateTimeFormat(locale(), { month: width || 'long' }), out = []; for (var i = 0; i < 12; i++) out.push(f.format(new Date(2026, i, 1))); return out; },
  };

  // the page speaks the chosen language: lang, and right-to-left for Arabic, Farsi and Urdu
  document.documentElement.lang = locale();
  document.documentElement.dir = langInfo(lang()).rtl ? 'rtl' : 'ltr';

  // Machine-translation disclaimer: once per language (shared by every app), and always in About.
  function mtNotice() {
    var L = lang();
    if (L === 'en' || store.get(MTKEY + L) === '1' || document.getElementById('app-mt-notice')) return;
    var bar = document.createElement('div');
    bar.id = 'app-mt-notice'; bar.setAttribute('role', 'note');
    bar.style.cssText = 'position:fixed;left:50%;top:calc(12px + env(safe-area-inset-top,0px));transform:translateX(-50%);z-index:2147482997;' +
      'display:flex;flex-wrap:wrap;gap:10px;align-items:center;width:min(560px,calc(100vw - 24px));padding:10px 14px;border-radius:10px;' +
      'background:#3b3a1d;color:#fff;font:14px/1.4 var(--app-font,system-ui,sans-serif);box-shadow:0 6px 24px rgba(0,0,0,.45)';
    var text = document.createElement('span');
    text.style.flex = '1 1 260px';
    text.textContent = tr('This app was written in English. The {language} text is machine translated and has not been checked by a person, so it may be wrong.', { language: langInfo(L).name });
    var en = document.createElement('small');
    en.style.cssText = 'display:block;opacity:.75;margin-top:4px';
    en.setAttribute('lang', 'en'); en.dir = 'ltr';
    en.textContent = 'Machine translated from English, unchecked.';
    text.appendChild(en);
    var btn = function (label, fn) { var b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.addEventListener('click', fn); b.style.cssText = 'font:inherit;color:inherit;background:transparent;border:1px solid currentColor;border-radius:7px;padding:4px 10px;cursor:pointer'; return b; };
    bar.append(text, btn(tr('Switch to English'), function () { setRegional(LKEY, 'en'); }), btn(tr('OK'), function () { store.set(MTKEY + L, '1'); bar.remove(); }));
    document.documentElement.appendChild(bar);
  }

  // ---- Long text never buries the page (house standard) ------------------------------------------
  // Mark any block that can grow long (a transcript, an AI review, notes) with data-clamp:
  //   <div data-clamp>…</div>          at most 12 lines, or 40% of the screen height on a phone
  //   <div data-clamp="6">…</div>      at most 6 lines
  // When the text overflows, it is cut with a fade and gets a "Show all" / "Show less" button, so the
  // buttons below it stay in reach. Text that fits is left alone. Works for markup added later too.
  var clampCss = document.createElement('style');
  clampCss.textContent =
    '[data-clamp][data-clamped="1"]:not([data-open]){overflow:hidden;-webkit-mask-image:linear-gradient(#000 70%,transparent);mask-image:linear-gradient(#000 70%,transparent)}' +
    '.app-clamp-toggle{display:block;margin:.35em 0 .6em;padding:4px 10px;border-radius:7px;border:1px solid currentColor;background:transparent;color:inherit;font:inherit;font-size:.9em;cursor:pointer;opacity:.85}';
  (document.head || document.documentElement).appendChild(clampCss);
  function clampLimit(el) {
    var lh = parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.4 || 20;
    var lines = parseInt(el.getAttribute('data-clamp'), 10);
    var byLines = (lines > 0 ? lines : 12) * lh;
    return lines > 0 ? byLines : Math.min(byLines, Math.max(160, innerHeight * 0.4));
  }
  function clamp(el) {
    if (el.__clampBusy) return;
    el.__clampBusy = true;
    var open = el.hasAttribute('data-open');
    el.style.maxHeight = '';
    var limit = clampLimit(el), tall = el.scrollHeight > limit + 8;
    var btn = el.__clampBtn;
    if (!tall) {
      el.removeAttribute('data-clamped');
      if (btn) btn.remove();
    } else {
      el.setAttribute('data-clamped', '1');
      if (!open) el.style.maxHeight = limit + 'px';
      if (!btn) {
        btn = el.__clampBtn = document.createElement('button');
        btn.type = 'button'; btn.className = 'app-clamp-toggle';
        btn.addEventListener('click', function () { el.hasAttribute('data-open') ? el.removeAttribute('data-open') : el.setAttribute('data-open', ''); clamp(el); });
      }
      btn.textContent = open ? tr('Show less') : tr('Show all');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (btn.previousElementSibling !== el) el.insertAdjacentElement('afterend', btn);
    }
    el.__clampBusy = false;
  }
  var clampRO = window.ResizeObserver ? new ResizeObserver(function (es) { es.forEach(function (e) { clamp(e.target); }); }) : null;
  function watchClamps(root) {
    if (!root || !root.querySelectorAll) return;
    var els = [].slice.call(root.querySelectorAll('[data-clamp]'));
    if (root.matches && root.matches('[data-clamp]')) els.push(root);
    els.forEach(function (el) { if (el.__clampWatched) return; el.__clampWatched = true; clamp(el); if (clampRO) clampRO.observe(el); });
  }
  var startClamps = function () {
    watchClamps(document);
    if (window.MutationObserver) new MutationObserver(function (ms) { ms.forEach(function (m) {
      m.addedNodes.forEach(function (n) { if (n.nodeType === 1) watchClamps(n); });
      m.removedNodes.forEach(function (n) { // a framework removed the block: take its button too
        if (n.nodeType !== 1 || !n.querySelectorAll) return;
        var gone = [].slice.call(n.querySelectorAll('[data-clamp]')); if (n.matches('[data-clamp]')) gone.push(n);
        gone.forEach(function (el) { if (el.__clampBtn && !el.isConnected) { el.__clampBtn.remove(); el.__clampBtn = null; el.__clampWatched = false; } });
      });
      if (m.type === 'characterData' || m.type === 'childList') { var p = m.target.nodeType === 1 ? m.target : m.target.parentElement; var c = p && p.closest && p.closest('[data-clamp]'); if (c) clamp(c); }
    }); }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  };
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', startClamps) : startClamps();

  var appLoc = meta('app-locales');
  var ready = (lang() === 'en' ? Promise.resolve([{}, {}]) : Promise.all([
    loadDict(LOC_BASE + lang() + '.json'),
    appLoc ? loadDict(new URL(appLoc.replace(/\/?$/, '/') + lang() + '.json', location.href).href) : Promise.resolve({}),
  ])).then(function (r) {
    houseDict = r[0] || {}; dict = r[1] || {}; houseReady = true;
    var go = function () { applyDom(document); mtNotice(); document.dispatchEvent(new CustomEvent('app-language-ready', { detail: lang() })); };
    document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', go) : go();
    // later-rendered static markup with data-t gets translated as it appears
    if (lang() !== 'en' && window.MutationObserver) new MutationObserver(function (ms) { ms.forEach(function (m) { m.addedNodes.forEach(function (n) { if (n.nodeType === 1) applyDom(n); }); }); }).observe(document.documentElement, { childList: true, subtree: true });
    return lang();
  });

  // ---- Home-screen registry for the portal ----------------------------------------------------------
  // Browsers never tell one page what else is installed, so each app notes it itself in the shared
  // same-origin 'portal-installed' map ({ <slug>: time }): when it is installed, and on every launch from
  // the home screen. Nothing else is recorded; nothing leaves the device. The slug is the first path
  // segment (adervec.github.io/<slug>/), the same as the portal's.
  var homeSlug = decodeURIComponent(location.pathname.split('/')[1] || '');
  function markInstalled() {
    if (!homeSlug || /\.html?$/.test(homeSlug)) return;
    try { var reg = JSON.parse(localStorage.getItem('portal-installed') || '{}'); reg[homeSlug] = Date.now(); localStorage.setItem('portal-installed', JSON.stringify(reg)); } catch (e) { /* private mode */ }
  }
  if (navigator.standalone || ['standalone', 'minimal-ui', 'fullscreen', 'window-controls-overlay'].some(function (m) { return matchMedia('(display-mode: ' + m + ')').matches; })) markInstalled();
  window.addEventListener('appinstalled', markInstalled);

  // ---- Safety helpers (house standard 22) ------------------------------------------------------------
  // Every app shares the adervec.github.io origin, so one injected script could read every app's data.
  // Text from outside (imports, Drive, cowork replies, the URL, a profile name) never becomes markup.
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  // html`<b>${name}</b>`: every ${…} is escaped; wrap trusted markup in html.raw(…) to keep it
  function html(strings) {
    var out = strings[0];
    for (var i = 1; i < arguments.length; i++) {
      var v = arguments[i];
      out += (Array.isArray(v) ? v.map(function (x) { return x && x.__raw != null ? x.__raw : esc(x); }).join('') : v && v.__raw != null ? v.__raw : esc(v)) + strings[i];
    }
    return { __raw: out, toString: function () { return out; } };
  }
  html.raw = function (s) { return { __raw: String(s), toString: function () { return String(s); } }; };
  // a link or picture address from data: only http(s), relative, blob: or an image data: URL; else ''
  function safeUrl(u) {
    u = String(u == null ? '' : u).trim();
    if (/^data:image\/(png|jpe?g|gif|webp|avif);/i.test(u) || /^blob:/i.test(u)) return u;
    try { var p = new URL(u, location.href).protocol; return p === 'https:' || p === 'http:' ? u : ''; } catch (e) { return ''; }
  }
  // JSON from a file, Drive or a cowork reply: size-capped, and __proto__ / constructor / prototype keys dropped
  function parseJSON(text, maxBytes) {
    text = String(text);
    if (text.length > (maxBytes || 50e6)) throw new Error('File too large');
    return JSON.parse(text, function (k, v) { return k === '__proto__' || k === 'constructor' || k === 'prototype' ? undefined : v; });
  }
  // an unguessable id (sign-in state, file names, request ids); Math.random is fine only for gameplay
  function randomId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    var b = crypto.getRandomValues(new Uint8Array(16));
    return [].map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join('');
  }
  // diagnostics and crash reports are copied around: never carry a token or an email
  function redact(s) {
    return String(s)
      .replace(/ya29\.[\w.-]+/g, '[token]').replace(/\bBearer\s+[\w.~+/-]+=*/gi, 'Bearer [token]')
      .replace(/\b(access_token|id_token|refresh_token|code)=[^&\s]+/gi, '$1=[token]')
      .replace(/\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]*/g, '[jwt]')
      .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]');
  }

  // ---- Session ledger (house standard 25, hub roadmap chunk 4) --------------------------------------
  // One line per finished session, so the hub can show habits and progress across every app:
  //   appFont.logSession({ kind: 'lift', minutes: 42, id: workout.id })
  // kind    what it was: lift cardio ride read chess practice write speak paint cook checkin focus aim
  //         study compose art listen (the hub maps kinds onto its stats)
  // minutes how long it took; or amount, a size of your own (1 = about ten minutes of effort)
  // id      the session's own id, so logging it twice (a re-save, a sync) counts once
  // at      when it ended (ms), if not now
  // It is a row [seconds, app, kind, amount, id] in the shared localStorage 'portal-activity' (the last
  // 2000 per device). Nothing leaves the device unless the reader signs in on the hub, which then keeps
  // one file per device in their own private Drive folder. Returns true when a row was added.
  function logSession(s) {
    s = s || {};
    var slug = s.app || (/\.html?$/.test(homeSlug) ? '' : homeSlug);
    if (!slug || typeof s.kind !== 'string' || !s.kind) return false;
    var amount = isFinite(s.amount) && s.amount > 0 ? +s.amount : Math.max(1, Math.round((+s.minutes || 10) / 10));
    amount = Math.min(100, Math.round(amount * 10) / 10);
    var at = isFinite(s.at) && s.at > 0 ? +s.at : Date.now();
    var id = s.id == null ? '' : String(s.id).slice(0, 80);
    try {
      var a = JSON.parse(localStorage.getItem('portal-activity') || '[]');
      if (!Array.isArray(a)) a = [];
      if (id && a.some(function (x) { return x && x[1] === slug && x[4] === id; })) return false; // already logged
      var row = [Math.round(at > 2e10 ? at / 1000 : at), String(slug).slice(0, 80), s.kind.slice(0, 20), amount];
      if (id) row.push(id);
      a.push(row);
      localStorage.setItem('portal-activity', JSON.stringify(a.slice(-2000)));
      return true;
    } catch (e) { return false; } // private mode, or storage full: the session itself is the app's to keep
  }

  // ---- One theme list for every app (house standard 24) ---------------------------------------------
  // Every app offers at least these themes, under these names: the shared base list. An app may keep
  // extra themes of its own on top (appFont.addThemes). The choice is kept per app, so one app
  // can be Ember while another is Paper; "System" (the default) follows the device's light/dark.
  // font.js sets the chosen palette on <html> as CSS variables, and each app maps them onto its own:
  //   --t-bg --t-surface --t-surface2 --t-line --t-text --t-dim --t-accent --t-on-accent --t-good --t-warn --t-bad
  //   --t-scheme (light | dark, for `color-scheme: var(--t-scheme)`), data-house-theme="<id>", data-house-dark="1|0"
  // To change the list, change it HERE and nowhere else (font-selftest checks every palette's contrast).
  // i18n-keys: Light | Dark | Midnight | Slate | Ocean | Forest | Ember | Gold | Synthwave | Terminal | Paper | Pastel | Mono | High contrast
  var T_VARS = ['bg', 'surface', 'surface2', 'line', 'text', 'dim', 'accent', 'on-accent', 'good', 'warn', 'bad'];
  var themes = [
    //  id            name             dark  bg     surface surface2 line   text   dim    accent on-acc good   warn   bad
    ['light',     'Light',         0, 'f7f8fa ffffff eef0f4 d5d9e0 14171f 5b6472 1d4ed8 ffffff 15803d a16207 b91c1c'],
    ['dark',      'Dark',          1, '121418 1a1d23 23272f 343a45 e8eaee 9aa3b2 7aa2ff 0b1220 4ade80 fbbf24 f87171'],
    ['midnight',  'Midnight',      1, '0b0d14 12151f 1e2333 2a3042 e6e9f0 8a93a8 8b9dff 0b0d14 4ade80 fbbf24 f87171'],
    ['slate',     'Slate',         1, '1c2128 242a33 2d343f 3f4856 e6eaf0 9ba6b5 8fb4d9 10151b 6ee7a0 f5c451 f58b8b'],
    ['ocean',     'Ocean',         1, '071a24 0c2431 12303f 1f4a5e e2f1f7 8fb3c2 38bdf8 04131b 5eead4 fcd34d fca5a5'],
    ['forest',    'Forest',        1, '0d1610 132018 1a2b20 2c4434 e3efe5 93ad9a 5fd38a 07140c 7ee2a0 e9c46a f28b82'],
    ['ember',     'Ember',         1, '1a0f0b 24150f 301c14 4a2c1f f6e7dc c09a86 ff7a3d 1a0f0b 86d992 ffc857 ff8a80'],
    ['gold',      'Gold',          1, '17130a 201a0d 2a2212 4a3c1e f5ecd6 b8a57a e6b422 17130a a3d977 ffb86b ff8a80'],
    ['synthwave', 'Synthwave',     1, '1b0033 2a0a4a 381466 5a2a8a f6e9ff c9a9ec ff4fd8 1b0033 5eead4 ffd166 ff7a90'],
    ['terminal',  'Terminal',      1, '030803 061006 0a1d0e 1d3a22 9dffb0 5fa870 39ff6a 030803 39ff6a e6e04a ff6b6b'],
    ['paper',     'Paper',         0, 'f6f0e2 fffaf0 ede4d0 d6c9ab 2b2418 6b5d45 9a3412 ffffff 3f6212 92400e b91c1c'],
    ['pastel',    'Pastel',        0, 'f3eef7 ffffff ebe3f2 d9cde6 33293d 6f6180 7c3aed ffffff 166534 8a5206 be123c'],
    ['mono',      'Mono',          0, 'ffffff ffffff f0f0f0 b5b5b5 111111 555555 111111 ffffff 1a6b2f 7a5200 a11212'],
    ['contrast',  'High contrast', 1, '000000 000000 1a1a1a ffffff ffffff e0e0e0 ffe600 000000 00ff7f ffe600 ff6b6b'],
  ].map(function (t) {
    var c = {};
    t[3].split(' ').forEach(function (hex, i) { c[T_VARS[i]] = '#' + hex; });
    return { id: t[0], label: t[1], dark: !!t[2], colors: c };
  });
  var BASE_THEMES = themes.length;
  var themeById = function (id) { return themes.filter(function (t) { return t.id === id; })[0]; };
  // An app's own extra themes, on top of the base list: appFont.addThemes([{ id, label, dark, colors }])
  // with all eleven colours ('#rrggbb'). They join appFont.themes and the picker after the base list,
  // for this app only; a base id cannot be replaced. Call it once at start-up, before first paint.
  function addThemes(list) {
    var added = 0;
    (Array.isArray(list) ? list : []).forEach(function (t) {
      if (!t || typeof t.id !== 'string' || !/^[a-z0-9-]{1,30}$/i.test(t.id) || t.id === 'system' || themeById(t.id) || !t.colors) return;
      if (!T_VARS.every(function (k) { return /^#[0-9a-f]{6}$/i.test(t.colors[k] || ''); })) return;
      var c = {};
      T_VARS.forEach(function (k) { c[k] = t.colors[k]; });
      themes.push({ id: t.id, label: String(t.label || t.id), dark: !!t.dark, colors: c, extra: true });
      added++;
    });
    if (added) { applyTheme(); document.dispatchEvent(new CustomEvent('app-themes-added')); } // a saved extra choice now applies
    return added;
  }
  var T_KEY = function () { return 'maker-theme:' + appKey(); };
  // the reader's choice for THIS app: a theme id, or 'system' when they have not chosen
  function themeChoice() { var v = store.get(T_KEY()); return v && themeById(v) ? v : 'system'; }
  // the theme in force now: { id, label, dark, colors } ('system' resolved to light or dark)
  function themeNow() { var id = themeChoice(); return themeById(id === 'system' ? systemTheme() : id); }
  function applyTheme() {
    var t = themeNow(), r = document.documentElement;
    T_VARS.forEach(function (k) { r.style.setProperty('--t-' + k, t.colors[k]); });
    r.style.setProperty('--t-scheme', t.dark ? 'dark' : 'light');
    r.dataset.houseTheme = t.id; r.dataset.houseDark = t.dark ? '1' : '0';
  }
  function setTheme(id) {
    store.set(T_KEY(), themeById(id) ? id : null); // 'system' or anything unknown clears the choice
    applyTheme();
    document.dispatchEvent(new CustomEvent('app-theme-change', { detail: themeNow() }));
  }
  applyTheme();
  if (darkQuery && darkQuery.addEventListener) darkQuery.addEventListener('change', function () {
    if (themeChoice() !== 'system') return; // a saved choice always wins (standard 14)
    applyTheme();
    document.dispatchEvent(new CustomEvent('app-theme-change', { detail: themeNow() }));
  });
  // <app-theme-picker label="Theme">: a plain labelled <select> in the light DOM, like the font picker
  if (window.customElements && !customElements.get('app-theme-picker')) {
    customElements.define('app-theme-picker', class extends HTMLElement {
      connectedCallback() {
        if (this.firstChild) return;
        if (!houseReady && lang() !== 'en') { var me = this; ready.then(function () { if (!me.firstChild) me.connectedCallback(); }); return; }
        var label = document.createElement('label'), select = document.createElement('select');
        var fill = function () {
          select.textContent = '';
          [{ id: 'system', label: 'System' }].concat(themes).forEach(function (t) {
            var o = document.createElement('option'); o.value = t.id; o.textContent = t.extra ? t.label : tr(t.label); select.appendChild(o);
          });
          select.value = themeChoice();
        };
        fill();
        document.addEventListener('app-themes-added', fill);
        select.addEventListener('change', function () { setTheme(select.value); });
        document.addEventListener('app-theme-change', function () { select.value = themeChoice(); });
        label.append((this.getAttribute('label') || tr('Theme')) + ' ', select);
        this.appendChild(label);
      }
    });
  }

  // ---- The reader's cloud, one helper for every app and the hub (house standard 1) -------------------
  // appFont.cloud is the only door to the reader's synced copy: sign in, then read, write and list
  // named files in an app-private folder. Which vendor is behind it is the reader's choice, made ONCE
  // for every app and the hub (key maker-cloud); mixing vendors between apps is not supported.
  //   appFont.cloud.signIn({ silent })   -> a promise; silent never shows the vendor's window
  //   .read(name) -> text | null   .readBytes(nameOrEntry, signal) -> ArrayBuffer | null
  //   .write(name, textOrBlob, mime)   .list(prefix) -> [{ name, size, modified, mime, id }]   .remove(name) -> bool
  //   .signedIn()  .signOut()  .provider() -> 'google'  .label() -> 'Google Drive'
  //   .providers() -> [{ id, label, current }]  .use(id)  .register(provider)
  // A vendor is one object with those same methods (plus id and label). Google Drive ships here; Dropbox,
  // OneDrive and "a folder on this computer" are added with register() when they are built.
  // The sign-in pass lives in memory only. What is remembered is the address of the account last
  // chosen (maker-google-hint), so the next sign-in skips the chooser.

  // -- Google Drive: the hidden per-app folder (appDataFolder). The client id is public (an identifier,
  //    not a secret); Google honours it only from registered origins.
  var G_CLIENT = window.appGoogleClient || '547617739897-br6dj2facmsc34qnkjb5u4dbfhju39pu.apps.googleusercontent.com';
  var G_SCOPE = 'openid email profile https://www.googleapis.com/auth/drive.appdata';
  var G_HINT = 'maker-google-hint';
  var gTok = null, gLoading = null;
  function gLoad() {
    return gLoading || (gLoading = new Promise(function (res, rej) {
      if (window.google && google.accounts && google.accounts.oauth2) return res();
      var s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.onload = function () { res(); };
      s.onerror = function () { gLoading = null; rej(new Error('Could not load Google sign-in.')); };
      document.head.appendChild(s);
    }));
  }
  var googleSignedIn = function () { return !!gTok && gTok.exp > Date.now() + 60000; };
  // -> a promise of an access token. { silent: true } never shows Google's window to the reader: it
  // rejects instead (browsers also block it outside a tap, so call it from one when it matters).
  function googleToken(opts) {
    if (googleSignedIn()) return Promise.resolve(gTok.value);
    return gLoad().then(function () {
      return new Promise(function (res, rej) {
        google.accounts.oauth2.initTokenClient({
          client_id: G_CLIENT, scope: G_SCOPE, login_hint: store.get(G_HINT) || undefined,
          callback: function (r) {
            if (!r || !r.access_token) return rej(new Error((r && r.error) || 'Sign-in failed.'));
            gTok = { value: r.access_token, exp: Date.now() + (+r.expires_in || 3600) * 1000 };
            res(gTok.value);
          },
          error_callback: function (e) { rej(new Error((e && (e.message || e.type)) || 'Sign-in was dismissed.')); },
        }).requestAccessToken({ prompt: opts && opts.silent ? 'none' : '' });
      });
    }).then(function (t) {
      // house standard 1: the picture sits in the top bar while signed in
      return fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + t } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { if (j) { setAccount({ name: j.name || j.email || 'Google', picture: j.picture || '', email: j.email || '' }); store.set(G_HINT, j.email || null); } })
        .catch(function () { /* cosmetic only */ })
        .then(function () { return t; });
    });
  }
  function gApi(path, init) {
    init = init || {};
    return googleToken({ silent: true }).then(function (t) {
      return fetch('https://www.googleapis.com/' + path, { method: init.method, body: init.body, signal: init.signal, headers: Object.assign({ Authorization: 'Bearer ' + t }, init.headers) });
    }).then(function (r) { if (!r.ok) throw new Error('Google Drive answered ' + r.status + '.'); return r; });
  }
  function gFind(name) {
    var q = "name='" + String(name).replace(/['\\]/g, '\\$&') + "' and trashed=false";
    return gApi('drive/v3/files?spaces=appDataFolder&fields=files(id)&q=' + encodeURIComponent(q))
      .then(function (r) { return r.json(); }).then(function (j) { return ((j.files || [])[0] || {}).id || null; });
  }
  var GOOGLE = {
    id: 'google', label: 'Google Drive',
    signIn: googleToken, signedIn: googleSignedIn,
    // forgets the account here; the grant itself stays, since every app shares it
    signOut: function () { gTok = null; store.set(G_HINT, null); setAccount(null); },
    read: function (name) {
      return gFind(name).then(function (id) { return id ? gApi('drive/v3/files/' + id + '?alt=media').then(function (r) { return r.text(); }) : null; });
    },
    // name, or an entry from list() (two files can share a name in Drive; an entry is exact)
    readBytes: function (what, signal) {
      return (what && what.id ? Promise.resolve(what.id) : gFind(what)).then(function (id) {
        return id ? gApi('drive/v3/files/' + encodeURIComponent(id) + '?alt=media', { signal: signal }).then(function (r) { return r.arrayBuffer(); }) : null;
      });
    },
    list: function (prefix) {
      prefix = prefix || '';
      var out = [], q = prefix ? '&q=' + encodeURIComponent("name contains '" + String(prefix).replace(/['\\]/g, '\\$&') + "' and trashed=false") : '';
      var page = function (pt) {
        return gApi('drive/v3/files?spaces=appDataFolder&pageSize=1000&fields=nextPageToken,files(id,name,size,modifiedTime,mimeType)' + q + (pt ? '&pageToken=' + encodeURIComponent(pt) : ''))
          .then(function (r) { return r.json(); }).then(function (j) {
            (j.files || []).forEach(function (f) { if (f.name.indexOf(prefix) === 0) out.push({ id: f.id, name: f.name, size: +f.size || 0, modified: f.modifiedTime || '', mime: f.mimeType || '' }); });
            return j.nextPageToken ? page(j.nextPageToken) : out;
          });
      };
      return page();
    },
    remove: function (name) {
      return gFind(name).then(function (id) { return id ? gApi('drive/v3/files/' + id, { method: 'DELETE' }).then(function () { return true; }) : false; });
    },
    // body: text, or a Blob for a binary file; mime defaults to JSON
    write: function (name, body, mime) {
      mime = mime || 'application/json';
      return gFind(name).then(function (id) {
        if (id) return gApi('upload/drive/v3/files/' + id + '?uploadType=media', { method: 'PATCH', headers: { 'Content-Type': mime }, body: body });
        var b = 'b' + randomId().replace(/-/g, '');
        var multi = new Blob(['--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify({ name: name, parents: ['appDataFolder'] }) +
          '\r\n--' + b + '\r\nContent-Type: ' + mime + '\r\n\r\n', body, '\r\n--' + b + '--']);
        return gApi('upload/drive/v3/files?uploadType=multipart', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body: multi });
      }).then(function () {});
    },
  };

  // -- the door: whichever vendor the reader chose
  var CLOUD_KEY = 'maker-cloud', CLOUDS = { google: GOOGLE };
  var CLOUD_SOON = [{ id: 'dropbox', label: 'Dropbox' }, { id: 'onedrive', label: 'OneDrive' }]; // planned, not built: shown as "coming soon"
  var cloudNow = function () { return CLOUDS[store.get(CLOUD_KEY)] || GOOGLE; };
  var cloud = {
    provider: function () { return cloudNow().id; },
    label: function () { return cloudNow().label; },
    // every vendor, ready or not: [{ id, label, current, soon }] (soon: true = not built yet, cannot be chosen)
    providers: function () {
      return Object.keys(CLOUDS).map(function (k) { return { id: k, label: CLOUDS[k].label, current: CLOUDS[k] === cloudNow(), soon: false }; })
        .concat(CLOUD_SOON.filter(function (s) { return !CLOUDS[s.id]; }).map(function (s) { return { id: s.id, label: s.label, current: false, soon: true }; }));
    },
    // one vendor for every app and the hub; changing it does not move any data (back up, switch, restore)
    use: function (id) {
      if (!CLOUDS[id]) throw new Error(CLOUD_SOON.some(function (s) { return s.id === id; }) ? 'That cloud is coming soon; it is not available yet.' : 'Unknown cloud: ' + id);
      if (CLOUDS[id] !== cloudNow()) cloudNow().signOut();
      store.set(CLOUD_KEY, id === 'google' ? null : id);
      document.dispatchEvent(new CustomEvent('app-cloud-change', { detail: id }));
    },
    register: function (p) {
      var need = ['signIn', 'signedIn', 'signOut', 'read', 'readBytes', 'write', 'list', 'remove'];
      if (!p || !/^[a-z][a-z0-9-]{1,20}$/.test(p.id || '') || !p.label || !need.every(function (m) { return typeof p[m] === 'function'; })) throw new Error('A cloud needs an id, a label and: ' + need.join(', '));
      CLOUDS[p.id] = p;
    },
  };
  ['signIn', 'signedIn', 'signOut', 'read', 'readBytes', 'write', 'list', 'remove'].forEach(function (m) { cloud[m] = function () { var c = cloudNow(); return c[m].apply(c, arguments); }; });
  cloud.token = cloud.signIn; // the old name (appFont.google.token), kept for notes that still say it

  // ---- Cold backup (hub roadmap chunk 2a) ------------------------------------------------------------
  // Every app shares the origin, so one page can read all of their settings and databases into one
  // file the reader keeps wherever they like. This half only READS: nothing here writes app data.
  // Restore (chunk 2b) lives on the hub's Backup page (backup.html): it reads a file as a stream, takes a
  // safety copy of what it is about to replace, and rebuilds values with dec() below.
  // Memory: records are read a batch at a time and handed to the browser as Blob pieces (which it may
  // keep on disk), so the page never holds a whole database, let alone the whole backup.
  // ponytail: one record is still held whole (a single 500 MB recording would hurt); binary is base64.
  var SECRET_KEY = /token|secret|credential|password/i;
  var SECRET_VAL = /ya29\.[\w.-]{20,}|eyJ[\w-]{10,}\.[\w-]{10,}\.|"(access|refresh|id)_token"\s*:/;
  function b64(buf) {
    var u = new Uint8Array(buf), s = '';
    for (var i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  }
  // -> a promise of a JSON-safe copy: binary, dates, maps, sets and the like become { $t: … }.
  // light: binary is described ({ size }) instead of read, for showing a record on screen.
  function enc(v, light) {
    var P = function (x) { return Promise.resolve(x); };
    if (v === undefined) return P({ $t: 'undef' });
    if (typeof v === 'bigint') return P({ $t: 'bigint', v: String(v) });
    if (typeof v === 'number' && !isFinite(v)) return P({ $t: 'num', v: String(v) });
    if (typeof v === 'string') return P(v.length < 5000 && SECRET_VAL.test(v) ? '[token]' : v);
    if (v === null || typeof v !== 'object') return P(v);
    if (v instanceof Date) return P({ $t: 'date', v: v.getTime() });
    if (v instanceof Blob) {
      var meta = { $t: 'blob', type: v.type, name: v.name, lastModified: v.lastModified };
      if (light) { meta.size = v.size; return P(meta); }
      return v.arrayBuffer().then(function (b) { meta.b64 = b64(b); return meta; });
    }
    if (v instanceof ArrayBuffer) return P(light ? { $t: 'buf', size: v.byteLength } : { $t: 'buf', b64: b64(v) });
    if (ArrayBuffer.isView(v)) return P(light ? { $t: 'view', ctor: v.constructor.name, size: v.byteLength }
      : { $t: 'view', ctor: v.constructor.name, b64: b64(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)) });
    if (v instanceof Map) return enc(Array.from(v), light).then(function (a) { return { $t: 'map', v: a }; });
    if (v instanceof Set) return enc(Array.from(v), light).then(function (a) { return { $t: 'set', v: a }; });
    if (Array.isArray(v)) return Promise.all(Array.from(v, function (x) { return enc(x, light); }));
    var proto = Object.getPrototypeOf(v);
    // a folder handle, a crypto key…: cannot be written to a file; say what it was
    if (proto && proto !== Object.prototype) return P({ $t: 'other', is: Object.prototype.toString.call(v).slice(8, -1) });
    var keys = Object.keys(v);
    return Promise.all(keys.map(function (k) { return enc(v[k], light); })).then(function (vals) {
      var o = {};
      keys.forEach(function (k, i) { o[k] = vals[i]; });
      return '$t' in o ? { $t: 'obj', v: o } : o;
    });
  }
  // the reverse of enc, for restore: a value read from a backup file becomes what it was.
  // Throws on a value that cannot be rebuilt (a folder handle, a crypto key), so the caller can skip it.
  var VIEWS = /^(Int8|Uint8|Uint8Clamped|Int16|Uint16|Int32|Uint32|Float32|Float64|BigInt64|BigUint64)Array$|^DataView$/;
  function unb64(s) { var b = atob(s || ''), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function dec(v) {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(dec);
    var o = {};
    if (typeof v.$t !== 'string') { Object.keys(v).forEach(function (k) { o[k] = dec(v[k]); }); return o; }
    switch (v.$t) {
      case 'undef': return undefined;
      case 'bigint': return BigInt(v.v);
      case 'num': return Number(v.v);
      case 'date': return new Date(v.v == null ? NaN : v.v);
      case 'blob': return v.name != null ? new File([unb64(v.b64)], v.name, { type: v.type || '', lastModified: v.lastModified }) : new Blob([unb64(v.b64)], { type: v.type || '' });
      case 'buf': return unb64(v.b64).buffer;
      case 'view': if (!VIEWS.test(v.ctor)) throw new Error('Unknown binary kind'); return new window[v.ctor](unb64(v.b64).buffer);
      case 'map': return new Map(dec(v.v));
      case 'set': return new Set(dec(v.v));
      case 'obj': Object.keys(v.v || {}).forEach(function (k) { o[k] = dec(v.v[k]); }); return o;
      default: throw new Error('This value cannot be rebuilt: ' + (v.is || v.$t));
    }
  }
  function idbReq(r) { return new Promise(function (res, rej) { r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); }
  // -> the open database, or null if it is not there (it is never created, and never blocks an app's upgrade)
  function idbOpen(name) {
    return new Promise(function (res) {
      var rq = indexedDB.open(name);
      rq.onupgradeneeded = function () { rq.transaction.abort(); };
      rq.onerror = function (ev) { ev.preventDefault(); res(null); };
      rq.onsuccess = function () { rq.result.onversionchange = function () { rq.result.close(); }; res(rq.result); };
    });
  }
  // the next n records after key `after` (or the first n): -> [keys, values], read in one transaction
  function idbBatch(db, store, started, after, n) {
    var st = db.transaction(store, 'readonly').objectStore(store), range = started ? IDBKeyRange.lowerBound(after, true) : null;
    return Promise.all([idbReq(st.getAllKeys(range, n)), idbReq(st.getAll(range, n))]);
  }
  // what is stored, without reading it: { localStorage: [{ name, bytes, secret }], indexedDB: [{ name, version, stores: [{ name, count }] } | { name, error }], note }
  async function backupList() {
    var out = { localStorage: [], indexedDB: [] };
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i), v = localStorage.getItem(k);
        out.localStorage.push({ name: k, bytes: v.length, secret: SECRET_KEY.test(k) || SECRET_VAL.test(v) });
      }
    } catch (e) { out.note = 'Settings could not be read: ' + (e.message || e); }
    if (!window.indexedDB || !indexedDB.databases) { out.note = 'This browser cannot list its databases, so only settings are included.'; return out; }
    var dbs = await indexedDB.databases();
    for (var d = 0; d < dbs.length; d++) {
      var name = dbs[d].name, db = null;
      if (!name) continue;
      try {
        db = await idbOpen(name);
        if (!db) continue;
        var names = Array.from(db.objectStoreNames), counts = [];
        if (names.length) { var tx = db.transaction(names, 'readonly'); counts = await Promise.all(names.map(function (n) { return idbReq(tx.objectStore(n).count()); })); }
        out.indexedDB.push({ name: name, version: db.version, stores: names.map(function (n, j) { return { name: n, count: counts[j] }; }) });
      } catch (e) { out.indexedDB.push({ name: name, error: String((e && e.message) || e) }); }
      if (db) db.close();
    }
    return out;
  }
  // the first n records of each store, for showing: { store: [[key, value], …] } (binary described, not read)
  async function backupPeek(name, n) {
    var db = await idbOpen(name), out = {};
    if (!db) return out;
    try {
      var names = Array.from(db.objectStoreNames);
      for (var i = 0; i < names.length; i++) {
        var kv = await idbBatch(db, names[i], false, null, n || 20);
        out[names[i]] = await enc(kv[0].map(function (k, j) { return [k, kv[1][j]]; }), true);
      }
    } finally { db.close(); }
    return out;
  }
  // one database as JSON text in Blob pieces: {"version":n,"stores":{name:{keyPath,autoIncrement,indexes,"rows":[[key,value],…]}}}
  async function backupDb(db, progress, signal) {
    var pieces = [], buf = '';
    var add = function (s) { buf += s; if (buf.length > 4e6) { pieces.push(new Blob([buf])); buf = ''; } };
    var names = Array.from(db.objectStoreNames);
    add('{"version":' + db.version + ',"stores":{');
    for (var i = 0; i < names.length; i++) {
      var n = names[i], st = db.transaction(n, 'readonly').objectStore(n);
      var meta = { keyPath: st.keyPath, autoIncrement: st.autoIncrement,
        indexes: Array.from(st.indexNames).map(function (x) { x = st.index(x); return { name: x.name, keyPath: x.keyPath, unique: x.unique, multiEntry: x.multiEntry }; }) };
      add((i ? ',' : '') + JSON.stringify(n) + ':' + JSON.stringify(meta).slice(0, -1) + ',"rows":[');
      var count = 0, last, started = false;
      for (;;) {
        var kv = await idbBatch(db, n, started, last, 50);
        if (!kv[0].length) break;
        for (var j = 0; j < kv[0].length; j++) add((count++ ? ',' : '') + JSON.stringify(await enc([kv[0][j], kv[1][j]]))); // one at a time: one recording in memory, not fifty
        last = kv[0][kv[0].length - 1]; started = true;
        if (signal && signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        progress(db.name, kv[0].length);
      }
      add(']}');
    }
    add('}}');
    pieces.push(new Blob([buf]));
    return pieces;
  }
  // want(kind, name) -> false leaves that key or database out (default: everything).
  // more(push): optional, appends further top-level JSON members (the hub adds ',"drive":[…]').
  // progress(name, n): optional, called as each batch of n more records is read.
  // signal: optional AbortSignal; cancelling rejects with an AbortError and saves nothing.
  // -> { blob, made, skipped, errors: { database: reason } }
  // A database that cannot be read is recorded under errors, so a gap is never silent.
  async function backupBuild(want, more, progress, signal) {
    want = want || function () { return true; };
    progress = progress || function () {};
    var head = { format: 'adervec-backup', schema: 2, made: new Date().toISOString(), origin: location.origin, from: location.pathname, localStorage: {}, skipped: [] };
    var errors = {}, parts = [], first = true;
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i), v = localStorage.getItem(k);
        if (!want('localStorage', k)) continue;
        if (SECRET_KEY.test(k) || SECRET_VAL.test(v)) head.skipped.push(k); else head.localStorage[k] = v; // sign-in tokens stay out
      }
    } catch (e) { head.note = 'Settings could not be read: ' + (e.message || e); }
    var dbs = [];
    if (window.indexedDB && indexedDB.databases) dbs = await indexedDB.databases();
    else head.note = 'This browser cannot list its databases, so only settings are included.';
    parts.push(JSON.stringify(head).slice(0, -1) + ',"indexedDB":{');
    for (var d = 0; d < dbs.length; d++) {
      var name = dbs[d].name, db = null, pieces = null;
      if (!name || !want('indexedDB', name)) continue;
      try { db = await idbOpen(name); if (db) pieces = await backupDb(db, progress, signal); }
      catch (e) { if (db) db.close(); if (e && e.name === 'AbortError') throw e; errors[name] = String((e && e.message) || e); db = null; }
      if (db) db.close();
      if (pieces) { parts.push((first ? '' : ',') + JSON.stringify(name) + ':'); parts = parts.concat(pieces); first = false; }
    }
    parts.push('}');
    if (more) await more(function (s) { parts.push(s); }, signal);
    parts.push(',"errors":' + JSON.stringify(errors) + '}');
    return { blob: new Blob(parts, { type: 'application/json' }), made: head.made, skipped: head.skipped, errors: errors };
  }
  function backupDownload(want, more, progress, signal) {
    return backupBuild(want, more, progress, signal).then(function (r) {
      var u = URL.createObjectURL(r.blob), x = document.createElement('a');
      x.href = u; x.download = 'adervec-backup-' + r.made.slice(0, 10) + '.json';
      document.body.appendChild(x); x.click(); x.remove();
      setTimeout(function () { URL.revokeObjectURL(u); }, 60000);
      try { localStorage.setItem('portal-last-backup', String(Date.now())); } catch (e) { /* private mode */ }
      return r;
    });
  }

  window.appFont = { options: options, get: get, set: set, buildLabel: buildLabel, updateNotice: updateNotice,
    esc: esc, html: html, safeUrl: safeUrl, parseJSON: parseJSON, randomId: randomId, redact: redact,
    zoomAllowed: zoomAllowed, setZoomAllowed: setZoomAllowed, crashNotice: crashNotice,
    themes: themes, baseThemes: BASE_THEMES, addThemes: addThemes, theme: themeChoice, themeNow: themeNow, setTheme: setTheme,
    cloud: cloud, google: cloud, // google: the helper's first name, kept so older notes still work
    logSession: logSession,
    backup: { list: backupList, peek: backupPeek, build: backupBuild, download: backupDownload, open: idbOpen, decode: dec },
    diagnostics: diagnostics, copyDiagnostics: copyDiagnostics, storageInfo: storageInfo, systemTheme: systemTheme,
    whatsNew: whatsNew, checkWhatsNew: checkWhatsNew, setWhatsNewSilenced: setWhatsNewSilenced,
    getAccount: getAccount, setAccount: setAccount,
    // languages and regional settings
    languages: LANGS, lang: lang, locale: locale, units: units, weekStart: weekStart, clock: clock,
    setLanguage: function (id) { setRegional(LKEY, id); }, setUnits: function (v) { setRegional(UKEY, v); },
    setWeekStart: function (v) { setRegional(WKEY, v); }, setClock: function (v) { setRegional(CKEY, v); },
    dates: dates, setDates: function (v) { setRegional(DKEY, v === 'regional' ? 'regional' : null); },
    t: t, fmt: fmt, ready: ready, applyDom: applyDom, machineTranslated: function () { return lang() !== 'en'; } };
  window.t = window.t || t; // the short name apps write their English with
})();
