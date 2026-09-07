"""Self-check for coworkhub: fixture folders for both dialects + a manifest app,
a stub Claude, zero real API calls. Run: python test_coworkhub.py -> prints OK."""

import argparse
import datetime
import json
import os
import sys
import tempfile
import time
from pathlib import Path

import coworkhub

STUB = r'''
import sys, json, re, datetime, pathlib
prompt = sys.stdin.read()
mode = ("bad" if "bad" in sys.argv else "none" if "none" in sys.argv
        else "err" if "err" in sys.argv else "ok")
if mode == "none":
    sys.exit(0)
cwd = pathlib.Path.cwd()
today = datetime.date.today().isoformat()
if (cwd / "journey-cowork-request.json").exists():
    out = cwd / "journey-cowork-response.json"
    out.write_text("not json" if mode == "bad" else json.dumps({"analysis": "stub"}), encoding="utf-8")
    sys.exit(0)
if (cwd / "cowork.json").exists():
    man = json.loads((cwd / "cowork.json").read_text(encoding="utf-8"))
    name = re.search(r"channel `([^`/]+)`", prompt).group(1)
    spec = next(c for c in man["channels"] if c["name"] == name)
    req = json.loads((cwd / spec["request"][0]).read_text(encoding="utf-8"))
    rh = req.get("requestHash")
    if mode == "err":
        if spec.get("replyDir"):
            out = cwd / spec["replyDir"] / ("error-" + today + ".json")
        else:
            out = cwd / (spec["replyPath"][:-5] + "-error.json")
        out.write_text(json.dumps({"reason": "cannot comply"}), encoding="utf-8")
        sys.exit(0)
    if spec.get("replyDir"):
        body = {"protocol": spec.get("replyProtocol", "x"), "protocolVersion": 1,
                "kind": spec.get("replyKind"), "generatedAt": "now", "requestHash": rh, "payload": {}}
        out = cwd / spec["replyDir"] / (spec.get("replyPrefix", "output-") + today + ".json")
    else:
        body = {"result": "stub", "requestHash": rh}
        out = cwd / spec["replyPath"]
    out.write_text("not json" if mode == "bad" else json.dumps(body), encoding="utf-8")
    sys.exit(0)
name = re.search(r"channel `([^`/]+)/`", prompt).group(1)
kinds = {"garmin-reconciliation": "garmin-output", "strava-reconciliation": "strava-output",
         "plan-of-the-day": "pod-output", "analysis": "analysis-output"}
env = {"protocol": "gymtracker-cowork", "protocolVersion": 1, "kind": kinds[name],
       "generatedAt": datetime.datetime.now().isoformat(), "payload": {"stub": True}}
out = cwd / name / "inbox" / ("output-" + today + ".json")
out.write_text("not json" if mode == "bad" else json.dumps(env), encoding="utf-8")
'''


def ns(**kw):
    base = dict(app=None, channel=None, dry_run=False, force=False, path=None, refresh_sources=False)
    base.update(kw)
    return argparse.Namespace(**base)


def write_cfg(cfg):
    coworkhub.CONFIG_PATH.write_text(json.dumps(cfg), encoding="utf-8")


def n_logs():
    return len(list(coworkhub.LOG_DIR.glob("*.log"))) if coworkhub.LOG_DIR.is_dir() else 0


