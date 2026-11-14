// i18n.mjs — the house translation pipeline. Apps are written in English; the other 16 languages
// are MACHINE translated by an agent session (no translation API), and the apps say so.
//
//   node i18n.mjs extract <app>   collect every English string the app uses -> <locales>/en.json
//   node i18n.mjs todo <app>      write <locales>/_todo/<lang>.json: what each language still needs
//   node i18n.mjs merge <app>     fold filled-in todo files into <locales>/<lang>.json (validated)
//   node i18n.mjs check <app>     coverage per language; exit 1 if anything is missing or broken
//   node i18n.mjs --selftest
//
// <app> is a folder; its locales folder comes from <meta name="app-locales" content="locales/">
// (default: locales/ at the app root). A session's loop is: extract, todo, translate every value in
// the _todo files (keep {placeholders} exactly, fill every plural category listed), merge, check.
//
// What counts as a string (the English IS the key):
//   t('Saved {n} minis', { n })  t("…")  t(`…`)  (no ${} inside)        a plain string
//   t.n('{n} mini', '{n} minis', count)                                    a plural: key "one|other"
//   tr('…')  tr.n('…', '…', n)                                             font.js's own words
//   <span data-t>Settings</span>  <b data-t="Settings">…</b>               static HTML text
//   <input data-t-attr="placeholder,title" placeholder="Search" title="…">  static HTML attributes
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TARGETS = ['fr', 'es', 'pt', 'it', 'hr', 'de', 'zh', 'uk', 'eo', 'sw', 'hi', 'bn', 'id', 'ur', 'fa', 'ar'];
export const NAMES = { fr: 'French', es: 'Spanish', pt: 'Portuguese', it: 'Italian', hr: 'Croatian', de: 'German',
  zh: 'Mandarin Chinese (Simplified)', uk: 'Ukrainian', eo: 'Esperanto', sw: 'Swahili', hi: 'Hindi', bn: 'Bengali',
  id: 'Indonesian', ur: 'Urdu', fa: 'Persian (Farsi)', ar: 'Arabic' };
const SRC = /\.(html?|m?js|jsx|tsx?)$/i;
const SKIP = /(^|\/)(node_modules|dist|build|_site|coverage|test|tests|__tests__|test-results|playwright-report|locales|\.github|vendor|Guides)\/|\.(test|spec)\.|\.min\.js$/;

// a JS string literal (single, double, or a backtick with no ${…})
const LIT = String.raw`('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|\x60(?:[^\x60\\$]|\\.|\$(?!\{))*\x60)`;
const RE_T = new RegExp(String.raw`(?<![\w$.])(t|tr)\(\s*` + LIT + String.raw`\s*[,)]`, 'g');
const RE_N = new RegExp(String.raw`(?<![\w$.])(t|tr)\.n\(\s*` + LIT + String.raw`\s*,\s*` + LIT, 'g');
const unquote = (lit) => {
  const q = lit[0], body = lit.slice(1, -1);
  if (q === '`') return body.replace(/\\(.)/g, '$1');
  return JSON.parse('"' + (q === "'" ? body.replace(/\\'/g, "'").replace(/"/g, '\\"') : body) + '"');
};

