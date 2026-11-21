"""The maker's local review page: every project's state, the standards and who falls short, to-dos, leaks, overlaps, roadmap.

  python review.py            gather everything and write ../_review/index.html
  python review.py --open     ...and open it in the browser
  python review.py --quick    skip the slow network lookups (CI, live sites, pull requests, repo traffic)

The page is for local reading only. It is written OUTSIDE every repo (GitHub/_review/), so it cannot be
committed or published; only this generator and its empty template (review.html) live in the repo.
Hand-kept notes (roadmap, decisions, what is waiting on the maker, per-app notes) are read from
../_review/notes.json; each run also appends its totals to ../_review/history.json for the trend.
"""
import json
import re
import subprocess
import sys
import time
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import portal

BASE = Path(__file__).resolve().parent
GITHUB = BASE.parent
OUT = GITHUB / "_review"
EXTRA = ["MacroTrackro", "LanguageLab"]  # folders worth watching that may not be in apps.json yet
# which house standard each check column enforces (HOUSE-STANDARDS.md numbers)
STANDARD_OF = {"drive": 1, "pfp": 1, "font": 2, "cowork": 3, "license": 4, "ci": 5, "data": 6, "gated": 7, "live": 7, "3p": 8,
               "updates": 9, "whatsnew": 9, "days": 10, "branch": 11, "a11y": 12, "crash": 13, "theme": 14, "about": 15,
               "aireview": 18, "notes": 19, "i18n": 20, "sec": 22, "supply": 22, "datainv": 23, "themes": 24, "ledger": 25,
               "leak": 26, "overlap": 27}
# the order gaps should be worked in (the adoption order put to the maker); anything else follows in column order
ORDER = ["leak", "sec", "supply", "datainv", "data", "ci", "gated", "live", "drive", "pfp", "themes", "ledger", "overlap", "i18n"]
GROUP = {"lift": "Fitness and body", "cardio": "Fitness and body", "ride": "Fitness and body", "checkin": "Fitness and body", "cook": "Fitness and body",
         "read": "Reading, speech and language", "speak": "Reading, speech and language", "study": "Reading, speech and language", "write": "Reading, speech and language",
         "practice": "Music", "compose": "Music", "listen": "Music", "hub": "Hub"}
GROUP_OF_DIR = {"MacroTrackro": "Fitness and body", "LanguageLab": "Reading, speech and language"}
BOTS = ("dependabot", "app/dependabot", "github-actions", "app/github-actions")


