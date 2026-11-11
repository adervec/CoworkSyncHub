// standards.mjs — check every app on the portal against the house standards and print a grid.
//
//   node standards.mjs              all portal apps (reads APPS from portal.py)
//   node standards.mjs gym tachy    only apps whose slug or folder starts with these
//   node standards.mjs -v           also print why each check failed or warned
//   node standards.mjs --offline    skip the GitHub API (deploy-gating check becomes "?")
//   node standards.mjs --selftest   check the rules themselves on small samples
//
// The checks read the source, they do not run the apps, so they are heuristics: a PASS means the
// expected pieces are present, not that they work. Each app's own tests cover "works".
// The standards themselves are listed in CHECKS below; COWORK is reported but its definition is
// still open.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HUB = path.dirname(fileURLToPath(import.meta.url));
const GITHUB = path.dirname(HUB);
const USER = 'adervec';

// ---- approved exceptions to "no third-party requests" (user, 2026-11-10) --------------------------
// Google sign-in for Drive sync is allowed everywhere; these are per app.
// Map tiles are an approved exception for any app with a map.
const ALWAYS_OK = /^(tile\.openstreetmap\.org|[a-c]\.tile\.openstreetmap\.org|adervec\.github\.io|accounts\.google\.com|apis\.google\.com|www\.googleapis\.com|oauth2\.googleapis\.com|[a-z0-9-]+\.googleusercontent\.com)$/;
const EXCEPTIONS = {
  Run315: /tile|openstreetmap|arcgisonline|carto|stadiamaps|thunderforest/, // map tiles
  Tachyread: /fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|tessdata|unpkg\.com/, // font loader, MediaPipe, Tesseract, pdf.js
  BodybuildingProgressCoach: /cdn\.jsdelivr\.net|storage\.googleapis\.com/, // MediaPipe pose models
  HandwritingHelper: /cdn\.jsdelivr\.net|tessdata/, // pdf.js, Tesseract
  SpeechImprover: /cdnjs\.cloudflare\.com/, // pdf.js worker
  MarksmanApp: /cdn\.jsdelivr\.net/, // Pyodide (the Python runtime), a large library like MediaPipe
};
// Hosts that are links or API endpoints the user explicitly connects, not page loads.
const NOT_A_LOAD = /^(github\.com|www\.strava\.com|strava\.com|connect\.garmin\.com|api\.anthropic\.com|api\.elevenlabs\.io|archive\.org|commons\.wikimedia\.org|upload\.wikimedia\.org|[a-z]+\.wikipedia\.org|www\.youtube\.com|youtu\.be|open\.spotify\.com|music\.apple\.com|claude\.ai)$/;

// Tracked files that are authoring inputs, not part of the published app (per app folder).
const SOURCE_ONLY = {
  Mise: /^(alcohol-guide|coffee-guide|tea-guide|solid-protein-prep-guide|protein-mix-calculator|kitchen_masterclass)\.html$/, // extracted into src/data by scripts/extract.mjs
};

// ---- the portal's apps ----------------------------------------------------------------------------
function portalApps() {
  const src = readFileSync(path.join(HUB, 'portal.py'), 'utf8');
  const out = [];
  for (const m of src.matchAll(/dict\(slug="([^"]+)",[^)]*?dir=(?:"([^"]+)"|None)/gs)) if (m[2]) out.push({ slug: m[1], dir: m[2] });
  return out;
}

