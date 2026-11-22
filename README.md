# CoworkSyncHub

Three things that tie my apps together:

- **`runner.py`** — the AI runner on the reader's own computer: answers the apps' AI cowork requests,
  feeds Garmin and Strava to every app once, and writes the daily brief the hub shows. Setup: [RUNNER.md](RUNNER.md).
- **`cowork.js`** + `COWORK-PROTOCOL.md` — the shared AI cowork panel every app shows, and its protocol.
  Requests and replies live in the reader's own cloud folder.
- **`font.js`** — the house font and everything every app shares: themes, languages, the About panel,
  backup, the reader's cloud (`appFont.cloud`, with safe sync), the session ledger.
- **`portal.py`** — the generator for the app portal at <https://adervec.github.io/portal/>.

The local morning dashboard (`coworkhub.py`) and the folder method are retired: see [archive/](archive/).

## The shared cowork UI (`cowork.js`)

One implementation of the AI cowork sync panel, published at
<https://adervec.github.io/cowork.js> and loaded by every app, so the panel looks and
behaves the same no matter what the app around it looks like (shadow DOM; theme only
through `--cowork-*` custom properties). Two modes: `fs` drives the app's cowork files in the
reader's cloud folder, answered by the AI runner (`cowork.mount(host, {app, manifest, files, apply})` is the
whole adoption for a new app; the old folder-on-disk transport is retired); `mode="data"` is for apps with their own engine — feed it `{app, channels, actions}` and listen for `cowork-action`. The state
words are the hub's own (idle / PENDING / answered / STALE). Docs + live demo:
<https://adervec.github.io/cowork>; browser self-test: `/cowork-selftest.html`.

Sixteen apps wear it: GymTracker, Tachyread and SpeechImprover in data mode around their own
engines (moving those engines from a folder to the cloud is on each app's list); ChessRetabled, GuitarPicker, Mise, Handwriting Helper, MicroMiniger, Black Mirror
Bike Ride, Bodybuilding Progress Coach, Marksman, Run315, Learning Pit, Music Studio, The Long
Gallery and The Classical Journey in fs mode with a single `coach` channel — the data they
already have (a brief, a report, a cook log, scores, a paint queue, rides, body-comp + pose
numbers, shot groups, training load, review schedules, album prompts, what you've looked at,
what you've listened to; never photos) becomes `coach/request.json`, and the agent's
`coach/reply.json` shows in-app. The portal itself has a
`review` channel.

Two of the newcomers needed care. Music Studio already had a folder hand-off where an agent edits
`album.json` and the app live-reloads it; the panel writes only `cowork.json` and `coach/`, so the
two can never race. Learning Pit's kid mode returns before the panel renders, and its beacon is
suppressed under `?selftest` so a 400-assertion run doesn't invent a fortnight of studying.

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

**Stable sweep** (`python portal.py sweep`, also run by every `deploy`): an advisory legal / ToS / privacy / PG-content pass over every
app repo — missing LICENSE, trademarks in app names, health wording without a disclaimer,
bundled audio without credits, trackers, CORS proxies, third-party API hosts, brand
mentions, your own email or local paths in sources, credential shapes, and a word list for
profanity / adult / violence / substances / gambling / dark themes (bundled literature and
attribution files are skipped). Writes `sweep.json` + `sweep-report.html` (gitignored).
Never blocks a deploy — the only hard stop is the credential audit on `site/` itself.

**Character sheet**: every app appends `[unixSeconds, slug, kind, amount]` to the
same-origin `localStorage["portal-activity"]` when you actually do something (a set, a
section, a ride, a cook, a shot group, a run, a sitting, a generated track, a picture really
looked at, a piece heard — `amount` ≈ minutes ÷ 10). Only real work counts: Run315's public demo is a
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
(`{requestHash, reply}`) shows right there, so an agent can review your whole week across
every app.

The portal page (live at <https://adervec.github.io/portal/>) shows each app's featureset,
recent changes, launch/install/download actions, a cross-app "recently shipped" log
with a 52-week fleet activity chart, per-app activity sparklines, an RSS feed of
shipped changes (`feed.xml`), a daily-rotating "app of the day", filtering (badge
shortcuts, `/` to focus), sorting, a theme toggle, and per-browser usage counts
(localStorage only — no analytics). The portal is itself an installable PWA
(manifest + service worker). `site/` is its own git repo pushed to
`adervec.github.io` — rebuild, commit, push to publish. Self-check: `python test_portal.py`.
