// Headless DOM smoke test: loads index.html + scripts in jsdom, drives a full
// selection -> sort -> result flow, and checks the share-link round-trip.
// Run: node sorter/scripts/test-dom.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.error('  FAIL:', m); } };

const html = read('index.html')
  .replace(/<script src="[^"]+"><\/script>/g, ''); // strip external scripts; we inject manually

const vc = new VirtualConsole();
vc.on('jsdomError', (e) => { fail++; console.error('  jsdomError:', e.message); });

const dom = new JSDOM(html, { runScripts: 'outside-only', virtualConsole: vc, url: 'http://localhost/' });
const { window } = dom;
window.alert = () => {};
window.scrollTo = () => {};
window.confirm = () => true;

// Inject the three scripts in order into the window context
const run = (code) => window.eval(code);
run(read('data/operators.js'));
run(read('sorter-core.js'));
run(read('app.js'));
run(read('quiz.js'));

const doc = window.document;
ok(window.ARK_DATA.operators.length > 0, 'data loaded');
ok(typeof window.Sorter === 'function', 'Sorter global present');

// Selection page rendered
const cards = doc.querySelectorAll('#grid .op');
ok(cards.length > 0, 'grid rendered operators: ' + cards.length);

// Nation filter chips built
const nationChips = doc.querySelectorAll('#nation-filters .chip');
ok(nationChips.length > 0, 'nation filter chips built: ' + nationChips.length);
// Clicking a nation chip narrows the grid, and clearing restores it
const total = cards.length;
nationChips[0].dispatchEvent(new window.Event('click', { bubbles: true }));
const narrowed = doc.querySelectorAll('#grid .op').length;
ok(narrowed > 0 && narrowed < total, 'nation filter narrows grid: ' + narrowed + '/' + total);
nationChips[0].dispatchEvent(new window.Event('click', { bubbles: true }));
ok(doc.querySelectorAll('#grid .op').length === total, 'nation filter cleared restores grid');

// Select 8 operators by clicking cards
const N = 8;
for (let k = 0; k < N; k++) cards[k].dispatchEvent(new window.Event('click', { bubbles: true }));
ok(doc.querySelector('#select-count').textContent.includes(String(N)), 'select count updates');
ok(!doc.querySelector('#start-btn').disabled, 'start enabled with >=2');

// Start sorting
doc.querySelector('#start-btn').dispatchEvent(new window.Event('click', { bubbles: true }));
ok(!doc.querySelector('#view-sort').classList.contains('hidden'), 'switched to sort view');

// Portrait mode default on; toggle flips it
ok(doc.querySelector('#view-sort').classList.contains('portrait-mode'), 'portrait mode on by default');
doc.querySelector('#portrait-toggle').dispatchEvent(new window.Event('click', { bubbles: true }));
ok(!doc.querySelector('#view-sort').classList.contains('portrait-mode'), 'portrait toggle -> avatar mode');
doc.querySelector('#portrait-toggle').dispatchEvent(new window.Event('click', { bubbles: true }));
ok(doc.querySelector('#view-sort').classList.contains('portrait-mode'), 'portrait toggle -> portrait mode');

// Drive comparisons: always pick left, occasionally tie, test one undo
let steps = 0, didUndo = false;
while (doc.querySelector('#view-result').classList.contains('hidden')) {
  if (++steps > 5000) { ok(false, 'sort did not terminate'); break; }
  if (!didUndo && steps === 3) {
    doc.querySelector('#undo-btn').dispatchEvent(new window.Event('click', { bubbles: true }));
    didUndo = true;
  }
  const btn = steps % 4 === 0
    ? doc.querySelector('#tie-btn')
    : doc.querySelector('#choice-left');
  btn.dispatchEvent(new window.Event('click', { bubbles: true }));
}
ok(didUndo, 'performed an undo mid-sort');

// Result view rendered as tiered ranking
const items = doc.querySelectorAll('#result-list .rank-item');
ok(items.length === N, 'ranked items = ' + items.length + ' (want ' + N + ')');
ok(doc.querySelector('.tier-podium .podium-item.gold'), 'podium gold (rank 1) present');
ok(doc.querySelectorAll('.tier-podium .podium-item').length === Math.min(3, N), 'podium has top-3');
ok(doc.querySelector('.rank-item .place-badge').textContent.trim() === '#1', 'first badge is #1');

// Share link round-trip: click copy-link, capture clipboard text, reload with hash
let copied = '';
window.navigator.clipboard = { writeText: (t) => { copied = t; return Promise.resolve(); } };
doc.querySelector('#copy-link-btn').dispatchEvent(new window.Event('click', { bubbles: true }));
ok(copied.includes('#result='), 'share link produced: ' + copied.slice(0, 40) + '...');

// New DOM loaded at the shared hash should render result directly
const hash = copied.slice(copied.indexOf('#'));
const dom2 = new JSDOM(html, { runScripts: 'outside-only', virtualConsole: vc, url: 'http://localhost/' + hash });
dom2.window.alert = () => {}; dom2.window.scrollTo = () => {};
dom2.window.eval(read('data/operators.js'));
dom2.window.eval(read('sorter-core.js'));
dom2.window.eval(read('app.js'));
const sharedRows = dom2.window.document.querySelectorAll('#result-list .rank-item');
ok(sharedRows.length === N, 'shared link renders ' + sharedRows.length + ' items');
ok(!dom2.window.document.querySelector('#view-result').classList.contains('hidden'), 'shared link opens result view');

// ---------------- 竞猜小游戏 ----------------
const Q = window.__quiz;
ok(Q && typeof Q.enterQuiz === 'function', 'quiz module exposed');
// Enter quiz from the select page entry button
doc.querySelector('#quiz-entry').dispatchEvent(new window.Event('click', { bubbles: true }));
ok(!doc.querySelector('#view-quiz').classList.contains('hidden'), 'quiz view shown after entry');
ok(doc.querySelector('#quiz-setup') && !doc.querySelector('#quiz-setup').classList.contains('hidden'), 'quiz setup visible');

// Configure a short round and start
Q.cfg.pool = 'r6'; Q.cfg.count = 5;
doc.querySelector('#quiz-start').dispatchEvent(new window.Event('click', { bubbles: true }));
ok(!doc.querySelector('#quiz-play').classList.contains('hidden'), 'quiz play view shown');
const opts = doc.querySelectorAll('#quiz-options .quiz-opt');
ok(opts.length === 4, 'quiz renders 4 options: ' + opts.length);
const target = Q.game.queue[Q.game.idx];
const correctOpts = [...opts].filter((b) => b.textContent === target.name);
ok(correctOpts.length === 1, 'exactly one correct option matches target');
const distinct = new Set([...opts].map((b) => b.textContent));
ok(distinct.size === 4, 'all 4 option names distinct');

// Answer correctly -> score increments, streak increments
const before = Q.game.score;
correctOpts[0].dispatchEvent(new window.Event('click', { bubbles: true }));
ok(Q.game.score === before + 1, 'correct answer increments score');
ok(doc.querySelector('#quiz-options .quiz-opt.right'), 'correct option highlighted');

console.log(fail ? `\nDOM smoke test: ${fail} failures` : '\nDOM smoke test: all checks passed');
process.exit(fail ? 1 : 0);
