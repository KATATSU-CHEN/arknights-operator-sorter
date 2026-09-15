/* 交互式归并排序引擎（用户作为比较器）
 * 支持平局(tie)与撤销(undo)。可在浏览器与 Node 中使用。
 * items 需为对象数组，且每个对象具有唯一的 .id 字段。
 */
(function (factory) {
  const Sorter = factory();
  if (typeof globalThis !== 'undefined') globalThis.Sorter = Sorter; // 浏览器 / Node(ESM)
  if (typeof module !== 'undefined' && module.exports) module.exports = { Sorter }; // Node(CJS)
})(function () {
  'use strict';

  class Sorter {
    constructor(items) {
      this.runs = items.map((x) => [x]);
      this.next = [];
      this.ri = 0;
      this.left = null; this.right = null;
      this.i = 0; this.j = 0; this.merged = [];
      this.comparisons = 0;
      this.uf = new Map(); // 并查集：记录平局等价关系
      this.history = [];
      this.finished = false;
      this.result = null;
      // 最多对比次数（选择页提示用；平局会让实际次数更少）
      this.estimate = Sorter.worstCaseComparisons(items.length);
      // 进度用「元素归位数」度量：确定性、单调、与平局无关，结束时恰为 100%
      this.placed = 0;
      this.totalPlace = Sorter._totalPlacements(items.length);
      this._prepare();
    }

    // 归并排序的最坏情况对比次数（每个 merge 最多 a+b-1 次；只与 n 有关）
    static worstCaseComparisons(n) {
      if (n < 2) return 0;
      let sizes = new Array(n).fill(1);
      let total = 0;
      while (sizes.length > 1) {
        const next = [];
        let i = 0;
        while (i + 1 < sizes.length) { const a = sizes[i], b = sizes[i + 1]; total += a + b - 1; next.push(a + b); i += 2; }
        if (i < sizes.length) next.push(sizes[i]);
        sizes = next;
      }
      return total;
    }

    // 归并排序中所有 merge 会把元素归位的总次数（只与 n 有关）
    static _totalPlacements(n) {
      if (n < 2) return 1;
      let sizes = new Array(n).fill(1);
      let total = 0;
      while (sizes.length > 1) {
        const next = [];
        let i = 0;
        while (i + 1 < sizes.length) { const m = sizes[i] + sizes[i + 1]; total += m; next.push(m); i += 2; }
        if (i < sizes.length) next.push(sizes[i]); // 奇数段直接进位，不产生归位
        sizes = next;
      }
      return total || 1;
    }

    _prepare() {
      while (true) {
        if (this.left) {
          if (this.i < this.left.length && this.j < this.right.length) return;
          while (this.i < this.left.length) { this.merged.push(this.left[this.i++]); this.placed++; }
          while (this.j < this.right.length) { this.merged.push(this.right[this.j++]); this.placed++; }
          this.next.push(this.merged);
          this.left = null; this.right = null; this.merged = [];
          continue;
        }
        if (this.ri + 1 < this.runs.length) {
          this.left = this.runs[this.ri];
          this.right = this.runs[this.ri + 1];
          this.ri += 2; this.i = 0; this.j = 0; this.merged = [];
          continue;
        }
        if (this.ri < this.runs.length) {
          this.next.push(this.runs[this.ri]); this.ri += 1;
          continue;
        }
        if (this.next.length <= 1) {
          this.finished = true;
          this.result = this.next[0] || this.runs[0] || [];
          return;
        }
        this.runs = this.next; this.next = []; this.ri = 0;
      }
    }

    current() {
      if (this.finished) return null;
      return { a: this.left[this.i], b: this.right[this.j] };
    }

    _snapshot() {
      const dc = (arr) => arr.map((r) => r.slice());
      this.history.push({
        runs: dc(this.runs),
        next: dc(this.next),
        merged: this.merged.slice(),
        left: this.left ? this.left.slice() : null,
        right: this.right ? this.right.slice() : null,
        ri: this.ri, i: this.i, j: this.j,
        comparisons: this.comparisons,
        placed: this.placed,
        finished: this.finished,
        uf: new Map(this.uf),
      });
    }

    _find(x) {
      if (!this.uf.has(x)) { this.uf.set(x, x); return x; }
      let root = x;
      while (this.uf.get(root) !== root) root = this.uf.get(root);
      while (this.uf.get(x) !== root) { const nx = this.uf.get(x); this.uf.set(x, root); x = nx; }
      return root;
    }
    _union(a, b) { const ra = this._find(a), rb = this._find(b); if (ra !== rb) this.uf.set(ra, rb); }
    _sameRank(a, b) { return this._find(a) === this._find(b); }

    choose(dir) {
      if (this.finished) return;
      this._snapshot();
      const a = this.left[this.i];
      const b = this.right[this.j];
      if (dir === 'left') { this.merged.push(a); this.i++; this.placed++; }
      else if (dir === 'right') { this.merged.push(b); this.j++; this.placed++; }
      else { this.merged.push(a); this.i++; this.merged.push(b); this.j++; this.placed += 2; this._union(a.id, b.id); }
      this.comparisons++;
      this._prepare();
    }

    undo() {
      if (!this.history.length) return false;
      const s = this.history.pop();
      this.runs = s.runs; this.next = s.next; this.merged = s.merged;
      this.left = s.left; this.right = s.right;
      this.ri = s.ri; this.i = s.i; this.j = s.j;
      this.comparisons = s.comparisons;
      this.placed = s.placed;
      this.finished = s.finished;
      this.uf = s.uf;
      this.result = null;
      return true;
    }

    percent() {
      if (this.finished) return 100;
      return Math.min(99, Math.floor((this.placed / this.totalPlace) * 100));
    }

    ranked() {
      const list = this.result || [];
      const out = [];
      for (let k = 0; k < list.length; k++) {
        let rank = k + 1;
        if (k > 0 && this._sameRank(list[k - 1].id, list[k].id)) rank = out[k - 1].rank;
        out.push({ op: list[k], rank });
      }
      return out;
    }
  }

  return Sorter;
});
