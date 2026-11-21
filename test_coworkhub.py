"""Self-check for the brief dashboard: python test_coworkhub.py  (prints OK)"""
import os
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import coworkhub as hub

# markdown: the subset renders, and nothing an agent quotes can become markup
h = hub.md_html("#### Did\n- [ ] call *them*\n- [x] sent `reply.json`\n\n| a | b |\n|---|---|\n| 1 | **2** |\n\n"
                "```\n<b>raw</b>\n```\n<script>x</script> [ok](https://e.x/a) [bad](javascript:alert(1))")
assert "<h6>Did</h6>" in h and "☐</span> call <i>them</i>" in h and "☑</span> sent <code>reply.json</code>" in h
assert "<th>a</th>" in h and "<td><b>2</b></td>" in h and "---" not in h
assert "<pre>&lt;b&gt;raw&lt;/b&gt;</pre>" in h and "<script>" not in h
assert '<a href="https://e.x/a"' in h and "href=\"javascript" not in h

pre, secs = hub.split("top\n## A\na1\n```\n## not a heading\n```\n### sub\n## B\nb1", 2)
assert pre == "top" and [t for t, _ in secs] == ["A", "B"] and "## not a heading" in secs[0][1]

TODAY = time.strftime("%Y-%m-%d")
BRIEF = f"""# Mon {TODAY} · Rain by five
*Meet the weather you have.*

## 🌤️ Weather
🟠 Rain from 17:00
### Hourly
hour-by-hour detail

## 🔔 Needs you
- 🔴 Renew the plates

## 🗓️ Outlook
| | Today | Tomorrow |
|---|---|---|
| Run window | 🟢 GOOD | POOR |

## 📈 Markets
⚪ steady
"""

with tempfile.TemporaryDirectory() as d:
    d = Path(d)
    briefs, apps = d / "briefs", d / "apps"
    briefs.mkdir()
    (briefs / f"{TODAY}.md").write_text(BRIEF, encoding="utf-8")
    (briefs / "2020-01-01.md").write_text("# Old one\nplain, no sections", encoding="utf-8")
    (briefs / "cowork-activity.md").write_text("# an input file, not a brief", encoding="utf-8")
    (briefs / "INSTRUCTIONS.md").write_text("# format", encoding="utf-8")
    (apps / "Gym").mkdir(parents=True)
    (apps / "Gym" / "BRIEF.md").write_text(
        "# Gym\nGenerated now\n## Method\nmaths\n## At a glance\n- **Last workout:** today <img>\n- 2 PRs\n", encoding="utf-8")
    (apps / "Reader" / "snapshot").mkdir(parents=True)
    (apps / "Reader" / "snapshot" / "activity-log.md").write_text("# Log\n\n- day one — 300 words\n- day two\n", encoding="utf-8")
    old = time.time() - 5 * 86400
    os.utime(apps / "Reader" / "snapshot" / "activity-log.md", (old, old))
    (apps / "Empty").mkdir()

    bs = hub.load_briefs(briefs)
    assert [b["file"] for b in bs] == [f"{TODAY}.md", "2020-01-01.md"], bs  # undated .md files are not briefs
    al = hub.load_apps(apps)
    assert [a["app"] for a in al] == ["Empty", "Gym", "Reader"] and al[0]["mtime"] is None
    assert "2 PRs" in al[1]["glance"] and [t for t, _ in al[1]["rest"]] == ["Method"]

    pg = hub.page(briefs, apps)
    assert "<h1>Mon " in pg and "<i>Meet the weather you have.</i>" in pg and "hasn’t landed" not in pg
    # Needs you is pinned first and full width; severity colours the tile; a table makes it wide
    assert pg.index("Needs you") < pg.index("Weather</h3>") and "tile red needs wide" in pg
    assert "class='tile amber'><h3>🌤️ Weather" in pg and "class='tile wide'><h3>🗓️ Outlook" in pg
    assert "class='tile'><h3>📈 Markets" in pg
    assert "<details class='more'><summary>Hourly</summary><p>hour-by-hour detail</p>" in pg
    # the app strip: one plain line each, stale and empty folders called out, no markup from app data
    assert "<span class='one'>Last workout: today &lt;img&gt;</span>" in pg and "<img" not in pg
    assert "class='stale'" in pg and "stale · 5d ago" in pg and "nothing written here yet" in pg
    assert "an input file" not in pg and "?f=2020-01-01.md" in pg and "1 earlier briefs" in pg

    srv = hub.make_server(briefs, apps, 0)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    assert "Rain by five" in urllib.request.urlopen(base + "/").read().decode("utf-8")
    older = urllib.request.urlopen(base + "/?f=2020-01-01.md").read().decode("utf-8")
    assert "<h1>Old one</h1>" in older and "An earlier brief" in older and "plain, no sections" in older
    # ?f= can only pick a listed brief: anything else falls back to the latest
    assert "Rain by five" in urllib.request.urlopen(base + "/?f=../apps/Gym/BRIEF.md").read().decode("utf-8")
    try:
        urllib.request.urlopen(base + "/coworkhub.py")
        raise AssertionError("only / is served")
    except urllib.error.HTTPError as err:
        assert err.code == 404
    # place & commute: unset -> the page asks; saving writes settings.json; only this page may save
    assert "Pick <a href='#place'>" in hub.page(briefs, apps)

    def post(body, **headers):
        req = urllib.request.Request(base + "/settings", data=body.encode("utf-8"), headers=headers)
        try:
            return urllib.request.urlopen(req).status
        except urllib.error.HTTPError as err:
            return err.code

    assert post("home=Elsewhere", Origin="http://evil.example") == 403
    assert post("home=Elsewhere", Host="evil.example") == 403
    assert not (briefs / "settings.json").exists()
    assert post("home=Old+Town%2C+%22Q%22+%3Cb%3E&mode=teleport&routes=" + "x" * 500) == 200  # 303 followed
    st = hub.load_settings(briefs)
    assert st["home"] == 'Old Town, "Q" <b>' and st["mode"] == "" and len(st["routes"]) == 200
    pg = hub.page(briefs, apps)
    assert "Pick <a href='#place'>" not in pg and "Old Town, &quot;Q&quot; &lt;b&gt;" in pg and "<b>'" not in pg
    (briefs / "settings.json").write_text("not json", encoding="utf-8")
    assert hub.load_settings(briefs) == {}

    srv.shutdown()

    os.remove(briefs / f"{TODAY}.md")
    assert "hasn’t landed" in hub.page(briefs, apps)

with tempfile.TemporaryDirectory() as d:
    pg = hub.page(Path(d))
    assert "No brief yet" in pg and "Apps —" not in pg

assert hub.fmt_age(time.time() - 7200) == "2h ago" and hub.fmt_age(None) == "-"
print("OK")