export function extractText(text, { house = false } = {}) {
  const strings = new Set(), plurals = new Map();
  const want = (fn) => (house ? fn === 'tr' : fn === 't');
  for (const m of text.matchAll(RE_T)) if (want(m[1])) { try { strings.add(unquote(m[2])); } catch { /* not a plain literal */ } }
  for (const m of text.matchAll(RE_N)) if (want(m[1])) { try { const one = unquote(m[2]), other = unquote(m[3]); plurals.set(one + '|' + other, { one, other }); } catch { /* skip */ } }
  // keys a scan cannot see (labels passed through a variable): a comment line  // i18n-keys: First | Second
  for (const m of text.matchAll(/i18n-keys:([^\n]*)/g)) m[1].split('|').map((k) => k.trim()).filter(Boolean).forEach((k) => strings.add(k));
  if (!house) {
    // static HTML: data-t (attribute value, or the element's own text) and data-t-attr
    for (const m of text.matchAll(/<([a-zA-Z][\w-]*)\b([^>]*?)\sdata-t(?:=("[^"]*"|'[^']*'))?([^>]*)>([^<]*)</g)) {
      const key = m[3] ? m[3].slice(1, -1) : m[5].trim();
      if (key) strings.add(key.replace(/\s+/g, ' '));
    }
    for (const m of text.matchAll(/<[a-zA-Z][\w-]*\b([^>]*\sdata-t-attr=("[^"]*"|'[^']*')[^>]*)>/g)) {
      const attrs = m[2].slice(1, -1).split(',').map((a) => a.trim()).filter(Boolean);
      for (const a of attrs) { const v = m[1].match(new RegExp('\\s' + a + '=("[^"]*"|\'[^\']*\')')); if (v && v[1].length > 2) strings.add(v[1].slice(1, -1)); }
    }
  }
  return { strings, plurals };
}

function gitFiles(root) {
  try { return execFileSync('git', ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\n').filter(Boolean); }
  catch { return readdirSync(root, { recursive: true }).map(String); }
}
export function localesDir(root) {
  for (const f of ['index.html', 'src/shell.html', 'shell.html', 'app/index.html', 'client/index.html', 'speechimprover/index.html', 'marksman/webapp/index.html', 'gym-tracker.html']) {
    const p = path.join(root, f);
    if (!existsSync(p)) continue;
    const m = readFileSync(p, 'utf8').match(/name=["']app-locales["'][^>]*content=["']([^"']+)["']/);
    if (m) {
      // a path relative to the page; Vite projects keep served files in public/
      const rel = m[1].replace(/%BASE_URL%/g, '').replace(/^\.?\//, '');
      const pageDir = path.dirname(p);
      const pub = path.join(pageDir, 'public', rel);
      return existsSync(path.join(pageDir, 'public')) ? pub : path.join(pageDir, rel);
    }
  }
  return path.join(root, 'locales');
}

export function extractApp(root, { house = false } = {}) {
  const strings = new Set(), plurals = new Map();
  for (const f of gitFiles(root)) {
    if (!SRC.test(f) || SKIP.test(f.replace(/\\/g, '/'))) continue;
    if (house && path.basename(f) !== 'font.js') continue; // the house strings live in font.js only
    let text; try { text = readFileSync(path.join(root, f), 'utf8'); } catch { continue; }
    const r = extractText(text, { house });
    r.strings.forEach((s) => strings.add(s));
    r.plurals.forEach((v, k) => plurals.set(k, v));
  }
  return { strings: [...strings].sort(), plurals: Object.fromEntries([...plurals.entries()].sort()) };
}

const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
export const categories = (lang) => { try { return new Intl.PluralRules(lang).resolvedOptions().pluralCategories; } catch { return ['one', 'other']; } };
const readJson = (p, dflt) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return dflt; } };
const writeJson = (p, v) => { mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(v, null, 1) + '\n'); };

// what one language still needs: missing or invalid entries
export function needs(cat, dict, lang) {
  const out = {};
  for (const s of cat.strings) { const v = dict[s]; if (typeof v !== 'string' || !v.trim() || placeholders(v) !== placeholders(s)) out[s] = ''; }
  for (const [k, { one, other }] of Object.entries(cat.plurals)) {
    const v = dict[k], cats = categories(lang), want = placeholders(other);
    const bad = !v || typeof v !== 'object' || cats.some((c) => typeof v[c] !== 'string' || !v[c].trim() || placeholders(v[c]).split(',').filter((x) => x !== 'n').join(',') !== want.split(',').filter((x) => x !== 'n').join(','));
    if (bad) out[k] = Object.fromEntries(cats.map((c) => [c, '']));
  }
  return out;
}

export function coverage(root, { house = false } = {}) {
  const dir = house ? path.join(root, 'locales') : localesDir(root), cat = extractApp(root, { house });
  const total = cat.strings.length + Object.keys(cat.plurals).length;
  const langs = Object.fromEntries(TARGETS.map((l) => [l, Object.keys(needs(cat, readJson(path.join(dir, l + '.json'), {}), l)).length]));
  return { dir, total, missing: langs, catalogue: cat };
}

function cli(argv) {
  const [cmd, appArg] = argv, house = argv.includes('--house');
  if (cmd === '--selftest') return selftest();
  if (!cmd || !appArg) { console.log('usage: node i18n.mjs extract|todo|merge|check <app folder> [--house]'); process.exit(2); }
  const root = path.resolve(appArg), dir = house ? path.join(root, 'locales') : localesDir(root), cat = extractApp(root, { house });
  if (cmd === 'extract') {
    writeJson(path.join(dir, 'en.json'), { ...Object.fromEntries(cat.strings.map((s) => [s, s])), ...cat.plurals });
    console.log(`${cat.strings.length} strings + ${Object.keys(cat.plurals).length} plurals -> ${path.relative(process.cwd(), path.join(dir, 'en.json'))}`);
  } else if (cmd === 'todo') {
    let n = 0;
    for (const l of TARGETS) {
      const need = needs(cat, readJson(path.join(dir, l + '.json'), {}), l), keys = Object.keys(need), p = path.join(dir, '_todo', l + '.json');
      if (!keys.length) { if (existsSync(p)) rmSync(p); continue; }
      writeJson(p, { _instructions: `Machine-translate every value into ${NAMES[l]} (${l}). The keys are the app's English; never change a key. Keep {placeholders} exactly as they are. For plural entries fill every listed category (Unicode CLDR plural categories for ${l}). Keep the tone short and plain, as UI text. Then run: node i18n.mjs merge <app>`, ...need });
      n += keys.length;
    }
    console.log(n ? `${n} entries to translate in ${path.relative(process.cwd(), path.join(dir, '_todo'))}/` : 'nothing to translate');
  } else if (cmd === 'merge') {
    let merged = 0, left = 0;
    for (const l of TARGETS) {
      const p = path.join(dir, '_todo', l + '.json'); if (!existsSync(p)) continue;
      const todo = readJson(p, {}), dict = readJson(path.join(dir, l + '.json'), {});
      delete todo._instructions;
      for (const [k, v] of Object.entries(todo)) dict[k] = v;
      // keep only what the app still uses
      const keep = new Set([...cat.strings, ...Object.keys(cat.plurals)]);
      for (const k of Object.keys(dict)) if (!keep.has(k)) delete dict[k];
      const still = needs(cat, dict, l);
      for (const k of Object.keys(still)) { if (k in todo) delete dict[k]; } // drop invalid fills so they are asked again
      writeJson(path.join(dir, l + '.json'), Object.fromEntries(Object.entries(dict).sort()));
      merged += Object.keys(todo).length - Object.keys(still).length; left += Object.keys(still).length;
      if (!Object.keys(still).length) rmSync(p);
    }
    console.log(`merged ${merged}; ${left} still missing or invalid (run todo again)`);
  } else if (cmd === 'check') {
    const total = cat.strings.length + Object.keys(cat.plurals).length;
    const bad = TARGETS.map((l) => [l, Object.keys(needs(cat, readJson(path.join(dir, l + '.json'), {}), l)).length]).filter((x) => x[1]);
    console.log(`${total} strings; ` + (bad.length ? 'missing: ' + bad.map(([l, n]) => `${l} ${n}`).join(', ') : 'all 16 languages complete'));
    process.exit(bad.length ? 1 : 0);
  } else { console.log('unknown command ' + cmd); process.exit(2); }
}

function selftest() {
  const eq = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };
  const src = `t('Saved {n} minis', { n }); t("It's \\"done\\""); t(\`Plain\`); t(\`no \${x}\`); x.t('not mine'); tr('house');
    t.n('{n} mini', '{n} minis', c); <span data-t>Settings</span> <b data-t="Erase">x</b>
    <input data-t-attr="placeholder,title" placeholder="Search" title="Find a mini">`;
  const r = extractText(src);
  eq([...r.strings].sort(), ['Erase', 'Find a mini', "It's \"done\"", 'Plain', 'Saved {n} minis', 'Search', 'Settings'], 'extracts plain, data-t and data-t-attr strings');
  eq([...r.plurals.keys()], ['{n} mini|{n} minis'], 'extracts plurals');
  eq([...extractText(src, { house: true }).strings], ['house'], 'house mode takes only tr()');
  const cat = { strings: ['Saved {n} minis', 'Hi'], plurals: { '{n} mini|{n} minis': { one: '{n} mini', other: '{n} minis' } } };
  eq(Object.keys(needs(cat, { 'Saved {n} minis': 'Enregistré {n}', Hi: 'Salut', '{n} mini|{n} minis': { one: '{n} figurine', many: '{n} figurines', other: '{n} figurines' } }, 'fr')), [], 'a complete French entry needs nothing');
  eq(Object.keys(needs(cat, { 'Saved {n} minis': 'Enregistré', Hi: 'Salut' }, 'fr')), ['Saved {n} minis', '{n} mini|{n} minis'], 'a lost placeholder or a missing plural is flagged');
  eq(categories('ar').length, 6, 'Arabic has six plural forms');
  console.log('i18n.mjs selftest: ok');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli(process.argv.slice(2));
