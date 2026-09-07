"""CoworkSyncHub — central dispatcher for the AI cowork folder handshake.

Apps (GymTracker, Tachyread) write JSON requests + instruction markdown into a
folder; an AI agent writes a JSON reply back; the app imports it. This hub is
the agent side, centralized: it scans registered folders for pending requests,
spawns Claude Code headless to answer each one, verifies the reply landed, and
writes a static status.html dashboard. Stdlib only; the hub itself never
touches the network.

Protocols spoken:
  gymtracker-cowork v1   reply: <channel>/inbox/output-<ISO-date>.json (envelope)
  tachyread-journey v1   reply: journey-cowork-response.json (bare JSON object)

The hub NEVER moves files between inbox/ and processed/ — the apps own that.

Usage:
  python coworkhub.py add <name> <kind> <path>
  python coworkhub.py status
  python coworkhub.py run [app] [--channel C] [--dry-run] [--force]
  python coworkhub.py watch [--interval N]
  python coworkhub.py serve [--port 8791]   # localhost web UI: view + run channels
  python coworkhub.py sources [--fetch [NAME]] [--force]   # shared data sources (Garmin, Strava, …)
  python coworkhub.py log [--days 7] [--md|--json]          # sync-activity digest from sync-log.jsonl
  python coworkhub.py brief daily|weekly [--print]          # write the brief request the hub answers itself
"""

import argparse
import datetime
import fnmatch
import html
import http.server
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

BASE = Path(__file__).resolve().parent
CONFIG_PATH = BASE / "hub-config.json"
STATE_PATH = BASE / "hub-state.json"
STATUS_PATH = BASE / "status.html"
LOG_DIR = BASE / "logs"
LOCK_PATH = BASE / "hub.lock"
RUNS_PATH = BASE / "runs.jsonl"
SYNC_LOG = BASE / "sync-log.jsonl"     # one line per event: sweep, source, dispatch, brief
SOURCES_DIR = BASE / "sources"         # <name>/latest.json + dated copies
BRIEFS_DIR = BASE / "briefs"           # the hub's own cowork folder (daily/, weekly/)
DEFAULT_CLAUDE_ARGS = ["--permission-mode", "acceptEdits", "--max-turns", "40"]


# ---------- helpers ----------

def djb2(text):
    h = 5381
    for ch in text:
        h = (h * 33 + ord(ch)) & 0xFFFFFFFF
    return h


def read_text(path):
    try:
        return Path(path).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None


def load_json(path, default=None):
    text = read_text(path)
    if text is None:
        return default
    try:
        return json.loads(text)
    except ValueError:
        return default


def newest_mtime(paths):
    m = 0.0
    for p in paths:
        try:
            m = max(m, p.stat().st_mtime)
        except OSError:
            pass
    return m


def list_json(d):
    return list(d.glob("*.json")) if d.is_dir() else []


def load_config():
    return load_json(CONFIG_PATH, {"claude_cmd": "claude", "apps": []})


def save_config(cfg):
    cfg.setdefault("claude_cmd", "claude")
    cfg.setdefault("claude_args", DEFAULT_CLAUDE_ARGS)
    cfg.setdefault("timeout_sec", 900)
    cfg.setdefault("stale_days", 7)
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2), encoding="utf-8")


def load_state():
    return load_json(STATE_PATH, {"channels": {}})


def save_state(state):
    tmp = Path(str(STATE_PATH) + ".tmp")
    tmp.write_text(json.dumps(state, indent=2), encoding="utf-8")
    os.replace(tmp, STATE_PATH)


# ---------- adapters ----------

GT_CHANNELS = {
    "garmin-reconciliation": "garmin-output",
    "strava-reconciliation": "strava-output",
    "plan-of-the-day": "pod-output",
    "analysis": "analysis-output",
}


def scan_gymtracker(app):
    root = Path(app["root"])
    export = load_json(root / "app-export.json")
    bad = ""
    if export is not None:
        if export.get("protocol") != "gymtracker-cowork":
            bad = "unsupported protocol"
        elif int(export.get("protocolVersion") or 0) > 1:
            bad = "newer protocol version"
    channels = []
    today = datetime.date.today().isoformat()
    for name, kind_out in GT_CHANNELS.items():
        sub = root / name
        if not sub.is_dir():
            continue
        req_files = [sub / "context.json"]
        if name == "plan-of-the-day":
            req_files.append(sub / "options.json")
        req_files = [p for p in req_files if p.exists()]
        req_m = newest_mtime(req_files)
        rep_m = newest_mtime(list_json(sub / "inbox") + list_json(sub / "processed"))
        extra = f", `{name}/options.json`" if name == "plan-of-the-day" else ""
        prompt = (
            f"You are the GymTracker cowork agent. Work only on channel `{name}/`.\n"
            f"Read `{name}/INSTRUCTIONS.md`, `{name}/context.json`{extra} and "
            f"`app-export.json`, follow the instructions, and write exactly one reply "
            f"file `{name}/inbox/output-{today}.json` in the documented "
            f"gymtracker-cowork envelope (kind `{kind_out}`). Overwrite it if it "
            f"already exists. If `context.json`'s envelope contains a `requestHash` "
            f"field, copy it verbatim into your reply envelope. If you cannot complete "
            f'the task, write `{name}/inbox/error-{today}.json` containing '
            f'{{"reason": "..."}} instead of a reply. Do not modify any other files.'
        )
        channels.append({
            "app": app["name"], "kind": "gymtracker", "channel": name, "cwd": root,
            "pending": bool(req_files) and not bad and (rep_m == 0 or req_m > rep_m),
            "note": bad,
            "request_hash": djb2("".join(read_text(p) or "" for p in req_files)) if req_files else None,
            "declared_hash": (load_json(sub / "context.json") or {}).get("requestHash"),
            "request_mtime": req_m or None, "reply_mtime": rep_m or None,
            "prompt": prompt, "reply_dir": sub / "inbox", "reply_prefix": "output-",
            "expected_protocol": "gymtracker-cowork", "expected_kind": kind_out,
        })
    return channels


def scan_tachyread(app):
    root = Path(app["root"])
    req = root / "journey-cowork-request.json"
    resp = root / "journey-cowork-response.json"
    note, pending, req_hash, declared = "", False, None, None
    req_m = newest_mtime([req]) or None
    rep_m = newest_mtime([resp]) or None
    if req.exists():
        text = read_text(req) or ""
        try:
            parsed = json.loads(text)
        except ValueError:
            parsed, note = None, "malformed request"
        if parsed is not None:
            if parsed.get("protocol") != "tachyread-journey" or int(parsed.get("protocolVersion") or 0) > 1:
                note = "unsupported protocol"
            else:
                req_hash = djb2(text)
                declared = parsed.get("requestHash")
                pending = rep_m is None or req_m > rep_m
    prompt = (
        "You are the Tachyread journey cowork agent. Read `journey-instructions.md` "
        "and `journey-cowork-request.json` in this folder and write "
        "`journey-cowork-response.json` as a single JSON object matching the schema "
        "in the instructions. Overwrite it if it already exists. If the request "
        "envelope contains a `requestHash` field, include it verbatim as a top-level "
        "`requestHash` field in your reply. If you cannot complete the task, write "
        '`journey-cowork-response-error.json` containing {"reason": "..."} instead '
        "of a reply. Do not modify any other files."
    )
    return [{
        "app": app["name"], "kind": "tachyread", "channel": "journey", "cwd": root,
        "pending": pending, "note": note, "request_hash": req_hash,
        "declared_hash": declared,
        "request_mtime": req_m, "reply_mtime": rep_m,
        "prompt": prompt, "reply_path": resp,
    }]


