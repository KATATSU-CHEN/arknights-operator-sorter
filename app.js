/* 明日方舟 干员排序器
 * 交互式归并排序（用户作为比较器），支持平局与撤销。
 */
(function () {
  'use strict';

  const DATA = window.ARK_DATA || { avatarBase: '', operators: [] };
  const OPS = DATA.operators;
  const AVATAR_BASE = DATA.avatarBase;

  const CLASS_LABEL = {
    PIONEER: '先锋', WARRIOR: '近卫', TANK: '重装', SNIPER: '狙击',
    CASTER: '术师', MEDIC: '医疗', SUPPORT: '辅助', SPECIAL: '特种',
  };

  // 灰色占位头像（加载失败时）
  const PLACEHOLDER =
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">' +
      '<rect width="100" height="100" fill="#1f242d"/>' +
      '<text x="50" y="55" font-size="12" fill="#9aa4b2" text-anchor="middle">no img</text></svg>'
    );

  const idIndex = new Map();
  OPS.forEach((o, i) => idIndex.set(o.id, i));

  function avatarUrl(o) { return AVATAR_BASE + '/' + o.id + '.png'; }
  function onImgError(img) { img.onerror = null; img.src = PLACEHOLDER; }
  function opSub(o) { return '★'.repeat(o.rarity) + ' · ' + (CLASS_LABEL[o.cls] || o.cls); }

  const Sorter = window.Sorter; // 来自 sorter-core.js

  /* =======================================================================
   *  应用状态 + 视图
   * ===================================================================== */
  const $ = (sel) => document.querySelector(sel);
  const views = {
    select: $('#view-select'),
    sort: $('#view-sort'),
    result: $('#view-result'),
  };
  function showView(name) {
    Object.values(views).forEach((v) => v.classList.add('hidden'));
    views[name].classList.remove('hidden');
    window.scrollTo(0, 0);
  }

  const state = {
    selected: new Set(),
    rarityFilter: new Set(),   // 空 = 全部
    classFilter: new Set(),    // 空 = 全部
    search: '',
    sorter: null,
  };

  /* ---------------- 选择页 ---------------- */
  function buildFilterChips() {
    const rf = $('#rarity-filters');
    rf.innerHTML = '<span class="hint" style="margin-right:4px">稀有度</span>';
    [6, 5, 4, 3, 2, 1].forEach((r) => {
      const c = document.createElement('span');
      c.className = 'chip';
      c.dataset.rarity = r;
      c.textContent = r + '★';
      c.onclick = () => { toggleSet(state.rarityFilter, r); c.classList.toggle('active'); renderGrid(); };
      rf.appendChild(c);
    });
    const cf = $('#class-filters');
    cf.innerHTML = '<span class="hint" style="margin-right:4px">职业</span>';
    Object.keys(CLASS_LABEL).forEach((k) => {
      const c = document.createElement('span');
      c.className = 'chip';
      c.dataset.cls = k;
      c.textContent = CLASS_LABEL[k];
      c.onclick = () => { toggleSet(state.classFilter, k); c.classList.toggle('active'); renderGrid(); };
      cf.appendChild(c);
    });
  }

  function toggleSet(set, v) { if (set.has(v)) set.delete(v); else set.add(v); }

  function filteredOps() {
    const q = state.search.trim().toLowerCase();
    return OPS.filter((o) => {
      if (state.rarityFilter.size && !state.rarityFilter.has(o.rarity)) return false;
      if (state.classFilter.size && !state.classFilter.has(o.cls)) return false;
      if (q && !(o.name.toLowerCase().includes(q) || o.en.toLowerCase().includes(q))) return false;
      return true;
    });
  }

  function renderGrid() {
    const grid = $('#grid');
    const list = filteredOps();
    const frag = document.createDocumentFragment();
    for (const o of list) {
      const el = document.createElement('div');
      el.className = 'op' + (state.selected.has(o.id) ? ' sel' : '');
      el.dataset.r = o.rarity;
      el.dataset.id = o.id;
      el.title = o.name + ' / ' + o.en;
      el.innerHTML =
        '<div class="check">✓</div>' +
        '<img loading="lazy" src="' + avatarUrl(o) + '" alt="">' +
        '<div class="nm">' + o.name + '</div>';
      el.querySelector('img').addEventListener('error', function () { onImgError(this); });
      el.onclick = () => {
        if (state.selected.has(o.id)) state.selected.delete(o.id);
        else state.selected.add(o.id);
        el.classList.toggle('sel');
        updateSelectCount();
      };
      frag.appendChild(el);
    }
    grid.innerHTML = '';
    grid.appendChild(frag);
  }

  function updateSelectCount() {
    const n = state.selected.size;
    $('#select-count').textContent = '已选 ' + n;
    const start = $('#start-btn');
    start.disabled = n < 2;
    $('#footer-hint').textContent =
      n < 2 ? '至少选择 2 名干员开始排序'
            : '将对 ' + n + ' 名干员进行排序（约需 ' +
              (n < 2 ? 0 : Math.ceil(n * Math.log2(n))) + ' 次对比）';
  }

  function applyPreset(preset) {
    if (preset === 'none') { state.selected.clear(); }
    else if (preset === 'all') { OPS.forEach((o) => state.selected.add(o.id)); }
    else if (preset === 'r6') { state.selected.clear(); OPS.forEach((o) => { if (o.rarity === 6) state.selected.add(o.id); }); }
    else if (preset === 'r56') { state.selected.clear(); OPS.forEach((o) => { if (o.rarity >= 5) state.selected.add(o.id); }); }
    else if (preset === 'visible') { filteredOps().forEach((o) => state.selected.add(o.id)); }
    renderGrid();
    updateSelectCount();
  }

  /* ---------------- 对比页 ---------------- */
  function renderCard(el, op) {
    el.dataset.r = op.rarity;
    el.innerHTML =
      '<img src="' + avatarUrl(op) + '" alt="">' +
      '<div class="card-name">' + op.name + '</div>' +
      '<div class="card-sub">' + opSub(op) + '</div>';
    el.querySelector('img').addEventListener('error', function () { onImgError(this); });
  }

  function renderSortStep() {
    const s = state.sorter;
    if (s.finished) { renderResult(); return; }
    const { a, b } = s.current();
    renderCard($('#choice-left'), a);
    renderCard($('#choice-right'), b);
    $('#progress-text').textContent = '第 ' + (s.comparisons + 1) + ' 次对比';
    const pct = s.percent();
    $('#progress-pct').textContent = pct + '%';
    $('#progress-fill').style.width = pct + '%';
    $('#undo-btn').disabled = s.history.length === 0;
  }

  function doChoose(dir) {
    state.sorter.choose(dir);
    if (state.sorter.finished) renderResult(); else renderSortStep();
  }

  /* ---------------- 结果页 ---------------- */
  function renderResult(sharedRanked) {
    const ranked = sharedRanked || state.sorter.ranked();
    const listEl = $('#result-list');
    listEl.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (let k = 0; k < ranked.length; k++) {
      const { op, rank } = ranked[k];
      const li = document.createElement('li');
      li.className = 'result-row' + (k < 3 ? ' top3' : '') + (rank === 1 ? ' top1' : '');
      li.dataset.r = op.rarity;
      li.innerHTML =
        '<div class="rank">' + rank + '</div>' +
        '<img src="' + avatarUrl(op) + '" alt="">' +
        '<div class="info"><span class="n">' + op.name + '</span>' +
        '<span class="s">' + opSub(op) + '</span></div>';
      li.querySelector('img').addEventListener('error', function () { onImgError(this); });
      frag.appendChild(li);
    }
    listEl.appendChild(frag);

    const n = ranked.length;
    $('#result-meta').textContent =
      '共 ' + n + ' 名干员' +
      (sharedRanked ? '（分享榜单）' : '，进行了 ' + state.sorter.comparisons + ' 次对比') +
      ' · ' + new Date().toLocaleString('zh-CN');
    state._lastRanked = ranked;
    showView('result');
  }

  /* ---------------- 分享链接编解码 ---------------- */
  function encodeRanked(ranked) {
    const idx = ranked.map((r) => idIndex.get(r.op.id));
    const buf = new Uint8Array(idx.length * 2);
    idx.forEach((v, i) => { buf[i * 2] = (v >> 8) & 255; buf[i * 2 + 1] = v & 255; });
    let bin = '';
    buf.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodeRanked(str) {
    try {
      const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
      const out = [];
      for (let i = 0; i + 1 < bin.length; i += 2) {
        const v = (bin.charCodeAt(i) << 8) | bin.charCodeAt(i + 1);
        const op = OPS[v];
        if (op) out.push({ op, rank: out.length + 1 });
      }
      return out;
    } catch (e) { return null; }
  }

  function copy(text, okMsg) {
    const done = () => alert(okMsg);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => fallback());
    } else fallback();
    function fallback() {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta); done();
    }
  }

  /* =======================================================================
   *  事件绑定
   * ===================================================================== */
  function bindEvents() {
    $('#search').addEventListener('input', (e) => { state.search = e.target.value; renderGrid(); });
    document.querySelectorAll('[data-preset]').forEach((b) =>
      b.addEventListener('click', () => applyPreset(b.dataset.preset)));

    $('#start-btn').addEventListener('click', () => {
      const items = OPS.filter((o) => state.selected.has(o.id));
      if (items.length < 2) return;
      state.sorter = new Sorter(items);
      showView('sort');
      renderSortStep();
    });

    $('#choice-left').addEventListener('click', () => doChoose('left'));
    $('#choice-right').addEventListener('click', () => doChoose('right'));
    $('#tie-btn').addEventListener('click', () => doChoose('tie'));
    $('#undo-btn').addEventListener('click', () => {
      if (state.sorter.undo()) renderSortStep();
    });
    $('#quit-btn').addEventListener('click', () => {
      if (confirm('退出当前排序？进度将丢失。')) showView('select');
    });

    document.addEventListener('keydown', (e) => {
      if (views.sort.classList.contains('hidden')) return;
      if (e.key === 'ArrowLeft') { doChoose('left'); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { doChoose('right'); e.preventDefault(); }
      else if (e.key === 'ArrowDown' || e.key === ' ') { doChoose('tie'); e.preventDefault(); }
      else if (e.key === 'Backspace') { if (state.sorter.undo()) renderSortStep(); e.preventDefault(); }
    });

    $('#restart-btn').addEventListener('click', () => {
      const items = (state._lastRanked || []).map((r) => r.op);
      if (items.length < 2) { showView('select'); return; }
      state.sorter = new Sorter(items);
      showView('sort');
      renderSortStep();
    });
    $('#back-btn').addEventListener('click', () => { history.replaceState(null, '', location.pathname); showView('select'); });

    $('#copy-text-btn').addEventListener('click', () => {
      const lines = (state._lastRanked || []).map((r) => r.rank + '. ' + r.op.name + '  (' + opSub(r.op) + ')');
      copy('【明日方舟 干员排序结果】\n' + lines.join('\n'), '榜单文本已复制到剪贴板');
    });
    $('#copy-link-btn').addEventListener('click', () => {
      const code = encodeRanked(state._lastRanked || []);
      const url = location.origin + location.pathname + '#result=' + code;
      copy(url, '分享链接已复制到剪贴板');
    });
    $('#print-btn').addEventListener('click', () => window.print());
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    buildFilterChips();
    renderGrid();
    updateSelectCount();
    bindEvents();

    // 分享链接直达结果页
    const m = location.hash.match(/result=([^&]+)/);
    if (m) {
      const ranked = decodeRanked(m[1]);
      if (ranked && ranked.length) { renderResult(ranked); return; }
    }
    showView('select');
  }

  if (OPS.length === 0) {
    document.getElementById('grid').innerHTML =
      '<p class="hint">未能加载干员数据，请先运行 <code>node scripts/build-operators.mjs</code> 生成 data/operators.js</p>';
  } else {
    init();
  }
})();
