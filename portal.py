"""Portal generator for adervec.github.io/portal/ — manager / launcher / catalog for the published apps.

  python portal.py build [--offline]   build the site/ portal (fetches GitHub data unless --offline)
  python portal.py deploy [--offline]  build + public-exposure audit + commit + push site/
  python portal.py shots               capture app screenshots via headless Chrome/Edge into site/shots/
  python portal.py apps [--quick]      manager table: dirty/unpushed, published age, CI, live status
  python portal.py open <app>          launch a published app in the browser
python portal.py sweep               legal / ToS / privacy / PG-content sweep over every app repo
"""
import colorsys
import html
import shutil
import json
import re
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
import zlib
from datetime import datetime
from email.utils import formatdate
from pathlib import Path

from coworkhub import fmt_age

BASE = Path(__file__).resolve().parent
SITE = BASE / "site"
# The portal PWA lives at /portal/, NOT the origin root: GitHub project pages all share
# the adervec.github.io origin, and a root-scoped installed PWA makes Android treat every
# sub-app under /<App>/ as "already installed" (their install prompts vanish).
PORTAL_DIR = SITE / "portal"
DATA_PATH = SITE / "portal-data.json"
USER = "adervec"
GITHUB_DIR = BASE.parent  # ponytail: assumes all app clones sit beside this repo
BROWSERS = [  # first one found does the screenshots
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]

# Curated per app: slow-changing identity. Volatile data (pushed_at, stars, commits,
# weekly activity) is fetched at build time. dir = local clone folder (None = not cloned).
APPS = [
    dict(slug="GymTracker315", kind="lift", dir="GymTracker", title="GymTracker", emoji="\U0001F3CB️", hue=20,
         tagline="A whole gym logbook in one HTML file — lifts, cardio, plans, and progress.",
         badges=["PWA", "single file", "Strava sync", "cloud sync"],
         download=("single file", f"https://github.com/adervec/GymTracker315/blob/main/gym-tracker.html"),
         features=[
             "Adaptive workout plans and a fast set logger",
             "Picker-driven equipment setup: barbell, dumbbell, kettlebell, landmine…",
             "Per-exercise reference media and baked-in coaching guides",
             "Biometrics plus Strava reconciliation",
             "Cloud sync via Google Drive, Dropbox, or OneDrive",
             "Offline-first — everything lives in your browser storage",
         ]),
    dict(slug="Tachyread", kind="read", dir="Tachyread", title="Tachyread", emoji="⚡", hue=270,
         tagline="Speed reading one word at a time — RSVP on an optimal recognition point, up to ~1500 WPM.",
         badges=["Drive sync", "⚠ flashing text"],
         features=[
             "Import TXT, DOCX, PDF, EPUB — or OCR-grab text from images",
             "~30 themes and animated reader faces",
             "Text-to-speech, voice and clap control",
             "Trackyread: a reading log of every book, with notes and a fading-memory check",
             "Typing and speaking minigames, audiobook recording",
             "Measured reading stats and an editable table of contents",
         ]),
    dict(slug="ChessRetabled", kind="chess", dir="ChessRetabled", title="ChessRetabled", emoji="♞", hue=165,
         tagline="A cel-shaded chess club in the browser — bots, lessons, puzzles, and 56 games.",
         badges=["PWA", "offline", "Drive sync"],
         features=[
             "12 Stockfish-powered characters, 250 to 2850 Elo",
             "37 validated tactics puzzles with rated training",
             "Academy courses and practice-arena endgame drills",
             "56 games — board, cards, logic — each with a strategy guide",
             "Level, XP, streaks, and personal ratings",
             "Full offline play once installed",
         ]),
    dict(slug="GuitarPicker", kind="practice", dir="GuitarPicker", title="GuitarPicker", emoji="\U0001F3B8", hue=45,
         tagline="Zero-build guitar school — note highway, tuner, karaoke, and a synthesized backing band.",
         badges=["PWA", "Drive sync"],
         features=[
             "Streaming note highway with per-note grading",
             "Live tuner across 59 instruments and their tunings",
             "45+ public-domain songs, each with a synthesized backing band",
             "Karaoke with word-by-word lyrics and pitch scoring",
             "Song editor, record-and-transcribe, theory games, courses",
         ]),
    dict(slug="BlackMirrorBikeRide", kind="ride", dir="BlackMirrorBikeRide", title="Black Mirror Bike Ride",
         emoji="\U0001F6B4", hue=130,
         tagline="A homebrew Zwift — your real trainer over Bluetooth, low-poly worlds, real GPX routes.",
         badges=["PWA", "Bluetooth", "Drive sync"],
         features=[
             "Reads power and heart rate over Web Bluetooth — zero drivers",
             "A proper physics model behind every ride",
             "Build your own low-poly 3D worlds",
             "GPX import plus 34 bundled routes (~660 km)",
             "Replay, ride history, and ghosts",
         ]),
    dict(slug="BodybuildingProgressCoach", kind="checkin", dir="BodybuildingProgressCoach",
         title="Bodybuilding Progress Coach", emoji="\U0001F5FF", hue=240,
         tagline="Honest physique and posing tracking from your own photos — scored against the classics.",
         badges=["PWA", "offline", "AI optional"],
         features=[
             "On-device pose analysis — nothing uploaded",
             "Objective symmetry and proportion geometry first, opinion second",
             "Per-division posing technique (24 mandatories) and live mirror practice",
             "Body-composition trends corroborate the photos",
             "Aligned progress timelapses",
         ]),
    dict(slug="HandwritingHelper", kind="write", dir="HandwritingHelper", title="Handwriting Helper",
         emoji="✍️", hue=210,
         tagline="Photograph a page of handwriting and get honest, measured scores — then drill.",
         badges=["PWA", "offline"],
         features=[
             "Per-line scores: slant, baseline, size, spacing, pen control, legibility",
             "Right or left hand, print or cursive, plus mirror-prime mode",
             "38 drills with printable guide sheets in true size",
             "Review scan batches as a gallery, with duplicate detection",
             "Streaks, trends, and full history",
         ]),
    dict(slug="MicroMiniger", kind="paint", dir="MicroMiniger", title="MicroMiniger", emoji="⚔️", hue=0,
         tagline="A miniature-collection manager — paint queue, photo studio, and offline photo-to-3D.",
         badges=["PWA", "offline"],
         features=[
             "Rich per-mini metadata, kitbash-aware, with provenance and value",
             "Kanban paint queue, paint timer, deadlines",
             "Multi-angle photos, 360° viewer, spin video and GIF export",
             "Photo-to-3D mesh and Gaussian-splat viewer, STL/PLY export",
             "Armies, points, and a battle log",
             "Field-scoped search, bulk edit, CSV, one-file backup",
         ]),
    dict(slug="SpeechImprover", kind="speak", dir="SpeechImprover", title="SpeechImprover", emoji="\U0001F399️", hue=315,
         tagline="Record yourself and get ten scored attributes — then train the weak ones.",
         badges=["PWA", "Drive sync"],
         features=[
             "962 public-domain passages, 158 exercises, 65 targeted drills",
             "Ten attributes scored 0–100, from pace to projection",
             "Free speaking toward a chosen target tone or emotion",
             "Reading projects — import a document and work through it passage by passage",
             "Trends, an activity heatmap, A/B compare, AI-coach export",
         ]),
    dict(slug="Mise", kind="cook", dir=None, title="Mise", emoji="\U0001F373", hue=75,
         tagline="An interactive cookbook you can run — recipes execute as live, scheduled flow charts.",
         badges=["PWA", "offline", "voice"],
         features=[
             "114 recipes plus techniques, ingredients, and equipment guides",
             "Execute mode: station swimlanes, a moving playhead, countdowns, alarms",
             "Voice control — play, pause, done, skip — with steps read aloud",
             "A cook log of every finished cook, exportable",
             "Field guides: coffee, tea, alcohol, protein prep — and a box-mix calculator",
         ]),
    dict(slug="MarksmanApp", kind="aim", dir="MarksmanApp", title="Marksman", emoji="\U0001F3AF", hue=100,
         tagline="Foam-dart marksmanship, measured — photograph your target and get real metrics.",
         badges=["web + desktop", "Drive sync", "CLI"],
         features=[
             "Mark up a photo of where your darts landed — precision, accuracy, bias",
             "Tiered practice standards judge every session",
             "Progress overall, by blaster category, and by specific blaster",
             "Prints true-size target faces to shoot at",
             "Equipment packs: plain JSON defines drills, faces, and vocabulary",
         ]),
    dict(slug="Run315", kind="cardio", dir="Run315", title="Run315", emoji="\U0001F3C3", hue=190,
         tagline="Self-hosted running analytics — Garmin sync, race projections, routes, trails, territory.",
         badges=["self-hosted", "Garmin sync", "live demo"],
         features=[
             "Garmin Connect sync; best efforts mined from inside every run",
             "Fitness / fatigue / form model, race projections, taper planning",
             "Route builder, trail completion, and an interval territory game",
             "Shoe mileage, weather correction, climbing and durability analysis",
             "The live site is a frozen demo year — self-host it for your own data",
         ]),
    dict(slug="learning-pit", kind="study", dir="learning-pit", title="Learning Pit", emoji="\U0001F9E0", hue=55,
         tagline="Flashcards and learning games with spaced repetition — for readers and pre-readers alike.",
         badges=["PWA", "offline", "Drive sync", "kid mode"],
         features=[
             "23 modules from first words to full decks — plus make your own",
             "Spaced repetition with sessions, streaks, exam mode, and undo",
             "Games: match boards, duels, spelling, tracing on a slate",
             "Kid mode with pictures, stickers, and read-aloud voices",
             "Static files, no build — fully offline once installed",
         ]),
    dict(slug="MusicStudio", kind="compose", dir="MusicStudio", title="Music Studio", emoji="\U0001F3BC", hue=295,
         tagline="An ElevenLabs album builder in your browser — curate prompts, generate songs, export albums.",
         badges=["PWA", "BYO API key", "local backup"],
         features=[
             "Albums in nested groups with full metadata and per-group themes",
             "Generate songs and dialog; fill an album with a cost estimate first",
             "Waveforms, trim/fade/gain, reorder, playlists, crossfaded mixdowns",
             "Export tagged tracks — and publish picked albums to a phone-synced folder",
             "A backup folder an agent can co-author album designs into",
         ]),
    dict(slug="long-gallery", kind="art", dir="long-gallery", title="The Long Gallery", emoji="\U0001F5BC️", hue=335,
         tagline="A museum in a single page — 5,600 works from the Olmec heads to now, each with its story.",
         badges=["PWA", "offline"],
         features=[
             "Six eras, Antiquity to Modern, across movements, regions and themes",
             "Nine media, from painting and sculpture to manuscript, textile and installation",
             "Every work with its story: what it is, its context, and a hidden detail",
             "HD images with zoom, plus guided tours through the collection",
             "Track what you've seen as you wander",
         ]),
    dict(slug="classical-journey", kind="listen", dir="classical-journey", title="The Classical Journey",
         emoji="🎼", hue=15,
         tagline="Every piece worth hearing, in order — Gregorian chant to now, with what to listen for.",
         badges=["PWA", "offline", "links out"],
         features=[
             "2,444 works by 535 composers across seven eras",
             "Each one: what it is, the world it came from, and what to listen for",
             "69 theory stops, placed where history invented the idea",
             "Plays a free Internet Archive recording, and links out to six services",
             "Your progress, ratings and notes stay in your browser",
         ]),
]


def app_url(app):
    return f"https://{USER}.github.io/{app['slug']}/"


def iso_ts(s):
    if not s:
        return None
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


def gh_json(path):
    try:
        out = subprocess.run(["gh", "api", path], capture_output=True, text=True,
                             encoding="utf-8", errors="replace", timeout=30)
        if out.returncode == 0:
            return json.loads(out.stdout)
    except OSError:
        pass
    with urllib.request.urlopen(f"https://api.github.com/{path}", timeout=30) as r:
        return json.load(r)


def fetch_data():
    data = {}
    for app in APPS:
        slug = app["slug"]
        try:
            repo = gh_json(f"repos/{USER}/{slug}")
            commits = gh_json(f"repos/{USER}/{slug}/commits?per_page=25")
        except Exception as exc:
            print(f"  {slug}: fetch failed ({exc}); no live data")
            data[slug] = {"pushed_at": None, "changes": []}
            continue
        try:  # 52 weeks of commit counts; the endpoint 202s while GitHub computes it
            part = gh_json(f"repos/{USER}/{slug}/stats/participation")
            weeks = part.get("all", []) if isinstance(part, dict) else []
        except Exception:
            weeks = []
        changes = []
        for c in commits:
            msg = (c["commit"]["message"].splitlines() or [""])[0]
            if msg.startswith("Merge "):
                continue
            if msg.startswith("AE: "):
                msg = msg[4:]
            changes.append({"date": c["commit"]["committer"]["date"], "msg": msg})
            if len(changes) == 10:
                break
        data[slug] = {"pushed_at": repo.get("pushed_at"), "stars": repo.get("stargazers_count", 0),
                      "created": repo.get("created_at"), "weeks": weeks, "changes": changes}
    return data


