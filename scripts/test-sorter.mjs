// Validates the interactive merge-sort engine.
// Run: node sorter/scripts/test-sorter.mjs
import '../sorter-core.js'; // 副作用：设置 globalThis.Sorter
const Sorter = globalThis.Sorter;

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('  FAIL:', msg); } }

// Drive the sorter using a ground-truth comparator (higher val = better = ranked first)
function run(values, comparator) {
  const items = values.map((v, i) => ({ id: 'x' + i, v }));
  const s = new Sorter(items);
  let guard = 0;
  while (!s.finished) {
    if (++guard > 200000) throw new Error('non-terminating');
    const { a, b } = s.current();
    s.choose(comparator(a, b));
  }
  return { s, order: s.result.map((o) => o.v) };
}

// 1) Correctness across many random sizes vs. native sort
for (let n = 0; n <= 50; n++) {
  const vals = Array.from({ length: n }, () => Math.floor(Math.random() * 1000));
  const { order } = run(vals, (a, b) => (a.v > b.v ? 'left' : a.v < b.v ? 'right' : 'left'));
  const expect = [...vals].sort((x, y) => y - x); // desc
  ok(JSON.stringify(order) === JSON.stringify(expect), `sort n=${n}: got ${order} want ${expect}`);
}

// 2) Comparison count is reasonable (<= n*ceil(log2 n) upper bound, no ties)
{
  const n = 64;
  const vals = Array.from({ length: n }, (_, i) => n - i);
  let cmp = 0;
  const items = vals.map((v, i) => ({ id: 'y' + i, v }));
  const s = new Sorter(items);
  while (!s.finished) { const { a, b } = s.current(); cmp++; s.choose(a.v > b.v ? 'left' : 'right'); }
  const bound = n * Math.ceil(Math.log2(n));
  ok(cmp <= bound, `comparisons ${cmp} within bound ${bound}`);
  ok(s.comparisons === cmp, 'comparisons counter matches');
}

// 3) Ties produce equal ranks for consecutive equal items
{
  // three groups of equal value
  const vals = [5, 5, 3, 3, 3, 1];
  const { s } = run(vals, (a, b) => (a.v > b.v ? 'left' : a.v < b.v ? 'right' : 'tie'));
  const ranked = s.ranked();
  const byVal = {};
  ranked.forEach((r) => { (byVal[r.op.v] = byVal[r.op.v] || []).push(r.rank); });
  // all items of same value should share the same rank
  let tiesOk = true;
  Object.values(byVal).forEach((ranks) => { if (new Set(ranks).size !== 1) tiesOk = false; });
  ok(tiesOk, 'tied items share rank: ' + JSON.stringify(ranked.map((r) => [r.op.v, r.rank])));
  // values still ordered desc
  const vseq = ranked.map((r) => r.op.v);
  ok(JSON.stringify(vseq) === JSON.stringify([5, 5, 3, 3, 3, 1]), 'tie order desc: ' + vseq);
}

// 4) Undo perfectly reverses a choice (state round-trips)
{
  const vals = Array.from({ length: 20 }, () => Math.floor(Math.random() * 100));
  const items = vals.map((v, i) => ({ id: 'z' + i, v }));
  const s = new Sorter(items);
  const snap = (x) => JSON.stringify({
    cur: x.current(), c: x.comparisons, ri: x.ri, i: x.i, j: x.j,
    runs: x.runs, next: x.next, merged: x.merged, left: x.left, right: x.right,
    fin: x.finished,
  });
  let undoOk = true;
  for (let k = 0; k < 30 && !s.finished; k++) {
    const before = snap(s);
    const { a, b } = s.current();
    s.choose(a.v >= b.v ? 'left' : 'right');
    s.undo();
    if (snap(s) !== before) { undoOk = false; break; }
    // redo the real choice to keep progressing
    const { a: a2, b: b2 } = s.current();
    s.choose(a2.v >= b2.v ? 'left' : 'right');
  }
  ok(undoOk, 'undo round-trips state exactly');
}