def scan_manifest(app):
    """Generic adapter for any folder with a cowork.json (see COWORK-PROTOCOL.md)."""
    root = Path(app["root"])
    man = load_json(root / "cowork.json") or {}
    if man.get("protocol") != "cowork-manifest":
        return [_stub_channel(app, "unsupported protocol")]
    if int(man.get("protocolVersion") or 0) > 1:
        return [_stub_channel(app, "newer protocol version")]
    channels = []
    today = datetime.date.today().isoformat()
    for spec in man.get("channels", []):
        name = spec.get("name")
        if not name:
            continue
        req_files = [root / r for r in spec.get("request", [])]
        req_files = [p for p in req_files if p.exists()]
        req_m = newest_mtime(req_files)
        prefix = spec.get("replyPrefix", "output-")
        if spec.get("replyDir"):
            rep_m = newest_mtime([p for p in list_json(root / spec["replyDir"])
                                  if p.name.startswith(prefix)])
            target = f"{spec['replyDir']}/{prefix}{today}.json"
            err_target = f"{spec['replyDir']}/error-{today}.json"
        else:
            rp = spec.get("replyPath", "reply.json")
            rep_m = newest_mtime([root / rp])
            target = rp
            err_target = (rp[:-5] if rp.endswith(".json") else rp) + "-error.json"
        reads = ", ".join(f"`{r}`" for r in
                          ([spec["instructions"]] if spec.get("instructions") else []) + spec.get("request", []))
        env_clause = (f" in the documented envelope (protocol `{spec['replyProtocol']}`, kind `{spec['replyKind']}`)"
                      if spec.get("replyKind") and spec.get("replyProtocol")
                      else (f" in the documented envelope (kind `{spec['replyKind']}`)" if spec.get("replyKind")
                            else " as a single JSON object per the instructions"))
        prompt = (
            f"You are the {man.get('app', app['name'])} cowork agent. Work only on channel `{name}`.\n"
            f"Read {reads}, follow the instructions, and write exactly one reply file "
            f"`{target}`{env_clause}. Overwrite it if it already exists. If the request "
            f"envelope contains a `requestHash` field, copy it verbatim into a top-level "
            f"`requestHash` field of your reply. If you cannot complete the task, write "
            f'`{err_target}` containing {{"reason": "..."}} instead of a reply. '
            f"Do not modify any other files."
        )
        ch = {
            "app": app["name"], "kind": "manifest", "channel": name, "cwd": root,
            "pending": bool(req_files) and (rep_m == 0 or req_m > rep_m), "note": "",
            "request_hash": djb2("".join(read_text(p) or "" for p in req_files)) if req_files else None,
            "declared_hash": (load_json(req_files[0]) or {}).get("requestHash") if req_files else None,
            "request_mtime": req_m or None, "reply_mtime": rep_m or None, "prompt": prompt,
        }
        if spec.get("sources"):
            ch["sources"] = list(spec["sources"])
        if spec.get("replyDir"):
            ch["reply_dir"] = root / spec["replyDir"]
            ch["reply_prefix"] = prefix
            if spec.get("replyProtocol"):
                ch["expected_protocol"] = spec["replyProtocol"]
            if spec.get("replyKind"):
                ch["expected_kind"] = spec["replyKind"]
        else:
            ch["reply_path"] = root / spec.get("replyPath", "reply.json")
        channels.append(ch)
    return channels


ADAPTERS = {"gymtracker": scan_gymtracker, "tachyread": scan_tachyread, "manifest": scan_manifest}


def _stub_channel(app, note):
    return {"app": app.get("name", "?"), "kind": app.get("kind", "?"), "channel": "-",
            "cwd": None, "pending": False, "note": note, "request_hash": None,
            "request_mtime": None, "reply_mtime": None, "prompt": ""}


def scan_all(cfg, state):
    channels = []
    for app in cfg.get("apps", []):
        root = Path(app.get("root", ""))
        if not root.is_dir():
            channels.append(_stub_channel(app, "folder missing"))
            continue
        # manifest wins: lets an app migrate off a dialect by just dropping a cowork.json
        scan = scan_manifest if (root / "cowork.json").exists() else ADAPTERS.get(app.get("kind"))
        if scan is None:
            channels.append(_stub_channel(app, "unknown kind"))
            continue
        try:
            channels.extend(scan(app))
        except Exception as e:  # ponytail: a broken folder must never kill the sweep
            channels.append(_stub_channel(app, f"scan error: {e}"))
    stale_sec = cfg.get("stale_days", 7) * 86400
    now = time.time()
    for ch in channels:
        entry = state.get("channels", {}).get(f"{ch['app']}/{ch['channel']}", {})
        ch["answered"] = ch["request_hash"] is not None and entry.get("last_request_hash") == ch["request_hash"]
        ch["last_dispatch"] = entry.get("last_dispatch")
        ch["last_result"] = entry.get("last_result")
        ch["stale"] = bool(ch["pending"] and not ch["answered"]
                           and ch["request_mtime"] and now - ch["request_mtime"] > stale_sec)
    return channels


# ---------- sync log ----------

def log_event(kind, **fields):
    """Append one line to sync-log.jsonl. Never raises: a log problem must not stop a sweep."""
    line = {"ts": datetime.datetime.now().isoformat(timespec="seconds"), "kind": kind}
    line.update({k: v for k, v in fields.items() if v is not None})
    try:
        with open(SYNC_LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(line, default=str) + "\n")
    except OSError:
        pass


def read_log(days=7):
    """Events from sync-log.jsonl newer than `days` days, oldest first."""
    cut = (datetime.datetime.now() - datetime.timedelta(days=days)).isoformat(timespec="seconds")
    out = []
    for line in (read_text(SYNC_LOG) or "").splitlines():
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        if str(ev.get("ts", "")) >= cut:
            out.append(ev)
    return out