def shipped(data):
    """All commits across apps, newest first, as (ts, app, msg)."""
    rows = []
    for app in APPS:
        for c in (data.get(app["slug"], {}).get("changes") or []):
            ts = iso_ts(c["date"])
            if ts:
                rows.append((ts, app, c["msg"]))
    rows.sort(key=lambda r: -r[0])
    return rows


e = html.escape

_LIGHT = """
  --bg:#f6f8f7; --card:#ffffff; --ink:#131820; --mut:#5c6572; --line:#d9dfe3;
  --grid:rgba(29,78,216,.055); --acc:#1d4ed8; --accink:#ffffff;
  --tile:70% 90%; --tileink:35% 25%; --chipbg:#eef1f4;
  --spark:60% 40%; --area:rgba(29,78,216,.12);
"""
_DARK = """
  --bg:#0d1220; --card:#161d30; --ink:#e8eaf2; --mut:#98a2b8; --line:#283152;
  --grid:rgba(122,162,255,.05); --acc:#82a6ff; --accink:#0d1220;
  --tile:45% 20%; --tileink:70% 75%; --chipbg:#1e2742;
  --spark:65% 62%; --area:rgba(130,166,255,.14);
"""
PORTAL_CSS = (
    ":root{--mono:ui-monospace,'Cascadia Code',Consolas,'SF Mono',monospace;"
    "--sans:system-ui,'Segoe UI',sans-serif;" + _LIGHT + "}\n"
    "@media (prefers-color-scheme:dark){:root:not([data-theme=light]){" + _DARK + "}}\n"
    ":root[data-theme=dark]{" + _DARK + "}\n"
) + """
*{box-sizing:border-box}
[hidden]{display:none!important}
body{margin:0;color:var(--ink);font:15px/1.5 var(--sans);
  background:linear-gradient(var(--grid) 1px,transparent 1px),
             linear-gradient(90deg,var(--grid) 1px,transparent 1px),var(--bg);
  background-size:28px 28px;}
main{max-width:1140px;margin:0 auto;padding:28px 20px 60px}
a{color:var(--acc)}
h1{font:700 30px/1.15 var(--mono);letter-spacing:-.5px;margin:6px 0 10px}
.head{display:flex;align-items:center;gap:12px}
.wordmark{font:600 13px var(--mono);color:var(--mut);letter-spacing:.5px}
.toggle{width:36px;height:36px;font-size:16px;color:var(--ink);cursor:pointer;
  background:var(--card);border:1px solid var(--line);border-radius:9px}
.install{margin-left:auto;height:36px;padding:0 16px;font:600 12px var(--mono);cursor:pointer;
  color:var(--accink);background:var(--acc);border:0;border-radius:9px}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(86px,1fr));gap:14px 8px;
  margin:18px 0 8px}
.tiles a{position:relative;display:flex;flex-direction:column;align-items:center;gap:7px;
  text-decoration:none;color:var(--mut);font:11px/1.25 var(--mono);text-align:center;
  -webkit-touch-callout:none;user-select:none;touch-action:manipulation}
.tiles .tile{position:relative;overflow:hidden;width:58px;height:58px;font-size:29px;
  border-radius:15px;border:1px solid var(--line)}
/* the hold-to-launch ripple doubles as the progress indicator, so it ignores reduced-motion */
.tiles .tile::after{content:"";position:absolute;inset:0;border-radius:50%;
  background:var(--acc);opacity:.32;transform:scale(0)}
.tiles a.holding .tile::after{animation:hold .45s linear forwards}
@keyframes hold{to{transform:scale(1.8)}}
.tiles a.ins::before{content:"✓";position:absolute;top:-4px;right:calc(50% - 34px);z-index:1;
  width:17px;height:17px;border-radius:50%;background:var(--acc);color:var(--accink);
  font:700 10px/17px var(--mono);text-align:center}
.hint{font:11px var(--mono);color:var(--mut);margin:0 0 24px}
.hint b{color:var(--ink)}
#whatsnew{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:0 0 20px;
  border:1px solid var(--acc);border-radius:10px;padding:10px 14px;font:12.5px var(--mono)}
#whatsnew button{background:none;border:1px solid var(--line);border-radius:7px;padding:4px 10px;
  color:var(--ink);font:inherit;cursor:pointer}
#wnshow{background:var(--acc);color:var(--accink);border-color:var(--acc)}
#wndismiss{margin-left:auto;padding:4px 9px}
.tiles a.new .tile{box-shadow:0 0 0 2px var(--acc)}
.tiles a.new::after{content:"";position:absolute;top:-2px;left:calc(50% - 34px);z-index:1;
  width:9px;height:9px;border-radius:50%;background:var(--acc)}
.app.fresh{border-color:var(--acc)}
.app.fresh .latest b{color:var(--acc)}
.ship li.new .who{font-weight:700}
.ship li.new .when{color:var(--acc)}
.you{border:1px solid var(--line);background:var(--card);border-radius:12px;padding:16px 18px;margin:0 0 22px}
.sheet{display:grid;grid-template-columns:auto minmax(0,1.2fr) minmax(0,1fr);gap:18px 28px;align-items:start}
@media (max-width:760px){.sheet{grid-template-columns:1fr 1fr}#radar{grid-row:span 2}}
@media (max-width:520px){.sheet{grid-template-columns:1fr}#radar{grid-row:auto;justify-self:center}}
#radar{width:180px;height:180px;display:block}
#radar .web{fill:none;stroke:var(--line)}
#radar .axis{stroke:var(--line)}
#radar .area{fill:hsl(220 80% 55% / .22);stroke:var(--acc);stroke-width:2;stroke-linejoin:round}
#radar .lbl{font:700 10px var(--mono);fill:var(--mut)}
#radar .lbl.hi{fill:var(--ink)}
.cs .up{color:var(--acc);font-weight:700;margin-left:4px}
#lvlups:empty{display:none}
#lvlups{color:var(--acc)}
.act{margin:14px 0 0;font-size:13px}
.act summary{cursor:pointer;font:600 12px var(--mono);color:var(--mut)}
.act summary b{color:var(--ink)}
.heatwrap{display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap;margin:12px 0 10px}
.heat{display:grid;grid-auto-flow:column;grid-template-rows:repeat(7,11px);grid-auto-columns:11px;gap:2px}
.heat i{display:block;width:11px;height:11px;border-radius:2px;background:var(--chipbg)}
.heat i.on{background:hsl(var(--h) 70% 50% / var(--a))}
.heat i.today{outline:1px solid var(--ink);outline-offset:-1px}
.heatkey{font:11px/1.8 var(--mono);color:var(--mut);max-width:260px}
.heatkey i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px;background:hsl(var(--h) 70% 50%)}
.journal{list-style:none;margin:0;padding:0;font:12px/1.8 var(--mono);color:var(--mut)}
.journal b{color:var(--ink);font-weight:600;display:inline-block;min-width:62px}
#askhost{margin:10px 0}
.reply{white-space:pre-wrap;font:13px/1.6 var(--sans);color:var(--ink);background:var(--bg);border:1px solid var(--line);
  border-radius:10px;padding:12px 14px;margin:0;max-height:420px;overflow:auto}
.usage .you{color:var(--ink)}
.cs{display:grid;grid-template-columns:auto 1fr auto;gap:6px 10px;align-items:center;font:12px var(--mono)}
.cs .nm{font-weight:700;letter-spacing:1px}
.cs .bar{height:9px;border-radius:5px;background:var(--chipbg);overflow:hidden}
.cs .bar i{display:block;height:100%;background:var(--acc);border-radius:5px;min-width:2px}
.cs .lv{color:var(--mut);white-space:nowrap}
.cs .lv b{color:var(--ink)}
.cs .src{grid-column:1/-1;font:11px var(--mono);color:var(--mut);margin:-3px 0 4px 0}
.habits{font:12.5px/1.7 var(--mono);color:var(--mut)}
.habits b{color:var(--ink);font-weight:600}
.habits p{margin:0 0 6px}
@media (prefers-reduced-motion:no-preference){
  html{scroll-behavior:smooth}
  .tiles .tile{transition:transform .12s}
  .tiles a:hover .tile{transform:scale(1.08)}
}
.eyebrow{font:600 12px var(--mono);letter-spacing:1.5px;text-transform:uppercase;
  color:var(--mut);margin:0 0 10px}
.ship{border:1px solid var(--line);background:var(--card);border-radius:12px;
  padding:16px 18px;margin:0 0 22px}
.chartwrap{position:relative;margin:2px 0 4px}
#fleet{width:100%;height:64px;display:block}
#fleet .area{fill:var(--area)}
#fleet .ln{fill:none;stroke:var(--acc);stroke-width:2;vector-effect:non-scaling-stroke}
#fleet .base{stroke:var(--line)}
#fleet .cur{stroke:var(--mut);stroke-dasharray:3 3;vector-effect:non-scaling-stroke}
.tip{position:absolute;top:-4px;transform:translateY(-100%);background:var(--ink);color:var(--bg);
  font:11px var(--mono);padding:3px 8px;border-radius:5px;pointer-events:none;white-space:nowrap}
.caption{font:11px var(--mono);color:var(--mut);margin:0 0 12px}
.ship ol{list-style:none;margin:0;padding:0;font:13px/1.9 var(--mono);white-space:nowrap;overflow-x:auto}
.ship .when{display:inline-block;min-width:76px;color:var(--mut)}
.ship .who{display:inline-block;min-width:150px}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;
  background:hsl(var(--h) var(--spark));margin-right:4px}
#recent{margin:0 0 16px;font:12px var(--mono);color:var(--mut);
  display:flex;gap:8px;align-items:center;flex-wrap:wrap}
#recent a{border:1px solid var(--line);background:var(--card);border-radius:999px;
  padding:3px 11px;text-decoration:none}
.controls{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:0 0 18px}
.controls input{flex:1;min-width:220px;padding:9px 13px;font:14px var(--sans);
  color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:9px}
.controls select{padding:8px 10px;font:13px var(--mono);color:var(--ink);
  background:var(--card);border:1px solid var(--line);border-radius:9px}
#count{font:12px var(--mono);color:var(--mut);white-space:nowrap}
kbd{border:1px solid var(--line);border-bottom-width:2px;border-radius:4px;padding:0 5px;
  font:11px var(--mono);background:var(--card)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:16px}
.app{border:1px solid var(--line);background:var(--card);border-radius:12px;
  padding:18px;display:flex;flex-direction:column;gap:10px;position:relative}
@media (prefers-reduced-motion:no-preference){
  .app{transition:transform .15s,box-shadow .15s}
  .app:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(0,0,0,.08)}
}
.shot{margin:-18px -18px 0;display:block}
.shot img{display:block;width:100%;height:auto;border-radius:11px 11px 0 0;
  border-bottom:1px solid var(--line)}
.appday{border-color:var(--acc)}
.appday::after{content:"app of the day";position:absolute;top:-9px;right:14px;
  background:var(--acc);color:var(--accink);font:600 10px var(--mono);letter-spacing:.8px;
  text-transform:uppercase;padding:2px 8px;border-radius:5px}
.app header{display:flex;gap:12px;align-items:flex-start}
.tile{flex:none;width:46px;height:46px;border-radius:11px;display:grid;place-items:center;
  font-size:24px;background:hsl(var(--h) var(--tile));color:hsl(var(--h) var(--tileink))}
.app h2{font:700 17px var(--mono);margin:2px 0 3px}
.app h2 .src{font:400 12px var(--mono);text-decoration:none;margin-left:6px}
.tag{margin:0;font-size:13.5px;color:var(--mut)}
.stats{display:flex;gap:10px;align-items:center;margin:0;font:11px var(--mono);color:var(--mut)}
.spark{flex:none}
.spark polyline{fill:none;stroke:hsl(var(--h) var(--spark));stroke-width:2;
  stroke-linejoin:round;stroke-linecap:round}
.badges{display:flex;flex-wrap:wrap;gap:6px;margin:0}
.badges button{background:var(--chipbg);border:0;border-radius:5px;padding:2px 8px;
  color:var(--mut);font:11px var(--mono);cursor:pointer}
.badges button:hover{color:var(--ink)}
.feat{margin:0;padding-left:19px;font-size:13.5px}
.feat li{margin:3px 0}
.latest{margin:0;font-size:13px;color:var(--mut)}
.latest b{color:var(--ink);font-weight:600}
details{font-size:13px}
summary{cursor:pointer;font:600 12px var(--mono);color:var(--mut)}
details ul{list-style:none;margin:8px 0 0;padding:0;font:12.5px/1.7 var(--mono)}
details .when{color:var(--mut);display:inline-block;min-width:70px}
.app footer{margin-top:auto;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.launch{background:var(--acc);color:var(--accink);text-decoration:none;font:600 13px var(--mono);
  padding:8px 18px;border-radius:8px}
:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
.dl{font-size:12.5px}
.usage{font:11px var(--mono);color:var(--mut);margin-left:auto;text-align:right}
#empty{border:1px dashed var(--line);border-radius:12px;padding:28px;text-align:center;
  color:var(--mut);margin:16px 0 0}
#empty button{background:none;border:0;color:var(--acc);font:inherit;cursor:pointer;
  text-decoration:underline}
.note{color:var(--mut);font-size:13px;max-width:640px;margin:26px 0 0}
footer.page{margin-top:34px;padding-top:16px;border-top:1px solid var(--line);
  font:12px var(--mono);color:var(--mut);display:flex;flex-wrap:wrap;gap:14px}
"""

