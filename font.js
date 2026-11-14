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
      });
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
  var LKEY = 'maker-lang', UKEY = 'maker-units', WKEY = 'maker-week', CKEY = 'maker-clock', MTKEY = 'maker-mt-ack:';
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
    try { var L = new Intl.Locale(navigator.language || 'en'), w = L.getWeekInfo ? L.getWeekInfo() : L.weekInfo; if (w && w.firstDay) return w.firstDay % 7; } catch (e) { /* older browser */ }
    return 1;
  }
  function clock() { var v = store.get(CKEY); if (v === '12' || v === '24') return v; try { return /h1[12]/.test(new Intl.DateTimeFormat(navigator.language || 'en', { hour: 'numeric' }).resolvedOptions().hourCycle) ? '12' : '24'; } catch (e) { return '24'; } }
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
  var fmt = {
    number: fmtNumber,
    percent: function (x, max) { return new Intl.NumberFormat(locale(), { style: 'percent', maximumFractionDigits: max == null ? 0 : max }).format(x); },
    date: function (d, style) { return new Intl.DateTimeFormat(locale(), { dateStyle: style || 'medium' }).format(asDate(d)); },
    time: function (d) { return new Intl.DateTimeFormat(locale(), { timeStyle: 'short', hour12: clock() === '12' }).format(asDate(d)); },
    dateTime: function (d, style) { return new Intl.DateTimeFormat(locale(), { dateStyle: style || 'medium', timeStyle: 'short', hour12: clock() === '12' }).format(asDate(d)); },
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

  window.appFont = { options: options, get: get, set: set, buildLabel: buildLabel, updateNotice: updateNotice,
    zoomAllowed: zoomAllowed, setZoomAllowed: setZoomAllowed, crashNotice: crashNotice,
    diagnostics: diagnostics, copyDiagnostics: copyDiagnostics, storageInfo: storageInfo, systemTheme: systemTheme,
    whatsNew: whatsNew, checkWhatsNew: checkWhatsNew, setWhatsNewSilenced: setWhatsNewSilenced,
    getAccount: getAccount, setAccount: setAccount,
    // languages and regional settings
    languages: LANGS, lang: lang, locale: locale, units: units, weekStart: weekStart, clock: clock,
    setLanguage: function (id) { setRegional(LKEY, id); }, setUnits: function (v) { setRegional(UKEY, v); },
    setWeekStart: function (v) { setRegional(WKEY, v); }, setClock: function (v) { setRegional(CKEY, v); },
    t: t, fmt: fmt, ready: ready, applyDom: applyDom, machineTranslated: function () { return lang() !== 'en'; } };
  window.t = window.t || t; // the short name apps write their English with
})();