def log_digest(days=7):
    """Counts + last-seen per app/channel/source + recent errors — the shape a brief wants."""
    events = read_log(days)
    d = {"days": days, "since": (datetime.datetime.now() - datetime.timedelta(days=days)).isoformat(timespec="seconds"),
         "until": datetime.datetime.now().isoformat(timespec="seconds"), "events": len(events),
         "sweeps": 0, "dispatches": {"ok": 0, "error": 0, "dry-run": 0}, "sources": {}, "channels": {}, "errors": []}
    for ev in events:
        k = ev.get("kind")
        if k == "sweep":
            d["sweeps"] += 1
        elif k == "dispatch":
            res = str(ev.get("result") or "")
            bucket = "ok" if res == "ok" else ("dry-run" if res == "dry-run" else "error")
            d["dispatches"][bucket] += 1
            key = f"{ev.get('app')}/{ev.get('channel')}"
            c = d["channels"].setdefault(key, {"ok": 0, "error": 0, "last": None, "last_result": None})
            c["ok" if bucket == "ok" else "error"] += 0 if bucket == "dry-run" else 1
            c["last"], c["last_result"] = ev.get("ts"), res
            if bucket == "error":
                d["errors"].append({"ts": ev.get("ts"), "what": key, "detail": res})
        elif k == "source":
            name = ev.get("source")
            sc = d["sources"].setdefault(name, {"fetched": 0, "cache": 0, "error": 0, "last_ok": None, "last_error": None})
            res = ev.get("result")
            if res == "ok":
                sc["fetched"] += 1; sc["last_ok"] = ev.get("ts")
            elif res == "cache":
                sc["cache"] += 1
            else:
                sc["error"] += 1; sc["last_error"] = ev.get("ts")
                d["errors"].append({"ts": ev.get("ts"), "what": f"source {name}", "detail": str(ev.get("detail") or "")[:200]})
    d["errors"] = d["errors"][-20:]
    return d


def digest_text(d, md=False):
    b = (lambda t: f"**{t}**") if md else (lambda t: t)
    lines = [f"{b('Sync activity')} — last {d['days']} day(s), {d['events']} event(s), {d['sweeps']} sweep(s)",
             f"dispatches: {d['dispatches']['ok']} ok · {d['dispatches']['error']} error · {d['dispatches']['dry-run']} dry-run"]
    if d["sources"]:
        lines.append(b("sources:"))
        for n, sc in d["sources"].items():
            lines.append(f"  {n}: fetched {sc['fetched']}× · cache hits {sc['cache']} · errors {sc['error']}"
                         + (f" · last ok {sc['last_ok']}" if sc["last_ok"] else "") + (f" · last error {sc['last_error']}" if sc["last_error"] else ""))
    if d["channels"]:
        lines.append(b("channels:"))
        for k, c in d["channels"].items():
            lines.append(f"  {k}: {c['ok']} ok · {c['error']} error · last {c['last_result']} @ {c['last']}")
    if d["errors"]:
        lines.append(b("recent errors:"))
        lines += [f"  {e['ts']} {e['what']}: {e['detail']}" for e in d["errors"]]
    return "\n".join(lines)


# ---------- shared data sources ----------
# One fetch per source per sweep, shared by every channel that declares it (config `sources[name].channels`
# patterns like "gymtracker/garmin-*", or a manifest channel's own `"sources": ["garmin"]`). Fresh cache
# (younger than ttl_min) is reused; a failed fetch falls back to the last good file and is logged.

def source_names_for(cfg, ch):
    key = f"{ch['app']}/{ch['channel']}"
    names = []
    for name, spec in (cfg.get("sources") or {}).items():
        if name in (ch.get("sources") or []) or any(fnmatch.fnmatch(key, pat) for pat in (spec.get("channels") or [])):
            names.append(name)
    return names


def fetch_sources(cfg, names, force=False):
    """Fetch each named source at most once; returns {name: {"path", "age_sec", "status"}}."""
    got = {}
    for name in dict.fromkeys(names):
        spec = (cfg.get("sources") or {}).get(name)
        if not spec:
            continue
        d = SOURCES_DIR / name
        d.mkdir(parents=True, exist_ok=True)
        latest = d / "latest.json"
        age = (time.time() - latest.stat().st_mtime) if latest.exists() else None
        ttl = float(spec.get("ttl_min", 360)) * 60
        if not force and age is not None and age < ttl:
            got[name] = {"path": latest, "age_sec": age, "status": "cache"}
            log_event("source", source=name, result="cache", age_sec=round(age))
            print(f"source {name}: using cache ({fmt_age(latest.stat().st_mtime)})")
            continue
        out = d / (datetime.datetime.now().strftime("%Y%m%d-%H%M%S") + ".json")
        cmd = [str(a).replace("{out}", str(out)) for a in (spec.get("cmd") or [])]
        env = dict(os.environ)
        env.update({k: str(v) for k, v in (spec.get("env") or {}).items()})
        start = time.time()
        detail = ""
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace",
                               timeout=float(spec.get("timeout_sec", 300)), env=env, cwd=spec.get("cwd") or None)
            ok = r.returncode == 0 and out.exists() and out.stat().st_size > 0
            detail = ((r.stderr or "") + (r.stdout or ""))[-400:].strip()
            if r.returncode == 0 and not ok:
                detail = "command succeeded but wrote no file at {out}"
        except (OSError, subprocess.TimeoutExpired, ValueError) as e:
            ok, detail = False, f"{type(e).__name__}: {e}"
        dur = round(time.time() - start, 1)
        if ok:
            shutil.copyfile(out, latest)
            dated = sorted(q for q in d.glob("*.json") if q.name != "latest.json")
            for q in dated[:-30]:  # ponytail: keep the last 30 pulls; raise if you want a longer history
                q.unlink(missing_ok=True)
            got[name] = {"path": latest, "age_sec": 0, "status": "fetched"}
            log_event("source", source=name, result="ok", duration_sec=dur, file=out.name)
            print(f"source {name}: fetched in {dur}s -> {out.name}")
        else:
            out.unlink(missing_ok=True)
            if latest.exists():
                got[name] = {"path": latest, "age_sec": age, "status": "stale"}
            log_event("source", source=name, result="error", duration_sec=dur, detail=detail)
            print(f"source {name}: FAILED after {dur}s — {detail[:160] or 'no output'}"
                  + (f" (falling back to the cache from {fmt_age(latest.stat().st_mtime)})" if latest.exists() else ""))
    return got


def sources_prompt(names, got):
    """The paragraph appended to a channel's prompt so the agent reads the cache instead of hitting the service."""
    lines = []
    for n in names:
        info = got.get(n)
        if not info:
            lines.append(f"- {n}: NOT available this sweep (fetch failed, no cache). Say so in your reply; do not fetch it yourself.")
            continue
        how = {"fetched": "fetched just now", "cache": f"cached {fmt_age(time.time() - info['age_sec'])}",
               "stale": f"STALE cache from {fmt_age(time.time() - info['age_sec'])} (this sweep's fetch failed)"}[info["status"]]
        lines.append(f"- {n}: `{info['path']}` ({how})")
    return ("\n\nDATA SOURCES — the hub fetched these once for every app this sweep. Read these files; "
            "do NOT contact the services (Garmin, Strava, …) or run any sync script yourself:\n" + "\n".join(lines))


# ---------- dispatcher ----------

def _record(state, key, ch, result, store_hash, reply=None, duration=None, log=None):
    prev = state.get("channels", {}).get(key, {})
    entry = {
        "last_request_hash": ch["request_hash"] if store_hash else prev.get("last_request_hash"),
        "last_dispatch": datetime.datetime.now().isoformat(timespec="seconds"),
        "last_result": result,
    }
    if reply is not None:
        entry["last_reply"] = str(reply)
    state.setdefault("channels", {})[key] = entry
    save_state(state)
    line = {"ts": entry["last_dispatch"], "app": ch["app"], "channel": ch["channel"],
            "request_hash": ch["request_hash"], "result": result,
            "duration_sec": duration, "log": log}
    with open(RUNS_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps(line) + "\n")
    log_event("dispatch", app=ch["app"], channel=ch["channel"], result=result, duration_sec=duration, log=log)


