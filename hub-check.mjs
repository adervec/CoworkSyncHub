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
    if (u.pathname === '/drive/v3/files') {
      const q0 = u.searchParams.get('q') || '', name = /name='([^']+)'/.exec(q0), has = /name contains '([^']+)'/.exec(q0);
      if (has) return json({ files: Object.keys(drive).filter(k => k.startsWith(has[1])).map(k => ({ id: k, name: k })) });
      return json({ files: name && name[1] in drive ? [{ id: name[1] }] : [] });
    }
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

// ---- first visit: what do you want to work on? ----
ok('the first visit asks what to work on', await shown(p1, '#setup') && !(await shown(p1, '#today')));
ok('it is one line until opened', await shown(p1, '#setupask') && !(await shown(p1, '#setupopts')) && (await p1.$eval('#setup', (x) => x.getBoundingClientRect().height)) < 160);
await p1.click('#setupchoose');
await p1.check('#setupopts [data-stat=STR]'); await p1.check('#setupopts [data-stat=DEX]');
await p1.click('#setupsave');
const goalsText = () => p1.textContent('#goals');
ok('the choices become weekly targets', !(await shown(p1, '#setup')) && await shown(p1, '#today') && (await p1.$$('#goals .nm')).length === 2 && /STR.*of 2 h/.test(await goalsText()) && /DEX.*of 1 h/.test(await goalsText()));
ok('launch counts alone are not progress', /0 min of 2 h/.test(await goalsText()) && /no full week/.test(await p1.textContent('#weeksline')));
ok('it offers to hide apps that train none of them', await shown(p1, '#hideoffer') && /Run315/.test(await p1.textContent('#hidenames')) && !/GymTracker,/.test(await p1.textContent('#hidenames')));
await p1.click('#hidekeep');
await p1.reload();
ok('the targets survive a reload and the question is not asked again', await shown(p1, '#today') && !(await shown(p1, '#setup')));

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

// ---- the theme button walks the house list ----
const themeNow = () => p1.evaluate(() => [document.documentElement.dataset.houseTheme, getComputedStyle(document.querySelector('.grid .app')).backgroundColor].join(' '));
await p1.click('#theme'); const t1 = await themeNow();
await p1.click('#theme'); const t2 = await themeNow();
ok('the theme button moves through the shared list and recolours the page', t1 === 'light rgb(255, 255, 255)' && t2 === 'dark rgb(26, 29, 35)');
await p1.reload();
ok('the hub remembers its theme', (await themeNow()) === t2);
await p1.evaluate(() => appFont.setTheme('system'));

// ---- device 1 has done some sessions (the apps call appFont.logSession) ----
await p1.evaluate(() => {
  const now = Date.now();
  for (let i = 0; i < 3; i++) appFont.logSession({ app: 'Run315', kind: 'cardio', minutes: 30, id: 'run' + i, at: now - i * 864e5 });
  appFont.logSession({ app: 'GymTracker315', kind: 'cardio', minutes: 30, id: 'same-run', at: now }); // the same run, logged by a second app
  appFont.logSession({ app: 'GuitarPicker', kind: 'practice', minutes: 60, id: 'gp1', at: now });
});
await p1.reload();
ok('logged sessions show on the hub, a run logged by two apps once', /4 activities reported/.test(await p1.textContent('#sheetnote')) && /Run315/.test(await p1.textContent('#stats')));
ok('an hour of guitar meets the DEX target', /DEX.*done/.test(await goalsText()) && /STR.*0 min of 2 h/.test(await goalsText()));
ok('the suggestion is the attribute behind, with an app for it', /Next up: STR/.test(await p1.textContent('#suggest')) && /2 h to go/.test(await p1.textContent('#suggest')) && /GymTracker|Bodybuilding/.test(await p1.textContent('#suggest a')));
ok('no day streak is shown', !/streak/.test(await p1.textContent('#actsum')));

// ---- device 1 signs in, then hides two apps ----
await p1.click('#signin');
await p1.waitForFunction(() => document.getElementById('signin').hidden, null, { timeout: 5000 }).catch(() => {});
ok('signing in swaps the button for the account picture', !(await shown(p1, '#signin')) && await shown(p1, '#me'));
await p1.click('#gymtracker315 .nfmb'); await p1.click('#tachyread .nfmb');
await synced(() => hidden() === 'GymTracker315,Tachyread');
ok('hidden apps reach the Drive file', hidden() === 'GymTracker315,Tachyread');
const ledgers = () => Object.keys(drive).filter(k => k.startsWith('hub-ledger-'));
await synced(() => ledgers().length === 1);
ok('this device\'s sessions go to its own Drive file', ledgers().length === 1 && JSON.parse(drive[ledgers()[0]]).length === 5 && /Run315/.test(drive[ledgers()[0]]));
ok('the token is not kept in storage', await p1.evaluate(t => !JSON.stringify(Object.entries(localStorage)).includes(t), TOKEN));

// ---- device 2: a desktop, fresh browser ----
// the runner's fitness feed: Run315's run from yesterday is also in the feed (it must count once), and a
// strength session no app logged comes only from the feed
{
  const iso = (ms) => new Date(ms).toISOString();
  drive['shared-activities.json'] = JSON.stringify({ schema: 1, owner: 'runner', updated: iso(Date.now()), activities: [
    { ids: ['garmin:1', 'strava:1'], start: iso(Date.now() - 864e5 - 20 * 60e3), kind: 'run', minutes: 30, sources: ['Garmin', 'Strava'] },
    { ids: ['garmin:2'], start: iso(Date.now() - 2 * 864e5 - 5 * 3600e3), kind: 'strength', minutes: 80, sources: ['Garmin'] }] });
}
const p2 = await device({ width: 1280, height: 800 });
await p2.goto(url);
ok('a new device starts with every app', (await slugs(p2)).includes('GymTracker315'));
await p2.click('#signin');
await p2.waitForFunction(() => document.querySelectorAll('.grid .app.nfm').length === 2, null, { timeout: 5000 }).catch(() => {});
ok('signing in brings the hidden apps to the second device', !(await slugs(p2)).includes('GymTracker315') && !(await slugs(p2)).includes('Tachyread'));
await p2.waitForFunction(() => /Run315/.test(localStorage.getItem('portal-activity-remote') || '') && /Garmin and Strava/.test(document.getElementById('sheetnote').textContent), null, { timeout: 8000 }).catch(() => {});
ok('the second device sees the first one\'s sessions, with the fitness feed', /3 activities reported by your apps and 2 from Garmin and Strava/.test(await p2.textContent('#sheetnote')) && /Run315/.test(await p2.textContent('#stats')));
ok('the feed credits strength nobody logged in an app', /STR[\s\S]*Garmin and Strava/.test(await p2.textContent('#stats')));
ok('and its weekly targets, without being asked again', await shown(p2, '#today') && !(await shown(p2, '#setup')) && /DEX.*done/.test(await p2.textContent('#goals')));
ok('a device with no sessions writes no file', ledgers().length === 1);
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

// ---- the daily brief page (runner job 3) ----
{
  const d = new Date(), iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  drive[`hub-brief-${iso}.md`] = [
    `# Sat ${iso} · Dentist at 14:00`, '*Steady day.*', '',
    '## 🗓️ Outlook', '| | Today | Tomorrow |', '|---|---|---|', '| Weather | 🟢 12° dry | 🟠 rain |', '',
    '## 🏃 Fitness', '- Load is fine', '### Readiness', 'Sleep 7 h 40', '',
    '## 🔔 Needs you', '- 🔴 **Pay rent** before noon', '- [ ] call the dentist', '- <img src=x onerror="window.pwned=1"> and [a trap](javascript:window.pwned=2) and [ok](https://example.com/x)', '',
    '## 🎼 For pleasure', '- [Aria](https://adervec.github.io/classical-journey/#/w/bach-aria) by Bach', '',
    '---', '*Made today by the runner.*', '',
    '```runner-sources', JSON.stringify([{ name: 'calendar', state: 'ok', note: 'ok' }, { name: 'sleep last night', state: 'fail', note: 'FAILED: signed out' }, { name: 'web', state: 'off', note: 'not collected' }, { name: 'tachyread', state: 'stale', note: 'app brief 90 h old' }]), '```', '',
    '```runner-todoist', JSON.stringify({ today: iso, tasks: [{ id: 'T1', content: 'Pay rent', dueDate: '2000-01-01', priority: 4 }, { id: 'T2', content: 'Call the dentist', dueDate: iso, priority: 1 }], suggest: [{ content: 'Book a deload week', why: '12 lifts in 14 days', due: '' }] }), '```'].join('\n');
  await p2.route('https://adervec.github.io/classical-journey/**', (r) => r.fulfill({ contentType: 'text/html', body: '<p>the piece</p>' }));
  await p2.goto(new URL('brief.html', url).href);
  await p2.click('#show');
  await p2.waitForSelector('#brief .tile', { timeout: 8000 }).catch(() => {});
  const titles = await p2.$$eval('#brief .tile h2', (l) => l.map((x) => x.textContent));
  ok('the brief shows as tiles, Needs you first', titles[0] === '🔔 Needs you' && titles.length === 5 && /Dentist at 14:00/.test(await p2.textContent('#brief h1')));
  ok('severity colours the edge, a table makes a tile wide, drill-downs start closed', await p2.$eval('#brief .tile', (t) => t.classList.contains('red')) && await p2.$$eval('#brief .tile.wide', (l) => l.length === 1) && await p2.$eval('#brief details', (x) => !x.open));
  ok('nothing in a brief becomes markup or a script link', await p2.evaluate(() => !window.pwned && !document.querySelector('#brief img') && ![...document.querySelectorAll('#brief a')].some((a) => /^javascript:/i.test(a.getAttribute('href')))) && /onerror/.test(await p2.textContent('#brief')) && await p2.$$eval('#brief a[href^="https://example.com"]', (l) => l.length === 1));
  ok('the day list holds the brief', await p2.$$eval('#day option', (l) => l.length) === 1);
  ok('sources show as lights, problems first, and no Sources prose', await p2.$$eval('#brief .lights button', (l) => l.map((b) => b.className + ':' + b.textContent).join()) === 'fail:sleep last night,stale:tachyread,off:web,ok:calendar' && !/runner-sources/.test(await p2.textContent('#brief')));
  await p2.click('#brief .lights button.fail');
  ok('tapping a light says why', /signed out/.test(await p2.textContent('#why')));
  const td = await p2.$$eval('#brief .td li', (l) => l.map((x) => x.textContent));
  ok('Todoist is drawn as Todoist, right after Needs you, with the suggestion', (await p2.$$eval('#brief .tile h2', (l) => l[1].textContent)) === 'Todoist' && /Pay rent.*overdue/.test(td[0]) && /Call the dentist.*today/.test(td[1]) && /Book a deload week/.test(td[2]) && await p2.$eval('#brief .td .c', (c) => c.classList.contains('p1')));
  ok('each task links to it in Todoist', await p2.$eval('#brief .td a.t', (a) => a.href) === 'https://app.todoist.com/app/task/T1');
  await p2.evaluate(() => localStorage.setItem('portal-installed', JSON.stringify({ 'classical-journey': Date.now() })));
  await p2.click('#brief a[href*="classical-journey"]');
  await p2.waitForURL(/classical-journey\/#\/w\/bach-aria/, { timeout: 5000 }).catch(() => {});
  ok('a piece in an installed app opens in the same window (so the app can take it)', /classical-journey\/#\/w\/bach-aria/.test(p2.url()));
  await p2.goBack();
  await p2.evaluate(() => localStorage.removeItem('portal-installed'));
  await p2.click('#show');
  await p2.waitForSelector('#brief .tile', { timeout: 8000 }).catch(() => {});
  await p2.setViewportSize({ width: 390, height: 844 });
  ok('no sideways scroll on the brief page on a phone', await p2.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1);
  await p2.goto(url);
  ok('the hub top bar has the brief link and stays on one line on a phone', await p2.$('a[href="brief.html"]') && await p2.evaluate(() => { const h = document.querySelector('.head'); return h.getBoundingClientRect().height < 60; }));
}
ok('no page or CSP errors: ' + errs.join(' | '), !errs.length);
await b.close(); if (server) server.close();
console.log(fails.length ? 'FAIL\n  ' + fails.join('\n  ') : 'hub-check: all ok');
process.exit(fails.length ? 1 : 0);
