"""The maker's local review page: every project's state, the standards and who falls short, leaks, overlaps, roadmap.

  python review.py            gather everything and write ../_review/index.html
  python review.py --open     ...and open it in the browser
  python review.py --quick    skip the slow network lookups (CI, live sites, repo traffic)

The page is for local reading only. It is written OUTSIDE every repo (GitHub/_review/), so it cannot be
committed or published; only this generator and its empty template (review.html) live in the repo.
Hand-kept notes (roadmap, decisions, what is waiting on the maker) are read from ../_review/notes.json.
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


def remote_state(project, quick):
    """Visibility, stars, CI, the live site and 14-day repo traffic: counts only, GitHub gives no names."""
    root, out = GITHUB / project["dir"], {}
    if quick or not (root / ".git").exists():
        return out
    info = run("gh", "repo", "view", "--json", "visibility,stargazerCount,forkCount,nameWithOwner", cwd=root)
    try:
        j = json.loads(info)
        out.update(visibility=j["visibility"], stars=j["stargazerCount"], forks=j["forkCount"])
        repo = j["nameWithOwner"]
        out["ci"] = portal._ci_state(repo.split("/")[1])
        for kind in ("views", "clones"):
            t = run("gh", "api", f"repos/{repo}/traffic/{kind}", cwd=root)
            if t:
                tj = json.loads(t)
                out[kind] = [tj.get("count", 0), tj.get("uniques", 0)]
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


def main(argv):
    quick = "--quick" in argv
    t0 = time.time()
    projects = [{"slug": a["slug"], "dir": a["dir"], "title": a["title"], "kind": a.get("kind", ""), "tagline": a.get("tagline", ""),
                 "url": portal.app_url(a), "registered": True} for a in portal.APPS]
    known = {p["dir"] for p in projects}
    for d in EXTRA:
        if d not in known and (GITHUB / d).is_dir():
            projects.append({"slug": d, "dir": d, "title": d, "kind": "", "tagline": "", "url": "", "registered": False})
    projects.append({"slug": "CoworkSyncHub", "dir": "CoworkSyncHub", "title": "The hub (CoworkSyncHub)", "kind": "hub",
                     "tagline": "Portal, shared font.js, standards, backup, runner.", "url": f"https://{portal.USER}.github.io/portal/", "registered": False, "hub": True})

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

    notes_file = OUT / "notes.json"
    notes = json.loads(notes_file.read_text(encoding="utf-8")) if notes_file.exists() else {}
    data = {"generated": int(time.time() * 1000), "checks": std["checks"], "projects": projects, "standards": standards,
            "leaks": leaks, "neverList": never_n, "overlaps": overlaps, "notes": notes}
    OUT.mkdir(exist_ok=True)
    page = (BASE / "review.html").read_text(encoding="utf-8").replace("/*DATA*/", json.dumps(data, ensure_ascii=False).replace("</", "<\\/"))
    (OUT / "index.html").write_text(page, encoding="utf-8")
    print(f"wrote {OUT / 'index.html'} ({len(projects)} projects, {time.time() - t0:.0f}s). Local only: not in any repo.")
    if "--open" in argv:
        webbrowser.open((OUT / "index.html").as_uri())


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    main(sys.argv[1:])
