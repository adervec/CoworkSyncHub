// font.js — the house font for every app: Atkinson Hyperlegible by default, and one
// reader-chosen override. Published at https://adervec.github.io/font.js.
// Because every app loads it, it also carries three small house standards (see "House
// extras" at the bottom): storage that the browser will not evict, a visible build stamp
// (<app-build-info>, shown under the font picker), and a notice when a new version is ready.
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

  window.appFont = { options: options, get: get, set: set, buildLabel: buildLabel, updateNotice: updateNotice };
})();