def _agent_error(ch, since):
    """Fresh agent-written error file (dead letter) -> (reason, path) or (None, None)."""
    if "reply_dir" in ch:
        cand = [p for p in list_json(ch["reply_dir"]) if p.name.startswith("error-")]
    else:
        stem = ch["reply_path"].name
        stem = stem[:-5] if stem.endswith(".json") else stem
        cand = [p for p in list_json(ch["reply_path"].parent) if p.name == stem + "-error.json"]
    fresh = [p for p in cand if p.stat().st_mtime >= since - 2]
    if not fresh:
        return None, None
    p = max(fresh, key=lambda q: q.stat().st_mtime)
    return (load_json(p) or {}).get("reason") or "unspecified", p


def verify_reply(ch, since):
    """Did the expected reply file appear and parse? -> (ok, detail, path)"""
    def stale(data):
        return (ch.get("declared_hash") is not None and data.get("requestHash") is not None
                and data.get("requestHash") != ch["declared_hash"])

    if "reply_dir" in ch:
        prefix = ch.get("reply_prefix", "output-")
        fresh = [p for p in list_json(ch["reply_dir"])
                 if p.name.startswith(prefix) and not p.name.startswith("error-")
                 and p.stat().st_mtime >= since - 2]
        if not fresh:
            reason, errfile = _agent_error(ch, since)
            return (False, f"agent reported: {reason}", errfile) if reason else (False, "no reply file appeared", None)
        newest = max(fresh, key=lambda p: p.stat().st_mtime)
        data = load_json(newest)
        if not isinstance(data, dict):
            return False, "reply invalid JSON", newest
        if ch.get("expected_protocol") and data.get("protocol") != ch["expected_protocol"]:
            return False, "reply wrong protocol/kind", newest
        if ch.get("expected_kind") and data.get("kind") != ch["expected_kind"]:
            return False, "reply wrong protocol/kind", newest
        if stale(data):
            return False, "reply for stale request", newest
        return True, "", newest
    resp = ch["reply_path"]
    if not resp.exists() or resp.stat().st_mtime < since - 2:
        reason, errfile = _agent_error(ch, since)
        return (False, f"agent reported: {reason}", errfile) if reason else (False, "no reply file appeared", None)
    data = load_json(resp)
    if not isinstance(data, dict):
        return False, "reply invalid JSON", resp
    if stale(data):
        return False, "reply for stale request", resp
    return True, "", resp


def dispatch(ch, cfg, state, dry_run=False):
    key = f"{ch['app']}/{ch['channel']}"
    if dry_run:
        print(f"[dry-run] would dispatch {key}")
        return "dry-run"
    cmd = cfg.get("claude_cmd", "claude")
    if isinstance(cmd, str):
        exe = shutil.which(cmd)
        if exe is None:
            result = f"error: claude CLI not found ({cmd})"
            _record(state, key, ch, result, store_hash=False)
            print(f"{key}: {result}")
            return result
        base = [exe]
    else:
        base = list(cmd)
    args = base + ["-p"] + list(cfg.get("claude_args", DEFAULT_CLAUDE_ARGS))
    LOG_DIR.mkdir(exist_ok=True)
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S%f")
    log_path = LOG_DIR / f"{ch['app']}-{ch['channel']}-{stamp}.log"
    start = time.time()
    result = None
    print(f"{key}: dispatching (log: {log_path.name})")
    with open(log_path, "w", encoding="utf-8") as logf:
        logf.write(f"# {key}\n# cmd: {args}\n# cwd: {ch['cwd']}\n# prompt:\n{ch['prompt']}\n# --- output ---\n")
        logf.flush()
        try:
            p = subprocess.Popen(args, cwd=str(ch["cwd"]), stdin=subprocess.PIPE,
                                 stdout=logf, stderr=subprocess.STDOUT,
                                 text=True, encoding="utf-8", errors="replace")
        except OSError as e:
            result = f"error: spawn failed ({e})"
            _record(state, key, ch, result, store_hash=False)
            print(f"{key}: {result}")
            return result
        try:
            p.communicate(input=ch["prompt"], timeout=cfg.get("timeout_sec", 900))
        except subprocess.TimeoutExpired:
            # ponytail: taskkill /T because kill() on the npm .cmd shim orphans the node child
            if os.name == "nt":
                subprocess.run(["taskkill", "/T", "/F", "/PID", str(p.pid)], capture_output=True)
            else:
                p.kill()
            result = "error: timeout"
    reply = None
    if result is None:
        ok, detail, reply = verify_reply(ch, start)
        if ok:
            result = "ok"
        else:
            result = f"error: {detail}" + (f" (exit {p.returncode})" if p.returncode else "")
    _record(state, key, ch, result, store_hash=True, reply=reply,
            duration=round(time.time() - start, 1), log=log_path.name)
    print(f"{key}: {result}")
    return result


def acquire_lock(cfg):
    # ponytail: O_EXCL lockfile; real file locking only if this ever goes multi-machine
    for _ in (1, 2):
        try:
            fd = os.open(LOCK_PATH, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, str(os.getpid()).encode())
            os.close(fd)
            return True
        except FileExistsError:
            try:
                age = time.time() - LOCK_PATH.stat().st_mtime
            except OSError:
                continue  # lock vanished between checks; retry once
            if age > cfg.get("timeout_sec", 900) + 60:
                LOCK_PATH.unlink(missing_ok=True)  # stale lock from a dead run
                continue
            return False
    return False


# ---------- status ----------

# state -> (ANSI color, dashboard pill class)
STATE_STYLE = {"PENDING": ("33;1", "pend"), "STALE": ("31;1", "stale"),
               "answered": ("32", "ans"), "idle": ("2", "idle"), "-": ("31", "note")}


def fmt_ts(t):
    if not t:
        return "-"
    if isinstance(t, str):
        return t
    return datetime.datetime.fromtimestamp(t).strftime("%Y-%m-%d %H:%M")


def fmt_age(t):
    if not t:
        return "-"
    s = max(0.0, time.time() - t)
    for limit, div, unit in ((60, 1, "s"), (3600, 60, "m"), (86400, 3600, "h")):
        if s < limit:
            return f"{int(s / div)}{unit} ago"
    return f"{int(s / 86400)}d ago"


def _state_txt(ch):
    if ch["note"]:
        return "-"
    if ch.get("stale"):
        return "STALE"
    if ch["pending"] and not ch.get("answered"):
        return "PENDING"
    if ch["pending"]:
        return "answered"
    return "idle"


def _is_err(ch):
    return bool(ch["note"] or str(ch.get("last_result") or "").startswith("error"))


def _ansi_on():
    if os.environ.get("NO_COLOR") or not sys.stdout.isatty():
        return False
    if os.name == "nt":
        os.system("")  # ponytail: documented side effect flips on VT processing in conhost
    return True