PORTAL_JS = """
(function(){
var d=document;
if("serviceWorker" in navigator&&location.protocol==="https:")
  navigator.serviceWorker.register("sw.js").catch(function(){});
// theme: auto -> light -> dark, persisted
var root=d.documentElement,tbtn=d.getElementById("theme");
var modes=["auto","light","dark"],icons={auto:"\\u25d0",light:"\\u2600",dark:"\\u263e"};
function setTheme(m){
  if(m==="auto")root.removeAttribute("data-theme");else root.setAttribute("data-theme",m);
  tbtn.textContent=icons[m];tbtn.title="theme: "+m;tbtn.setAttribute("aria-label","theme: "+m);
  try{localStorage.setItem("portal-theme",m)}catch(err){}}
var cur="auto";try{cur=localStorage.getItem("portal-theme")||"auto"}catch(err){}
setTheme(cur);
tbtn.addEventListener("click",function(){cur=modes[(modes.indexOf(cur)+1)%3];setTheme(cur)});
// live relative times
function rel(s){if(s<60)return Math.floor(s)+"s";if(s<3600)return Math.floor(s/60)+"m";
  if(s<86400)return Math.floor(s/3600)+"h";return Math.floor(s/86400)+"d";}
function tick(){var now=Date.now()/1000;
  d.querySelectorAll("[data-ts]").forEach(function(el){
    var t=parseFloat(el.dataset.ts);if(t)el.textContent=rel(now-t)+" ago";});}
tick();setInterval(tick,30000);
// usage counts, and the registry each installed app writes about itself (both
// same-origin localStorage, this browser only — nothing leaves the device)
var KEY="portal-usage",IKEY="portal-installed",VKEY="portal-visit";
var freshOnly=false,fresh={};  // apps that shipped since the visit you last acknowledged
function usage(){try{return JSON.parse(localStorage.getItem(KEY)||"{}")}catch(err){return{}}}
// Each app restamps its entry every installed launch. Nothing can tell us about an
// uninstall, so an entry unrefreshed for 90 days stops counting as installed.
function installed(){try{var m=JSON.parse(localStorage.getItem(IKEY)||"{}"),
  cut=Date.now()-90*864e5,live={};
  Object.keys(m).forEach(function(k){if(m[k]>cut)live[k]=m[k]});
  return live;}catch(err){return{}}}
function paintUsage(){var u=usage(),ins=installed(),now=Date.now()/1000,tot=0,tried=0;
  d.querySelectorAll(".usage").forEach(function(el){
    var x=u[el.dataset.slug],pre=ins[el.dataset.slug]?"installed \\u00b7 ":"";
    el.textContent=pre+(x?("opened "+x.n+"\\u00d7 \\u00b7 "+rel(now-x.last)+" ago"):"not opened yet");});
  d.querySelectorAll(".tiles a").forEach(function(el){
    el.classList.toggle("ins",!!ins[el.dataset.slug]);});
  Object.keys(u).forEach(function(k){tot+=u[k].n;tried++;});
  var you=d.getElementById("you");
  you.textContent=tot?("you: "+tot+" launch"+(tot>1?"es":"")+" across "+tried+" app"+(tried>1?"s":"")):"";
  var rec=Object.keys(u).sort(function(a,b){return u[b].last-u[a].last}).slice(0,4),
      host=d.getElementById("recent");
  if(rec.length){host.hidden=false;var box=host.querySelector(".rr");box.innerHTML="";
    rec.forEach(function(s){var c=d.getElementById(s.toLowerCase());if(!c)return;
      var a=d.createElement("a");a.href="#"+s.toLowerCase();a.textContent=c.dataset.title;
      box.appendChild(a);});}}
paintUsage();
function bump(slug){var u=usage();if(!APPKIND[slug])return;
  u[slug]={n:((u[slug]||{}).n||0)+1,last:Date.now()/1000};
  try{localStorage.setItem(KEY,JSON.stringify(u))}catch(err){}
  paintUsage();sheet();}
// An installed app can only take over the URL on a top-level navigation, so
// installed apps get same-tab; everything else opens in a tab beside the portal.
function launch(slug,url){bump(slug);
  if(installed()[slug]){location.href=url;return;}
  if(!window.open(url,"_blank","noopener"))location.href=url;}
d.querySelectorAll(".launch").forEach(function(a){
  a.addEventListener("click",function(ev){
    if(installed()[a.dataset.slug]){ev.preventDefault();launch(a.dataset.slug,a.href);}
    else bump(a.dataset.slug);});});
// tiles: a tap jumps to the card, a hold launches the app
var HOLD=450,timer=null,fired=false,held=null,sx=0,sy=0;
function endHold(){if(timer)clearTimeout(timer);timer=null;
  if(held)held.classList.remove("holding");held=null;}
d.querySelectorAll(".tiles a").forEach(function(a){
  a.addEventListener("pointerdown",function(ev){
    if(ev.button)return;
    fired=false;sx=ev.clientX;sy=ev.clientY;held=a;a.classList.add("holding");
    timer=setTimeout(function(){fired=true;endHold();
      if(navigator.vibrate)navigator.vibrate(15);
      launch(a.dataset.slug,a.dataset.url);},HOLD);});
  a.addEventListener("pointermove",function(ev){
    if(timer&&(Math.abs(ev.clientX-sx)>10||Math.abs(ev.clientY-sy)>10))endHold();});
  ["pointerup","pointercancel","pointerleave"].forEach(function(t){a.addEventListener(t,endHold)});
  a.addEventListener("contextmenu",function(ev){ev.preventDefault()});
  a.addEventListener("click",function(ev){if(fired){ev.preventDefault();fired=false;}});});
// filter + count + empty state; badges are filter shortcuts
var q=d.getElementById("q"),count=d.getElementById("count"),empty=d.getElementById("empty"),
    grid=d.querySelector(".grid");
function cards(){return Array.prototype.slice.call(grid.children)}
function applyFilter(){var v=q.value.toLowerCase(),n=0;
  cards().forEach(function(c){
    var show=c.dataset.k.indexOf(v)>=0&&(!freshOnly||!!fresh[c.dataset.slug]);
    c.style.display=show?"":"none";if(show)n++;});
  count.textContent=n+" of "+cards().length+" apps"+(freshOnly?" · new only":"");
  empty.hidden=n>0;}
applyFilter();
q.addEventListener("input",applyFilter);
d.getElementById("clearq").addEventListener("click",function(){q.value="";applyFilter();q.focus()});
d.addEventListener("click",function(ev){
  var b=ev.target.closest(".badges button");
  if(b){q.value=b.textContent.replace(/^\\u26a0 /,"");applyFilter();
    q.scrollIntoView({block:"nearest"});}});
d.addEventListener("keydown",function(ev){
  var t=ev.target.tagName;
  if(/^[0-9]$/.test(ev.key)&&t!=="INPUT"&&t!=="SELECT"&&t!=="TEXTAREA"&&!ev.ctrlKey&&!ev.metaKey&&!ev.altKey){
    var tl=d.querySelectorAll(".tiles a")[ev.key==="0"?9:+ev.key-1];
    if(tl){ev.preventDefault();launch(tl.dataset.slug,tl.dataset.url);}}
  if(ev.key==="/"&&t!=="INPUT"&&t!=="SELECT"&&t!=="TEXTAREA"){ev.preventDefault();q.focus();}
  if(ev.key==="Escape"&&t==="INPUT"){q.value="";applyFilter();}});
// character sheet + habits, from what the apps report (same-origin localStorage,
// [ts, slug, kind, amount] per thing you did) — launch counts fill in until they do.
var AKEY="portal-activity";
var STATS=["STR","DEX","END","PSI","INT","CHR","VIT"];
// what each kind of activity feeds. Loose on purpose: this is a character sheet, not a lab.
var KIND={lift:{STR:1,VIT:.3},cardio:{END:1,VIT:.4},ride:{END:1,VIT:.4},read:{INT:1,PSI:.3},
  chess:{INT:.7,PSI:.7},practice:{DEX:1,CHR:.4},write:{DEX:.8,PSI:.3},speak:{CHR:1,PSI:.3},
  paint:{DEX:.8,PSI:.5},cook:{VIT:1,DEX:.3},checkin:{VIT:.6,PSI:.4},focus:{PSI:1},
  aim:{DEX:1,PSI:.4},study:{INT:1,PSI:.3},compose:{PSI:.8,CHR:.6},art:{PSI:.8,INT:.4},listen:{PSI:.7,INT:.5}};
function activity(){var ev=[];try{ev=JSON.parse(localStorage.getItem(AKEY)||"[]")}catch(err){}
  if(!Array.isArray(ev))ev=[];
  ev=ev.filter(function(x){return Array.isArray(x)&&x.length>=3&&APPKIND[x[1]]});
  var real=ev.length>0,u=usage();
  if(!real)Object.keys(u).forEach(function(s){if(APPKIND[s])ev.push([u[s].last,s,APPKIND[s],.25*Math.min(u[s].n,8)])});
  return{events:ev,real:real};}
function sheet(){var a=activity(),now=Date.now()/1000,score={},by={},rate7={},rate21={};
  STATS.forEach(function(s){score[s]=0;by[s]={}});
  a.events.forEach(function(x){var ts=+x[0]>2e10?x[0]/1000:+x[0],age=(now-ts)/86400;if(!(age>=0))return;
    var w=Math.pow(2,-age/14)*(+x[3]||1),m=KIND[x[2]]||KIND[APPKIND[x[1]]]||{};
    Object.keys(m).forEach(function(s){score[s]+=w*m[s];by[s][x[1]]=(by[s][x[1]]||0)+w*m[s]});
    if(age<7)rate7[x[1]]=(rate7[x[1]]||0)+(+x[3]||1)/7;
    else if(age<28)rate21[x[1]]=(rate21[x[1]]||0)+(+x[3]||1)/21;});
  var host=d.getElementById("sheet");
  if(!a.events.length){host.hidden=true;return;}
  host.hidden=false;
  var mx=Math.max.apply(null,STATS.map(function(s){return score[s]}))||1,st=d.getElementById("stats");st.innerHTML="";
  function level(v){return v?Math.min(20,Math.round(1+4*Math.log2(1+v))):1}
  STATS.forEach(function(s){var v=score[s],lv=level(v);
    var nm=d.createElement("span");nm.className="nm";nm.textContent=s;
    var bar=d.createElement("span");bar.className="bar";var i=d.createElement("i");i.style.width=Math.round(100*v/mx)+"%";bar.appendChild(i);
    var l=d.createElement("span");l.className="lv";l.innerHTML="lv <b>"+lv+"</b>";
    st.appendChild(nm);st.appendChild(bar);st.appendChild(l);
    var tot=0,who=Object.keys(by[s]);who.forEach(function(k){tot+=by[s][k]});
    if(tot){who.sort(function(p,q){return by[s][q]-by[s][p]});
      var src=d.createElement("span");src.className="src";
      src.textContent="\u2190 "+who.slice(0,3).map(function(k){return TITLES[k]+" "+Math.round(100*by[s][k]/tot)+"%"}).join(" \u00b7 ");
      st.appendChild(src);}});
  // radar: the seven stats as one shape, so balance is visible at a glance
  var R=d.getElementById("radar"),cx=100,cy=100,rad=70,n=STATS.length,pt=function(i,f){
    var ang=-Math.PI/2+i*2*Math.PI/n;return [(cx+Math.cos(ang)*rad*f).toFixed(1),(cy+Math.sin(ang)*rad*f).toFixed(1)]};
  var svg="";[.25,.5,.75,1].forEach(function(f){svg+="<polygon class='web' points='"+STATS.map(function(_,i){return pt(i,f).join(",")}).join(" ")+"'/>"});
  STATS.forEach(function(s,i){var o=pt(i,1);svg+="<line class='axis' x1='"+cx+"' y1='"+cy+"' x2='"+o[0]+"' y2='"+o[1]+"'/>"});
  svg+="<polygon class='area' points='"+STATS.map(function(s,i){return pt(i,Math.max(.04,score[s]/mx)).join(",")}).join(" ")+"'/>";
  STATS.forEach(function(s,i){var o=pt(i,1.22);svg+="<text class='lbl"+(score[s]===mx?" hi":"")+"' x='"+o[0]+"' y='"+o[1]+"' text-anchor='middle' dominant-baseline='middle'>"+s+"</text>"});
  R.innerHTML=svg;
  // level-ups: compare with a snapshot at least a day old, then roll the snapshot forward
  var LKEY="portal-levels",lv={};STATS.forEach(function(s){lv[s]=level(score[s])});
  var snap=null;try{snap=JSON.parse(localStorage.getItem(LKEY)||"null")}catch(err){}
  // compare against the previous day's snapshot, which stays fixed until the next rollover —
  // so a refresh never erases the arrows (same rule as what's-new)
  var ups=[],base=snap&&(snap.prev||snap.levels);
  if(base){STATS.forEach(function(s){if(lv[s]>(base[s]||0))ups.push(s+" "+(base[s]||0)+"\u2192"+lv[s])});}
  if(!snap||Date.now()-snap.at>864e5){try{localStorage.setItem(LKEY,JSON.stringify({at:Date.now(),levels:lv,prev:snap?snap.levels:null}))}catch(err){}}
  ups.forEach(function(u){var s=u.split(" ")[0],i=STATS.indexOf(s);if(i<0)return;
    var lvEl=st.querySelectorAll(".lv")[i];if(lvEl){var b=d.createElement("b");b.className="up";b.textContent="\u2191";lvEl.appendChild(b);}});
  d.getElementById("lvlups").textContent=ups.length?"\u2b06 level up: "+ups.join(" \u00b7 "):"";
  var hb=d.getElementById("habitlist"),groups={strong:[],steady:[],fresh:[],resting:[]};
  Object.keys(APPKIND).forEach(function(k){var r7=rate7[k]||0,r21=rate21[k]||0;
    if(!r7&&!r21)return;
    if(!r21&&r7)groups.fresh.push(k);else if(r7>=.8*r21&&r7)groups.strong.push(k);
    else if(r7<.5*r21)groups.resting.push(k);else groups.steady.push(k);});
  function names(ks){return ks.map(function(k){return TITLES[k]}).join(", ")}
  var h="";
  if(groups.strong.length)h+="<p>\\ud83d\\udcaa <b>going strong:</b> "+names(groups.strong)+"</p>";
  if(groups.steady.length)h+="<p>\\ud83d\\udfe2 <b>steady:</b> "+names(groups.steady)+"</p>";
  if(groups.fresh.length)h+="<p>\\ud83c\\udf31 <b>new this week:</b> "+names(groups.fresh)+"</p>";
  if(groups.resting.length)h+="<p>\\ud83c\\udf42 <b>resting lately:</b> "+names(groups.resting)+" \u2014 still here whenever you're back</p>";
  hb.innerHTML=h||"<p>habits show up once there's a couple of weeks of activity</p>";
  // 12-week heatmap (colour = the day's busiest app, depth = how much), fleet streak, journal
  var DAY=864e5,today=new Date();today.setHours(0,0,0,0);var t0=today.getTime();
  var days={};a.events.forEach(function(x){var ts=+x[0]>2e10?x[0]:x[0]*1000,k=Math.floor((t0-new Date(new Date(ts).setHours(0,0,0,0)).getTime())/DAY+.5);
    if(k<0||k>=84)return;var dd=days[k]||(days[k]={tot:0,by:{}});var amt=+x[3]||1;dd.tot+=amt;dd.by[x[1]]=(dd.by[x[1]]||0)+amt;});
  var heat=d.getElementById("heat"),cells="",mxd=1;Object.keys(days).forEach(function(k){mxd=Math.max(mxd,days[k].tot)});
  // columns are weeks, oldest first; rows Mon..Sun so the grid reads like a calendar
  var dow=(today.getDay()+6)%7;  // this week's Monday is `dow` days back; column 11 is this week
  for(var c=0;c<12;c++)for(var r=0;r<7;r++){var k=dow+(11-c)*7-r;
    if(k<0||k>83){cells+="<i style='visibility:hidden'></i>";continue;}
    var dd=days[k],dt=new Date(t0-k*DAY),lab=dt.toLocaleDateString(undefined,{month:"short",day:"numeric"});
    if(!dd){cells+="<i title='"+lab+"'"+(k===0?" class='today'":"")+"></i>";continue;}
    var top=Object.keys(dd.by).sort(function(p,q){return dd.by[q]-dd.by[p]})[0];
    cells+="<i class='on"+(k===0?" today":"")+"' style='--h:"+(HUES[top]||220)+";--a:"+(0.25+0.75*Math.min(1,dd.tot/mxd)).toFixed(2)+"' title='"+lab+" \u00b7 "
      +Object.keys(dd.by).map(function(s){return TITLES[s]+" "+Math.round(dd.by[s]*10)/10}).join(", ")+"'></i>";}
  heat.innerHTML=cells;
  var used={};a.events.forEach(function(x){used[x[1]]=1});
  d.getElementById("heatkey").innerHTML=Object.keys(used).map(function(s){return "<span><i style='--h:"+HUES[s]+"'></i>"+TITLES[s]+"</span>"}).join("<br>");
  var streak=0;for(var k=(days[0]?0:1);days[k];k++)streak++;
  var wk=0,by7={};Object.keys(days).forEach(function(k){if(k<7)wk+=days[k].tot});
  Object.keys(days).forEach(function(k){if(k<56){var wd=(new Date(t0-k*DAY).getDay()+6)%7;by7[wd]=(by7[wd]||0)+days[k].tot}});
  var best=Object.keys(by7).sort(function(p,q){return by7[q]-by7[p]})[0],
      names=["Mondays","Tuesdays","Wednesdays","Thursdays","Fridays","Saturdays","Sundays"];
  d.getElementById("actsum").innerHTML="your activity \u00b7 "+(streak?"<b>🔥 "+streak+"-day streak</b> \u00b7 ":"")
    +"<b>"+Math.round(wk)+"</b> this week"+(best!==undefined?" \u00b7 busiest on <b>"+names[best]+"</b>":"");
  var jl=d.getElementById("journal"),rows=[];
  for(var k=0;k<14;k++){if(!days[k])continue;var dt=new Date(t0-k*DAY);
    rows.push("<li><b>"+(k===0?"today":k===1?"yesterday":dt.toLocaleDateString(undefined,{weekday:"short",day:"numeric"}))+"</b> "
      +Object.keys(days[k].by).map(function(s){return TITLES[s]+" \u00d7"+Math.round(days[k].by[s]*10)/10}).join(" \u00b7 ")+"</li>");}
  jl.innerHTML=rows.join("")||"<li>nothing in the last two weeks</li>";
  // per-card personal line + weekly rhythm: the same events, seen from each app
  var act30={},byDow={};a.events.forEach(function(x){var ts=+x[0]>2e10?x[0]/1000:+x[0],age=(now-ts)/86400;
    if(age<30)act30[x[1]]=(act30[x[1]]||0)+1;
    if(age<56){var wd=(new Date(ts*1000).getDay()+6)%7;(byDow[x[1]]=byDow[x[1]]||[0,0,0,0,0,0,0])[wd]+=(+x[3]||1);}});
  d.querySelectorAll(".usage").forEach(function(el){var n=act30[el.dataset.slug];
    if(n&&el.textContent.indexOf("this month")<0)el.innerHTML="<span class='you'>"+n+" activit"+(n>1?"ies":"y")+" this month</span> \u00b7 "+el.textContent;});
  var DN=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
  function rhythm(k){var w=byDow[k];if(!w)return "";var tot=w.reduce(function(p,q){return p+q},0);if(tot<4)return "";
    var idx=[0,1,2,3,4,5,6].sort(function(p,q){return w[q]-w[p]}).filter(function(i){return w[i]>0}).slice(0,3);
    var cover=idx.reduce(function(p,i){return p+w[i]},0)/tot;return cover>=.6?" ("+idx.sort().map(function(i){return DN[i]}).join(" \u00b7 ")+")":"";}
  d.querySelectorAll("#habitlist p").forEach(function(pEl){Object.keys(TITLES).forEach(function(k){
    var r=rhythm(k);if(r&&pEl.textContent.indexOf(TITLES[k])>=0&&/going strong|steady/.test(pEl.textContent))pEl.innerHTML=pEl.innerHTML.replace(TITLES[k],TITLES[k]+"<span class='rh'>"+r+"</span>");});});
  // what an agent gets to see when you ask for a review (built here, sent by the panel below)
  window.__sheet={generatedAt:new Date().toISOString(),levels:lv,
    sources:STATS.reduce(function(o,s){var tot=0;Object.keys(by[s]).forEach(function(k){tot+=by[s][k]});
      o[s]=Object.keys(by[s]).map(function(k){return TITLES[k]+" "+Math.round(100*by[s][k]/tot)+"%"});return o},{}),
    habits:{goingStrong:groups.strong.map(function(k){return TITLES[k]+rhythm(k)}),steady:groups.steady.map(function(k){return TITLES[k]+rhythm(k)}),
      newThisWeek:groups.fresh.map(function(k){return TITLES[k]}),resting:groups.resting.map(function(k){return TITLES[k]})},
    streakDays:streak,thisWeek:Math.round(wk),busiestWeekday:best!==undefined?names[best]:null,
    journal:rows.map(function(r){return r.replace(/<[^>]+>/g,"")}),
    installed:Object.keys(installed()),launchesByApp:usage()};
  askCoach();
  d.getElementById("sheetnote").textContent=(a.real?a.events.length+" activities reported by your apps":
    "based on launches only so far \u2014 apps report real activity as they're updated")
    +" \u00b7 last 2 weeks count double \u00b7 lives only in this browser";}
sheet();
// ask your coach: the portal is a cowork app too — the shared panel in fs mode, one `review` channel
var askMounted=false;
function askCoach(){var sec=d.getElementById("ask"),host=d.getElementById("askhost"),out=d.getElementById("askreply");
  if(!window.__sheet)return;sec.hidden=false;
  var cached="";try{cached=localStorage.getItem("portal-review-reply")||""}catch(err){}
  if(cached&&!out.textContent){out.textContent=cached;out.hidden=false;}
  function mount(){if(askMounted||!window.cowork)return;askMounted=true;
    function djb2(t){var h=5381;for(var i=0;i<t.length;i++)h=((h*33)^t.charCodeAt(i))>>>0;return h.toString(16)}
    cowork.mount(host,{app:"adervec-portal",
      manifest:{protocol:"cowork-manifest",protocolVersion:1,app:"adervec-portal",
        channels:[{name:"review",request:["review/request.json"],instructions:"review/INSTRUCTIONS.md",replyPath:"review/reply.json"}]},
      files:function(){var payload=window.__sheet;return {
        "review/request.json":{protocol:"adervec-portal-review",protocolVersion:1,kind:"review-request",
          generatedAt:new Date().toISOString(),requestHash:djb2(JSON.stringify(payload)),payload:payload},
        "review/INSTRUCTIONS.md":"# adervec portal \u2014 review channel\\n\\nRead `review/request.json`: `payload` is one person's week across all their apps \u2014 "+
          "character-sheet levels (STR/DEX/END/PSI/INT/CHR/VIT, 1\u201320) with which app feeds each, habits (going strong / steady / new / resting, with weekday rhythm), "+
          "streak, this week's total, a two-week journal, and launch counts.\\n\\nWrite `review/reply.json`:\\n\\n```json\\n{ \\"requestHash\\": \\"<copy the request's requestHash verbatim>\\",\\n"+
          "  \\"reply\\": \\"<a warm, specific weekly review in markdown: what's going well and why it shows in the numbers, what's quietly resting (no guilt \u2014 nobody runs ten apps at once), "+
          "one concrete, small suggestion for next week that fits the rhythm they already have. Under 200 words.>\\" }\\n```\\n"}},
      apply:function(ch,reply){var text=typeof reply==="string"?reply:(reply&&(reply.reply||(reply.payload&&reply.payload.reply)))||JSON.stringify(reply,null,2);
        try{localStorage.setItem("portal-review-reply",text)}catch(err){}
        out.textContent=text;out.hidden=false;bump("adervec-portal");}});}
  if(window.cowork)mount();else window.addEventListener("load",mount);}
// what's new since your last visit. The stamp only moves when you acknowledge the
// banner, so a refresh (or a second look an hour later) doesn't erase the markers.
var wn=d.getElementById("whatsnew");
function markSeen(){try{localStorage.setItem(VKEY,String(Math.floor(Date.now()/1000)))}catch(err){}}
(function(){
  var s=0;try{s=+localStorage.getItem(VKEY)||0}catch(err){}
  if(!s){markSeen();return;}                      // first visit: nothing is "new" yet
  var n=0;CHANGES.forEach(function(c){if(c[0]>s){n++;fresh[c[1]]=1;}});
  var na=Object.keys(fresh).length;
  if(!n){markSeen();return;}
  d.querySelectorAll(".tiles a").forEach(function(a){
    if(fresh[a.dataset.slug])a.classList.add("new")});
  cards().forEach(function(c){if(fresh[c.dataset.slug])c.classList.add("fresh")});
  d.querySelectorAll(".ship ol li").forEach(function(li){
    var w=li.querySelector(".when");if(w&&+w.dataset.ts>s)li.classList.add("new")});
  wn.querySelector("b").textContent=n+" change"+(n>1?"s":"")+" across "+na+" app"+(na>1?"s":"")
    +" since your last visit, "+rel(Date.now()/1000-s)+" ago";
  wn.hidden=false;
  var show=d.getElementById("wnshow");
  show.addEventListener("click",function(){freshOnly=!freshOnly;
    show.textContent=freshOnly?"show every app":"show me";
    applyFilter();grid.scrollIntoView({block:"start"});});
  d.getElementById("wndismiss").addEventListener("click",function(){
    markSeen();wn.hidden=true;freshOnly=false;fresh={};applyFilter();
    d.querySelectorAll(".new,.fresh").forEach(function(el){
      el.classList.remove("new");el.classList.remove("fresh")});});
})();
// sort
var sort=d.getElementById("sort");
sort.addEventListener("change",function(){var u=usage(),cs=cards();
  cs.sort(function(a,b){
    if(sort.value==="updated")return(+b.dataset.pushed||0)-(+a.dataset.pushed||0);
    if(sort.value==="used")return(((u[b.dataset.slug]||{}).n)||0)-(((u[a.dataset.slug]||{}).n)||0);
    return a.dataset.slug.localeCompare(b.dataset.slug);});
  cs.forEach(function(c){grid.appendChild(c)});});
// app of the day: deterministic daily pick
var slugs=cards().map(function(c){return c.dataset.slug}).sort();
if(slugs.length){var pick=slugs[Math.floor(Date.now()/864e5)%slugs.length],
    card=d.getElementById(pick.toLowerCase());
  if(card)card.classList.add("appday");}
// PWA install prompt
var ib=d.getElementById("install"),deferred=null;
window.addEventListener("beforeinstallprompt",function(ev){
  ev.preventDefault();deferred=ev;ib.hidden=false;});
ib.addEventListener("click",function(){
  if(deferred){deferred.prompt();deferred=null;ib.hidden=true;}});
window.addEventListener("appinstalled",function(){ib.hidden=true;});
// fleet chart hover: crosshair + tooltip
var fs=d.getElementById("fleet");
if(fs&&window.FLEET&&FLEET.length>1){
  var tip=d.getElementById("fleettip"),cur2=d.getElementById("cursor"),n=FLEET.length;
  fs.addEventListener("mousemove",function(ev){var r=fs.getBoundingClientRect();
    var i=Math.min(n-1,Math.max(0,Math.round((ev.clientX-r.left)/r.width*(n-1))));
    var wk=new Date((GEN-(n-1-i)*604800)*1000);
    tip.hidden=false;
    tip.textContent="week of "+wk.toLocaleDateString(undefined,{month:"short",day:"numeric"})
      +": "+FLEET[i]+" commit"+(FLEET[i]===1?"":"s");
    var x=(ev.clientX-r.left);
    tip.style.left=Math.min(r.width-tip.offsetWidth,Math.max(0,x-tip.offsetWidth/2))+"px";
    var vx=i*(520/(n-1));
    cur2.setAttribute("x1",vx);cur2.setAttribute("x2",vx);
    cur2.setAttribute("visibility","visible");});
  fs.addEventListener("mouseleave",function(){tip.hidden=true;
    cur2.setAttribute("visibility","hidden");});}
})();
"""