// 5) Full undo back to start
{
  const vals = [4, 2, 7, 1, 9, 3];
  const items = vals.map((v, i) => ({ id: 'w' + i, v }));
  const s = new Sorter(items);
  const start = JSON.stringify({ runs: s.runs, cur: s.current() });
  let steps = 0;
  while (!s.finished) { const { a, b } = s.current(); s.choose(a.v > b.v ? 'left' : 'right'); steps++; }
  for (let k = 0; k < steps; k++) s.undo();
  ok(JSON.stringify({ runs: s.runs, cur: s.current() }) === start, 'undo all the way back to start');
  ok(s.comparisons === 0 && s.history.length === 0, 'counters reset after full undo');
}

// 6b) Progress percentage: monotonic non-decreasing, ends at 100, sane range
for (const [n, tie] of [[13, false], [40, true], [64, false], [7, true]]) {
  const items = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, v: Math.floor(Math.random() * 5) }));
  const s = new Sorter(items);
  let prev = -1, monotonic = true, guard = 0;
  while (!s.finished) {
    if (++guard > 100000) break;
    const p = s.percent();
    if (p < prev) monotonic = false;
    prev = p;
    const { a, b } = s.current();
    // with ties enabled, equal values tie; otherwise pick better
    const dir = tie && a.v === b.v ? 'tie' : a.v >= b.v ? 'left' : 'right';
    s.choose(dir);
  }
  ok(monotonic, `progress monotonic (n=${n}, tie=${tie})`);
  ok(s.percent() === 100, `progress ends at 100 (n=${n}, tie=${tie})`);
  ok(s.placed === s.totalPlace, `placed==totalPlace at end (n=${n}) ${s.placed}/${s.totalPlace}`);
}

// 6c) Progress reflects real advance early on (not stuck at 0 after a few picks)
{
  const n = 32;
  const items = Array.from({ length: n }, (_, i) => ({ id: 'q' + i, v: n - i }));
  const s = new Sorter(items);
  for (let k = 0; k < 8 && !s.finished; k++) { const { a, b } = s.current(); s.choose(a.v > b.v ? 'left' : 'right'); }
  ok(s.percent() > 0 && s.percent() < 100, 'progress advances after a few comparisons: ' + s.percent() + '%');
}

// 6d) Progress round-trips through undo
{
  const items = Array.from({ length: 20 }, (_, i) => ({ id: 'u' + i, v: Math.random() }));
  const s = new Sorter(items);
  const { a, b } = s.current();
  const p0 = s.percent();
  s.choose(a.v > b.v ? 'left' : 'right');
  s.undo();
  ok(s.percent() === p0, 'percent restored after undo');
}

// 6e) worstCaseComparisons: known values + it is a true upper bound (no ties)
{
  ok(Sorter.worstCaseComparisons(0) === 0 && Sorter.worstCaseComparisons(1) === 0, 'wcc 0/1 = 0');
  ok(Sorter.worstCaseComparisons(2) === 1, 'wcc 2 = 1');
  ok(Sorter.worstCaseComparisons(4) === 5, 'wcc 4 = 5');
  ok(Sorter.worstCaseComparisons(15) === 45, 'wcc 15 = 45 (got ' + Sorter.worstCaseComparisons(15) + ')');
  // power-of-two closed form: n*log2(n) - n + 1
  for (const k of [1, 2, 3, 4, 5, 6]) {
    const n = 1 << k;
    ok(Sorter.worstCaseComparisons(n) === n * k - n + 1, `wcc pow2 n=${n}`);
  }
  // actual comparisons (no ties) never exceed the worst-case bound
  let boundOk = true;
  for (let n = 2; n <= 80; n++) {
    const vals = Array.from({ length: n }, () => Math.random());
    const items = vals.map((v, i) => ({ id: 'b' + i, v }));
    const s = new Sorter(items);
    while (!s.finished) { const { a, b } = s.current(); s.choose(a.v > b.v ? 'left' : 'right'); }
    if (s.comparisons > Sorter.worstCaseComparisons(n)) { boundOk = false; console.error('   n=' + n + ' cmp=' + s.comparisons + ' bound=' + Sorter.worstCaseComparisons(n)); }
  }
  ok(boundOk, 'actual comparisons <= worstCaseComparisons for n=2..80');
}

// 6) Edge cases: 0 and 1 items
{
  const s0 = new Sorter([]);
  ok(s0.finished && s0.ranked().length === 0, 'empty selection finishes');
  const s1 = new Sorter([{ id: 'a', v: 1 }]);
  ok(s1.finished && s1.ranked().length === 1 && s1.ranked()[0].rank === 1, 'single item finishes');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