def print_status(channels):
    ansi = _ansi_on()

    def c(code, s):
        return f"\x1b[{code}m{s}\x1b[0m" if ansi and code else s

    head = ("APP", "CHANNEL", "STATE", "REQUEST", "REPLY", "LAST DISPATCH", "RESULT/NOTE")
    rows = [(ch["app"], ch["channel"], _state_txt(ch), fmt_age(ch["request_mtime"]),
             fmt_age(ch["reply_mtime"]), ch.get("last_dispatch") or "-",
             ch["note"] or ch.get("last_result") or "-") for ch in channels]
    widths = [max(len(str(r[i])) for r in rows + [head]) for i in range(len(head))]
    print(c("1", "  ".join(v.ljust(w) for v, w in zip(head, widths)).rstrip()))
    for r, ch in zip(rows, channels):
        cells = [str(v).ljust(w) for v, w in zip(r, widths)]
        cells[2] = c(STATE_STYLE.get(r[2], ("", ""))[0], cells[2])
        cells[6] = c("31" if _is_err(ch) else ("32" if r[6] == "ok" else "2"), cells[6])
        print("  ".join(cells).rstrip())
    states = [r[2] for r in rows]
    parts = [f"{len(channels)} channels"]
    for state, label, code in (("PENDING", "pending", "33;1"), ("STALE", "stale", "31;1")):
        if states.count(state):
            parts.append(c(code, f"{states.count(state)} {label}"))
    n_err = sum(map(_is_err, channels))
    if n_err:
        parts.append(c("31", f"{n_err} error{'s' if n_err > 1 else ''}"))
    if len(parts) == 1:
        parts.append(c("32", "all quiet"))
    print("\n" + " · ".join(parts))


def recent_runs(n=20):
    runs = []
    for line in (read_text(RUNS_PATH) or "").splitlines()[-n:]:
        try:
            runs.append(json.loads(line))
        except ValueError:
            pass
    runs.reverse()
    return runs


STATUS_CSS = """
:root{--bg:#f4f5f7;--card:#fff;--ink:#1c2128;--mut:#69707c;--line:#e2e5ea;
--pend:#8a6100;--pendbg:#fdeeba;--stale:#a12622;--stalebg:#fbdcda;
--ok:#1a7a33;--okbg:#d9f0de;--err:#b3261e;--idle:#8b93a0;--idlebg:#edeff2}
@media(prefers-color-scheme:dark){:root{--bg:#14171b;--card:#1d2229;--ink:#e7eaee;
--mut:#98a1ad;--line:#2b323b;--pend:#ffd45e;--pendbg:#4a3c0d;--stale:#ff9d95;--stalebg:#521d1a;
--ok:#7fd694;--okbg:#173d21;--err:#ff8a80;--idle:#8b93a0;--idlebg:#262c34}}
*{box-sizing:border-box}body{font:15px/1.45 system-ui,'Segoe UI',sans-serif;margin:0 auto;
background:var(--bg);color:var(--ink);padding:1.5em;max-width:1100px}
header{display:flex;flex-wrap:wrap;align-items:baseline;gap:.6em;margin-bottom:.8em}
h1{font-size:1.35em;margin:0}h2{font-size:1em;margin:0 0 .4em}
#meta{color:var(--mut);font-size:.85em;margin-left:auto}
.chip{display:inline-block;padding:.15em .7em;border-radius:1em;font-size:.85em;font-weight:600}
.chip.pend{background:var(--pendbg);color:var(--pend)}
.chip.stale,.chip.err{background:var(--stalebg);color:var(--stale)}
.chip.ok{background:var(--okbg);color:var(--ok)}
.sweep{font:12px ui-monospace,monospace;color:#5c6572;margin:-6px 0 14px}
cowork-panel{display:block;margin:0 0 10px}
details>summary{cursor:pointer;font:11px ui-monospace,monospace;color:#5c6572}
pre.brief{white-space:pre-wrap;font:13px/1.55 system-ui,sans-serif;margin:0;max-height:360px;overflow:auto}
#q{width:100%;padding:.5em .8em;margin:.2em 0 1em;border:1px solid var(--line);
border-radius:.5em;background:var(--card);color:var(--ink);font:inherit}
.card{background:var(--card);border:1px solid var(--line);border-radius:.6em;
padding:1em 1.2em;margin-bottom:1em;box-shadow:0 1px 2px rgba(0,0,0,.05);overflow-x:auto}
table{border-collapse:collapse;width:100%}th,td{padding:.35em .6em;text-align:left;
border-top:1px solid var(--line);font-size:.92em;white-space:nowrap}
th{color:var(--mut);font-weight:600;border-top:none;font-size:.78em;
text-transform:uppercase;letter-spacing:.04em}
td.chan{font-weight:600}td.mut{color:var(--mut)}td.ok{color:var(--ok)}td.err{color:var(--err)}
td.res{white-space:normal}
.pill{display:inline-block;padding:.05em .6em;border-radius:1em;font-size:.8em;font-weight:700}
.pill.pend{background:var(--pendbg);color:var(--pend)}
.pill.stale,.pill.note{background:var(--stalebg);color:var(--stale)}
.pill.ans{background:var(--okbg);color:var(--ok)}
.pill.idle{background:var(--idlebg);color:var(--idle)}
.bar{display:inline-block;width:60px;height:6px;background:var(--idlebg);border-radius:3px;
margin-right:.5em;vertical-align:middle}.bar i{display:block;height:100%;background:var(--ok);
border-radius:3px}
footer{color:var(--mut);font-size:.8em;margin-top:.5em}
"""

STATUS_JS = """
const rel=s=>{s=Math.max(0,s);return s<60?(s|0)+"s":s<3600?(s/60|0)+"m":s<86400?(s/3600|0)+"h":(s/86400|0)+"d"};
function tick(){const t=Date.now()/1e3;
document.querySelectorAll("[data-ts]").forEach(el=>el.textContent=rel(t-+el.dataset.ts)+" ago");
const left=Math.max(0,60-(t-GEN))|0;
document.getElementById("cd").textContent=left?"refreshes in "+left+"s":"refreshing\\u2026"}
tick();setInterval(tick,1000);
document.getElementById("q").addEventListener("input",e=>{const q=e.target.value.toLowerCase();
document.querySelectorAll("tr[data-k]").forEach(r=>r.style.display=r.dataset.k.includes(q)?"":"none")});
// the shared cowork panel, one per app; buttons reach the hub only when served by `coworkhub.py serve`
const live=location.protocol.startsWith("http");
document.querySelectorAll("cowork-panel").forEach(p=>{const d=PANELS[p.dataset.app];if(!d)return;
  if(!live)d.message="open this page via `python coworkhub.py serve` to run channels from here";
  p.data=d;});
if(live){document.querySelector(".swlink").hidden=false;
  // served: the panels re-read the folders every 15s without a page reload
  setInterval(async()=>{try{const r=await fetch("/api/panels");if(!r.ok)return;const feed=await r.json();
    document.querySelectorAll("cowork-panel").forEach(p=>{if(feed[p.dataset.app]){PANELS[p.dataset.app]=feed[p.dataset.app];p.data=feed[p.dataset.app];}});}catch(err){}},15000);}
document.addEventListener("cowork-action",async ev=>{const {app,action,channel}=ev.detail;
  if(!live)return;
  const body={app,channel:action.endsWith("-all")?null:channel,force:action.startsWith("force")};
  const p=ev.target;p.data=Object.assign({},PANELS[app],{message:"queued "+(body.channel||"all")+"\u2026"});
  try{const r=await fetch("/api/run",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
    if(!r.ok)throw new Error(await r.text());setTimeout(()=>location.reload(),1500);}
  catch(err){p.data=Object.assign({},PANELS[app],{message:String(err.message||err),error:true});}});
"""


