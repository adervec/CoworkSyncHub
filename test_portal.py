"""Self-check for portal.py — offline build from synthetic data, no network."""
import json
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

import portal

tmp = Path(tempfile.mkdtemp(prefix="portal-test-"))
portal.SITE = tmp
portal.PORTAL_DIR = tmp / "portal"
portal.DATA_PATH = tmp / "portal-data.json"
pdir = tmp / "portal"

now = time.time()


def iso(ago):
    return datetime.fromtimestamp(now - ago, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


data = {a["slug"]: {"pushed_at": iso(3600), "stars": 2, "created": iso(400 * 86400),
                    "weeks": [i % 5 for i in range(52)],
                    "changes": [
                        {"date": iso(3600), "msg": f"newest change for {a['slug']}"},
                        {"date": iso(90000), "msg": "an older change"},
                    ]} for a in portal.APPS}
portal.DATA_PATH.write_text(json.dumps(data), encoding="utf-8")

# a screenshot for exactly one app, left in the LEGACY root location -> the build
# migrates it to portal/shots/ and exactly one card gets a banner
(tmp / "shots").mkdir()
(tmp / "shots" / "chessretabled.png").write_bytes(b"\x89PNG fake")
(tmp / "feed.xml").write_text("stale root feed", encoding="utf-8")  # legacy root file

portal.cmd_build(offline=True)
page = (pdir / "index.html").read_text(encoding="utf-8")
assert page.count("class='shot'") == 1 and "shots/chessretabled.png" in page
assert (pdir / "shots" / "chessretabled.png").exists() and not (tmp / "shots").exists()

# the origin root is now only a redirect + a kill-switch sw (old root PWA scope
# swallowed the sub-apps' install prompts); nothing installable may remain there
root = (tmp / "index.html").read_text(encoding="utf-8")
assert "url=/portal/" in root and "location.replace" in root and "manifest" not in root
rootsw = (tmp / "sw.js").read_text(encoding="utf-8")
assert "unregister" in rootsw and 'startsWith("portal-")' in rootsw
assert not (tmp / "feed.xml").exists() and not (tmp / "manifest.webmanifest").exists()

for a in portal.APPS:
    assert a["title"] in page, a["title"]
    assert portal.app_url(a) in page
assert "recently shipped" in page and page.count("newest change") >= 9
assert "data-ts=" in page and "portal-usage" in page and 'id="sort"' in page
assert "gym-tracker.html" in page  # single-file download link
# feature-rich layer: fleet chart, sparklines, theme toggle, app of the day, PWA, feed
assert 'id="fleet"' in page and "const FLEET=[" in page
assert page.count("class='spark'") == len(portal.APPS)
assert 'id="theme"' in page and "appday" in page and 'id="count"' in page
assert "manifest.webmanifest" in page and "feed.xml" in page
assert "commits/yr" in page and "★ 2" in page

# hero tile grid replaced the blurb + chips
assert 'class="tiles"' in page and page.count("<a href='#") >= 10
assert "One maker" not in page.split("</h1>")[0] and "class=\"chips\"" not in page
# tiles: tap -> card anchor, hold -> launch the app (installed copy when known)
for a in portal.APPS:
    assert f"data-url='{portal.app_url(a)}'" in page, a["slug"]
assert "pointerdown" in page and "holding" in page and "var HOLD=" in page
assert '"portal-installed"' in page and "hold</b> to launch" in page
# what's new since your last visit: change stamps shipped to the client + banner wiring
assert "const CHANGES=[[" in page and '"portal-visit"' in page
assert 'id="whatsnew"' in page and 'id="wnshow"' in page and 'id="wndismiss"' in page
assert "freshOnly" in page and "class='when' data-ts=" in page
# the shared cowork UI ships with the site, with its docs page and a browser self-test
assert "cowork-panel" in (tmp / "cowork.js").read_text(encoding="utf-8")
assert "cowork.mount(" in (tmp / "cowork" / "index.html").read_text(encoding="utf-8")
assert "stateOf" in (tmp / "cowork-selftest.html").read_text(encoding="utf-8")
# character sheet + habits wiring
assert 'id="sheet"' in page and "const APPKIND=" in page and '"portal-activity"' in page and "var KIND=" in page
assert all(f'"{a["slug"]}": "{a["kind"]}"' in page for a in portal.APPS)
assert 'id="radar"' in page and "portal-levels" in page and 'id="lvlups"' in page
assert 'id="heat"' in page and 'id="journal"' in page and "const HUES=" in page and "-day streak" in page
# the portal is a cowork app too: review channel via the shared panel; digit keys launch tiles
assert 'id="ask"' in page and '"review/request.json"' in page and 'src="../cowork.js"' in page
assert "aim:{DEX:1" in page and '"MusicStudio": "compose"' in page  # new-app kinds feed the sheet
assert "portal-review-reply" in page and "keys <kbd>1</kbd>" in page and 'ev.key==="0"?9' in page
assert "this month" in page  # per-card personal activity line
assert portal._live_state("http://127.0.0.1:9/") not in ("200",)  # unreachable -> error name, never raises
# PWA installability: real PNG icons + install-prompt hook
for n in ("icon-192.png", "icon-512.png"):
    assert (pdir / n).read_bytes()[:4] == b"\x89PNG", n
assert "beforeinstallprompt" in page and 'id="install"' in page
mani = json.loads((pdir / "manifest.webmanifest").read_text(encoding="utf-8"))
assert mani["scope"] == "./" and mani["start_url"] == "./"  # scoped to /portal/, never "/"
assert any(i.get("purpose") == "maskable" for i in mani["icons"])

# exposure audit: local paths get redacted in place, credentials abort
leaky = tmp / "leaky.js"
leaky.write_text('var log="C:\\\\Users\\\\Someone\\\\diary.txt"; mail="a.b@example.com";',
                 encoding="utf-8")
portal.audit_site()
cleaned = leaky.read_text(encoding="utf-8")
assert "Someone" not in cleaned and "example.com" not in cleaned and "~" in cleaned
leaky.write_text('const k="ghp_' + "a" * 30 + '";', encoding="utf-8")
try:
    portal.audit_site()
    raise AssertionError("audit let a credential through")
except SystemExit as ex:
    assert "NOT deploying" in str(ex)
leaky.unlink()

# stable sweep: legal / tos / privacy / content on a fixture repo (advisory, never raises)
sweeptmp = Path(tempfile.mkdtemp(prefix="portal-sweep-"))  # outside SITE: the site audit must not see it
repo = sweeptmp / "fakeapp"
(repo / "src").mkdir(parents=True)
(repo / "src" / "app.js").write_text(
    'gtag("config");fetch("https://api.anthropic.com/v1/messages");var p="C:\\Users\\Someone\\x";'
    'var t="what a bastard";const k="ghp_' + "b" * 30 + '";', encoding="utf-8")
(repo / "README.md").write_text("Track calories and weight loss. Powered by Strava data.", encoding="utf-8")
(repo / "texts").mkdir()
(repo / "texts" / "poe.txt").write_text("murder murder corpse", encoding="utf-8")  # corpus: ignored
found = portal.sweep_app({"title": "Black Mirror Fake", "dir": "fakeapp"}, repo)
checks = {(f["sev"], f["check"]) for f in found}
for want in [("legal", "license"), ("legal", "trademark"), ("legal", "health content"), ("privacy", "tracker"),
             ("privacy", "local path"), ("tos", "third-party api"), ("tos", "brand mention"),
             ("content", "profanity"), ("secret", "credential-shaped")]:
    assert want in checks, (want, checks)
assert not any(f["check"] == "violence" for f in found), "corpus words must not count"
portal.SWEEP_PATH = sweeptmp / "sweep.json"
portal.SWEEP_REPORT = sweeptmp / "sweep-report.html"
portal.SWEEP_PATH.write_text(json.dumps({"at": now, "findings": found}), encoding="utf-8")
assert portal.sweep_summary().startswith("1 secret · 3 legal")

feed = (pdir / "feed.xml").read_text(encoding="utf-8")
assert feed.startswith("<?xml") and "<rss" in feed and feed.count("<item>") == 30
assert "GymTracker: newest change" in feed

psw = (pdir / "sw.js").read_text(encoding="utf-8")
assert "caches" in psw and 'k.startsWith("portal-")&&k!==C' in psw  # never touch sub-app caches
assert "<svg" in (pdir / "icon.svg").read_text(encoding="utf-8")

assert portal.iso_ts(None) is None
assert abs(portal.iso_ts(iso(0)) - now) < 2

# empty data still builds (no chart, no log, no crash)
portal.DATA_PATH.write_text("{}", encoding="utf-8")
portal.cmd_build(offline=True)
page2 = (pdir / "index.html").read_text(encoding="utf-8")
assert "Launch" in page2 and 'id="fleet"' not in page2

# the page's inline script must parse (a stray newline in a JS string literal once broke everything)
import shutil, subprocess
if shutil.which("node"):
    import re as _re
    body = _re.findall(r"<script>(.*?)</script>", page, _re.S)[-1]
    js = tmp / "portal-inline.js"
    js.write_text(body, encoding="utf-8")
    r = subprocess.run(["node", "--check", str(js)], capture_output=True, text=True)
    assert r.returncode == 0, "inline script does not parse:\n" + r.stderr[:600]
    for swf in (pdir / "sw.js", tmp / "sw.js"):
        sw = subprocess.run(["node", "--check", str(swf)], capture_output=True, text=True)
        assert sw.returncode == 0, f"{swf.name}: {sw.stderr[:300]}"

print("OK")
