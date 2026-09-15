/* 干员竞猜小游戏：看立绘猜干员名（四选一，计分 / 连对 / 计时）
 * 独立模块，直接读取 window.ARK_DATA，不依赖 app.js 内部实现。
 */
(function () {
  'use strict';

  const DATA = window.ARK_DATA || { operators: [] };
  const OPS = DATA.operators || [];
  const AVATAR_BASE = DATA.avatarBase || '';
  const PORTRAIT_BASE = DATA.portraitBase || AVATAR_BASE;

  const CLASS_LABEL = {
    PIONEER: '先锋', WARRIOR: '近卫', TANK: '重装', SNIPER: '狙击',
    CASTER: '术师', MEDIC: '医疗', SUPPORT: '辅助', SPECIAL: '特种',
  };

  const PLACEHOLDER =
    'data:image/svg+xml;utf8,' +
    encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#1f242d"/></svg>');

  const artUrl = (o) => o.art || (PORTRAIT_BASE + '/' + o.id + '_1.png');
  const avatarUrl = (o) => AVATAR_BASE + '/' + o.id + '.png';
  const $ = (sel, root) => (root || document).querySelector(sel);

  const QUIZ_TIME = 12000; // 每题限时（毫秒）
  const REVEAL_MS = 1000;  // 答完停留时间

  const cfg = { pool: 'all', count: 10 };
  const game = {
    queue: [], idx: 0, score: 0, streak: 0, best: 0,
    answered: false, roundStart: 0, timerRAF: 0, revealTO: 0,
  };

  let viewEl; // #view-quiz

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function poolOps() {
    if (cfg.pool === 'r6') return OPS.filter((o) => o.rarity === 6);
    if (cfg.pool === 'r56') return OPS.filter((o) => o.rarity >= 5);
    return OPS.slice();
  }

  // 视图切换：隐藏所有 .view，显示指定 id
  function showOnly(id) {
    document.querySelectorAll('#app .view').forEach((v) => v.classList.add('hidden'));
    const el = document.getElementById(id);
    if (el) el.classList.remove('hidden');
    window.scrollTo(0, 0);
  }

  /* ---------------- DOM 构建 ---------------- */
  function buildView() {
    viewEl = document.getElementById('view-quiz');
    if (!viewEl) return;
    viewEl.innerHTML =
      '<div id="quiz-setup" class="quiz-setup">' +
        '<h2>🎮 干员竞猜</h2>' +
        '<p class="hint">看立绘，猜干员！四选一，答对加分、连对有 combo，每题限时 12 秒。</p>' +
        '<div class="quiz-field"><span class="quiz-label">题库</span>' +
          '<div class="quiz-choices" id="quiz-pool">' +
            '<button class="chip active" data-pool="all">全部干员</button>' +
            '<button class="chip" data-pool="r56">五星及以上</button>' +
            '<button class="chip" data-pool="r6">仅六星</button>' +
          '</div></div>' +
        '<div class="quiz-field"><span class="quiz-label">题数</span>' +
          '<div class="quiz-choices" id="quiz-count">' +
            '<button class="chip active" data-count="10">10 题</button>' +
            '<button class="chip" data-count="20">20 题</button>' +
            '<button class="chip" data-count="30">30 题</button>' +
          '</div></div>' +
        '<div class="quiz-actions">' +
          '<button class="btn primary" id="quiz-start">开始挑战 →</button>' +
          '<button class="btn ghost" id="quiz-exit-setup">← 返回排序器</button>' +
        '</div>' +
      '</div>' +

      '<div id="quiz-play" class="quiz-play hidden">' +
        '<div class="quiz-top">' +
          '<button class="btn ghost small" id="quiz-quit">← 退出</button>' +
          '<span class="quiz-stat" id="quiz-progress">第 1/10 题</span>' +
          '<span class="quiz-stat" id="quiz-score">得分 0</span>' +
          '<span class="quiz-stat" id="quiz-streak">连对 0</span>' +
        '</div>' +
        '<div class="quiz-timerbar"><div class="quiz-timerfill" id="quiz-timerfill"></div></div>' +
        '<div class="quiz-art"><div class="frame"><div class="art" id="quiz-art"></div></div></div>' +
        '<div class="quiz-options" id="quiz-options"></div>' +
      '</div>' +

      '<div id="quiz-over" class="quiz-over hidden">' +
        '<h2>🏁 挑战结束</h2>' +
        '<div class="quiz-score-big" id="quiz-final"></div>' +
        '<p class="quiz-final-sub" id="quiz-final-sub"></p>' +
        '<div class="quiz-actions">' +
          '<button class="btn primary" id="quiz-again">再来一局</button>' +
          '<button class="btn ghost" id="quiz-exit-over">← 返回排序器</button>' +
        '</div>' +
      '</div>';

    // 设置页交互
    $('#quiz-pool', viewEl).addEventListener('click', (e) => {
      const b = e.target.closest('[data-pool]'); if (!b) return;
      cfg.pool = b.dataset.pool;
      viewEl.querySelectorAll('#quiz-pool .chip').forEach((c) => c.classList.toggle('active', c === b));
    });
    $('#quiz-count', viewEl).addEventListener('click', (e) => {
      const b = e.target.closest('[data-count]'); if (!b) return;
      cfg.count = parseInt(b.dataset.count, 10);
      viewEl.querySelectorAll('#quiz-count .chip').forEach((c) => c.classList.toggle('active', c === b));
    });
    $('#quiz-start', viewEl).addEventListener('click', startGame);
    $('#quiz-exit-setup', viewEl).addEventListener('click', exitToSorter);
    $('#quiz-quit', viewEl).addEventListener('click', () => { stopTimers(); exitToSorter(); });
    $('#quiz-again', viewEl).addEventListener('click', () => { showSetup(); });
    $('#quiz-exit-over', viewEl).addEventListener('click', exitToSorter);
  }

  function exitToSorter() {
    stopTimers();
    showOnly('view-select');
  }

  function enterQuiz() {
    if (!viewEl) buildView();
    showSetup();
    showOnly('view-quiz');
  }

  function showSetup() {
    stopTimers();
    $('#quiz-setup', viewEl).classList.remove('hidden');
    $('#quiz-play', viewEl).classList.add('hidden');
    $('#quiz-over', viewEl).classList.add('hidden');
  }

  /* ---------------- 游戏流程 ---------------- */
  function startGame() {
    const pool = poolOps();
    if (pool.length < 4) { alert('题库干员太少，换一个题库试试'); return; }
    const targets = shuffle(pool.slice()).slice(0, Math.min(cfg.count, pool.length));
    game.queue = targets;
    game.idx = 0; game.score = 0; game.streak = 0; game.best = 0;
    game.roundStart = (typeof performance !== 'undefined' ? performance.now() : Date.now());

    $('#quiz-setup', viewEl).classList.add('hidden');
    $('#quiz-over', viewEl).classList.add('hidden');
    $('#quiz-play', viewEl).classList.remove('hidden');
    nextQuestion();
  }

  function pickOptions(target, pool) {
    const others = pool.filter((o) => o.id !== target.id);
    const same = shuffle(others.filter((o) => o.cls === target.cls));
    const rest = shuffle(others.filter((o) => o.cls !== target.cls));
    let picks = same.concat(rest).slice(0, 3);
    if (picks.length < 3) { // 池子太小时从全体补
      const extra = shuffle(OPS.filter((o) => o.id !== target.id && !picks.some((p) => p.id === o.id)));
      picks = picks.concat(extra).slice(0, 3);
    }
    return shuffle([target].concat(picks));
  }

  function nextQuestion() {
    stopTimers();
    game.answered = false;
    const target = game.queue[game.idx];
    const pool = poolOps();

    $('#quiz-progress', viewEl).textContent = '第 ' + (game.idx + 1) + '/' + game.queue.length + ' 题';
    $('#quiz-score', viewEl).textContent = '得分 ' + game.score;
    $('#quiz-streak', viewEl).textContent = '连对 ' + game.streak;

    const artEl = $('#quiz-art', viewEl);
    artEl.style.backgroundImage = 'url(' + artUrl(target) + ')';

    const optsEl = $('#quiz-options', viewEl);
    optsEl.innerHTML = '';
    pickOptions(target, pool).forEach((op) => {
      const b = document.createElement('button');
      b.className = 'quiz-opt';
      b.textContent = op.name;
      b.addEventListener('click', () => onAnswer(op, target, b));
      optsEl.appendChild(b);
    });

    startTimer();
  }

  function startTimer() {
    const fill = $('#quiz-timerfill', viewEl);
    fill.classList.remove('low');
    const start = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (typeof requestAnimationFrame === 'undefined') return; // 环境无 rAF 时跳过动画
    const tick = (t) => {
      const frac = Math.max(0, 1 - (t - start) / QUIZ_TIME);
      fill.style.width = (frac * 100) + '%';
      fill.classList.toggle('low', frac < 0.3);
      if (frac <= 0) { if (!game.answered) onAnswer(null, game.queue[game.idx], null); return; }
      game.timerRAF = requestAnimationFrame(tick);
    };
    game.timerRAF = requestAnimationFrame(tick);
  }

  function stopTimers() {
    if (game.timerRAF && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(game.timerRAF);
    game.timerRAF = 0;
    if (game.revealTO) { clearTimeout(game.revealTO); game.revealTO = 0; }
  }

  function onAnswer(chosen, target, btn) {
    if (game.answered) return;
    game.answered = true;
    stopTimers();

    const correct = chosen && chosen.id === target.id;
    if (correct) {
      game.score++; game.streak++; game.best = Math.max(game.best, game.streak);
    } else {
      game.streak = 0;
    }
    $('#quiz-score', viewEl).textContent = '得分 ' + game.score;
    $('#quiz-streak', viewEl).textContent = '连对 ' + game.streak;

    // 标记选项：正确绿、错误红
    viewEl.querySelectorAll('.quiz-opt').forEach((b) => {
      b.disabled = true;
      if (b.textContent === target.name) b.classList.add('right');
      else if (btn && b === btn) b.classList.add('wrong');
    });

    game.revealTO = setTimeout(() => {
      game.idx++;
      if (game.idx >= game.queue.length) endGame();
      else nextQuestion();
    }, REVEAL_MS);
  }

  function endGame() {
    stopTimers();
    const total = game.queue.length;
    const secs = Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - game.roundStart) / 1000);
    const pct = total ? Math.round((game.score / total) * 100) : 0;

    let comment = '再接再厉！';
    if (pct === 100) comment = '满分！你就是资深博士 🎖️';
    else if (pct >= 80) comment = '厉害，图鉴烂熟于心！';
    else if (pct >= 50) comment = '还不错，继续加油～';

    $('#quiz-play', viewEl).classList.add('hidden');
    $('#quiz-over', viewEl).classList.remove('hidden');
    $('#quiz-final', viewEl).textContent = game.score + ' / ' + total;
    $('#quiz-final-sub', viewEl).textContent =
      '正确率 ' + pct + '%　·　最高连对 ' + game.best + '　·　用时 ' + secs + ' 秒　—　' + comment;
  }

  /* ---------------- 入口 ---------------- */
  function bind() {
    const entry = document.getElementById('quiz-entry');
    if (entry) entry.addEventListener('click', enterQuiz);
  }

  bind(); // 脚本位于 body 末尾，DOM 已就绪

  // 暴露给测试
  window.__quiz = { enterQuiz, startGame, poolOps, pickOptions, get game() { return game; }, get cfg() { return cfg; } };
})();
