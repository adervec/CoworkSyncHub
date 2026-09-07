# CoworkSyncHub

One dispatcher for all the "AI cowork" folders my apps write. The apps drop a
JSON request + instructions into a folder and wait for an agent to write a JSON
reply back; this hub is that agent side, centralized: it scans every registered
folder, spawns Claude Code headless on each pending request, verifies the reply
landed, and writes a `status.html` dashboard.

Protocols spoken (see `COWORK-PROTOCOL.md` for the house standard):

- **cowork-manifest v1** — any folder with a `cowork.json` at its root. This is
  the standard: a new app = drop a `cowork.json`, zero hub code. The manifest
  wins over a dialect adapter when both apply.
- **gymtracker-cowork v1** (dialect) — GymTracker's AI export folder: 4 channels
  (`garmin-reconciliation`, `strava-reconciliation`, `plan-of-the-day`,
  `analysis`), reply goes to `<channel>/inbox/output-<ISO-date>.json`.
- **tachyread-journey v1** (dialect) — Tachyread's journey folder: reply goes to
  `journey-cowork-response.json`.

The hub **never** moves files between `inbox/` and `processed/` — the apps own
that. Agents echo the request envelope's `requestHash` in replies (the hub
rejects replies to stale requests) and may write `error-<date>.json` /
`<reply-stem>-error.json` with a reason when they can't complete a task.

## Setup

Needs Python 3.10+ and the `claude` CLI on PATH. No dependencies.

```
python coworkhub.py add gymtracker gymtracker "C:\path\to\GymTracker AI export"
python coworkhub.py add tachyread  tachyread  "C:\path\to\Tachyread journey folder"
```

## Commands

```
python coworkhub.py status                 # colored table + status.html dashboard
                                           # (per-app cards, run history, live filter, dark mode)
python coworkhub.py run [app] [--channel C] [--dry-run] [--force]
python coworkhub.py watch [--interval 300] # run on a loop, Ctrl-C to stop
python coworkhub.py check <folder>         # validate a folder against COWORK-PROTOCOL.md
python coworkhub.py serve [--port 8791]    # localhost web UI: view + run channels
python coworkhub.py sources [--fetch [NAME]] [--force]   # shared data sources (Garmin, Strava…)
python coworkhub.py log [--days 7] [--md|--json]          # sync-activity digest
python coworkhub.py brief daily|weekly [--print]          # a brief request the hub answers itself
```

**Step-by-step setup and troubleshooting for every connection — apps, hub, Garmin, Strava,
Drive, Bluetooth, the sync log and briefs — is in [SETUP.md](SETUP.md).**

### Shared data sources — fetch once, share with every app

A `"sources"` block in `hub-config.json` names a command per source (`{out}` = the file the hub
wants), a TTL, and which `app/channel` patterns receive it (a manifest channel can also say
`"sources": ["garmin"]`). On every sweep the hub fetches each needed source **once**, caches it
under `sources/<name>/latest.json`, and appends a `DATA SOURCES` paragraph to every prompt that
needs it: read this file, do not contact the service. A failed pull falls back to the last good
file and is logged. `run --refresh-sources` ignores the TTLs.

### Sync log + briefs

`sync-log.jsonl` gets one line per sweep / source fetch / dispatch (always on, nothing to
configure). `coworkhub.py log` prints the digest (`--md`, `--json`). `coworkhub.py brief daily`
writes `briefs/daily/request.json` from that digest and registers `briefs/` as an ordinary
manifest app, so the next sweep — or a scheduled one — has an agent write the brief to
`briefs/daily/reply.json`; `status.html` shows the latest brief.

A request is dispatched at most once, even if the run failed — `--force` is the
retry button. Per-run Claude output lands in `logs/`; every dispatch also
appends one line to `runs.jsonl` (append-only history). Sweeps are serialized
by `hub.lock` (stale locks are stolen after `timeout_sec` + 60 s). A pending
request older than `stale_days` (default 7) shows as STALE on the dashboard.

## Config (`hub-config.json`, machine-local, gitignored)

