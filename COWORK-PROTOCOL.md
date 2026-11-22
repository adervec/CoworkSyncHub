# Cowork Protocol — house standard, v1

The handshake between an **app** (request side) and an **AI agent** (reply side). The app writes
machine-readable requests plus instructions into its cowork folder; the agent answers by writing reply
files beside them; the app imports them. **The cowork folder lives in the reader's private cloud folder**
(see "In the reader's cloud" below) and the agent is the reader's **AI runner**
(`CoworkSyncHub/runner.py`, RUNNER.md). A folder on the reader's disk, driven from a desktop browser, was
the first transport; it is retired (archive/). Single reader, polling, no server of ours.

## Terminology

- **app** — the program that owns a cowork folder and consumes replies.
- **channel** — one task type within an app folder (e.g. `analysis`).
- **request file(s)** — JSON the app writes describing the channel's task.
- **instructions file** — markdown telling the agent what to do and the reply schema.
- **reply** — the JSON file the agent writes.
- **envelope** — the versioned JSON wrapper (below).
- **dialect** — a grandfathered pre-manifest protocol (see table at the end).
- **agent** — whatever answers: Claude Cowork or Claude Code pointed at the
  folder, or a human pasting JSON.
- **hub** — historical: CoworkSyncHub used to dispatch a headless agent per
  pending request and verify the reply. It is now a passive viewer of the
  briefs the agent writes (see README), so where this document says "the hub"
  checks or records something, read "a careful agent should".

## Canonical layout

```
<app folder>/
  cowork.json                 # discovery manifest (this is what makes an app "standard")
  <channel>/INSTRUCTIONS.md
  <channel>/context.json      # request file(s), any names, declared in the manifest
  <channel>/inbox/            # dir-style replies: output-<ISO-date>.json
  <channel>/processed/        # optional, app-owned archive
```

Flat layouts are equally valid — a channel may declare a single fixed
`replyPath` instead of a reply dir (Tachyread style).

### In the reader's cloud (the only transport since v5)

An app keeps its cowork folder in the reader's private cloud folder (cowork.js "Use my cloud";
font.js `appFont.cloud`). That folder is flat, so path `a/b.json` of app `X` is the file
`cowork-X--a--b.json`; everything else in this document is unchanged. The AI runner answers there.

`applied.json` at the folder root lists the replies already applied or discarded on ANY device
(`{ "protocol": "cowork-applied", "protocolVersion": 1, "applied": [hash, …] }`, the last 500), so a
phone that was offline never applies a reply the desktop already applied. Apps with their own engine
keep the same list.

## Manifest (`cowork.json` at the app folder root)

All paths root-relative, forward slashes.

```json
{ "protocol": "cowork-manifest", "protocolVersion": 1, "app": "myapp",
  "channels": [
    { "name": "coach", "request": ["coach/request.json"], "instructions": "coach/INSTRUCTIONS.md",
      "replyPath": "coach/reply.json" },
    { "name": "analysis", "request": ["analysis/context.json"], "instructions": "analysis/INSTRUCTIONS.md",
      "replyDir": "analysis/inbox", "replyPrefix": "output-",
      "replyProtocol": "myapp-cowork", "replyKind": "analysis-output" } ] }
```

Rules:
- `name` and non-empty `request` are required.
- Exactly one of `replyPath` / `replyDir`. Dir replies are named
  `<replyPrefix><ISO-date>.json`; `replyPrefix` defaults to `output-`.
- `instructions` is optional but strongly recommended.
- `replyProtocol` / `replyKind` are optional; when declared, replies must be
  envelopes carrying those values and the hub verifies them.
- No prompt field — app-specific detail belongs in the instructions file.

An app with a `cowork.json` needs **zero hub code**; the hub's generic
manifest adapter speaks it. The manifest wins over any dialect adapter when
both apply.

## Envelope

```json
{ "protocol": "<app>-<purpose>", "protocolVersion": 1, "kind": "<kind>",
  "generatedAt": "<ISO or epoch ms>", "requestHash": 123456789, "payload": { } }
```

- Parsers MUST tolerate unknown fields (that is how the protocol grows).
- Flat replies MAY be bare JSON objects when the manifest declares no
  `replyKind` (tachyread precedent).

## Versioning

Additive-only within a major version. A reader rejects a file only for a wrong
protocol name or a newer major version (`protocolVersion > supported`), and
rejects by skipping with a note — never by crashing.

## Idempotency & correlation

- Content hash: djb2 over the request files' text. The hub dispatches a given
  hash at most once, even if the run failed; `--force` is the retry button.
- The app SHOULD declare `requestHash` (hash of its own payload) inside the
  request envelope. The agent copies that value verbatim into its reply
  (`requestHash` field; top-level on bare-JSON replies). When both sides are
  present and differ, the hub records `error: reply for stale request`.
- Apps that keep their own reply ledger (GymTracker, Tachyread do) are free to
  ignore duplicates however they like; the echo is for the hub's benefit.

## Ownership

- The app owns its request files and any inbox→processed moves.
- The agent writes only reply files (and error files, below).
- The hub never moves, renames, or deletes anything in an app folder.

## Atomic writes

Writers SHOULD write `<name>.tmp` then rename over the target so pollers never
see torn JSON. Notes: the browser File System Access API (`createWritable`)
already commits atomically on close, and every parser in this ecosystem is
tolerant — a torn read is recoverable on the next poll. Hence SHOULD, not MUST.

## Error files (dead letters)

An agent that cannot complete a task writes, instead of a reply:
- dir-style channels: `<replyDir>/error-<ISO-date>.json`
- flat channels: `<reply-stem>-error.json` beside the reply path
  (e.g. `journey-cowork-response-error.json`)

Content: at least `{ "reason": "..." }`. The hub surfaces
`error: agent reported: <reason>` instead of a generic failure. Apps may
ignore error files entirely.

## Staleness

A pending request older than `stale_days` (hub config, default 7) is flagged
STALE on the status table and dashboard. Nothing is auto-dropped — staleness
is information, not garbage collection.

## Grandfathered dialects

| Dialect | App | Request | Reply | Spoken by |
|---|---|---|---|---|
| `gymtracker-cowork` v1 | GymTracker | `<channel>/context.json` (+`options.json`) | `<channel>/inbox/output-<date>.json`, envelope | hub adapter `gymtracker` |
| `tachyread-journey` v1 | Tachyread | `journey-cowork-request.json` | `journey-cowork-response.json`, bare JSON | hub adapter `tachyread` |
| `marksman-coach` v1 | MarksmanApp | `coach/request.json` | `coach/reply.json` | no adapter yet; a `cowork.json` would cover it |

Dialect apps that also emit a `cowork.json` are treated as manifest apps
(manifest wins). New apps MUST ship a manifest; new dialects are not accepted.
