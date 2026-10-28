/* Smoke test for apps-dashboard. No dependencies: the app ships as three static
 * files and the test loads the real app.js the browser loads, then asserts on
 * the markup it produces and on the click classifier that decides whether a tap
 * toggled a row or opened an app.
 *
 *   node scripts/smoke.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
const fails = [];
const ok = (cond, msg) => { if (cond) pass++; else fails.push(msg); };
const eq = (a, b, msg) => ok(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const source = readFileSync(join(ROOT, 'app.js'), 'utf8');
const apps = JSON.parse(readFileSync(join(ROOT, 'apps.json'), 'utf8'));

/* --- app.js loads as a plain browser script ------------------------------ */
const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'app.js' });
const D = sandbox.Dashboard;
ok(D, 'app.js defines window.Dashboard');

/* --- data ---------------------------------------------------------------- */
eq(apps.length, 32, 'all 32 entries preserved');
eq(new Set(apps.map(a => a.slug)).size, 32, 'slugs are unique');
for (const a of apps) {
  ok(a.name && a.slug && a.status, `${a.slug}: name/slug/status present`);
  ok(typeof a.short === 'string' && a.short.length > 0, `${a.slug}: has a one-line blurb`);
  ok(a.short.length <= 95, `${a.slug}: blurb is one line (${a.short.length} chars)`);
  ok(!a.short.includes('\n'), `${a.slug}: blurb has no newline`);
  ok(/^https:\/\//.test(a.url), `${a.slug}: https url`);
  ok(a.repo === null || /^https:\/\/github\.com\//.test(a.repo), `${a.slug}: repo is a github url or null`);
}

/* --- list markup --------------------------------------------------------- */
const list = D.listHTML(apps);
eq((list.match(/<article class="row"/g) || []).length, 32, 'one row per app');
eq((list.match(/class="open"/g) || []).length, 32, 'one Open control per row');
ok(!/class="card"/.test(list), 'no cards left in the rendered markup');
const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
ok(!/repeat\(auto-fill/.test(css), 'the auto-fill card grid rule is gone from the stylesheet');
ok(!/main\{[^}]*display:grid/.test(css.replace(/\s+/g, '')), 'main is not a grid');
ok(/main\{[^}]*flex-direction:column/.test(css.replace(/\s+/g, '')), 'main lays out as a vertical list');

for (const a of apps) {
  const row = list.slice(list.indexOf(`data-slug="${a.slug}"`));
  const end = row.indexOf('</article>');
  const frag = row.slice(0, end);
  ok(frag.includes(`href="${a.url}"`), `${a.slug}: Open points at the app url`);
  ok(frag.includes(`aria-controls="d-${a.slug}"`), `${a.slug}: toggle is wired to its detail`);
  ok(frag.includes('aria-expanded="false"'), `${a.slug}: starts collapsed`);
  ok(/<div class="detail" id="d-[^"]+" hidden>/.test(frag), `${a.slug}: detail is hidden until expanded`);
  ok(frag.includes(D.esc(a.short)), `${a.slug}: row shows the one-liner`);
  ok(frag.includes(D.esc(a.desc)), `${a.slug}: detail shows the full blurb`);
  ok(frag.includes(`<span class="badge ${a.status}">${a.status}</span>`), `${a.slug}: status in the row`);
  if (a.repo) ok(frag.includes(`href="${a.repo}"`), `${a.slug}: GitHub link in the detail`);
  else ok(frag.includes('private repo'), `${a.slug}: private repo noted in the detail`);
  for (const t of a.tags || []) ok(frag.includes(`>${t}</span>`), `${a.slug}: tag ${t} in the detail`);
}

/* the Open anchor must not be nested inside the toggle button — a nested
   interactive element is what makes a tap hit both controls */
ok(!/<button[^>]*>(?:(?!<\/button>)[\s\S])*<a /.test(list), 'no anchor nested inside the row button');

/* --- ordering and footer ------------------------------------------------- */
const sorted = D.sortApps(apps);
for (let i = 1; i < sorted.length; i++)
  ok(D.updatedOf(sorted[i - 1]) >= D.updatedOf(sorted[i]), `newest first: ${sorted[i - 1].slug} before ${sorted[i].slug}`);
for (const a of apps) if (a.repo) ok(!isNaN(Date.parse(a.updated)), `${a.slug}: has an updated stamp`);
eq(sorted[sorted.length - 1].slug, 'beach', 'an entry with no date sorts last');

eq(apps.map(a => a.slug).join(), JSON.parse(readFileSync(join(ROOT, 'apps.json'), 'utf8')).map(a => a.slug).join(), 'sortApps leaves the input order alone');

/* pins: pinned first, newest first among pins, then the rest newest first */
const oldest = sorted[sorted.length - 2].slug, older = sorted[sorted.length - 3].slug;
const pinnedSort = D.sortApps(apps, [oldest, older]);
eq(pinnedSort[0].slug, older, 'pinned apps go on top, newest pin first');
eq(pinnedSort[1].slug, oldest, 'second pin next');
eq(pinnedSort[2].slug, sorted[0].slug, 'then the newest unpinned app');
const pinnedList = D.listHTML(apps, [oldest], Date.parse('2026-10-29T00:00:00Z'));
ok(pinnedList.indexOf(`data-slug="${oldest}"`) < pinnedList.indexOf(`data-slug="${sorted[0].slug}"`), 'pinned row renders first');
ok(pinnedList.includes(`<article class="row pinned" data-slug="${oldest}"`), 'pinned row is marked');
eq((pinnedList.match(/aria-pressed="true"/g) || []).length, 1, 'exactly one pin pressed');
eq((pinnedList.match(/class="pin"/g) || []).length, 32, 'every row has a pin button');

/* cookie */
eq(D.readPins('a=1; pinned=rock-bots%2Cdino-duel; b=2').join(), 'rock-bots,dino-duel', 'pins read from the cookie');
eq(D.readPins('').length, 0, 'no cookie, no pins');
eq(D.readPins('pinned=ok%2C%3Cx%3E').join(), 'ok', 'junk slugs in the cookie are dropped');
ok(/^pinned=rock-bots%2Cdino-duel; Path=\/; Max-Age=\d+; SameSite=Lax; Secure$/.test(D.pinCookie(['rock-bots', 'dino-duel'])), 'cookie string');
eq(D.readPins(D.pinCookie(['a', 'b-c'])).join(), 'a,b-c', 'cookie round-trips');
eq(D.togglePin(['a'], 'b').join(), 'a,b', 'pin adds');
eq(D.togglePin(['a', 'b'], 'a').join(), 'b', 'pin again removes');

/* live GitHub dates only move forward */
const m = [{ slug: 'x', repo: 'https://github.com/o/x', updated: '2026-10-01T00:00:00Z' },
           { slug: 'y', repo: 'https://github.com/o/y', updated: '2026-10-05T00:00:00Z' },
           { slug: 'z', repo: null }];
eq(D.mergeGitHub(m, [{ html_url: 'https://github.com/o/X', pushed_at: '2026-10-09T00:00:00Z' },
                     { html_url: 'https://github.com/o/y', pushed_at: '2026-10-02T00:00:00Z' }]), true, 'merge reports a change');
eq(m[0].updated, '2026-10-09T00:00:00Z', 'newer push wins');
eq(m[1].updated, '2026-10-05T00:00:00Z', 'older push is ignored');
eq(D.mergeGitHub(m, null), false, 'no repos, no change');
eq(D.githubOwners(apps).join(), 'nathandunn', 'one GitHub owner to ask');

/* relative times */
const now = Date.parse('2026-10-28T23:00:00Z');
eq(D.ago(now - 5 * 60e3, now), '5m ago', 'minutes');
eq(D.ago(now - 3 * 3600e3, now), '3h ago', 'hours');
eq(D.ago(now - 12 * 86400e3, now), '12d ago', 'days');
eq(D.ago(Date.parse('2026-09-09T16:00:00Z'), now), 'Sep 9', 'older shows the date');
eq(D.ago(0, now), '', 'no date, no label');
eq(D.footText(apps, '2026-09-11'), '32 live · 0 building · 0 planned · updated 2026-09-11', 'footer counts');

/* --- click classification ------------------------------------------------ */
const node = (tag, cls, parent) => ({
  tagName: tag,
  classList: { contains: c => cls.includes(c) },
  parentElement: parent || null
});
const row = node('ARTICLE', ['row']);
const head = node('DIV', ['head'], row);
const btn = node('BUTTON', ['rowbtn'], head);
const label = node('SPAN', ['name'], btn);
const actions = node('DIV', ['actions'], head);
const open = node('A', ['open'], actions);
const pinBtn = node('BUTTON', ['pin'], actions);
const pinIcon = node('svg', [], pinBtn);
const metaLink = node('A', ['meta-link'], node('DD', [], node('DL', ['meta'], row)));
const outside = node('FOOTER', ['foot']);

eq(D.classify(label), 'toggle', 'tapping the row text toggles detail');
eq(D.classify(btn), 'toggle', 'tapping the button toggles detail');
eq(D.classify(head), 'toggle', 'tapping row padding toggles detail');
eq(D.classify(open), 'link', 'tapping Open does not toggle');
eq(D.classify(pinBtn), 'pin', 'tapping the pin pins, not toggles');
eq(D.classify(pinIcon), 'pin', 'tapping the pin icon pins');
eq(D.classify(metaLink), 'link', 'tapping a detail link does not toggle');
eq(D.classify(outside), null, 'clicks outside a row do nothing');
eq(D.rowOf(label), row, 'rowOf walks up to the row');

/* --- expand / collapse --------------------------------------------------- */
const stubRow = (() => {
  const classes = new Set();
  const b = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
  const d = { hidden: true };
  return {
    classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) },
    querySelector: sel => (sel === '.rowbtn' ? b : sel === '.detail' ? d : null),
    _btn: b, _detail: d
  };
})();
eq(D.toggle(stubRow), true, 'first click expands');
eq(stubRow._detail.hidden, false, 'detail is revealed');
eq(stubRow._btn.attrs['aria-expanded'], 'true', 'aria-expanded follows the state');
eq(D.toggle(stubRow), false, 'second click collapses');
eq(stubRow._detail.hidden, true, 'detail is hidden again');
eq(stubRow._btn.attrs['aria-expanded'], 'false', 'aria-expanded follows the state back');

/* stopPropagation is called for links, and only for links */
const events = [];
let handler = null;
D.wire({ addEventListener: (t, fn) => { handler = fn; } });
ok(typeof handler === 'function', 'wire attaches one delegated listener');
handler({ target: open, stopPropagation: () => events.push('stopped') });
eq(events.length, 1, 'a click on Open stops propagating to the row');
eq(stubRow._detail.hidden, true, 'and expands nothing');

/* --- nothing here needs JS or MIME types the static export lacks --------- */
ok(!/\bimport\s|\bexport\s|require\(/.test(source), 'app.js is not an ES module or CommonJS');
ok(!/type="module"/.test(html), 'no module script tag (nginx would need the JS MIME type either way)');
ok(!/https?:\/\/(?!apps\.|[a-z-]+\.apps\.)[a-z]/i.test(html), 'no external CDN dependency in index.html');
ok(!/\?\.|\?\?/.test(source), 'no optional chaining / nullish coalescing (kept to widely-supported syntax)');
ok(html.includes('<script src="./app.js"></script>'), 'index.html loads app.js as a plain script');
ok(html.includes('id="list"'), 'index.html has the list mount point');

/* --- escaping ------------------------------------------------------------ */
ok(D.rowHTML({ name: '<img x>', slug: 's', short: '"q"', desc: '&', status: 'live', url: 'https://x/', repo: null })
  .includes('&lt;img x&gt;'), 'markup is escaped');

console.log(`${pass} assertions passed${fails.length ? `, ${fails.length} FAILED` : ''}`);
for (const f of fails) console.error('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