```json
{
  "claude_cmd": "claude",
  "claude_args": ["--permission-mode", "acceptEdits", "--max-turns", "40"],
  "timeout_sec": 900,
  "apps": [
    {"name": "gymtracker", "kind": "gymtracker", "root": "C:/.../GymTracker AI export"},
    {"name": "tachyread",  "kind": "tachyread",  "root": "C:/.../Tachyread journey"}
  ]
}
```

Note: GymTracker's garmin/strava channels tell the agent to run helper scripts
from the GymTracker repo, which `acceptEdits` won't permit. For those, extend
`claude_args` with `"--allowedTools", "Bash(python:*)"` (or, if you accept the
risk, `"--dangerously-skip-permissions"`).

## The shared cowork UI (`cowork.js`)

One implementation of the AI cowork sync panel, published at
<https://adervec.github.io/cowork.js> and loaded by every app, so the panel looks and
behaves the same no matter what the app around it looks like (shadow DOM; theme only
through `--cowork-*` custom properties). Two modes: `fs` drives a real folder through the
File System Access API (`cowork.mount(host, {app, manifest, files, apply})` is the whole
adoption for a new app); `mode="data"` is for apps that already drive their own folder and
for the hub — feed it `{app, channels, actions}` and listen for `cowork-action`. The state
words are the hub's own (idle / PENDING / answered / STALE). Docs + live demo:
<https://adervec.github.io/cowork>; browser self-test: `/cowork-selftest.html`.

