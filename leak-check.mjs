// Leak check (house standard 26): the maker's and the readers' own data never goes to GitHub.
// Looks at what git tracks (and, by default, at every file name the history ever held) for things that
// are a person's data rather than the app: backups and exports, cowork hand-off files, fitness files,
// recordings and photos of a person, sign-in files, home folders, email addresses, GPS tracks, and any
// string listed in the private never-publish list.
//
//   node leak-check.mjs                 every app in apps.json, the hub, the published site, LanguageLab
//   node leak-check.mjs <folder> ...    just these repos (run it from an app: node ../CoworkSyncHub/leak-check.mjs .)
//   --no-history                        skip the look through past commits (faster)
//   --json                              machine-readable
// Exit code 1 when anything is found.
//
// Never-publish list: one string per line in ~/.adervec-runner/never-publish.txt (outside every repo):
// a street, a phone number, a book title only you would have. Any tracked file holding one fails.
// A finding that is deliberate, made-up data is excused by listing its path (or a folder ending in /)
// in the repo's own .leak-ok file, one per line, with a reason after a #.
// ponytail: past commits are checked by file NAME only, not by content; text files over 2 MB are skipped.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HUB = path.dirname(fileURLToPath(import.meta.url)), GITHUB = path.dirname(HUB);
const git = (root, ...args) => { try { return execFileSync('git', ['-C', root, '-c', 'core.quotepath=off', ...args], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; } };

// a file NAME that is a person's data, whatever is inside
const NAMES = [
  [/(^|\/)adervec-(backup|before-restore)-[^/]*\.json$/i, 'a hub backup file'],
  [/(^|\/)[^/]*(backup|export)[^/]*\.(json|csv|zip)$/i, 'a backup or export'],
  [/(^|\/)(request|reply|context)\.json$/i, 'a cowork hand-off file'],
  [/(^|\/)(BRIEF\.md|activity-log\.md)$/, 'an app brief written from your data'],
  [/(^|\/)(MorningBrief|Cowork Link Folders)\//i, 'the daily brief folder'],
  [/\.(fit|gpx|tcx)$/i, 'a recorded activity (route, heart rate)'],
  [/(^|\/)[^/]*biometrics[^/]*\.json$/i, 'body measurements'],
  [/(^|\/)(recordings?|takes|uploads|my[-_ ]?data)\/.+\.(webm|wav|m4a|mp3|ogg|mp4|mov)$/i, 'a recording of a person'],
  [/(^|\/)(progress|physique|uploads|my[-_ ]?photos)\/.+\.(jpe?g|png|heic|webp)$/i, 'a photo of a person'],
  [/(^|\/)(\.env(\.(?!example$|sample$|template$)[\w-]+)?|[^/]*-token\.json|client_secret[^/]*\.json|\.garminconnect\/.*|garth\/.*|oauth[12]?_token\.json)$/i, 'a sign-in or secret file'],
];
// made-up data for tests and demos lives here; a data-shaped NAME in these folders is not a finding
const SAMPLE = /(^|\/)(tests?|__tests__|fixtures?|samples?|examples?|demo|mocks?|e2e|spec)\//i;
const TEXT = /\.(js|mjs|cjs|jsx|ts|tsx|json|html?|css|md|txt|csv|ya?ml|py|ps1|sh|toml|xml|svg|webmanifest)$/i;
const SKIP = /(^|\/)(node_modules|dist|build|vendor|\.git)\/|package-lock\.json$|\.min\.(js|css)$/;
const CREDITS = /licen[cs]e|notice|credits|third[_-]?party|authors|contributors|attribution|security\.md|code_of_conduct/i;
const HOMEDIR = /[A-Za-z]:[/\\]+Users[/\\]+(?!Public\b|Default\b|runneradmin\b|you\b|me\b|name\b|someone\b|user(name)?\b|<|\.\.\.)[^\\/"'<>\s)]+|\/(?:Users|home)\/(?!runner\b|you\b|me\b|name\b|user(name)?\b|<)[a-z][\w.-]{2,}\//i;
const EMAIL = /\b[\w.+-]+@[\w-]+\.[A-Za-z]{2,}\b/g;
const SAFE_MAIL = /noreply|no-reply|@example\.|@users\.|@anthropic\.com$|@sentry\.|@\d|^(git|you|me|name|user|someone|email|test|ada|reader|[a-z]{1,2})@/i;
const COORD = /-?\d{1,3}\.\d{5,}\s*[,;]\s*-?\d{1,3}\.\d{5,}/g; // a latitude/longitude pair to about a metre

function neverPublish() {
  const f = path.join(os.homedir(), '.adervec-runner', 'never-publish.txt');
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length >= 4 && !l.startsWith('#'));
}

// -> [{ kind, where, what, note? }]   kind: 'name' | 'content' | 'history' | 'listed' | 'path'
// An entry with note: true is worth knowing but is not a finding: it never fails a check or stops a push.
export function scan(root, { history = true, never = neverPublish() } = {}) {
  const out = [], tracked = git(root, 'ls-files').split('\n').filter(Boolean);
  const okFile = path.join(root, '.leak-ok');
  const okd = existsSync(okFile) ? readFileSync(okFile, 'utf8').split(/\r?\n/).map((l) => l.replace(/#.*/, '').trim()).filter(Boolean) : [];
  const excused = (f) => okd.some((p) => (p.endsWith('/') ? f.startsWith(p) : f === p));
  const byName = (f) => { if (SAMPLE.test(f)) return null; const hit = NAMES.find(([re]) => re.test(f)); return hit ? hit[1] : null; };
  const lower = never.map((s) => s.toLowerCase());
  for (const f of tracked) {
    if (SKIP.test(f) || excused(f)) continue;
    const what = byName(f);
    if (what) out.push({ kind: 'name', where: f, what });
    if (!TEXT.test(f)) continue;
    let t; try { if (statSync(path.join(root, f)).size > 2e6) continue; t = readFileSync(path.join(root, f), 'utf8'); } catch { continue; }
    const low = lower.length ? t.toLowerCase() : '';
    lower.forEach((s, i) => { if (low.includes(s)) out.push({ kind: 'listed', where: f, what: 'holds a never-publish string (line ' + (i + 1) + ' of your list)' }); });
    const home = HOMEDIR.exec(t);
    if (home) out.push({ kind: 'path', note: true, where: f, what: 'a home folder path: ' + home[0].slice(0, 40) }); // noted only: the maker does not count a bare path as a leak
    if (!CREDITS.test(f)) {
      const mail = (t.match(EMAIL) || []).find((m) => !SAFE_MAIL.test(m) && !/\.(png|jpe?g|svg|js|css|json)$/i.test(m));
      if (mail) out.push({ kind: 'content', where: f, what: 'an email address: ' + mail.replace(/^(.).*(@.*)$/, '$1…$2') });
    }
    const coords = t.match(COORD);
    if (coords && coords.length >= 5 && !SAMPLE.test(f)) out.push({ kind: 'content', where: f, what: coords.length + ' GPS coordinates (a route or a place?)' });
  }
  if (history) { // a file deleted later is still downloadable from the history
    const now = new Set(tracked), seen = new Set();
    for (const f of git(root, 'log', '--all', '--diff-filter=A', '--name-only', '--format=').split('\n')) {
      if (!f || now.has(f) || seen.has(f) || SKIP.test(f) || excused(f)) continue;
      seen.add(f);
      const what = byName(f);
      if (what) out.push({ kind: 'history', where: f, what: what + ', deleted but still in the history' });
    }
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), dirs = argv.filter((a) => !a.startsWith('--'));
  const targets = dirs.length ? dirs.map((d) => path.resolve(d))
    : [...JSON.parse(readFileSync(path.join(HUB, 'apps.json'), 'utf8')).map((a) => path.join(GITHUB, a.dir)), HUB, path.join(HUB, 'site'), path.join(GITHUB, 'LanguageLab')].filter((d) => existsSync(d));
  const never = neverPublish(), all = {};
  const notes = {};
  for (const d of targets) {
    const name = path.relative(GITHUB, d) || path.basename(d), found = scan(d, { history: !argv.includes('--no-history'), never });
    all[name] = found.filter((x) => !x.note); notes[name] = found.filter((x) => x.note);
  }
  const total = Object.values(all).reduce((n, l) => n + l.length, 0);
  if (argv.includes('--json')) console.log(JSON.stringify(all, null, 1));
  else {
    for (const [name, list] of Object.entries(all)) {
      console.log((list.length ? 'LEAK  ' : 'clean ') + name + (list.length ? '  (' + list.length + ')' : ''));
      list.slice(0, 40).forEach((x) => console.log('   ' + x.where + '  <- ' + x.what));
      if (notes[name].length) console.log('   (noted, not a finding: ' + notes[name].length + ' file(s) hold a home folder path)');
      if (list.length > 40) console.log('   … and ' + (list.length - 40) + ' more');
    }
    console.log(total ? `\n${total} finding(s). Remove the file from git (and from the history if it was ever pushed), or list a made-up one in .leak-ok.` : '\nleak-check: nothing found' + (never.length ? '' : ' (no never-publish list yet: ~/.adervec-runner/never-publish.txt)'));
  }
  process.exit(total ? 1 : 0);
}
