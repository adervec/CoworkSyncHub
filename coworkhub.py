"""CoworkSyncHub — a passive morning dashboard over two folders it never writes app data into.

  briefs folder   one markdown file a day, written by an agent (Claude Cowork on a schedule).
                  Each `## ` section becomes a tile; each `### ` inside it a collapsed drill-down.
  apps folder     one sub-folder per app, each holding the BRIEF.md the app itself keeps
                  current. Shown as a strip under the dashboard, straight from the app.

  python coworkhub.py [briefs] [--apps DIR] [--port 8791] [--no-open]

Defaults: ~/Documents/Cowork/MorningBrief and ~/Documents/Cowork/Cowork Link Folders when they
exist, else briefs/ beside this file and no app strip. The format the agent writes to is in
the briefs folder's INSTRUCTIONS.md (dropped there on first run). It dispatches nothing.
"""
import argparse
import html
import http.server
import re
import sys
import time
import urllib.parse
import webbrowser
from pathlib import Path

BASE = Path(__file__).resolve().parent
COWORK = Path.home() / "Documents" / "Cowork"
STALE_H = 36  # an app brief older than this is flagged: the app lost its folder grant or wasn't opened
APP_FILES = ("BRIEF.md", "snapshot/activity-log.md")  # ponytail: Tachyread writes a snapshot, not a BRIEF.md

INSTRUCTIONS = """# The daily brief — format

Write ONE file per day into this folder: `YYYY-MM-DD.md` (a re-run overwrites it). The hub
(`coworkhub.py`) renders that file as a dashboard, so the structure below is the layout.

    # Mon 2026-11-09 · <the single most important headline>
    *optional one-line epigraph*

    ## 🔔 Needs you
    - 🔴 <act today>
    - 🟠 <monitor>                     (nothing? write: ✅ Nothing flagged)

    ## 🗓️ Outlook
    | | Today | Tomorrow | Day after |
    |---|---|---|---|
    | Weather | 🟢 12° dry | 🟠 6° rain late | ⚪ 4° cloud |
    | Run window | 🟢 GOOD | 🔴 POOR | 🟠 FAIR |
    | Calendar | dentist 14:00 | clear | clear |
    | Training | easy Z2 40 min | lift: pull | rest |

    ## 🏃 Fitness
    - three to five lines that stand on their own
    ### Readiness
    everything else, as deep as you like
    ### Load math
    ...

Rules:

- **Each `## ` is one tile.** What sits before the tile's first `### ` is always visible:
  keep it to five short lines or one small table. **Each `### ` is a collapsed drill-down**
  — all depth goes there, with no length limit.
- **Severity is an emoji**: 🔴 act today · 🟠 monitor · 🟢 good · ⚪ info. A tile with 🔴 or 🟠
  in its visible part gets a coloured edge, so use them only when earned.
- The tile titled **Needs you** is pinned first. A table in a tile's visible part makes it
  full width — use tables for anything laid out across days.
- **Say each thing once.** Outlook carries the across-days view; the other tiles must not
  repeat its cells. The hub shows every app's own `BRIEF.md` "At a glance" under the
  dashboard, so do not restate app numbers — write what follows from combining sources.
- Plain markdown only: headings, one-level lists, `- [ ]` tasks, tables, bold / italic /
  code, links, fenced blocks. No HTML, no nested lists, no images.
- Write nothing else into this folder.
"""


def fmt_age(t):
    if not t:
        return "-"
    s = max(0.0, time.time() - t)
    for limit, div, unit in ((60, 1, "s"), (3600, 60, "m"), (86400, 3600, "h")):
        if s < limit:
            return f"{int(s / div)}{unit} ago"
    return f"{int(s / 86400)}d ago"


# ---------- markdown ----------
# ponytail: a brief-sized subset (headings, lists, tasks, tables, quotes, fences, inline
# bold/italic/code/links), escape-first so agent-quoted app data can never inject markup.
# No nesting, no images. Swap in a real parser if briefs outgrow it.

def _inline(s):
    s = html.escape(s)
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
    s = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", s)
    s = re.sub(r"(?<![\w*])\*([^*\s][^*]*?)\*(?![\w*])", r"<i>\1</i>", s)
    return re.sub(r"\[([^\]]+)\]\((https?://[^)\s]+)\)", r'<a href="\2" rel="noopener">\1</a>', s)


def _item(s):
    m = re.match(r"\[([ xX])\]\s+(.*)", s)
    if not m:
        return _inline(s)
    return ("<span class='todo'>☐</span> " if m[1] == " " else "<span class='done'>☑</span> ") + _inline(m[2])


