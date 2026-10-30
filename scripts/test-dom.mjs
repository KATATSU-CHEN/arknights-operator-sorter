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
run(read('quiz-pro.js'));
run(read('chess.js'));

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

// ---------------- Arknights Guess Pro ----------------
const GP = window.__guesspro;
ok(GP && typeof GP.enterGuessPro === 'function', 'guesspro module exposed');
doc.querySelector('#nav-guesspro').dispatchEvent(new window.Event('click', { bubbles: true }));
ok(!doc.querySelector('#view-guesspro').classList.contains('hidden'), 'guesspro view shown');
ok(doc.querySelector('#nav-guesspro').classList.contains('active'), 'guesspro nav active');
ok(doc.querySelector('#quiz-entry') && !doc.querySelector('#quiz-entry').classList.contains('active'), 'other nav cleared when entering guesspro');

GP.cfg.pool = 'all';
doc.querySelector('#gp-start').dispatchEvent(new window.Event('click', { bubbles: true }));
ok(!doc.querySelector('#gp-play').classList.contains('hidden'), 'guesspro play view shown');
const tiles = doc.querySelectorAll('#gp-grid .gp-tile');
ok(tiles.length === 20, 'guesspro grid has 20 tiles: ' + tiles.length);
ok(GP.game.revealed === 1, 'stage 1 reveals exactly 1 tile: ' + GP.game.revealed);
ok(doc.querySelectorAll('#gp-grid .gp-tile.revealed').length === 1, 'exactly 1 tile revealed in DOM');

const tgt = GP.game.target;
ok(!!tgt, 'guesspro has a target');
// A wrong (but valid) guess consumes a chance
const wrong = window.ARK_DATA.operators.find((o) => o.id !== tgt.id);
doc.querySelector('#gp-input').value = wrong.name;
doc.querySelector('#gp-submit').dispatchEvent(new window.Event('click', { bubbles: true }));
ok(GP.game.guessesLeft === 2, 'wrong guess consumes a chance: ' + GP.game.guessesLeft);
// An unknown name does NOT consume a chance
doc.querySelector('#gp-input').value = '不存在的干员xyz';
doc.querySelector('#gp-submit').dispatchEvent(new window.Event('click', { bubbles: true }));
ok(GP.game.guessesLeft === 2, 'unknown name does not consume a chance');
// Correct guess wins and reveals everything
doc.querySelector('#gp-input').value = tgt.name;
doc.querySelector('#gp-submit').dispatchEvent(new window.Event('click', { bubbles: true }));
ok(GP.game.over === true, 'correct guess ends round');
ok(GP.game.solved === 1, 'solved count increments');
ok(doc.querySelectorAll('#gp-grid .gp-tile.revealed').length === 20, 'all tiles revealed on win');
ok(!doc.querySelector('#gp-result').classList.contains('hidden'), 'result panel shown on win');

// Skin pool: only operators with skins, and the shown art comes from the skin CDN
ok(typeof window.ARK_DATA.skinBase === 'string' && window.ARK_DATA.skinBase, 'data has skinBase');
ok(window.ARK_DATA.operators.some((o) => o.skins && o.skins.length), 'some operators have skins');
GP.cfg.pool = 'skin';
GP.startGame();
ok(GP.game.target && GP.game.target.skins && GP.game.target.skins.length > 0, 'skin round target has skins');
ok((doc.querySelector('#gp-art').style.backgroundImage || '').includes('/skin/'), 'skin round shows art from skin CDN');

// Give-up button: reveals the answer and ends the round
GP.cfg.pool = 'all';
GP.startGame();
doc.querySelector('#gp-giveup').click();
ok(GP.game.over === true, 'give up ends the round');
ok(GP.game.revealed === 20, 'give up reveals the full illustration');
ok(doc.querySelector('#gp-name').classList.contains('show'), 'give up shows the answer name');
ok(!doc.querySelector('#gp-result').classList.contains('hidden'), 'give up shows result panel');

