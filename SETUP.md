# CoworkSyncHub — setup & troubleshooting, step by step

This is the long-form companion to `README.md`. It walks through every connection in the
system and what to do when one misbehaves:

1. [The briefs folder](#1-the-briefs-folder)
2. [Cowork connections, app by app](#2-cowork-connections-app-by-app)
3. [Troubleshooting cowork connections](#3-troubleshooting-cowork-connections)
4. [Data source connections (Garmin, Strava, Google Drive, Bluetooth, AI keys)](#4-data-source-connections)
5. [Troubleshooting data sources](#5-troubleshooting-data-sources)

Vocabulary used throughout: an **app** writes a **request** into a **cowork folder** it owns; an
**agent** (Claude Cowork or Claude Code pointed at the folder, or you) writes a
**reply** next to it; the app imports the reply. The **hub** (`coworkhub.py`) only displays the briefs the
agent writes (§1). The **panel** is the shared `AI cowork sync` UI every app shows (it is the same
component everywhere, loaded from `https://adervec.github.io/cowork.js`). Panel **states** are
`idle` · `PENDING` · `answered` · `STALE` · `note`.

---

## 1. The briefs folder

The hub no longer dispatches anything. An agent writes one brief a day into a folder, the apps
keep their own `BRIEF.md` current in their link folders, and `coworkhub.py` shows both.

1. Python 3.9+ on PATH. No pip packages. `python test_coworkhub.py` and
   `python test_portal.py` must both print `OK`.
2. `python coworkhub.py` opens `http://127.0.0.1:8791/`. It reads
   `~/Documents/Cowork/MorningBrief` and `~/Documents/Cowork/Cowork Link Folders` when they exist;
   otherwise pass them: `python coworkhub.py "D:/briefs" --apps "D:/link folders"`. First run drops
   `INSTRUCTIONS.md` (the brief format) into the briefs folder.
3. Give the scheduled agent write access to the briefs folder and have it write `YYYY-MM-DD.md`
   in that format. The hub needs no scheduling.
4. In each app, connect its "Morning brief" / cowork folder to its own sub-folder of the apps
   folder so the app keeps `BRIEF.md` there.
5. Reload the page to see what landed.

| Symptom | Cause | Fix |
|---|---|---|
| Banner: *Today's brief hasn't landed* | the agent has not run, or wrote elsewhere / without a date in the file name | check the task ran; the file must be `YYYY-MM-DD.md` in the briefs folder |
| One big tile instead of a grid | the brief has no `## ` sections | have the agent follow `INSTRUCTIONS.md` |
| A tile is a wall of text | depth was written before the first `### ` | move it under `### ` headings |
| An app row says *stale* | Chrome dropped the app's folder grant after a restart, or the app was not opened | open the app once and re-grant the folder |
| An app row says *nothing written here yet* | the app was never connected to that folder | connect it from the app's cowork / morning-brief panel |
| Port in use | another copy is running | `--port 8792` |

---

## 2. Cowork connections, app by app

Every app follows the same four steps. **Chrome or Edge on desktop** is required for the
folder steps (the File System Access API); Firefox and Safari can't open folders for writing.

> **The four steps**
> 1. Open the app's panel (locations below). Press **Connect folder**, pick (or create) an
>    empty folder, accept the browser's "let site edit files?" prompt. The panel header now
>    shows the folder name.
> 2. Press **Send requests** (fs-mode apps do this automatically on connect). The panel's
>    channel rows turn `PENDING`. The folder now contains `cowork.json` plus the channel's
>    `request.json` / `INSTRUCTIONS.md`.
> 3. Point your agent at the folder ("read INSTRUCTIONS.md and answer the request"). It writes
>    `<channel>/reply.json`.
> 4. Back in the app press **Check for replies** (or just focus the tab — fs-mode panels
>    re-check on focus). The row turns `answered` and the reply shows in-app.

| App | Where the panel lives | Mode | Channel(s) | What's sent | Where the reply shows |
|---|---|---|---|---|---|
| GymTracker | Analysis page (push/poll row) — needs **Settings › Cowork › enabled** | data (app drives its own folder) | garmin-reconciliation, strava-reconciliation, plan-of-the-day, analysis | `app-export.json` + per-channel `context.json` | imported into the app's data (biometrics, Strava links, plans, answers) |
| Tachyread | Literary Journey → **AI / Cowork** tab (Ctrl+H opens the dialog) | data | journey | reading dataset + the checked actions | applied to the journey (recs, tree, graph) |
| SpeechImprover | **Cowork sync** page | data | coach, program | recent practice | Coach feedback card; a program reply starts a daily program |
| ChessRetabled | **AI Coach** page → "Folder cowork" | fs | coach | the coaching brief | "Coach's reply" under the panel |
| GuitarPicker | **Progress** view (under the toolbar) — currently on the `dev` branch | fs | coach | the practice report | under the panel |
| Mise | **Settings › Cook log** | fs | coach | the cook log | under the panel |
| Handwriting Helper | **Progress › Coach** card | fs | coach | stats + last 30 sessions | in the card |
| MicroMiniger | `?` help dialog → Coach | fs | coach | collection + paint-queue counts | under the panel |
| Black Mirror Bike Ride | **History & PBs** screen (bottom) | fs | coach | last 40 rides (numbers) | under the panel |
| Bodybuilding Progress Coach | **Dashboard** (bottom) | fs | coach | body comp + pose scores — never photos | under the panel |
| Marksman | **Home › Coach** card | fs | coach | tiers, plan, goals, last 30 sessions | in the card |
| Run315 | **Dashboard** → "Cowork with an agent", under the server-side Coach review | fs | coach | fitness numbers, last 15 activities, race calendar | under the panel |
| Learning Pit | **Progress › Ask a tutor** (grown-up profiles only — kid mode has no panel) | fs | coach | streak, mastery, forecast, sittings, sticking points | under the panel |
| Music Studio | **🤝 Cowork** in the top bar | fs | coach | albums, briefs, prompts, which tracks are still gaps | in the dialog |
| The Long Gallery | **Progress → "A second opinion"** | fs | coach | what you've seen/rated/noted + major works missed | under the panel |
| The Classical Journey | **Progress → "Ask for a programme"** | fs | coach | what you've heard/loved/noted + landmarks missed | under the panel |
| The portal (adervec.github.io/portal/) | "ask your coach" under the character sheet | fs | review | your cross-app week | under the panel |

**GymTracker specifics.** Its folder is the "AI export" folder (Settings › Cowork › *Pick folder*,
then *Write the hub once*). It writes `app-export.json` and a sub-folder per channel
(`garmin-reconciliation/`, …) with `context.json`, `INSTRUCTIONS.md`, `inbox/`, `processed/`.
Replies go to `<channel>/inbox/output-<date>.json`; the app moves consumed files to `processed/`.
The agent never moves files.

**Tachyread specifics.** Tick the actions you want in the tree, then **Send requests** (or
*Run selected*). One request = one instruction; *heavy* actions send the whole library.

**Music Studio specifics.** It has *two* folder channels and they are not the same thing. The
older one is the album-design hand-off described in the backup folder's own `AGENT.md`, where an
agent edits `album.json` and the app live-reloads it. The cowork panel is separate: it writes only
`cowork.json` and `coach/`, so the two can never race on the same file. Point the panel at any
scratch folder, or at the backup folder — either is safe.

**Run315 specifics.** The dashboard also has an older **Coach review** button; that one is
server-side, needs `ANTHROPIC_API_KEY` in the environment, and is switched off on the public
demo. The cowork panel below it needs neither a key nor a server, so on
`adervec.github.io/Run315/` it is the coaching path that actually works.
A "sync machine" can be designated — other devices then only watch.

---

## 3. Troubleshooting cowork connections

Work top-down: **panel → folder → reply → import**.

### 3.1 The panel

| Symptom | Cause | Fix |
|---|---|---|
| No panel, the app shows plain buttons / old cards instead | `cowork.js` couldn't load (offline first run, or an ad/script blocker on `adervec.github.io`) | Go online once, reload. The fallback buttons do the same job meanwhile. |
| Panel missing only in MicroMiniger | its strict CSP | fixed (`script-src` allows the portal) — hard-refresh once (Ctrl+F5) |
| "Connect folder" does nothing / error *this browser can't open folders* | Firefox/Safari/mobile | use Chrome or Edge on desktop (the manual flow in SpeechImprover works anywhere) |
| `folder needs re-connecting` | the browser dropped write permission (new session, cleared site data, moved folder) | press **Connect folder** again and pick the same folder |
| `nothing asked yet` forever after pressing Send | the app had nothing to send (e.g. SpeechImprover with no recordings, GuitarPicker with no sessions) | do something in the app first |
| Panel looks light inside a dark app | by design — it follows the OS theme, not the app's | set `theme="dark"` on `<cowork-panel>` if you really want it matched |
| Tachyread went blank white / app crashed | an old cached `cowork.js` vs React (fixed 2026-08-22) | hard refresh; if it recurs, check the console for `Cannot set property mode` |

### 3.2 The folder

1. Open the folder in Explorer. You should see `cowork.json` and `<channel>/request.json`
   (+ `INSTRUCTIONS.md`). If not, the Send didn't happen — go back to the panel.
2. OneDrive / Dropbox / Drive-synced folders work but can create `request (1).json` conflict
   copies and hold files locked briefly. Prefer a local folder.

### 3.3 The import

| Symptom | Fix |
|---|---|
| Panel says `answered` but nothing changed in the app | fs-mode apps import once per reply file — if you replaced the reply, its mtime must be newer than the request's; press **Check for replies** |
| GymTracker shows ⚠ on a channel | the ledger already consumed that file, or the envelope `kind` didn't match (`garmin-output` etc.); see the app's Cowork history |
| Tachyread "Could not parse that reply" | the reply isn't the JSON shape in `journey-instructions.md` — paste the error to the agent |
| Reply shows but is generic / ignores the data | the agent didn't read the instructions file — tell it to start there |

---

## 4. Data source connections

"Data sources" are the external services an app's data comes from. The apps are browser
apps with no server, so every source arrives as a **file written by a local script** (Garmin,
Strava), a **browser permission** (Bluetooth, Drive), or a **key you paste** (AI chat).

### 4.1 Garmin (GymTracker biometrics; any app that wants body comp)

Garmin has no public per-user read API. `GymTracker/tools/garmin-sync.py` logs in with your
credentials via the community `garminconnect` library and writes a small JSON. That's
unofficial — your own data only, at your own risk, and it can break when Garmin changes.

1. `py -m pip install garminconnect` (once).
2. Credentials as environment variables (never in a file that could be committed):
   - PowerShell: `$env:GARMIN_EMAIL="you@example.com"; $env:GARMIN_PASSWORD="…"`
   - cmd: `set GARMIN_EMAIL=…` / `set GARMIN_PASSWORD=…`
   - For scheduled runs set them as **user** environment variables (System → Environment
     Variables).
3. First run by hand: `py tools/garmin-sync.py 14 "C:\path\out\gymtracker-biometrics.json"`.
   If your account uses MFA you'll be prompted for the code — that's why the first run is by
   hand; the library caches the session afterwards.
4. Check the output: a JSON with `bodyComp` (weightKg, bodyFatPct, muscleMassKg, boneMassKg,
   bodyWaterPct per date) and `sleep`.
5. Point GymTracker's *Biometrics Auto-Load* at the output folder; keep "biometrics" /
   "garmin" in the filename so the watcher recognises it.

### 4.2 Strava (GymTracker activities; description push-back)

Official API, your own application, your own data.

1. Create an API application at <https://www.strava.com/settings/api>; **Authorization
   Callback Domain** = `localhost`. Note Client ID + Client Secret.
2. `py tools/strava-sync.py --auth` — opens the browser once, asks for read + write, stores a
   refresh token in `tools/strava-token.json` (gitignored; treat it like a password).
3. Pull: `py tools/strava-sync.py --days 30 --out "C:\path\out\strava-activities.json"`.
4. Push descriptions back (optional): generate the push file in GymTracker (Strava panel →
   *Generate Strava push file*), then `py tools/strava-sync.py --push strava-push.json`.
Limits: ~100 requests / 15 min and 1 000 / day per application; the pull is one request per
page of activities, so daily pulls are nowhere near them.

### 4.3 Google Drive sync (Tachyread, ChessRetabled, GuitarPicker, BMBR, SpeechImprover, Mise, Handwriting Helper, MicroMiniger)

Each app's Drive sync is its own: Settings → *Connect Google Drive* → Google's consent screen →
the app gets a private app folder. Data goes **Drive ↔ app** only.
Tachyread / Mise note the origin rule: Drive sync only runs on the published site
(`adervec.github.io`) or a local dev server, not from a `file://` page.

### 4.4 Bluetooth trainer (Black Mirror Bike Ride)

Chrome/Edge desktop or Android; **Web Bluetooth needs HTTPS** (the published site) or
`localhost`. Pair from the ride screen; power + heart rate are read live, nothing is stored
outside the app.

### 4.5 AI keys (ChessRetabled, Tachyread, BPC "AI optional")

A pasted Anthropic key is held in memory only and only used when you send a message. It is the
*alternative* to the folder cowork, never required for it.

---

## 5. Troubleshooting data sources

### Garmin

| Symptom | Cause | Fix |
|---|---|---|
| `ModuleNotFoundError: garminconnect` | not installed for the Python that runs the script | `py -m pip install garminconnect` with the **same** interpreter (`where py`, `where python`) |
| Login fails / `401` / "Unauthorized" | wrong credentials, or Garmin changed the login flow | re-check env vars (no quotes in cmd `set`); `pip install -U garminconnect`; try once interactively |
| Asks for MFA every run | the session cache isn't persisting (different user / HOME between your shell and the scheduled task) | run once by hand **as the same Windows user** the task uses; or temporarily disable MFA-on-every-login in Garmin |
| `429 Too Many Requests` | Garmin rate-limited the unofficial endpoints | don't schedule more often than hourly |
| Empty `bodyComp` | the scale didn't sync to Garmin Connect, or field names changed | check Garmin Connect web shows the weight; if it does, uncomment the debug line in the script and map the new key |

### Strava

| Symptom | Cause | Fix |
|---|---|---|
| `--auth` opens the browser but the redirect fails | callback domain isn't `localhost`, or port 8723 is busy | fix the Strava app settings; free the port |
| `401 invalid_grant` / `refresh token invalid` | Strava rotated the token and the file wasn't updated, or you deauthorised the app | `--auth` again |
| `403 … scope` on push | authorised read-only | `--auth` again and accept write |
| `429` | rate limit | wait 15 min; pull less often |
| Activities don't link in GymTracker | start times differ by more than the matching window | reconcile by hand once in the Strava panel; the next pull links by id |

### Google Drive

| Symptom | Fix |
|---|---|
| "Drive sync only runs on the published site" | you're on `file://` — use `https://adervec.github.io/<App>/` or a local dev server |
| Consent screen says the app is unverified | it's a personal app; *Advanced → continue* is expected |
| Two devices overwrite each other | designate one sync machine (Tachyread) / sync less aggressively; the apps merge, they don't blindly overwrite |

### Bluetooth

| Symptom | Fix |
|---|---|
| No device in the picker | trainer already connected to another app (Zwift, the Garmin app) — disconnect it there; HTTPS required |
| Power but no HR | the HR strap is a separate device — pair it too |