def md_html(text):
    out, buf, kind = [], [], None  # kind: p | ul | ol | pre | quote | table

    def flush():
        nonlocal buf, kind
        if kind in ("p", "quote"):
            tag = "p" if kind == "p" else "blockquote"
            out.append(f"<{tag}>" + "<br>".join(buf) + f"</{tag}>")
        elif kind in ("ul", "ol"):
            out.append(f"<{kind}>" + "".join(f"<li>{x}</li>" for x in buf) + f"</{kind}>")
        elif kind == "pre":
            out.append("<pre>" + html.escape("\n".join(buf)) + "</pre>")
        elif kind == "table":
            rows = [[_inline(c.strip()) for c in r.strip("|").split("|")]
                    for r in buf if not re.fullmatch(r"[\s|:-]+", r)]
            out.append("<div class='tw'><table>" + "".join(
                "<tr>" + "".join(f"<{t}>{c}</{t}>" for c in r) + "</tr>"
                for i, r in enumerate(rows) for t in ["td" if i else "th"]) + "</table></div>")
        buf, kind = [], None

    def add(k, item):
        nonlocal kind
        if kind != k:
            flush()
            kind = k
        buf.append(item)

    for line in text.splitlines():
        s = line.strip()
        if kind == "pre":
            if s.startswith("```"):
                flush()
            else:
                buf.append(line)
        elif s.startswith("```"):
            flush()
            kind = "pre"
        elif not s:
            flush()
        elif m := re.match(r"(#{1,6})\s+(.*)", s):
            flush()
            n = min(len(m[1]) + 2, 6)
            out.append(f"<h{n}>{_inline(m[2])}</h{n}>")
        elif re.fullmatch(r"-{3,}|\*{3,}|_{3,}", s):
            flush()
            out.append("<hr>")
        elif m := re.match(r"[-*+]\s+(.*)", s):
            add("ul", _item(m[1]))
        elif m := re.match(r"\d+[.)]\s+(.*)", s):
            add("ol", _inline(m[1]))
        elif s.startswith(">"):
            add("quote", _inline(s.lstrip("> ")))
        elif s.startswith("|"):
            add("table", s)
        else:
            add("p", _inline(s))
    flush()
    return "".join(out)


def split(text, level):
    """Cut markdown at headings of exactly this level -> (text before the first, [(title, body), ...])."""
    mark, pre, parts, fence = "#" * level + " ", [], [], False
    for line in text.splitlines():
        if line.strip().startswith("```"):
            fence = not fence
        if not fence and line.startswith(mark):
            parts.append((line[len(mark):].strip(), []))
        else:
            (parts[-1][1] if parts else pre).append(line)
    return "\n".join(pre), [(t, "\n".join(b)) for t, b in parts]


# ---------- the two folders ----------

def load_briefs(folder):
    """Dated .md files in the briefs folder, newest first. Undated files there are not briefs."""
    briefs = []
    for p in Path(folder).glob("*.md"):
        m = re.search(r"\d{4}-\d{2}-\d{2}", p.stem)
        if not m:
            continue
        try:
            text, mtime = p.read_text(encoding="utf-8", errors="replace"), p.stat().st_mtime
        except OSError:
            continue  # mid-write or locked by a sync client: it will be there on the next reload
        head = re.search(r"^#\s+(.+)$", text, re.M)
        briefs.append({"file": p.name, "day": m[0], "mtime": mtime, "text": text,
                       "title": head[1].strip() if head else p.stem})
    briefs.sort(key=lambda b: (b["day"], b["mtime"]), reverse=True)
    return briefs


def load_apps(root):
    """One entry per app sub-folder: the glance the app wrote about itself, and the rest for drilling."""
    apps = []
    if not root or not Path(root).is_dir():
        return apps
    for d in sorted(Path(root).iterdir(), key=lambda x: x.name.lower()):
        if not d.is_dir():
            continue
        app = {"app": d.name, "mtime": None, "glance": "", "rest": []}
        p = next((d / f for f in APP_FILES if (d / f).is_file()), None)
        try:
            if p:
                text, app["mtime"] = p.read_text(encoding="utf-8", errors="replace"), p.stat().st_mtime
                pre, secs = split(text, 2)
                at = next((i for i, (t, _) in enumerate(secs) if "glance" in t.lower()), 0)
                if secs:
                    app["glance"], app["rest"] = secs[at][1], secs[:at] + secs[at + 1:]
                else:  # a flat log: its first lines are the glance, the whole file the drill-down
                    lines = [x for x in pre.splitlines() if x.strip() and not x.startswith("#")]
                    app["glance"], app["rest"] = "\n".join(lines[:5]), [("Everything", "\n".join(lines))]
        except OSError:
            pass
        apps.append(app)
    return apps


# ---------- page ----------

