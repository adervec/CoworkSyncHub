// font.js — the house font for every app: Atkinson Hyperlegible by default, and one
// reader-chosen override. Published at https://adervec.github.io/font.js.
// Because every app loads it, it also carries the house standards that need no app code:
// storage the browser will not evict, a visible build stamp (<app-build-info>, under the font
// picker), a notice when a new version is ready, a notice instead of a silent crash, and the
// accessibility floor (an "Allow pinch-zoom" option, off by default; reduced motion; focus ring).
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
    (document.body || document.documentElement).appendChild(bar);
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
    bar.append(text,
      btn('Reload', function () { location.reload(); }),
      btn('Details', function () { more.style.display = more.style.display === 'none' ? 'block' : 'none'; }),
      btn('Dismiss', function () { bar.remove(); }),
      more);
    var add = function () { (document.body || document.documentElement).appendChild(bar); };
    document.body ? add() : document.addEventListener('DOMContentLoaded', add);
  }
  function onCrash(msg, stack) {
    var s = String(msg || '') + (stack ? '\n' + stack : '');
    if (!msg || NOISE.test(s)) return;
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

  window.appFont = { options: options, get: get, set: set, buildLabel: buildLabel, updateNotice: updateNotice,
    zoomAllowed: zoomAllowed, setZoomAllowed: setZoomAllowed, crashNotice: crashNotice };
})();
