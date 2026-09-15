/* 明日方舟 干员排序器
 * 交互式归并排序（用户作为比较器），支持平局与撤销。
 */
(function () {
  'use strict';

  const DATA = window.ARK_DATA || { avatarBase: '', operators: [] };
  const OPS = DATA.operators;
  const AVATAR_BASE = DATA.avatarBase;
  const PORTRAIT_BASE = DATA.portraitBase || AVATAR_BASE;

  const CLASS_LABEL = {
    PIONEER: '先锋', WARRIOR: '近卫', TANK: '重装', SNIPER: '狙击',
    CASTER: '术师', MEDIC: '医疗', SUPPORT: '辅助', SPECIAL: '特种',
  };

  // 阵营 / 势力（nationId → 中文），按干员数量大致排序
  const NATION_LABEL = {
    rhodes: '罗德岛', columbia: '哥伦比亚', victoria: '维多利亚', yan: '炎国',
    lungmen: '龙门', sargon: '萨尔贡', siracusa: '叙拉古', laterano: '拉特兰',
    ursus: '乌萨斯', rim: '雷姆必拓', kazimierz: '卡西米尔', kjerag: '谢拉格',
    higashi: '东国', leithanien: '莱塔尼亚', egir: '阿戈尔', iberia: '伊比利亚',
    bolivar: '玻利瓦尔', sami: '萨米', minos: '米诺斯',
  };
  const NATION_ORDER = ['rhodes', 'columbia', 'victoria', 'yan', 'lungmen', 'sargon',
    'siracusa', 'laterano', 'ursus', 'rim', 'kazimierz', 'kjerag', 'higashi',
    'leithanien', 'egir', 'iberia', 'bolivar', 'sami', 'minos'];
  const nationName = (id) => NATION_LABEL[id] || (id ? id : '其他');

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
  function opSub(o) {
    const parts = ['★'.repeat(o.rarity), CLASS_LABEL[o.cls] || o.cls];
    if (o.nation) parts.push(nationName(o.nation));
    return parts.join(' · ');
  }

  // 立绘加载链：精二立绘 _2 → 精一立绘 _1 → 头像 → 占位图
  function portraitImg(img, o) {
    const chain = [
      PORTRAIT_BASE + '/' + o.id + '_2.png',
      PORTRAIT_BASE + '/' + o.id + '_1.png',
      AVATAR_BASE + '/' + o.id + '.png',
      PLACEHOLDER,
    ];
    let step = 0;
    img.onerror = function () { step++; if (step < chain.length) img.src = chain[step]; else img.onerror = null; };
    img.src = chain[0];
  }

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
    nationFilter: new Set(),   // 空 = 全部
    search: '',
    usePortrait: true,         // 对比页默认显示精二立绘
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

    // 阵营：按预定义顺序，仅显示数据中实际存在的
    const present = new Set(OPS.map((o) => o.nation).filter(Boolean));
    const nations = NATION_ORDER.filter((n) => present.has(n));
    const nf = $('#nation-filters');
    nf.innerHTML = '<span class="hint" style="margin-right:4px">阵营</span>';
    nations.forEach((n) => {
      const c = document.createElement('span');
      c.className = 'chip';
      c.dataset.nation = n;
      c.textContent = NATION_LABEL[n];
      c.onclick = () => { toggleSet(state.nationFilter, n); c.classList.toggle('active'); renderGrid(); };
      nf.appendChild(c);
    });
  }

  function toggleSet(set, v) { if (set.has(v)) set.delete(v); else set.add(v); }

  function filteredOps() {
    const q = state.search.trim().toLowerCase();
    return OPS.filter((o) => {
      if (state.rarityFilter.size && !state.rarityFilter.has(o.rarity)) return false;
      if (state.classFilter.size && !state.classFilter.has(o.cls)) return false;
      if (state.nationFilter.size && !state.nationFilter.has(o.nation)) return false;
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
            : '将对 ' + n + ' 名干员进行排序（最多约 ' +
              Sorter.worstCaseComparisons(n) + ' 次对比，平局会更少）';
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
      '<img class="card-img" alt="">' +
      '<div class="card-name">' + op.name + '</div>' +
      '<div class="card-sub">' + opSub(op) + '</div>';
    const img = el.querySelector('img');
    if (state.usePortrait) portraitImg(img, op);
    else { img.addEventListener('error', function () { onImgError(this); }); img.src = avatarUrl(op); }
  }

  function renderSortStep() {
    const s = state.sorter;
    if (s.finished) { renderResult(); return; }
    $('#view-sort').classList.toggle('portrait-mode', state.usePortrait);
    $('#portrait-toggle').textContent = state.usePortrait ? '🖼 立绘' : '🙂 头像';
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
  const BIG_UNTIL = 18; // 前 3 名为领奖台，4~18 名为大图，其余为小图

  function medalClass(k) { return ['gold', 'silver', 'bronze'][k] || ''; }

  const portrait1Url = (o) => PORTRAIT_BASE + '/' + o.id + '_1.png';
  // 结果页立绘：优先 PRTS 全身立绘，缺失回退到 CDN 半身像
  const artUrl = (o) => o.art || portrait1Url(o);

  // 领奖台 / 大图条目：横版半身立绘（只露头到胸）+ 名次角标 + 名字
  function bigItem(op, rank, cls) {
    const el = document.createElement('div');
    el.className = 'rank-item banner-item ' + cls;
    el.dataset.r = op.rarity;
    el.innerHTML =
      '<div class="frame">' +
      '<div class="art" style="background-image:url(' + artUrl(op) + ')"></div>' +
      '<span class="place-badge">#' + rank + '</span></div>' +
      '<div class="rk-name">' + op.name + '</div>' +
      '<div class="rk-sub">' + opSub(op) + '</div>';
    return el;
  }

  // 小图条目：名次 + 方形头像 + 名字
  function smallItem(op, rank) {
    const el = document.createElement('div');
    el.className = 'rank-item small-item';
    el.dataset.r = op.rarity;
    el.innerHTML =
      '<div class="rk-name-sm">#' + rank + '</div>' +
      '<div class="frame"><img alt="' + op.name + '"></div>' +
      '<div class="caption">' + op.name + '</div>';
    const img = el.querySelector('img');
    img.addEventListener('error', function () { onImgError(this); });
    img.src = avatarUrl(op);
    return el;
  }

  function renderResult(sharedRanked) {
    const ranked = sharedRanked || state.sorter.ranked();
    const listEl = $('#result-list');
    listEl.innerHTML = '';

    const podium = document.createElement('div');
    podium.className = 'tier-podium';
    const big = document.createElement('div');
    big.className = 'tier-big';
    const small = document.createElement('div');
    small.className = 'tier-small';

    for (let k = 0; k < ranked.length; k++) {
      const { op, rank } = ranked[k];
      if (k < 3) podium.appendChild(bigItem(op, rank, 'podium-item ' + medalClass(k)));
      else if (k < BIG_UNTIL) big.appendChild(bigItem(op, rank, 'big-item'));
      else small.appendChild(smallItem(op, rank));
    }
    if (podium.children.length) listEl.appendChild(podium);
    if (big.children.length) listEl.appendChild(big);
    if (small.children.length) listEl.appendChild(small);

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
    $('#portrait-toggle').addEventListener('click', () => {
      state.usePortrait = !state.usePortrait;
      renderSortStep();
    });
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