// ---- reading an app -------------------------------------------------------------------------------
const SRC_EXT = /\.(html?|m?js|jsx|tsx?|css|py)$/i;
const SKIP = /(^|\/)(node_modules|dist|build|_site|coverage|test|tests|__tests__|test-results|playwright-report|\.github|scripts|tools|_build|Guides|docs|data|content|vendor|static\/vendor|fonts|\.cache)\/|\.(test|spec)\.|\.min\.js$|generated|readingPassages|prose\d+\.js$|db\d*\.js$|feats/;
function git(dir, ...args) {
  try { return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; }
}
function load(app) {
  const root = path.join(GITHUB, app.dir);
  const files = git(root, 'ls-files').split('\n').filter(Boolean);
  const text = [];
  for (const f of files) {
    if (!SRC_EXT.test(f) || SKIP.test(f) || SOURCE_ONLY[app.dir]?.test(f)) continue;
    let t; try { t = readFileSync(path.join(root, f), 'utf8'); } catch { continue; }
    // drop inlined data blobs: a single very long line is data, not code
    text.push({ f, t: t.split('\n').filter((l) => l.length < 4000).join('\n') });
  }
  const all = text.map((x) => x.t).join('\n');
  // the same source with comments removed, for checks where a comment saying "never do X" must not count as doing X
  const code = all.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*|#|<!--)/.test(l)).map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1').replace(/\{?\/\*.*?\*\/\}?/g, '')).join('\n');
  const wf = path.join(root, '.github', 'workflows');
  const workflows = existsSync(wf) ? readdirSync(wf).filter((f) => /\.ya?ml$/.test(f)).map((f) => ({ f, t: readFileSync(path.join(wf, f), 'utf8') })) : [];
  return { app, root, files, text, all, code, workflows, has: (re) => re.test(all), count: (re) => (all.match(new RegExp(re, re.flags.includes('g') ? re.flags : re.flags + 'g')) || []).length };
}