ICON_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
<rect width="96" height="96" rx="20" fill="#0d1220"/>
""" + "".join(
    f"<rect x='{12 + (i % 3) * 26}' y='{12 + (i // 3) * 26}' width='20' height='20' rx='6' "
    f"fill='hsl({a['hue']} 65% 58%)'/>\n" for i, a in enumerate(APPS[:9])
) + "</svg>\n"


def _when(ts):
    if not ts:
        return "<span class='when'>-</span>"
    return (f"<span class='when' data-ts='{ts:.0f}' "
            f"title='{e(time.strftime('%Y-%m-%d %H:%M', time.localtime(ts)))}'>{e(fmt_age(ts))}</span>")


def _spark(weeks, total):
    if not weeks or not any(weeks) or len(weeks) < 2:
        return ""
    w, h, n, mx = 104, 26, len(weeks), max(weeks)
    pts = " ".join(f"{i * (w / (n - 1)):.1f},{h - 3 - (v / mx) * (h - 7):.1f}"
                   for i, v in enumerate(weeks))
    return (f"<svg class='spark' viewBox='0 0 {w} {h}' width='{w}' height='{h}' role='img' "
            f"aria-label='{total} commits in the last 52 weeks'>"
            f"<title>{total} commits in the last 52 weeks</title>"
            f"<polyline points='{pts}'/></svg>")


def _shot_png(app):
    return PORTAL_DIR / "shots" / f"{app['slug'].lower()}.png"


def cmd_shots():
    exe = next((b for b in BROWSERS if Path(b).exists()), None)
    if not exe:
        sys.exit("no Chrome/Edge found for headless screenshots")
    (PORTAL_DIR / "shots").mkdir(parents=True, exist_ok=True)
    targets = [(app_url(a), _shot_png(a)) for a in APPS]
    targets.append((f"https://{USER}.github.io/portal/", PORTAL_DIR / "shots" / "portal.png"))
    for url, out in targets:
        r = subprocess.run(
            [exe, "--headless=new", "--disable-gpu", "--hide-scrollbars",
             "--window-size=800,500", "--virtual-time-budget=9000",
             f"--screenshot={out}", url],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=90)
        ok = out.exists() and out.stat().st_size > 5000  # ponytail: tiny file = blank shot
        print(f"  {out.name}: {'ok' if ok else 'FAILED'} ({out.stat().st_size if out.exists() else 0} bytes)")
        if not ok and out.exists():
            out.unlink()


def _card(app, d):
    slug, hue = app["slug"], app["hue"]
    badges = "".join(f"<button type='button'>{e(b)}</button>" for b in app["badges"])
    feats = "".join(f"<li>{e(f)}</li>" for f in app["features"])
    weeks = d.get("weeks") or []
    yr_commits = sum(weeks)
    bits = []
    created = iso_ts(d.get("created"))
    if created:
        bits.append(f"since {time.strftime('%Y', time.localtime(created))}")
    if yr_commits:
        bits.append(f"{yr_commits} commits/yr")
    if d.get("stars"):
        bits.append(f"★ {d['stars']}")
    stats = ""
    if bits or weeks:
        stats = (f"<p class='stats'>{_spark(weeks, yr_commits)}"
                 f"<span>{e(' · '.join(bits))}</span></p>")
    changes = d.get("changes") or []
    latest = ""
    if changes:
        latest = (f"<p class='latest'><b>Latest:</b> {e(changes[0]['msg'])} "
                  f"{_when(iso_ts(changes[0]['date']))}</p>")
    older = "".join(f"<li>{_when(iso_ts(c['date']))} {e(c['msg'])}</li>" for c in changes[1:])
    hist = f"<details><summary>Recent changes</summary><ul>{older}</ul></details>" if older else ""
    dl = ""
    if app.get("download"):
        label, url = app["download"]
        dl = f"<a class='dl' href='{e(url)}'>{e(label)}</a>"
    pushed = iso_ts(d.get("pushed_at")) or 0
    key = e(" ".join([app["title"], app["tagline"]] + app["badges"] + app["features"]).lower())
    shot = ""
    if _shot_png(app).exists():
        shot = (f"<a class='shot' href='{app_url(app)}' target='_blank' rel='noopener' tabindex='-1'>"
                f"<img src='shots/{slug.lower()}.png' alt='' width='800' height='500' loading='lazy'></a>")
    return f"""<article class="app" id="{slug.lower()}" style="--h:{hue}" data-k="{key}" data-slug="{e(slug)}" data-title="{e(app['title'])}" data-pushed="{pushed:.0f}">
{shot}<header><span class="tile" aria-hidden="true">{app['emoji']}</span><div>
<h2>{e(app['title'])} <a class="src" href="https://github.com/{USER}/{slug}" title="source on GitHub">src&#8599;</a></h2>
<p class="tag">{e(app['tagline'])}</p></div></header>
{stats}
<div class="badges">{badges}</div>
<ul class="feat">{feats}</ul>
{latest}{hist}
<footer><a class="launch" data-slug="{e(slug)}" href="{app_url(app)}" target="_blank" rel="noopener">Launch</a>
{dl}<span class="usage" data-slug="{e(slug)}">&nbsp;</span></footer>
</article>"""


def _fleet(data):
    """Summed 52-week activity across apps -> (svg+caption html, weekly totals, year total)."""
    series = [d.get("weeks") or [] for d in data.values()]
    n = max((len(s) for s in series), default=0)
    fleet = [sum(s[i] for s in series if len(s) == n) for i in range(n)]
    total = sum(fleet)
    if n < 2 or not total:
        return "", [], 0
    w, h, base = 520, 64, 56
    mx = max(fleet)
    xy = [(i * (w / (n - 1)), base - (v / mx) * (base - 12)) for i, v in enumerate(fleet)]
    pts = " ".join(f"{x:.1f},{y:.1f}" for x, y in xy)
    area = f"M0,{base} L " + " L ".join(f"{x:.1f},{y:.1f}" for x, y in xy) + f" L {w},{base} Z"
    busiest = max(fleet)
    chart = f"""<div class="chartwrap">
