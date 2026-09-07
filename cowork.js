/* cowork.js — the AI cowork sync UI. One implementation, every app.

   Published at https://adervec.github.io/cowork.js and loaded by each app, so
   the sync panel looks and behaves identically no matter what the host app
   looks like. It renders into a shadow root, so the host's CSS cannot reach in
   and the panel's CSS cannot leak out; the only supported theming is the
   --cowork-* custom properties listed in CSS below.

   Two adapters, because there are exactly two places this runs:
     fs   — inside an app: File System Access API, drives a real cowork folder.
     data — inside CoworkSyncHub's status.html: fed a JSON snapshot by the hub,
            buttons dispatch `cowork-action` events instead of touching the disk.

   State vocabulary is copied from coworkhub.py's scanner on purpose: idle,
   PENDING, answered, STALE, "-" (note). One word means one thing everywhere.

   Self-check: /cowork-selftest.html (written by portal.py build).
*/
(function () {
  "use strict";
  var PORTAL = "https://adervec.github.io/";
  var VERSION = 1;

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

  // ---------- directory handles survive reloads only in IndexedDB ----------
  // ponytail: one store, one key per app. Key by app+panel id if an app ever
  // needs two folders.
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
    "--cowork-sans:system-ui,'Segoe UI',sans-serif;",
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
    "button{font:600 12px var(--cowork-mono);padding:6px 12px;border-radius:8px;cursor:pointer;",
    "border:1px solid var(--cowork-line);background:var(--cowork-bg);color:var(--cowork-ink)}",
    "button:hover:not(:disabled){border-color:var(--cowork-acc)}",
    "button:disabled{opacity:.45;cursor:default}",
    "button.primary{background:var(--cowork-acc);color:var(--cowork-accink);border-color:var(--cowork-acc)}",
    "button.link{border:0;background:none;color:var(--cowork-acc);padding:4px 6px;text-decoration:underline}",
    ":focus-visible{outline:2px solid var(--cowork-acc);outline-offset:2px}",
    "ul{list-style:none;margin:0;padding:0}",
    "li{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:11px 14px;",
    "border-bottom:1px solid var(--cowork-line)}",
    "li:last-child{border-bottom:0}",
    ".name{font:600 13px var(--cowork-mono);min-width:9em}",
    ".pill{font:600 10px var(--cowork-mono);letter-spacing:.6px;padding:2px 8px;border-radius:999px;",
    "border:1px solid var(--cowork-line);color:var(--cowork-mut);text-transform:uppercase}",
    ".pill.pending{color:#9a6700;border-color:#9a6700}",
    ".pill.stale{color:#c1121f;border-color:#c1121f}",
    ".pill.answered{color:#1a7f37;border-color:#1a7f37}",
    ".pill.note{color:#c1121f;border-color:#c1121f}",
    ".when{font:11px var(--cowork-mono);color:var(--cowork-mut)}",
    ".acts{margin-left:auto;display:flex;gap:6px;flex-wrap:wrap}",
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
    }
    disconnectedCallback() { window.removeEventListener("focus", this._onFocus); }

    /* fs mode: {app, manifest, files(channel)->{path:content}, apply(channel, reply)} */
    configure(cfg) {
      this._cfg = cfg;
      this._chs = (cfg.manifest && cfg.manifest.channels || []).map(function (c) {
        return { channel: c.name, spec: c, pending: false, answered: false, stale: false, note: "" };
      });
      this.render();
      if (this.isConnected) this._restore();
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
      this.refresh();
    }
    _note(m, isErr) { this._msg = m; this._err = !!isErr; }

    async connect() {
      if (!window.showDirectoryPicker) {
        this._note("this browser can't open folders — use Chrome or Edge on desktop", true);
        return this.render();
      }
      try {
        var h = await window.showDirectoryPicker({ id: "cowork-" + this._cfg.app, mode: "readwrite" });
        this._root = h;
        await saveDir(this._cfg.app, h);
        this._note("");
        await this.push();            // a fresh folder starts with a manifest + requests
      } catch (err) {
        if (err && err.name !== "AbortError") this._note(String(err.message || err), true);
        this.render();
      }
    }
    async forget() {
      this._root = null;
      await dropDir(this._cfg.app).catch(function () {});
      this._chs.forEach(function (c) { c.pending = c.answered = c.stale = false; c.request_mtime = c.reply_mtime = 0; });
      this._note("folder disconnected — nothing was deleted");
      this.render();
    }

    /* write the manifest + every channel's request files */
    async push(only) {
      if (!this._root || this._busy) return;
      this._busy = true; this._note("writing…"); this.render();
      try {
        await writeFile(this._root, "cowork.json", JSON.stringify(this._cfg.manifest, null, 2));
        for (var i = 0; i < this._chs.length; i++) {
          var ch = this._chs[i];
          if (only && ch.channel !== only) continue;
          var files = (this._cfg.files && this._cfg.files(ch.channel)) || {};
          var paths = Object.keys(files);
          for (var j = 0; j < paths.length; j++) {
            var v = files[paths[j]];
            await writeFile(this._root, paths[j], typeof v === "string" ? v : JSON.stringify(v, null, 2));
          }
        }
        this._note("");
      } catch (err) {
        this._note(String(err.message || err), true);
      }
      this._busy = false;
      await this.refresh();
    }

    /* stat the folder and pull in any reply we haven't applied yet */
    async refresh() {
      if (!this._root) return this.render();
      var cfg = this._cfg;
      for (var i = 0; i < this._chs.length; i++) {
        var ch = this._chs[i], spec = ch.spec || {}, reqs = spec.request || [];
        var rq = 0;
        for (var k = 0; k < reqs.length; k++) rq = Math.max(rq, await statFile(this._root, reqs[k]));
        var rp = 0, replyText = null;
        if (spec.replyDir) {
          var found = await newestIn(this._root, spec.replyDir, spec.replyPrefix || "output-");
          rp = found.at;
          if (found.name) replyText = await readFile(this._root, spec.replyDir + "/" + found.name);
        } else if (spec.replyPath) {
          rp = await statFile(this._root, spec.replyPath);
          if (rp) replyText = await readFile(this._root, spec.replyPath);
        }
        ch.request_mtime = rq; ch.reply_mtime = rp;
        ch.pending = !!rq && (rp === 0 || rq > rp);
        ch.answered = !!rp && rp >= rq;
        ch.stale = ch.pending && rq > 0 && (Date.now() / 1000 - rq) > 7 * 86400;
        ch.justApplied = false;
        if (ch.answered && replyText && cfg.apply) {
          var seen = "cowork-applied:" + cfg.app + ":" + ch.channel, mark = String(Math.round(rp));
          if (localStorage.getItem(seen) !== mark) {
            try {
              await cfg.apply(ch.channel, JSON.parse(replyText));
              localStorage.setItem(seen, mark);
              ch.justApplied = true;
            } catch (err) { ch.note = "reply could not be read: " + (err.message || err); }
          }
        }
      }
      this.render();
    }

    _act(action, channel) {
      this.dispatchEvent(new CustomEvent("cowork-action", {
        bubbles: true, composed: true,
        detail: { app: this._cfg && this._cfg.app, action: action, channel: channel }
      }));
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
        head.appendChild(el("span", "folder", this._root ? this._root.name : "no folder connected"));
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
          var st = stateOf(ch), li = el("li");
          li.appendChild(el("span", "name", ch.channel));
          var cls = { PENDING: "pending", STALE: "stale", answered: "answered", "-": "note" }[st] || "";
          li.appendChild(el("span", "pill " + cls, st === "-" ? "note" : st));
          var rq = ch.request_mtime, rp = ch.reply_mtime;
          li.appendChild(el("span", "when", !rq && !rp ? "nothing asked yet"
            : "asked " + (rq ? rel(now - rq) : "never") + " · replied " + (rp ? rel(now - rp) : "never")));
          if (ch.note) li.appendChild(el("span", "when", ch.note));
          if (ch.justApplied) li.appendChild(el("span", "when", "· imported"));
          var acts = el("div", "acts");
          if (fs) {
            var one = el("button", null, "Send");
            one.disabled = !self._root;
            one.onclick = function () { self.push(ch.channel); };
            acts.appendChild(one);
          } else {
            (self._chActions || []).forEach(function (ac) {
              var prim = ac.primary === true || (ac.primary === "pending" && ch.pending && !ch.answered);
              var b = el("button", prim ? "primary" : "", ac.label);
              b.onclick = function () { self._act(ac.id, ch.channel); };
              acts.appendChild(b);
            });
          }
          li.appendChild(acts);
          ul.appendChild(li);
        });
        host.appendChild(ul);
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
    /* one-liner for apps: cowork.mount(hostEl, cfg) */
    mount: function (host, cfg) {
      var p = document.createElement("cowork-panel");
      host.appendChild(p);
      return p.configure(cfg);
    }
  };
})();