All fifteen apps wear it: GymTracker, Tachyread and SpeechImprover in data mode around their own
folder logic; ChessRetabled, GuitarPicker, Mise, Handwriting Helper, MicroMiniger, Black Mirror
Bike Ride, Bodybuilding Progress Coach, Marksman, Run315, Learning Pit, Music Studio and The Long
Gallery in fs mode with a single `coach` channel — the data they already have (a brief, a report,
a cook log, scores, a paint queue, rides, body-comp + pose numbers, shot groups, training load,
review schedules, album prompts, what you've looked at; never photos) becomes
`coach/request.json`, the agent's `coach/reply.json` shows in-app. The portal itself has a
`review` channel. Every one of those folders is hub-ready: `coworkhub.py add`.

Two of the newcomers needed care. Music Studio already had a folder hand-off where an agent edits
`album.json` and the app live-reloads it; the panel writes only `cowork.json` and `coach/`, so the
two can never race. Learning Pit's kid mode returns before the panel renders, and its beacon is
suppressed under `?selftest` so a 400-assertion run doesn't invent a fortnight of studying.

`python coworkhub.py serve` serves `status.html` on localhost with the same panel per
registered app, and its buttons POST `/api/run` so channels can be run from the browser.
Opened as a plain file, the panels still show state; the buttons explain how to get control.
Served, the panels re-read the folders every 15 s and `/sweep` opens the latest stable sweep report.

## App portal (`portal.py`)

Manager / launcher / catalog for the apps published at `adervec.github.io/<repo>/`.
Per-app identity (tagline, features, badges) is curated in `APPS`; push dates and
recent changes are fetched from GitHub at build time.

The portal lives at **`/portal/`**, not the origin root: GitHub project pages share
the `adervec.github.io` origin, and a root-scoped installed PWA makes a phone treat
every sub-app as "already installed" (their install prompts vanish). The root now
serves a redirect to `/portal/` plus a kill-switch service worker that unregisters
the old root worker and clears only `portal-*` caches. (If the portal was installed
from the root era, uninstall that copy once and reinstall from `/portal/`.)

```
python portal.py build [--offline]   # writes site/portal/ + the root redirect (index, feed, manifest, icons, sw)
python portal.py deploy [--offline]  # build + exposure audit + commit + push (the ONLY way to publish)
python portal.py shots               # headless-Chrome screenshots into site/portal/shots/
python portal.py apps [--quick]      # manager table: dirty/unpushed, published age, CI, live HTTP status
python portal.py open <app>          # launch a published app in the browser
python portal.py sweep               # legal / ToS / privacy / PG sweep over every app repo
```

Every build runs a public-exposure audit over site/: local Windows paths and email
addresses are redacted in place; credential-shaped strings (API keys, tokens,
private keys) abort the deploy. `shots` captures each app's live page (800×500);
blank/near-blank captures are deleted rather than shipped, and only apps with a
good shot get a card banner. Every connected app's help/about surface links back
to the portal. The portal is an installable PWA (real PNG icons + install button).

**Tiles**: tap jumps to the app's card, **hold** (450 ms, with a fill animation)
launches it. Because every app is served from the same origin, each one writes its
slug into `localStorage["portal-installed"]` when it starts up in an installed
window; the portal reads that to mark tiles with a ✓ and to pick how to launch —
installed apps get a same-tab top-level navigation (the only thing the OS will hand
off to an installed PWA), everything else opens in a tab beside the portal. Entries
unrefreshed for 90 days stop counting, since nothing reports an uninstall.

**What's new since your last visit**: every change's timestamp ships to the page, so
a returning visitor gets a banner ("3 changes across 3 apps since your last visit, 9d
ago"), a dot on each updated tile, an accent border on those cards, and a **show me**
button that filters the grid down to just them. The stamp only advances when the banner
is dismissed, so a refresh doesn't wipe the markers away before they've been read.

**Stable sweep** (`python portal.py sweep`, also run by every `deploy`; the hub's `status`
prints the cached summary): an advisory legal / ToS / privacy / PG-content pass over every
app repo — missing LICENSE, trademarks in app names, health wording without a disclaimer,
bundled audio without credits, trackers, CORS proxies, third-party API hosts, brand
mentions, your own email or local paths in sources, credential shapes, and a word list for
profanity / adult / violence / substances / gambling / dark themes (bundled literature and
attribution files are skipped). Writes `sweep.json` + `sweep-report.html` (gitignored).
Never blocks a deploy — the only hard stop is the credential audit on `site/` itself.

**Character sheet**: every app appends `[unixSeconds, slug, kind, amount]` to the
same-origin `localStorage["portal-activity"]` when you actually do something (a set, a
section, a ride, a cook, a shot group, a run, a sitting, a generated track, a picture really
looked at — `amount` ≈ minutes ÷ 10). Only real work counts: Run315's public demo is a
synthetic athlete and reports nothing, and Learning Pit's selftest is excluded. The portal turns that into
STR / DEX / END / PSI / INT / CHR / VIT with a 14-day half-life, lists which app feeds which
stat, and reads habits off the last week vs the three before it (going strong / steady /
new this week / resting lately — worded so it never nags). Launch counts fill in until an
app reports real activity. Under the sheet: a radar of the seven stats, level-ups since the
previous day's snapshot, and a collapsible activity block — a 12-week heatmap coloured by each
day's busiest app, the fleet-wide streak, this week's total, your busiest weekday, and a
two-week journal. Each app card shows your own activity count for the month, and habits that
have a clear weekly rhythm say so ("GymTracker (Mon · Wed · Fri)"). Digit keys 1–0 launch the
tiles. All of it stays in the browser.

**Ask your coach**: the portal is a cowork app too. Below the sheet, the shared panel (fs mode)
drives a folder with one `review` channel — `review/request.json` carries the levels, sources,
habits with rhythm, streak, journal and launch counts; an agent's `review/reply.json`
(`{requestHash, reply}`) shows right there, so CoworkSyncHub can review your whole week across
every app. Register the folder with `coworkhub.py add portal manifest <path>`.

The portal page (live at <https://adervec.github.io/portal/>) shows each app's featureset,
recent changes, launch/install/download actions, a cross-app "recently shipped" log
with a 52-week fleet activity chart, per-app activity sparklines, an RSS feed of
shipped changes (`feed.xml`), a daily-rotating "app of the day", filtering (badge
shortcuts, `/` to focus), sorting, a theme toggle, and per-browser usage counts
(localStorage only — no analytics). The portal is itself an installable PWA
(manifest + service worker). `site/` is its own git repo pushed to
`adervec.github.io` — rebuild, commit, push to publish. Self-check: `python test_portal.py`.

## Test

```
python test_coworkhub.py   # prints OK; uses a stub claude, no API calls
```

To run `watch` unattended, a scheduled task works too:
`schtasks /Create /SC MINUTE /MO 15 /TN CoworkSyncHub /TR "python C:\...\coworkhub.py run"`