def panel_feed(channels):
    """{app: cowork-panel data} — what status.html embeds and /api/panels serves."""
    apps = {}
    for ch in channels:
        apps.setdefault(ch["app"], []).append(ch)
    return {app: {"app": app, "folder": str(chs[0].get("cwd") or "")[-48:] if chs else "",
                  "channels": [{"channel": c["channel"], "pending": bool(c["pending"]),
                                "answered": bool(c.get("answered")), "stale": bool(c.get("stale")),
                                "note": c["note"], "request_mtime": c["request_mtime"] or 0,
                                "reply_mtime": c["reply_mtime"] or 0} for c in chs],
                  "actions": [{"id": "run-all", "label": "Run pending", "primary": True},
                              {"id": "force-all", "label": "Force all"}]}
            for app, chs in apps.items()}


def _sweep_line():
    """The portal's stable sweep summary (legal / ToS / privacy / PG), if it has run."""
    p = BASE / "sweep.json"
    if not p.exists():
        return "not run yet — python portal.py sweep"
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return "sweep.json unreadable"
    counts = {}
    for f in d.get("findings", []):
        counts[f["sev"]] = counts.get(f["sev"], 0) + 1
    parts = [f"{counts[k]} {k}" for k in ("secret", "legal", "privacy", "tos", "content") if counts.get(k)]
    return (" · ".join(parts) or "clean") + f" — {fmt_age(d.get('at'))} (sweep-report.html)"


def write_status_html(channels):
    e = html.escape
    now = time.time()

    def age_td(t):
        if not t:
            return "<td class='mut'>-</td>"
        return (f"<td class='mut' title='{e(fmt_ts(t))}'>"
                f"<span data-ts='{t:.0f}'>{e(fmt_age(t))}</span></td>")

    apps = {}
    for ch in channels:
        apps.setdefault(ch["app"], []).append(ch)
    cards = []
    for app, chs in apps.items():
        rows = []
        for ch in chs:
            st = _state_txt(ch)
            res = ch["note"] or ch.get("last_result") or "-"
            rcls = "err" if _is_err(ch) else ("ok" if res == "ok" else "mut")
            key = e(" ".join([app, ch["channel"], st, res]).lower())
            rows.append(
                f"<tr data-k=\"{key}\">"
                f"<td class='chan'>{e(ch['channel'])}</td>"
                f"<td><span class='pill {STATE_STYLE.get(st, ('', 'note'))[1]}'>{e(st)}</span></td>"
                + age_td(ch["request_mtime"]) + age_td(ch["reply_mtime"])
                + f"<td class='mut'>{e(ch.get('last_dispatch') or '-')}</td>"
                f"<td class='res {rcls}'>{e(res)}</td></tr>")
        cards.append(f"<section class='card'><h2>{e(app)}</h2>"
                     f"<cowork-panel mode='data' data-app='{e(app)}'></cowork-panel>"
                     f"<details><summary>hub detail</summary><table>"
                     f"<tr><th>Channel</th><th>State</th><th>Request</th><th>Reply</th>"
                     f"<th>Last dispatch</th><th>Result / note</th></tr>{''.join(rows)}</table></details></section>")
    panel_data = panel_feed(channels)  # the same panel every app shows, fed the scanner's own dicts

    runs = recent_runs()
    max_d = max([r.get("duration_sec") or 0 for r in runs] + [1])
    run_rows = []
    for r in runs:
        res = str(r.get("result") or "-")
        rcls = "ok" if res == "ok" else ("mut" if res == "dry-run" else "err")
        dur = r.get("duration_sec")
        bar = (f"<div class='bar'><i style='width:{int(100 * dur / max_d)}%'></i></div>{dur:g}s"
               if dur is not None else "-")
        key = e(" ".join([str(r.get("app") or ""), str(r.get("channel") or ""), res]).lower())
        run_rows.append(
            f"<tr data-k=\"{key}\">"
            f"<td class='mut'>{e(str(r.get('ts') or '-'))}</td>"
            f"<td>{e(str(r.get('app') or '?'))}/{e(str(r.get('channel') or '?'))}</td>"
            f"<td class='res {rcls}'>{e(res)}</td><td class='mut'>{bar}</td>"
            f"<td class='mut'>{e(str(r.get('log') or '-'))}</td></tr>")
    runs_html = ("<section class='card'><h2>Recent runs</h2><table>"
                 "<tr><th>When</th><th>Channel</th><th>Result</th><th>Duration</th><th>Log</th></tr>"
                 f"{''.join(run_rows)}</table></section>" if run_rows else "")

    src_rows = []
    for name in sorted((SOURCES_DIR.glob("*")) if SOURCES_DIR.is_dir() else []):
        latest = name / "latest.json"
        if latest.exists():
            src_rows.append(f"<tr><td class='chan'>{e(name.name)}</td>" + age_td(latest.stat().st_mtime)
                            + f"<td class='mut'>{latest.stat().st_size:,} B</td></tr>")
    sources_html = ("<section class='card'><h2>Shared data sources</h2><table><tr><th>Source</th><th>Fetched</th><th>Size</th></tr>"
                    f"{''.join(src_rows)}</table></section>" if src_rows else "")
    briefs_html = ""
    for period in BRIEF_PERIODS:
        rp = load_json(BRIEFS_DIR / period / "reply.json")
        if isinstance(rp, dict) and rp.get("reply"):
            briefs_html += (f"<section class='card'><h2>Latest {e(period)} brief</h2>"
                            f"<pre class='brief'>{e(str(rp['reply']))}</pre></section>")
    states = [_state_txt(ch) for ch in channels]
    n_err = sum(map(_is_err, channels))
    chips = "".join(f"<span class='chip {cls}'>{n} {label}</span>" for n, label, cls in
                    [(states.count("PENDING"), "pending", "pend"),
                     (states.count("STALE"), "stale", "stale"), (n_err, "errors", "err")]
                    if n) or "<span class='chip ok'>all quiet</span>"
    gen = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    doc = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="60"><title>CoworkSyncHub</title>
