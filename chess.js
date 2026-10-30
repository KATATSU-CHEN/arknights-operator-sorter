/* Arknights Chess：和「望ai」对战五子棋（15×15，玩家执黑先手）。
 * 三个难度：简单（随手）/ 困难（两层搜索）/ 望哥（四层 α-β 搜索）。
 * 独立模块，自带 AI，不依赖干员数据。
 */
(function () {
  'use strict';

  const N = 15;           // 棋盘 15×15
  const EMPTY = 0, YOU = 1, AI = 2; // 玩家执黑(1)先手，望ai 执白(2)
  const WIN = 1e8;
  const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

  const DIFFS = {
    easy: { name: '简单', depth: 0, topK: 0, avatar: 'assets/chess/easy.png?v=2', desc: '望ai 随手下，热身用' },
    hard: { name: '困难', depth: 2, topK: 12, avatar: 'assets/chess/hard.png?v=2', desc: '会抢攻会封堵，得认真' },
    wang: { name: '望哥', depth: 4, topK: 8, avatar: 'assets/chess/wang.png?v=2', desc: '望ai 全力以赴，小心被打穿' },
  };

  const $ = (sel, root) => (root || document).querySelector(sel);
  const inb = (r, c) => r >= 0 && c >= 0 && r < N && c < N;

  const cfg = { diff: 'easy' };
  const game = {
    board: [], turn: YOU, over: false, thinking: false,
    last: null, history: [], youWin: 0, aiWin: 0, timer: 0,
  };

  let viewEl;

  /* ======================= 棋局逻辑 ======================= */
  function newBoard() {
    const b = new Array(N);
    for (let r = 0; r < N; r++) b[r] = new Array(N).fill(EMPTY);
    return b;
  }

  // 落子 (r,c,color) 后，是否在某方向连成 5 子
  function runLen(b, r, c, color, dx, dy) {
    let n = 1;
    for (let s = 1; inb(r + dx * s, c + dy * s) && b[r + dx * s][c + dy * s] === color; s++) n++;
    for (let s = 1; inb(r - dx * s, c - dy * s) && b[r - dx * s][c - dy * s] === color; s++) n++;
    return n;
  }
  function makesFive(b, r, c, color) {
    for (const [dx, dy] of DIRS) if (runLen(b, r, c, color, dx, dy) >= 5) return true;
    return false;
  }

  // 全局评分（滑窗法，窗口内无对方子才计分）
  const PV = [0, 1, 12, 120, 1200, 100000];
  function scoreColor(b, color) {
    const opp = 3 - color; let total = 0;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        for (const [dx, dy] of DIRS) {
          const er = r + dx * 4, ec = c + dy * 4;
          if (!inb(er, ec)) continue;
          let cnt = 0, blocked = false;
          for (let k = 0; k < 5; k++) {
            const v = b[r + dx * k][c + dy * k];
            if (v === opp) { blocked = true; break; }
            if (v === color) cnt++;
          }
          if (!blocked && cnt) total += PV[cnt];
        }
      }
    }
    return total;
  }
  const evalRel = (b, color) => scoreColor(b, color) - scoreColor(b, 3 - color);

  // 候选点：已有棋子周围一圈的空位
  function rawCandidates(b) {
    const res = []; let any = false;
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (b[r][c]) { any = true; }
    if (!any) return [[(N / 2) | 0, (N / 2) | 0]];
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (b[r][c]) continue;
        let near = false;
        for (let dr = -1; dr <= 1 && !near; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (inb(r + dr, c + dc) && b[r + dr][c + dc]) { near = true; break; }
          }
        }
        if (near) res.push([r, c]);
      }
    }
    return res;
  }

  // 快速局部评分（仅用于给候选点排序，加速 α-β）
  function dirInfo(b, r, c, color, dx, dy) {
    let fwd = 0, r2 = r + dx, c2 = c + dy;
    while (inb(r2, c2) && b[r2][c2] === color) { fwd++; r2 += dx; c2 += dy; }
    const fopen = inb(r2, c2) && b[r2][c2] === EMPTY;
    let bwd = 0, r3 = r - dx, c3 = c - dy;
    while (inb(r3, c3) && b[r3][c3] === color) { bwd++; r3 -= dx; c3 -= dy; }
    const bopen = inb(r3, c3) && b[r3][c3] === EMPTY;
    return { len: fwd + bwd + 1, open: (fopen ? 1 : 0) + (bopen ? 1 : 0) };
  }
  function patVal(len, open) {
    if (len >= 5) return 100000;
    if (open === 0) return 0;
    const t = [0, 1, 10, 100, 1000];
    let v = t[Math.min(len, 4)] || 0;
    return open === 2 ? v * 4 : v;
  }
  function localScore(b, r, c, color) {
    let s = 0;
    for (const [dx, dy] of DIRS) { const { len, open } = dirInfo(b, r, c, color, dx, dy); s += patVal(len, open); }
    return s;
  }
  function order(b, color) {
    const opp = 3 - color;
    const scored = rawCandidates(b).map(([r, c]) => [Math.max(localScore(b, r, c, color), localScore(b, r, c, opp)), r, c]);
    scored.sort((x, y) => y[0] - x[0]);
    return scored.map((s) => [s[1], s[2]]);
  }

  function findWin(b, color) {
    for (const [r, c] of rawCandidates(b)) {
      b[r][c] = color; const f = makesFive(b, r, c, color); b[r][c] = EMPTY;
      if (f) return [r, c];
    }
    return null;
  }

  function negamax(b, depth, alpha, beta, color, topK) {
    if (depth === 0) return evalRel(b, color);
    const list = order(b, color).slice(0, topK);
    if (!list.length) return evalRel(b, color);
    let best = -Infinity;
    for (const [r, c] of list) {
      b[r][c] = color;
      const val = makesFive(b, r, c, color) ? WIN - (10 - depth)
        : -negamax(b, depth - 1, -beta, -alpha, 3 - color, topK);
      b[r][c] = EMPTY;
      if (val > best) best = val;
      if (val > alpha) alpha = val;
      if (alpha >= beta) break;
    }
    return best;
  }

  function aiMove() {
    const b = game.board, d = DIFFS[cfg.diff];
    const win = findWin(b, AI); if (win) return win;     // 能赢先赢
    const block = findWin(b, YOU); if (block) return block; // 否则先堵

    if (cfg.diff === 'easy') {
      const cs = rawCandidates(b);
      if (!cs.length) return [(N / 2) | 0, (N / 2) | 0];
      if (Math.random() < 0.65) return cs[(Math.random() * cs.length) | 0];
      let best = cs[0], bv = -Infinity;
      for (const [r, c] of cs) {
        b[r][c] = AI; const v = evalRel(b, AI); b[r][c] = EMPTY;
        if (v > bv) { bv = v; best = [r, c]; }
      }
      return best;
    }

    const list = order(b, AI).slice(0, d.topK);
    let best = list[0] || [(N / 2) | 0, (N / 2) | 0], bv = -Infinity, alpha = -Infinity;
    for (const [r, c] of list) {
      b[r][c] = AI;
      const val = makesFive(b, r, c, AI) ? WIN : -negamax(b, d.depth - 1, -Infinity, -alpha, YOU, d.topK);
      b[r][c] = EMPTY;
      if (val > bv) { bv = val; best = [r, c]; }
      if (val > alpha) alpha = val;
    }
    return best;
  }

  /* ======================= 视图 ======================= */
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

  function buildView() {
    viewEl = document.getElementById('view-chess');
    if (!viewEl) return;
    const diffBtns = Object.keys(DIFFS).map((k, i) =>
      '<button class="chess-diff' + (i === 0 ? ' active' : '') + '" data-diff="' + k + '">' +
      '<img src="' + DIFFS[k].avatar + '" alt="">' +
      '<span class="cd-name">' + DIFFS[k].name + '</span>' +
      '<span class="cd-desc">' + DIFFS[k].desc + '</span></button>').join('');

    viewEl.innerHTML =
      '<div id="chess-setup" class="quiz-setup">' +
        '<h2>⚫ Arknights Chess</h2>' +
        '<p class="hint">和「望ai」对战五子棋，你执黑先手。先连成五子者获胜，选个难度开始吧！</p>' +
        '<div class="quiz-field"><span class="quiz-label">难度</span>' +
          '<div class="chess-diffs" id="chess-diffs">' + diffBtns + '</div>' +
        '</div>' +
        '<div class="quiz-actions">' +
          '<button class="btn primary" id="chess-start">开始对战 →</button>' +
          '<button class="btn ghost" id="chess-exit-setup">← 返回排序器</button>' +
        '</div>' +
      '</div>' +

      '<div id="chess-play" class="hidden">' +
        '<div class="quiz-top">' +
          '<button class="btn ghost small" id="chess-quit">← 退出</button>' +
          '<span class="quiz-stat" id="chess-turn">轮到你落子</span>' +
          '<span class="quiz-stat" id="chess-score">你 0 : 0 望ai</span>' +
        '</div>' +
        '<div class="chess-wrap">' +
          '<div class="chess-boardbox">' +
            '<div class="chess-board" id="chess-board"></div>' +
            '<div class="chess-over hidden" id="chess-over">' +
              '<div class="chess-over-card">' +
                '<div class="chess-over-text" id="chess-over-text"></div>' +
                '<button class="btn primary" id="chess-again">再来一局</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<aside class="chess-side">' +
            '<img class="chess-avatar" id="chess-avatar" src="" alt="望ai">' +
            '<div class="chess-ai-name" id="chess-ai-name">望ai</div>' +
            '<div class="chess-ai-say" id="chess-ai-say">请落子吧。</div>' +
            '<div class="chess-controls">' +
              '<button class="btn ghost small" id="chess-undo">↶ 悔棋</button>' +
              '<button class="btn ghost small" id="chess-restart">↺ 重开</button>' +
            '</div>' +
          '</aside>' +
        '</div>' +
      '</div>';

    // 构建棋盘格子
    const board = $('#chess-board', viewEl);
    const frag = document.createDocumentFragment();
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const cell = document.createElement('div');
        cell.className = 'chess-cell';
        cell.dataset.r = r; cell.dataset.c = c;
        frag.appendChild(cell);
      }
    }
    board.appendChild(frag);
    board.addEventListener('click', (e) => {
      const cell = e.target.closest('.chess-cell'); if (!cell) return;
      onPlay(+cell.dataset.r, +cell.dataset.c);
    });

    $('#chess-diffs', viewEl).addEventListener('click', (e) => {
      const b = e.target.closest('[data-diff]'); if (!b) return;
      cfg.diff = b.dataset.diff;
      viewEl.querySelectorAll('.chess-diff').forEach((x) => x.classList.toggle('active', x === b));
    });
    $('#chess-start', viewEl).addEventListener('click', startGame);
    $('#chess-exit-setup', viewEl).addEventListener('click', exitToSorter);
    $('#chess-quit', viewEl).addEventListener('click', exitToSorter);
    $('#chess-again', viewEl).addEventListener('click', restart);
    $('#chess-restart', viewEl).addEventListener('click', restart);
    $('#chess-undo', viewEl).addEventListener('click', undo);
  }

  function exitToSorter() { stop(); showOnly('view-select'); setNav('nav-sorter'); }

  function enterChess() {
    if (window.__quiz && window.__quiz.stop) window.__quiz.stop();
    if (window.__guesspro && window.__guesspro.stop) window.__guesspro.stop();
    if (!viewEl) buildView();
    $('#chess-setup', viewEl).classList.remove('hidden');
    $('#chess-play', viewEl).classList.add('hidden');
    showOnly('view-chess');
    setNav('nav-chess');
  }

  function stop() {
    game.thinking = false;
    if (game.timer) { clearTimeout(game.timer); game.timer = 0; }
  }

  /* ======================= 游戏流程 ======================= */
  function startGame() {
    $('#chess-avatar', viewEl).src = DIFFS[cfg.diff].avatar;
    $('#chess-ai-name', viewEl).textContent = '望ai · ' + DIFFS[cfg.diff].name;
    $('#chess-setup', viewEl).classList.add('hidden');
    $('#chess-play', viewEl).classList.remove('hidden');
    resetBoard();
  }

  function resetBoard() {
    stop();
    game.board = newBoard();
    game.turn = YOU; game.over = false; game.thinking = false;
    game.last = null; game.history = [];
    $('#chess-over', viewEl).classList.add('hidden');
    renderBoard();
    say('请落子吧，我执白。');
    updateStatus();
  }
  function restart() { resetBoard(); }

  function renderBoard() {
    const cells = $('#chess-board', viewEl).children;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const cell = cells[r * N + c];
        const v = game.board[r][c];
        cell.className = 'chess-cell'
          + (v === YOU ? ' s-you' : v === AI ? ' s-ai' : '')
          + (game.last && game.last[0] === r && game.last[1] === c ? ' last' : '');
      }
    }
  }

  function place(r, c, color) {
    game.board[r][c] = color;
    game.last = [r, c];
    game.history.push([r, c, color]);
  }

  function onPlay(r, c) {
    if (game.over || game.thinking) return;
    if (game.turn !== YOU) return;
    if (game.board[r][c] !== EMPTY) return;
    place(r, c, YOU);
    renderBoard();
    if (makesFive(game.board, r, c, YOU)) { finish(YOU); return; }
    if (isFull()) { finish(0); return; }
    game.turn = AI;
    updateStatus();
    scheduleAI();
  }

  function scheduleAI() {
    game.thinking = true;
    say('唔…让我想想。');
    updateStatus();
    const delay = cfg.diff === 'wang' ? 220 : 140;
    game.timer = setTimeout(() => {
      game.timer = 0;
      if (game.over || !viewEl || viewEl.classList.contains('hidden')) { game.thinking = false; return; }
      const mv = aiMove();
      game.thinking = false;
      if (!mv) return;
      const [r, c] = mv;
      place(r, c, AI);
      renderBoard();
      if (makesFive(game.board, r, c, AI)) { finish(AI); return; }
      if (isFull()) { finish(0); return; }
      game.turn = YOU;
      say('该你了。');
      updateStatus();
    }, delay);
  }

  function isFull() {
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (game.board[r][c] === EMPTY) return false;
    return true;
  }

  function undo() {
    if (game.thinking) return;
    let removed = 0;
    while (game.history.length && removed < 2) {
      const [r, c] = game.history.pop();
      game.board[r][c] = EMPTY;
      removed++;
    }
    if (!removed) return;
    game.over = false; game.turn = YOU;
    const h = game.history;
    game.last = h.length ? [h[h.length - 1][0], h[h.length - 1][1]] : null;
    $('#chess-over', viewEl).classList.add('hidden');
    renderBoard();
    say('反悔一手，想好了再来。');
    updateStatus();
  }

  function finish(winner) {
    game.over = true; game.thinking = false;
    let text;
    if (winner === YOU) { game.youWin++; text = '🎉 你赢了！'; say('可以啊，这局算你的。'); }
    else if (winner === AI) { game.aiWin++; text = '💀 望ai 赢了'; say('五连，我赢了。'); }
    else { text = '🤝 平局'; say('平手，再来一盘？'); }
    renderBoard();
    $('#chess-over-text', viewEl).textContent = text;
    $('#chess-over', viewEl).classList.remove('hidden');
    updateStatus();
  }

  function say(t) { const el = $('#chess-ai-say', viewEl); if (el) el.textContent = t; }
  function updateStatus() {
    const turnEl = $('#chess-turn', viewEl);
    if (turnEl) {
      turnEl.textContent = game.over ? '对局结束'
        : game.thinking ? '望ai 思考中…'
          : game.turn === YOU ? '轮到你落子（黑）' : '望ai 落子中';
    }
    const sc = $('#chess-score', viewEl);
    if (sc) sc.textContent = '你 ' + game.youWin + ' : ' + game.aiWin + ' 望ai';
  }

  /* ======================= 入口 ======================= */
  function bind() {
    const entry = document.getElementById('nav-chess');
    if (entry) entry.addEventListener('click', enterChess);
  }
  bind();

  window.__chess = {
    enterChess, startGame, aiMove, stop,
    get game() { return game; }, get cfg() { return cfg; },
    _internals: { makesFive, findWin, evalRel, rawCandidates, N, YOU, AI, newBoard },
  };
})();