CSS = """
:root{--bg:#f4f5f7;--card:#fff;--ink:#1c2128;--mut:#69707c;--line:#e2e5ea;--acc:#2f6fde;
--red:#c7372f;--amber:#b7791f;--ok:#1a7a33;--tint:#fff8e6}
@media(prefers-color-scheme:dark){:root{--bg:#14171b;--card:#1d2229;--ink:#e7eaee;--mut:#98a1ad;
--line:#2b323b;--acc:#7fb0ff;--red:#ff8a80;--amber:#ffd45e;--ok:#7fd694;--tint:#2a2413}}
*{box-sizing:border-box}body{font:15px/1.5 system-ui,'Segoe UI',sans-serif;margin:0 auto;
background:var(--bg);color:var(--ink);padding:1.4em 1em 3em;max-width:1120px}
h1{font-size:1.4em;margin:0 0 .15em;line-height:1.25}.epi p{margin:.2em 0;color:var(--mut)}
.mut{color:var(--mut);font-size:.85em}a{color:var(--acc)}
.late{background:var(--tint);border:1px solid var(--amber);border-radius:.5em;padding:.5em .8em;margin:.8em 0}
h2{font-size:.78em;text-transform:uppercase;letter-spacing:.07em;color:var(--mut);margin:2em 0 .6em}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr));gap:.7em;margin-top:1em}
.tile{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--line);
border-radius:.6em;padding:.7em 1em .5em;min-width:0}
.tile.wide{grid-column:1/-1}.tile.red{border-left-color:var(--red)}.tile.amber{border-left-color:var(--amber)}
.tile.needs{background:var(--tint)}
.tile h3{font-size:.95em;margin:0 0 .35em}
.tile p{margin:.35em 0}.tile ul,.tile ol{margin:.35em 0;padding-left:1.2em}.tile li{margin:.15em 0}
h4,h5,h6{font-size:.95em;margin:.9em 0 .3em}
details.more{border-top:1px solid var(--line);margin:0 -1em;padding:0 1em}
details.more:first-of-type{margin-top:.6em}
details.more>summary{cursor:pointer;padding:.4em 0;font-size:.88em;color:var(--mut);font-weight:600}
details.more[open]>summary{color:var(--ink)}
.tw{overflow-x:auto;margin:.4em 0}table{border-collapse:collapse;width:100%}
th,td{padding:.3em .6em;border-bottom:1px solid var(--line);text-align:left;font-size:.93em;vertical-align:top}
th{font-size:.78em;text-transform:uppercase;letter-spacing:.04em;color:var(--mut)}
td:first-child{font-weight:600;white-space:nowrap}
pre{background:var(--bg);padding:.7em;border-radius:.4em;overflow:auto;font-size:.88em}
code{background:var(--bg);padding:.05em .3em;border-radius:.25em;font-size:.9em}
blockquote{margin:.5em 0;padding-left:.8em;border-left:3px solid var(--line);color:var(--mut)}
.todo{color:var(--amber)}.done{color:var(--ok)}
.apps{background:var(--card);border:1px solid var(--line);border-radius:.6em}
.apps>details{border-top:1px solid var(--line)}.apps>details:first-child{border-top:0}
.apps>details>summary{cursor:pointer;display:flex;gap:.8em;align-items:baseline;padding:.5em 1em}
.name{font-weight:600;flex:0 0 9.5em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.one{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.age{flex:none}.stale .age{color:var(--amber);font-weight:600}.none .one{color:var(--mut)}
.apps .body{padding:0 1em .3em;overflow-wrap:anywhere}
.old{columns:2 320px;padding-left:1.2em;margin:.5em 0}.old li{margin:.15em 0;break-inside:avoid}
@media(max-width:560px){.name{flex-basis:6.5em}}
"""


def _tile(title, body):
    glance, subs = split(body, 3)
    g = md_html(glance)
    cls = ["tile"]
    if "🔴" in title + glance:
        cls.append("red")
    elif "🟠" in title + glance:
        cls.append("amber")
    if re.search(r"needs\b", title, re.I):
        cls += ["needs", "wide"]
    elif "<table" in g or len(glance) > 700:
        cls.append("wide")
    more = "".join(f"<details class='more'><summary>{_inline(t)}</summary>{md_html(b)}</details>" for t, b in subs)
    return f"<section class='{' '.join(cls)}'><h3>{_inline(title)}</h3>{g}{more}</section>"


def dashboard(brief):
    pre, secs = split(brief["text"], 2)
    epi = md_html(re.sub(r"^#\s+.+$", "", pre, count=1, flags=re.M))
    secs.sort(key=lambda s: not re.search(r"needs\b", s[0], re.I))  # stable: Needs you first, rest as written
    tiles = "".join(_tile(t, b) for t, b in secs)
    return (f"<h1>{_inline(brief['title'])}</h1><div class='epi'>{epi}</div>"
            f"<div class='mut'>written {html.escape(fmt_age(brief['mtime']))} · {html.escape(brief['file'])}</div>"
            + (f"<div class='grid'>{tiles}</div>" if tiles else ""))