<style>{STATUS_CSS}</style></head><body>
<header><h1>CoworkSyncHub</h1>{chips}<span id="meta">generated {gen} · <span id="cd">refreshes in 60s</span></span></header>
<p class="sweep">stable sweep: {e(_sweep_line())} <a href="sweep" class="swlink" hidden>open report</a></p>
<input id="q" type="search" placeholder="filter channels and runs…" aria-label="filter">
{''.join(cards)}{sources_html}{briefs_html}{runs_html}
<footer>times are relative — hover for absolute · auto-refreshes every 60s</footer>
<script src="cowork.js"></script>
<script>const GEN={now:.0f};const PANELS={json.dumps(panel_data)};{STATUS_JS}</script></body></html>"""
    STATUS_PATH.write_text(doc, encoding="utf-8")


# ---------- CLI ----------

def cmd_status(args):
    channels = scan_all(load_config(), load_state())
    print_status(channels)
    print(f"stable sweep: {_sweep_line()}")
    dg = log_digest(7)
    print(f"sync log (7d): {dg['sweeps']} sweeps · {dg['dispatches']['ok']} ok · {dg['dispatches']['error']} error"
          + (" · sources: " + ", ".join(f"{n} {v['fetched']}×/{v['cache']} cached/{v['error']} err" for n, v in dg["sources"].items()) if dg["sources"] else ""))
    write_status_html(channels)
    print(f"\nwrote {STATUS_PATH}")


def cmd_run(args):
    cfg = load_config()
    state = load_state()
    if not acquire_lock(cfg):
        print("another sweep is running (hub.lock); skipping")
        return
    try:
        channels = scan_all(cfg, state)
        targets = [ch for ch in channels
                   if (not args.app or ch["app"] == args.app)
                   and (not args.channel or ch["channel"] == args.channel)]
        todo = [ch for ch in targets
                if not ch["note"] and ch["request_hash"] is not None
                and (args.force or (ch["pending"] and not ch["answered"]))]
        log_event("sweep", channels=len(channels), pending=len(todo),
                  apps=sorted({c["app"] for c in channels}))
        if not todo:
            print("nothing to dispatch")
        # every source at most once per sweep, shared by all channels that need it
        needed = []
        for ch in todo:
            needed += source_names_for(cfg, ch)
        got = fetch_sources(cfg, needed, force=getattr(args, "refresh_sources", False)) if needed and not args.dry_run else {}
        for ch in todo:
            names = source_names_for(cfg, ch)
            if names:
                ch["prompt"] += sources_prompt(names, got)
            dispatch(ch, cfg, state, dry_run=args.dry_run)
        write_status_html(scan_all(cfg, load_state()))
    finally:
        LOCK_PATH.unlink(missing_ok=True)


def cmd_watch(args):
    print(f"watching every {args.interval}s; Ctrl-C to stop")
    try:
        while True:
            print(f"--- sweep {datetime.datetime.now().strftime('%H:%M:%S')} ---")
            cmd_run(argparse.Namespace(app=None, channel=None, dry_run=False, force=False, refresh_sources=False))
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("stopped")


def make_server(port):
    """Loopback web UI: the same status.html, but the cowork panels can run channels."""
    runs = []

    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):  # quiet
            pass

        def _send(self, code, body, ctype="text/html; charset=utf-8"):
            data = body if isinstance(body, bytes) else body.encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            path = self.path.split("?")[0]
            if path in ("/", "/status.html", "/index.html"):
                write_status_html(scan_all(load_config(), load_state()))
                self._send(200, STATUS_PATH.read_bytes())
            elif path == "/cowork.js":
                self._send(200, (BASE / "cowork.js").read_bytes(), "text/javascript; charset=utf-8")
            elif path == "/sweep":
                rep = BASE / "sweep-report.html"
                self._send(200, rep.read_bytes() if rep.exists()
                           else b"<p>no sweep yet &mdash; run <code>python portal.py sweep</code></p>")
            elif path == "/log":
                self._send(200, digest_text(log_digest(7)), "text/plain; charset=utf-8")
            elif path == "/api/log":
                self._send(200, json.dumps(log_digest(7)), "application/json")
            elif path == "/api/panels":
                self._send(200, json.dumps(panel_feed(scan_all(load_config(), load_state()))), "application/json")
            elif path == "/api/status":
                chans = scan_all(load_config(), load_state())
                self._send(200, json.dumps([{k: (str(v) if isinstance(v, Path) else v)
                                             for k, v in c.items() if k != "prompt"} for c in chans]),
                           "application/json")
            else:
                self._send(404, "not found", "text/plain")

        def do_POST(self):
            if self.path != "/api/run":
                return self._send(404, "not found", "text/plain")
            n = int(self.headers.get("Content-Length") or 0)
            try:
                req = json.loads(self.rfile.read(n) or b"{}")
            except ValueError:
                return self._send(400, "bad json", "text/plain")
            ns = argparse.Namespace(app=req.get("app") or None, channel=req.get("channel") or None,
                                    dry_run=bool(req.get("dry_run")), force=bool(req.get("force")))
            t = threading.Thread(target=cmd_run, args=(ns,), daemon=True)
            t.start()
            runs.append(t)
            self._send(202, json.dumps({"queued": True}), "application/json")

    return http.server.ThreadingHTTPServer(("127.0.0.1", port), H)


def cmd_serve(args):
    srv = make_server(args.port)
    url = f"http://127.0.0.1:{srv.server_address[1]}/"
    print(f"serving {url} (loopback only; Ctrl-C to stop)")
    if not args.no_open:
        webbrowser.open(url)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("stopped")


def cmd_check(args):
    """Validate a folder against COWORK-PROTOCOL.md; PASS/FAIL + channel preview."""
    root = Path(args.path)
    problems, warnings = [], []
    man = load_json(root / "cowork.json")
    if man is not None:
        kind = "manifest"
        if man.get("protocol") != "cowork-manifest":
            problems.append("protocol must be 'cowork-manifest'")
        if int(man.get("protocolVersion") or 0) > 1:
            problems.append("protocolVersion newer than supported (1)")
        chans = man.get("channels") or []
        if not chans:
            problems.append("channels must be a non-empty list")
        for spec in chans:
            n = spec.get("name") or "<unnamed>"
            if not spec.get("name"):
                problems.append("channel missing name")
            if not spec.get("request"):
                problems.append(f"{n}: request must be a non-empty list")
            if bool(spec.get("replyPath")) == bool(spec.get("replyDir")):
                problems.append(f"{n}: exactly one of replyPath/replyDir required")
            for r in spec.get("request", []):
                if not (root / r).exists():
                    warnings.append(f"{n}: request file missing: {r}")
            if spec.get("instructions") and not (root / spec["instructions"]).exists():
                warnings.append(f"{n}: instructions file missing: {spec['instructions']}")
            if spec.get("replyKind") and spec.get("replyDir"):
                for p in list_json(root / spec["replyDir"]):
                    d = load_json(p)
                    if isinstance(d, dict) and d.get("kind") not in (None, spec["replyKind"]):
                        warnings.append(f"{n}: {p.name} has kind {d.get('kind')!r}, expected {spec['replyKind']!r}")
    elif (root / "app-export.json").exists():
        kind = "gymtracker"
    elif (root / "journey-cowork-request.json").exists():
        kind = "tachyread"
    else:
        print("FAIL: no cowork.json and no known dialect layout")
        sys.exit(1)
    for w in warnings:
        print(f"warning: {w}")
    if problems:
        print("FAIL:")
        for prob in problems:
            print(f"  - {prob}")
        sys.exit(1)
    channels = ADAPTERS[kind]({"name": root.name, "kind": kind, "root": str(root)})
    print_status(channels)
    print(f"PASS ({kind})")


def cmd_sources(args):
    cfg = load_config()
    srcs = cfg.get("sources") or {}
    if not srcs:
        print("no sources configured — add a \"sources\" block to hub-config.json (see SETUP.md)")
        return
    if args.fetch is not None:
        names = [args.fetch] if args.fetch else list(srcs)
        unknown = [n for n in names if n not in srcs]
        if unknown:
            sys.exit(f"unknown source(s): {', '.join(unknown)}; known: {', '.join(srcs)}")
        fetch_sources(cfg, names, force=args.force)
    print(f"{'SOURCE':<12} {'TTL':>6} {'LATEST':>10} {'SIZE':>8}  CMD")
    for name, spec in srcs.items():
        latest = SOURCES_DIR / name / "latest.json"
        age = fmt_age(latest.stat().st_mtime) if latest.exists() else "-"
        size = f"{latest.stat().st_size:,}" if latest.exists() else "-"
        print(f"{name:<12} {str(spec.get('ttl_min', 360)) + 'm':>6} {age:>10} {size:>8}  {' '.join(map(str, spec.get('cmd') or []))[:70]}")


def cmd_log(args):
    d = log_digest(args.days)
    if args.json:
        print(json.dumps(d, indent=1))
    else:
        print(digest_text(d, md=args.md))


BRIEF_PERIODS = {"daily": 1, "weekly": 7}


def brief_manifest(include):
    """Only periods that have been written yet are channels, so the scanner never sees a phantom one."""
    periods = [p for p in BRIEF_PERIODS if p == include or (BRIEFS_DIR / p / "request.json").exists()]
    return {"protocol": "cowork-manifest", "protocolVersion": 1, "app": "coworkhub-briefs",
            "channels": [{"name": p, "request": [f"{p}/request.json"], "instructions": f"{p}/INSTRUCTIONS.md",
                          "replyPath": f"{p}/reply.json"} for p in periods]}


def cmd_brief(args):
    """Write briefs/<period>/request.json from the sync log; the hub dispatches it like any other channel
    and the agent's briefs/<period>/reply.json IS the brief. Registers the briefs folder on first use."""
    days = BRIEF_PERIODS[args.period]
    d = BRIEFS_DIR / args.period
    d.mkdir(parents=True, exist_ok=True)
    (BRIEFS_DIR / "cowork.json").write_text(json.dumps(brief_manifest(args.period), indent=2), encoding="utf-8")
    digest = log_digest(days)
    events = read_log(days)[-400:]
    payload = {"period": args.period, "digest": digest, "events": events,
               "apps": [a["name"] for a in load_config().get("apps", [])]}
    req = {"protocol": "coworkhub-brief", "protocolVersion": 1, "kind": "brief-request",
           "generatedAt": datetime.datetime.now().isoformat(timespec="seconds"),
           "requestHash": djb2(json.dumps(payload, sort_keys=True, default=str)), "payload": payload}
    (d / "request.json").write_text(json.dumps(req, indent=1, default=str), encoding="utf-8")
    (d / "INSTRUCTIONS.md").write_text(f"""# CoworkSyncHub — {args.period} brief

Read `{args.period}/request.json`. `payload.digest` is the hub's own summary of the last {days} day(s): sweeps,
dispatches per channel (ok / error), shared data-source fetches (Garmin, Strava, …: fetched / cache hits / errors),
and recent errors. `payload.events` is the raw sync log behind it (one object per sweep / source / dispatch).

Write `{args.period}/reply.json`:

```json
{{ "requestHash": "<copy the request's requestHash verbatim>",
  "reply": "<the brief, in markdown: 1) one-line health verdict, 2) what ran and what it produced per app, 3) anything that failed or is stale and the single most likely fix (see SETUP.md's troubleshooting tables), 4) what needs a human. Under 250 words; plain, no filler.>" }}
```
""", encoding="utf-8")
    cfg = load_config()
    if not any(a.get("root") == str(BRIEFS_DIR) for a in cfg.get("apps", [])):
        cfg.setdefault("apps", []).append({"name": "briefs", "kind": "manifest", "root": str(BRIEFS_DIR)})
        save_config(cfg)
        print(f"registered {BRIEFS_DIR} as app 'briefs' (manifest)")
    log_event("brief", period=args.period, events=len(events))
    print(f"wrote {d / 'request.json'} ({len(events)} events, {digest['dispatches']['ok']} ok / {digest['dispatches']['error']} error dispatches)")
    reply = load_json(d / "reply.json")
    if args.print and reply:
        print("\n" + (reply.get("reply") if isinstance(reply, dict) else str(reply)))
    elif reply:
        print(f"latest reply: {d / 'reply.json'} (use --print to show it)")
    else:
        print(f"next: `python coworkhub.py run briefs` (or let `watch` pick it up); the brief lands in {d / 'reply.json'}")


