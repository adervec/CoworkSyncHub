# Overlaps and interactions (house standard 27)

Where two apps, or an app and the hub, hold the same data, do the same job, or could feed each
other. This is a register for the maker to choose from, not a to-do list: **an entry is not
permission to build anything.** Each app keeps its own `OVERLAPS.md` in the same format; this file
holds the ones seen from the hub. `python portal.py status` gathers them all onto the status board.

One line per overlap:

    - [state] App + App: what overlaps -> what could be shared, and through what

`state` is `idea` (noticed), `planned` (the maker said yes), `done`, or `dropped` (with the reason).
"The shared Drive folder" is the private folder every app already syncs to: a file there named
`shared-<topic>.json`, written by ONE owning app and only read by the others.

Reviewed: 2026-11-20

Seeded by the QA lead from each app's own description and data inventory, not from a full read of
the code: an app's session should correct anything here that is wrong.

## Fitness and body

- [idea] GymTracker + Run315 + CelebrityCrusher + BlackMirrorBikeRide: each takes in the same Garmin and Strava activities its own way -> fetch once (the runner's Garmin and Strava connectors), keep one `shared-activities.json` in the shared Drive folder with Run315 as owner, the others read it
- [idea] GymTracker + Run315: a run can be logged as cardio in both -> GymTracker's cardio reads Run315's runs instead of storing its own (the hub's ledger already counts a double-logged run once)
- [idea] GymTracker + BodybuildingProgressCoach + MacroTrackro: weight and body composition are kept separately in each -> one `shared-body.json` with one owner; macro targets and physique trends read it
- [idea] MacroTrackro + Mise: a cooked recipe and a logged meal are the same food typed twice -> Mise's cook log offers "log this" to MacroTrackro; one shared food list
- [idea] MacroTrackro + GymTracker + Run315: daily calorie targets ignore the day's training -> MacroTrackro reads the day's sessions (the hub ledger, or shared-activities) to adjust the target
- [idea] BlackMirrorBikeRide + Run315: both import and build GPX routes; rides never reach Run315's fitness and fatigue model -> share routes; BMBR rides join shared-activities
- [idea] BodybuildingProgressCoach + GymTracker: photos and posing sit apart from the training blocks that explain them -> show the training block beside a progress timelapse (read-only)
- [idea] InsightMaster + GymTracker: recovery metrics from the wearable and meditation sits are both "recovery" -> the hub's VIT and PSI could read both; no app change

## Reading, speech and language

- [idea] Tachyread + SpeechImprover: both record you reading a text aloud (Tachyread's speaking minigames and audiobook recording, SpeechImprover's reading projects) -> open a Tachyread book as a SpeechImprover reading project; one passage library
- [idea] LanguageLab + SpeechImprover: LanguageLab needs speech capture and scoring that SpeechImprover already has -> a shared speech module instead of a second copy
- [idea] LanguageLab + Tachyread: graded reading input is Tachyread's whole job -> LanguageLab stories open in Tachyread's reader; words tapped in either land in one list
- [idea] LanguageLab + learning-pit: LanguageLab carries a cut-down copy of learning-pit's spaced-repetition scheduler -> one scheduler module, one deck format, decks in the shared Drive folder
- [idea] Tachyread + learning-pit: words and facts met while reading are not reviewed anywhere -> "send to a deck" from Trackyread notes
- [idea] Tachyread + HandwritingHelper: typing drills and handwriting drills both need text to copy, and both train DEX -> one passage source for both
- [idea] learning-pit + long-gallery + classical-journey: the gallery and the listening guide each have their own quiz (blind listening, hidden details) -> generated decks in learning-pit

## Music

- [idea] GuitarPicker + classical-journey: playable public-domain songs on one side, "what to listen for" on the other -> link a piece to its playable arrangement and back
- [idea] GuitarPicker + MusicStudio: synthesized backing bands and generated stems are the same need -> a MusicStudio stem as a GuitarPicker backing track
- [idea] classical-journey + MusicStudio: a listening history and a taste profile are kept separately -> one taste profile both read

## Across every app

- [planned] GymTracker + Run315 + CelebrityCrusher + BlackMirrorBikeRide + BodybuildingProgressCoach + hub: the fitness apps see the same activity in different ways (plus hand-entered detail such as sets), so the hub must not assume "opened app X" means "trained attribute Y" -> the hub compiles ONE de-duplicated list of real activities from the shared feed and the apps' own entries, and gives STR / END / VIT by what each activity was; part of the Garmin and Strava feed project (shared-activities, shared-body)

- [done] every app + hub: sessions reported once for habits and the character sheet -> `appFont.logSession` (standard 25)
- [planned] every app + hub: each app carries its own Google sign-in and Drive code -> `appFont.google` (standard 1, per app)
- [planned] every app + hub: each app has its own theme list -> the shared base list in font.js (standard 24, per app)
- [planned] every app + hub: AI cowork needs a desktop Chrome tab and a folder per app -> requests and replies through the shared Drive folder and one runner (hub roadmap chunk 6)
- [idea] ChessRetabled + HandwritingHelper + learning-pit + InsightMaster + hub: each keeps its own day streak, while the hub moved to weeks on target -> decide whether app streaks stay, or read the hub's weekly targets
- [idea] InsightMaster + hub: both want reminders -> one reminder mechanism (the hub's calendar file, not yet built)
- [idea] Tachyread + Mise + classical-journey + learning-pit + LanguageLab: each reads text aloud with its own voice and speed setting -> one shared voice setting in font.js, like the font and language
- [idea] HandwritingHelper + MarksmanApp + BodybuildingProgressCoach + MicroMiniger + Tachyread: each takes a photo and straightens, crops or reads it its own way -> one shared capture helper
- [idea] hub daily brief + every app: the brief will want each app's "at a glance" -> each app's cowork brief, read from the shared Drive folder by the runner