def _app_row(a):
    e = html.escape
    if a["mtime"] is None:
        return (f"<details class='none'><summary><span class='name'>{e(a['app'])}</span>"
                f"<span class='one'>nothing written here yet</span></summary></details>")
    first = next((x for x in a["glance"].splitlines() if x.strip()), "")
    one = re.sub(r"<[^>]+>", "", _inline(re.sub(r"^\s*[-*+]\s+", "", first)))  # one plain line for the row
    stale = time.time() - a["mtime"] > STALE_H * 3600
    more = "".join(f"<details class='more'><summary>{_inline(t)}</summary>{md_html(b)}</details>" for t, b in a["rest"])
    return (f"<details class='{'stale' if stale else ''}'><summary><span class='name'>{e(a['app'])}</span>"
            f"<span class='one'>{one}</span><span class='age mut'>{'stale · ' if stale else ''}{e(fmt_age(a['mtime']))}</span>"
            f"</summary><div class='body'>{md_html(a['glance'])}{more}</div></details>")


def page(briefs_dir, apps_dir=None, pick=None):
    e = html.escape
    briefs = load_briefs(briefs_dir)
    brief = next((b for b in briefs if b["file"] == pick), briefs[0] if briefs else None)
    today = time.strftime("%Y-%m-%d")
    if not brief:
        top = ("<h1>No brief yet</h1><p class='mut'>Point your agent at "
               f"<code>{e(str(briefs_dir))}</code> and have it follow <code>INSTRUCTIONS.md</code> there.</p>")
    else:
        top = dashboard(brief)
        if brief["day"] != today:
            lead, back = (("Today’s brief hasn’t landed — this is the latest one, from", "") if brief is briefs[0]
                          else ("An earlier brief:", " <a href='/'>Back to the latest</a>"))
            top = f"<div class='late'>{lead} <b>{e(brief['day'])}</b>.{back}</div>" + top
    apps = load_apps(apps_dir)
    strip = (f"<h2>Apps — what each one says about itself</h2><div class='apps'>{''.join(map(_app_row, apps))}</div>"
             if apps else "")
    old = "".join(f"<li><a href='?f={urllib.parse.quote(b['file'])}'>{e(b['day'])}</a> {_inline(b['title'])}</li>"
                  for b in briefs if b is not brief)
    earlier = (f"<h2>Earlier</h2><details class='more'><summary>{len(briefs) - 1} earlier briefs</summary>"
               f"<ul class='old'>{old}</ul></details>" if old else "")
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>{e(brief['day'] if brief else 'Brief')} — CoworkSyncHub</title>
<style>{CSS}</style></head><body>
{top}
{strip}
{earlier}
</body></html>"""


def make_server(briefs_dir, apps_dir, port):
    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):  # quiet
            pass

        def do_GET(self):
            u = urllib.parse.urlsplit(self.path)
            ok = u.path == "/"
            # ?f= only ever selects among the briefs already listed, so it cannot name another file
            pick = urllib.parse.parse_qs(u.query).get("f", [None])[0]
            data = page(briefs_dir, apps_dir, pick).encode("utf-8") if ok else b"not found"
            self.send_response(200 if ok else 404)
            self.send_header("Content-Type", "text/html; charset=utf-8" if ok else "text/plain")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

    return http.server.ThreadingHTTPServer(("127.0.0.1", port), H)  # loopback only: briefs are private


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    d_briefs = COWORK / "MorningBrief" if (COWORK / "MorningBrief").is_dir() else BASE / "briefs"
    d_apps = COWORK / "Cowork Link Folders"
    ap = argparse.ArgumentParser(prog="coworkhub", description=__doc__.splitlines()[0])
    ap.add_argument("briefs", nargs="?", default=str(d_briefs), help="folder the agent writes the daily brief into")
    ap.add_argument("--apps", default=str(d_apps) if d_apps.is_dir() else None,
                    help="folder with one sub-folder per app, each holding that app's BRIEF.md")
    ap.add_argument("--port", type=int, default=8791)
    ap.add_argument("--no-open", action="store_true")
    args = ap.parse_args()
    folder = Path(args.briefs).resolve()
    folder.mkdir(parents=True, exist_ok=True)
    if not (folder / "INSTRUCTIONS.md").exists():
        (folder / "INSTRUCTIONS.md").write_text(INSTRUCTIONS, encoding="utf-8")
    srv = make_server(folder, args.apps, args.port)
    url = f"http://127.0.0.1:{srv.server_address[1]}/"
    print(f"briefs: {folder} ({len(load_briefs(folder))})\napps:   {args.apps or '-'} ({len(load_apps(args.apps))})\n"
          f"serving {url} (loopback only; Ctrl-C to stop)")
    if not args.no_open:
        webbrowser.open(url)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("stopped")


if __name__ == "__main__":
    main()
