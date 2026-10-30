/* Arknights Guess Pro：只露出立绘的局部碎块，玩家输入干员名字来猜。
 * 三阶段逐步揭开（1 块 → +2 块 → +3 块），机会 3/3/2，共 8 次；猜中即展示完整立绘。
 * 独立模块，直接读取 window.ARK_DATA。
 */
(function () {
  'use strict';

  const DATA = window.ARK_DATA || { operators: [] };
  const OPS = DATA.operators || [];
  const AVATAR_BASE = DATA.avatarBase || '';
  const PORTRAIT_BASE = DATA.portraitBase || AVATAR_BASE;
  const SKIN_BASE = DATA.skinBase || '';

  const CLASS_LABEL = {
    PIONEER: '先锋', WARRIOR: '近卫', TANK: '重装', SNIPER: '狙击',
    CASTER: '术师', MEDIC: '医疗', SUPPORT: '辅助', SPECIAL: '特种',
  };
  const NATION_LABEL = {
    rhodes: '罗德岛', columbia: '哥伦比亚', victoria: '维多利亚', yan: '炎国',
    lungmen: '龙门', sargon: '萨尔贡', siracusa: '叙拉古', laterano: '拉特兰',
    ursus: '乌萨斯', rim: '雷姆必拓', kazimierz: '卡西米尔', kjerag: '谢拉格',
    higashi: '东国', leithanien: '莱塔尼亚', egir: '阿戈尔', iberia: '伊比利亚',
    bolivar: '玻利瓦尔', sami: '萨米', minos: '米诺斯',
  };

  const artUrl = (o) => o.art || (PORTRAIT_BASE + '/' + o.id + '_1.png');
  const skinUrl = (file) => SKIN_BASE + '/' + file.replace(/#/g, '%23');
  // 本回合要展示的立绘：皮肤题库用随机皮肤，其它用默认立绘
  function roundArt(o) {
    if (cfg.pool === 'skin' && o.skins && o.skins.length) {
      return skinUrl(o.skins[Math.floor(Math.random() * o.skins.length)]);
    }
    return artUrl(o);
  }
  const $ = (sel, root) => (root || document).querySelector(sel);
  const opSub = (o) => {
    const parts = ['★'.repeat(o.rarity), CLASS_LABEL[o.cls] || o.cls];
    if (o.nation && NATION_LABEL[o.nation]) parts.push(NATION_LABEL[o.nation]);
    return parts.join(' · ');
  };

  // 名字规范化：去空格/中点/撇号/连字符，英文转小写
  const norm = (s) => (s || '').trim().toLowerCase().replace(/[\s·’'’\-．.。,，!！?？]/g, '');
  const nameIndex = new Map();
  OPS.forEach((o) => {
    nameIndex.set(norm(o.name), o);
    if (o.en) nameIndex.set(norm(o.en), o);
  });

  // 网格 4 列 × 5 行 = 20 块
  const COLS = 4, ROWS = 5, TILES = COLS * ROWS;
  const STAGES = [
    { add: 1, guesses: 3 },
    { add: 2, guesses: 3 },
    { add: 3, guesses: 2 },
  ];

  const cfg = { pool: 'all' };
  const game = {
    target: null, last: null,
    stageIdx: 0, guessesLeft: 0, revealOrder: [], revealed: 0,
    over: false, solved: 0, streak: 0,
  };

  let viewEl;

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function poolOps() {
    if (cfg.pool === 'skin') return OPS.filter((o) => o.skins && o.skins.length);
    if (cfg.pool === 'r6') return OPS.filter((o) => o.rarity === 6);
    if (cfg.pool === 'r56') return OPS.filter((o) => o.rarity >= 5);
    return OPS.slice();
  }

  function showOnly(id) {
    document.querySelectorAll('#app .view').forEach((v) => v.classList.add('hidden'));
    const el = document.getElementById(id);
    if (el) el.classList.remove('hidden');
    window.scrollTo(0, 0);
  }
  function setNav(id) {
    document.querySelectorAll('.sidenav-item').forEach((el) => el.classList.remove('active'));
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
  }

  /* ---------------- DOM ---------------- */
  function buildView() {
    viewEl = document.getElementById('view-guesspro');
    if (!viewEl) return;
    viewEl.innerHTML =
      '<div id="gp-setup" class="quiz-setup">' +
        '<h2>🧩 Arknights Guess Pro</h2>' +
        '<p class="hint">只露出一小块立绘，输入干员名字来猜！猜不中会逐步揭开更多。' +
          '三阶段：露 1 块（3 次机会）→ 再露 2 块（3 次）→ 再露 3 块（2 次），共 8 次机会。</p>' +
        '<div class="quiz-field"><span class="quiz-label">题库</span>' +
          '<div class="quiz-choices" id="gp-pool">' +
            '<button class="chip active" data-pool="all">全部干员</button>' +
            '<button class="chip" data-pool="r56">五星及以上</button>' +
            '<button class="chip" data-pool="r6">仅六星</button>' +
            '<button class="chip" data-pool="skin">皮肤 Guess</button>' +
          '</div></div>' +
        '<div class="quiz-actions">' +
          '<button class="btn primary" id="gp-start">开始挑战 →</button>' +
          '<button class="btn ghost" id="gp-exit-setup">← 返回排序器</button>' +
        '</div>' +
      '</div>' +

      '<div id="gp-play" class="quiz-play hidden">' +
        '<div class="quiz-top">' +
          '<button class="btn ghost small" id="gp-quit">← 退出</button>' +
          '<span class="quiz-stat" id="gp-stage">阶段 1/3</span>' +
          '<span class="quiz-stat" id="gp-reveal">已露出 1/20</span>' +
          '<span class="quiz-stat" id="gp-score">猜对 0 · 连对 0</span>' +
        '</div>' +
        '<div class="gp-wrap"><div class="gp-frame">' +
          '<div class="gp-art" id="gp-art"></div>' +
          '<div class="gp-grid" id="gp-grid"></div>' +
          '<div class="gp-name" id="gp-name"></div>' +
        '</div></div>' +
        '<div class="gp-guessbar" id="gp-guessbar">' +
          '<input type="text" id="gp-input" class="gp-input" list="gp-names" placeholder="输入干员名字…" autocomplete="off" />' +
          '<button class="btn primary" id="gp-submit">猜！</button>' +
          '<button class="btn ghost" id="gp-giveup">不认识</button>' +
          '<span class="gp-chances" id="gp-chances"></span>' +
        '</div>' +
        '<div class="gp-feedback" id="gp-feedback"></div>' +
        '<div class="gp-result hidden" id="gp-result">' +
          '<div class="gp-result-text" id="gp-result-text"></div>' +
          '<button class="btn primary" id="gp-next">下一位 →</button>' +
        '</div>' +
        '<datalist id="gp-names"></datalist>' +
      '</div>';

    // 自动补全：干员中文名
    const dl = $('#gp-names', viewEl);
    const frag = document.createDocumentFragment();
    OPS.forEach((o) => { const opt = document.createElement('option'); opt.value = o.name; frag.appendChild(opt); });
    dl.appendChild(frag);

    $('#gp-pool', viewEl).addEventListener('click', (e) => {
      const b = e.target.closest('[data-pool]'); if (!b) return;
      cfg.pool = b.dataset.pool;
      viewEl.querySelectorAll('#gp-pool .chip').forEach((c) => c.classList.toggle('active', c === b));
    });
    $('#gp-start', viewEl).addEventListener('click', startGame);
    $('#gp-exit-setup', viewEl).addEventListener('click', exitToSorter);
    $('#gp-quit', viewEl).addEventListener('click', exitToSorter);
    $('#gp-submit', viewEl).addEventListener('click', submitGuess);
    $('#gp-giveup', viewEl).addEventListener('click', giveUp);
    $('#gp-input', viewEl).addEventListener('keydown', (e) => { if (e.key === 'Enter') { submitGuess(); e.preventDefault(); } });
    $('#gp-next', viewEl).addEventListener('click', nextRound);
  }

  function exitToSorter() { showOnly('view-select'); setNav('nav-sorter'); }

  function enterGuessPro() {
    if (window.__quiz && window.__quiz.stop) window.__quiz.stop();
    if (!viewEl) buildView();
    showSetup();
    showOnly('view-guesspro');
    setNav('nav-guesspro');
  }

  function showSetup() {
    $('#gp-setup', viewEl).classList.remove('hidden');
    $('#gp-play', viewEl).classList.add('hidden');
  }

  /* ---------------- 游戏流程 ---------------- */
  function startGame() {
    const pool = poolOps();
    if (pool.length < 2) { alert('题库干员太少，换一个题库试试'); return; }
    game.solved = 0; game.streak = 0;
    $('#gp-setup', viewEl).classList.add('hidden');
    $('#gp-play', viewEl).classList.remove('hidden');
    nextRound();
  }

  // 揭开顺序：以中心格优先 + 少量随机，尽量先露出角色主体
  function buildRevealOrder() {
    const cx = (COLS - 1) / 2, cy = (ROWS - 1) / 2;
    const order = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const d = Math.hypot(c - cx, r - cy) + Math.random() * 0.9;
        order.push({ idx: r * COLS + c, d });
      }
    }
    order.sort((a, b) => a.d - b.d);
    return order.map((o) => o.idx);
  }

  function buildGrid() {
    const grid = $('#gp-grid', viewEl);
    grid.innerHTML = '';
    for (let i = 0; i < TILES; i++) {
      const t = document.createElement('div');
      t.className = 'gp-tile';
      t.dataset.i = i;
      grid.appendChild(t);
    }
  }

  function revealTiles(n) {
    const grid = $('#gp-grid', viewEl);
    for (let k = 0; k < n && game.revealed < game.revealOrder.length; k++) {
      const idx = game.revealOrder[game.revealed++];
      const tile = grid.querySelector('.gp-tile[data-i="' + idx + '"]');
      if (tile) tile.classList.add('revealed');
    }
  }

  function nextRound() {
    const pool = poolOps();
    let target = pool[Math.floor(Math.random() * pool.length)];
    if (pool.length > 1) { // 避免连续相同
      let guard = 0;
      while (game.last && target.id === game.last.id && guard++ < 10) {
        target = pool[Math.floor(Math.random() * pool.length)];
      }
    }
    game.target = target;
    game.last = target;
    game.stageIdx = 0;
    game.guessesLeft = STAGES[0].guesses;
    game.revealOrder = buildRevealOrder();
    game.revealed = 0;
    game.over = false;

    const artEl = $('#gp-art', viewEl);
    artEl.classList.remove('full'); // 新回合恢复填满取景框（配合贴块）
    artEl.style.backgroundImage = 'url(' + roundArt(target) + ')';
    buildGrid();
    revealTiles(STAGES[0].add);

    $('#gp-name', viewEl).classList.remove('show');
    $('#gp-name', viewEl).innerHTML = '';
    $('#gp-result', viewEl).classList.add('hidden');
    $('#gp-guessbar', viewEl).classList.remove('hidden');
    const input = $('#gp-input', viewEl);
    input.value = ''; input.disabled = false;
    $('#gp-submit', viewEl).disabled = false;
    setFeedback('', '');
    updateStatus();
    try { input.focus(); } catch (e) {}
  }

  function updateStatus() {
    $('#gp-stage', viewEl).textContent = '阶段 ' + Math.min(game.stageIdx + 1, STAGES.length) + '/' + STAGES.length;
    $('#gp-reveal', viewEl).textContent = '已露出 ' + game.revealed + '/' + TILES;
    $('#gp-score', viewEl).textContent = '猜对 ' + game.solved + ' · 连对 ' + game.streak;
    $('#gp-chances', viewEl).textContent = '本阶段还可猜 ' + game.guessesLeft + ' 次';
  }

  function setFeedback(text, kind) {
    const el = $('#gp-feedback', viewEl);
    el.textContent = text;
    el.className = 'gp-feedback' + (kind ? ' ' + kind : '');
  }

  function submitGuess() {
    if (game.over) return;
    const input = $('#gp-input', viewEl);
    const raw = input.value;
    const g = norm(raw);
    if (!g) { setFeedback('先输入一个干员名字吧', 'info'); return; }

    const matched = nameIndex.get(g);
    if (!matched) { setFeedback('查无此人「' + raw.trim() + '」，检查下名字', 'info'); return; }
    if (matched.id === game.target.id) { win(); return; }

    // 猜错，消耗一次机会
    game.guessesLeft--;
    input.value = '';
    if (game.guessesLeft > 0) {
      setFeedback('「' + matched.name + '」不对，再想想～', 'bad');
      updateStatus();
    } else {
      advanceStage();
    }
    try { input.focus(); } catch (e) {}
  }

  function advanceStage() {
    game.stageIdx++;
    if (game.stageIdx >= STAGES.length) { lose(); return; }
    const st = STAGES[game.stageIdx];
    revealTiles(st.add);
    game.guessesLeft = st.guesses;
    updateStatus();
    setFeedback('进入第 ' + (game.stageIdx + 1) + ' 阶段，又露出了 ' + st.add + ' 块！', 'info');
  }

  function revealAll() {
    $('#gp-grid', viewEl).querySelectorAll('.gp-tile').forEach((t) => t.classList.add('revealed'));
    game.revealed = TILES;
  }

  function finish(resultText) {
    game.over = true;
    revealAll();
    $('#gp-art', viewEl).classList.add('full'); // 揭晓时完整展示立绘（避免头部被裁切）
    const nameEl = $('#gp-name', viewEl);
    nameEl.innerHTML = '<div class="gp-name-main">' + game.target.name + '</div>' +
      '<div class="gp-name-sub">' + opSub(game.target) + '</div>';
    nameEl.classList.add('show');
    $('#gp-guessbar', viewEl).classList.add('hidden');
    $('#gp-input', viewEl).disabled = true;
    $('#gp-submit', viewEl).disabled = true;
    $('#gp-result-text', viewEl).innerHTML = resultText;
    $('#gp-result', viewEl).classList.remove('hidden');
    updateStatus();
  }

  function win() {
    game.solved++; game.streak++;
    finish('🎉 猜对了！是 <b>' + game.target.name + '</b>');
    setFeedback('', '');
  }

  function lose() {
    game.streak = 0;
    finish('💀 游戏失败，答案是 <b>' + game.target.name + '</b>');
    setFeedback('', '');
  }

  // 不认识：直接揭晓答案（本回合算未猜中，连对清零）
  function giveUp() {
    if (game.over) return;
    game.streak = 0;
    finish('🙈 本回合答案是 <b>' + game.target.name + '</b>');
    setFeedback('', '');
  }

  /* ---------------- 入口 ---------------- */
  function bind() {
    const entry = document.getElementById('nav-guesspro');
    if (entry) entry.addEventListener('click', enterGuessPro);
  }
  bind();

  window.__guesspro = {
    enterGuessPro, startGame, submitGuess, giveUp, nextRound,
    stop: function () {}, // 无计时器，占位以便跨玩法协作
    get game() { return game; }, get cfg() { return cfg; },
  };
})();
