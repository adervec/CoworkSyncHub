// Hub preferences self-check (roadmap chunk 3): "Not for me" hiding, the activity switch, sign-in and
// the Drive sync between two pretend devices, against a pretend Google.
// Usage: python portal.py build --offline --beta && node hub-check.mjs      (serves site/, opens /portal-beta/)
//        node hub-check.mjs --url https://adervec.github.io/portal-beta/
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'site');
const ui = process.argv.indexOf('--url');
let url = ui >= 0 ? process.argv[ui + 1] : null, server = null;
if (!url) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };
  server = http.createServer(async (req, res) => {
    try {
      let f = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
      if (req.url.split('?')[0].endsWith('/')) f = path.join(f, 'index.html');
      const body = await readFile(f); res.writeHead(200, { 'content-type': types[path.extname(f)] || 'text/plain' }).end(body);
    } catch { res.writeHead(404).end(); }
  }).listen(0);
  url = `http://localhost:${server.address().port}/portal-beta/`;
}
const fails = [], ok = (name, cond) => { if (!cond) fails.push(name); };
const TOKEN = 'ya29.' + 'h'.repeat(40), drive = {}, errs = []; // drive: the pretend private folder, shared by both devices
const b = await chromium.launch({ channel: 'chrome' });

async function device(viewport) {
  const ctx = await b.newContext({ viewport });
  await ctx.route('**/sw.js', r => r.fulfill({ status: 404 })); // no service worker between the test and its routes
  await ctx.route('https://accounts.google.com/gsi/client', r => r.fulfill({ contentType: 'text/javascript',
    body: `window.google={accounts:{oauth2:{initTokenClient:function(c){return{requestAccessToken:function(){setTimeout(function(){c.callback({access_token:'${TOKEN}',expires_in:3600})},0)}}}}}};` }));
  await ctx.route('https://www.googleapis.com/**', r => {
    const q = r.request(), u = new URL(q.url()), cors = { 'access-control-allow-origin': '*' };
    const json = o => r.fulfill({ headers: cors, contentType: 'application/json', body: JSON.stringify(o) });
    if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (q.headers().authorization !== 'Bearer ' + TOKEN) return r.fulfill({ status: 401, headers: cors });
    if (u.pathname.endsWith('/userinfo')) return json({ name: 'Test Reader', email: 'reader@example.com', picture: '' });
    if (u.pathname === '/drive/v3/files') { const name = /name='([^']+)'/.exec(u.searchParams.get('q') || ''); return json({ files: name && name[1] in drive ? [{ id: name[1] }] : [] }); }
    if (u.pathname === '/upload/drive/v3/files') { const body = q.postData(), name = JSON.parse(/\r\n\r\n(\{.*?\})\r\n--/.exec(body)[1]).name; drive[name] = body.split('\r\n\r\n')[2].split('\r\n--')[0]; return json({ id: name }); }
    const id = decodeURIComponent(u.pathname.split('/').pop());
    if (q.method() === 'PATCH') { drive[id] = q.postData(); return json({ id }); }
    return r.fulfill({ headers: cors, contentType: 'application/json', body: drive[id] });
  });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errs.push(m.text()); });
  p.on('dialog', d => d.accept());
  return p;
}
const shown = (p, sel) => p.$eval(sel, el => !!(el.offsetWidth || el.offsetHeight)).catch(() => false);
const slugs = p => p.$$eval('.grid .app:not(.nfm)', l => l.map(x => x.dataset.slug));
const synced = async want => { for (let i = 0; i < 50 && !want(); i++) await new Promise(r => setTimeout(r, 100)); };
const hidden = () => { const h = JSON.parse(drive['hub-prefs.json'] || '{"h":{}}').h; return Object.keys(h).filter(s => h[s] > 0).sort().join(); };

// ---- device 1: a phone, not signed in ----
const p1 = await device({ width: 390, height: 844 });
await p1.goto(url);
await p1.evaluate(() => { localStorage.clear(); const now = Date.now() / 1000; localStorage.setItem('portal-usage', JSON.stringify({ GymTracker315: { n: 5, last: now }, Tachyread: { n: 3, last: now } })); });
await p1.reload();
const all = await slugs(p1);
ok('the hub lists the apps', all.length >= 10 && all.includes('GymTracker315'));
ok('Sign in shows in the top bar, no account yet', await shown(p1, '#signin') && !(await shown(p1, '#me')));
ok('character sheet shows by default', await shown(p1, '#sheet'));
ok('no sideways scroll on a phone', await p1.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1);

