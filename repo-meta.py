"""Keep every public repo's GitHub description, homepage and topics in step with the hub (house standard 31).

  python repo-meta.py            show what differs
  python repo-meta.py --apply    make GitHub match (portal.py deploy runs this after every deploy)

The description is the app's tagline in apps.json, the homepage its live address, and the topics are
repo-meta.json's common, badge and per-app topics added to whatever the repo already has (a topic added by
hand is never removed). Private repos are left alone. Needs the GitHub CLI (gh), signed in.
"""
import json
import subprocess
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent
USER = "adervec"
TOPIC = __import__("re").compile(r"^[a-z0-9][a-z0-9-]{0,49}$")


def gh(*args):
    r = subprocess.run(["gh", *args], capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode:
        raise RuntimeError(r.stderr.strip()[:200])
    return r.stdout


def repo_of(folder):
    r = subprocess.run(["git", "-C", str(folder), "remote", "get-url", "origin"], capture_output=True, text=True)
    return r.stdout.strip().rstrip("/").split("/")[-1].removesuffix(".git") if r.returncode == 0 else None


def live(url):
    """only point a homepage at a site that answers (a new app may not be published yet)"""
    import urllib.request
    try:
        return urllib.request.urlopen(urllib.request.Request(url, method="HEAD", headers={"User-Agent": "repo-meta"}), timeout=15).status == 200
    except Exception:  # noqa: BLE001
        return False


def wanted():
    """{repo: (description, homepage, [topics])}"""
    meta = json.loads((BASE / "repo-meta.json").read_text(encoding="utf-8"))
    out = {}
    for a in json.loads((BASE / "apps.json").read_text(encoding="utf-8")):
        repo = repo_of(BASE.parent / a["dir"]) or a["slug"]
        topics = list(meta["common"])
        topics += [meta["badges"][b] for b in a.get("badges", []) if b in meta["badges"]]
        topics += meta["apps"].get(a["slug"], [])
        out[repo] = (a["tagline"][:350], f"https://{USER}.github.io/{a['slug']}/", topics)
    for repo, x in meta["extra"].items():
        out[repo] = (x["description"][:350], x["homepage"], x["topics"])
    return out


def main(apply):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    changed = 0
    for repo, (desc, home, topics) in wanted().items():
        try:
            cur = json.loads(gh("repo", "view", f"{USER}/{repo}", "--json", "description,homepageUrl,repositoryTopics,visibility"))
        except RuntimeError as e:
            print(f"skip {repo}: {e}")
            continue
        if cur["visibility"] != "PUBLIC":
            continue
        have = [t["name"] for t in cur.get("repositoryTopics") or []]
        add = [t for t in dict.fromkeys(topics) if TOPIC.match(t) and t not in have][: max(0, 20 - len(have))]
        todo = []
        if (cur.get("description") or "") != desc:
            todo += ["--description", desc]
        if (cur.get("homepageUrl") or "").rstrip("/") != home.rstrip("/") and live(home):
            todo += ["--homepage", home]
        if add:
            todo += ["--add-topic", ",".join(add)]
        if not todo:
            continue
        changed += 1
        print(f"{repo}: " + "; ".join(x for x in (("description" if "--description" in todo else ""), ("homepage" if "--homepage" in todo else ""),
                                                  (f"+{len(add)} topics ({', '.join(add)})" if add else "")) if x))
        if apply:
            try:
                gh("repo", "edit", f"{USER}/{repo}", *todo)
            except RuntimeError as e:
                print(f"   FAILED: {e}")
    print(f"{changed} repo(s) {'updated' if apply else 'differ (run with --apply)'}" if changed else "every public repo is up to date")


if __name__ == "__main__":
    main("--apply" in sys.argv)