def cmd_add(args):
    if args.kind not in ADAPTERS:
        sys.exit(f"unknown kind '{args.kind}'; known: {', '.join(ADAPTERS)}")
    if not Path(args.path).is_dir():
        print(f"warning: {args.path} does not exist (yet)")
    cfg = load_config()
    cfg.setdefault("apps", []).append({"name": args.name, "kind": args.kind,
                                       "root": str(Path(args.path))})
    save_config(cfg)
    print(f"added {args.name} ({args.kind}) -> {args.path}")


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(prog="coworkhub", description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status", help="scan all apps, print table, write status.html")
    r = sub.add_parser("run", help="dispatch Claude on pending requests")
    r.add_argument("app", nargs="?", help="limit to one app")
    r.add_argument("--channel", help="limit to one channel")
    r.add_argument("--dry-run", action="store_true")
    r.add_argument("--force", action="store_true", help="re-dispatch even if already answered")
    r.add_argument("--refresh-sources", action="store_true", help="ignore source TTLs and fetch afresh this sweep")
    w = sub.add_parser("watch", help="run on an interval")
    w.add_argument("--interval", type=int, default=300, help="seconds between sweeps (default 300)")
    a = sub.add_parser("add", help="register an app folder")
    a.add_argument("name")
    a.add_argument("kind", help=f"one of: {', '.join(ADAPTERS)}")
    a.add_argument("path")
    c = sub.add_parser("check", help="validate a folder against COWORK-PROTOCOL.md")
    c.add_argument("path")
    so = sub.add_parser("sources", help="shared data sources: list, and --fetch [NAME] to pull now")
    so.add_argument("--fetch", nargs="?", const="", default=None, metavar="NAME")
    so.add_argument("--force", action="store_true", help="ignore TTL")
    lg = sub.add_parser("log", help="sync-activity digest from sync-log.jsonl")
    lg.add_argument("--days", type=int, default=7)
    lg.add_argument("--md", action="store_true")
    lg.add_argument("--json", action="store_true")
    br = sub.add_parser("brief", help="write briefs/<period>/request.json for an agent to answer")
    br.add_argument("period", choices=list(BRIEF_PERIODS))
    br.add_argument("--print", action="store_true", help="also print the latest reply")
    sv = sub.add_parser("serve", help="web UI on localhost: view + run channels from the browser")
    sv.add_argument("--port", type=int, default=8791)
    sv.add_argument("--no-open", action="store_true")
    args = ap.parse_args()
    {"status": cmd_status, "run": cmd_run, "watch": cmd_watch, "add": cmd_add, "check": cmd_check,
     "serve": cmd_serve, "sources": cmd_sources, "log": cmd_log, "brief": cmd_brief}[args.cmd](args)


if __name__ == "__main__":
    main()
