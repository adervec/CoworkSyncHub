# House standards

Every app on the portal (`portal.py` APPS) meets these. They are the maker's decisions, not
suggestions: keep them when you change an app, and do not "fix" one away. Check any app with

```
node ../CoworkSyncHub/standards.mjs <app> -v      # from the GitHub folder: node CoworkSyncHub/standards.mjs
```

and keep it all `ok` before you push. The checker reads source, so it can be fooled; when it is
wrong, fix the rule in `standards.mjs` rather than working around it.

## Shared pieces: use them, don't rebuild them

- **`https://adervec.github.io/font.js`**: load it in `<head>` (not deferred). It gives the house
  font, the font picker, the "Allow pinch-zoom" option (off by default), reduced motion, a focus
  ring, storage persistence, the build stamp, the update notice, the crash notice, the About panel,
  what's new, diagnostics, and the offline pill. Body text uses `var(--app-font, <old stack>)`, and
  `<app-font-picker></app-font-picker>` goes in settings (it brings the build stamp and About panel).
  Describe the app with optional meta tags: `app-name`, `app-version`, `app-whatsnew`,
  `app-license`, `app-source`, `app-data-note`.
- **`https://adervec.github.io/cowork.js`**: the shared cowork panel, plus a `cowork.json` manifest.
- **`https://adervec.github.io/fonts/<family>.css`**: self-hosted Fraunces, Newsreader, Source Serif 4,
  Archivo, JetBrains Mono, Inter Tight, IBM Plex Mono/Sans, Andika, Cedarville Cursive, Atkinson.
- **After every deploy**, `adervec/CoworkSyncHub/.github/workflows/after-deploy.yml` checks the live
  site and tags the release `deploy-YYYYMMDD-HHMM`.

## The standards

1. **Drive sync** to the private app folder (`drive.appdata`), and while synced the Google **profile
   picture is always visible in the app's top bar**, on every screen, like YouTube's corner avatar,
   not only in settings. Use font.js: put `<app-account></app-account>` in the header and call
   `appFont.setAccount({ name, email, picture })` after sign-in (`setAccount(null)` on sign-out);
   handle `app-account-click` to open the sync settings. An app's own always-visible header avatar
   (GymTracker's banner, a header sync chip with the picture) also meets it.
2. **House font**: Atkinson Hyperlegible by default, reader-changeable (font.js).
3. **Cowork** (the GymTracker / Tachyread style): named channels, each with fixed request files,
   instructions and a reply format, declared in a `cowork.json` manifest; a schedule per channel
   that runs only on the ONE sync device; replies checked automatically; a run history; and replies
   that can never do more than asked: a fingerprint (`requestHash`) the reply must echo, never
   applied twice, archived to `processed/`, and an error file when the agent cannot do the job.
   **Review before applying is the default**, and can be switched off per channel. A reviewed
   change should be undoable. The shared `cowork.js` (v2) does all of this: pass `channels` with
   `label`, `schedule`, `review`, `preview(reply)` (rows to tick), `apply(reply, acceptedIds)` (return
   `{ summary, undo }`) and `undo(data)`, plus an optional `brief()` for BRIEF.md. An app with its own
   engine (GymTracker, Tachyread) must provide the same guarantees.
4. **Licence and legal**: a `LICENSE` (MIT unless there is a reason); `THIRD-PARTY-NOTICES.md` for any
   bundled third-party code or fonts; an in-app note on where the data lives.
5. **CI on every push** that runs the app's checks.
6. **Data safety**: export, import, and an "Erase everything" that removes ONLY this app's keys and
   databases, because every app shares the adervec.github.io origin. Never call `localStorage.clear()`.
   Ask the browser to keep storage (font.js does it).
7. **Deploys gated on tests**: nothing reaches the live site unless the checks passed, and the live
   site is checked and tagged after every deploy.
8. **No third-party requests**: scripts, styles and fonts come from adervec.github.io. Approved
   exceptions: Google sign-in for Drive, map tiles, Tachyread's add-a-Google-font loader, and large
   libraries (MediaPipe, Tesseract, pdf.js, Pyodide) where bundling is impractical.
9. **Updates are visible**: the build is shown in settings, the reader is told when a new version is
   ready, and **what's new** appears once after an update. Keep `whatsnew.json` (newest first:
   `[{ "date": "YYYY-MM-DD", "items": ["…"] }]`) for user-visible changes, written for the reader,
   not the developer, and declare it with `<meta name="app-whatsnew" content="whatsnew.json">`.
   Readers can silence it.
10. **Local-day dates**: a calendar day is the user's LOCAL day. Never take a day from
    `toISOString().slice(0, 10)` or parse a bare `YYYY-MM-DD` with `new Date(str)`; use a local
    Y-M-D helper and read a stored day back as `str + 'T00:00:00'`. Tests that depend on the day pin
    the clock and time zone. File-name stamps are exempt.
11. **Branch model** (GymTracker's): work directly on `main`. CI runs on every push, and the deploy
    publishes only after the checks pass. Short-lived `feat/` branches are fine; no dev or master.
12. **Accessibility floor** (font.js): zoom is a reader option, off by default; reduced motion and a
    visible focus ring always.
13. **Crashes are shown, not swallowed** (font.js), with Reload, Details and Copy diagnostics.
14. **Default theme follows the device**: when the reader has NOT chosen a theme, start from the
    system light/dark preference (`appFont.systemTheme()` or `prefers-color-scheme`). A saved choice
    always wins; never override it.
15. **About this app** (font.js `<app-about>`): version, licence, where data lives, storage, source,
    what's new, diagnostics.
16. **Offline and storage are visible** (font.js): an offline pill, and storage use in About.
18. **AI review of graded sessions**: wherever the app grades something robust by algorithm at the
    session level (a workout, a speech sitting, a typing run, a practice run, a scored sheet, a game,
    a check-in, a study session, a run or ride; never every few seconds of activity), it also offers
    a cowork channel that grades the same session in a beefier way with AI. The pattern
    (GymTracker's `workout-review`): a `<thing>-review` channel whose request carries the sessions
    completed since the last review, each with the raw detail needed to grade it plus the app's own
    score and its breakdown, and recent history for trend; the instructions spell out the rubric; the
    reply is `{ requestHash, reviews: [{ sessionId, grade, summary, strengths, fixes, next }] }`. Review
    shows one row per session; applying stores the AI review BESIDE the app's own score (never
    replacing it) and shows it on that session; undo removes it. Send it on a schedule and when a
    session ends.
19. **Agent notes**: this file, imported from each repo's `CLAUDE.md`.

## Working habits

- Run the app's own tests and `standards.mjs` before pushing; never push red.
- Commit and push your own work when it passes; do not leave a pile of uncommitted files.
- Keep the shared files (font.js, cowork.js, standards.mjs) in CoworkSyncHub; an app never edits a copy.
