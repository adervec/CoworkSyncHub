/* cowork.js — the AI cowork sync panel and engine. One implementation, every app.

   Published at https://adervec.github.io/cowork.js and loaded by each app, so
   the sync panel looks and behaves identically no matter what the host app
   looks like. It renders into a shadow root, so the host's CSS cannot reach in
   and the panel's CSS cannot leak out; the only supported theming is the
   --cowork-* custom properties listed in CSS below.

   Two adapters, because there are exactly two places this runs:
     fs   — inside an app: File System Access API, drives a real cowork folder.
     data — inside CoworkSyncHub's status.html (or an app with its own engine):
            fed a JSON snapshot, buttons dispatch `cowork-action` events.

   fs mode is the house cowork standard (CoworkSyncHub/HOUSE-STANDARDS.md):
     - named channels, each with fixed request files + instructions (the manifest)
     - a schedule per channel, run only on the ONE device that holds the folder's
       sync claim (cowork-machine.json); every device can still look and send by hand
     - replies checked every 5 minutes and on focus
     - REVIEW BEFORE APPLYING by default, switchable per channel; undo when the app
       gives undo data
     - a reply is never applied twice (a content ledger), a reply for an older request
       is held back (requestHash), handled replies move to <channel>/processed/, and an
       agent's error file shows its reason
     - a run history, and an optional morning brief (BRIEF.md + brief.json)

   Adopting it:  cowork.mount(host, cfg)
     cfg.app        short id ("mise")
     cfg.manifest   the cowork.json manifest (cowork-manifest v1)
     cfg.files(ch)  -> { "path": content } request files for one channel
     cfg.apply(ch, reply)               apply a reply (v1; still works)
     cfg.channels   optional, per channel name:
       { label, schedule: "off|5m|15m|30m|hourly|daily|weekly", review: true|false,
         preview(reply) -> [{ id, label, detail }]   rows to tick in review,
         apply(reply, acceptedIds) -> { summary?, undo? },   undo must be JSON data,
         undo(data) }                                        reverses one apply
     cfg.brief()    optional -> { markdown, data }, written as BRIEF.md + brief.json

   State vocabulary is copied from coworkhub.py's scanner on purpose: idle,
   PENDING, answered, STALE, "-" (note), plus REVIEW (waiting for you).
   Self-check: /cowork-selftest.html (written by portal.py build).
*/
(function () {
  "use strict";
  var PORTAL = "https://adervec.github.io/";
  var VERSION = 2;

  // ---------- small helpers ----------
  function rel(sec) {
    if (!sec || sec < 0) return "-";
    if (sec < 90) return Math.round(sec) + "s ago";
    if (sec < 5400) return Math.round(sec / 60) + "m ago";
    if (sec < 172800) return Math.round(sec / 3600) + "h ago";
    return Math.round(sec / 86400) + "d ago";
  }
  function stateOf(ch) {
    if (ch.note) return "-";
    if (ch.review) return "REVIEW";
    if (ch.stale) return "STALE";
    if (ch.pending && !ch.answered) return "PENDING";
    if (ch.pending) return "answered";
    return "idle";
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  // djb2, the same content hash the protocol and the apps use
  function hash(text) {
    var h = 5381, s = String(text == null ? "" : text);
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  var SCHEDULES = [
    { id: "off", label: "manual", ms: 0 }, { id: "5m", label: "every 5 min", ms: 5 * 60e3 },
    { id: "15m", label: "every 15 min", ms: 15 * 60e3 }, { id: "30m", label: "every 30 min", ms: 30 * 60e3 },
    { id: "hourly", label: "hourly", ms: 3600e3 }, { id: "daily", label: "daily", ms: 86400e3 },
    { id: "weekly", label: "weekly", ms: 7 * 86400e3 },
  ];
  var schedMs = function (id) { var s = SCHEDULES.filter(function (x) { return x.id === id; })[0]; return s ? s.ms : 0; };
  // A channel is due when its schedule has elapsed since it last ran; one that never ran is due now.
  function isDue(scheduleId, lastAt, now) { var ms = schedMs(scheduleId); return !!ms && (!lastAt || now - lastAt >= ms); }

  // ---------- per-app state (device-local; the folder holds everything shared) ----------
  // Keys start with "cowork-" + app so an app's own "erase everything" can find them.
  function loadState(app) {
    var s; try { s = JSON.parse(localStorage.getItem("cowork-state:" + app) || "{}"); } catch (e) { s = {}; }
    s.sched = s.sched || {}; s.review = s.review || {}; s.lastRun = s.lastRun || {}; s.reqHash = s.reqHash || {};
    s.ledger = s.ledger || []; s.history = s.history || []; s.pathLabel = s.pathLabel || "";
    return s;
  }
  function saveState(app, s) {
    s.ledger = s.ledger.slice(-300); s.history = s.history.slice(-200);
    try { localStorage.setItem("cowork-state:" + app, JSON.stringify(s)); } catch (e) { /* quota or private mode */ }
  }
  function deviceId() {
    var k = "cowork-device", v = null;
    try { v = localStorage.getItem(k); if (!v) { v = Math.random().toString(36).slice(2, 10); localStorage.setItem(k, v); } } catch (e) { v = "session"; }
    return v;
  }
  function deviceName() {
    var ua = navigator.userAgent;
    var os = /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "Mac" : /Android/.test(ua) ? "Android" : /Linux/.test(ua) ? "Linux" : /iPhone|iPad/.test(ua) ? "iOS" : "device";
    var br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "browser";
    return os + " · " + br;
  }

  // ---------- directory handles survive reloads only in IndexedDB ----------
  // ponytail: one store, one key per app. Key by app+panel id if an app ever needs two folders.
  function store(mode, fn) {
    return new Promise(function (res, rej) {
      var open = indexedDB.open("cowork-ui", 1);
      open.onupgradeneeded = function () { open.result.createObjectStore("dirs"); };
      open.onerror = function () { rej(open.error); };
      open.onsuccess = function () {
        var db = open.result, tx = db.transaction("dirs", mode), rq = fn(tx.objectStore("dirs"));
        tx.oncomplete = function () { db.close(); res(rq && rq.result); };
        tx.onerror = function () { db.close(); rej(tx.error); };
      };
    });
  }
  var saveDir = function (app, h) { return store("readwrite", function (s) { return s.put(h, app); }); };
  var loadDir = function (app) { return store("readonly", function (s) { return s.get(app); }); };
  var dropDir = function (app) { return store("readwrite", function (s) { return s.delete(app); }); };

  // ---------- File System Access plumbing ----------
  async function dirFor(root, path, create) {
    var parts = path.split("/").filter(Boolean), dir = root;
    for (var i = 0; i < parts.length - 1; i++) dir = await dir.getDirectoryHandle(parts[i], { create: create });
    return { dir: dir, name: parts[parts.length - 1] };
  }
  async function statFile(root, path) {
    try {
      var at = await dirFor(root, path, false);
      var f = await (await at.dir.getFileHandle(at.name)).getFile();
      return f.lastModified / 1000;
    } catch (err) { return 0; }
  }
  async function readFile(root, path) {
    try {
      var at = await dirFor(root, path, false);
      var f = await (await at.dir.getFileHandle(at.name)).getFile();
      return await f.text();
    } catch (err) { return null; }
  }
  async function writeFile(root, path, text) {
    var at = await dirFor(root, path, true);
    var h = await at.dir.getFileHandle(at.name, { create: true });
    var w = await h.createWritable();          // atomic on close, per the spec
    await w.write(text);
    await w.close();
  }
  async function removeFile(root, path) {
    try { var at = await dirFor(root, path, false); await at.dir.removeEntry(at.name); return true; } catch (err) { return false; }
  }
  async function newestIn(root, path, prefix) {
    // newest prefix*.json in a directory: {at (sec), name}; at=0 if none.
    try {
      var dir = root, parts = path.split("/").filter(Boolean);
      for (var i = 0; i < parts.length; i++) dir = await dir.getDirectoryHandle(parts[i]);
      var best = 0, bestName = null;
      for await (const entry of dir.values()) {
        if (entry.kind !== "file" || entry.name.indexOf(prefix) !== 0 || !/\.json$/.test(entry.name)) continue;
        var t = (await entry.getFile()).lastModified / 1000;
        if (t > best) { best = t; bestName = entry.name; }
      }
      return { at: best, name: bestName };
    } catch (err) { return { at: 0, name: null }; }
  }

  // ---------- styles ----------
  var CSS = [
    ":host{all:initial;display:block;",
    "--cowork-bg:#fff;--cowork-card:#f7f8fa;--cowork-ink:#161b26;--cowork-mut:#5c6572;",
    "--cowork-line:#dfe3ea;--cowork-acc:#1d4ed8;--cowork-accink:#fff;--cowork-radius:12px;",
    "--cowork-mono:ui-monospace,'Cascadia Code',Consolas,'SF Mono',monospace;",
    "--cowork-sans:var(--app-font,system-ui,'Segoe UI',sans-serif);",
    "color:var(--cowork-ink);font:14px/1.5 var(--cowork-sans);text-align:left}",
    "@media (prefers-color-scheme:dark){:host{--cowork-bg:#111726;--cowork-card:#171e2f;",
    "--cowork-ink:#e8ecf5;--cowork-mut:#96a0b5;--cowork-line:#2a3346;--cowork-acc:#7aa2ff;",
    "--cowork-accink:#0b1020}}",
    ":host([theme=light]){--cowork-bg:#fff;--cowork-card:#f7f8fa;--cowork-ink:#161b26;",
    "--cowork-mut:#5c6572;--cowork-line:#dfe3ea;--cowork-acc:#1d4ed8;--cowork-accink:#fff}",
    ":host([theme=dark]){--cowork-bg:#111726;--cowork-card:#171e2f;--cowork-ink:#e8ecf5;",
    "--cowork-mut:#96a0b5;--cowork-line:#2a3346;--cowork-acc:#7aa2ff;--cowork-accink:#0b1020}",
    "*{box-sizing:border-box}",
    "[hidden]{display:none!important}",
    ".wrap{background:var(--cowork-bg);border:1px solid var(--cowork-line);",
    "border-radius:var(--cowork-radius);overflow:hidden}",
    "header{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:12px 14px;",
    "border-bottom:1px solid var(--cowork-line);background:var(--cowork-card)}",
    "h2{margin:0;font:600 13px var(--cowork-mono);letter-spacing:.6px;text-transform:uppercase;",
    "color:var(--cowork-mut)}",
    ".folder{font:12px var(--cowork-mono);color:var(--cowork-mut);margin-left:auto;",
    "max-width:52%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    "button,select,input{font:600 12px var(--cowork-mono);padding:6px 10px;border-radius:8px;",
    "border:1px solid var(--cowork-line);background:var(--cowork-bg);color:var(--cowork-ink)}",
    "button{cursor:pointer}",
    "input[type=checkbox]{padding:0;width:auto}",
    "button:hover:not(:disabled){border-color:var(--cowork-acc)}",
    "button:disabled{opacity:.45;cursor:default}",
    "button.primary{background:var(--cowork-acc);color:var(--cowork-accink);border-color:var(--cowork-acc)}",
    "button.link{border:0;background:none;color:var(--cowork-acc);padding:4px 6px;text-decoration:underline}",
    ":focus-visible{outline:2px solid var(--cowork-acc);outline-offset:2px}",
    "ul{list-style:none;margin:0;padding:0}",
    "li.ch{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:11px 14px;",
    "border-bottom:1px solid var(--cowork-line)}",
    ".name{font:600 13px var(--cowork-mono);min-width:9em}",
    ".pill{font:600 10px var(--cowork-mono);letter-spacing:.6px;padding:2px 8px;border-radius:999px;",
    "border:1px solid var(--cowork-line);color:var(--cowork-mut);text-transform:uppercase}",
    ".pill.pending{color:#9a6700;border-color:#9a6700}",
    ".pill.stale{color:#c1121f;border-color:#c1121f}",
    ".pill.answered{color:#1a7f37;border-color:#1a7f37}",
    ".pill.review{color:var(--cowork-acc);border-color:var(--cowork-acc)}",
    ".pill.note{color:#c1121f;border-color:#c1121f}",
    ".when{font:11px var(--cowork-mono);color:var(--cowork-mut)}",
    ".acts{margin-left:auto;display:flex;gap:6px;flex-wrap:wrap;align-items:center}",
    ".acts label{font:11px var(--cowork-mono);color:var(--cowork-mut);display:flex;gap:4px;align-items:center}",
    ".rvcard{flex-basis:100%;border:1px solid var(--cowork-acc);border-radius:10px;padding:10px 12px;background:var(--cowork-card)}",
    ".rvcard h3{margin:0 0 6px;font:600 12px var(--cowork-mono)}",
    ".rvcard .row{display:flex;gap:8px;align-items:flex-start;padding:4px 0;font-size:13px}",
    ".rvcard .row small{display:block;color:var(--cowork-mut);font-size:12px}",
    ".rvcard pre{margin:0 0 8px;max-height:16em;overflow:auto;white-space:pre-wrap;font:11px/1.45 var(--cowork-mono);color:var(--cowork-mut)}",
    ".rvcard .btns{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}",
    "details{border-top:1px solid var(--cowork-line);padding:8px 14px;font-size:13px}",
    "summary{cursor:pointer;font:600 12px var(--cowork-mono);color:var(--cowork-mut)}",
    ".hist li{display:flex;gap:8px;flex-wrap:wrap;padding:4px 0;font:11px var(--cowork-mono);color:var(--cowork-mut);border-bottom:1px dashed var(--cowork-line)}",
    ".hist li.bad{color:#c1121f}",
    ".set{display:grid;gap:8px;margin-top:6px}",
    ".set input[type=text]{width:100%}",
    "footer{padding:10px 14px;font:11px var(--cowork-mono);color:var(--cowork-mut);",
    "display:flex;gap:12px;flex-wrap:wrap;align-items:center;background:var(--cowork-card);",
    "border-top:1px solid var(--cowork-line)}",
    "footer a{color:var(--cowork-acc)}",
    ".msg{padding:11px 14px;font:12px var(--cowork-mono);color:var(--cowork-mut)}",
    ".msg.err{color:#c1121f}",
    ".empty{padding:22px 14px;text-align:center;color:var(--cowork-mut);font-size:13px}",
    ".extra.none{display:none}",
    ".extra{padding:10px 14px;border-top:1px solid var(--cowork-line)}",
    "::slotted(*){font:inherit}"
  ].join("\n");

  // ---------- the element ----------
  class CoworkPanel extends HTMLElement {
    constructor() {
      super();
      this._cfg = null;
      this._chs = [];
      this._root = null;      // FileSystemDirectoryHandle in fs mode
      this._msg = "";
      this._err = false;
      this._busy = false;
      this._actions = [];
      this._chActions = null;
      this._st = null;        // per-app device-local state (fs mode)
      this._claim = null;     // the folder's cowork-machine.json
      this._timers = [];
      this.attachShadow({ mode: "open" });
      var st = document.createElement("style");
      st.textContent = CSS;
      this.shadowRoot.appendChild(st);
      this._host = el("div", "wrap");
      this.shadowRoot.appendChild(this._host);
    }
    get mode() { return this.getAttribute("mode") === "data" ? "data" : "fs"; }
    // React 19 assigns known properties instead of attributes, so the attribute needs a setter twin
    set mode(v) { if (v == null) this.removeAttribute("mode"); else this.setAttribute("mode", String(v)); }

    connectedCallback() {
      this.render();
      if (this.mode === "fs" && this._cfg) this._restore();
      // A reply usually lands while the tab is in the background.
      var self = this;
      this._onFocus = function () { if (self.mode === "fs" && self._root) self.refresh(); };
      window.addEventListener("focus", this._onFocus);
      this._startTimers();
    }
    disconnectedCallback() {
      window.removeEventListener("focus", this._onFocus);
      this._timers.forEach(clearInterval); this._timers = [];
    }
    _startTimers() {
      if (this.mode !== "fs" || this._timers.length) return;
      var self = this;
      // replies every 5 minutes on every device with the folder; schedules once a minute on the sync device
      this._timers.push(setInterval(function () { if (self._root) self.refresh(); }, 5 * 60e3));
      this._timers.push(setInterval(function () { self.tick(); }, 60e3));
    }

    _chCfg(name) { return (this._cfg && this._cfg.channels && this._cfg.channels[name]) || {}; }
    scheduleOf(name) { var v = this._st && this._st.sched[name]; return SCHEDULES.some(function (s) { return s.id === v; }) ? v : (this._chCfg(name).schedule || "off"); }
    reviewOn(name) { var v = this._st && this._st.review[name]; return typeof v === "boolean" ? v : this._chCfg(name).review !== false; }
    isSyncDevice() { return !!(this._claim && this._claim.deviceId === deviceId()); }
    _log(entry) { entry.at = entry.at || Date.now(); this._st.history.push(entry); saveState(this._cfg.app, this._st); }

    /* fs mode: see the header comment */
    configure(cfg) {
      this._cfg = cfg;
      this._st = loadState(cfg.app);
      var self = this;
      this._chs = (cfg.manifest && cfg.manifest.channels || []).map(function (c) {
        return { channel: c.name, label: self._chCfg(c.name).label || c.name, spec: c, pending: false, answered: false, stale: false, note: "" };
      });
      this.render();
      if (this.isConnected) { this._restore(); this._startTimers(); }
      return this;
    }
    /* data mode: {app, channels:[...], folder?, actions?, channelActions?}
       channels come straight from coworkhub.py's scanner (or an app's own state);
       actions = [{id,label,primary}] in the header, channelActions the same per row.
       Every button dispatches a bubbling `cowork-action` {app, action, channel}. */
    set data(d) {
      this._cfg = { app: d.app, folder: d.folder || "" };
      this._chs = d.channels || [];
      this._actions = d.actions || [];
      this._chActions = d.channelActions || [{ id: "run", label: "Run", primary: "pending" },
                                              { id: "force", label: "Force" }];
      if (d.message !== undefined) this._note(d.message, !!d.error);
      this.render();
    }
    get channels() { return this._chs; }

    async _restore() {
      var h = await loadDir(this._cfg.app).catch(function () { return null; });
      if (!h) return;
      var ok = await h.queryPermission({ mode: "readwrite" }).catch(function () { return "denied"; });
      if (ok !== "granted") { this._note("folder needs re-connecting"); this.render(); return; }
      this._root = h;
      await this._readClaim();
      this.refresh();
    }
    _note(m, isErr) { this._msg = m; this._err = !!isErr; }

    // ---- the one sync device: a claim file in the folder, so it holds on every device that opens it ----
    async _readClaim() {
      var t = this._root && await readFile(this._root, "cowork-machine.json");
      try { this._claim = t ? JSON.parse(t) : null; } catch (e) { this._claim = null; }
      return this._claim;
    }
    async claim() {
      if (!this._root) return;
      this._claim = { deviceId: deviceId(), name: deviceName(), at: new Date().toISOString() };
      await writeFile(this._root, "cowork-machine.json", JSON.stringify(this._claim, null, 2));
      this._log({ kind: "claim", note: "schedules now run on " + this._claim.name });
      this.render();
    }

    async connect() {
      if (!window.showDirectoryPicker) {
        this._note("this browser can't open folders — use Chrome or Edge on desktop", true);
        return this.render();
      }
      try {
        var h = await window.showDirectoryPicker({ id: "cowork-" + this._cfg.app, mode: "readwrite" });
        await this.useFolder(h);
      } catch (err) {
        if (err && err.name !== "AbortError") this._note(String(err.message || err), true);
        this.render();
      }
    }
    /* connect a given folder handle (connect() asks the user for one) */
    async useFolder(h) {
      this._root = h;
      await saveDir(this._cfg.app, h).catch(function () {});
      this._note("");
      if (!(await this._readClaim())) await this.claim(); // the first device to connect runs the schedules
      await this.push();            // a fresh folder starts with a manifest + requests
    }
    async forget() {
      this._root = null;
      await dropDir(this._cfg.app).catch(function () {});
      this._chs.forEach(function (c) { c.pending = c.answered = c.stale = false; c.review = null; c.request_mtime = c.reply_mtime = 0; });
      this._note("folder disconnected — nothing was deleted");
      this.render();
    }

    /* write the manifest + the request files of every channel (or one); auto = a scheduled run */
    async push(only, auto) {
      if (!this._root || this._busy) return;
      this._busy = true; if (!auto) { this._note("writing…"); this.render(); }
      try {
        await writeFile(this._root, "cowork.json", JSON.stringify(this._cfg.manifest, null, 2));
        for (var i = 0; i < this._chs.length; i++) {
          var ch = this._chs[i];
          if (only && ch.channel !== only) continue;
          var files = (this._cfg.files && await this._cfg.files(ch.channel)) || {};
          var paths = Object.keys(files), all = "";
          for (var j = 0; j < paths.length; j++) {
            var v = files[paths[j]], text = typeof v === "string" ? v : JSON.stringify(v, null, 2);
            await writeFile(this._root, paths[j], text);
            if (/\.json$/.test(paths[j])) all += text;
          }
          // the request's own requestHash if it declares one, else a hash of what was written
          var declared = null;
          paths.forEach(function (p) { var v = files[p]; if (v && typeof v === "object" && v.requestHash != null) declared = String(v.requestHash); });
          this._st.reqHash[ch.channel] = declared || hash(all);
          this._st.lastRun[ch.channel] = Date.now();
          this._log({ kind: "write", channel: ch.channel, auto: !!auto, note: paths.length + " file(s)" });
        }
        if (this._cfg.brief) {
          var b = await this._cfg.brief();
          if (b && b.markdown) await writeFile(this._root, "BRIEF.md", b.markdown);
          if (b && b.data) await writeFile(this._root, "brief.json", JSON.stringify(b.data, null, 2));
        }
        this._note("");
      } catch (err) {
        this._note(String(err.message || err), true);
        this._log({ kind: "error", channel: only || "", auto: !!auto, note: String(err.message || err), bad: true });
      }
      saveState(this._cfg.app, this._st);
      this._busy = false;
      await this.refresh();
    }

    /* one scheduler pass: only the sync device runs schedules */
    async tick(now) {
      now = now || Date.now();
      if (!this._root || this._busy) return [];
      await this._readClaim();
      if (!this.isSyncDevice()) { this.render(); return []; }
      var due = this._chs.filter(function (ch) { return isDue(this.scheduleOf(ch.channel), this._st.lastRun[ch.channel], now); }, this);
      for (var i = 0; i < due.length; i++) await this.push(due[i].channel, true);
      return due.map(function (c) { return c.channel; });
    }

    async _readReply(ch) {
      var spec = ch.spec || {};
      if (spec.replyDir) {
        var found = await newestIn(this._root, spec.replyDir, spec.replyPrefix || "output-");
        var err = await newestIn(this._root, spec.replyDir, "error-");
        return { at: found.at, path: found.name ? spec.replyDir + "/" + found.name : null, errAt: err.at, errPath: err.name ? spec.replyDir + "/" + err.name : null };
      }
      if (spec.replyPath) {
        var errPath = spec.replyPath.replace(/\.json$/, "") + "-error.json";
        return { at: await statFile(this._root, spec.replyPath), path: spec.replyPath, errAt: await statFile(this._root, errPath), errPath: errPath };
      }
      return { at: 0, path: null, errAt: 0 };
    }

    /* stat the folder, and take in any reply not handled yet */
    async refresh() {
      if (!this._root) return this.render();
      var st = this._st;
      for (var i = 0; i < this._chs.length; i++) {
        var ch = this._chs[i], spec = ch.spec || {}, reqs = spec.request || [];
        var rq = 0;
        for (var k = 0; k < reqs.length; k++) rq = Math.max(rq, await statFile(this._root, reqs[k]));
        var r = await this._readReply(ch), rp = r.at;
        ch.request_mtime = rq; ch.reply_mtime = rp; ch.note = ""; ch.justApplied = false;
        // an agent that could not do the job says why
        if (r.errAt && r.errAt >= rq && r.errAt >= rp) {
          var et = await readFile(this._root, r.errPath), eh = "err:" + hash(et);
          var reason = ""; try { reason = JSON.parse(et).reason || ""; } catch (e) { reason = (et || "").slice(0, 200); }
          ch.note = "agent reported: " + (reason || "no reason given");
          if (st.ledger.indexOf(eh) < 0) { st.ledger.push(eh); this._log({ kind: "error", channel: ch.channel, note: ch.note, bad: true }); }
        }
        ch.pending = !!rq && (rp === 0 || rq > rp);
        ch.answered = !!rp && rp >= rq;
        ch.stale = ch.pending && rq > 0 && (Date.now() / 1000 - rq) > 7 * 86400;
        if (!r.path || !rp) { ch.review = null; continue; }
        var text = await readFile(this._root, r.path), h = hash(text);
        if (st.ledger.indexOf(h) >= 0) { ch.review = null; continue; }       // handled before: never twice
        var reply;
        try { reply = JSON.parse(text); } catch (err) { ch.note = "reply could not be read: " + (err.message || err); continue; }
        var echo = reply && (reply.requestHash != null ? String(reply.requestHash) : null), want = st.reqHash[ch.channel];
        if (echo && want && echo !== want) {
          ch.note = "this reply answers an older request — send again for a fresh one";
          if (st.ledger.indexOf("old:" + h) < 0) { st.ledger.push("old:" + h); this._log({ kind: "skip", channel: ch.channel, note: ch.note, bad: true }); }
          continue;
        }
        var item = { reply: reply, text: text, hash: h, path: r.path, rows: null };
        if (this.reviewOn(ch.channel)) {
          var cc = this._chCfg(ch.channel);
          try { item.rows = cc.preview ? (await cc.preview(reply)) || [] : null; } catch (err) { ch.note = "could not preview the reply: " + (err.message || err); continue; }
          ch.review = item;
        } else {
          // review is off for this channel: accept every change the app would have listed
          var cc2 = this._chCfg(ch.channel), all = null;
          if (cc2.preview) { try { all = ((await cc2.preview(reply)) || []).map(function (r) { return r.id; }); } catch (err) { ch.note = "could not read the reply's changes: " + (err.message || err); continue; } }
          await this._apply(ch, item, all, true);
        }
      }
      saveState(this._cfg.app, st);
      this.render();
    }

    /* apply a reply (all of it, or the ticked review rows), record it, archive it */
    async _apply(ch, item, accepted, auto) {
      var cc = this._chCfg(ch.channel), res = null;
      try {
        if (cc.apply) res = await cc.apply(item.reply, accepted);
        else if (this._cfg.apply) res = await this._cfg.apply(ch.channel, item.reply);
      } catch (err) {
        ch.note = "the reply could not be applied: " + (err.message || err);
        this._log({ kind: "error", channel: ch.channel, auto: !!auto, note: ch.note, bad: true });
        return this.render();
      }
      res = res && typeof res === "object" ? res : {};
      this._st.ledger.push(item.hash);
      var n = accepted ? accepted.length : null;
      this._log({ kind: "apply", channel: ch.channel, auto: !!auto, note: res.summary || (n != null ? n + " change(s) applied" : "applied"), undo: res.undo != null ? res.undo : undefined });
      ch.review = null; ch.justApplied = true;
      await this._archive(ch, item);
      saveState(this._cfg.app, this._st);
      this.render();
    }
    async discard(chName) {
      var ch = this._chs.filter(function (c) { return c.channel === chName; })[0];
      if (!ch || !ch.review) return;
      this._st.ledger.push(ch.review.hash);
      this._log({ kind: "discard", channel: ch.channel, note: "reply discarded unread" });
      await this._archive(ch, ch.review);
      ch.review = null;
      saveState(this._cfg.app, this._st);
      this.render();
    }
    async approve(chName, acceptedIds) {
      var ch = this._chs.filter(function (c) { return c.channel === chName; })[0];
      if (!ch || !ch.review) return;
      var rows = ch.review.rows;
      await this._apply(ch, ch.review, rows ? (acceptedIds || rows.map(function (r) { return r.id; })) : null, false);
    }
    async _archive(ch, item) {
      // dir-style replies move to <channel>/processed/ (the app owns that move); a fixed reply path stays, the ledger covers it
      if (!(ch.spec && ch.spec.replyDir) || !item.path) return;
      var name = item.path.split("/").pop(), dest = ch.spec.replyDir.replace(/\/[^/]*$/, "") + "/processed/" + name;
      if (!/\//.test(ch.spec.replyDir)) dest = "processed/" + name;
      try { await writeFile(this._root, dest, item.text); await removeFile(this._root, item.path); } catch (err) { /* leave it in place; the ledger prevents a re-apply */ }
    }
    async undo(index) {
      var e = this._st.history[index];
      if (!e || e.kind !== "apply" || e.undo === undefined || e.undone) return;
      var cc = this._chCfg(e.channel);
      try {
        if (cc.undo) await cc.undo(e.undo); else if (this._cfg.undo) await this._cfg.undo(e.channel, e.undo); else throw new Error("this app has no undo");
        e.undone = true;
        this._log({ kind: "undo", channel: e.channel, note: "undid: " + e.note });
      } catch (err) { this._note("undo failed: " + (err.message || err), true); }
      saveState(this._cfg.app, this._st);
      this.render();
    }

    _act(action, channel) {
      this.dispatchEvent(new CustomEvent("cowork-action", {
        bubbles: true, composed: true,
        detail: { app: this._cfg && this._cfg.app, action: action, channel: channel }
      }));
    }

    _renderReview(li, ch) {
      var self = this, rv = ch.review, box = el("div", "rvcard");
      box.appendChild(el("h3", null, "A reply for " + ch.label + " is waiting — review it before it changes anything"));
      var boxes = [];
      if (rv.rows && rv.rows.length) {
        rv.rows.forEach(function (r) {
          var row = el("label", "row"), cb = el("input");
          cb.type = "checkbox"; cb.checked = true; cb.value = r.id; boxes.push(cb);
          var txt = el("span", null, r.label);
          if (r.detail) txt.appendChild(el("small", null, r.detail));
          row.append(cb, txt); box.appendChild(row);
        });
      } else if (rv.rows && !rv.rows.length) {
        box.appendChild(el("div", "when", "The reply proposes no changes."));
      } else {
        var shown = rv.reply && rv.reply.payload !== undefined ? rv.reply.payload : rv.reply;
        box.appendChild(el("pre", null, (typeof shown === "string" ? shown : JSON.stringify(shown, null, 2)).slice(0, 2000)));
      }
      var btns = el("div", "btns");
      var ap = el("button", "primary", rv.rows && rv.rows.length ? "Apply selected" : "Apply");
      ap.onclick = function () { self.approve(ch.channel, rv.rows ? boxes.filter(function (b) { return b.checked; }).map(function (b) { return b.value; }) : null); };
      var ds = el("button", null, "Discard");
      ds.onclick = function () { self.discard(ch.channel); };
      btns.append(ap, ds); box.appendChild(btns);
      li.appendChild(box);
    }

    render() {
      var self = this, fs = this.mode === "fs", host = this._host, now = Date.now() / 1000;
      host.textContent = "";
      var head = el("header");
      head.appendChild(el("h2", null, "AI cowork sync"));
      if (fs) {
        var conn = el("button", this._root ? "" : "primary", this._root ? "Change folder" : "Connect folder");
        conn.onclick = function () { self.connect(); };
        head.appendChild(conn);
        if (this._root) {
          var send = el("button", "primary", "Send requests");
          send.onclick = function () { self.push(); };
          head.appendChild(send);
          var chk = el("button", null, "Check for replies");
          chk.onclick = function () { self.refresh(); };
          head.appendChild(chk);
        }
        var label = this._st && this._st.pathLabel;
        head.appendChild(el("span", "folder", this._root ? (label || this._root.name) : "no folder connected"));
      } else {
        (this._actions || []).forEach(function (ac) {
          var b = el("button", ac.primary ? "primary" : "", ac.label);
          b.onclick = function () { self._act(ac.id, null); };
          head.appendChild(b);
        });
        head.appendChild(el("span", "folder", this._cfg && (this._cfg.folder || this._cfg.app) || ""));
      }
      host.appendChild(head);

      if (this._msg) host.appendChild(el("div", "msg" + (this._err ? " err" : ""), this._msg));
      if (!this._chs.length) {
        host.appendChild(el("div", "empty", "No channels yet."));
      } else {
        var ul = el("ul");
        this._chs.forEach(function (ch) {
          var st = stateOf(ch), li = el("li", "ch");
          li.appendChild(el("span", "name", ch.label || ch.channel));
          var cls = { PENDING: "pending", STALE: "stale", answered: "answered", REVIEW: "review", "-": "note" }[st] || "";
          li.appendChild(el("span", "pill " + cls, st === "-" ? "note" : st));
          var rq = ch.request_mtime, rp = ch.reply_mtime;
          li.appendChild(el("span", "when", !rq && !rp ? "nothing asked yet"
            : "asked " + (rq ? rel(now - rq) : "never") + " · replied " + (rp ? rel(now - rp) : "never")));
          if (ch.note) li.appendChild(el("span", "when", ch.note));
          if (ch.justApplied) li.appendChild(el("span", "when", "· imported"));
          var acts = el("div", "acts");
          if (fs) {
            var sel = el("select"); sel.title = "Schedule (runs on the sync device)";
            SCHEDULES.forEach(function (s) { var o = el("option", null, s.label); o.value = s.id; sel.appendChild(o); });
            sel.value = self.scheduleOf(ch.channel);
            sel.onchange = function () { self._st.sched[ch.channel] = sel.value; saveState(self._cfg.app, self._st); };
            var rl = el("label"), rc = el("input"); rc.type = "checkbox"; rc.checked = self.reviewOn(ch.channel);
            rc.onchange = function () { self._st.review[ch.channel] = rc.checked; saveState(self._cfg.app, self._st); };
            rl.append(rc, "review first");
            var one = el("button", null, "Send");
            one.disabled = !self._root;
            one.onclick = function () { self.push(ch.channel); };
            acts.append(sel, rl, one);
          } else {
            (self._chActions || []).forEach(function (ac) {
              var prim = ac.primary === true || (ac.primary === "pending" && ch.pending && !ch.answered);
              var b = el("button", prim ? "primary" : "", ac.label);
              b.onclick = function () { self._act(ac.id, ch.channel); };
              acts.appendChild(b);
            });
          }
          li.appendChild(acts);
          if (fs && ch.review) self._renderReview(li, ch);
          ul.appendChild(li);
        });
        host.appendChild(ul);
      }

      if (fs && this._root && this._st) {
        // the sync device and the folder's full path (the browser only reveals the last folder name)
        var sd = el("details"), ss = el("summary", null, "Sync device: " + (this._claim ? this._claim.name + (this.isSyncDevice() ? " (this device)" : "") : "none"));
        sd.appendChild(ss);
        var set = el("div", "set");
        if (!this.isSyncDevice()) {
          var cl = el("button", null, "Run the schedules on this device");
          cl.onclick = function () { self.claim(); };
          set.appendChild(cl);
        }
        set.appendChild(el("div", "when", "Schedules run only on the sync device; any device can send or check by hand."));
        var pl = el("input"); pl.type = "text"; pl.placeholder = "Full folder path, for your own reference"; pl.value = this._st.pathLabel || "";
        pl.onchange = function () { self._st.pathLabel = pl.value.trim(); saveState(self._cfg.app, self._st); self.render(); };
        set.appendChild(pl);
        sd.appendChild(set);
        host.appendChild(sd);
        // the run history, newest first, with undo where the app gave undo data
        var hd = el("details"), hist = this._st.history;
        hd.appendChild(el("summary", null, "History (" + hist.length + ")"));
        var hl = el("ul", "hist");
        for (var i = hist.length - 1, shown = 0; i >= 0 && shown < 40; i--, shown++) {
          (function (e, idx) {
            var li = el("li", e.bad ? "bad" : "");
            li.appendChild(el("span", null, new Date(e.at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })));
            li.appendChild(el("span", null, (e.channel ? e.channel + " · " : "") + e.kind + (e.auto ? " (scheduled)" : "")));
            li.appendChild(el("span", null, e.note || ""));
            if (e.kind === "apply" && e.undo !== undefined && !e.undone) {
              var u = el("button", "link", "undo"); u.onclick = function () { self.undo(idx); }; li.appendChild(u);
            }
            if (e.undone) li.appendChild(el("span", null, "(undone)"));
            hl.appendChild(li);
          })(hist[i], i);
        }
        if (!hist.length) hl.appendChild(el("li", null, "Nothing yet."));
        hd.appendChild(hl);
        host.appendChild(hd);
      }

      var extra = el("div", "extra");
      extra.appendChild(document.createElement("slot"));   // app-specific options live here
      if (!this.childElementCount) extra.classList.add("none");
      host.appendChild(extra);

      var foot = el("footer");
      foot.appendChild(el("span", null, fs
        ? "Point this at a folder, then let an agent answer in it. Nothing is uploaded."
        : "Served by CoworkSyncHub."));
      var a = el("a", null, "how cowork sync works");
      a.href = PORTAL + "cowork"; a.target = "_blank"; a.rel = "noopener";
      foot.appendChild(a);
      if (fs && this._root) {
        var forget = el("button", "link", "disconnect");
        forget.onclick = function () { self.forget(); };
        foot.appendChild(forget);
      }
      host.appendChild(foot);
    }
  }

  if (!customElements.get("cowork-panel")) customElements.define("cowork-panel", CoworkPanel);

  window.cowork = {
    version: VERSION,
    stateOf: stateOf,
    rel: rel,
    hash: hash,
    isDue: isDue,
    schedules: SCHEDULES,
    /* one-liner for apps: cowork.mount(hostEl, cfg) */
    mount: function (host, cfg) {
      var p = document.createElement("cowork-panel");
      host.appendChild(p);
      return p.configure(cfg);
    }
  };
})();