// ---- the checks -----------------------------------------------------------------------------------
// Each returns [status, note]: 'ok' | 'warn' | 'FAIL' | '?' | '-' (not applicable)
// font.js counts only when the page really loads it (a <script src> or a script element created with
// that src); a comment that mentions the URL, or an inlined partial copy, does not.
const FONTJS = /<script[^>]*\ssrc\s*=\s*["']https:\/\/adervec\.github\.io\/font\.js|\.src\s*=\s*["']https:\/\/adervec\.github\.io\/font\.js|<script[^>]*\sdata-house\s*=\s*["']font\.js["']/; // ...or a full copy inlined by a single-file app's build, marked <script data-house="font.js">
const ok = (note = '') => ['ok', note], warn = (note) => ['warn', note], fail = (note) => ['FAIL', note];

const CHECKS = [
  ['drive', 'Drive private-folder sync', (a) => a.has(/appDataFolder|drive\.appdata/) ? ok() : fail('no drive.appdata sync')],
  ['pfp', 'Google picture when synced', (a) => {
    if (!a.has(/oauth2\/v3\/userinfo/)) return fail('never asks Google for the profile');
    // an <img> (or el('img'), createElement('img')) whose src is a variable named like the picture
    const drawn = /<img[^>]{0,240}(picture|pfp|\bpic\b|[a-z]Pic\b|gpic|avatar)/i.test(a.all)
      || /\bsrc\s*[:=]\s*[{(]?\s*[\w.()!?$]*(picture|Picture|\bpic\b|[a-z]Pic\b|avatar|Avatar)/.test(a.all)
      || /\.src\s*=\s*[\w.()!?]*(picture|pic|Pic|avatar)/.test(a.all);
    return drawn ? ok() : fail('fetches the profile but never draws the picture');
  }],
  ['font', 'Atkinson default + font choice', (a) => {
    if (a.has(FONTJS)) return a.has(/var\(--app-font/) ? (a.has(/app-font-picker|appFont\.(set|options)/) ? ok() : fail('no font picker')) : fail('loads font.js but nothing uses --app-font');
    return a.has(/Atkinson Hyperlegible/) && a.has(/fontFamily|font-family:\s*var\(--/) ? warn('own font system (not font.js)') : fail('no house font');
  }],
  ['cowork', 'Cowork: shared engine (or own) + manifest', (a) => {
    if (!a.has(/cowork-manifest|cowork\.json/)) return fail('no cowork manifest');
    if (!a.has(/github\.io\/cowork\.js/)) return warn('own cowork, no shared panel');
    // fs-mode apps should describe their channels (label, preview rows, undo); data-mode apps run their own engine
    const fsMount = a.has(/\.mount\(/), described = a.has(/\bpreview\s*[:(]/) && a.has(/\bchannels\s*:\s*\{/);
    return fsMount && !described ? warn('shared engine with defaults: give each channel a label, preview rows and undo') : ok();
  }],
  ['license', 'Licence, notices, privacy note', (a) => {
    const lic = a.files.find((f) => /^(LICEN[CS]E|COPYING)(\.md|\.txt)?$/i.test(f));
    if (!lic) return fail('no LICENSE');
    const bundles = a.files.some((f) => /\.(woff2?|ttf|otf|wasm)$/i.test(f) || /(^|\/)vendor\//.test(f)) || npmDeps(a).length > 0;
    const notices = a.files.some((f) => /(THIRD[-_ ]?PARTY|NOTICE|CREDITS)/i.test(f));
    if (bundles && !notices) return fail('bundles third-party code or fonts but has no notices file');
    return a.has(/private (app|application) folder|app-data folder|hidden (app )?folder|only this app can|Nothing is uploaded|no server|never (on|to) (a|any|my) server|stays on (this|your) device/i) ? ok() : warn('no in-app note on where data lives');
  }],
  ['ci', 'CI on every push', (a) => a.workflows.some((w) => /\bon:[\s\S]*\bpush\b/.test(w.t) && /(npm (run )?test|npm run (check|lint|typecheck|verify)|run_tests|node [\w./-]*(test|check|smoke|selftest|validate)|playwright test|vitest|pytest)/.test(w.t)) ? ok() : fail('no workflow runs the checks on push')],
  ['data', 'Export, import, erase, persist', (a) => {
    const miss = [];
    if (!a.has(/export|download[^\n]{0,60}(json|backup)|backup/i)) miss.push('export');
    if (!a.has(/import|restore/i)) miss.push('import');
    if (!a.has(/Erase everything|Erase all|Reset everything|Delete (all|everything)|deleteDatabase|eraseAll|wipe(All|Data)|factoryReset|clear (all|everything)/i)) miss.push('erase');
    if (!a.has(FONTJS) && !a.has(/storage\.persist\(/)) miss.push('persist');
    if (/localStorage\.clear\(\)/.test(a.code ?? a.all)) return fail('calls localStorage.clear(), which wipes every app on the shared origin');
    return miss.length ? fail('missing ' + miss.join(', ')) : ok();
  }],
  ['gated', 'Deploy only after tests pass', (a) => deployGated(a)],
  ['3p', 'No third-party requests', (a) => {
    const hosts = new Set();
    // Only what a page LOADS: <script src>, <link href>, CSS url(), ES import(), and the well-known CDNs
    // anywhere. Links the reader clicks and APIs the reader connects (Dropbox, Strava, Last.fm…) are not.
    for (const m of a.all.matchAll(/<script[^>]*\ssrc\s*=\s*["'](https?:\/\/[^"'\s]+)|<link[^>]*\shref\s*=\s*["'](https?:\/\/[^"'\s]+)|import\(\s*["'`](https?:\/\/[^"'`\s$]+)|url\(\s*["']?(https?:\/\/[^"')\s]+)|https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com|esm\.sh)\//g)) {
      const u = m[1] || m[2] || m[3] || m[4] || ('https://' + m[5] + '/');
      let h; try { h = new URL(u).host; } catch { continue; }
      if (/^<link[^>]*rel=["']?(preconnect|dns-prefetch|canonical|icon|me|author)/.test(m[0]) && !/fonts\.(googleapis|gstatic)/.test(h)) continue;
      if (ALWAYS_OK.test(h) || NOT_A_LOAD.test(h) || /^(localhost|127\.0\.0\.1)/.test(h)) continue;
      if (EXCEPTIONS[a.app.slug]?.test(h) || EXCEPTIONS[path.basename(a.app.dir)]?.test(h)) continue;
      hosts.add(h);
    }
    return hosts.size ? fail([...hosts].slice(0, 4).join(', ')) : ok();
  }],
  ['updates', 'Build shown + update notice', (a) => a.has(FONTJS) ? (a.has(/appUpdateNotice\s*=\s*false/) && !a.has(/updatefound|controllerchange|onNeedRefresh|needRefresh|version\.json|New version/) ? fail('turns off the shared notice without its own') : ok()) : (a.has(/updatefound|controllerchange|onNeedRefresh|needRefresh|version\.json|New version|New version|Update available/) ? warn('own update handling (not font.js)') : fail('no update notice'))],
  ['days', 'Local-day dates', (a) => {
    const bad = [];
    for (const { f, t } of a.text) if (!/(^|\/)(test[-_.]|selftest)|[-_.]test\.|\.test\./i.test(f)) t.split('\n').forEach((l, i) => {
      if (!/toISOString\(\)\s*\.\s*(slice|substring|substr)\(\s*0\s*,\s*10\s*\)|toISOString\(\)\s*\.\s*split\(\s*.T.\s*\)\s*\[\s*0\s*\]/.test(l)) return;
      if (/download|filename|fileName|\.json|\.md|\.csv|\.txt|\.html|\.ics|backup-|export|Generated|stamp/i.test(l)) return; // a file-name or print stamp
      if (/getTimezoneOffset/.test(l) || /^\s*(\/\/|\*|\/\*)/.test(l)) return; // already shifted to local time, or a comment
      bad.push(`${f}:${i + 1}`);
    });
    return bad.length ? fail(`${bad.length} UTC day(s): ${bad.slice(0, 3).join(', ')}${bad.length > 3 ? ' …' : ''}`) : ok();
  }],
  ['branch', 'Work on main (GymTracker model)', (a) => {
    const cur = git(a.root, 'branch', '--show-current');
    const others = git(a.root, 'branch', '-r').split('\n').map((s) => s.trim()).filter((b) => b && !/HEAD|\/main$|\/gh-pages$|dependabot|\/feat\//.test(b)); // short-lived feat/ branches are fine (GymTracker's model)
    if (cur !== 'main') return fail(`checked out on ${cur || '(detached)'}`);
    return others.length ? warn('other branches on GitHub: ' + others.map((b) => b.replace('origin/', '')).join(', ')) : ok();
  }],
  ['a11y', 'Accessibility floor', (a) => {
    if (!a.has(FONTJS)) return a.has(/user-scalable\s*=\s*no|maximum-scale\s*=\s*1/) ? warn('blocks zoom itself, with no reader option') : fail('no house accessibility floor (font.js)');
    return a.has(/<app-font-picker[^>]*\sno-zoom-option|setAttribute\(\s*['"]no-zoom-option/) ? warn('hides the zoom option') : ok();
  }],
  ['crash', 'Crashes shown, not swallowed', (a) => {
    const own = a.has(/window\.onerror|addEventListener\(\s*['"](error|unhandledrejection)|ErrorBoundary|componentDidCatch/);
    if (a.has(FONTJS)) return a.has(/appCrashNotice\s*=\s*false/) && !own ? fail('turns off the shared notice without its own') : ok();
    return own ? warn('own error handling (not font.js)') : fail('uncaught errors are silent');
  }],
  ['about', 'About panel + diagnostics + offline', (a) => a.has(FONTJS) ? (a.has(/<app-font-picker[^>]*\sno-about|setAttribute\(\s*['"]no-about/) && !a.has(/<app-about|createElement\(\s*['"]app-about/) ? fail('hides the About panel and places none') : ok()) : fail('no About panel (font.js not loaded)')],
  ['whatsnew', "What's new after updates", (a) => {
    const m = a.all.match(/name=["']app-whatsnew["'][^>]*content=["']([^"']+)["']|content=["']([^"']+)["'][^>]*name=["']app-whatsnew["']/);
    if (!m) return fail('no <meta name="app-whatsnew">');
    const file = (m[1] || m[2]).replace(/%BASE_URL%/g, '').replace(/^\.?\//, ''); // Vite's %BASE_URL% becomes the base path at build time
    const found = a.files.find((f) => f === file || f.endsWith('/' + file));
    if (!found) return fail(`declares ${file} but the repo has no such file`);
    try { const j = JSON.parse(readFileSync(path.join(a.root, found), 'utf8')); return Array.isArray(j) && j.length && Array.isArray(j[0].items) && j[0].items.length ? ok() : fail(found + ' is empty or not [{date, items}]'); } catch (e) { return fail(found + ' is not valid JSON'); }
  }],
  ['theme', 'Default theme follows the device', (a) => {
    // Not applicable: MusicStudio's themes are per-album artwork palettes, not light/dark.
    if (/^MusicStudio$/.test(a.app.dir)) return ['-', 'per-album palettes, not light/dark'];
    // Only the web app's own colour themes count (not a desktop GUI, not "themes" as subject tags).
    const web = a.text.filter((x) => !/\.py$/.test(x.f)).map((x) => x.t).join('\n');
    const hasThemes = /data-theme|\bsetTheme\(|\bapplyTheme\(|themechip|theme-quick|(light|dark)[^\n]{0,30}\btheme\b|\btheme\b[^\n]{0,30}(light|dark)/i.test(web);
    if (!hasThemes) return ['-', 'single theme'];
    return a.has(/prefers-color-scheme|systemTheme\(\)/) ? ok() : fail('default theme ignores the device light/dark setting');
  }],
  ['live', 'Live check + release tag after deploy', (a) => {
    const viaWorkflow = a.workflows.some((w) => /CoworkSyncHub\/\.github\/workflows\/after-deploy\.yml/.test(w.t));
    const viaScript = ['scripts/deploy.mjs', 'deploy.sh'].map((f) => path.join(a.root, f)).filter(existsSync).some((f) => /live-check\.mjs/.test(readFileSync(f, 'utf8')));
    const parent = path.dirname(a.root), viaParent = path.basename(a.root) === 'site' && existsSync(path.join(parent, 'deploy.sh')) && /live-check\.mjs/.test(readFileSync(path.join(parent, 'deploy.sh'), 'utf8'));
    return viaWorkflow || viaScript || viaParent ? ok() : fail('deploy does not check the live site or tag the release');
  }],
  ['notes', 'Agent notes import the house standards', (a) => {
    const here = path.join(a.root, 'CLAUDE.md'), up = path.join(path.dirname(a.root), 'CLAUDE.md');
    const f = existsSync(here) ? here : (path.basename(a.root) === 'site' && existsSync(up) ? up : null);
    if (!f) return fail('no CLAUDE.md');
    return /HOUSE-STANDARDS\.md/.test(readFileSync(f, 'utf8')) ? ok() : fail('CLAUDE.md does not import ../CoworkSyncHub/HOUSE-STANDARDS.md');
  }],
];

function npmDeps(a) {
  for (const p of ['package.json', 'app/package.json', 'client/package.json', 'speechimprover/package.json']) {
    const f = path.join(a.root, p);
    if (existsSync(f)) { try { return Object.keys(JSON.parse(readFileSync(f, 'utf8')).dependencies || {}); } catch { return []; } }
  }
  return [];
}

let OFFLINE = false;
const pagesCache = {};
function deployGated(a) {
  const repo = git(a.root, 'remote', 'get-url', 'origin').replace(/.*github\.com[:/]/, '').replace(/\.git$/, '');
  const deployers = a.workflows.filter((w) => /deploy-pages|upload-pages-artifact|gh-pages|peaceiris/.test(w.t));
  if (!deployers.length) {
    // a local deploy script that runs the tests first also counts (Mise, the two static-site builds)
    const scripts = ['scripts/deploy.mjs', 'deploy.sh', 'portal.py'].map((f) => path.join(a.root, f)).filter(existsSync);
    if (scripts.some((f) => /npm test|run\(['"]npm test|node test_|run_tests/.test(readFileSync(f, 'utf8')))) return ok('local deploy script runs the tests');
    if (OFFLINE) return ['?', 'offline'];
    if (!(repo in pagesCache)) { try { pagesCache[repo] = JSON.parse(execFileSync('gh', ['api', `repos/${repo}/pages`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).build_type; } catch { pagesCache[repo] = null; } }
    return pagesCache[repo] === 'legacy' ? fail('Pages publishes straight from a branch push') : ['?', 'no deploy workflow found'];
  }
  const TEST = /(npm (run )?test|npm run (check|lint|typecheck|verify)|run_tests|node [\w./-]*(test|check|smoke|selftest|validate)|playwright test|vitest)/;
  const gatedBy = (w) => (/workflow_run:/.test(w.t) && /conclusion\s*==\s*'success'/.test(w.t)) || (TEST.test(w.t) && (/needs:/.test(w.t) || !/deploy-pages/.test(w.t) || /upload-pages-artifact/.test(w.t)));
  const bad = deployers.filter((w) => !gatedBy(w)).map((w) => w.f);
  return bad.length ? fail('deploys without tests: ' + bad.join(', ')) : ok();
}

// ---- output ---------------------------------------------------------------------------------------
function run(argv) {
  OFFLINE = argv.includes('--offline');
  const verbose = argv.includes('-v') || argv.includes('--verbose');
  const filters = argv.filter((x) => !x.startsWith('-')).map((x) => x.toLowerCase());
  const apps = portalApps().filter((a) => !filters.length || filters.some((f) => a.slug.toLowerCase().startsWith(f) || a.dir.toLowerCase().startsWith(f)));
  const W = 15, keys = CHECKS.map((c) => c[0]);
  console.log('App'.padEnd(W) + keys.map((k) => k.padStart(8)).join(''));
  const notes = [], totals = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const app of apps) {
    if (!existsSync(path.join(GITHUB, app.dir))) { console.log(app.slug.padEnd(W) + '  (folder missing: ' + app.dir + ')'); continue; }
    const a = load(app);
    const row = CHECKS.map(([k, , fn]) => { let r; try { r = fn(a); } catch (e) { r = ['?', 'check crashed: ' + e.message]; } if (r[0] === 'ok') totals[k]++; if (r[0] !== 'ok' && r[1]) notes.push(`${app.slug} · ${k}: ${r[0]} — ${r[1]}`); return r[0]; });
    console.log(app.slug.slice(0, W - 1).padEnd(W) + row.map((s) => s.padStart(8)).join(''));
  }
  console.log('passing'.padEnd(W) + keys.map((k) => `${totals[k]}/${apps.length}`.padStart(8)).join(''));
  console.log('\n' + CHECKS.map(([k, label]) => `${k} = ${label}`).join(' · '));
  if (verbose && notes.length) console.log('\n' + notes.join('\n'));
  else if (notes.length) console.log(`\n${notes.length} findings; add -v to list them.`);
}

// ---- --selftest: the rules on tiny samples, so a regex edit that breaks a check is caught --------
function selftest() {
  const fake = (all, files = ['LICENSE'], workflows = []) => ({ app: { slug: 'X', dir: 'X' }, root: HUB, files, workflows, text: [{ f: 'a.js', t: all }], all, has: (re) => re.test(all), count: () => 0 });
  const check = (k, a) => CHECKS.find((c) => c[0] === k)[2](a)[0];
  const eq = (got, want, what) => { if (got !== want) throw new Error(`${what}: got ${got}, want ${want}`); };
  eq(check('days', fake("const d = new Date().toISOString().slice(0, 10);")), 'FAIL', 'a UTC "today" fails');
  eq(check('days', fake("a.download = `x-${new Date().toISOString().slice(0, 10)}.json`;")), 'ok', 'a file-name stamp is exempt');
  eq(check('3p', fake('<link href="https://fonts.googleapis.com/css2?family=Inter">')), 'FAIL', 'Google Fonts fails');
  eq(check('3p', fake('<script src="https://adervec.github.io/font.js"></script><script src="https://accounts.google.com/gsi/client"></script>')), 'ok', 'own site and Google sign-in pass');
  eq(check('data', fake('<script src="https://adervec.github.io/font.js"></script> Export Import Erase everything')), 'ok', 'export+import+erase+font.js passes');
  eq(check('data', fake('Export Import Erase everything localStorage.clear()')), 'FAIL', 'localStorage.clear() fails');
  eq(check('pfp', fake('fetch("https://www.googleapis.com/oauth2/v3/userinfo") <img src="${esc(prof.picture)}">')), 'ok', 'a drawn picture passes');
  eq(check('pfp', fake('fetch("https://www.googleapis.com/oauth2/v3/userinfo") _profile = { picture: j.picture }')), 'FAIL', 'an undrawn picture fails');
  eq(check('gated', fake('', ['LICENSE'], [{ f: 'ci.yml', t: 'on:\n  push:\njobs:\n  test:\n    steps:\n      - run: npm test\n  deploy:\n    needs: test\n    steps:\n      - uses: actions/upload-pages-artifact@v3\n      - uses: actions/deploy-pages@v4' }])), 'ok', 'test then deploy passes');
  eq(check('gated', fake('', ['LICENSE'], [{ f: 'deploy.yml', t: 'on:\n  push:\njobs:\n  build:\n    steps:\n      - run: npm run build\n      - uses: actions/upload-pages-artifact@v3\n  deploy:\n    needs: build\n    steps:\n      - uses: actions/deploy-pages@v4' }])), 'FAIL', 'build then deploy without tests fails');
  eq(check('data', { ...fake('<script src="https://adervec.github.io/font.js"></script> Export Import Erase everything'), code: 'Export Import Erase everything' }), 'ok', 'a comment saying never localStorage.clear() is fine');
  eq(check('pfp', fake('fetch("https://www.googleapis.com/oauth2/v3/userinfo") <img src="${esc(drivePic)}">')), 'ok', 'a picture drawn from a variable passes');
  eq(check('3p', fake('<a href="https://www.openstreetmap.org/x">map</a> fetch("https://api.dropboxapi.com/2/files")')), 'ok', 'links and connected APIs are not page loads');
  eq(check('a11y', fake('/* house font: CoworkSyncHub/font.js, published at adervec.github.io/font.js */')), 'FAIL', 'a comment naming font.js is not loading it');
  eq(check('a11y', fake('<script src="https://adervec.github.io/font.js"></script>')), 'ok', 'a real font.js load passes');
  eq(check('theme', fake('const THEMES = [...new Set(works.flatMap(w => w.themes))]')), '-', 'subject-tag "themes" are not colour themes');
  eq(check('theme', fake('document.documentElement.setAttribute("data-theme", localStorage.getItem("t") || "ember")')), 'FAIL', 'a theme default that ignores the device fails');
  eq(check('theme', fake('data-theme ... matchMedia("(prefers-color-scheme: light)")')), 'ok', 'a device-aware default passes');
  eq(check('a11y', fake('<script data-house="font.js">(function(){})()</script>')), 'ok', 'a marked inlined copy of font.js counts');
  eq(check('updates', fake('<script src="https://adervec.github.io/font.js"></script> window.appUpdateNotice = false; fetch(BASE + "version.json")')), 'ok', 'an own version.json check counts as its own update notice');
  eq(check('a11y', fake('<script data-house="font.js">if (!this.hasAttribute("no-zoom-option")) {}</script><app-font-picker></app-font-picker>')), 'ok', "font.js's own source does not count as hiding the zoom option");
  eq(check('a11y', fake('<script src="https://adervec.github.io/font.js"></script><app-font-picker no-zoom-option></app-font-picker>')), 'warn', 'a picker that hides the zoom option warns');
  console.log('standards.mjs selftest: ok');
}

if (process.argv.includes('--selftest')) selftest(); else run(process.argv.slice(2));
