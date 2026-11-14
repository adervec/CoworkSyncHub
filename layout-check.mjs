// Layout check (house standard 21): an app's screen at phone (390x844) and desktop (1280x800) size.
// Usage: node layout-check.mjs [App,App2] [--url http://localhost:5173/#/report]   (default: every portal app, live)
// Open the screen you changed (a report with a long transcript, a results page) with --url and a seeded state.
// Flags horizontal overflow (with the widest culprit) and tall unclamped text walls.
// ponytail: first screen only; reports, histories etc. need seeded data (add per-app SMOKE_HASH routes when wanted).
import { chromium } from 'playwright-core';
const argv = process.argv.slice(2), ui = argv.indexOf('--url'), url = ui >= 0 ? argv[ui + 1] : null;
const apps = (url ? 'page' : (argv.find(x => !x.startsWith('--') && x !== url) || process.env.ONLY || 'GymTracker315,Tachyread,ChessRetabled,GuitarPicker,BlackMirrorBikeRide,BodybuildingProgressCoach,HandwritingHelper,MicroMiniger,SpeechImprover,MarksmanApp,Run315,learning-pit,MusicStudio,long-gallery,classical-journey,InsightMaster,CelebrityCrusher,Mise')).split(',');
let flags = 0;
const sizes = { phone: { width: 390, height: 844 }, desktop: { width: 1280, height: 800 } };
const b = await chromium.launch({ channel: 'chrome' });
for (const a of apps) for (const [label, viewport] of Object.entries(sizes)) {
  const ctx = await b.newContext({ viewport, isMobile: label === 'phone', hasTouch: label === 'phone' });
  const p = await ctx.newPage();
  try { await p.goto(url || `https://adervec.github.io/${a}/`, { waitUntil: 'load', timeout: 60000 }); await p.waitForTimeout(4000); }
  catch (e) { console.log(a, label, 'LOAD FAIL'); await ctx.close(); continue; }
  const r = await p.evaluate(() => {
    const vw = innerWidth, vh = innerHeight, out = { overflow: 0, culprit: '', walls: [] };
    const name = el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
    out.overflow = document.documentElement.scrollWidth - vw;
    if (out.overflow > 1) {
      let worst = null, w = vw;
      for (const el of document.body.querySelectorAll('*')) {
        const rc = el.getBoundingClientRect();
        if (rc.right > w + 1 && rc.width > 0 && getComputedStyle(el).position !== 'fixed') { w = rc.right; worst = el; }
      }
      out.culprit = worst ? name(worst) + ' ' + Math.round(w) + 'px' : '?';
    }
    const tall = el => el.getBoundingClientRect().height > vh * 0.6;
    for (const el of document.body.querySelectorAll('p,div,pre,section,article,blockquote,li,td')) {
      if (!tall(el) || el.closest('[data-clamp]') || el.querySelector('button,input,select,textarea,canvas,svg,img,video,a')) continue;
      if ([...el.children].some(tall)) continue;
      const cs = getComputedStyle(el);
      if (/auto|scroll/.test(cs.overflowY) && el.scrollHeight > el.clientHeight) continue; // own scroll box
      const n = el.innerText.trim().length;
      if (n > 800) out.walls.push(name(el) + ' ' + Math.round(el.getBoundingClientRect().height) + 'px/' + n + 'ch');
    }
    return out;
  });
  const bad = r.overflow > 1 || r.walls.length; if (bad) flags++;
  console.log(`${bad ? 'FLAG' : 'ok  '} ${a.padEnd(26)} ${label.padEnd(7)} ${r.overflow > 1 ? 'sideways scroll +' + r.overflow + 'px (' + r.culprit + ') ' : ''}${r.walls.length ? 'text wall: ' + r.walls.slice(0, 3).join(', ') : ''}`);
  await ctx.close();
}
await b.close();
process.exit(flags ? 1 : 0);