with tempfile.TemporaryDirectory() as td:
    tmp = Path(td)
    coworkhub.CONFIG_PATH = tmp / "hub-config.json"
    coworkhub.STATE_PATH = tmp / "hub-state.json"
    coworkhub.STATUS_PATH = tmp / "status.html"
    coworkhub.LOG_DIR = tmp / "logs"
    coworkhub.LOCK_PATH = tmp / "hub.lock"
    coworkhub.RUNS_PATH = tmp / "runs.jsonl"
    coworkhub.SYNC_LOG = tmp / "sync-log.jsonl"
    coworkhub.SOURCES_DIR = tmp / "sources"
    coworkhub.BRIEFS_DIR = tmp / "briefs"

    # --- fixtures ---
    old = time.time() - 100
    gt = tmp / "gt"
    for name in ["garmin-reconciliation", "analysis", "plan-of-the-day"]:
        sub = gt / name
        (sub / "inbox").mkdir(parents=True)
        (sub / "processed").mkdir()
        (sub / "INSTRUCTIONS.md").write_text("# instructions", encoding="utf-8")
        (sub / "context.json").write_text(json.dumps({"task": name}), encoding="utf-8")
        os.utime(sub / "context.json", (old, old))
    (gt / "plan-of-the-day" / "options.json").write_text(json.dumps({"notes": ""}), encoding="utf-8")
    os.utime(gt / "plan-of-the-day" / "options.json", (old, old))
    (gt / "app-export.json").write_text(json.dumps(
        {"protocol": "gymtracker-cowork", "protocolVersion": 1, "kind": "app-export",
         "generatedAt": "2026-01-01T00:00:00Z", "payload": {}}), encoding="utf-8")

    tr = tmp / "tr"
    tr.mkdir()
    (tr / "journey-cowork-request.json").write_text(json.dumps(
        {"protocol": "tachyread-journey", "protocolVersion": 1, "kind": "cowork-request",
         "generatedAt": 123, "instruction": "x", "ids": [], "dataset": {}}), encoding="utf-8")
    os.utime(tr / "journey-cowork-request.json", (old, old))
    (tr / "journey-instructions.md").write_text("# reply schema here", encoding="utf-8")

    mf = tmp / "mf"
    (mf / "flat").mkdir(parents=True)
    (mf / "deep" / "inbox").mkdir(parents=True)
    (mf / "cowork.json").write_text(json.dumps(
        {"protocol": "cowork-manifest", "protocolVersion": 1, "app": "mfapp",
         "channels": [
             {"name": "flat", "request": ["flat/request.json"],
              "instructions": "flat/INSTRUCTIONS.md", "replyPath": "flat/reply.json"},
             {"name": "deep", "request": ["deep/context.json"], "replyDir": "deep/inbox",
              "replyProtocol": "mfapp-cowork", "replyKind": "deep-output"}]}), encoding="utf-8")
    (mf / "flat" / "request.json").write_text(json.dumps(
        {"protocol": "mfapp-cowork", "protocolVersion": 1, "requestHash": 42, "payload": {}}), encoding="utf-8")
    (mf / "flat" / "INSTRUCTIONS.md").write_text("# do the flat task", encoding="utf-8")
    (mf / "deep" / "context.json").write_text(json.dumps({"task": "d"}), encoding="utf-8")
    os.utime(mf / "flat" / "request.json", (old, old))
    os.utime(mf / "deep" / "context.json", (old, old))

    stub = tmp / "stub_claude.py"
    stub.write_text(STUB, encoding="utf-8")
    cfg = {"claude_cmd": [sys.executable, str(stub)], "claude_args": [], "timeout_sec": 60,
           "apps": [{"name": "gymtracker", "kind": "gymtracker", "root": str(gt)},
                    {"name": "tachyread", "kind": "tachyread", "root": str(tr)},
                    {"name": "mfapp", "kind": "gymtracker", "root": str(mf)},
                    {"name": "ghost", "kind": "gymtracker", "root": str(tmp / "nope")}]}
    write_cfg(cfg)

    # --- 1. pending detection, manifest-wins, missing folder tolerated ---
    chans = coworkhub.scan_all(coworkhub.load_config(), coworkhub.load_state())
    pend = {(c["app"], c["channel"]) for c in chans if c["pending"]}
    assert pend == {("gymtracker", "garmin-reconciliation"), ("gymtracker", "analysis"),
                    ("gymtracker", "plan-of-the-day"), ("tachyread", "journey"),
                    ("mfapp", "flat"), ("mfapp", "deep")}, pend
    assert all(c["kind"] == "manifest" for c in chans if c["app"] == "mfapp"), \
        "cowork.json must win over the registered kind"
    ghost = next(c for c in chans if c["app"] == "ghost")
    assert ghost["note"] == "folder missing" and not ghost["pending"]

    # --- 2. dry run dispatches nothing ---
    coworkhub.cmd_run(ns(dry_run=True))
    assert n_logs() == 0

    # --- 3. full run writes the exact protocol reply files ---
    coworkhub.cmd_run(ns())
    today = datetime.date.today().isoformat()
    out = json.loads((gt / "garmin-reconciliation" / "inbox" / f"output-{today}.json").read_text(encoding="utf-8"))
    assert out["kind"] == "garmin-output" and out["protocol"] == "gymtracker-cowork"
    assert json.loads((tr / "journey-cowork-response.json").read_text(encoding="utf-8")) == {"analysis": "stub"}
    flat_reply = json.loads((mf / "flat" / "reply.json").read_text(encoding="utf-8"))
    assert flat_reply["requestHash"] == 42, "agent must echo the declared requestHash"
    deep_out = json.loads((mf / "deep" / "inbox" / f"output-{today}.json").read_text(encoding="utf-8"))
    assert deep_out["kind"] == "deep-output" and deep_out["protocol"] == "mfapp-cowork"
    st = coworkhub.load_state()["channels"]
    for key in ["gymtracker/garmin-reconciliation", "gymtracker/analysis",
                "gymtracker/plan-of-the-day", "tachyread/journey", "mfapp/flat", "mfapp/deep"]:
        assert st[key]["last_result"] == "ok", (key, st[key])

    # --- 4. idempotent: second run dispatches nothing ---
    before = n_logs()
    coworkhub.cmd_run(ns())
    assert n_logs() == before
    assert not [c for c in coworkhub.scan_all(coworkhub.load_config(), coworkhub.load_state()) if c["pending"]]

    # --- 5. no-reply run: hash blocks retry, --force is the retry button ---
    ctx = gt / "analysis" / "context.json"
    ctx.write_text(json.dumps({"task": "new"}), encoding="utf-8")
    now = time.time() + 5
    os.utime(ctx, (now, now))
    for p in (gt / "analysis" / "inbox").glob("*.json"):   # step-3 reply must not look fresh
        os.utime(p, (old, old))
    cfg["claude_cmd"] = [sys.executable, str(stub), "none"]
    write_cfg(cfg)
    coworkhub.cmd_run(ns(app="gymtracker", channel="analysis"))
    st = coworkhub.load_state()["channels"]["gymtracker/analysis"]
    assert st["last_result"].startswith("error: no reply file"), st
    before = n_logs()
    coworkhub.cmd_run(ns(app="gymtracker", channel="analysis"))       # still pending, but answered
    assert n_logs() == before, "hash should block re-dispatch"
    coworkhub.cmd_run(ns(app="gymtracker", channel="analysis", force=True))
    assert n_logs() == before + 1, "--force should re-dispatch"

    # --- 6. invalid-JSON reply recorded, then good run recovers ---
    cfg["claude_cmd"] = [sys.executable, str(stub), "bad"]
    write_cfg(cfg)
    coworkhub.cmd_run(ns(app="gymtracker", channel="analysis", force=True))
    st = coworkhub.load_state()["channels"]["gymtracker/analysis"]
    assert "reply invalid JSON" in st["last_result"], st
    cfg["claude_cmd"] = [sys.executable, str(stub)]
    write_cfg(cfg)
    coworkhub.cmd_run(ns(app="gymtracker", channel="analysis", force=True))
    assert coworkhub.load_state()["channels"]["gymtracker/analysis"]["last_result"] == "ok"

    # --- 7. status.html: apps rendered, run history + relative times + pills present ---
    coworkhub.cmd_status(ns())
    page = coworkhub.STATUS_PATH.read_text(encoding="utf-8")
    assert "gymtracker" in page and "tachyread" in page and "ghost" in page and "mfapp" in page
    assert "Recent runs" in page and "data-ts=" in page and "class='pill" in page
    assert coworkhub.fmt_age(time.time() - 7200).startswith("2h")
    assert coworkhub.fmt_age(None) == "-"

    # --- 8. malformed request tolerated ---
    req = tr / "journey-cowork-request.json"
    req.write_text("garbage{", encoding="utf-8")
    os.utime(req, (now, now))
    j = next(c for c in coworkhub.scan_all(coworkhub.load_config(), coworkhub.load_state())
             if c["app"] == "tachyread")
    assert j["note"] == "malformed request" and not j["pending"]

    # --- 9. lock blocks a sweep; a stale lock is stolen ---
    coworkhub.LOCK_PATH.write_text("999999", encoding="utf-8")
    before = n_logs()
    coworkhub.cmd_run(ns(app="gymtracker", channel="analysis", force=True))
    assert n_logs() == before, "fresh lock must block the sweep"
    stale_t = time.time() - 1000   # older than timeout_sec(60)+60
    os.utime(coworkhub.LOCK_PATH, (stale_t, stale_t))
    coworkhub.cmd_run(ns(app="gymtracker", channel="analysis", force=True))
    assert n_logs() == before + 1, "stale lock must be stolen"
    assert not coworkhub.LOCK_PATH.exists()

    # --- 10. agent error file (dead letter) surfaces the reason ---
    for p in [mf / "flat" / "reply.json"]:                 # old reply must not look fresh
        os.utime(p, (old, old))
    cfg["claude_cmd"] = [sys.executable, str(stub), "err"]
    write_cfg(cfg)
    coworkhub.cmd_run(ns(app="mfapp", channel="flat", force=True))
    st = coworkhub.load_state()["channels"]["mfapp/flat"]
    assert st["last_result"] == "error: agent reported: cannot comply", st
    cfg["claude_cmd"] = [sys.executable, str(stub)]
    write_cfg(cfg)

    # --- 11. requestHash correlation: echoed hash must match the declared one ---
    chans = coworkhub.scan_all(coworkhub.load_config(), coworkhub.load_state())
    flat = next(c for c in chans if c["app"] == "mfapp" and c["channel"] == "flat")
    assert flat["declared_hash"] == 42
    (mf / "flat" / "reply.json").write_text(json.dumps({"requestHash": 43}), encoding="utf-8")
    ok, detail, _ = coworkhub.verify_reply(flat, time.time() - 1)
    assert not ok and detail == "reply for stale request", (ok, detail)

    # --- 12. staleness flag ---
    deep_ctx = mf / "deep" / "context.json"
    deep_ctx.write_text(json.dumps({"task": "d2"}), encoding="utf-8")
    eight_days = time.time() - 8 * 86400
    os.utime(deep_ctx, (eight_days, eight_days))
    for p in (mf / "deep" / "inbox").glob("*.json"):
        os.utime(p, (eight_days - 86400, eight_days - 86400))
    chans = coworkhub.scan_all(coworkhub.load_config(), coworkhub.load_state())
    deep = next(c for c in chans if c["app"] == "mfapp" and c["channel"] == "deep")
    assert deep["stale"] and coworkhub._state_txt(deep) == "STALE"
    coworkhub.cmd_status(ns())
    assert "STALE" in coworkhub.STATUS_PATH.read_text(encoding="utf-8")

    # --- 13. runs.jsonl: one parseable line per dispatch ---
    lines = [json.loads(l) for l in coworkhub.RUNS_PATH.read_text(encoding="utf-8").splitlines()]
    assert len(lines) == n_logs(), (len(lines), n_logs())
    assert lines[-1]["result"] and "duration_sec" in lines[-1] and lines[-1]["log"]

    # --- 14. check command: PASS on a valid manifest, FAIL on a broken one ---
    coworkhub.cmd_check(ns(path=str(mf)))                  # must not raise
    mf2 = tmp / "mf2"
    mf2.mkdir()
    (mf2 / "cowork.json").write_text(json.dumps(
        {"protocol": "cowork-manifest", "protocolVersion": 1, "app": "broken",
         "channels": [{"name": "x", "request": ["x/req.json"]}]}), encoding="utf-8")
    try:
        coworkhub.cmd_check(ns(path=str(mf2)))
        assert False, "broken manifest must FAIL"
    except SystemExit as e:
        assert e.code == 1

    # --- 15. status.html carries the shared cowork panel per app; serve exposes the API ---
    import threading
    import urllib.request
    coworkhub.cmd_status(ns())
    page = coworkhub.STATUS_PATH.read_text(encoding="utf-8")
    assert "<cowork-panel mode='data' data-app='mfapp'>" in page and "const PANELS=" in page
    assert 'src="cowork.js"' in page and "stable sweep:" in page
    srv = coworkhub.make_server(0)
    port = srv.server_address[1]
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    try:
        body = urllib.request.urlopen(f"http://127.0.0.1:{port}/api/status").read().decode("utf-8")
        chans = json.loads(body)
        assert any(c["app"] == "mfapp" for c in chans) and not any("prompt" in c for c in chans)
        html_page = urllib.request.urlopen(f"http://127.0.0.1:{port}/").read().decode("utf-8")
        assert "cowork-panel" in html_page
        js = urllib.request.urlopen(f"http://127.0.0.1:{port}/cowork.js").read().decode("utf-8")
        assert "customElements.define" in js
        feed = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}/api/panels").read().decode("utf-8"))
        assert feed["mfapp"]["channels"] and feed["mfapp"]["actions"][0]["id"] == "run-all"
        assert b"sweep" in urllib.request.urlopen(f"http://127.0.0.1:{port}/sweep").read()
        before = n_logs()
        req = urllib.request.Request(f"http://127.0.0.1:{port}/api/run", method="POST",
                                     data=json.dumps({"app": "mfapp", "channel": "flat", "force": True}).encode(),
                                     headers={"content-type": "application/json"})
        r = urllib.request.urlopen(req)
        assert r.status == 202 and json.loads(r.read())["queued"]
        for _ in range(100):                       # the run happens on a worker thread
            if n_logs() > before:
                break
            time.sleep(0.1)
        assert n_logs() > before, "POST /api/run must dispatch"
    finally:
        srv.shutdown()

    # --- 16. shared data sources: fetched ONCE per sweep for every channel that needs them, cached by TTL ---
    counter = tmp / "garmin-calls.txt"
    fake_src = tmp / "fake_garmin.py"
    fake_src.write_text(
        "import sys, json, pathlib\n"
        "c = pathlib.Path(sys.argv[1]); c.write_text(str(int(c.read_text() or 0) + 1) if c.exists() else '1')\n"
        "pathlib.Path(sys.argv[2]).write_text(json.dumps({'bodyComp': [{'date': '2026-08-23', 'weightKg': 80.0}]}))\n",
        encoding="utf-8")
    src_app = tmp / "srcapp"
    for name in ("one", "two"):
        (src_app / name).mkdir(parents=True)
        (src_app / name / "request.json").write_text(json.dumps({"protocol": "srcapp", "payload": {"n": name}}), encoding="utf-8")
    (src_app / "cowork.json").write_text(json.dumps(
        {"protocol": "cowork-manifest", "protocolVersion": 1, "app": "srcapp",
         "channels": [{"name": "one", "request": ["one/request.json"], "replyPath": "one/reply.json", "sources": ["garmin"]},
                      {"name": "two", "request": ["two/request.json"], "replyPath": "two/reply.json"}]}), encoding="utf-8")
    cfg = coworkhub.load_config()
    cfg["apps"].append({"name": "srcapp", "kind": "manifest", "root": str(src_app)})
    cfg["sources"] = {"garmin": {"cmd": [sys.executable, str(fake_src), str(counter), "{out}"], "ttl_min": 60,
                                 "channels": ["srcapp/two", "gt/garmin-*"]}}
    write_cfg(cfg)
    coworkhub.cmd_run(ns(app="srcapp", force=True))
    assert counter.read_text() == "1", "the source must be fetched exactly once for two channels"
    assert (coworkhub.SOURCES_DIR / "garmin" / "latest.json").exists()
    prompts = [p.read_text(encoding="utf-8") for p in sorted(coworkhub.LOG_DIR.glob("srcapp-*.log"))]
    assert len(prompts) == 2 and all("DATA SOURCES" in p and "latest.json" in p for p in prompts), "both prompts point at the cache"
    coworkhub.cmd_run(ns(app="srcapp", force=True))
    assert counter.read_text() == "1", "a fresh cache is reused, the service is not hit again"
    coworkhub.cmd_run(ns(app="srcapp", channel="one", force=True, refresh_sources=True))
    assert counter.read_text() == "2", "--refresh-sources forces one new pull"
    # a failing fetch falls back to the last good file and is logged, never raises
    cfg["sources"]["garmin"]["cmd"] = [sys.executable, "-c", "import sys; sys.exit(3)"]
    write_cfg(cfg)
    coworkhub.cmd_run(ns(app="srcapp", channel="one", force=True, refresh_sources=True))
    last = [p for p in sorted(coworkhub.LOG_DIR.glob("srcapp-one-*.log"))][-1].read_text(encoding="utf-8")
    assert "STALE cache" in last
    coworkhub.cmd_sources(ns(fetch=None, force=False))  # lists without raising

    # --- 17. sync log + digest + brief ---
    events = coworkhub.read_log(1)
    kinds = {e["kind"] for e in events}
    assert {"sweep", "source", "dispatch"} <= kinds, kinds
    dg = coworkhub.log_digest(1)
    assert dg["sources"]["garmin"]["fetched"] >= 2 and dg["sources"]["garmin"]["cache"] >= 1 and dg["sources"]["garmin"]["error"] >= 1
    assert dg["dispatches"]["ok"] >= 1 and "srcapp/one" in dg["channels"]
    assert "Sync activity" in coworkhub.digest_text(dg) and "**Sync activity**" in coworkhub.digest_text(dg, md=True)
    coworkhub.cmd_log(ns(days=1, md=False, json=False))
    coworkhub.cmd_brief(ns(period="daily", print=False))
    req = json.loads((coworkhub.BRIEFS_DIR / "daily" / "request.json").read_text(encoding="utf-8"))
    assert req["protocol"] == "coworkhub-brief" and req["requestHash"] and req["payload"]["digest"]["events"] >= 3
    assert any(a["name"] == "briefs" for a in coworkhub.load_config()["apps"]), "briefs folder auto-registered"
    coworkhub.cmd_check(ns(path=str(coworkhub.BRIEFS_DIR)))   # a valid manifest app
    coworkhub.cmd_run(ns(app="briefs", channel="daily"))       # the stub answers it like any other channel
    assert (coworkhub.BRIEFS_DIR / "daily" / "reply.json").exists()
    (coworkhub.BRIEFS_DIR / "daily" / "reply.json").write_text(json.dumps(
        {"requestHash": req["requestHash"], "reply": "All quiet: 3 dispatches ok, garmin cached."}), encoding="utf-8")
    coworkhub.cmd_status(ns())
    assert "Latest daily brief" in coworkhub.STATUS_PATH.read_text(encoding="utf-8")

print("OK")
