# CoworkSyncHub — setup & troubleshooting, step by step

This is the long-form companion to `README.md`. It walks through every connection in the
system and what to do when one misbehaves:

1. [The hub itself](#1-the-hub-itself)
2. [Cowork connections, app by app](#2-cowork-connections-app-by-app)
3. [Troubleshooting cowork connections](#3-troubleshooting-cowork-connections)
4. [Data source connections (Garmin, Strava, Google Drive, Bluetooth, AI keys)](#4-data-source-connections)
5. [Troubleshooting data sources](#5-troubleshooting-data-sources)
6. [Fetch-once sources: one Garmin pull for every app](#6-fetch-once-sources)
7. [The sync log and daily / weekly briefs](#7-the-sync-log-and-briefs)
8. [Scheduling everything](#8-scheduling)

Vocabulary used throughout: an **app** writes a **request** into a **cowork folder** it owns; an
**agent** (Claude Code via the hub, Claude Desktop pointed at the folder, or you) writes a
**reply** next to it; the app imports the reply. The **hub** (`coworkhub.py`) is the agent side,
centralised. The **panel** is the shared `AI cowork sync` UI every app shows (it is the same
component everywhere, loaded from `https://adervec.github.io/cowork.js`). Panel **states** are
the hub's words: `idle` · `PENDING` · `answered` · `STALE` · `note`.

---

## 1. The hub itself

### 1.1 Install

1. Python 3.10+ on PATH (`python --version`). No pip packages are needed.
2. The Claude Code CLI on PATH: `claude --version`. If that fails, install it and **open a new
   terminal** (PATH changes don't reach an already-open shell).
3. Clone / open `CoworkSyncHub`. Run the self-checks once — both must print `OK`:
   ```
   python test_coworkhub.py
   python test_portal.py
   ```
4. First status: `python coworkhub.py status` — prints an empty table and writes `status.html`.
   Open `status.html` in a browser; it should say "all quiet".

### 1.2 Register a folder

Every cowork folder is registered once:

```
python coworkhub.py add <name> <kind> "<full path to the folder>"
```

- `<kind>` is `manifest` for any app that writes a `cowork.json` (all ten apps, the portal,
  and the hub's own briefs), `gymtracker` or `tachyread` for those two if you prefer their
  dialect adapter. **If the folder contains a `cowork.json`, the manifest adapter is used no
  matter what kind you typed.**
- Use the folder the app's panel shows in its header (`no folder connected` → connect one first).
- Verify: `python coworkhub.py check "<path>"` prints `PASS (manifest)` and a channel table. Any
  `warning:` lines list request files that don't exist yet (normal until the app sends once).

### 1.3 Run

- `python coworkhub.py status` — scan everything, table + `status.html`.
- `python coworkhub.py run` — dispatch Claude on every `PENDING` channel once. `run <app>`,
  `--channel <name>`, `--dry-run`, `--force` (re-answer even if answered), `--refresh-sources`.
- `python coworkhub.py watch --interval 300` — `run` in a loop.
- `python coworkhub.py serve` — the same status page on `http://127.0.0.1:8791/` where the panel
  buttons actually run channels; panels refresh every 15 s.

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
> 3. Register the folder with the hub once (`coworkhub.py add …`) and run `coworkhub.py run`
>    (or let `watch` / `serve` do it). The hub writes `<channel>/reply.json`.
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
| The portal (adervec.github.io/portal/) | "ask your coach" under the character sheet | fs | review | your cross-app week | under the panel |
| The hub's own briefs | `briefs/` next to `coworkhub.py` (see §7) | — | daily, weekly | the sync-log digest | `briefs/<period>/reply.json` + status.html |

**GymTracker specifics.** Its folder is the "AI export" folder (Settings › Cowork › *Pick folder*,
then *Write the hub once*). It writes `app-export.json` and a sub-folder per channel
(`garmin-reconciliation/`, …) with `context.json`, `INSTRUCTIONS.md`, `inbox/`, `processed/`.
Replies go to `<channel>/inbox/output-<date>.json`; the app moves consumed files to `processed/`.
The hub never moves files.

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

**Claude Desktop instead of the hub.** Point Claude Desktop (Cowork) at the same folder and ask it
to "read INSTRUCTIONS.md and answer the request". The app doesn't care who wrote the reply.

---

## 3. Troubleshooting cowork connections

Work top-down: **panel → folder → hub → reply → import**.

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
2. `python coworkhub.py check "<path>"` — `PASS` means the layout is valid. `FAIL` lines name
   the broken field (`exactly one of replyPath/replyDir required`, `request must be a non-empty
   list`…) — that's an app bug; report it with the manifest.
3. OneDrive / Dropbox / Drive-synced folders work but can create `request (1).json` conflict
   copies and hold files locked briefly. Prefer a local folder; if you must sync it, give the
   hub's `timeout_sec` some slack and don't run the hub on two machines at once.
4. Windows paths: quote them. Forward slashes are fine in `hub-config.json`.

### 3.3 The hub

| Symptom | Cause | Fix |
|---|---|---|
| `another sweep is running (hub.lock); skipping` | a previous run is still going, or died | wait; if `hub.lock` is older than `timeout_sec`+60 s it's stolen automatically; delete it by hand if a crash left it |
| `error: claude CLI not found (claude)` | not on PATH for *this* shell/task | `where claude`; set `claude_cmd` in `hub-config.json` to the full path |
| `error: timeout` | the agent ran past `timeout_sec` (900 s) | raise `timeout_sec`; check `logs/<app>-<channel>-<stamp>.log` for what it was doing |
| `error: no reply file appeared` | the agent finished but wrote nothing / wrote to the wrong place | read the log; for GymTracker the reply must land in `<channel>/inbox/output-<date>.json`; the prompt tells it exactly where |
| `error: reply invalid JSON` | reply file exists but isn't JSON | open it; usually prose or a trailing comma — re-run with `--force` |
| `error: reply for stale request` | the reply's `requestHash` ≠ the request's | the app re-sent while the agent was working; re-run |
| `error: agent reported: <reason>` | the agent wrote an `error-<date>.json` dead letter | the reason is the fix (missing data, unreadable instructions…) |
| `unsupported protocol` / `newer protocol version` (note state `-`) | manifest says something the hub doesn't speak | upgrade the hub; `protocolVersion` must be ≤ 1 |
| `folder missing` | the registered path doesn't exist | `hub-config.json` → fix the `root` |
| `unknown kind` | typo in `add` | re-add with `manifest` |
| `scan error: …` | a corrupt file in the folder | the message names it |
| Channel `PENDING` but `run` says `nothing to dispatch` | the hub already answered this exact request (it remembers the request hash) | change the request (Send again from the app) or `run --force` |
| `STALE` | pending for over `stale_days` (7) | the hub isn't running, or errors above |
| The permission prompt inside Claude blocks the run | GymTracker's garmin/strava channels ask the agent to run helper scripts | either configure the scripts as **shared sources** (§6 — recommended) or add `"--allowedTools", "Bash(python:*)"` to `claude_args` |

Always read the per-run log: `logs/<app>-<channel>-<timestamp>.log` holds the exact prompt and
everything the agent printed. `runs.jsonl` / `sync-log.jsonl` have one line per attempt.

### 3.4 The import

| Symptom | Fix |
|---|---|
| Panel says `answered` but nothing changed in the app | fs-mode apps import once per reply file — if you replaced the reply, its mtime must be newer than the request's; press **Check for replies** |
| GymTracker shows ⚠ on a channel | the ledger already consumed that file, or the envelope `kind` didn't match (`garmin-output` etc.); see the app's Cowork history |
| Tachyread "Could not parse that reply" | the reply isn't the JSON shape in `journey-instructions.md` — paste the error to the agent |
| Reply shows but is generic / ignores the data | the agent didn't read the instructions file — check the log; for shared sources confirm the `DATA SOURCES` paragraph appears in the prompt (§6) |

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
     Variables), or put them in the hub's source `env` block (`hub-config.json` is gitignored
     and machine-local; still, prefer env vars).
3. First run by hand: `py tools/garmin-sync.py 14 "C:\path\out\gymtracker-biometrics.json"`.
   If your account uses MFA you'll be prompted for the code — that's why the first run is by
   hand; the library caches the session afterwards.
4. Check the output: a JSON with `bodyComp` (weightKg, bodyFatPct, muscleMassKg, boneMassKg,
   bodyWaterPct per date) and `sleep`.
5. Wire it so the hub fetches it **once** for everyone — §6. (You can also still point
   GymTracker's *Biometrics Auto-Load* at the output folder; keep "biometrics" / "garmin" in
   the filename so the watcher recognises it.)

### 4.2 Strava (GymTracker activities; description push-back)

Official API, your own application, your own data.

1. Create an API application at <https://www.strava.com/settings/api>; **Authorization
   Callback Domain** = `localhost`. Note Client ID + Client Secret.
2. `py tools/strava-sync.py --auth` — opens the browser once, asks for read + write, stores a
   refresh token in `tools/strava-token.json` (gitignored; treat it like a password).
3. Pull: `py tools/strava-sync.py --days 30 --out "C:\path\out\strava-activities.json"`.
4. Push descriptions back (optional): generate the push file in GymTracker (Strava panel →
   *Generate Strava push file*), then `py tools/strava-sync.py --push strava-push.json`.
5. Wire it as a shared source — §6.

Limits: ~100 requests / 15 min and 1 000 / day per application; the pull is one request per
page of activities, so daily pulls are nowhere near them.

### 4.3 Google Drive sync (Tachyread, ChessRetabled, GuitarPicker, BMBR, SpeechImprover, Mise, Handwriting Helper, MicroMiniger)

Each app's Drive sync is its own: Settings → *Connect Google Drive* → Google's consent screen →
the app gets a private app folder. Data goes **Drive ↔ app**, never through the hub.
Tachyread / Mise note the origin rule: Drive sync only runs on the published site
(`adervec.github.io`) or a local dev server, not from a `file://` page.

### 4.4 Bluetooth trainer (Black Mirror Bike Ride)

Chrome/Edge desktop or Android; **Web Bluetooth needs HTTPS** (the published site) or
`localhost`. Pair from the ride screen; power + heart rate are read live, nothing is stored
by the hub.

### 4.5 AI keys (ChessRetabled, Tachyread, BPC "AI optional")

A pasted Anthropic key is held in memory only and only used when you send a message. It is the
*alternative* to the folder cowork, never required for it.

---

## 5. Troubleshooting data sources

### Garmin

| Symptom | Cause | Fix |
|---|---|---|
| `ModuleNotFoundError: garminconnect` | not installed for the Python the hub uses | `py -m pip install garminconnect` with the **same** interpreter (`where py`, `where python`) |
| Login fails / `401` / "Unauthorized" | wrong credentials, or Garmin changed the login flow | re-check env vars (no quotes in cmd `set`); `pip install -U garminconnect`; try once interactively |
| Asks for MFA every run | the session cache isn't persisting (different user / HOME between your shell and the scheduled task) | run once by hand **as the same Windows user** the task uses; or temporarily disable MFA-on-every-login in Garmin |
| `429 Too Many Requests` | Garmin rate-limited the unofficial endpoints | the hub's TTL is your friend: one pull per `ttl_min` (default 360) regardless of how many apps ask; don't schedule more often than hourly |
| Empty `bodyComp` | the scale didn't sync to Garmin Connect, or field names changed | check Garmin Connect web shows the weight; if it does, uncomment the debug line in the script and map the new key |
| Works by hand, fails from the hub | env vars not visible to the hub's process | put them in `sources.garmin.env` in `hub-config.json`, or set **user** env vars and restart the task |
| Hub log says `source garmin: FAILED … using stale cache` | the pull failed; the last good file was used | that's the designed fallback — fix the cause at your leisure; `python coworkhub.py sources --fetch garmin --force` to retry now |

### Strava

| Symptom | Cause | Fix |
|---|---|---|
| `--auth` opens the browser but the redirect fails | callback domain isn't `localhost`, or port 8723 is busy | fix the Strava app settings; free the port |
| `401 invalid_grant` / `refresh token invalid` | Strava rotated the token and the file wasn't updated, or you deauthorised the app | `--auth` again |
| `403 … scope` on push | authorised read-only | `--auth` again and accept write |
| `429` | rate limit | wait 15 min; raise the source TTL |
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

---

## 6. Fetch-once sources

The hub can run each data-source script **once per sweep** and hand the resulting file to every
channel that needs it, so Garmin (or Strava, or anything) is never hit once per app.

### 6.1 Configure

`hub-config.json` (machine-local, gitignored):

```json
{
  "claude_cmd": "claude",
  "timeout_sec": 900,
  "apps": [ ... ],
  "sources": {
    "garmin": {
      "cmd": ["py", "C:/Users/you/Documents/GitHub/GymTracker/tools/garmin-sync.py", "14", "{out}"],
      "ttl_min": 360,
      "channels": ["gymtracker/garmin-*", "bpc/*"],
      "env": { "GARMIN_EMAIL": "you@example.com" }
    },
    "strava": {
      "cmd": ["py", "C:/Users/you/Documents/GitHub/GymTracker/tools/strava-sync.py", "--days", "30", "--out", "{out}"],
      "ttl_min": 120,
      "channels": ["gymtracker/strava-*"]
    }
  }
}
```

- `cmd` — the command; `{out}` is replaced by the file the hub wants written
  (`sources/<name>/<timestamp>.json`). The command must write that file and exit 0.
- `ttl_min` — how long a pull stays fresh. Within the TTL the hub reuses `latest.json` and
  logs a *cache hit*; the service is not contacted.
- `channels` — `app/channel` patterns (wildcards OK) that receive this source. A manifest
  channel can also ask for it itself: `"sources": ["garmin"]` in its `cowork.json` entry.
- `env` — extra environment for the command (optional). `cwd`, `timeout_sec` are also accepted.

### 6.2 What happens on a sweep

1. `coworkhub.py run` decides which channels to dispatch.
2. It collects the sources those channels need and fetches **each one once** (or reuses a
   fresh cache). Output: `sources/<name>/latest.json` (+ a dated copy; the last 30 are kept).
3. Every dispatched prompt for a channel that needs a source gets a `DATA SOURCES` paragraph:
   *"the hub fetched these once for every app this sweep. Read these files; do NOT contact the
   services or run any sync script yourself"* — with the absolute path and the cache age.
4. A failed fetch falls back to the last good file (the prompt says `STALE cache`), and if
   there is none, the prompt says so explicitly, so the agent reports it instead of improvising.

### 6.3 Verify

```
python coworkhub.py sources                  # table: TTL, age of latest.json, size
python coworkhub.py sources --fetch garmin   # pull now (respects TTL)
python coworkhub.py sources --fetch --force  # pull everything, ignore TTL
python coworkhub.py run --refresh-sources    # one sweep with fresh pulls
python coworkhub.py log                      # "sources: garmin: fetched 1× · cache hits 4 · errors 0"
```

Open a dispatch log under `logs/` and confirm the `DATA SOURCES` paragraph is there.

---

## 7. The sync log and briefs

### 7.1 The log

`sync-log.jsonl` (next to `coworkhub.py`, gitignored) gets **one JSON line per event**, always
with `ts` and `kind`:

| kind | fields |
|---|---|
| `sweep` | `channels`, `pending`, `apps` |
| `source` | `source`, `result` = `ok` / `cache` / `error`, `duration_sec`, `file` or `detail` / `age_sec` |
| `dispatch` | `app`, `channel`, `result` (`ok` or `error: …`), `duration_sec`, `log` (file in `logs/`) |
| `brief` | `period`, `events` |

Nothing to configure — it's always on. It's plain JSONL, so anything can harvest it:
`python coworkhub.py log --days 7` (text), `--md` (markdown), `--json` (the digest object),
`Get-Content sync-log.jsonl -Tail 50`, a spreadsheet, or an agent.

### 7.2 Briefs — a cowork channel the hub answers itself

```
python coworkhub.py brief daily     # or weekly
```

writes `briefs/cowork.json`, `briefs/daily/request.json` (the digest + the raw events of the
period, with a `requestHash`) and `briefs/daily/INSTRUCTIONS.md` (what the brief should contain:
health verdict, what ran per app, failures with the most likely fix, what needs a human; under
250 words). On first use it **registers `briefs/` as an app** named `briefs`. From then on it is
an ordinary channel: `coworkhub.py run briefs` (or `watch`) dispatches an agent, and the brief
lands in `briefs/daily/reply.json`. `brief daily --print` shows the latest one;
`status.html` shows it in a *Latest daily brief* card; `serve` exposes `/log` and `/api/log`.

Claude Desktop works too: point it at `briefs/` and ask for the daily brief.

---

## 8. Scheduling

Windows Task Scheduler (run as your user so env vars and Garmin's session cache are yours):

```
schtasks /Create /SC MINUTE /MO 15 /TN "CoworkSyncHub run" ^
  /TR "python C:\path\CoworkSyncHub\coworkhub.py run"

schtasks /Create /SC DAILY /ST 07:00 /TN "CoworkSyncHub daily brief" ^
  /TR "cmd /c python C:\path\CoworkSyncHub\coworkhub.py brief daily && python C:\path\CoworkSyncHub\coworkhub.py run briefs --channel daily"

schtasks /Create /SC WEEKLY /D MON /ST 07:30 /TN "CoworkSyncHub weekly brief" ^
  /TR "cmd /c python C:\path\CoworkSyncHub\coworkhub.py brief weekly && python C:\path\CoworkSyncHub\coworkhub.py run briefs --channel weekly"
```

Or simply keep `python coworkhub.py watch --interval 300` running in a terminal; briefs still
need the `brief` command on a schedule (it only *writes the request*; the next sweep answers it).

Checklist when a scheduled run "does nothing": same Windows user as the interactive run ·
`claude` resolvable from that task (use the full path in `claude_cmd`) · env vars are **user**
variables, not session ones · `hub.lock` not left behind · look at `sync-log.jsonl` first, then
`logs/`.