await p1.click('#gymtracker315 .nfmb');
ok('"Not for me" removes the card and the tile', !(await slugs(p1)).includes('GymTracker315') && !(await shown(p1, '.tiles a[data-slug=GymTracker315]')));
ok('the count and the hidden line follow', (await p1.textContent('#count')).startsWith(all.length - 1 + ' of ' + (all.length - 1)) && /1 app hidden/.test(await p1.textContent('#hidn')));
ok('a hidden app leaves the character sheet', !/GymTracker/.test(await p1.textContent('#stats')) && /Tachyread/.test(await p1.textContent('#stats')));
ok('its usage data is untouched', await p1.evaluate(() => JSON.parse(localStorage.getItem('portal-usage')).GymTracker315.n) === 5);
await p1.reload();
ok('the choice survives a reload', !(await slugs(p1)).includes('GymTracker315'));
await p1.click('#hidshow');
ok('"show them" reveals the hidden card', await shown(p1, '#gymtracker315') && (await p1.textContent('#gymtracker315 .nfmb')) === 'Show on my hub');
await p1.click('#gymtracker315 .nfmb');
ok('and it can be put back', (await slugs(p1)).includes('GymTracker315') && !(await shown(p1, '#hid')));
ok('nothing went to Drive without a sign-in', !('hub-prefs.json' in drive));

// ---- device 1 signs in, then hides two apps ----
await p1.click('#signin');
await p1.waitForFunction(() => document.getElementById('signin').hidden, null, { timeout: 5000 }).catch(() => {});
ok('signing in swaps the button for the account picture', !(await shown(p1, '#signin')) && await shown(p1, '#me'));
await p1.click('#gymtracker315 .nfmb'); await p1.click('#tachyread .nfmb');
await synced(() => hidden() === 'GymTracker315,Tachyread');
ok('hidden apps reach the Drive file', hidden() === 'GymTracker315,Tachyread');
ok('the token is not kept in storage', await p1.evaluate(t => !JSON.stringify(Object.entries(localStorage)).includes(t), TOKEN));

// ---- device 2: a desktop, fresh browser ----
const p2 = await device({ width: 1280, height: 800 });
await p2.goto(url);
ok('a new device starts with every app', (await slugs(p2)).includes('GymTracker315'));
await p2.click('#signin');
await p2.waitForFunction(() => document.querySelectorAll('.grid .app.nfm').length === 2, null, { timeout: 5000 }).catch(() => {});
ok('signing in brings the hidden apps to the second device', !(await slugs(p2)).includes('GymTracker315') && !(await slugs(p2)).includes('Tachyread'));
// both devices now change something without seeing the other: the merge keeps both
await p2.click('#chessretabled .nfmb');
await synced(() => hidden() === 'ChessRetabled,GymTracker315,Tachyread');
await p1.click('#hidshow'); await p1.click('#tachyread .nfmb'); // device 1, still stale, un-hides Tachyread
await synced(() => hidden() === 'ChessRetabled,GymTracker315');
ok('two devices merge choice by choice', hidden() === 'ChessRetabled,GymTracker315');
ok('and the stale device picks up the other one\'s change', !(await slugs(p1)).includes('ChessRetabled') && (await slugs(p1)).includes('Tachyread'));

// ---- Settings ----
await p2.goto(new URL('settings.html', url).href);
await p2.evaluate(() => window.settingsReady);
ok('Settings shows the account, and the hidden apps unticked', await shown(p2, '#out') && !(await shown(p2, '#in')) && await p2.$eval('#apps input[data-slug=ChessRetabled]', c => !c.checked) && await p2.$eval('#apps input[data-slug=Tachyread]', c => !c.checked));
await p2.click('#syncnow');
await p2.waitForFunction(() => /Drive|up to date/.test(document.getElementById('acctMsg').textContent), null, { timeout: 5000 }).catch(() => {});
ok('Sync now pulls the other device\'s change', await p2.$eval('#apps input[data-slug=Tachyread]', c => c.checked) && /Drive|up to date/.test(await p2.textContent('#acctMsg')));
await p2.uncheck('#activity');
await synced(() => JSON.parse(drive['hub-prefs.json']).a < 0);
ok('the activity switch is saved', JSON.parse(drive['hub-prefs.json']).a < 0);
await p2.evaluate(() => localStorage.setItem('portal-usage', JSON.stringify({ Run315: { n: 2, last: Date.now() / 1000 } })));
await p2.goto(url);
ok('activity off hides the character sheet', !(await shown(p2, '#sheet')));
await p2.goto(new URL('settings.html', url).href);
await p2.evaluate(() => window.settingsReady);
ok('no sideways scroll on Settings', await p2.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1);
await p2.evaluate(() => localStorage.setItem('gymtracker-log', 'keep me'));
await p2.click('#erase');
ok('erase clears the hub\'s notes and nothing else', await p2.evaluate(() => !Object.keys(localStorage).some(k => /^portal-/.test(k)) && localStorage.getItem('gymtracker-log') === 'keep me'));
await p2.click('#out');
ok('sign out forgets the account on this device', await shown(p2, '#in') && await p2.evaluate(() => !localStorage.getItem('maker-google-hint')));

ok('no page or CSP errors: ' + errs.join(' | '), !errs.length);
await b.close(); if (server) server.close();
console.log(fails.length ? 'FAIL\n  ' + fails.join('\n  ') : 'hub-check: all ok');
process.exit(fails.length ? 1 : 0);