// ---------------- Arknights Chess（五子棋 AI） ----------------
const CH = window.__chess;
ok(CH && typeof CH.enterChess === 'function', 'chess module exposed');
doc.querySelector('#nav-chess').dispatchEvent(new window.Event('click', { bubbles: true }));
ok(!doc.querySelector('#view-chess').classList.contains('hidden'), 'chess view shown');
ok(doc.querySelector('#nav-chess').classList.contains('active'), 'chess nav active');
doc.querySelector('#chess-start').dispatchEvent(new window.Event('click', { bubbles: true }));
ok(doc.querySelectorAll('#chess-board .chess-cell').length === 225, 'chess board has 225 cells');
{
  const In = CH._internals;
  const fresh = () => { const b = In.newBoard(); CH.game.board = b; CH.game.over = false; CH.game.thinking = false; return b; };
  // AI 必挡：玩家活四且 AI 无法自赢 -> 堵在连五点
  CH.cfg.diff = 'hard';
  let b = fresh();
  for (let c = 3; c <= 6; c++) b[7][c] = In.YOU;
  let mv = CH.aiMove();
  b[mv[0]][mv[1]] = In.YOU;
  ok(In.makesFive(b, mv[0], mv[1], In.YOU), 'chess AI blocks the opponent winning move');
  // AI 必胜：自己有活四 -> 直接连五
  b = fresh();
  for (let c = 3; c <= 6; c++) b[7][c] = In.AI;
  for (let c = 3; c <= 6; c++) b[9][c] = In.YOU;
  mv = CH.aiMove();
  b[mv[0]][mv[1]] = In.AI;
  ok(In.makesFive(b, mv[0], mv[1], In.AI), 'chess AI takes its own winning move');
  // 简单难度也会落在空位
  CH.cfg.diff = 'easy';
  b = fresh(); b[7][7] = In.YOU;
  mv = CH.aiMove();
  ok(mv && b[mv[0]][mv[1]] === 0, 'chess easy AI plays a valid empty cell');
}

// Guess Pro: no operator repeats within a run (until the pool is exhausted)
GP.cfg.pool = 'r6';
GP.startGame();
{
  const poolSize = window.ARK_DATA.operators.filter((o) => o.rarity === 6).length;
  const seen = [GP.game.target.id];
  const rounds = Math.min(20, poolSize - 1);
  for (let k = 0; k < rounds; k++) { GP.nextRound(); seen.push(GP.game.target.id); }
  ok(new Set(seen).size === seen.length, 'guesspro: no repeats within a run (' + seen.length + ' rounds)');
}

// ---------------- 进度保存 / 恢复（引擎序列化） ----------------
{
  const S = window.Sorter;
  const sample = window.ARK_DATA.operators.slice(0, 9);
  const a = new S(sample);
  for (let k = 0; k < 5 && !a.finished; k++) a.choose(k % 3 === 0 ? 'tie' : 'left');
  const json = JSON.parse(JSON.stringify(a.toJSON())); // 模拟存入 localStorage 再取出
  const b = S.fromJSON(json, sample);
  ok(b.comparisons === a.comparisons, 'resume: comparisons preserved');
  ok(b.percent() === a.percent(), 'resume: percent preserved');
  const ca = a.current(), cb = b.current();
  ok((!ca && !cb) || (ca && cb && ca.a.id === cb.a.id && ca.b.id === cb.b.id), 'resume: current pair preserved');
  ok(b.undo() === true, 'resume: undo works after restore');
  while (!a.finished) a.choose('left');
  const c = S.fromJSON(json, sample);
  while (!c.finished) c.choose('left');
  const key = (s) => JSON.stringify(s.ranked().map((r) => r.op.id + ':' + r.rank));
  ok(key(c) === key(a), 'resume: same choices complete to identical ranking');
}

// ---------------- 进度保存 / 恢复（UI 全流程） ----------------
{
  const dom3 = new JSDOM(html, { runScripts: 'outside-only', virtualConsole: vc, url: 'http://localhost/' });
  dom3.window.alert = () => {}; dom3.window.scrollTo = () => {}; dom3.window.confirm = () => true;
  dom3.window.eval(read('data/operators.js'));
  dom3.window.eval(read('sorter-core.js'));
  dom3.window.eval(read('app.js'));
  const d3 = dom3.window.document;
  const fire = (el) => el.dispatchEvent(new dom3.window.Event('click', { bubbles: true }));
  const cc = d3.querySelectorAll('#grid .op');
  for (let k = 0; k < 6; k++) fire(cc[k]);
  fire(d3.querySelector('#start-btn'));
  fire(d3.querySelector('#choice-left'));
  fire(d3.querySelector('#choice-left'));
  ok(!!dom3.window.localStorage.getItem('ark_sorter_progress_v1'), 'progress auto-saved to localStorage');
  fire(d3.querySelector('#quit-btn'));
  ok(!d3.querySelector('#view-select').classList.contains('hidden'), 'quit returns to select view');
  ok(!d3.querySelector('#resume-bar').classList.contains('hidden'), 'resume bar shown after quit');
  fire(d3.querySelector('#resume-btn'));
  ok(!d3.querySelector('#view-sort').classList.contains('hidden'), 'resume reopens sort view');
  ok(d3.querySelector('#progress-text').textContent.includes('第 3'), 'resume continues at 3rd comparison');
  // 完成排序后进度被清除
  let guard = 0;
  while (d3.querySelector('#view-result').classList.contains('hidden') && guard++ < 5000) {
    fire(d3.querySelector('#choice-left'));
  }
  ok(!dom3.window.localStorage.getItem('ark_sorter_progress_v1'), 'progress cleared after finishing');
}

console.log(fail ? `\nDOM smoke test: ${fail} failures` : '\nDOM smoke test: all checks passed');
process.exit(fail ? 1 : 0);
