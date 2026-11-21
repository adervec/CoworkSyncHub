// standards.mjs — check every app on the portal against the house standards and print a grid.
//
//   node standards.mjs              all portal apps (reads apps.json)
//   node standards.mjs gym tachy    only apps whose slug or folder starts with these
//   node standards.mjs -v           also print why each check failed or warned
//   node standards.mjs --offline    skip the GitHub API (deploy-gating check becomes "?")
//   node standards.mjs --selftest   check the rules themselves on small samples
//
// The checks read the source, they do not run the apps, so they are heuristics: a PASS means the
// expected pieces are present, not that they work. Each app's own tests cover "works".
// The standards themselves are listed in CHECKS below; COWORK is reported but its definition is
// still open.
import { scan as leakScan } from './leak-check.mjs';
import { readFileSync, existsSync, readdirSync, statSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { coverage as i18nCoverage } from './i18n.mjs';

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
  return JSON.parse(readFileSync(path.join(HUB, 'apps.json'), 'utf8')).filter((a) => a.dir).map((a) => ({ slug: a.slug, dir: a.dir }));
}

// ---- reading an app -------------------------------------------------------------------------------
const SRC_EXT = /\.(html?|m?js|jsx|tsx?|css|py)$/i;
const SKIP = /(^|\/)(node_modules|dist|build|_site|coverage|test|tests|__tests__|test-results|playwright-report|\.github|scripts|tools|_build|Guides|docs|data|content|vendor|static\/vendor|fonts|\.cache)\/|\.(test|spec)\.|\.min\.js$|generated|readingPassages|prose\d+\.js$|db\d*\.js$|feats/;
function git(dir, ...args) {
  try { return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; }
}
function load(app) {
  const root = path.join(GITHUB, app.dir);
  // committed files plus new ones not yet committed (a session checks its own work in progress)
  const files = git(root, 'ls-files', '--cached', '--others', '--exclude-standard').split('\n').filter(Boolean);
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
  ['drive', 'Cloud sync to the private app folder', (a) => a.has(/appDataFolder|drive\.appdata|appFont\??\.(cloud|google)\b/) ? ok() : fail('no cloud sync (appFont.cloud, or Drive appdata)')],
  ['pfp', 'Google picture always visible (top bar)', (a) => {
    // font.js's shared sign-in (appFont.cloud) asks for the profile and feeds the corner avatar itself
    const house = a.has(/appFont\??\.(cloud|google)\b/);
    if (!house && !a.has(/oauth2\/v3\/userinfo/)) return fail('never asks Google for the profile');
    // the shared corner avatar, placed in the page and fed the account
    const shared = a.has(/<app-account|createElement\(\s*['"]app-account/) && (house || a.has(/setAccount\(/));
    // or the app's own avatar in an always-visible bar: GymTracker's banner identity, or a header sync chip with the picture
    const own = a.has(/id=["']app-identity["']|ti-pfp|gsync-pfp-sm|class="gpic"/) || a.has(/class=["']gav["']|i\.className\s*=\s*["']gav["']/);
    if (shared || own) return ok(own && !shared ? 'own header avatar' : '');
    return fail('the picture is not in an always-visible top bar (use <app-account> + appFont.setAccount)');
  }],
  ['font', 'Atkinson default + font choice', (a) => {
    if (a.has(FONTJS)) return a.has(/var\(--app-font/) ? (a.has(/app-font-picker|appFont\.(set|options)/) ? ok() : fail('no font picker')) : fail('loads font.js but nothing uses --app-font');
    return a.has(/Atkinson Hyperlegible/) && a.has(/fontFamily|font-family:\s*var\(--/) ? warn('own font system (not font.js)') : fail('no house font');
  }],
  ['cowork', 'Cowork: shared engine (or own) + manifest', (a) => {
    if (!a.has(/cowork-manifest|cowork\.json/)) return fail('no cowork manifest');
    if (!a.has(/github\.io\/cowork\.js/)) return warn('own cowork, no shared panel');
    // fs-mode apps should describe their channels (label, preview rows, undo); data-mode apps run their own engine
    const fsMount = a.has(/\b(cowork|cw)\.mount\(/), described = a.has(/\bpreview\s*[:(]/) && a.has(/\bchannels\s*:\s*\{/);
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
    // font.js's house theme list starts on System, which follows the device (standard 24)
    return a.has(/prefers-color-scheme|systemTheme\(\)|app-theme-picker|appFont\.themes\b/) ? ok() : fail('default theme ignores the device light/dark setting');
  }],
  ['themes', 'Shared base theme list offered (extras allowed)', (a) => {
    // Not applicable: MusicStudio's themes are per-album artwork palettes, not the app's own look.
    if (/^MusicStudio$/.test(a.app.dir)) return ['-', 'per-album palettes'];
    if (!a.has(/<app-theme-picker|appFont\??\.(themes|setTheme|theme\(|themeNow)/)) return fail('does not offer the shared base theme list (appFont.themes / <app-theme-picker>)');
    if (!a.has(/var\(\s*--t-(bg|surface|text|accent)|themeNow\(\)\.colors|app-theme-change/)) return fail('offers the list but never uses the palette (--t-* variables)');
    return ok();
  }],
  ['ledger', 'Sessions logged for the hub (logSession)', (a) => {
    if (a.has(/appFont\??\.logSession\??\.?\(|\blogSession\(\s*\{/)) return ok();
    if (a.has(/['"]portal-activity['"]/) && a.has(/\.push\(\s*\[/)) return warn('writes portal-activity by hand; move to appFont.logSession');
    return fail('finished sessions are not logged for the hub (appFont.logSession)');
  }],
  ['live', 'Live check + release tag after deploy', (a) => {
    const viaWorkflow = a.workflows.some((w) => /CoworkSyncHub\/\.github\/workflows\/after-deploy\.yml/.test(w.t));
    const viaScript = ['scripts/deploy.mjs', 'deploy.sh'].map((f) => path.join(a.root, f)).filter(existsSync).some((f) => /live-check\.mjs/.test(readFileSync(f, 'utf8')));
    const parent = path.dirname(a.root), viaParent = path.basename(a.root) === 'site' && existsSync(path.join(parent, 'deploy.sh')) && /live-check\.mjs/.test(readFileSync(path.join(parent, 'deploy.sh'), 'utf8'));
    return viaWorkflow || viaScript || viaParent ? ok() : fail('deploy does not check the live site or tag the release');
  }],
  ['aireview', 'AI review channel for graded sessions', (a) => {
    // apps that grade a whole session by algorithm (the user's list, 2026-11-13); everyone else is not applicable
    const GRADED = /^(GymTracker|Tachyread|SpeechImprover|GuitarPicker|HandwritingHelper|ChessRetabled|BodybuildingProgressCoach|learning-pit|MarksmanApp|Run315|BlackMirrorBikeRide|LanguageLab)$/;
    if (!GRADED.test(a.app.dir)) return ['-', 'no algorithmically graded sessions'];
    // a real channel or operation: name:/dir: 'something-review', or a Tachyread-style op id 'cw-...-review':
    return a.has(/\b(name|dir|key)\s*:\s*['"][a-z0-9-]*-review['"]|['"]cw-[a-z0-9-]+-review['"]\s*:/) ? ok() : fail('no AI review channel for its graded sessions');
  }],
  ['i18n', 'English + 16 machine-translated languages', (a) => {
    // every string the app writes in English is translated into all 16 languages (i18n.mjs), and dates,
    // numbers and units go through appFont.fmt, never a hard-coded locale or hand-typed month names
    if (!a.has(/name=["']app-locales["']/)) return fail('no <meta name="app-locales"> (not translated yet)');
    const cov = i18nCoverage(a.root);
    const missing = Object.entries(cov.missing).filter(([, n]) => n);
    if (!cov.total) return fail('declares locales but marks no strings with t() / data-t');
    if (missing.length) return fail(`${cov.total} strings; missing: ` + missing.map(([l, n]) => `${l} ${n}`).join(', ') + ' (node ../CoworkSyncHub/i18n.mjs todo .)');
    const hard = a.count(/['"]en-(US|GB)['"]/g) + a.count(/['"]January['"]\s*,\s*['"]February['"]|['"]Jan['"]\s*,\s*['"]Feb['"]/g);
    return hard ? warn(`${cov.total} strings, all translated; ${hard} hard-coded locale or month list(s) left`) : ok(`${cov.total} strings`);
  }],
  ['sec', 'Security: CSP, no eval, safe ids, no secrets', (a) => {
    // standard 22. One origin for every app, so one injected script reaches all of them.
    const code = a.code || a.all, bad = [];
    if (/(^|[^\w.])eval\s*\(|new\s+Function\s*\(|set(Timeout|Interval)\s*\(\s*['"`]/.test(code)) bad.push('eval / new Function / string timer');
    if (/(token|nonce|secret|salt|state|password|passcode|otp)\w*\s*[:=][^;\n]{0,60}Math\.random|Math\.random[^;\n]{0,40}(token|nonce|secret|salt|password)/i.test(code)) bad.push('Math.random for a secret value (use appFont.randomId / crypto)');
    const ext = [...a.all.matchAll(/<script\b[^>]*\bsrc\s*=\s*["'](https?:)?\/\/([^/"']+)[^>]*>/gi)].filter((m) => !ALWAYS_OK.test(m[2]) && !/\bintegrity\s*=/.test(m[0])).map((m) => m[2]);
    if (ext.length) bad.push('CDN script without integrity hash: ' + [...new Set(ext)].join(', '));
    const secret = a.text.find((x) => /\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{36}\b|\bsk-(ant-)?[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bxox[bp]-[\w-]{10,}/.test(x.t));
    if (secret) bad.push('looks like a secret key in ' + secret.f);
    const csp = a.all.match(/http-equiv\s*=\s*["']Content-Security-Policy["'][^>]*content\s*=\s*["']([^"']+)/i);
    if (!csp) bad.push('no Content-Security-Policy meta tag');
    else if (/'unsafe-eval'/.test(csp[1])) bad.push("CSP allows 'unsafe-eval'");
    if (bad.length) return fail(bad.join('; '));
    const risky = (code.match(/(innerHTML|outerHTML)\s*\+?=\s*[^;\n]*\$\{(?![^}]*\b(esc|escape\w*|escHtml|appFont\.esc)\()|insertAdjacentHTML\([^;\n]*\$\{(?![^}]*\besc)|dangerouslySetInnerHTML/g) || []).length;
    return risky ? warn(`${risky} spot(s) put \${…} into HTML without esc(): check each shows no outside text, or use appFont.html\`\``) : ok();
  }],
  ['supply', 'Supply chain: audited deps, locked-down CI', (a) => {
    const bad = [], deps = npmDeps(a);
    if (deps.length && !a.workflows.some((w) => /npm audit|audit-ci|osv-scanner/.test(w.t))) bad.push('CI never runs npm audit');
    const loose = a.workflows.filter((w) => !/^permissions:/m.test(w.t)).map((w) => w.f);
    if (loose.length) bad.push('no top-level permissions: in ' + loose.join(', '));
    if (bad.length) return fail(bad.join('; '));
    const unpinned = a.workflows.flatMap((w) => [...w.t.matchAll(/uses:\s*([\w.-]+\/[\w.\/-]+)@(?![0-9a-f]{40})/g)].map((m) => m[1])).filter((u) => !u.startsWith('actions/') && !u.startsWith('adervec/'));
    return unpinned.length ? warn('third-party actions not pinned to a commit: ' + [...new Set(unpinned)].join(', ')) : ok();
  }],
  ['datainv', 'Data inventory (app-data.json) covers the code', (a) => {
    // standard 23: the app declares every place it keeps the reader's data, so the hub can back it up
    // and "Erase everything" knows its own. House keys (font.js, portal) are the hub's to declare.
    const f = a.files.find((x) => /(^|\/)app-data\.json$/.test(x) && !/node_modules|dist\//.test(x));
    if (!f) return fail('no app-data.json (published beside index.html)');
    let d; try { d = JSON.parse(readFileSync(path.join(a.root, f), 'utf8')); } catch (e) { return fail('app-data.json is not valid JSON: ' + e.message); }
    if (!Number.isInteger(d.schema) || d.schema < 1) return fail('app-data.json needs "schema": a whole number, bumped when stored data changes shape');
    for (const k of ['localStorage', 'indexedDB', 'drive']) if (!Array.isArray(d[k])) return fail(`app-data.json needs "${k}": [] (empty if unused)`);
    const covered = (list, name) => list.some((p) => p === name || (p.endsWith('*') && name.startsWith(p.slice(0, -1))));
    const HOUSE = /^(maker-|portal-|app-|cowork-)/;
    const code = a.code || a.all, missing = new Set();
    for (const m of code.matchAll(/localStorage\.(?:getItem|setItem|removeItem)\(\s*['"`]([^'"`$]+)(\$\{)?/g)) {
      const k = m[1] + (m[2] ? '*' : '');
      if (!HOUSE.test(k) && !covered(d.localStorage, m[2] ? m[1] : k)) missing.add('localStorage ' + k);
    }
    for (const m of code.matchAll(/indexedDB\.open\(\s*['"]([^'"]+)/g)) if (!HOUSE.test(m[1]) && !covered(d.indexedDB, m[1])) missing.add('IndexedDB ' + m[1]);
    if (missing.size) return fail('not declared in app-data.json: ' + [...missing].slice(0, 6).join(', ') + (missing.size > 6 ? ` (+${missing.size - 6})` : ''));
    return ok(`schema ${d.schema}`);
  }],
  ['leak', 'No personal data in the repo or its history', (a) => {
    const found = leakScan(a.root);
    return found.length ? fail(found.length + ' finding(s), first: ' + found[0].where + ' <- ' + found[0].what + ' (node leak-check.mjs lists them)') : ok();
  }],
  ['overlap', 'Overlaps with other apps written down (OVERLAPS.md)', (a) => {
    const f = path.join(a.root, 'OVERLAPS.md');
    if (!existsSync(f)) return fail('no OVERLAPS.md (the register of overlaps with other apps and the hub)');
    const m = /^Reviewed:\s*(\d{4}-\d\d-\d\d)/m.exec(readFileSync(f, 'utf8'));
    if (!m) return fail('OVERLAPS.md has no "Reviewed: YYYY-MM-DD" line');
    const days = Math.floor((Date.now() - new Date(m[1] + 'T00:00:00').getTime()) / 864e5);
    return days > 90 ? warn('OVERLAPS.md was last reviewed ' + days + ' days ago') : ok();
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
  // --dir <folder>: check a folder that is not in apps.json yet (a new or private app checking itself)
  const di = argv.indexOf('--dir'), dir = di >= 0 ? path.resolve(argv[di + 1] || '.') : null;
  if (dir) argv = argv.filter((x, i) => i !== di && i !== di + 1);
  const filters = argv.filter((x) => !x.startsWith('-')).map((x) => x.toLowerCase());
  const apps = dir ? [{ slug: path.basename(dir), dir: path.relative(GITHUB, dir) }] : portalApps().filter((a) => !filters.length || filters.some((f) => a.slug.toLowerCase().startsWith(f) || a.dir.toLowerCase().startsWith(f)));
  const W = 15, keys = CHECKS.map((c) => c[0]);
  if (argv.includes('--json')) { // for the status board (portal.py status)
    const rows = apps.filter((app) => existsSync(path.join(GITHUB, app.dir))).map((app) => { const a = load(app); return { slug: app.slug, cells: Object.fromEntries(CHECKS.map(([k, , fn]) => { let r; try { r = fn(a); } catch (e) { r = ['?', 'check crashed: ' + e.message]; } return [k, r]; })) }; });
    console.log(JSON.stringify({ checks: CHECKS.map(([k, label]) => [k, label]), apps: rows }));
    return;
  }
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
  eq(check('pfp', fake('fetch("https://www.googleapis.com/oauth2/v3/userinfo") _profile = { picture: j.picture }')), 'FAIL', 'an undrawn picture fails');
  eq(check('gated', fake('', ['LICENSE'], [{ f: 'ci.yml', t: 'on:\n  push:\njobs:\n  test:\n    steps:\n      - run: npm test\n  deploy:\n    needs: test\n    steps:\n      - uses: actions/upload-pages-artifact@v3\n      - uses: actions/deploy-pages@v4' }])), 'ok', 'test then deploy passes');
  eq(check('gated', fake('', ['LICENSE'], [{ f: 'deploy.yml', t: 'on:\n  push:\njobs:\n  build:\n    steps:\n      - run: npm run build\n      - uses: actions/upload-pages-artifact@v3\n  deploy:\n    needs: build\n    steps:\n      - uses: actions/deploy-pages@v4' }])), 'FAIL', 'build then deploy without tests fails');
  eq(check('data', { ...fake('<script src="https://adervec.github.io/font.js"></script> Export Import Erase everything'), code: 'Export Import Erase everything' }), 'ok', 'a comment saying never localStorage.clear() is fine');
  eq(check('3p', fake('<a href="https://www.openstreetmap.org/x">map</a> fetch("https://api.dropboxapi.com/2/files")')), 'ok', 'links and connected APIs are not page loads');
  eq(check('a11y', fake('/* house font: CoworkSyncHub/font.js, published at adervec.github.io/font.js */')), 'FAIL', 'a comment naming font.js is not loading it');
  eq(check('a11y', fake('<script src="https://adervec.github.io/font.js"></script>')), 'ok', 'a real font.js load passes');
  { // leak: a tracked backup file fails; listing it in .leak-ok as made-up data excuses it
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'leak-'));
    execFileSync('git', ['-C', tmp, 'init', '-q']);
    writeFileSync(path.join(tmp, 'adervec-backup-2026-01-01.json'), '{}');
    writeFileSync(path.join(tmp, 'notes.md'), 'see C:\\Users\\Someone\\x and mail ada@example.com');
    execFileSync('git', ['-C', tmp, 'add', '-A']);
    eq(check('leak', { ...fake(''), root: tmp }), 'FAIL', 'a tracked backup file fails');
    writeFileSync(path.join(tmp, '.leak-ok'), 'adervec-backup-2026-01-01.json  # made-up sample\n');
    eq(check('leak', { ...fake(''), root: tmp }), 'ok', 'a file listed in .leak-ok is excused, and placeholders are not findings');
  }
  { // overlap: the register must exist and carry a recent Reviewed date
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'overlap-'));
    eq(check('overlap', { ...fake(''), root: tmp }), 'FAIL', 'no OVERLAPS.md fails');
    writeFileSync(path.join(tmp, 'OVERLAPS.md'), 'Reviewed: 2020-01-01\n- [idea] A + B: x -> y\n');
    eq(check('overlap', { ...fake(''), root: tmp }), 'warn', 'a stale review warns');
    writeFileSync(path.join(tmp, 'OVERLAPS.md'), 'Reviewed: ' + new Date().toISOString().slice(0, 10) + '\n');
    eq(check('overlap', { ...fake(''), root: tmp }), 'ok', 'a fresh review passes');
  }
  eq(check('drive', fake('await appFont.cloud.signIn(); appFont.cloud.write("x.json", s)')), 'ok', 'the shared cloud helper counts as sync');
  eq(check('drive', fake('localStorage.setItem("x", s)')), 'FAIL', 'no cloud sync fails');
  eq(check('ledger', fake('appFont.logSession({ kind: "lift", minutes: 40, id: w.id })')), 'ok', 'logSession passes');
  eq(check('pfp', fake('<header><app-account></app-account></header> const G = window.appFont?.google; G.token()')), 'ok', 'the shared sign-in with the corner avatar passes');
  eq(check('pfp', fake('const G = window.appFont?.google; G.token()')), 'FAIL', 'the shared sign-in without the avatar in the page fails');
  eq(check('drive', fake('const G = window.appFont?.google; G.write(name, text)')), 'ok', 'Drive through the shared sign-in passes');
  eq(check('ledger', fake('const k = "portal-activity", a = JSON.parse(localStorage.getItem(k) || "[]"); a.push([1, "X", "lift", 2])')), 'warn', 'a hand-written ledger row warns');
  eq(check('ledger', fake('saveWorkout(w)')), 'FAIL', 'no ledger fails');
  eq(check('themes', fake('<select id="theme"><option>ember</option></select> body{background:var(--bg)}')), 'FAIL', 'an own theme list fails');
  eq(check('themes', fake('<app-theme-picker></app-theme-picker> body{background:#fff}')), 'FAIL', 'the picker without the palette fails');
  eq(check('themes', fake('<app-theme-picker></app-theme-picker> :root{--bg:var(--t-bg)}')), 'ok', 'the house list mapped onto the app passes');
  eq(check('themes', fake('appFont.addThemes([{ id: "sakura" }]); <app-theme-picker></app-theme-picker> :root{--bg:var(--t-bg)}')), 'ok', 'extra themes on top of the base list pass');
  eq(check('theme', fake('const THEMES = [...new Set(works.flatMap(w => w.themes))]')), '-', 'subject-tag "themes" are not colour themes');
  eq(check('theme', fake('document.documentElement.setAttribute("data-theme", localStorage.getItem("t") || "ember")')), 'FAIL', 'a theme default that ignores the device fails');
  eq(check('theme', fake('data-theme ... matchMedia("(prefers-color-scheme: light)")')), 'ok', 'a device-aware default passes');
  eq(check('a11y', fake('<script data-house="font.js">(function(){})()</script>')), 'ok', 'a marked inlined copy of font.js counts');
  eq(check('updates', fake('<script src="https://adervec.github.io/font.js"></script> window.appUpdateNotice = false; fetch(BASE + "version.json")')), 'ok', 'an own version.json check counts as its own update notice');
  eq(check('a11y', fake('<script data-house="font.js">if (!this.hasAttribute("no-zoom-option")) {}</script><app-font-picker></app-font-picker>')), 'ok', "font.js's own source does not count as hiding the zoom option");
  eq(check('a11y', fake('<script src="https://adervec.github.io/font.js"></script><app-font-picker no-zoom-option></app-font-picker>')), 'warn', 'a picker that hides the zoom option warns');
  eq(check('pfp', fake('fetch("https://www.googleapis.com/oauth2/v3/userinfo") <img src="${esc(prof.picture)}">')), 'FAIL', 'a picture only in settings no longer passes');
  eq(check('pfp', fake('fetch("https://www.googleapis.com/oauth2/v3/userinfo") <header><app-account></app-account></header> appFont.setAccount({ picture })')), 'ok', 'the shared corner avatar passes');
  const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' https://adervec.github.io">`;
  eq(check('sec', fake(CSP + 'el.textContent = name;')), 'ok', 'a CSP and plain textContent pass');
  eq(check('sec', fake('el.textContent = name;')), 'FAIL', 'no CSP fails');
  eq(check('sec', fake(CSP + 'const f = new Function("return 1");')), 'FAIL', 'new Function fails');
  eq(check('sec', fake(CSP + 'const state = Math.random().toString(36);')), 'FAIL', 'a Math.random sign-in state fails');
  eq(check('sec', fake(CSP + 'const roll = Math.floor(Math.random() * 6);')), 'ok', 'Math.random for gameplay is fine');
  eq(check('sec', fake(CSP + '<script src="https://cdn.jsdelivr.net/npm/x@1/x.js"></script>')), 'FAIL', 'a CDN script without integrity fails');
  eq(check('sec', fake(CSP + '<script src="https://cdn.jsdelivr.net/npm/x@1/x.js" integrity="sha384-x" crossorigin></script>')), 'ok', 'a CDN script with integrity passes');
  eq(check('sec', fake(CSP + 'el.innerHTML = `<b>${item.name}</b>`;')), 'warn', 'unescaped ${} into innerHTML warns');
  eq(check('sec', fake(CSP + 'el.innerHTML = `<b>${esc(item.name)}</b>`;')), 'ok', 'escaped ${} into innerHTML passes');
  eq(check('supply', fake('', ['LICENSE'], [{ f: 'ci.yml', t: 'on: push\npermissions:\n  contents: read\njobs:\n  t:\n    steps:\n      - uses: actions/checkout@v4' }])), 'ok', 'locked-down CI passes');
  eq(check('supply', fake('', ['LICENSE'], [{ f: 'ci.yml', t: 'on: push\njobs:\n  t:\n    steps:\n      - uses: actions/checkout@v4' }])), 'FAIL', 'CI without permissions fails');
  {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'inv-')), inv = (decl, src) => { writeFileSync(path.join(tmp, 'app-data.json'), JSON.stringify(decl)); return check('datainv', { ...fake(src, ['app-data.json']), root: tmp }); };
    const D = { schema: 1, localStorage: ['mm-*'], indexedDB: ['minis'], drive: [] };
    eq(inv(D, "localStorage.setItem('mm-view', v); indexedDB.open('minis', 2); localStorage.getItem('maker-font')"), 'ok', 'declared keys, prefixes and house keys pass');
    eq(inv(D, "localStorage.setItem('other-key', v)"), 'FAIL', 'an undeclared key fails');
    eq(inv(D, 'localStorage.setItem(`mm-x-${id}`, v)'), 'ok', 'a templated key under a declared prefix passes');
    eq(inv(D, "indexedDB.open('photos')"), 'FAIL', 'an undeclared database fails');
    eq(inv(D, "indexedDB.open('cowork-ui', 1)"), 'ok', "cowork.js's own folder-handle database is the house's to declare");
    eq(inv({ localStorage: [] }, ''), 'FAIL', 'a missing schema number fails');
    eq(check('datainv', fake('')), 'FAIL', 'no app-data.json fails');
  }
  console.log('standards.mjs selftest: ok');
}

if (process.argv.includes('--selftest')) selftest(); else run(process.argv.slice(2));