def run(*cmd, cwd=None):
    r = subprocess.run(list(cmd), cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    return r.stdout.strip() if r.returncode == 0 else ""


def node_json(*args):
    out = subprocess.run(["node", *args], cwd=BASE, capture_output=True, text=True, encoding="utf-8", errors="replace").stdout
    try:
        return json.loads(out)
    except ValueError:
        return None


def git_state(root):
    if not (root / ".git").exists():
        return {}
    last = run("git", "-C", str(root), "log", "-1", "--format=%cI|%s").split("|", 1)
    unpushed = run("git", "-C", str(root), "rev-list", "--count", "@{u}..HEAD")
    return {"branch": run("git", "-C", str(root), "rev-parse", "--abbrev-ref", "HEAD"),
            "dirty": len([l for l in run("git", "-C", str(root), "status", "--porcelain").splitlines() if l.strip()]),
            "unpushed": int(unpushed) if unpushed.isdigit() else 0,
            "last": last[0] if last and last[0] else "", "subject": last[1] if len(last) > 1 else ""}


def local_todos(root):
    """What the repo itself says is still to do: open boxes in TODO.md, TODO/FIXME comments, and the count of `ponytail:` shortcuts."""
    out = {"file": [], "code": [], "ponytail": 0}
    for name in ("TODO.md", "ROADMAP.md", "BACKLOG.md"):
        f = root / name
        if f.exists():
            for line in f.read_text(encoding="utf-8", errors="replace").splitlines():
                m = re.match(r"\s*[-*] \[ \]\s+(.+)", line)
                if m:
                    out["file"].append(re.sub(r"[*_`]", "", m.group(1)).strip()[:200])
    if (root / ".git").exists():
        skip = [":!*node_modules*", ":!*vendor*", ":!*.min.*", ":!*dist/*", ":!*package-lock.json", ":!*.md", ":!*locales/*", ":!*.json"]
        for line in run("git", "-C", str(root), "grep", "-n", "-I", "-E", r"\b(TODO|FIXME|HACK)\b[:(]", "--", *skip).splitlines()[:40]:
            parts = line.split(":", 2)
            if len(parts) == 3:
                out["code"].append(f"{parts[0]}:{parts[1]}  {parts[2].strip()[:140]}")
        out["ponytail"] = len(run("git", "-C", str(root), "grep", "-n", "-I", "ponytail:", "--", *skip).splitlines())
    return out


def remote_state(project, quick):
    """Visibility, stars, CI, the live site, open pull requests and issues, 14-day repo traffic. Counts only: GitHub gives no visitor names."""
    root, out = GITHUB / project["dir"], {}
    if quick or not (root / ".git").exists():
        return out
    try:
        j = json.loads(run("gh", "repo", "view", "--json", "visibility,stargazerCount,forkCount,nameWithOwner", cwd=root))
        out.update(visibility=j["visibility"], stars=j["stargazerCount"], forks=j["forkCount"])
        repo = j["nameWithOwner"]
        out["ci"] = portal._ci_state(repo.split("/")[1])
        for kind in ("views", "clones"):
            t = run("gh", "api", f"repos/{repo}/traffic/{kind}", cwd=root)
            if t:
                tj = json.loads(t)
                out[kind] = [tj.get("count", 0), tj.get("uniques", 0)]
        out["open"] = []
        for what in ("pr", "issue"):
            for x in json.loads(run("gh", what, "list", "--state", "open", "--limit", "50", "--json", "number,title,author,createdAt", cwd=root) or "[]"):
                who = x["author"]["login"]
                out["open"].append({"kind": "pull request" if what == "pr" else "issue", "n": x["number"], "title": x["title"][:120], "by": who,
                                    "since": x["createdAt"][:10], "outside": who.lower() not in BOTS and who.lower() != portal.USER.lower(), "bot": who.lower() in BOTS})
    except (ValueError, KeyError):
        pass
    if project.get("url"):
        out["live"] = portal._live_state(project["url"])
    return out


def standards_text():
    """[{n, title, text}] from HOUSE-STANDARDS.md."""
    s = (BASE / "HOUSE-STANDARDS.md").read_text(encoding="utf-8").replace("\r\n", "\n")
    body = s[s.index("## The standards"):s.index("## Working habits")]
    out = []
    for m in re.finditer(r"(?ms)^(\d+)\. \*\*(.+?)\*\*(.*?)(?=^\d+\. \*\*|\Z)", body):
        title = re.sub(r"\s+", " ", m.group(2)).strip(" .:")
        out.append({"n": int(m.group(1)), "title": title, "text": (m.group(1) + ". " + m.group(2) + m.group(3)).strip()})
    return out


def tasks_for(p, checks, leaks, notes):
    """Everything open for one project, most urgent first: [{pri 1-4, source, key, text}]. pri 1 = urgent, 2 = a gap, 3 = a warning or loose end, 4 = someday."""
    label, order = dict(checks), ORDER + [k for k, _ in checks if k not in ORDER]
    out = []
    add = lambda pri, source, text, key="": out.append({"pri": pri, "source": source, "key": key, "text": text})
    for n in (notes.get("apps", {}).get(p["slug"], {}) or {}).get("todos", []):
        add(2, "note", n)
    found = leaks.get(p["dir"], [])
    for x in found[:5]:
        add(1, "leak", f"Remove personal data from the repo: {x['where']} ({x['what']})", "leak")
    if len(found) > 5:
        add(1, "leak", f"...and {len(found) - 5} more leak findings", "leak")
    if p.get("ci") == "FAIL":
        add(1, "CI", "The last CI run failed", "ci")
    if p.get("live") not in (None, "", "-", "200"):
        add(1, "live site", f"The live site answered {p['live']}", "live")
    for x in p.get("open", []):
        if x["outside"]:
            add(2, "GitHub", f"Reply to {x['kind']} #{x['n']} from {x['by']}, open since {x['since']}: {x['title']}")
    cells = p.get("cells", {})
    for k in order:
        st, note = (cells.get(k) or ["-", ""])[:2]
        if k == "leak" and found:
            continue  # already listed finding by finding
        if st == "FAIL":
            add(2, "standard", f"{label.get(k, k)}: {note or 'fails'}", k)
        elif st in ("warn", "?"):
            add(3, "standard", f"{label.get(k, k)}: {note or st}", k)
    g = p.get("git", {})
    if g.get("dirty"):
        add(3, "repo", f"{g['dirty']} uncommitted file(s) in the working folder")
    if g.get("unpushed"):
        add(3, "repo", f"{g['unpushed']} commit(s) not pushed")
    bots = [x for x in p.get("open", []) if x["bot"]]
    if bots:
        add(4, "GitHub", f"{len(bots)} automated update(s) waiting to be merged or closed")
    mine = [x for x in p.get("open", []) if not x["bot"] and not x["outside"]]
    if mine:
        add(4, "GitHub", f"{len(mine)} of your own pull request(s) or issue(s) still open")
    for t in p["todo"]["file"]:
        add(4, "to-do file", t)
    for t in p["todo"]["code"][:10]:
        add(4, "code note", t)
    if p["todo"]["ponytail"]:
        add(4, "code note", f"{p['todo']['ponytail']} deliberate shortcuts marked `ponytail:` (list them with /ponytail-debt in its session)")
    out.sort(key=lambda t: t["pri"])  # stable: keeps the adoption order inside a priority
    return out


def main(argv):
    quick = "--quick" in argv
    t0 = time.time()
    notes_file = OUT / "notes.json"
    notes = json.loads(notes_file.read_text(encoding="utf-8")) if notes_file.exists() else {}
    projects = [{"slug": a["slug"], "dir": a["dir"], "title": a["title"], "kind": a.get("kind", ""), "tagline": a.get("tagline", ""),
                 "url": portal.app_url(a), "registered": True} for a in portal.APPS]
    known = {p["dir"] for p in projects}
    for d in EXTRA:
        if d not in known and (GITHUB / d).is_dir():
            projects.append({"slug": d, "dir": d, "title": d, "kind": "", "tagline": "", "url": "", "registered": False})
    projects.append({"slug": "CoworkSyncHub", "dir": "CoworkSyncHub", "title": "The hub (CoworkSyncHub)", "kind": "hub",
                     "tagline": "Portal, shared font.js, standards, backup, runner.", "url": f"https://{portal.USER}.github.io/portal/", "registered": False, "hub": True})
    for p in projects:
        p["group"] = GROUP_OF_DIR.get(p["dir"]) or GROUP.get(p["kind"], "Mind, craft and culture")

    print("standards...")
    std = node_json("standards.mjs", "--json") or {"checks": [], "apps": []}
    cells = {a["slug"]: a["cells"] for a in std["apps"]}
    for p in projects:
        if p["registered"]:
            p["cells"] = cells.get(p["slug"], {})
        elif not p.get("hub"):
            one = node_json("standards.mjs", "--dir", str(GITHUB / p["dir"]), "--json")
            p["cells"] = one["apps"][0]["cells"] if one and one["apps"] else {}
        else:
            p["cells"] = {}  # the hub is not an app: the app standards do not apply to it

    print("repos...")
    for p in projects:
        p["git"] = git_state(GITHUB / p["dir"])
        p["todo"] = local_todos(GITHUB / p["dir"])
    with ThreadPoolExecutor(8) as ex:
        for p, r in zip(projects, ex.map(lambda q: remote_state(q, quick), projects)):
            p.update(r)

    print("leaks...")
    leaks = node_json("leak-check.mjs", *[str(GITHUB / p["dir"]) for p in projects], str(BASE / "site"), "--json") or {}
    leaks = {k.replace("\\", "/"): v for k, v in leaks.items() if v}
    never = Path.home() / ".adervec-runner" / "never-publish.txt"
    never_n = len([l for l in never.read_text(encoding="utf-8").splitlines() if l.strip() and not l.startswith("#")]) if never.exists() else 0

    overlaps = [{"source": src, "state": st, "who": who, "what": what} for src, st, who, what in portal._overlaps()]
    for d in EXTRA:  # registers of folders not in apps.json yet
        f = GITHUB / d / "OVERLAPS.md"
        if f.exists() and d not in known:
            for line in f.read_text(encoding="utf-8", errors="replace").splitlines():
                m = re.match(r"\s*- \[(idea|planned|done|dropped)\]\s*(.+?):\s+(.+)", line)
                if m:
                    overlaps.append({"source": d, "state": m.group(1), "who": m.group(2), "what": m.group(3)})
    overlaps.sort(key=lambda o: ("planned", "idea", "done", "dropped").index(o["state"]))

    standards = standards_text()
    for s in standards:
        s["checks"] = [k for k, _ in std["checks"] if STANDARD_OF.get(k) == s["n"]]
    unmapped = [k for k, _ in std["checks"] if k not in STANDARD_OF]
    if unmapped:
        print("  note: check columns with no standard number in STANDARD_OF:", ", ".join(unmapped))

    for p in projects:
        p["tasks"] = tasks_for(p, std["checks"], leaks, notes)
        p["next"] = (notes.get("apps", {}).get(p["slug"], {}) or {}).get("next") or (p["tasks"][0]["text"] if p["tasks"] else "")
        p["note"] = (notes.get("apps", {}).get(p["slug"], {}) or {}).get("note", "")

    # the trend: one row per run (skipped for --quick, whose numbers are incomplete)
    hist_file = OUT / "history.json"
    history = json.loads(hist_file.read_text(encoding="utf-8")) if hist_file.exists() else []
    count = lambda p, s: sum(1 for v in p["cells"].values() if v and v[0] == s)
    now = {"t": int(time.time() * 1000), "fail": sum(count(p, "FAIL") for p in projects), "warn": sum(count(p, "warn") for p in projects),
           "leaks": sum(len(v) for v in leaks.values()), "tasks": sum(len([t for t in p["tasks"] if t["pri"] <= 2]) for p in projects),
           "per": {p["slug"]: [count(p, "FAIL"), count(p, "warn")] for p in projects}}
    prev = history[-1] if history else None
    OUT.mkdir(exist_ok=True)
    if not quick:
        history = (history + [now])[-300:]
        hist_file.write_text(json.dumps(history), encoding="utf-8")

    data = {"generated": now["t"], "quick": quick, "checks": std["checks"], "order": ORDER, "projects": projects, "standards": standards,
            "leaks": leaks, "neverList": never_n, "overlaps": overlaps, "notes": notes, "prev": prev,
            "trend": [{"t": h["t"], "fail": h["fail"], "warn": h["warn"]} for h in (history if not quick else history + [now])[-40:]]}
    page = (BASE / "review.html").read_text(encoding="utf-8").replace("/*DATA*/", json.dumps(data, ensure_ascii=False).replace("</", "<\\/"))
    (OUT / "index.html").write_text(page, encoding="utf-8")
    print(f"wrote {OUT / 'index.html'} ({len(projects)} projects, {sum(len(p['tasks']) for p in projects)} to-dos, {time.time() - t0:.0f}s). Local only: not in any repo.")
    if "--open" in argv:
        webbrowser.open((OUT / "index.html").as_uri())


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    main(sys.argv[1:])
