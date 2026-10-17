/* 抓坏猫 v0.2
 * 纯本地单页小游戏，无外部请求、无内联脚本。
 * 语法基线：ES2017 / Chrome 61
 */
(function () {
  'use strict';

  /* ================= 配置 ================= */

  var CFG = {
    cageSlots: 7,
    mergeNeed: 3,
    maxLevel: 3,
    levelNames: ['', '小奶猫', '暴走猫', '猫大王'],
    mergeCooldown: 0.16,
    captureHold: 0.55,
    flyDur: 0.3,
    scoreCatch: 5,
    scoreMerge: 60,
    scoreCapture: 500,
    scoreTimeBonus: 10,
    penaltyGood: 15,                 // 误点好猫扣分
    lockGood: 0.4,                   // 误点好猫后的"愣住"时间（秒）
    missRates: [0.08, 0.22, 0.38],   // 警觉度 1/2/3 对应的扑空率
    alertWeights: [0.5, 0.35, 0.15], // 警觉度出现权重
    pityAfter: 2,                    // 连续扑空 2 次，第 3 次必中
    releaseHelpRate: 0.3,            // 放走时连带跑一只同伙的概率
    losePenalty: 100,                // 失败扣累计警务分
    storeKey: 'zhuahuaimao.best.v1',
    careerKey: 'zhuahuaimao.career.v1',
    hintKey: 'zhuahuaimao.hints.v1'
  };

  var LEVELS = [
    {
      no: 1,
      target: 1,
      duration: 90,
      species: 2,
      spawnEvery: 1.05,
      spawnJitter: 0.35,
      crossTime: 5.4,
      good: true,        // v0.2 试玩关：好猫与扑空全开，v0.4 起按关卡表分级开启
      goodRate: 0.2,
      miss: true
    }
  ];

  var SPECIES = [
    { name: '橘', coat: '#E8903A', shade: '#C26C1C', ear: '#F2B47A', mark: 'stripe' },
    { name: '灰', coat: '#95A2B2', shade: '#6C7A8C', ear: '#B9C4D1', mark: 'spot' }
  ];

  var GOODS = [
    { coat: '#F3E9D2', shade: '#D8C7A4', ear: '#F2B4B8' },
    { coat: '#CFE6DD', shade: '#9CC4B6', ear: '#F2B4B8' }
  ];

  var COLOR = {
    ink: '#0D1620',
    panel: '#16242F',
    steel: '#2D3F52',
    steelHi: '#3C536B',
    amber: '#F2B134',
    paper: '#EDE6D6',
    dim: '#7A8894',
    stamp: '#CE4B36',
    mint: '#5FB3A1',
    dark: '#121C26'
  };

  /* ================= DOM ================= */

  var $ = function (id) { return document.getElementById(id); };

  var elLevelNo = $('levelNo');
  var elEscape = $('escapeNum');
  var elScore = $('scoreNum');
  var elTarget = $('targetText');
  var elDots = $('targetDots');
  var elTimeFill = $('timeFill');
  var elTimeText = $('timeText');
  var elTimeBar = elTimeFill.parentNode;
  var elToast = $('toast');
  var elOverlay = $('overlay');
  var elScreenStart = $('screenStart');
  var elScreenEnd = $('screenEnd');
  var elBtnStart = $('btnStart');
  var elBtnAgain = $('btnAgain');
  var elBestStart = $('bestStart');
  var elBestEnd = $('bestEnd');
  var elVerdict = $('verdictMark');
  var elEndTitle = $('endTitle');
  var elEndNote = $('endNote');
  var elTally = $('tally');
  var elScreenHelp = $('screenHelp');
  var elHelpBody = $('helpBody');
  var elBtnHelp = $('btnHelp');
  var elBtnRules = $('btnRules');
  var elBtnRules2 = $('btnRules2');
  var elBtnHelpDone = $('btnHelpDone');
  var elCareerStart = $('careerStart');

  var canvas = $('game');
  var ctx = canvas.getContext('2d');

  /* ================= 工具 ================= */

  function rand(a, b) { return a + Math.random() * (b - a); }
  function randInt(n) { return Math.floor(Math.random() * n); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function easeBack(t) { var c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }

  function fmtTime(sec) {
    var s = Math.max(0, Math.ceil(sec));
    var m = Math.floor(s / 60);
    var r = s % 60;
    return m + ':' + (r < 10 ? '0' + r : '' + r);
  }

  function roundRect(c, x, y, w, h, r) {
    var rr = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.lineTo(x + w - rr, y);
    c.quadraticCurveTo(x + w, y, x + w, y + rr);
    c.lineTo(x + w, y + h - rr);
    c.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    c.lineTo(x + rr, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - rr);
    c.lineTo(x, y + rr);
    c.quadraticCurveTo(x, y, x + rr, y);
    c.closePath();
  }

  var reduceMotion = false;
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduceMotion = mq.matches;
  }

  function buzz(ms) {
    if (reduceMotion) return;
    if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) {} }
  }

  function loadBest() {
    try {
      var v = window.localStorage.getItem(CFG.storeKey);
      return v ? parseInt(v, 10) || 0 : 0;
    } catch (e) { return 0; }
  }

  function saveBest(v) {
    try { window.localStorage.setItem(CFG.storeKey, String(v)); } catch (e) {}
  }

  function loadCareer() {
    try {
      var v = window.localStorage.getItem(CFG.careerKey);
      return v ? parseInt(v, 10) || 0 : 0;
    } catch (e) { return 0; }
  }

  function saveCareer(v) {
    try { window.localStorage.setItem(CFG.careerKey, String(v)); } catch (e) {}
  }

  function loadHints() {
    try {
      var v = window.localStorage.getItem(CFG.hintKey);
      var o = v ? JSON.parse(v) : null;
      return o && typeof o === 'object' ? o : {};
    } catch (e) { return {}; }
  }

  function saveHints() {
    try { window.localStorage.setItem(CFG.hintKey, JSON.stringify(hints)); } catch (e) {}
  }

  // 一次性提示的已读记录；网址加 ?reset 可清空，方便反复测试
  var hints = loadHints();
  if (/[?&]reset(=|&|$)/.test(window.location.search)) { hints = {}; saveHints(); }

  function hintOnce(key, text, kind) {
    if (hints[key]) return false;
    hints[key] = 1;
    saveHints();
    toast(text, kind, 2.8);
    return true;
  }

  /* ================= 音效（WebAudio 现场合成） ================= */

  var AudioFX = (function () {
    var ac = null;
    var master = null;

    function init() {
      if (ac) return;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        ac = new AC();
        master = ac.createGain();
        master.gain.value = 0.32;
        master.connect(ac.destination);
      } catch (e) { ac = null; }
    }

    function resume() {
      if (ac && ac.state === 'suspended') { try { ac.resume(); } catch (e) {} }
    }

    function tone(freq, dur, type, vol, slideTo, delay) {
      if (!ac) return;
      var t0 = ac.currentTime + (delay || 0);
      var osc = ac.createOscillator();
      var g = ac.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol || 0.3, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g);
      g.connect(master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.03);
    }

    function noise(dur, vol) {
      if (!ac) return;
      var n = Math.floor(ac.sampleRate * dur);
      var buf = ac.createBuffer(1, n, ac.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      var src = ac.createBufferSource();
      src.buffer = buf;
      var g = ac.createGain();
      g.gain.value = vol || 0.2;
      src.connect(g); g.connect(master);
      src.start();
    }

    return {
      init: init,
      resume: resume,
      grab: function () { tone(520, 0.08, 'triangle', 0.26, 760); },
      land: function () { tone(300, 0.07, 'sine', 0.2); },
      deny: function () { tone(170, 0.14, 'square', 0.16, 110); },
      miss: function () { tone(720, 0.11, 'sine', 0.15, 360); noise(0.05, 0.08); },
      release: function () { tone(480, 0.2, 'triangle', 0.2, 900); },
      merge: function (lv, chain) {
        var base = 440 * Math.pow(1.26, lv - 1) * Math.pow(1.12, Math.min(chain, 5) - 1);
        tone(base, 0.16, 'triangle', 0.3, base * 1.5);
        noise(0.06, 0.12);
      },
      capture: function () {
        noise(0.12, 0.3);
        tone(392, 0.4, 'triangle', 0.3, 0, 0);
        tone(523, 0.4, 'triangle', 0.26, 0, 0.07);
        tone(784, 0.5, 'triangle', 0.24, 0, 0.14);
      },
      escape: function () { tone(240, 0.18, 'sine', 0.14, 160); },
      win: function () {
        var seq = [523, 659, 784, 1047];
        for (var i = 0; i < seq.length; i++) tone(seq[i], 0.35, 'triangle', 0.26, 0, i * 0.1);
      },
      lose: function () {
        tone(330, 0.5, 'sine', 0.22, 150);
        tone(220, 0.6, 'sine', 0.18, 110, 0.08);
      }
    };
  })();

  /* ================= 布局 ================= */

  var L = {};
  var dpr = 1;

  function layout() {
    var rect = canvas.getBoundingClientRect();
    var w = Math.max(240, Math.round(rect.width));
    var h = Math.max(300, Math.round(rect.height));

    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    L.w = w;
    L.h = h;

    L.beltH = Math.min(150, Math.max(96, h * 0.27));
    L.beltTop = Math.round(h * 0.06);
    L.beltBottom = L.beltTop + L.beltH;
    L.beltLine = L.beltTop + L.beltH * 0.46;
    L.catSize = Math.min(L.beltH * 0.66, w * 0.17, 74);

    var pad = 12;
    L.cageH = Math.min(104, Math.max(74, h * 0.18));
    L.cageBottom = h - 10;
    L.cageTop = L.cageBottom - L.cageH;
    L.cageLeft = pad;
    L.cageW = w - pad * 2;
    L.cellGap = 5;
    L.cellW = (L.cageW - L.cellGap * (CFG.cageSlots - 1)) / CFG.cageSlots;
    L.cellH = L.cageH - 22;
    L.cellTop = L.cageTop + 18;
    L.cageCat = Math.min(L.cellW * 0.86, L.cellH * 0.78);

    L.chainY = (L.beltBottom + L.cageTop) / 2;
  }

  function slotCenter(i) {
    return {
      x: L.cageLeft + i * (L.cellW + L.cellGap) + L.cellW / 2,
      y: L.cellTop + L.cellH / 2
    };
  }

  /* ================= 游戏状态 ================= */

  var G = {
    state: 'idle',           // idle | playing | over
    level: LEVELS[0],
    time: 0,
    score: 0,
    captured: 0,
    escaped: 0,
    cats: [],
    slots: [],
    flyers: [],
    parts: [],
    floats: [],
    spawnTimer: 0,
    nextSpawn: 1,
    beltOffset: 0,
    chain: 0,
    checkPending: false,
    mergeTimer: 0,
    shake: 0,
    stamp: null,
    catId: 1,
    toldEscape: false,
    clock: 0,
    lock: 0,                 // 误点好猫后的点击冷却
    sel: -1,                 // 笼满时选中的待放走格子
    runners: [],             // 被放走、正在逃跑的猫
    goodHit: 0,
    missTotal: 0,
    released: 0
  };

  function addScore(n) {
    G.score = Math.max(0, G.score + n);
  }

  function resetSlots() {
    G.slots = [];
    for (var i = 0; i < CFG.cageSlots; i++) G.slots.push(null);
  }

  function startIdle() {
    G.state = 'idle';
    G.level = LEVELS[0];
    G.cats = [];
    G.flyers = [];
    G.parts = [];
    G.floats = [];
    resetSlots();
    G.spawnTimer = 0;
    G.nextSpawn = 0.5;
    G.stamp = null;
    G.runners = [];
    G.sel = -1;
    G.lock = 0;
  }

  function startLevel(def) {
    G.state = 'playing';
    G.level = def;
    G.time = def.duration;
    G.score = 0;
    G.captured = 0;
    G.escaped = 0;
    G.cats = [];
    G.flyers = [];
    G.parts = [];
    G.floats = [];
    resetSlots();
    G.spawnTimer = 0;
    G.nextSpawn = 0.35;
    G.chain = 0;
    G.checkPending = false;
    G.mergeTimer = 0;
    G.shake = 0;
    G.stamp = null;
    G.toldEscape = false;
    G.runners = [];
    G.sel = -1;
    G.lock = 0;
    G.goodHit = 0;
    G.missTotal = 0;
    G.released = 0;

    elLevelNo.textContent = '第 ' + def.no + ' 号';
    elTarget.textContent = CFG.levelNames[3] + ' ×' + def.target;
    buildDots(def.target);
    syncHud();
  }

  function buildDots(n) {
    while (elDots.firstChild) elDots.removeChild(elDots.firstChild);
    for (var i = 0; i < n; i++) elDots.appendChild(document.createElement('i'));
  }

  function syncDots() {
    var kids = elDots.childNodes;
    for (var i = 0; i < kids.length; i++) {
      if (i < G.captured) kids[i].className = 'on';
      else kids[i].className = '';
    }
  }

  var lastScoreShown = -1;
  var lastTimeShown = -1;

  function syncHud() {
    if (G.score !== lastScoreShown) {
      elScore.textContent = String(G.score);
      lastScoreShown = G.score;
    }
    elEscape.textContent = String(G.escaped);

    var total = G.level.duration;
    var ratio = clamp(G.time / total, 0, 1);
    elTimeFill.style.transform = 'scaleX(' + ratio.toFixed(4) + ')';

    var sec = Math.ceil(Math.max(0, G.time));
    if (sec !== lastTimeShown) {
      elTimeText.textContent = fmtTime(G.time);
      lastTimeShown = sec;
    }
    if (G.time <= 15 && G.state === 'playing') elTimeBar.className = 'time-bar low';
    else elTimeBar.className = 'time-bar';
  }

  /* ================= 提示条 ================= */

  var toastTimer = 0;

  function toast(text, kind, dur) {
    elToast.textContent = text;
    elToast.className = 'toast show' + (kind ? ' ' + kind : '');
    toastTimer = dur || 1.1;
  }

  function tickToast(dt) {
    if (toastTimer > 0) {
      toastTimer -= dt;
      if (toastTimer <= 0) elToast.className = 'toast';
    }
  }

  /* ================= 特效 ================= */

  function burst(x, y, n, colors, power) {
    if (reduceMotion) n = Math.min(n, 5);
    for (var i = 0; i < n; i++) {
      var a = rand(0, Math.PI * 2);
      var sp = rand(0.3, 1) * (power || 170);
      G.parts.push({
        x: x, y: y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - rand(20, 90),
        life: rand(0.45, 0.9),
        max: 0.9,
        r: rand(2, 5),
        c: colors[randInt(colors.length)],
        spin: rand(-8, 8),
        rot: rand(0, 6.28),
        star: Math.random() < 0.4
      });
    }
  }

  function floatText(x, y, text, color, size) {
    G.floats.push({ x: x, y: y, text: text, c: color, s: size || 15, life: 0.9 });
  }

  /* ================= 猫的绘制 ================= */

  function drawCat(c, x, y, size, spIdx, lv, phase, alpha) {
    var sp = SPECIES[spIdx];
    var s = size / 100;

    c.save();
    c.globalAlpha = alpha === undefined ? 1 : alpha;
    c.translate(x, y);
    c.scale(s, s);
    if (phase) c.rotate(Math.sin(phase) * 0.06);

    // 影子
    c.fillStyle = 'rgba(0,0,0,.28)';
    c.beginPath();
    c.ellipse(0, 46, 34, 7, 0, 0, Math.PI * 2);
    c.fill();

    // 耳朵
    c.fillStyle = sp.shade;
    c.beginPath();
    c.moveTo(-38, -14); c.lineTo(-31, -52); c.lineTo(-5, -26); c.closePath(); c.fill();
    c.beginPath();
    c.moveTo(38, -14); c.lineTo(31, -52); c.lineTo(5, -26); c.closePath(); c.fill();
    c.fillStyle = sp.ear;
    c.beginPath();
    c.moveTo(-32, -18); c.lineTo(-28, -42); c.lineTo(-13, -26); c.closePath(); c.fill();
    c.beginPath();
    c.moveTo(32, -18); c.lineTo(28, -42); c.lineTo(13, -26); c.closePath(); c.fill();

    // 头
    c.fillStyle = sp.coat;
    c.beginPath();
    c.ellipse(0, 2, 42, 39, 0, 0, Math.PI * 2);
    c.fill();

    // 花色
    c.fillStyle = sp.shade;
    if (sp.mark === 'stripe') {
      c.fillRect(-16, -32, 5, 13);
      c.fillRect(-4, -36, 5, 16);
      c.fillRect(8, -32, 5, 13);
    } else {
      c.beginPath(); c.ellipse(-26, -14, 9, 7, -0.3, 0, 6.3); c.fill();
      c.beginPath(); c.ellipse(24, 18, 8, 6, 0.3, 0, 6.3); c.fill();
      c.beginPath(); c.ellipse(-2, -30, 7, 5, 0, 0, 6.3); c.fill();
    }

    // 眼罩（坏猫标志）
    c.fillStyle = '#14202B';
    c.beginPath();
    c.moveTo(-44, -6);
    c.quadraticCurveTo(0, -16, 44, -6);
    c.lineTo(44, 8);
    c.quadraticCurveTo(0, 14, -44, 8);
    c.closePath();
    c.fill();

    // 眼睛
    var blink = Math.sin((phase || 0) * 0.7) > 0.985 ? 0.12 : 1;
    c.fillStyle = '#F7F2E4';
    c.beginPath(); c.ellipse(-17, 0, 9, 8 * blink, 0, 0, 6.3); c.fill();
    c.beginPath(); c.ellipse(17, 0, 9, 8 * blink, 0, 0, 6.3); c.fill();
    if (blink > 0.5) {
      c.fillStyle = '#121C26';
      var pw = lv >= 2 ? 3.2 : 4.4;
      c.beginPath(); c.ellipse(-16, 1, pw, 6, 0, 0, 6.3); c.fill();
      c.beginPath(); c.ellipse(18, 1, pw, 6, 0, 0, 6.3); c.fill();
      c.fillStyle = 'rgba(255,255,255,.85)';
      c.beginPath(); c.arc(-18, -2, 1.6, 0, 6.3); c.fill();
      c.beginPath(); c.arc(16, -2, 1.6, 0, 6.3); c.fill();
    }

    // 怒眉（2 级以上）
    if (lv >= 2) {
      c.strokeStyle = '#14202B';
      c.lineWidth = 4;
      c.lineCap = 'round';
      c.beginPath(); c.moveTo(-29, -16); c.lineTo(-9, -9); c.stroke();
      c.beginPath(); c.moveTo(29, -16); c.lineTo(9, -9); c.stroke();
    }

    // 鼻子与坏笑
    c.fillStyle = '#E2705E';
    c.beginPath();
    c.moveTo(-5, 15); c.lineTo(5, 15); c.lineTo(0, 21); c.closePath(); c.fill();

    c.strokeStyle = '#14202B';
    c.lineWidth = 2.6;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(0, 21);
    c.quadraticCurveTo(9, 30, 19, 22);
    c.stroke();
    c.beginPath();
    c.moveTo(0, 21);
    c.quadraticCurveTo(-5, 27, -12, 24);
    c.stroke();

    if (lv >= 2) {
      c.fillStyle = '#F7F2E4';
      c.beginPath(); c.moveTo(4, 22); c.lineTo(10, 22); c.lineTo(7, 29); c.closePath(); c.fill();
    }

    // 胡须
    c.strokeStyle = 'rgba(247,242,228,.5)';
    c.lineWidth = 1.8;
    c.beginPath(); c.moveTo(-28, 16); c.lineTo(-46, 12); c.stroke();
    c.beginPath(); c.moveTo(-28, 21); c.lineTo(-45, 23); c.stroke();
    c.beginPath(); c.moveTo(28, 16); c.lineTo(46, 12); c.stroke();
    c.beginPath(); c.moveTo(28, 21); c.lineTo(45, 23); c.stroke();

    // 猫大王：王冠
    if (lv >= 3) {
      c.fillStyle = COLOR.amber;
      c.beginPath();
      c.moveTo(-26, -40);
      c.lineTo(-18, -58); c.lineTo(-9, -44);
      c.lineTo(0, -62); c.lineTo(9, -44);
      c.lineTo(18, -58); c.lineTo(26, -40);
      c.closePath();
      c.fill();
      c.fillStyle = '#B5831F';
      c.fillRect(-26, -41, 52, 6);
      c.fillStyle = COLOR.stamp;
      c.beginPath(); c.arc(0, -50, 3.4, 0, 6.3); c.fill();
    }

    c.restore();
  }

  function drawGoodCat(c, x, y, size, v, phase) {
    var g = GOODS[v % GOODS.length];
    var s = size / 100;

    c.save();
    c.translate(x, y);
    c.scale(s, s);
    if (phase) c.rotate(Math.sin(phase) * 0.06);

    c.fillStyle = 'rgba(0,0,0,.28)';
    c.beginPath();
    c.ellipse(0, 46, 34, 7, 0, 0, Math.PI * 2);
    c.fill();

    // 耳朵
    c.fillStyle = g.shade;
    c.beginPath();
    c.moveTo(-38, -14); c.lineTo(-31, -52); c.lineTo(-5, -26); c.closePath(); c.fill();
    c.beginPath();
    c.moveTo(38, -14); c.lineTo(31, -52); c.lineTo(5, -26); c.closePath(); c.fill();
    c.fillStyle = g.ear;
    c.beginPath();
    c.moveTo(-32, -18); c.lineTo(-28, -42); c.lineTo(-13, -26); c.closePath(); c.fill();
    c.beginPath();
    c.moveTo(32, -18); c.lineTo(28, -42); c.lineTo(13, -26); c.closePath(); c.fill();

    // 头
    c.fillStyle = g.coat;
    c.beginPath();
    c.ellipse(0, 2, 42, 39, 0, 0, Math.PI * 2);
    c.fill();

    // 腮红
    c.fillStyle = 'rgba(240,140,155,.5)';
    c.beginPath(); c.ellipse(-27, 14, 8, 5, 0, 0, 6.3); c.fill();
    c.beginPath(); c.ellipse(27, 14, 8, 5, 0, 0, 6.3); c.fill();

    // 眼睛：无眼罩，圆溜溜
    var blink = Math.sin((phase || 0) * 0.7) > 0.985 ? 0.12 : 1;
    c.fillStyle = '#1B2733';
    c.beginPath(); c.ellipse(-17, -2, 7, 9 * blink, 0, 0, 6.3); c.fill();
    c.beginPath(); c.ellipse(17, -2, 7, 9 * blink, 0, 0, 6.3); c.fill();
    if (blink > 0.5) {
      c.fillStyle = '#FFFFFF';
      c.beginPath(); c.arc(-19.5, -5.5, 2.6, 0, 6.3); c.fill();
      c.beginPath(); c.arc(14.5, -5.5, 2.6, 0, 6.3); c.fill();
      c.beginPath(); c.arc(-15, 1, 1.2, 0, 6.3); c.fill();
      c.beginPath(); c.arc(19, 1, 1.2, 0, 6.3); c.fill();
    }

    // 鼻子与微笑
    c.fillStyle = '#E58A94';
    c.beginPath();
    c.moveTo(-5, 15); c.lineTo(5, 15); c.lineTo(0, 21); c.closePath(); c.fill();
    c.strokeStyle = '#3B2A2A';
    c.lineWidth = 2.6;
    c.lineCap = 'round';
    c.beginPath(); c.moveTo(0, 21); c.quadraticCurveTo(-6, 31, -15, 23); c.stroke();
    c.beginPath(); c.moveTo(0, 21); c.quadraticCurveTo(6, 31, 15, 23); c.stroke();

    // 胡须
    c.strokeStyle = 'rgba(60,50,50,.4)';
    c.lineWidth = 1.8;
    c.beginPath(); c.moveTo(-28, 16); c.lineTo(-46, 12); c.stroke();
    c.beginPath(); c.moveTo(-28, 21); c.lineTo(-45, 23); c.stroke();
    c.beginPath(); c.moveTo(28, 16); c.lineTo(46, 12); c.stroke();
    c.beginPath(); c.moveTo(28, 21); c.lineTo(45, 23); c.stroke();

    // 蝴蝶结（好猫标志）
    c.fillStyle = COLOR.mint;
    c.strokeStyle = '#3F8A7A';
    c.lineWidth = 2;
    c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(0, -38); c.lineTo(-19, -50); c.lineTo(-19, -26); c.closePath();
    c.fill(); c.stroke();
    c.beginPath();
    c.moveTo(0, -38); c.lineTo(19, -50); c.lineTo(19, -26); c.closePath();
    c.fill(); c.stroke();
    c.fillStyle = '#3F8A7A';
    c.beginPath(); c.arc(0, -38, 5, 0, 6.3); c.fill();

    c.restore();
  }

  // 警觉度标记：头顶 1-3 个感叹号；连扑空 2 次后变青色并加光圈（下次必中）
  function drawAlertMarks(c, x, y, size, n, pity, t) {
    var col = pity ? COLOR.mint : COLOR.amber;
    var gap = 9;
    var x0 = x - (n - 1) * gap / 2;
    var top = y - size * 0.78;

    c.save();
    if (pity) {
      c.globalAlpha = 0.5 + 0.3 * Math.sin(t * 6);
      c.strokeStyle = COLOR.mint;
      c.lineWidth = 2;
      c.beginPath();
      c.arc(x, y, size * 0.58, 0, 6.3);
      c.stroke();
      c.globalAlpha = 1;
    }
    c.fillStyle = col;
    c.strokeStyle = 'rgba(8,14,20,.85)';
    c.lineWidth = 2;
    for (var i = 0; i < n; i++) {
      var mx = x0 + i * gap;
      roundRect(c, mx - 1.9, top - 9, 3.8, 9, 1.6);
      c.stroke();
      c.fill();
      c.beginPath();
      c.arc(mx, top + 4, 2.1, 0, 6.3);
      c.stroke();
      c.fill();
    }
    c.restore();
  }

  /* ================= 生成与更新 ================= */

  function spawnCat() {
    var def = G.level;
    var size = L.catSize;
    var speed = (L.w + size * 2) / def.crossTime;
    var good = !!def.good && Math.random() < def.goodRate;
    var alert = 0;
    if (!good && def.miss) {
      var roll = Math.random();
      var acc = 0;
      for (var a = 0; a < CFG.alertWeights.length; a++) {
        acc += CFG.alertWeights[a];
        if (roll < acc) { alert = a; break; }
        alert = a;
      }
    }
    G.cats.push({
      id: G.catId++,
      sp: good ? randInt(GOODS.length) : randInt(def.species),
      lv: 1,
      good: good,
      alert: alert,          // 0-2，对应头顶 1-3 个感叹号
      miss: 0,               // 已连续扑空次数
      dodge: 0,
      hit: false,            // 好猫是否已被误点（只扣一次）
      seen: false,
      x: -size,
      speed: speed,
      bob: rand(0, 6.28),
      bounce: 0,
      scale: 1
    });
  }

  function catY(cat, t) {
    var hop = cat.dodge > 0 ? Math.sin((1 - cat.dodge / 0.3) * Math.PI) * 18 : 0;
    return L.beltLine - L.catSize * 0.14 + Math.sin(t * 2.4 + cat.bob) * 3 - hop;
  }

  function firstEmptySlot() {
    for (var i = 0; i < G.slots.length; i++) if (!G.slots[i]) return i;
    return -1;
  }

  function cageCount() {
    var n = 0;
    for (var i = 0; i < G.slots.length; i++) if (G.slots[i]) n++;
    return n;
  }

  function tryCatch(px, py) {
    if (G.lock > 0) return true;

    var best = -1, bestD = 1e9;
    var r = L.catSize * 0.72;
    for (var i = 0; i < G.cats.length; i++) {
      var c0 = G.cats[i];
      var y0 = catY(c0, G.clock);
      var dx = px - c0.x, dy = py - y0;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < r && d < bestD) { bestD = d; best = i; }
    }
    if (best < 0) return false;

    var cat = G.cats[best];
    var cy = catY(cat, G.clock);

    if (cat.good) {
      onGoodHit(cat, cy);
      return true;
    }

    var slot = firstEmptySlot();
    if (slot < 0) {
      cat.bounce = 0.45;
      AudioFX.deny();
      buzz(30);
      if (!hintOnce('full', '笼子满了：点笼里一只，再点一次放走', 'warn')) {
        toast('笼满了 · 点笼里一只放走', 'warn');
      }
      return true;
    }

    if (G.level.miss && cat.miss < CFG.pityAfter && Math.random() < CFG.missRates[cat.alert]) {
      onMiss(cat, cy);
      return true;
    }

    G.cats.splice(best, 1);

    G.slots[slot] = { sp: cat.sp, lv: cat.lv, arriving: true, pop: 0, capture: 0 };

    var to = slotCenter(slot);
    G.flyers.push({
      sp: cat.sp, lv: cat.lv, slot: slot,
      x0: cat.x, y0: cy, x1: to.x, y1: to.y,
      t: 0, dur: CFG.flyDur
    });

    G.score += CFG.scoreCatch;
    AudioFX.grab();
    buzz(10);
    burst(cat.x, cy, 6, ['#F2B134', '#EDE6D6'], 110);
    return true;
  }

  function onGoodHit(cat, cy) {
    cat.bounce = 0.45;
    AudioFX.deny();
    buzz(40);
    if (cat.hit) return;
    cat.hit = true;
    addScore(-CFG.penaltyGood);
    G.goodHit++;
    G.lock = CFG.lockGood;
    floatText(cat.x, Math.max(14, cy - L.catSize * 0.9), '好猫！−' + CFG.penaltyGood, COLOR.stamp, 16);
    burst(cat.x, cy, 8, [COLOR.mint, COLOR.paper], 120);
    hintOnce('goodHit', '点到好猫了：扣分，还要愣一下', 'warn');
  }

  function onMiss(cat, cy) {
    cat.miss++;
    cat.dodge = 0.3;
    G.missTotal++;
    AudioFX.miss();
    buzz(12);
    burst(cat.x, cy + L.catSize * 0.3, 5, [COLOR.dim, COLOR.paper], 90);
    floatText(cat.x, Math.max(14, cy - L.catSize * 0.9), '扑空！', COLOR.paper, 16);
    if (cat.miss >= CFG.pityAfter) {
      floatText(cat.x, Math.max(30, cy - L.catSize * 1.15), '下次必中', COLOR.mint, 13);
    }
    hintOnce('miss', '扑空了：猫头上的 ! 越多越警觉，越容易扑空', null);
  }

  function slotMovable(j) {
    var sl = G.slots[j];
    return !!sl && !sl.arriving && sl.capture <= 0;
  }

  function cellAt(x, y) {
    if (y < L.cageTop || y > L.cageBottom) return -1;
    var rel = x - L.cageLeft;
    if (rel < -6 || rel > L.cageW + 6) return -1;
    var i = Math.floor(rel / (L.cellW + L.cellGap));
    return clamp(i, 0, CFG.cageSlots - 1);
  }

  // 优先带走相邻的同伙；相邻没有可带的就随机一只
  function pickAccomplice(i) {
    var adj = [];
    if (i > 0 && slotMovable(i - 1)) adj.push(i - 1);
    if (i < G.slots.length - 1 && slotMovable(i + 1)) adj.push(i + 1);
    if (adj.length) return adj[randInt(adj.length)];
    var any = [];
    for (var j = 0; j < G.slots.length; j++) {
      if (j !== i && slotMovable(j)) any.push(j);
    }
    return any.length ? any[randInt(any.length)] : -1;
  }

  function launchRunner(sl, p, dir, delay) {
    G.runners.push({
      sp: sl.sp, lv: sl.lv,
      x: p.x, y: p.y, y0: p.y,
      vx: dir * rand(230, 300),
      t: -(delay || 0)
    });
    burst(p.x, p.y, 7, [SPECIES[sl.sp].coat, COLOR.paper], 130);
  }

  function releaseSlot(i) {
    var sl = G.slots[i];
    var p = slotCenter(i);
    var dir = p.x < L.w / 2 ? -1 : 1;
    G.slots[i] = null;
    G.sel = -1;
    G.released++;
    launchRunner(sl, p, dir, 0);

    var helped = -1;
    if (Math.random() < CFG.releaseHelpRate) helped = pickAccomplice(i);

    if (helped >= 0) {
      var sl2 = G.slots[helped];
      var p2 = slotCenter(helped);
      G.slots[helped] = null;
      launchRunner(sl2, p2, dir, 0.08);
      floatText(p2.x, p2.y - L.cellH * 0.6, '同伙也跑了！', COLOR.stamp, 15);
      toast('它拉着同伙一起跑了', 'warn');
      AudioFX.escape();
      buzz(30);
    } else {
      toast('放走了一只', 'good');
      AudioFX.release();
      buzz(12);
    }
  }

  // 笼满时点笼里的猫：第一次选中，第二次放走。返回 true 表示这次点击已被笼子吃掉
  function handleCageTap(px, py) {
    if (G.state !== 'playing') return false;
    var idx = cellAt(px, py);
    if (idx < 0) {
      G.sel = -1;
      return false;
    }
    if (firstEmptySlot() >= 0) return true;
    if (!slotMovable(idx)) return true;
    if (G.sel === idx) {
      releaseSlot(idx);
    } else {
      G.sel = idx;
      AudioFX.land();
      buzz(8);
    }
    return true;
  }

  function resolveOneMerge() {
    for (var lv = 1; lv < CFG.maxLevel; lv++) {
      for (var sp = 0; sp < SPECIES.length; sp++) {
        var hits = [];
        for (var i = 0; i < G.slots.length; i++) {
          var s = G.slots[i];
          if (s && !s.arriving && s.capture <= 0 && s.lv === lv && s.sp === sp) hits.push(i);
          if (hits.length === CFG.mergeNeed) break;
        }
        if (hits.length === CFG.mergeNeed) {
          doMerge(hits, sp, lv);
          return true;
        }
      }
    }
    return false;
  }

  function doMerge(idx, sp, lv) {
    var target = idx[0];
    var to = slotCenter(target);

    for (var i = 1; i < idx.length; i++) {
      var p = slotCenter(idx[i]);
      burst(p.x, p.y, 5, [SPECIES[sp].coat, COLOR.paper], 90);
      G.slots[idx[i]] = null;
    }

    var newLv = lv + 1;
    G.slots[target] = {
      sp: sp, lv: newLv, arriving: false, pop: 1,
      capture: newLv === CFG.maxLevel ? CFG.captureHold : 0
    };

    G.chain++;
    var gain = CFG.scoreMerge * newLv * G.chain;
    G.score += gain;

    burst(to.x, to.y, 16, [SPECIES[sp].coat, COLOR.amber, COLOR.paper], 190);
    var label = G.chain > 1 ? '连锁 ×' + G.chain + '  +' + gain : '+' + gain;
    floatText(to.x, to.y - L.cellH * 0.5, label, G.chain > 1 ? COLOR.amber : COLOR.paper, G.chain > 1 ? 17 : 15);

    if (newLv < CFG.maxLevel) {
      floatText(to.x, L.chainY + 4, CFG.levelNames[newLv] + '！', SPECIES[sp].coat, 16);
    }

    AudioFX.merge(newLv, G.chain);
    buzz(G.chain > 1 ? 24 : 14);
    G.shake = Math.min(0.3, 0.1 + G.chain * 0.04);
  }

  function doCapture(i) {
    var s = G.slots[i];
    var p = slotCenter(i);
    G.slots[i] = null;
    G.captured++;
    G.score += CFG.scoreCapture;

    G.stamp = { t: 0, dur: 1.0 };
    G.shake = 0.42;
    burst(p.x, p.y, 30, [COLOR.amber, COLOR.stamp, COLOR.paper, '#FFD978'], 300);
    floatText(p.x, p.y - L.cellH * 0.6, '+' + CFG.scoreCapture, COLOR.amber, 19);
    AudioFX.capture();
    buzz([18, 40, 18]);
    syncDots();

    if (G.captured >= G.level.target) {
      G.state = 'ending';          // 冻结计时与生成，让庆祝动画放完
      window.setTimeout(function () { finish(true); }, 950);
    }
  }

  function update(dt) {
    G.clock = (G.clock || 0) + dt;
    G.beltOffset = (G.beltOffset + dt * (L.w / G.level.crossTime)) % 44;
    if (G.lock > 0) G.lock -= dt;

    // 生成
    if (G.state === 'idle' || G.state === 'playing') {
      G.spawnTimer += dt;
      if (G.spawnTimer >= G.nextSpawn) {
        G.spawnTimer = 0;
        G.nextSpawn = G.level.spawnEvery + rand(-G.level.spawnJitter, G.level.spawnJitter);
        spawnCat();
      }
    }

    // 传送带上的猫
    for (var i = G.cats.length - 1; i >= 0; i--) {
      var cat = G.cats[i];
      cat.x += cat.speed * dt;
      if (cat.bounce > 0) {
        cat.bounce -= dt;
        cat.scale = 1 + Math.sin(cat.bounce * 40) * 0.08;
      } else {
        cat.scale = 1;
      }
      if (cat.dodge > 0) cat.dodge -= dt;
      if (cat.good && !cat.seen && G.state === 'playing' && cat.x > L.catSize * 0.6) {
        cat.seen = true;
        hintOnce('good', '戴蝴蝶结的是好猫，别点它', 'good');
      }
      if (cat.x > L.w + L.catSize) {
        G.cats.splice(i, 1);
        if (G.state === 'playing' && !cat.good) {
          G.escaped++;
          AudioFX.escape();
          if (!G.toldEscape) {
            G.toldEscape = true;
            toast('跑掉一只', 'warn');
          }
        }
      }
    }

    // 飞向笼子的猫
    for (var f = G.flyers.length - 1; f >= 0; f--) {
      var fl = G.flyers[f];
      fl.t += dt / fl.dur;
      if (fl.t >= 1) {
        G.flyers.splice(f, 1);
        var s = G.slots[fl.slot];
        if (s && s.arriving) {
          s.arriving = false;
          s.pop = 1;
          G.checkPending = true;
          AudioFX.land();
          var p = slotCenter(fl.slot);
          burst(p.x, p.y + L.cellH * 0.3, 5, [COLOR.steelHi], 80);
        }
      }
    }

    // 合成判定
    if (G.mergeTimer > 0) G.mergeTimer -= dt;
    if (G.checkPending && G.mergeTimer <= 0) {
      if (resolveOneMerge()) {
        G.mergeTimer = CFG.mergeCooldown;
      } else {
        G.checkPending = false;
        G.chain = 0;
      }
    }

    // 笼中状态
    for (var k = 0; k < G.slots.length; k++) {
      var sl = G.slots[k];
      if (!sl) continue;
      if (sl.pop > 0) sl.pop = Math.max(0, sl.pop - dt * 3.4);
      if (sl.capture > 0) {
        sl.capture -= dt;
        if (sl.capture <= 0) doCapture(k);
      }
    }

    // 被放走的猫
    for (var rn = G.runners.length - 1; rn >= 0; rn--) {
      var rnr = G.runners[rn];
      rnr.t += dt;
      if (rnr.t > 0) rnr.x += rnr.vx * dt * (1 + rnr.t * 1.2);
      rnr.y = rnr.y0 - Math.abs(Math.sin(Math.max(0, rnr.t) * 9)) * 26;
      if (rnr.x < -L.cageCat * 1.5 || rnr.x > L.w + L.cageCat * 1.5) G.runners.splice(rn, 1);
    }

    // 选中的格子失效（笼子不再满、或那只猫已不可动）
    if (G.sel >= 0 && (firstEmptySlot() >= 0 || !slotMovable(G.sel))) G.sel = -1;

    // 粒子
    for (var q = G.parts.length - 1; q >= 0; q--) {
      var pt = G.parts[q];
      pt.life -= dt;
      if (pt.life <= 0) { G.parts.splice(q, 1); continue; }
      pt.vy += 620 * dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.rot += pt.spin * dt;
    }

    // 浮字
    for (var z = G.floats.length - 1; z >= 0; z--) {
      var ft = G.floats[z];
      ft.life -= dt;
      ft.y -= dt * 42;
      if (ft.life <= 0) G.floats.splice(z, 1);
    }

    if (G.shake > 0) G.shake = Math.max(0, G.shake - dt * 1.6);
    if (G.stamp) {
      G.stamp.t += dt;
      if (G.stamp.t >= G.stamp.dur) G.stamp = null;
    }

    // 计时
    if (G.state === 'playing') {
      G.time -= dt;
      if (G.time <= 0) {
        G.time = 0;
        finish(false);
      }
      syncHud();
    }

    tickToast(dt);
  }

  /* ================= 渲染 ================= */

  function render() {
    var w = L.w, h = L.h;
    ctx.clearRect(0, 0, w, h);

    ctx.save();
    if (G.shake > 0 && !reduceMotion) {
      var m = G.shake * 11;
      ctx.translate(rand(-m, m), rand(-m, m));
    }

    drawBeltLamp();
    drawBelt();

    // 传送带上的猫
    for (var i = 0; i < G.cats.length; i++) {
      var cat = G.cats[i];
      var cyy = catY(cat, G.clock);
      var csz = L.catSize * cat.scale;
      if (cat.good) {
        drawGoodCat(ctx, cat.x, cyy, csz, cat.sp, G.clock * 1.6 + cat.bob);
      } else {
        drawCat(ctx, cat.x, cyy, csz, cat.sp, cat.lv, G.clock * 1.6 + cat.bob);
        if (G.level.miss) {
          drawAlertMarks(ctx, cat.x, cyy, L.catSize, cat.alert + 1, cat.miss >= CFG.pityAfter, G.clock);
        }
      }
    }

    drawChainGuide();
    drawCage();

    // 飞行中的猫
    for (var f = 0; f < G.flyers.length; f++) {
      var fl = G.flyers[f];
      var t = easeOut(clamp(fl.t, 0, 1));
      var x = fl.x0 + (fl.x1 - fl.x0) * t;
      var y = fl.y0 + (fl.y1 - fl.y0) * t - Math.sin(t * Math.PI) * 54;
      var sz = L.catSize + (L.cageCat - L.catSize) * t;
      drawCat(ctx, x, y, sz, fl.sp, fl.lv, 0);
    }

    for (var rn = 0; rn < G.runners.length; rn++) {
      var rr2 = G.runners[rn];
      drawCat(ctx, rr2.x, rr2.y + L.cageCat * 0.06, L.cageCat, rr2.sp, rr2.lv, rr2.t * 14);
    }

    drawParticles();
    drawFloats();
    drawStamp();

    ctx.restore();
  }

  function drawBeltLamp() {
    var g = ctx.createRadialGradient(L.w / 2, L.beltTop - 30, 10, L.w / 2, L.beltTop - 30, L.w * 0.78);
    g.addColorStop(0, 'rgba(242,177,52,.17)');
    g.addColorStop(0.55, 'rgba(242,177,52,.05)');
    g.addColorStop(1, 'rgba(242,177,52,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, L.w, L.beltBottom + 40);
  }

  function drawBelt() {
    var top = L.beltTop, hgt = L.beltH, w = L.w;

    // 带体
    var g = ctx.createLinearGradient(0, top, 0, top + hgt);
    g.addColorStop(0, '#36495E');
    g.addColorStop(0.42, COLOR.steel);
    g.addColorStop(1, '#1D2B39');
    ctx.fillStyle = g;
    ctx.fillRect(0, top, w, hgt);

    // 斜纹
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, top, w, hgt);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,.045)';
    ctx.lineWidth = 12;
    for (var x = -hgt - 44 + G.beltOffset; x < w + hgt; x += 44) {
      ctx.beginPath();
      ctx.moveTo(x, top + hgt);
      ctx.lineTo(x + hgt, top);
      ctx.stroke();
    }
    ctx.restore();

    // 上下边缘
    ctx.fillStyle = 'rgba(242,177,52,.55)';
    ctx.fillRect(0, top, w, 2);
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fillRect(0, top + hgt - 3, w, 3);

    // 滚轮
    ctx.fillStyle = '#445C76';
    var rr = 6;
    var roll = (G.beltOffset * 0.6) % 26;
    for (var rx = -26 + roll; rx < w + 26; rx += 26) {
      ctx.beginPath();
      ctx.arc(rx, top + hgt + rr - 2, rr, 0, 6.3);
      ctx.fill();
    }

    // 两端门洞
    var gw = Math.min(26, L.w * 0.07);
    var lg = ctx.createLinearGradient(0, 0, gw, 0);
    lg.addColorStop(0, 'rgba(6,11,17,.95)');
    lg.addColorStop(1, 'rgba(6,11,17,0)');
    ctx.fillStyle = lg;
    ctx.fillRect(0, top, gw, hgt);
    var rg = ctx.createLinearGradient(w, 0, w - gw, 0);
    rg.addColorStop(0, 'rgba(6,11,17,.95)');
    rg.addColorStop(1, 'rgba(6,11,17,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(w - gw, top, gw, hgt);
  }

  function drawChainGuide() {
    var y = L.chainY;
    var mini = Math.min(34, L.w * 0.085);
    var step = mini * 1.95;
    var cx = L.w / 2;

    ctx.save();
    ctx.globalAlpha = 0.5;

    var xs = [cx - step, cx, cx + step];
    for (var i = 0; i < 3; i++) {
      drawCat(ctx, xs[i], y, mini, 0, i + 1, 0, 1);
    }

    ctx.globalAlpha = 0.6;
    ctx.fillStyle = COLOR.dim;
    ctx.font = '600 11px -apple-system, "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('凑 3', (xs[0] + xs[1]) / 2, y + 2);
    ctx.fillText('凑 3', (xs[1] + xs[2]) / 2, y + 2);

    ctx.globalAlpha = 0.45;
    ctx.font = '600 10px -apple-system, "PingFang SC", sans-serif';
    for (var k = 0; k < 3; k++) {
      ctx.fillStyle = k === 2 ? COLOR.amber : COLOR.dim;
      ctx.fillText(CFG.levelNames[k + 1], xs[k], y + mini * 0.78);
    }

    ctx.globalAlpha = 0.5;
    ctx.fillStyle = COLOR.dim;
    ctx.font = '600 10px -apple-system, \"PingFang SC\", sans-serif';
    ctx.fillText('同花色 · 同等级 · 凑 3 合成', cx, y + mini * 1.34);
    ctx.fillText('连着合叫连锁，倍率一路涨', cx, y + mini * 1.34 + 14);
    ctx.restore();
  }

  function drawCage() {
    // 标题行
    ctx.fillStyle = COLOR.dim;
    ctx.font = '600 11px -apple-system, "PingFang SC", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('押解笼', L.cageLeft + 1, L.cageTop + 11);
    ctx.textAlign = 'right';
    var n = cageCount();
    ctx.fillStyle = n >= CFG.cageSlots ? COLOR.stamp : COLOR.dim;
    ctx.fillText(n + ' / ' + CFG.cageSlots, L.cageLeft + L.cageW - 1, L.cageTop + 11);

    var full = G.state === 'playing' && firstEmptySlot() < 0;
    var pulse = Math.sin(G.clock * 5) * 0.5 + 0.5;
    if (full) {
      ctx.textAlign = 'center';
      if (G.sel >= 0) {
        ctx.fillStyle = COLOR.mint;
        ctx.fillText('再点一次放走（可能连带跑一只）', L.cageLeft + L.cageW / 2, L.cageTop + 11);
      } else {
        ctx.globalAlpha = 0.6 + 0.4 * pulse;
        ctx.fillStyle = COLOR.amber;
        ctx.fillText('满了 · 点笼里一只放走', L.cageLeft + L.cageW / 2, L.cageTop + 11);
        ctx.globalAlpha = 1;
      }
    }

    for (var i = 0; i < CFG.cageSlots; i++) {
      var x = L.cageLeft + i * (L.cellW + L.cellGap);
      var y = L.cellTop;
      var s = G.slots[i];

      ctx.fillStyle = s ? '#1D2E3D' : '#141F2A';
      roundRect(ctx, x, y, L.cellW, L.cellH, 3);
      ctx.fill();
      ctx.strokeStyle = s ? '#3A5068' : '#223243';
      ctx.lineWidth = 1;
      roundRect(ctx, x + 0.5, y + 0.5, L.cellW - 1, L.cellH - 1, 3);
      ctx.stroke();

      if (s && !s.arriving) {
        var p = slotCenter(i);
        var pop = s.pop > 0 ? 1 + Math.sin(s.pop * Math.PI) * 0.28 : 1;
        var flash = s.capture > 0 ? (Math.sin(s.capture * 36) * 0.5 + 0.5) : 0;
        drawCat(ctx, p.x, p.y + L.cageCat * 0.06, L.cageCat * pop, s.sp, s.lv, 0);
        if (flash > 0) {
          ctx.save();
          ctx.globalAlpha = flash * 0.5;
          ctx.fillStyle = COLOR.amber;
          roundRect(ctx, x, y, L.cellW, L.cellH, 3);
          ctx.fill();
          ctx.restore();
        }
      }

      // 栅栏前景
      if (s) {
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = '#56708C';
        ctx.lineWidth = 2;
        var bars = 3;
        for (var b = 1; b <= bars; b++) {
          var bx = x + (L.cellW / (bars + 1)) * b;
          ctx.beginPath();
          ctx.moveTo(bx, y + 3);
          ctx.lineTo(bx, y + L.cellH - 3);
          ctx.stroke();
        }
        ctx.restore();
      }

      // 笼满：可放走的格子描边提示；选中的格子青色高亮
      if (full && slotMovable(i)) {
        ctx.save();
        if (G.sel === i) {
          ctx.globalAlpha = 0.22;
          ctx.fillStyle = COLOR.mint;
          roundRect(ctx, x, y, L.cellW, L.cellH, 3);
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.strokeStyle = COLOR.mint;
          ctx.lineWidth = 2.5;
        } else {
          ctx.globalAlpha = 0.25 + 0.4 * pulse;
          ctx.strokeStyle = COLOR.amber;
          ctx.lineWidth = 1.5;
        }
        roundRect(ctx, x + 1, y + 1, L.cellW - 2, L.cellH - 2, 3);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  function drawParticles() {
    for (var i = 0; i < G.parts.length; i++) {
      var p = G.parts[i];
      var a = clamp(p.life / p.max, 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = p.c;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      if (p.star) {
        ctx.beginPath();
        for (var k = 0; k < 8; k++) {
          var ang = (Math.PI / 4) * k;
          var rad = k % 2 === 0 ? p.r * 2 : p.r * 0.8;
          var px = Math.cos(ang) * rad, py = Math.sin(ang) * rad;
          if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillRect(-p.r, -p.r, p.r * 2, p.r * 2);
      }
      ctx.restore();
    }
  }

  function drawFloats() {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (var i = 0; i < G.floats.length; i++) {
      var f = G.floats[i];
      ctx.save();
      ctx.globalAlpha = clamp(f.life / 0.9, 0, 1);
      ctx.font = '800 ' + f.s + 'px -apple-system, "PingFang SC", sans-serif';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(8,14,20,.85)';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.c;
      ctx.fillText(f.text, f.x, f.y);
      ctx.restore();
    }
  }

  function drawStamp() {
    if (!G.stamp) return;
    var t = G.stamp.t / G.stamp.dur;
    var scale, alpha;
    if (t < 0.22) {
      var k = t / 0.22;
      scale = 2.6 - 1.6 * easeOut(k);
      alpha = k;
    } else {
      scale = 1 + Math.sin((t - 0.22) * 10) * 0.02;
      alpha = clamp((1 - t) / 0.4, 0, 1);
    }

    var cx = L.w / 2, cy = L.chainY;
    ctx.save();
    ctx.globalAlpha = alpha * 0.95;
    ctx.translate(cx, cy);
    ctx.rotate(-0.17);
    ctx.scale(scale, scale);

    var bw = Math.min(200, L.w * 0.6), bh = 62;
    ctx.strokeStyle = COLOR.stamp;
    ctx.lineWidth = 5;
    roundRect(ctx, -bw / 2, -bh / 2, bw, bh, 5);
    ctx.stroke();
    ctx.lineWidth = 1.5;
    roundRect(ctx, -bw / 2 + 7, -bh / 2 + 7, bw - 14, bh - 14, 3);
    ctx.stroke();

    ctx.fillStyle = COLOR.stamp;
    ctx.font = '800 30px -apple-system, "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('已逮捕', 4, 1);
    ctx.restore();
  }

  /* ================= 结算 ================= */

  function finish(win) {
    if (G.state !== 'playing' && G.state !== 'ending') return;
    G.state = 'over';

    var timeBonus = win ? Math.floor(G.time) * CFG.scoreTimeBonus : 0;
    var total = G.score + timeBonus;

    var best = loadBest();
    if (total > best) { best = total; saveBest(best); }

    elVerdict.textContent = win ? '已结案' : '未结案';
    elVerdict.className = win ? 'verdict' : 'verdict miss';
    elEndTitle.textContent = win ? '全部落网' : '时间到了';
    elEndNote.textContent = win
      ? '猫大王已收押，剩下的同伙还在外面。'
      : '猫大王还逍遥法外，再蹲守一轮。';

    while (elTally.firstChild) elTally.removeChild(elTally.firstChild);
    var career = loadCareer();
    var nextCareer = Math.max(0, career + (win ? total : -CFG.losePenalty));
    saveCareer(nextCareer);
    var diff = nextCareer - career;
    var diffText = diff >= 0 ? '+' + diff : '−' + (-diff);

    addTally('抓捕得分', String(G.score));
    addTally('逮捕猫大王', G.captured + ' / ' + G.level.target);
    addTally('漏网坏猫', String(G.escaped));
    if (G.level.good) addTally('误点好猫', G.goodHit + ' 只');
    if (win) addTally('剩余时间奖励', '+' + timeBonus);
    addTally('总分', String(total), true);
    addTally('累计警务分', nextCareer + '（' + diffText + '）');

    elBestEnd.textContent = String(best);
    elBestStart.textContent = String(best);
    elCareerStart.textContent = String(nextCareer);

    if (win) AudioFX.win(); else AudioFX.lose();
    buzz(win ? [20, 60, 20, 60] : 120);

    window.setTimeout(function () {
      elScreenStart.hidden = true;
      elScreenEnd.hidden = false;
      elOverlay.className = 'overlay';
    }, 260);
  }

  function addTally(label, value, isSum) {
    var row = document.createElement('div');
    if (isSum) row.className = 'sum';
    var dt = document.createElement('dt');
    dt.textContent = label;
    var dd = document.createElement('dd');
    dd.textContent = value;
    row.appendChild(dt);
    row.appendChild(dd);
    elTally.appendChild(row);
  }

  /* ================= 输入 ================= */

  function canvasPoint(ev) {
    var rect = canvas.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  function onPointerDown(ev) {
    AudioFX.init();
    AudioFX.resume();
    if (G.state !== 'playing') return;
    ev.preventDefault();
    var p = canvasPoint(ev);
    if (handleCageTap(p.x, p.y)) return;
    tryCatch(p.x, p.y);
  }

  if (window.PointerEvent) {
    canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
  } else {
    canvas.addEventListener('touchstart', function (ev) {
      var t = ev.changedTouches[0];
      onPointerDown({ clientX: t.clientX, clientY: t.clientY, preventDefault: function () { ev.preventDefault(); } });
    }, { passive: false });
    canvas.addEventListener('mousedown', onPointerDown, false);
  }

  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); }, false);

  elBtnStart.addEventListener('click', function () {
    AudioFX.init();
    AudioFX.resume();
    if (!hints.help) { openHelp('first'); return; }
    beginRound();
  }, false);

  elBtnAgain.addEventListener('click', function () {
    AudioFX.resume();
    beginRound();
  }, false);

  function beginRound() {
    elOverlay.className = 'overlay away';
    window.setTimeout(function () {
      elScreenStart.hidden = true;
      elScreenEnd.hidden = true;
    }, 320);
    startLevel(LEVELS[0]);
  }

  /* ---------- 玩法说明（首次出勤必读，之后随时可开） ---------- */

  var helpFrom = 'start';

  function openHelp(from) {
    if (from === 'play') {
      if (G.state !== 'playing') return;
      G.state = 'paused';
      elToast.className = 'toast';
    }
    helpFrom = from;
    elScreenStart.hidden = true;
    elScreenEnd.hidden = true;
    elScreenHelp.hidden = false;
    elHelpBody.scrollTop = 0;
    elBtnHelpDone.textContent = from === 'first' ? '明白了，出勤' : (from === 'play' ? '继续抓捕' : '返回');
    elOverlay.className = 'overlay';
  }

  function closeHelp() {
    if (!hints.help) { hints.help = 1; saveHints(); }
    elScreenHelp.hidden = true;
    if (helpFrom === 'first') { beginRound(); return; }
    if (helpFrom === 'play') {
      G.state = 'playing';
      elOverlay.className = 'overlay away';
      return;
    }
    if (helpFrom === 'end') elScreenEnd.hidden = false;
    else elScreenStart.hidden = false;
  }

  elBtnHelp.addEventListener('click', function () { AudioFX.init(); AudioFX.resume(); openHelp('play'); }, false);
  elBtnRules.addEventListener('click', function () { openHelp('start'); }, false);
  elBtnRules2.addEventListener('click', function () { openHelp('end'); }, false);
  elBtnHelpDone.addEventListener('click', function () { AudioFX.resume(); closeHelp(); }, false);

  window.addEventListener('resize', function () { layout(); }, false);
  window.addEventListener('orientationchange', function () {
    window.setTimeout(layout, 220);
  }, false);

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) last = 0;
  }, false);

  /* ================= 主循环 ================= */

  var last = 0;

  function frame(now) {
    if (!last) last = now;
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (G.state !== 'paused') update(dt);
    render();
    window.requestAnimationFrame(frame);
  }

  /* ================= 启动 ================= */

  layout();
  startIdle();
  elBestStart.textContent = String(loadBest());
  elCareerStart.textContent = String(loadCareer());
  buildDots(LEVELS[0].target);
  elLevelNo.textContent = '第 ' + LEVELS[0].no + ' 号';
  elTarget.textContent = CFG.levelNames[3] + ' ×' + LEVELS[0].target;
  G.time = LEVELS[0].duration;
  syncHud();
  window.requestAnimationFrame(frame);

})();