<svg id="fleet" viewBox="0 0 {w} {h}" preserveAspectRatio="none" role="img"
 aria-label="{total} commits across all apps in the last 52 weeks">
<line class="base" x1="0" y1="{base}" x2="{w}" y2="{base}"/>
<path class="area" d="{area}"/><polyline class="ln" points="{pts}"/>
<line id="cursor" class="cur" x1="0" x2="0" y1="10" y2="{base}" visibility="hidden"/></svg>
<div class="tip" id="fleettip" hidden></div></div>
<p class="caption">{total} commits across the fleet in the last 52 weeks · busiest week: {busiest}</p>"""
    return chart, fleet, total


def _ship_html(data):
    lis = "".join(
        f"<li style='--h:{app['hue']}'>{_when(ts)} <span class='dot' aria-hidden='true'></span>"
        f"<a class='who' href='#{app['slug'].lower()}'>{e(app['title'])}</a> {e(msg)}</li>"
        for ts, app, msg in shipped(data)[:12])
    return f"<ol>{lis}</ol>" if lis else ""


def write_feed(data):
    items = "".join(
        f"<item><title>{e(app['title'])}: {e(msg)}</title><link>{app_url(app)}</link>"
        f"<guid isPermaLink='false'>{app['slug']}-{ts:.0f}</guid>"
        f"<pubDate>{formatdate(ts)}</pubDate></item>"
        for ts, app, msg in shipped(data)[:30])
    xml = ("<?xml version='1.0' encoding='UTF-8'?><rss version='2.0'><channel>"
           f"<title>{USER} — recently shipped</title><link>https://{USER}.github.io/portal/</link>"
           f"<description>Every change shipped across {len(APPS)} free, local-first web apps."
           f"</description>{items}</channel></rss>")
    (PORTAL_DIR / "feed.xml").write_text(xml, encoding="utf-8")


def _write_png(path, size, px):
    """Minimal stdlib PNG writer: px(x, y) -> (r, g, b)."""
    raw = b"".join(
        b"\x00" + bytes(v for x in range(size) for v in px(x, y)) for y in range(size))

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
                     + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def _write_icons():
    """The nine-tile launcher icon as real PNGs (Chrome's install prompt needs 192/512 px)."""
    bg = (13, 18, 32)
    tiles = []  # (x0, y0, rgb) in 96-unit space
    for i, a in enumerate(APPS[:9]):
        r, g, b = colorsys.hls_to_rgb(a["hue"] / 360, 0.58, 0.62)
        tiles.append((12 + (i % 3) * 26, 12 + (i // 3) * 26, (int(r * 255), int(g * 255), int(b * 255))))

    def make(size):
        scale = 96 / size

        def px(x, y):
            gx, gy = x * scale, y * scale
            for x0, y0, rgb in tiles:
                if x0 <= gx < x0 + 20 and y0 <= gy < y0 + 20:
                    return rgb
            return bg
        _write_png(PORTAL_DIR / f"icon-{size}.png", size, px)

    make(192)
    make(512)


def write_pwa(stamp):
    manifest = {
        "name": "adervec — free, local-first web apps", "short_name": "adervec apps",
        "description": f"Portal for {len(APPS)} free web apps: launch, install, and follow changes.",
        "start_url": "./", "scope": "./", "display": "standalone",
        "background_color": "#0d1220", "theme_color": "#1d4ed8",
        "icons": [
            {"src": "icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
            {"src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
            {"src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
            {"src": "icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any"},
        ],
    }
    (PORTAL_DIR / "manifest.webmanifest").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    (PORTAL_DIR / "icon.svg").write_text(ICON_SVG, encoding="utf-8")
    _write_icons()
    # The Cache API is origin-wide and the sub-apps' caches live beside ours, so the
    # activate cleanup must only ever touch portal-* keys.
    sw = ('const C="portal-' + stamp + '";\n'
          'self.addEventListener("install",e=>{e.waitUntil(caches.open(C).then(c=>'
          'c.addAll(["./","manifest.webmanifest","icon.svg","icon-192.png","icon-512.png"])));'
          'self.skipWaiting();});\n'
          'self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(ks=>'
          'Promise.all(ks.filter(k=>k.startsWith("portal-")&&k!==C).map(k=>caches.delete(k)))));});\n'
          'self.addEventListener("fetch",e=>{if(e.request.method!=="GET")return;\n'
          ' e.respondWith(fetch(e.request).then(r=>{const cp=r.clone();'
          'caches.open(C).then(c=>c.put(e.request,cp));return r;})'
          '.catch(()=>caches.match(e.request,{ignoreSearch:true}).then(m=>m||caches.match("./"))));});\n')
    (PORTAL_DIR / "sw.js").write_text(sw, encoding="utf-8")


def write_root():
    """The origin root: a redirect to /portal/ plus a kill-switch service worker.

    The portal used to BE the root, PWA and all; returning visitors carry a root-scoped
    service worker (and possibly an installed app) that shadows every sub-app. The
    kill-switch replaces that worker, deletes only portal-* caches, and unregisters.
    """
    (SITE / "index.html").write_text(f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>adervec — moved to /portal/</title>
<meta http-equiv="refresh" content="0; url=/portal/">
<link rel="canonical" href="https://{USER}.github.io/portal/">
<script>
if("serviceWorker" in navigator&&location.protocol==="https:")
  navigator.serviceWorker.register("sw.js").catch(function(){{}});
location.replace("/portal/"+location.search+location.hash);
</script></head>
<body><p>The portal moved to <a href="/portal/">{USER}.github.io/portal/</a>.</p></body></html>
""", encoding="utf-8")
    # ponytail: this may race-delete the fresh /portal/ cache once; its network-first
    # worker just repopulates on the next fetch.
    (SITE / "sw.js").write_text(
        'self.addEventListener("install",e=>self.skipWaiting());\n'
        'self.addEventListener("activate",e=>e.waitUntil(caches.keys()'
        '.then(ks=>Promise.all(ks.filter(k=>k.startsWith("portal-")).map(k=>caches.delete(k))))'
        '.then(()=>self.registration.unregister())));\n', encoding="utf-8")
    if (SITE / "shots").is_dir() and not (PORTAL_DIR / "shots").exists():
        shutil.move(str(SITE / "shots"), str(PORTAL_DIR / "shots"))
    for stale in ("manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png", "feed.xml"):
        (SITE / stale).unlink(missing_ok=True)


COWORK_DOC = """<section class="doc">
<h2 class="eyebrow">// what it is</h2>
<p>Every app here can hand its data to an AI agent and take the answer back, through a plain folder on
your disk: the app writes a <code>cowork.json</code> manifest plus request files, an agent (Claude Code via
CoworkSyncHub, Claude Desktop pointed at the folder, or a person) writes reply files beside them, the app
imports the reply. Nothing goes through a server you don't run.</p>
<h2 class="eyebrow">// one panel, every app</h2>
<p>The panel below is the exact same component every app shows — same words, same states, same buttons —
no matter what the app around it looks like. CoworkSyncHub shows the same panel for every connected
app, where the buttons run the agent instead of writing files.</p>
<div id="demo"></div>
<h2 class="eyebrow">// states</h2>
<ul class="feat"><li><b>idle</b> — nothing asked yet.</li><li><b>PENDING</b> — a request is newer than any reply.</li>
<li><b>answered</b> — a reply landed after the latest request.</li><li><b>STALE</b> — pending for over 7 days.</li>
<li><b>note</b> — something's wrong with the folder; the text says what.</li></ul>
<h2 class="eyebrow">// try it</h2>
<p>Pick any scratch folder. The panel writes a tiny manifest and request into it; drop a
<code>reply.json</code> in there (any JSON) and press <i>Check for replies</i>.</p>
<div id="try"></div>
<h2 class="eyebrow">// for app authors</h2>
<pre><code>&lt;script src="https://adervec.github.io/cowork.js"&gt;&lt;/script&gt;
&lt;script&gt;
cowork.mount(document.getElementById("sync"), {
  app: "myapp",
  manifest: { protocol: "cowork-manifest", protocolVersion: 1, app: "myapp",
    channels: [{ name: "coach", request: ["coach/request.json"],
                 instructions: "coach/INSTRUCTIONS.md", replyPath: "coach/reply.json" }] },
  files: ch =&gt; ({ "coach/request.json": buildRequest(), "coach/INSTRUCTIONS.md": INSTRUCTIONS }),
  apply: (ch, reply) =&gt; importCoachReply(reply)
});
&lt;/script&gt;</code></pre>
<p>Apps that already drive their own folder keep that logic and use <code>mode="data"</code>: feed the
panel <code>{app, channels, actions}</code> and listen for <code>cowork-action</code>. Theme it only
through <code>--cowork-*</code> custom properties; the rest is shadow DOM on purpose. Protocol details:
<a href="https://github.com/adervec/CoworkSyncHub">CoworkSyncHub / COWORK-PROTOCOL.md</a>.
Step-by-step setup and troubleshooting for every app, the hub, and the data sources (Garmin, Strava,
Drive, Bluetooth): <a href="https://github.com/adervec/CoworkSyncHub/blob/main/SETUP.md">SETUP.md</a>.</p>
<h2 class="eyebrow">// the other two contracts</h2>
<p>Because every app lives on this origin, they share two small localStorage notes with the portal:
<code>portal-installed</code> (an app marks itself when it runs installed, so the portal can launch that
copy) and <code>portal-activity</code> (an app appends <code>[unixSeconds, slug, kind, amount]</code> when you
actually do something — a set, a chapter, a ride — which feeds the character sheet on the front page;
<code>amount</code> is roughly minutes of effort ÷ 10, so a short session is 1; keep the array under
~2000 entries). Both stay in your browser.</p>
</section>"""

COWORK_SELFTEST = """<!doctype html><meta charset="utf-8"><title>cowork.js self-test</title>
<body style="font:14px system-ui;margin:24px"><h1 id="r">running\u2026</h1><pre id="log"></pre>
<div id="a"></div><div id="b"></div>
<script src="cowork.js"></script>
<script>
(async function(){
  var fails=[],log=[];function ok(c,m){(c?log:fails).push(m);}
  ok(window.cowork&&cowork.version===1,"global + version");
  ok(cowork.stateOf({pending:true})==="PENDING","stateOf pending");
  ok(cowork.stateOf({pending:true,answered:true})==="answered","stateOf answered");
  ok(cowork.stateOf({pending:true,stale:true})==="STALE","stateOf stale");
  ok(cowork.stateOf({note:"x"})==="-","stateOf note");
  ok(cowork.stateOf({})==="idle","stateOf idle");
  ok(cowork.rel(30)==="30s ago"&&cowork.rel(3*86400)==="3d ago","rel");
  var p=document.createElement("cowork-panel");p.setAttribute("mode","data");document.getElementById("a").appendChild(p);
  var got=[];p.addEventListener("cowork-action",function(ev){got.push(ev.detail.action+":"+ev.detail.channel)});
  p.data={app:"demo",channels:[{channel:"coach",pending:true,request_mtime:Date.now()/1000-60},
    {channel:"plan",pending:true,answered:true,reply_mtime:Date.now()/1000-5}],
    actions:[{id:"push",label:"Send requests",primary:true}]};
  var sr=p.shadowRoot;
  ok(sr.querySelectorAll("li").length===2,"two channel rows");
  ok(sr.querySelector(".pill.pending")&&sr.querySelector(".pill.answered"),"state pills");
  ok(sr.querySelector("header button.primary").textContent==="Send requests","header action");
  sr.querySelector("header button.primary").click();
  sr.querySelectorAll("li")[0].querySelector(".acts button").click();
  ok(got.join(",")==="push:null,run:coach","actions dispatch cowork-action: "+got.join(","));
  var q=document.createElement("cowork-panel");q.mode="fs";ok(q.getAttribute("mode")==="fs","mode is settable as a property (React 19)");
  document.getElementById("b").appendChild(q);
  q.configure({app:"selftest",manifest:{protocol:"cowork-manifest",protocolVersion:1,app:"selftest",
    channels:[{name:"one",request:["one/request.json"],replyPath:"one/reply.json"}]}});
  ok(q.shadowRoot.querySelector("header button.primary").textContent==="Connect folder","fs mode starts disconnected");
  ok(q.shadowRoot.querySelector(".pill").textContent==="idle","fs mode idle");
  ok(getComputedStyle(q.shadowRoot.querySelector(".wrap")).borderTopLeftRadius==="12px","shadow css applied");
  document.getElementById("r").textContent=fails.length?"FAIL "+fails.length:"OK "+log.length+" checks";
  document.title=(fails.length?"FAIL":"OK")+" cowork self-test";
  document.getElementById("log").textContent=(fails.length?"FAILED:\\n"+fails.join("\\n")+"\\n\\n":"")+"passed:\\n"+log.join("\\n");
})();
</script>"""


def write_cowork():
    """Publish the shared cowork UI + its docs page + a browser self-test."""
    shutil.copy(BASE / "cowork.js", SITE / "cowork.js")
    (SITE / "cowork").mkdir(exist_ok=True)
    page = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI cowork sync — how it works</title>
<meta name="description" content="How the apps at adervec.github.io hand work to an AI agent through a folder on your disk, and the one shared panel that drives it.">
<link rel="icon" href="/portal/icon.svg" type="image/svg+xml">
<style>{PORTAL_CSS}
.doc p,.doc ul{{max-width:720px;font-size:14.5px}}
.doc pre{{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px;overflow-x:auto;font:12.5px/1.55 var(--mono)}}
.doc code{{font:12.5px var(--mono);background:var(--chipbg);padding:1px 5px;border-radius:4px}}
.doc pre code{{background:none;padding:0}}
.doc .eyebrow{{margin-top:28px}}
#demo,#try{{max-width:720px;margin:12px 0}}
</style></head><body><main>
<div class="head"><div class="wordmark"><a href="../" style="text-decoration:none;color:inherit">{USER}.github.io</a> / cowork</div></div>
<h1>AI cowork sync</h1>
{COWORK_DOC}
<footer class="page"><span><a href="../">all apps</a></span><span><a href="../cowork-selftest.html">self-test</a></span>
<span><a href="https://github.com/{USER}/CoworkSyncHub">CoworkSyncHub</a></span></footer>
</main>
<script src="../cowork.js"></script>
<script>
var demo=document.createElement("cowork-panel");demo.setAttribute("mode","data");
document.getElementById("demo").appendChild(demo);
var now=Date.now()/1000;
demo.data={{app:"example app",folder:"example app",channels:[
  {{channel:"coach",pending:true,request_mtime:now-1800}},
  {{channel:"plan-of-the-day",pending:true,answered:true,request_mtime:now-7200,reply_mtime:now-600}},
  {{channel:"analysis",pending:true,stale:true,request_mtime:now-9*86400}},
  {{channel:"archive"}}],
  actions:[{{id:"push",label:"Send requests",primary:true}},{{id:"poll",label:"Check for replies"}}],
  channelActions:[{{id:"run",label:"Run",primary:"pending"}}]}};
demo.addEventListener("cowork-action",function(ev){{demo.data=Object.assign({{}},demo._cfg,{{channels:demo.channels,
  actions:[{{id:"push",label:"Send requests",primary:true}},{{id:"poll",label:"Check for replies"}}],
  message:"demo: would "+ev.detail.action+(ev.detail.channel?" "+ev.detail.channel:"")}});}});
cowork.mount(document.getElementById("try"),{{app:"portal-try",
  manifest:{{protocol:"cowork-manifest",protocolVersion:1,app:"portal-try",
    channels:[{{name:"hello",request:["hello/request.json"],instructions:"hello/INSTRUCTIONS.md",replyPath:"hello/reply.json"}}]}},
  files:function(){{return {{"hello/request.json":{{protocol:"portal-try",protocolVersion:1,kind:"hello",
      generatedAt:new Date().toISOString(),payload:{{say:"hi"}}}},
    "hello/INSTRUCTIONS.md":"# hello\\n\\nWrite any JSON to hello/reply.json."}}}},
  apply:function(ch,reply){{alert("reply imported: "+JSON.stringify(reply).slice(0,120));}}}});
</script></body></html>"""
    (SITE / "cowork" / "index.html").write_text(page, encoding="utf-8")
    (SITE / "cowork-selftest.html").write_text(COWORK_SELFTEST, encoding="utf-8")


def write_site(data):
    SITE.mkdir(exist_ok=True)
    PORTAL_DIR.mkdir(exist_ok=True)
    write_root()  # first: it also migrates legacy root shots/ that the cards look for
    write_cowork()
    now = time.time()
    stamp = time.strftime("%Y%m%d%H%M")
    cards = "".join(_card(app, data.get(app["slug"], {})) for app in APPS)
    chart, fleet, total = _fleet(data)
    log = _ship_html(data)
    # ponytail: 60 rows is well past a plausible "since your last visit" window;
    # widen it if someone can go long enough away that the banner undercounts.
    recent = [[round(ts), a["slug"]] for ts, a, _ in shipped(data)[:60]]
    ship = ""
    if chart or log:
        ship = f"<section class='ship'><h2 class='eyebrow'>// recently shipped</h2>{chart}{log}</section>"
    tiles = "".join(
        f"<a href='#{a['slug'].lower()}' style='--h:{a['hue']}' data-slug='{e(a['slug'])}' "
        f"data-url='{app_url(a)}' title='{e(a['title'])} — tap for details, hold to launch'>"
        f"<span class='tile' aria-hidden='true'>{a['emoji']}</span>"
        f"<span>{e(a['title'])}</span></a>" for a in APPS)
    page = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>adervec — free, local-first web apps</title>
<meta name="description" content="{len(APPS)} free web apps by one maker: fitness, reading, chess, guitar, cycling, cooking and more. No accounts, no servers — your data stays on your device.">
<link rel="canonical" href="https://{USER}.github.io/portal/">
<meta property="og:type" content="website"><meta property="og:url" content="https://{USER}.github.io/portal/">
<meta property="og:title" content="adervec — free, local-first web apps">
<meta property="og:description" content="{len(APPS)} free web apps by one maker. No accounts, no servers — your data stays on your device.">
{f'<meta property="og:image" content="https://{USER}.github.io/portal/shots/portal.png">' if (PORTAL_DIR / "shots" / "portal.png").exists() else ''}
<meta name="theme-color" content="#f6f8f7" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0d1220" media="(prefers-color-scheme: dark)">
<link rel="manifest" href="manifest.webmanifest">
<link rel="alternate" type="application/rss+xml" title="{USER} — recently shipped" href="feed.xml">
<link rel="icon" href="icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="icon-192.png">
<script src="../cowork.js" defer></script>
<style>{PORTAL_CSS}</style></head><body><main>
<div class="head"><div class="wordmark">{USER}.github.io</div>
<button id="install" class="install" type="button" hidden>Install</button>
<button id="theme" class="toggle" type="button" aria-label="theme">◐</button></div>
<h1>Free, local-first web apps</h1>
<nav class="tiles" aria-label="Apps">{tiles}</nav>
<p class="hint">tap a tile for details · <b>hold</b> to launch — a ✓ marks an app you've installed,
and holding opens that copy · keys <kbd>1</kbd>–<kbd>0</kbd> launch too</p>
<div id="whatsnew" hidden><b></b><button id="wnshow" type="button">show me</button>
<button id="wndismiss" type="button" title="dismiss">&times;</button></div>
{ship}
<section class="you" id="sheet" hidden>
<h2 class="eyebrow">// your character sheet</h2>
<div class="sheet"><svg id="radar" viewBox="0 0 200 200" role="img" aria-label="stat balance"></svg>
<div class="cs" id="stats"></div>
<div class="habits" id="habits"><p id="lvlups"></p><div id="habitlist"></div></div></div>
<p class="caption" id="sheetnote"></p>
<details class="act" id="act"><summary id="actsum">your activity</summary>
<div class="heatwrap"><div class="heat" id="heat"></div><div class="heatkey" id="heatkey"></div></div>
<ol class="journal" id="journal"></ol></details>
</section>
<section class="you" id="ask" hidden>
<h2 class="eyebrow">// ask your coach</h2>
<p class="caption">Hand your whole week — every app — to an agent through a folder: CoworkSyncHub, Claude Desktop,
or a person. It writes a review back and it shows here. Nothing is uploaded.</p>
<div id="askhost"></div>
<pre id="askreply" class="reply" hidden></pre>
</section>
<div id="recent" hidden><span>jump back in:</span><div class="rr"></div></div>
<div class="controls">
<input id="q" type="search" placeholder="filter apps — try &quot;chess&quot;, &quot;offline&quot;, &quot;sync&quot;…" aria-label="Filter apps">
<span id="count"></span><span><kbd>/</kbd></span>
<select id="sort" aria-label="Sort apps"><option value="name">A–Z</option>
<option value="updated">Recently updated</option><option value="used">Your most used</option></select>
</div>
<div class="grid">{cards}</div>
<p id="empty" hidden>Nothing matches. <button id="clearq" type="button">Clear the filter</button></p>
<p class="note"><b>Private by design:</b> one maker, {len(APPS)} free, open-source apps —
no accounts, no servers, no tracking. Everything runs in your browser and your data stays on your device.</p>
<p class="note"><b>Install any of them:</b> launch the app, then use the browser's
<i>Install app</i> button (the icon in the address bar in Chrome and Edge). Installed apps get
their own window and the ones marked <i>offline</i> keep working without a connection.
This portal installs the same way.</p>
<footer class="page"><span>generated {e(time.strftime('%Y-%m-%d %H:%M'))}</span>
<span>usage counts live only in this browser</span><span id="you"></span>
<span><a href="feed.xml">RSS</a></span>
<span><a href="https://github.com/{USER}">github.com/{USER}</a></span></footer>
</main><script>const GEN={now:.0f};const FLEET={json.dumps(fleet)};const CHANGES={json.dumps(recent)};const APPKIND={json.dumps({a['slug']: a['kind'] for a in APPS})};const HUES={json.dumps({a['slug']: a['hue'] for a in APPS})};const TITLES={json.dumps({a['slug']: a['title'] for a in APPS})};{PORTAL_JS}</script></body></html>"""
    (PORTAL_DIR / "index.html").write_text(page, encoding="utf-8")
    write_feed(data)
    write_pwa(stamp)
    return PORTAL_DIR / "index.html"


# Public-exposure sweep: everything in site/ ships to the open internet, and commit
# subjects flow straight into the page and feed. Local paths/emails are redacted in
# place; credential-shaped strings abort the build so the SOURCE gets fixed.
# ponytail: text files only — a secret visible in a screenshot PNG won't be caught.
REDACT = [
    (re.compile(r"[A-Za-z]:[/\\]+Users[/\\]+[^\"'<>\s)]*"), "~"),
    (re.compile(r"\b[\w.+-]+@[\w-]+\.[A-Za-z]{2,}\b"), "[redacted-email]"),
]
FORBID = re.compile(
    r"sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_\w{20,}|AKIA[0-9A-Z]{16}"
    r"|AIza[0-9A-Za-z_-]{30,}|xox[baprs]-[A-Za-z0-9-]{10,}"
    r"|-----BEGIN[A-Z ]*PRIVATE KEY-----"
    r"|(?i:(?:api[_-]?key|client[_-]?secret|password)['\"]?\s*[:=]\s*['\"][^'\"\n]{8,})")


# ---------- legal / ToS / privacy / PG-content sweep over the app repos ----------
# Advisory, never blocking: these are judgment calls for the maker, unlike the
# credential audit above which hard-stops a deploy. Runs on every deploy and on
# `python portal.py sweep`; the hub's `status` prints the cached summary line.
SWEEP_PATH = BASE / "sweep.json"
SWEEP_REPORT = BASE / "sweep-report.html"
SWEEP_SKIP = {"node_modules", ".git", "dist", "build", ".cache", "site", "coverage", ".next",
              "out", "vendor", "__pycache__", "test-results", "playwright-report",
              ".venv", "venv", ".tox", "env"}
SWEEP_EXTS = {".html", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".css", ".md", ".json", ".py",
              ".txt", ".svg", ".webmanifest", ".yml", ".yaml"}
SWEEP_BRANDS = ["Black Mirror", "Netflix", "Garmin", "Strava", "Spotify", "YouTube", "Disney", "Nintendo",
                "Pokémon", "Pokemon", "Marvel", "Peloton", "Zwift", "Chess.com", "Lichess", "Fitbit",
                "Apple Watch", "Whoop", "MyFitnessPal", "Duolingo", "Kindle", "Goodreads", "Stockfish",
                "Games Workshop", "Warhammer"]
SWEEP_HOSTS = re.compile(r"https?://(?:[\w.-]+\.)?(strava\.com|garmin\.com|api\.anthropic\.com|api\.openai\.com"
                         r"|googleapis\.com|lichess\.org|chess\.com|spotify\.com|youtube\.com|openlibrary\.org"
                         r"|gutenberg\.org|wikipedia\.org|openai\.com)")
SWEEP_PROXY = re.compile(r"cors-anywhere|allorigins|corsproxy|thingproxy|cors\.sh\b")
SWEEP_TRACK = re.compile(r"googletagmanager|google-analytics|gtag\(|fbq\(|connect\.facebook\.net|hotjar"
                         r"|mixpanel|segment\.(?:com|io)|plausible\.io|umami\.is|clarity\.ms|sentry\.io|amplitude\.com|posthog")
SWEEP_HEALTH = re.compile(r"\b(calori\w*|diet|weight loss|fat loss|injur\w*|supplement\w*|steroid\w*|fasting"
                          r"|body ?fat|medical|dosage|bulking|cutting phase)\b", re.I)
SWEEP_DISCLAIM = re.compile(r"not medical advice|disclaimer|consult (?:a|your) (?:doctor|physician|professional)"
                            r"|medical professional|healthcare provider|at your own risk|not a substitute for", re.I)
SWEEP_PG = [  # group -> word-bounded regex. "sex" alone is a fitness profile field, so it's not here.
    ("profanity", re.compile(r"\b(fuck\w*|shit\w*|bitch\w*|asshole|bastard|cunt|piss\w*|dick)\b", re.I)),
    ("adult", re.compile(r"\b(porn\w*|sexy|sexual\w*|nude|naked|erotic\w*|nsfw|xxx|orgasm\w*)\b", re.I)),
    ("violence", re.compile(r"\b(kill(?:ed|ing|er|s)?|murder\w*|guns?|shoot(?:ing|er)?|bloody|suicid\w*"
                            r"|weapon\w*|bombs?|terror\w*|tortur\w*|gore|corpse\w*|zombie\w*)\b", re.I)),
    ("substances", re.compile(r"\b(beer|vodka|whisk(?:e)?y|drunk|weed|cocaine|heroin|vape|vaping|cigarette\w*"
                              r"|tobacco|marijuana)\b", re.I)),
    ("gambling", re.compile(r"\b(casino\w*|gambl\w*|wager\w*|jackpot|slot machine|betting)\b", re.I)),
    ("dark", re.compile(r"\b(horror|dystopi\w*|nightmare\w*|demons?|demonic|satan\w*|occult|creepy)\b", re.I)),
]
SWEEP_SEV = ["secret", "legal", "privacy", "tos", "content"]


def _sweep_files(root):
    for path in root.rglob("*"):
        if any(part in SWEEP_SKIP for part in path.relative_to(root).parts):
            continue
        if path.is_file() and path.suffix.lower() in SWEEP_EXTS and path.stat().st_size < 1_500_000:
            yield path


def sweep_app(app, root):
    """All findings for one repo as [{sev, app, check, detail, where:[...]}]."""
    out = []
    rel = lambda p: str(p.relative_to(root)).replace("\\", "/")

    def add(sev, check, detail, where=()):
        out.append({"sev": sev, "app": app["title"], "check": check, "detail": detail, "where": list(where)[:3]})

    if not any((root / n).exists() for n in ("LICENSE", "LICENSE.md", "LICENSE.txt", "license", "COPYING")):
        add("legal", "license", "no LICENSE file — public code without a license is all-rights-reserved by default")
    for b in SWEEP_BRANDS:
        if b.casefold() in app["title"].casefold():
            add("legal", "trademark", f"app name contains the trademark \u201c{b}\u201d")
    hits = {}          # (sev, check, detail) -> [where]
    health_hit, disclaim_hit, audio = [], False, []
    for path in _sweep_files(root):
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        rp = rel(path)
        doc = path.suffix.lower() in {".md", ".txt", ".html", ".json", ".webmanifest"}
        credits = re.search(r"licen[cs]e|notice|credits|third[_-]?party|package-lock|attribution", rp, re.I)
        corpus = (re.search(r"/(texts?|passages?|corpus|books?|library|samples?|fixtures?|lyrics)/", "/" + rp, re.I)
                  or (path.suffix.lower() == ".txt" and path.stat().st_size > 20_000))
        if m := FORBID.search(text):
            hits.setdefault(("secret", "credential-shaped", m.group()[:18] + "\u2026"), []).append(rp)
        for rx, label in ((REDACT[0][0], "local path"), (REDACT[1][0], "email address")):
            if (m := rx.search(text)) and not credits and not re.search(r"example\.(?:com|org|net)$", m.group()):
                hits.setdefault(("privacy", label, m.group()[:40]), []).append(rp)
        if m := SWEEP_TRACK.search(text):
            hits.setdefault(("privacy", "tracker", m.group()), []).append(rp)
        if m := SWEEP_PROXY.search(text):
            hits.setdefault(("tos", "cors proxy", m.group()), []).append(rp)
        for m in SWEEP_HOSTS.finditer(text):
            hits.setdefault(("tos", "third-party api", m.group(1)), []).append(rp)
        if doc or path.suffix.lower() in {".js", ".jsx", ".ts", ".tsx", ".mjs"}:
            low = text.casefold()
            for b in SWEEP_BRANDS:
                n = low.count(b.casefold())
                if n:
                    hits.setdefault(("tos", "brand mention", b), []).append(f"{rp} \u00d7{n}")
            for m in SWEEP_HEALTH.finditer(text):
                health_hit.append(f"{rp}: {m.group()}")
            if SWEEP_DISCLAIM.search(text):
                disclaim_hit = True
            for group, rx in SWEEP_PG:
                if corpus:  # bundled public-domain literature is not the app speaking
                    break
                found = {}
                for m in rx.finditer(text):
                    found[m.group().lower()] = found.get(m.group().lower(), 0) + 1
                for w, n in found.items():
                    hits.setdefault(("content", group, w), []).append(f"{rp} \u00d7{n}")
    for ext in (".mp3", ".ogg", ".wav", ".m4a"):
        audio += [p for p in root.rglob("*" + ext) if not any(x in p.parts for x in SWEEP_SKIP)]
    if audio and not any((root / n).exists() for n in ("CREDITS.md", "ATTRIBUTION.md", "LICENSES.md", "THIRD_PARTY.md")):
        add("legal", "bundled audio", f"{len(audio)} audio file(s) and no CREDITS/ATTRIBUTION file",
            [rel(a) for a in audio])
    if health_hit and not disclaim_hit:
        add("legal", "health content", "fitness/health wording but no disclaimer anywhere in the repo", health_hit)
    for (sev, check, detail), where in hits.items():
        add(sev, check, detail, where)
    return out


def cmd_sweep(quiet=False):
    findings = []
    for app in APPS:
        root = GITHUB_DIR / app["dir"] if app["dir"] else None
        if root and root.is_dir():
            findings += sweep_app(app, root)
    findings.sort(key=lambda f: (SWEEP_SEV.index(f["sev"]), f["app"], f["check"]))
    SWEEP_PATH.write_text(json.dumps({"at": time.time(), "findings": findings}, indent=1), encoding="utf-8")
    rows = "".join(
        f"<tr class='{f['sev']}'><td>{f['sev']}</td><td>{e(f['app'])}</td><td>{e(f['check'])}</td>"
        f"<td>{e(f['detail'])}</td><td class='w'>{e('; '.join(f['where']))}</td></tr>" for f in findings)
    SWEEP_REPORT.write_text(
        "<!doctype html><meta charset=utf-8><title>stable sweep</title><style>body{font:14px/1.5 system-ui;"
        "margin:24px;color:#161b26}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #dfe3ea;"
        "padding:5px 8px;vertical-align:top;text-align:left;font-size:13px}.w{font:11px ui-monospace,monospace;"
        "color:#5c6572}tr.secret td:first-child{color:#fff;background:#c1121f}tr.legal td:first-child{color:#c1121f}"
        "tr.privacy td:first-child{color:#9a6700}tr.tos td:first-child{color:#1d4ed8}tr.content td:first-child{color:#5c6572}"
        f"</style><h1>Stable sweep \u2014 {len(findings)} finding(s)</h1><p>{e(sweep_summary())}</p>"
        f"<p>Advisory: legal / ToS / privacy / PG-content review across every app repo. Generated "
        f"{e(time.strftime('%Y-%m-%d %H:%M'))}.</p><table><tr><th>sev</th><th>app</th><th>check</th>"
        f"<th>detail</th><th>where</th></tr>{rows}</table>", encoding="utf-8")
    if not quiet:
        for f in findings:
            if f["sev"] in ("secret", "legal", "privacy"):
                print(f"  {f['sev']:<8}{f['app']:<28}{f['check']:<16}{f['detail'][:70]}")
    print("sweep: " + sweep_summary())
    return findings


def sweep_summary():
    """One line from the cached sweep.json, e.g. '2 legal · 1 privacy · 9 tos · 31 content'."""
    if not SWEEP_PATH.exists():
        return "not run yet (python portal.py sweep)"
    d = json.loads(SWEEP_PATH.read_text(encoding="utf-8"))
    counts = {k: 0 for k in SWEEP_SEV}
    for f in d["findings"]:
        counts[f["sev"]] = counts.get(f["sev"], 0) + 1
    parts = [f"{n} {k}" for k, n in counts.items() if n] or ["clean"]
    return " \u00b7 ".join(parts) + f" \u2014 {fmt_age(d['at'])}, see {SWEEP_REPORT.name}"


def audit_site():
    redacted, leaks = [], []
    for p in sorted(SITE.rglob("*")):
        if not p.is_file() or ".git" in p.parts or p.suffix.lower() in {".png", ".ico"}:
            continue
        text = p.read_text(encoding="utf-8", errors="ignore")
        changed = False
        for rx, repl in REDACT:
            if rx.search(text):
                redacted.append(f"{p.name}: {rx.pattern[:20]}...")
                text = rx.sub(repl, text)
                changed = True
        if changed:
            p.write_text(text, encoding="utf-8")
        m = FORBID.search(text)
        if m:
            leaks.append(f"{p.relative_to(SITE)}: {m.group()[:24]}...")
    for r in redacted:
        print(f"  audit: REDACTED {r}")
    if leaks:
        sys.exit("audit: credential-shaped content found, NOT deploying:\n  "
                 + "\n  ".join(leaks))
    print(f"audit: site/ clean ({len(redacted)} redaction(s))")


def cmd_build(offline=False):
    if offline and DATA_PATH.exists():
        data = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    else:
        print(f"fetching live data for {len(APPS)} repos...")
        data = fetch_data()
        SITE.mkdir(exist_ok=True)
        DATA_PATH.write_text(json.dumps(data, indent=1), encoding="utf-8")
    out = write_site(data)
    audit_site()
    print(f"wrote {out} (+ portal/ pwa assets, root redirect + kill-switch, cowork.js, cowork/)")


def cmd_deploy(offline=False):
    cmd_sweep(quiet=True)       # advisory: legal / ToS / privacy / PG across the stable
    cmd_build(offline=offline)  # includes the exposure audit; a leak aborts before git
    def git(*args):
        r = subprocess.run(["git", "-C", str(SITE)] + list(args), capture_output=True,
                           text=True, encoding="utf-8", errors="replace")
        if r.returncode != 0:
            sys.exit(f"deploy: git {args[0]} failed:\n{r.stderr.strip()}")
        return r.stdout
    git("add", "-A")
    if not git("status", "--porcelain").strip():
        print("deploy: nothing changed, nothing to push")
        return
    git("commit", "-m", f"AE: portal update {time.strftime('%Y-%m-%d %H:%M')}\n\n"
        "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>\n"
        "Claude-Session: https://claude.ai/code/session_01G24qcutUGDibaCB8TopeeU")
    git("push", "origin", "main")
    print(f"deploy: pushed — live at https://{USER}.github.io/portal/ shortly")


def _git(d, *args):
    r = subprocess.run(["git", "-C", str(d)] + list(args), capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    return r.stdout.strip() if r.returncode == 0 else None


def _ci_state(slug):
    """Latest GitHub Actions conclusion for a repo: ok / FAIL / running / -."""
    r = subprocess.run(["gh", "run", "list", "-R", f"{USER}/{slug}", "--limit", "1", "--json", "status,conclusion"],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    try:
        runs = json.loads(r.stdout or "[]")
    except ValueError:
        runs = []
    if not runs:
        return "-"
    run = runs[0]
    if run.get("status") != "completed":
        return "running"
    return "ok" if run.get("conclusion") == "success" else (run.get("conclusion") or "?").upper()


def _live_state(url):
    """HTTP status of the published page, or the error name."""
    try:
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "portal.py"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            return str(resp.status)
    except urllib.error.HTTPError as ex:
        return str(ex.code)
    except Exception as ex:  # ponytail: a manager table, not a monitor
        return type(ex).__name__[:8]


def cmd_apps(quick=False):
    data = json.loads(DATA_PATH.read_text(encoding="utf-8")) if DATA_PATH.exists() else {}
    print(f"{'APP':<28} {'DIRTY':>5} {'UNPUSHED':>8} {'PUBLISHED':>10} {'CI':>8} {'LIVE':>5}  URL")
    for app in APPS:
        dirty = unpushed = "-"
        if app["dir"]:
            d = GITHUB_DIR / app["dir"]
            if (d / ".git").exists():
                st = _git(d, "status", "--porcelain")
                dirty = str(len(st.splitlines())) if st is not None else "?"
                unpushed = _git(d, "rev-list", "--count", "@{u}..HEAD") or "?"
        pushed = fmt_age(iso_ts(data.get(app["slug"], {}).get("pushed_at")))
        ci = "-" if quick else _ci_state(app["slug"])
        live = "-" if quick else _live_state(app_url(app))
        print(f"{app['title']:<28} {dirty:>5} {unpushed:>8} {pushed:>10} {ci:>8} {live:>5}  {app_url(app)}")
    if not data:
        print("\n(no portal-data.json yet — run `python portal.py build` for published dates)")
    print("sweep: " + sweep_summary())


def cmd_open(name):
    n = name.casefold()
    for app in APPS:
        if app["title"].casefold().startswith(n) or app["slug"].casefold().startswith(n):
            print(f"opening {app_url(app)}")
            webbrowser.open(app_url(app))
            return
    sys.exit(f"no app matches {name!r} — try one of: " + ", ".join(a["title"] for a in APPS))


def main(argv):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # cp1252 consoles vs · — ✓
    cmd = argv[0] if argv else "build"
    if cmd == "build":
        cmd_build(offline="--offline" in argv)
    elif cmd == "deploy":
        cmd_deploy(offline="--offline" in argv)
    elif cmd == "shots":
        cmd_shots()
    elif cmd == "apps":
        cmd_apps(quick="--quick" in argv)
    elif cmd == "sweep":
        cmd_sweep()
    elif cmd == "open" and len(argv) > 1:
        cmd_open(argv[1])
    else:
        sys.exit(__doc__.strip())


if __name__ == "__main__":
    main(sys.argv[1:])
